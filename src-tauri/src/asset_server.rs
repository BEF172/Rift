#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};

const ASSET_PORT: u16 = 45732;

/// Rose parity: form skin IDs that map to base skin IDs.
static FORM_SKIN_MAP: std::sync::LazyLock<std::collections::HashMap<u64, u64>> =
    std::sync::LazyLock::new(|| {
        let mut m = std::collections::HashMap::new();
        for id in 99991..=99999 { m.insert(id, 99007); }
        m.insert(82998, 82054); m.insert(82999, 82054);
        m.insert(25999, 25080);
        m.insert(875998, 875066); m.insert(875999, 875066);
        m.insert(147002, 147001); m.insert(147003, 147001);
        m.insert(37998, 37006); m.insert(37999, 37006);
        m.insert(222998, 222060); m.insert(222999, 222060);
        m.insert(145071, 145070);
        for id in 234994..=234999 { m.insert(id, 234043); }
        m.insert(21997, 21016); m.insert(21998, 21016); m.insert(21999, 21016);
        m.insert(100001, 145070);
        m.insert(103086, 103085); m.insert(103087, 103085);
        m.insert(88888, 103085);
        m
    });

fn resolve_form_to_base_skin_id(id: u64) -> u64 {
    FORM_SKIN_MAP.get(&id).copied().unwrap_or(id)
}

pub struct AssetState {
    pub app_data_dir: String,
    pub source_tree_dir: String,
    pub resource_dir: String,
}

pub async fn start_asset_server(app_data_dir: String, source_tree_dir: String, resource_dir: String) {
    let addr = format!("127.0.0.1:{}", ASSET_PORT);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => {
            println!("[AssetServer] escuchando en http://{}", addr);
            l
        }
        Err(e) => {
            eprintln!("[AssetServer] Error binding: {}", e);
            return;
        }
    };

    let state = Arc::new(AssetState { app_data_dir, source_tree_dir, resource_dir });

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let state = state.clone();
                tokio::spawn(async move {
                    handle_connection(stream, state).await;
                });
            }
            Err(e) => {
                eprintln!("[AssetServer] Accept error: {}", e);
            }
        }
    }
}

async fn handle_connection(mut stream: TcpStream, state: Arc<AssetState>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let request = String::from_utf8_lossy(&buf[..n]);
    let (_method, path) = match parse_request_line(&request) {
        Some((m, p)) if m == "GET" => (m.to_string(), p.to_string()),
        _ => {
            let _ = stream
                .write_all(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
                .await;
            return;
        }
    };

    // Extract Origin header for CORS (Rose parity: loopback-only)
    let origin = request.lines()
        .find(|l| l.to_lowercase().starts_with("origin:"))
        .and_then(|l| l.splitn(2, ':').nth(1))
        .map(|v| v.trim().to_string());

    let response = handle_get(&path, &state, origin.as_deref()).await;
    let _ = stream.write_all(&response).await;
}

fn parse_request_line(request: &str) -> Option<(&str, &str)> {
    let first_line = request.lines().next()?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?;
    let path = parts.next()?;
    Some((method, path))
}

async fn handle_get(path: &str, state: &Arc<AssetState>, origin: Option<&str>) -> Vec<u8> {
    let path = urldecode(path);
    if path.starts_with("/preview/") {
        handle_preview(&path, state, origin).await
    } else if path.starts_with("/asset/") {
        handle_asset(&path, state, origin).await
    } else {
        not_found()
    }
}

fn urldecode(s: &str) -> String {
    let path = s.split('?').next().unwrap_or(s);
    let bytes = path.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = hex_val(bytes[i + 1]);
                let lo = hex_val(bytes[i + 2]);
                if let (Some(h), Some(l)) = (hi, lo) {
                    result.push(h * 16 + l);
                    i += 3;
                    continue;
                }
                result.push(bytes[i]);
                i += 1;
            }
            b => {
                result.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(result).unwrap_or_else(|_| path.to_string())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

async fn handle_preview(path: &str, state: &Arc<AssetState>, origin: Option<&str>) -> Vec<u8> {
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() < 5 {
        return not_found();
    }
    let champion_id = parts[2];
    let skin_id_raw = parts[3];
    let chroma_id_raw = parts[4];
    if !is_safe_id(champion_id) || !is_safe_id(skin_id_raw) || !is_safe_id(chroma_id_raw) {
        return not_found();
    }

    // Rose parity: resolve form skin IDs to base skin IDs for file search
    let skin_id_num = skin_id_raw.parse::<u64>().unwrap_or(0);
    let chroma_id_num = chroma_id_raw.parse::<u64>().unwrap_or(0);
    let resolved_skin_id = resolve_form_to_base_skin_id(skin_id_num);
    let resolved_chroma_id = resolve_form_to_base_skin_id(chroma_id_num);

    // Build search IDs: try resolved base skin ID first, then original
    let skin_ids: Vec<String> = if resolved_skin_id != skin_id_num {
        vec![resolved_skin_id.to_string(), skin_id_raw.to_string()]
    } else {
        vec![skin_id_raw.to_string()]
    };
    let chroma_ids: Vec<String> = if resolved_chroma_id != chroma_id_num {
        vec![resolved_chroma_id.to_string(), chroma_id_raw.to_string()]
    } else {
        vec![chroma_id_raw.to_string()]
    };

    let league_skins_dir = PathBuf::from(&state.app_data_dir)
        .join("downloaded-libraries")
        .join("LeagueSkins")
        .join("skins")
        .join(champion_id);
    let allowed_root = PathBuf::from(&state.app_data_dir)
        .join("downloaded-libraries")
        .join("LeagueSkins")
        .join("skins");

    // Fallback: Rose LOCALAPPDATA skins directory
    let rose_skins_dir = std::env::var("LOCALAPPDATA")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_default()
        .join("Rose")
        .join("skins")
        .join(champion_id);

    let extensions = [".png", ".jpg", ".jpeg", ".webp"];

    // Search in all candidate directories
    let candidates = vec![
        (&league_skins_dir, Some(&allowed_root)),
        (&rose_skins_dir, None),
    ];

    for (base_dir, check_allowed) in &candidates {
        if chroma_id_raw == skin_id_raw {
            for s_id in &skin_ids {
                let dir = base_dir.join(s_id);
                for ext in &extensions {
                    let file = dir.join(format!("{}{}", s_id, ext));
                    if file.exists() {
                        if let Some(root) = check_allowed {
                            if is_path_inside(root, &file) {
                                return serve_file(&file, origin);
                            }
                        } else {
                            return serve_file(&file, origin);
                        }
                    }
                }
            }
        }

        // Try direct path first
        for s_id in &skin_ids {
            for c_id in &chroma_ids {
                let dir = base_dir.join(s_id).join(c_id);
                for ext in &extensions {
                    let file = dir.join(format!("{}{}", c_id, ext));
                    if file.exists() {
                        if let Some(root) = check_allowed {
                            if is_path_inside(root, &file) {
                                return serve_file(&file, origin);
                            }
                        } else {
                            return serve_file(&file, origin);
                        }
                    }
                }
            }
        }

        // Try skin dir directly
        for s_id in &skin_ids {
            let dir = base_dir.join(s_id);
            if dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() {
                            for c_id in &chroma_ids {
                                for ext in &extensions {
                                    let file = p.join(format!("{}{}", c_id, ext));
                                    if file.exists() {
                                        if let Some(root) = check_allowed {
                                            if is_path_inside(root, &file) {
                                                return serve_file(&file, origin);
                                            }
                                        } else {
                                            return serve_file(&file, origin);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    not_found()
}

async fn handle_asset(path: &str, state: &Arc<AssetState>, origin: Option<&str>) -> Vec<u8> {
    let relative = match path.strip_prefix("/asset/") {
        Some(r) => r,
        None => return not_found(),
    };

    if relative.is_empty() || relative.contains("..") || relative.contains(':') {
        return not_found();
    }

    let league_skins_root = PathBuf::from(&state.app_data_dir)
        .join("downloaded-libraries")
        .join("LeagueSkins");

    // Source tree assets (dev builds): {project_root}/assets/
    let source_tree_assets = PathBuf::from(&state.source_tree_dir)
        .join("assets");

    // App data assets: {app_data}/assets/
    let app_data_assets = PathBuf::from(&state.app_data_dir)
        .join("assets");

    // Resource dir assets (installed builds): {install_dir}/assets/
    let resource_assets = PathBuf::from(&state.resource_dir)
        .join("assets");

    let candidates = vec![
        (league_skins_root.join(relative), Some(&league_skins_root)),
        (resource_assets.join(relative), None),
        (app_data_assets.join(relative), None),
        (source_tree_assets.join(relative), None),
    ];

    for (candidate, check_allowed) in &candidates {
        if candidate.exists() {
            if let Some(root) = check_allowed {
                if is_path_inside(root, candidate) {
                    return serve_file(candidate, origin);
                }
            } else {
                return serve_file(candidate, origin);
            }
        }
    }

    not_found()
}

fn is_safe_id(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_path_inside(base: &Path, target: &Path) -> bool {
    let base = match base.canonicalize() {
        Ok(path) => path,
        Err(_) => return false,
    };
    let target = match target.canonicalize() {
        Ok(path) => path,
        Err(_) => return false,
    };
    target.starts_with(base)
}

fn serve_file(path: &PathBuf, origin: Option<&str>) -> Vec<u8> {
    match std::fs::read(path) {
        Ok(data) => {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let mime = match ext.to_lowercase().as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "gif" => "image/gif",
                _ => "application/octet-stream",
            };
            // Rose parity: only allow loopback origins, reflect the Origin header
            let cors = match origin {
                Some(o) if o.starts_with("http://localhost")
                    || o.starts_with("http://127.0.0.1")
                    || o.starts_with("http://[::1]") => {
                    format!("Access-Control-Allow-Origin: {}\r\nVary: Origin", o)
                }
                _ => "Access-Control-Allow-Origin: null".to_string(),
            };
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\n{}\r\nCache-Control: public, max-age=3600\r\n\r\n",
                mime,
                data.len(),
                cors,
            );
            let mut response = headers.into_bytes();
            response.extend_from_slice(&data);
            response
        }
        Err(_) => not_found(),
    }
}

fn not_found() -> Vec<u8> {
    b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nContent-Type: text/plain\r\n\r\nNot Found"
        .to_vec()
}
