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
use base64::Engine;
use std::sync::Arc;
use tokio::sync::RwLock;

const DISCOVERY_START_PORT: u16 = 50000;
const DISCOVERY_END_PORT: u16 = 50010;
const ASSET_PORT: u16 = 45732;

/// Rose parity: form skin IDs that map to base skin IDs.
/// When resolving preview paths, form IDs must be mapped to their base skin ID
/// so files are found under the correct directory (e.g., skins/99/99007/99991/).
static FORM_SKIN_MAP: std::sync::LazyLock<std::collections::HashMap<u64, u64>> =
    std::sync::LazyLock::new(|| {
        let mut m = std::collections::HashMap::new();
        // Elementalist Lux (base 99007, forms 99991-99999)
        for id in 99991..=99999 { m.insert(id, 99007); }
        // Sahn Uzal Mordekaiser (base 82054, forms 82998-82999)
        m.insert(82998, 82054); m.insert(82999, 82054);
        // Spirit Blossom Morgana (base 25080, form 25999)
        m.insert(25999, 25080);
        // Radiant Sett (base 875066, forms 875998-875999)
        m.insert(875998, 875066); m.insert(875999, 875066);
        // K/DA Seraphine (base 147001, forms 147002-147003)
        m.insert(147002, 147001); m.insert(147003, 147001);
        // DJ Sona (base 37006, forms 37998-37999)
        m.insert(37998, 37006); m.insert(37999, 37006);
        // Arcane Fractured Jinx (base 222060, forms 222998-222999)
        m.insert(222998, 222060); m.insert(222999, 222060);
        // Risen Legend Kai'Sa (base 145070, form 145071)
        m.insert(145071, 145070);
        // Viego Broken Crown (base 234043, forms 234994-234999)
        for id in 234994..=234999 { m.insert(id, 234043); }
        // Gun Goddess Miss Fortune (base 21016, forms 21997-21999)
        m.insert(21997, 21016); m.insert(21998, 21016); m.insert(21999, 21016);
        // Immortalized Legend Kai'Sa (base 145070, HOL chroma 100001)
        m.insert(100001, 145070);
        // Immortalized Legend Ahri (base 103085, forms 103086-103087)
        m.insert(103086, 103085); m.insert(103087, 103085);
        // Ahri HOL chroma (base 103085, chroma 88888)
        m.insert(88888, 103085);
        m
    });

/// If `id` is a known form/chroma skin ID, return its base skin ID.
/// Otherwise return `id` unchanged.
fn resolve_form_to_base_skin_id(id: u64) -> u64 {
    FORM_SKIN_MAP.get(&id).copied().unwrap_or(id)
}

/// Rose-style LCU skin data cache: championId -> Vec of {id, name, chromas}
/// Populated lazily from the LCU API on first request per champion.
static LCU_SKIN_CACHE: std::sync::LazyLock<Arc<RwLock<std::collections::HashMap<u64, Vec<LcuSkinEntry>>>>> =
    std::sync::LazyLock::new(|| Arc::new(RwLock::new(std::collections::HashMap::new())));

#[derive(Clone, Debug)]
struct LcuSkinEntry {
    id: u64,
    name: String,
    #[allow(dead_code)]
    is_base: bool,
    has_chromas: bool,
}

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
    // Signal bridge ready (Rose-style PenguSkinMonitorThread ready_event)
    state.bridge_ready.store(true, std::sync::atomic::Ordering::SeqCst);
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

    // Rose-style: Re-activate Pengu Loader on LCU reconnect after account switch.
    // When the bridge reconnects, check if Pengu Loader is still active.
    // If not, try to re-activate it.
    let app_dir = handle
        .state::<crate::AppState>()
        .app_data_dir
        .lock()
        .await
        .clone();
    let loader_dir = std::path::PathBuf::from(&app_dir).join("Pengu Loader");
    if let Some(exec_path) = crate::commands::find_pengu_exe(&loader_dir) {
        let activation = crate::commands::get_pengu_loader_activation_status(&exec_path, &app_dir);
        if !activation.get("active").and_then(|v| v.as_bool()).unwrap_or(false) {
            eprintln!("[Bridge] Pengu Loader inactive after reconnect — re-activating...");
            let _ = crate::commands::run_pengu_loader_cli(&exec_path, &["--force-activate", "--silent"]);
        }
    }

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

    // Rose-style skin-sync may arrive without a "type" field (only {skin,...}).
    let is_rose_skin_sync = msg_type == "skin-sync" ||
        (msg_type == "unknown" && json.get("skin").is_some() && json.get("type").is_none());

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
        _ => {
            if is_rose_skin_sync {
                println!("[Pengu Skin] {}", &text[..text.len().min(500)]);
            }
        }
    }

    // Rose-style: update UI overlay state from plugin messages
    {
        let overlay = handle.state::<AppState>().ui_overlay.clone();
        let msg_type_eff = if is_rose_skin_sync { "skin-sync" } else { msg_type };
        match msg_type_eff {
            "skin-sync" => {
                if let Ok(mut w) = overlay.write() {
                    let old_skin_id = w.ui_skin_id;
                    if let Some(sid) = json.get("selectedSkinId").or_else(|| json.get("skinId")).and_then(|v| v.as_u64()) {
                        // Rose-style: reset chroma selection when switching to a different base skin
                        if let Some(old) = old_skin_id {
                            let old_u = old as u64;
                        let is_chroma_of_old = sid >= old_u && sid <= old_u + 100;
                        let is_old_chroma_of_new = old_u >= sid && old_u <= sid + 100;
                        if !is_chroma_of_old && !is_old_chroma_of_new && sid != old_u {
                                w.selected_chroma_id = None;
                                w.pending_chroma_selection = false;
                            }
                        }
                        w.ui_skin_id = Some(sid as i32);
                        w.last_hovered_skin_id = Some(sid as i32);
                    }
                    if let Some(sn) = json.get("skin").and_then(|v| v.as_str()) {
                        w.ui_skin_name = Some(sn.to_string());
                        w.last_hovered_skin_key = Some(sn.to_string());
                    }
                    if let Some(cid) = json.get("championId").or_else(|| json.get("champion_id")).and_then(|v| v.as_u64()) {
                        w.locked_champ_id = Some(cid as i32);
                    }
                }
            }
            "chroma-selection" => {
                let chroma_id_val;
                if let Ok(mut w) = overlay.write() {
                    let cid = json.get("chromaId").or_else(|| json.get("selectedChromaId")).or_else(|| json.get("skinId")).and_then(|v| v.as_u64());
                    chroma_id_val = cid;
                    if let Some(c) = cid {
                        w.selected_chroma_id = Some(c as i32);
                    }
                    w.pending_chroma_selection = true;
                } else {
                    chroma_id_val = None;
                }
                // Rose-style: broadcast chroma-state back to plugins
                let current_skin_id = overlay.read().ok().and_then(|o| o.ui_skin_id);
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                // Forward chromaColor/chromaColors from the incoming payload if present
                let chroma_color = json.get("chromaColor").cloned();
                let chroma_colors = json.get("chromaColors").cloned();
                let mut chroma_payload = serde_json::json!({
                    "type": "chroma-state",
                    "selectedChromaId": chroma_id_val,
                    "currentSkinId": current_skin_id,
                    "timestamp": ts,
                });
                if let Some(c) = chroma_color {
                    chroma_payload["chromaColor"] = c;
                }
                if let Some(c) = chroma_colors {
                    chroma_payload["chromaColors"] = c;
                }
                let _ = handle.emit("pengu:message", chroma_payload.clone());
                let app_state = handle.state::<AppState>();
                if let Ok(text) = serde_json::to_string(&chroma_payload) {
                    if let Some(tx) = app_state.pengu_bridge_tx.lock().await.as_ref() {
                        let _ = tx.send(text);
                    }
                }
            }
            "chroma-panel-opened" => {
                if let Ok(mut w) = overlay.write() {
                    w.chroma_panel_open = true;
                }
            }
            "chroma-panel-closed" => {
                if let Ok(mut w) = overlay.write() {
                    w.chroma_panel_open = false;
                }
            }
            "champion-locked" => {
                if let Ok(mut w) = overlay.write() {
                    w.own_champion_locked = true;
                    if let Some(cid) = json.get("championId").and_then(|v| v.as_u64()) {
                        w.locked_champ_id = Some(cid as i32);
                    }
                }
            }
            "champion-exchange" => {
                if let Ok(mut w) = overlay.write() {
                    w.champion_exchange_triggered = true;
                }
            }
            _ => {}
        }
    }

    // Forward ALL messages to frontend first (like Electron does), then handle specific types
    let mut forward_payload = json.clone();
    forward_payload["receivedAt"] = serde_json::json!(received_at);

    // Rose-style: inject championId from LCU overlay state into skin-sync payloads
    // that lack it. The 00-Core plugin sends {skin: "Name"} without championId;
    // without this, the renderer guesses champion from stale lastLockedChampionId.
    if is_rose_skin_sync && forward_payload.get("championId").is_none() && forward_payload.get("champion_id").is_none() {
        if let Ok(r) = handle.state::<AppState>().ui_overlay.read() {
            if let Some(cid) = r.locked_champ_id {
                if cid > 0 {
                    forward_payload["championId"] = serde_json::json!(cid as u64);
                }
            }
        }
    }

    let _ = handle.emit("pengu:message", forward_payload.clone());

    // Rose-style: generate and send skin-state back to the plugin immediately,
    // just like Rose's Python backend does. This avoids the round-trip through
    // renderer.js which has many early-return paths that can prevent skin-state.
    if is_rose_skin_sync {
        if let Some(skin_name) = json.get("skin").and_then(|v| v.as_str()) {
            let champion_id = json
                .get("championId")
                .or_else(|| json.get("champion_id"))
                .and_then(|v| v.as_u64())
                .or_else(|| {
                    handle
                        .state::<AppState>()
                        .ui_overlay
                        .read()
                        .ok()
                        .and_then(|o| o.locked_champ_id.map(|c| c as u64))
                })
                .unwrap_or(0);
            let skin_state = resolve_skin_state_from_cache(handle, skin_name, champion_id).await;
            // Send to the specific connection that sent the skin-sync
            let _ = write
                .send(Message::Text(
                    serde_json::to_string(&skin_state).unwrap().into(),
                ))
                .await;
            // Also emit as Tauri event so ALL connected plugins receive it
            // (Rose broadcasts to all WebSocket clients)
            let _ = handle.emit("pengu:message", skin_state);
        }
    }

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

// Rose-style: resolve skin name to structured skin-state using the skin library cache.
// This mirrors Rose's Python backend which resolves skin name → skinId via skin_scraper.

/// Rose-style: fetch champion skin data from LCU API.
/// Queries `/lol-game-data/assets/v1/champions/{champion_id}.json` (same as Rose's SkinScraper).
/// Returns Vec of skin entries with id, name, is_base, has_chromas.
async fn fetch_lcu_skins_for_champion(champion_id: u64) -> Option<Vec<LcuSkinEntry>> {
    // Check cache first
    {
        let cache = LCU_SKIN_CACHE.read().await;
        if let Some(entries) = cache.get(&champion_id) {
            eprintln!("[Bridge] LCU skin cache hit for champion {}", champion_id);
            return Some(entries.clone());
        }
    }

    // Query LCU API
    let lockfile = match crate::gameflow::read_lockfile() {
        Some(lf) => lf,
        None => {
            eprintln!("[Bridge] LCU lockfile not found, cannot resolve skins for champion {}", champion_id);
            return None;
        }
    };
    let auth = base64::engine::general_purpose::STANDARD
        .encode(format!("riot:{}", lockfile.password));
    let url = format!(
        "{}://127.0.0.1:{}/lol-game-data/assets/v1/champions/{}.json",
        lockfile.protocol, lockfile.port, champion_id
    );

    eprintln!("[Bridge] LCU skin query: {}", url);

    let client = match reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(3))
        .build() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[Bridge] Failed to build HTTP client: {}", e);
                return None;
            }
        };

    let response = match client
        .get(&url)
        .header("Authorization", format!("Basic {}", auth))
        .send()
        .await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[Bridge] LCU HTTP request failed for champion {}: {}", champion_id, e);
                return None;
            }
        };

    let response = match response.error_for_status() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[Bridge] LCU returned error for champion {}: {}", champion_id, e);
                return None;
            }
        };

    let json_val = match response.json::<serde_json::Value>().await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[Bridge] Failed to parse LCU JSON for champion {}: {}", champion_id, e);
                return None;
            }
        };

    let skins_array = match json_val.get("skins").and_then(|v| v.as_array()) {
            Some(a) => a,
            None => {
                eprintln!("[Bridge] LCU response missing 'skins' array for champion {}: {:?}", champion_id, json_val);
                return None;
            }
        };

    let entries: Vec<LcuSkinEntry> = skins_array
        .iter()
        .filter_map(|s| {
            let id = s.get("id").and_then(|v| v.as_u64())?;
            let name = s.get("name").and_then(|v| v.as_str())?.to_string();
            let is_base = s.get("isBase").and_then(|v| v.as_bool()).unwrap_or(false);
            let has_chromas = s
                .get("chromas")
                .and_then(|v| v.as_array())
                .map(|a| !a.is_empty())
                .unwrap_or(false);
            Some(LcuSkinEntry {
                id,
                name,
                is_base,
                has_chromas,
            })
        })
        .collect();

    eprintln!("[Bridge] LCU skins for champion {}: {} entries found", champion_id, entries.len());
    for entry in &entries {
        eprintln!("[Bridge]   skin id={} name='{}' is_base={} chromas={}", entry.id, entry.name, entry.is_base, entry.has_chromas);
    }

    if !entries.is_empty() {
        let mut cache = LCU_SKIN_CACHE.write().await;
        cache.insert(champion_id, entries.clone());
        Some(entries)
    } else {
        None
    }
}

/// Rose-style: resolve skin name to skinId using LCU API data.
/// First tries exact match, then fuzzy match (like Rose's Levenshtein).
fn resolve_skin_id_from_lcu(entries: &[LcuSkinEntry], skin_name: &str) -> Option<(u64, bool)> {
    let normalized = skin_name.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    // 1. Exact match (case-insensitive)
    for entry in entries {
        if entry.name.to_lowercase() == normalized {
            return Some((entry.id, entry.has_chromas));
        }
    }

    // 2. Substring match: "Rex Mortis" matches "Viego Rex Mortis" or vice versa
    for entry in entries {
        let entry_lower = entry.name.to_lowercase();
        if entry_lower.contains(&normalized) || normalized.contains(&entry_lower) {
            return Some((entry.id, entry.has_chromas));
        }
    }

    // 3. Fuzzy match: find the entry with smallest edit distance
    let mut best_distance = usize::MAX;
    let mut best_entry: Option<&LcuSkinEntry> = None;
    for entry in entries {
        let d = levenshtein_distance(&normalized, &entry.name.to_lowercase());
        if d < best_distance {
            best_distance = d;
            best_entry = Some(entry);
        }
    }
    if let Some(entry) = best_entry {
        let max_len = normalized.len().max(entry.name.len());
        if max_len > 0 && best_distance * 100 / max_len < 40 {
            // Within 40% similarity threshold
            return Some((entry.id, entry.has_chromas));
        }
    }

    None
}

/// Simple Levenshtein distance (same as Rose's normalization.py)
fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let a_len = a_chars.len();
    let b_len = b_chars.len();
    let mut dp = vec![vec![0usize; b_len + 1]; a_len + 1];
    for i in 0..=a_len {
        dp[i][0] = i;
    }
    for j in 0..=b_len {
        dp[0][j] = j;
    }
    for i in 1..=a_len {
        for j in 1..=b_len {
            let cost = if a_chars[i - 1] == b_chars[j - 1] {
                0
            } else {
                1
            };
            dp[i][j] = (dp[i - 1][j] + 1)
                .min(dp[i][j - 1] + 1)
                .min(dp[i - 1][j - 1] + cost);
        }
    }
    dp[a_len][b_len]
}

/// Rose-style: get owned status for a skin ID.
/// Returns "owned", "unowned", or "unknown" based on AppState.
async fn get_owned_status(state: &AppState, skin_id: u64, _champion_id: u64) -> String {
    if skin_id == 0 {
        return "unknown".to_string();
    }
    if crate::gameflow::is_default_skin(skin_id) {
        return "owned".to_string();
    }
    let ready = state.owned_skins_ready.load(std::sync::atomic::Ordering::SeqCst);
    if !ready {
        return "unknown".to_string();
    }
    if let Ok(set) = state.owned_skin_ids.read() {
        match crate::gameflow::is_skin_owned(&set, skin_id) {
            Some(true) => "owned".to_string(),
            Some(false) => "unowned".to_string(),
            None => "unknown".to_string(),
        }
    } else {
        "unknown".to_string()
    }
}

async fn resolve_skin_state_from_cache(
    handle: &AppHandle,
    skin_name: &str,
    champion_id: u64,
) -> serde_json::Value {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let state = handle.state::<AppState>();
    let app_dir = state.app_data_dir.lock().await.clone();
    if app_dir.is_empty() {
        return serde_json::json!({
            "type": "skin-state",
            "source": "rift-atlas-bridge",
            "skinName": skin_name,
            "skinId": 0,
            "championId": champion_id,
            "hasChromas": false,
            "isOwned": {
                "status": get_owned_status(&state, 0, champion_id).await,
                "ready": state.owned_skins_ready.load(std::sync::atomic::Ordering::SeqCst),
            },
            "timestamp": now_ms,
        });
    }
    let cache_path = PathBuf::from(&app_dir)
        .join("cache")
        .join("skin-library-index.json");

    let content = match std::fs::read_to_string(&cache_path) {
        Ok(c) => c,
        Err(_) => {
            return serde_json::json!({
                "type": "skin-state",
                "source": "rift-atlas-bridge",
                "skinName": skin_name,
                "skinId": 0,
                "championId": champion_id,
                "hasChromas": false,
                "isOwned": {
                    "status": get_owned_status(&state, 0, champion_id).await,
                    "ready": state.owned_skins_ready.load(std::sync::atomic::Ordering::SeqCst),
                },
                "timestamp": now_ms,
            });
        }
    };

    let payload: serde_json::Value = match serde_json::from_str(&content) {
        Ok(p) => p,
        Err(_) => {
            return serde_json::json!({
                "type": "skin-state",
                "source": "rift-atlas-bridge",
                "skinName": skin_name,
                "skinId": 0,
                "championId": champion_id,
                "hasChromas": false,
                "isOwned": {
                    "status": get_owned_status(&state, 0, champion_id).await,
                    "ready": state.owned_skins_ready.load(std::sync::atomic::Ordering::SeqCst),
                },
                "timestamp": now_ms,
            });
        }
    };

    let all_skins = payload
        .get("skins")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if all_skins.is_empty() {
        return serde_json::json!({
            "type": "skin-state",
            "source": "rift-atlas-bridge",
            "skinName": skin_name,
            "skinId": 0,
            "championId": champion_id,
            "hasChromas": false,
            "isOwned": {
                "status": get_owned_status(&state, 0, champion_id).await,
                "ready": state.owned_skins_ready.load(std::sync::atomic::Ordering::SeqCst),
            },
            "timestamp": now_ms,
        });
    }

    let normalized_input = skin_name.to_lowercase();

    // Find matching skin entries by name (case-insensitive), scoped by champion
    // when champion_id is known to prevent cross-champion name collisions
    let matching_entries: Vec<&serde_json::Value> = all_skins
        .iter()
        .filter(|s| {
            let entry_name = s
                .get("skin")
                .or_else(|| s.get("variant"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let entry_display = s
                .get("display")
                .or_else(|| s.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let name_matches = entry_name.to_lowercase() == normalized_input
                || entry_display.to_lowercase() == normalized_input;
            if !name_matches {
                return false;
            }
            // Champion-scoped: if we know the champion, skip entries for other champions
            if champion_id > 0 {
                let entry_champ = s.get("championId")
                    .or_else(|| s.get("championKey"))
                    .or_else(|| s.get("rawChampion"))
                    .and_then(json_to_u64)
                    .unwrap_or(0);
                if entry_champ > 0 && entry_champ != champion_id {
                    return false;
                }
            }
            true
        })
        .collect();

    if matching_entries.is_empty() {
        eprintln!("[Bridge] Skin name '{}' not found in cache (champion={}), trying LCU fallback", skin_name, champion_id);
        // Rose-style: cache didn't have a name match — try LCU API fallback
        // This mirrors Rose's SkinScraper which queries /lol-game-data/assets/v1/champions/{id}.json
        if champion_id > 0 {
            if let Some(lcu_entries) = fetch_lcu_skins_for_champion(champion_id).await {
                if let Some((skin_id, _lcu_has_chromas)) =
                    resolve_skin_id_from_lcu(&lcu_entries, skin_name)
                {
                    // Rose-style: also check the skin library cache for child entries
                    // (forms like Viego Rex Mortis have child skins 234994-234999 that
                    // the LCU doesn't report as chromas). If the cache has multiple entries
                    // sharing the same base ID, mark hasChromas=true.
                    let cache_has_children = all_skins.iter().any(|s| {
                        let s_champ = s.get("championId")
                            .and_then(json_to_u64)
                            .unwrap_or(0);
                        let s_skin = s.get("rawSkin")
                            .or_else(|| s.get("baseSkinId"))
                            .or_else(|| s.get("fileBaseId"))
                            .or_else(|| s.get("imageSkinNum"))
                            .or_else(|| s.get("variantId"))
                            .or_else(|| s.get("rawVariant"))
                            .and_then(json_to_u64)
                            .unwrap_or(0);
                        s_champ == champion_id && s_skin != skin_id && s_skin > 0
                    });
                    let has_chromas = _lcu_has_chromas || cache_has_children;
                    eprintln!("[Bridge] LCU resolved '{}' -> skinId={} hasChromas={} (lcu={} cache_children={})", skin_name, skin_id, has_chromas, _lcu_has_chromas, cache_has_children);
                    return serde_json::json!({
                        "type": "skin-state",
                        "source": "rift-atlas-bridge",
                        "skinName": skin_name,
                        "skinId": skin_id,
                        "championId": champion_id,
                        "hasChromas": has_chromas,
                        "isOwned": {
                            "status": get_owned_status(&state, skin_id, champion_id).await,
                            "ready": state.owned_skins_ready.load(std::sync::atomic::Ordering::SeqCst),
                        },
                        "timestamp": now_ms,
                    });
                }
            }
        }
        eprintln!("[Bridge] FAILED to resolve '{}' -> skinId=0 (champion={})", skin_name, champion_id);
        return serde_json::json!({
            "type": "skin-state",
            "source": "rift-atlas-bridge",
            "skinName": skin_name,
            "skinId": 0,
            "championId": champion_id,
            "hasChromas": false,
            "isOwned": {
                "status": get_owned_status(&state, 0, champion_id).await,
                "ready": state.owned_skins_ready.load(std::sync::atomic::Ordering::SeqCst),
            },
            "timestamp": now_ms,
        });
    }

    // Use first match as the primary skin
    let primary = matching_entries[0];
    let resolved_champion_id = if champion_id > 0 {
        champion_id
    } else {
        primary
            .get("championId")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
    };

    let skin_id = get_entry_variant_id(primary, resolved_champion_id);

    // Check hasChromas: if there are multiple entries with the same base ID but different
    // variant IDs, the skin has chromas
    let has_chromas = if resolved_champion_id > 0 && skin_id > 0 {
        let base_id = get_entry_base_id(primary, resolved_champion_id);
        all_skins
            .iter()
            .any(|s| {
                let s_base = get_entry_base_id(s, resolved_champion_id);
                let s_variant = get_entry_variant_id(s, resolved_champion_id);
                s_base == base_id && s_variant != base_id && s_variant > 0
            })
    } else {
        false
    };

    serde_json::json!({
        "type": "skin-state",
        "source": "rift-atlas-bridge",
        "skinName": skin_name,
        "skinId": skin_id,
        "championId": resolved_champion_id,
        "hasChromas": has_chromas,
        "isOwned": {
            "status": get_owned_status(&state, skin_id, resolved_champion_id).await,
            "ready": state.owned_skins_ready.load(std::sync::atomic::Ordering::SeqCst),
        },
        "timestamp": now_ms,
    })
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
        .and_then(|v| v.as_str())
        .or_else(|| msg.get("championId").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .or_else(|| msg.get("championId").and_then(|v| v.as_u64()).map(|n| n.to_string()))
        .unwrap_or_default();
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
            // Match championId as string (e.g. "123")
            s.get("championId").and_then(|v| v.as_str()).unwrap_or("") == champion_key
                // Match championId as number (e.g. 123)
                || s.get("championId").and_then(json_to_u64).map(|n| n.to_string()).unwrap_or_default() == champion_key
                // Match championKey as string
                || s.get("championKey").and_then(|v| v.as_str()).unwrap_or("") == champion_key
                // Match rawChampion as string
                || s.get("rawChampion").and_then(|v| v.as_str()).unwrap_or("") == champion_key
                // Match rawChampion as number
                || s.get("rawChampion").and_then(json_to_u64).map(|n| n.to_string()).unwrap_or_default() == champion_key
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
        // Always respond so plugins can clean up pending state
        let response = serde_json::json!({
            "type": "local-preview-url",
            "championId": champion_id.parse::<u64>().unwrap_or(0),
            "skinId": skin_id.parse::<u64>().unwrap_or(0),
            "chromaId": chroma_id,
            "url": "",
            "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
        });
        let _ = write
            .send(Message::Text(
                serde_json::to_string(&response).unwrap().into(),
            ))
            .await;
        return;
    }

    let state = _handle.state::<AppState>();
    let app_dir = state.app_data_dir.lock().await.clone();

    // Rose parity: resolve form skin IDs back to base skin IDs for file search.
    // Form skins (e.g., Elementalist Lux 99991) store files under the base skin
    // directory (99007/99991/), not under the form ID directory.
    let chroma_num = chroma_id;
    let resolved_skin_id = resolve_form_to_base_skin_id(skin_id.parse::<u64>().unwrap_or(0));
    let resolved_chroma_id = resolve_form_to_base_skin_id(chroma_num);

    // Use the resolved base skin ID for directory search if it differs from the original
    let effective_skin_id = if resolved_skin_id != skin_id.parse::<u64>().unwrap_or(0) {
        resolved_skin_id.to_string()
    } else {
        skin_id.clone()
    };

    // Rift Atlas LeagueSkins directory
    let league_skins_dir = PathBuf::from(&app_dir)
        .join("downloaded-libraries")
        .join("LeagueSkins")
        .join("skins")
        .join(&champion_id);

    let skin_dirs = if league_skins_dir.exists() {
        vec![league_skins_dir.clone()]
    } else {
        vec![league_skins_dir.clone()]
    };

    let extensions = [".png", ".jpg", ".jpeg", ".webp"];
    let chroma_str = chroma_id.to_string();
    let effective_chroma_str = resolved_chroma_id.to_string();
    let mut full_path: Option<PathBuf> = None;

    // Rose parity: also search under the resolved base skin ID directory.
    // Form skins store files under the base skin directory, not the form ID directory.
    let search_skin_ids: Vec<&str> = if effective_skin_id != skin_id {
        vec![&effective_skin_id, &skin_id]
    } else {
        vec![&skin_id]
    };

    // Search for preview image in multiple locations across all candidate dirs
    for base_dir in &skin_dirs {
        for s_id in &search_skin_ids {
            if full_path.is_some() { break; }

            // 1. Try base skin path: skins/{championId}/{skinId}/{skinId}.png
            if chroma_str == *s_id {
                let dir = base_dir.join(s_id);
                for ext in &extensions {
                    let file = dir.join(format!("{}{}", s_id, ext));
                    if file.exists() {
                        full_path = Some(file);
                        break;
                    }
                }
            }

            // 2. Try direct file in skin directory: skins/{championId}/{skinId}/{chromaId}.png
            if full_path.is_none() {
                let dir = base_dir.join(s_id);
                for ext in &extensions {
                    let file = dir.join(format!("{}{}", chroma_str, ext));
                    if file.exists() {
                        full_path = Some(file);
                        break;
                    }
                }
            }

            // 3. Try chroma subfolder: skins/{championId}/{skinId}/{chromaId}/{chromaId}.png
            if full_path.is_none() {
                for c_id in [&chroma_str, &effective_chroma_str] {
                    let dir = base_dir.join(s_id).join(c_id);
                    for ext in &extensions {
                        let file = dir.join(format!("{}{}", c_id, ext));
                        if file.exists() {
                            full_path = Some(file);
                            break;
                        }
                    }
                    if full_path.is_some() { break; }
                }
            }
        }

        if full_path.is_some() {
            break;
        }
    }

    if let Some(ref path) = full_path {
        if path.exists() {
            // Rose parity: always use .png in the preview URL regardless of actual file extension.
            // Use the resolved base skin ID in the URL so the HTTP handler finds the correct file.
            let url_skin_id = resolved_skin_id;
            let response = serde_json::json!({
                "type": "local-preview-url",
                "championId": champion_id.parse::<u64>().unwrap_or(0),
                "skinId": url_skin_id,
                "chromaId": chroma_id,
                "url": format!("http://localhost:{}/preview/{}/{}/{}/{}.png", ASSET_PORT, champion_id, url_skin_id, chroma_id, chroma_id),
                "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
            });
            let _ = write
                .send(Message::Text(
                    serde_json::to_string(&response).unwrap().into(),
                ))
                .await;
            return;
        }
    }

    // Always send a response, even when file not found — so plugins can clean up pending state
    let response = serde_json::json!({
        "type": "local-preview-url",
        "championId": champion_id.parse::<u64>().unwrap_or(0),
        "skinId": skin_id.parse::<u64>().unwrap_or(0),
        "chromaId": chroma_id,
        "url": "",
        "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
    });
    let _ = write
        .send(Message::Text(
            serde_json::to_string(&response).unwrap().into(),
        ))
        .await;
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
        let response = serde_json::json!({
            "type": "local-asset-url",
            "assetPath": asset_path,
            "chromaId": msg.get("chromaId").and_then(|v| v.as_u64()).unwrap_or(0),
            "url": "",
            "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
        });
        let _ = write
            .send(Message::Text(
                serde_json::to_string(&response).unwrap().into(),
            ))
            .await;
        return;
    }

    let state = handle.state::<AppState>();
    let app_dir = state.app_data_dir.lock().await.clone();
    let mut candidates = vec![
        PathBuf::from(&app_dir)
            .join("downloaded-libraries")
            .join("LeagueSkins")
            .join(&asset_path),
    ];

    if let Ok(resource_dir) = handle.path().resource_dir() {
        candidates.push(resource_dir.join("assets").join(&asset_path));
    }

    if let Ok(resource_dir) = handle.path().resource_dir() {
        candidates.push(resource_dir.join(&asset_path));
    }

    let full_path = candidates.into_iter().find(|candidate| candidate.exists());

    if let Some(_full_path) = full_path {
        let encoded: String = asset_path
            .split('/')
            .map(|part| url::form_urlencoded::byte_serialize(part.as_bytes()).collect::<String>())
            .collect::<Vec<_>>()
            .join("/");

        // Rose parity: use localhost, send HTTP URL (not base64), add timestamp
        let url = format!("http://localhost:{}/asset/{}", ASSET_PORT, encoded);

        let response = serde_json::json!({
            "type": "local-asset-url",
            "assetPath": asset_path,
            "chromaId": msg.get("chromaId").and_then(|v| v.as_u64()).unwrap_or(0),
            "url": url,
            "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
        });
        let _ = write
            .send(Message::Text(
                serde_json::to_string(&response).unwrap().into(),
            ))
            .await;
        return;
    }

    // Always send a response, even when file not found — so plugins can clean up pending state
    let response = serde_json::json!({
        "type": "local-asset-url",
        "assetPath": asset_path,
        "chromaId": msg.get("chromaId").and_then(|v| v.as_u64()).unwrap_or(0),
        "url": "",
        "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
    });
    let _ = write
        .send(Message::Text(
            serde_json::to_string(&response).unwrap().into(),
        ))
        .await;
}
