use futures_util::{SinkExt, StreamExt};
use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{header, HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

use crate::AppState;

const DISCOVERY_START_PORT: u16 = 50000;
const DISCOVERY_END_PORT: u16 = 50010;
const ASSET_PORT: u16 = 45732;

pub async fn start_bridge(handle: AppHandle) {
    let state = handle.state::<AppState>();

    let tx: Option<broadcast::Sender<String>> = {
        let tx_lock = state.pengu_bridge_tx.lock().await;
        tx_lock.clone()
    };
    let tx: broadcast::Sender<String> = match tx {
        Some(t) => t,
        None => {
            eprintln!("[Bridge] broadcast sender no disponible");
            return;
        }
    };

    let mut bound = None;
    for port in DISCOVERY_START_PORT..=DISCOVERY_END_PORT {
        let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
        if let Ok(listener) = TcpListener::bind(addr).await {
            bound = Some((listener, port));
            break;
        }
    }
    let Some((listener, bridge_port)) = bound else {
        eprintln!(
            "[Bridge] No hay puerto libre en {}-{}",
            DISCOVERY_START_PORT, DISCOVERY_END_PORT
        );
        return;
    };
    *state.pengu_bridge_port.lock().await = bridge_port;
    println!(
        "[Bridge] WebSocket/HTTP discovery en http://127.0.0.1:{} (/bridge-port)",
        bridge_port
    );
    let _ = handle.emit(
        "pengu:bridge-status",
        serde_json::json!({ "running": true, "port": bridge_port }),
    );

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let handle = handle.clone();
                let tx = tx.clone();
                tokio::spawn(async move {
                    handle_connection(stream, peer, handle, tx, bridge_port).await;
                });
            }
            Err(e) => {
                eprintln!("[Bridge] Accept error: {}", e);
            }
        }
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    peer: SocketAddr,
    handle: AppHandle,
    outgoing: broadcast::Sender<String>,
    bridge_port: u16,
) {
    if serve_bridge_port_discovery(&mut stream, bridge_port).await {
        return;
    }

    println!("[Bridge] Nueva conexion desde {}", peer);

    let ws_stream = match accept_hdr_async(stream, |req: &Request, response: Response| {
        if req.uri().path() == "/bridge-port" {
            let mut discovery: ErrorResponse = ErrorResponse::new(Some(bridge_port.to_string()));
            *discovery.status_mut() = StatusCode::OK;
            discovery.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            );
            discovery.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_ORIGIN,
                HeaderValue::from_static("*"),
            );
            return Err(discovery);
        }
        if is_allowed_bridge_handshake(req) {
            Ok(response)
        } else {
            let mut forbidden: ErrorResponse = ErrorResponse::new(Some("Forbidden".to_string()));
            *forbidden.status_mut() = StatusCode::FORBIDDEN;
            Err(forbidden)
        }
    })
    .await
    {
        Ok(ws) => ws,
        Err(WsError::Http(response)) if response.status() == StatusCode::OK => return,
        Err(e) => {
            eprintln!("[Bridge] Error en handshake WebSocket: {}", e);
            return;
        }
    };

    let _ = handle.emit(
        "pengu:bridge-status",
        serde_json::json!({
            "connected": true,
            "clients": 1,
            "remote": peer.to_string(),
        }),
    );

    let (mut write, mut read) = ws_stream.split();
    let mut rx = outgoing.subscribe();

    loop {
        tokio::select! {
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let text_str = text.to_string();
                        handle_incoming_message(&text_str, &peer, &handle, &mut write).await;
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(Message::Ping(data))) => {
                        let _ = write.send(Message::Pong(data)).await;
                    }
                    Some(Err(e)) => {
                        eprintln!("[Bridge] Error en mensaje: {}", e);
                        break;
                    }
                    None => break,
                    _ => {}
                }
            }

            result = rx.recv() => {
                match result {
                    Ok(msg) => {
                        let _ = write.send(Message::Text(msg.into())).await;
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        eprintln!("[Bridge] Lagged {} messages", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    let _ = handle.emit(
        "pengu:bridge-status",
        serde_json::json!({
            "connected": false,
            "clients": 0,
            "remote": peer.to_string(),
        }),
    );

    println!("[Bridge] Conexion cerrada: {}", peer);
}

async fn serve_bridge_port_discovery(stream: &mut TcpStream, bridge_port: u16) -> bool {
    let mut buf = [0u8; 512];
    let Ok(n) = stream.peek(&mut buf).await else {
        return false;
    };
    let request = String::from_utf8_lossy(&buf[..n]);
    let is_discovery = request.starts_with("GET /bridge-port ")
        || request.starts_with("GET /bridge-port?")
        || request.starts_with("OPTIONS /bridge-port ")
        || request.starts_with("OPTIONS /bridge-port?");
    if !is_discovery {
        return false;
    }
    let origin = request.lines().find_map(|line| {
        line.split_once(':').and_then(|(name, value)| {
            if name.trim().eq_ignore_ascii_case("origin") {
                Some(value.trim())
            } else {
                None
            }
        })
    });
    if !is_allowed_loopback_origin(origin) {
        let response = "HTTP/1.1 403 Forbidden\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: 9\r\n\
         Connection: close\r\n\
         \r\n\
         Forbidden";
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.shutdown().await;
        return true;
    }

    let body = bridge_port.to_string();
    let allow_origin = origin.unwrap_or("http://127.0.0.1");
    let response = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\
         Access-Control-Allow-Origin: {}\r\n\
         Access-Control-Allow-Methods: GET, OPTIONS\r\n\
         Access-Control-Allow-Headers: *\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
        allow_origin,
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
    true
}

fn is_allowed_loopback_origin(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(value) => {
            let value = value.to_ascii_lowercase();
            value.starts_with("https://127.0.0.1:")
                || value.starts_with("http://127.0.0.1:")
                || value.starts_with("https://localhost:")
                || value.starts_with("http://localhost:")
                || value.starts_with("https://[::1]:")
                || value.starts_with("http://[::1]:")
        }
    }
}

fn is_allowed_bridge_handshake(req: &Request) -> bool {
    let host_ok = req
        .headers()
        .get("host")
        .and_then(|value| value.to_str().ok())
        .map(|host| {
            let host = host.to_ascii_lowercase();
            host.contains("127.0.0.1") || host.contains("localhost")
        })
        .unwrap_or(true);
    if !host_ok {
        eprintln!("[Bridge] Handshake rechazado: host header invalido");
        return false;
    }

    let origin = req
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok());
    is_allowed_loopback_origin(origin)
}

async fn handle_incoming_message(
    text: &str,
    peer: &SocketAddr,
    handle: &AppHandle,
    write: &mut (impl futures_util::Sink<Message> + Unpin),
) {
    let json: serde_json::Value = match serde_json::from_str(text) {
        Ok(j) => j,
        Err(_) => {
            let payload = serde_json::json!({
                "source": "bridge",
                "peer": peer.to_string(),
                "receivedAt": chrono::Utc::now().timestamp_millis(),
                "raw": text,
            });
            let _ = handle.emit("pengu:message", payload);
            return;
        }
    };

    let msg_type = json
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    let received_at = chrono::Utc::now().timestamp_millis();

    // Log specific message types
    match msg_type {
        "skin-sync" | "skin-apply" | "skin-apply-result" => {
            println!("[Pengu Skin] {}", &text[..text.len().min(500)]);
        }
        "carousel-status" => {
            let short = serde_json::to_string(&serde_json::json!({
                "type": "carousel-status",
                "data": json.get("data"),
            }))
            .unwrap_or_default();
            println!("[Pengu Carousel] {}", &short[..short.len().min(1200)]);
        }
        _ => {}
    }

    // Forward ALL messages to frontend first (like Electron does), then handle specific types
    let mut forward_payload = json.clone();
    forward_payload["receivedAt"] = serde_json::json!(received_at);

    let _ = handle.emit("pengu:message", forward_payload.clone());

    // Handle specific message types (additional channels/responses)
    match msg_type {
        "lobby-state" => {
            let _ = handle.emit("pengu:lobby-state", forward_payload);
        }
        "request-chroma-data" => {
            handle_chroma_data(&json, handle, write).await;
        }
        "request-local-preview" => {
            handle_local_preview(&json, handle, write).await;
        }
        "request-local-asset" => {
            handle_local_asset(&json, handle, write).await;
        }
        _ => {}
    }
}

async fn handle_chroma_data(
    msg: &serde_json::Value,
    _handle: &AppHandle,
    write: &mut (impl futures_util::Sink<Message> + Unpin),
) {
    let skin_id = msg
        .get("skinId")
        .or_else(|| msg.get("baseSkinId"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let champion_key = msg
        .get("championKey")
        .or_else(|| msg.get("championId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let _known_chroma_ids: HashSet<u64> = msg
        .get("knownChromaIds")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|id| id.as_u64()).collect())
        .unwrap_or_default();

    let state = _handle.state::<AppState>();
    let app_dir = state.app_data_dir.lock().await.clone();
    let cache_path = PathBuf::from(&app_dir)
        .join("cache")
        .join("skin-library-index.json");

    let content = match std::fs::read_to_string(&cache_path) {
        Ok(c) => c,
        Err(_) => {
            let response = serde_json::json!({
                "type": "chroma-data",
                "skinId": skin_id,
                "championId": champion_key.parse::<u64>().unwrap_or(0),
                "championKey": champion_key,
                "chromas": [],
                "error": "cache-vacio",
            });
            let _ = write
                .send(Message::Text(
                    serde_json::to_string(&response).unwrap().into(),
                ))
                .await;
            return;
        }
    };

    let payload: serde_json::Value = match serde_json::from_str(&content) {
        Ok(p) => p,
        Err(_) => {
            let response = serde_json::json!({
                "type": "chroma-data",
                "skinId": skin_id,
                "championId": champion_key.parse::<u64>().unwrap_or(0),
                "championKey": champion_key,
                "chromas": [],
                "error": "cache-invalido",
            });
            let _ = write
                .send(Message::Text(
                    serde_json::to_string(&response).unwrap().into(),
                ))
                .await;
            return;
        }
    };

    let all_skins = payload
        .get("skins")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if all_skins.is_empty() {
        let response = serde_json::json!({
            "type": "chroma-data",
            "skinId": skin_id,
            "championId": champion_key.parse::<u64>().unwrap_or(0),
            "championKey": champion_key,
            "chromas": [],
            "error": "cache-vacio",
        });
        let _ = write
            .send(Message::Text(
                serde_json::to_string(&response).unwrap().into(),
            ))
            .await;
        return;
    }

    let champion_entries: Vec<&serde_json::Value> = all_skins
        .iter()
        .filter(|s| {
            s.get("championId").and_then(|v| v.as_str()).unwrap_or("") == champion_key
                || s.get("championKey").and_then(|v| v.as_str()).unwrap_or("") == champion_key
                || s.get("rawChampion").and_then(|v| v.as_str()).unwrap_or("") == champion_key
        })
        .collect();

    if champion_entries.is_empty() {
        let response = serde_json::json!({
            "type": "chroma-data",
            "skinId": skin_id,
            "championId": champion_key.parse::<u64>().unwrap_or(0),
            "championKey": champion_key,
            "chromas": [],
            "error": "sin-champion",
        });
        let _ = write
            .send(Message::Text(
                serde_json::to_string(&response).unwrap().into(),
            ))
            .await;
        return;
    }

    let target_skin_num = skin_id % 1000;
    let champion_id_num = champion_key.parse::<u64>().unwrap_or(0);

    // Find chroma entries
    let chroma_candidates: Vec<&serde_json::Value> = champion_entries
        .iter()
        .filter(|e| {
            let base_id = get_entry_base_id(e, champion_id_num);
            let variant_id = get_entry_variant_id(e, champion_id_num);
            base_id > 0
                && variant_id > 0
                && variant_id != base_id
                && (base_id % 1000 == target_skin_num || variant_id % 1000 == target_skin_num)
        })
        .cloned()
        .collect();

    let mut chromas = Vec::new();
    for entry in chroma_candidates {
        let variant_id = get_entry_variant_id(entry, champion_id_num);
        let base_id = get_entry_base_id(entry, champion_id_num);
        let name = entry
            .get("variant")
            .and_then(|v| v.as_str())
            .or_else(|| entry.get("skin").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string();
        let skin_name = entry
            .get("skin")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        chromas.push(serde_json::json!({
            "id": variant_id,
            "baseId": base_id,
            "name": name,
            "variant": name,
            "skin": skin_name,
            "imagePath": "",
            "colors": [],
            "primaryColor": serde_json::Value::Null,
        }));
    }

    let resolved_base_skin_id = chromas
        .first()
        .and_then(|c| c.get("baseId").and_then(|v| v.as_u64()))
        .unwrap_or(skin_id);

    let response = serde_json::json!({
        "type": "chroma-data",
        "skinId": skin_id,
        "baseSkinId": resolved_base_skin_id,
        "championId": champion_id_num,
        "championKey": champion_key,
        "chromas": chromas,
        "error": serde_json::Value::Null,
    });

    let _ = write
        .send(Message::Text(
            serde_json::to_string(&response).unwrap().into(),
        ))
        .await;
}

fn json_to_u64(v: &serde_json::Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
}

fn get_entry_base_id(entry: &serde_json::Value, champion_id: u64) -> u64 {
    let raw = entry
        .get("rawSkin")
        .or_else(|| entry.get("baseSkinId"))
        .or_else(|| entry.get("baseImageSkinNum"))
        .or_else(|| entry.get("imageSkinNum"))
        .or_else(|| entry.get("skinNum"))
        .and_then(json_to_u64)
        .unwrap_or(0);
    if champion_id > 0 && raw < 1000 {
        champion_id * 1000 + raw
    } else {
        raw
    }
}

fn get_entry_variant_id(entry: &serde_json::Value, champion_id: u64) -> u64 {
    let raw = entry
        .get("rawVariant")
        .or_else(|| entry.get("fileBaseId"))
        .or_else(|| entry.get("skinNum"))
        .or_else(|| entry.get("imageSkinNum"))
        .and_then(json_to_u64)
        .unwrap_or(0);
    if champion_id > 0 && raw < 1000 {
        champion_id * 1000 + raw
    } else {
        raw
    }
}

async fn handle_local_preview(
    msg: &serde_json::Value,
    _handle: &AppHandle,
    write: &mut (impl futures_util::Sink<Message> + Unpin),
) {
    let champion_id = msg
        .get("championId")
        .and_then(json_to_u64)
        .map(|v| v.to_string())
        .or_else(|| {
            msg.get("championId")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default();
    let skin_id = msg
        .get("skinId")
        .and_then(json_to_u64)
        .map(|v| v.to_string())
        .or_else(|| {
            msg.get("skinId")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default();
    let chroma_id = msg.get("chromaId").and_then(|v| v.as_u64()).unwrap_or(0);
    if champion_id.is_empty() || skin_id.is_empty() || chroma_id == 0 {
        return;
    }

    let state = _handle.state::<AppState>();
    let app_dir = state.app_data_dir.lock().await.clone();

    let league_skins_dir = PathBuf::from(&app_dir)
        .join("downloaded-libraries")
        .join("LeagueSkins")
        .join("skins")
        .join(&champion_id);

    let extensions = [".png", ".jpg", ".jpeg", ".webp"];
    let chroma_str = chroma_id.to_string();
    let mut preview_path = String::new();

    if chroma_str == skin_id {
        let dir = league_skins_dir.join(&skin_id);
        for ext in &extensions {
            let file = dir.join(format!("{}{}", skin_id, ext));
            if file.exists() {
                preview_path = file.to_string_lossy().to_string();
                break;
            }
        }
    }

    if preview_path.is_empty() {
        for s_id in [&skin_id, &chroma_str] {
            let dir = league_skins_dir.join(s_id).join(&chroma_str);
            for ext in &extensions {
                let file = dir.join(format!("{}{}", chroma_str, ext));
                if file.exists() {
                    preview_path = file.to_string_lossy().to_string();
                    break;
                }
            }
            if !preview_path.is_empty() {
                break;
            }
        }
    }

    if !preview_path.is_empty() {
        if let Ok(data) = std::fs::read(&preview_path) {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);
            let preview_ext = PathBuf::from(&preview_path);
            let ext = preview_ext
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png");
            let data_url = format!("data:image/{};base64,{}", ext, b64);

            let response = serde_json::json!({
                "type": "local-preview-url",
                "championId": champion_id.parse::<u64>().unwrap_or(0),
                "skinId": skin_id.parse::<u64>().unwrap_or(0),
                "chromaId": chroma_id,
                "url": format!("http://127.0.0.1:{}/preview/{}/{}/{}", ASSET_PORT, champion_id, skin_id, chroma_id),
                "dataUrl": data_url,
            });
            let _ = write
                .send(Message::Text(
                    serde_json::to_string(&response).unwrap().into(),
                ))
                .await;
        }
    }
}

async fn handle_local_asset(
    msg: &serde_json::Value,
    handle: &AppHandle,
    write: &mut (impl futures_util::Sink<Message> + Unpin),
) {
    let asset_path = msg
        .get("assetPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();

    if asset_path.is_empty() || asset_path.contains("..") {
        return;
    }

    let state = handle.state::<AppState>();
    let app_dir = state.app_data_dir.lock().await.clone();
    let mut candidates = vec![
        PathBuf::from(&app_dir)
            .join("downloaded-libraries")
            .join("LeagueSkins")
            .join(&asset_path),
        PathBuf::from(&app_dir).join("assets").join(&asset_path),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("assets")
            .join(&asset_path),
    ];

    if let Ok(resource_dir) = handle.path().resource_dir() {
        candidates.push(resource_dir.join("assets").join(&asset_path));
        candidates.push(resource_dir.join(&asset_path));
    }

    let full_path = candidates.into_iter().find(|candidate| candidate.exists());

    if let Some(full_path) = full_path {
        let data_url = std::fs::read(&full_path).ok().map(|data| {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);
            let mime = match full_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase()
                .as_str()
            {
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "gif" => "image/gif",
                _ => "image/png",
            };
            format!("data:{};base64,{}", mime, b64)
        });
        let encoded: String = asset_path
            .split('/')
            .map(|part| url::form_urlencoded::byte_serialize(part.as_bytes()).collect::<String>())
            .collect::<Vec<_>>()
            .join("/");
        let url = format!("http://127.0.0.1:{}/asset/{}", ASSET_PORT, encoded);

        let response = serde_json::json!({
            "type": "local-asset-url",
            "assetPath": asset_path,
            "chromaId": msg.get("chromaId").and_then(|v| v.as_u64()).unwrap_or(0),
            "url": data_url.unwrap_or(url),
        });
        let _ = write
            .send(Message::Text(
                serde_json::to_string(&response).unwrap().into(),
            ))
            .await;
    }
}
