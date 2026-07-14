#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};

const ASSET_PORT: u16 = 45732;

pub struct AssetState {
    pub app_data_dir: String,
}

pub async fn start_asset_server(app_data_dir: String) {
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

    let state = Arc::new(AssetState { app_data_dir });

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
    let skin_id = parts[3];
    let chroma_id = parts[4];
    if !is_safe_id(champion_id) || !is_safe_id(skin_id) || !is_safe_id(chroma_id) {
        return not_found();
    }

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

    let skin_ids = vec![
        skin_id.to_string(),
        format!("{}", skin_id.parse::<u64>().unwrap_or(0)),
    ];
    let chroma_ids = vec![
        chroma_id.to_string(),
        format!("{}", chroma_id.parse::<u64>().unwrap_or(0)),
    ];

    let extensions = [".png", ".jpg", ".jpeg", ".webp"];

    // Search in all candidate directories
    let candidates = vec![
        (&league_skins_dir, Some(&allowed_root)),
        (&rose_skins_dir, None),
    ];

    for (base_dir, check_allowed) in &candidates {
        if chroma_id == skin_id {
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

    let rose_skins_root = std::env::var("LOCALAPPDATA")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_default()
        .join("Rose");

    let candidates = vec![
        (league_skins_root.join(relative), Some(&league_skins_root)),
        (rose_skins_root.join(relative), None),
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
