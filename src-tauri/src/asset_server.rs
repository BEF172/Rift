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

    let response = handle_get(&path, &state).await;
    let _ = stream.write_all(&response).await;
}

fn parse_request_line(request: &str) -> Option<(&str, &str)> {
    let first_line = request.lines().next()?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?;
    let path = parts.next()?;
    Some((method, path))
}

async fn handle_get(path: &str, state: &Arc<AssetState>) -> Vec<u8> {
    let path = urlencoding(path);
    if path.starts_with("/preview/") {
        handle_preview(&path, state).await
    } else if path.starts_with("/asset/") {
        handle_asset(&path, state).await
    } else {
        not_found()
    }
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::parse(s.as_bytes())
        .map(|(k, v)| {
            if k.is_empty() {
                v.to_string()
            } else {
                format!("{}={}", k, v)
            }
        })
        .collect::<Vec<_>>()
        .join("&")
}

async fn handle_preview(path: &str, state: &Arc<AssetState>) -> Vec<u8> {
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

    let skin_ids = vec![
        skin_id.to_string(),
        format!("{}", skin_id.parse::<u64>().unwrap_or(0)),
    ];
    let chroma_ids = vec![
        chroma_id.to_string(),
        format!("{}", chroma_id.parse::<u64>().unwrap_or(0)),
    ];

    let extensions = [".png", ".jpg", ".jpeg", ".webp"];

    if chroma_id == skin_id {
        for s_id in &skin_ids {
            let dir = league_skins_dir.join(s_id);
            for ext in &extensions {
                let file = dir.join(format!("{}{}", s_id, ext));
                if file.exists() && is_path_inside(&allowed_root, &file) {
                    return serve_file(&file);
                }
            }
        }
    }

    // Try direct path first
    for s_id in &skin_ids {
        for c_id in &chroma_ids {
            let dir = league_skins_dir.join(s_id).join(c_id);
            for ext in &extensions {
                let file = dir.join(format!("{}{}", c_id, ext));
                if file.exists() && is_path_inside(&allowed_root, &file) {
                    return serve_file(&file);
                }
            }
        }
    }

    // Try skin dir directly
    for s_id in &skin_ids {
        let dir = league_skins_dir.join(s_id);
        if dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        for c_id in &chroma_ids {
                            for ext in &extensions {
                                let file = p.join(format!("{}{}", c_id, ext));
                                if file.exists() && is_path_inside(&allowed_root, &file) {
                                    return serve_file(&file);
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

async fn handle_asset(path: &str, state: &Arc<AssetState>) -> Vec<u8> {
    let relative = path.trim_start_matches("/asset/");

    if relative.is_empty() || relative.contains("..") || relative.contains(':') {
        return not_found();
    }

    let league_skins_root = PathBuf::from(&state.app_data_dir)
        .join("downloaded-libraries")
        .join("LeagueSkins");
    let candidates = vec![league_skins_root.join(relative)];

    for candidate in &candidates {
        if candidate.exists() && is_path_inside(&league_skins_root, candidate) {
            return serve_file(candidate);
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

fn serve_file(path: &PathBuf) -> Vec<u8> {
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
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: public, max-age=3600\r\n\r\n",
                mime,
                data.len()
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
