use crate::{commands, overlay, AppState};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Rose-style champion lock tracking (cellId -> championId)
static LAST_LOCKS: Mutex<Option<HashMap<u64, u64>>> = Mutex::new(None);
static LOCAL_CELL_ID: Mutex<Option<u64>> = Mutex::new(None);

// =============================================================================
// LCU Monitor — Rose-style direct WAMP WebSocket connection + health monitor
//
// Matches Rose's:
//   - WebSocketConnection (threads/websocket/websocket_connection.py)
//   - WebSocketEventHandler (threads/websocket/websocket_event_handler.py)
//   - LCUMonitorThread (threads/core/lcu_monitor_thread.py)
// =============================================================================

const WS_RECONNECT_DELAY_S: f64 = 1.0;
const LANGUAGE_RETRY_INTERVAL_S: f64 = 2.0;
const LANGUAGE_MAX_RETRIES: u32 = 5;
const LANGUAGE_CHECK_INTERVAL_S: f64 = 30.0;
const PHASE_POLL_INTERVAL_MS: u64 = 500;
const PHASE_POLL_INGAME_INTERVAL_MS: u64 = 2000;

#[derive(Clone)]
struct Lockfile {
    port: u16,
    password: String,
    protocol: String,
}

fn find_lockfile() -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("LCU_LOCKFILE") {
        candidates.push(std::path::PathBuf::from(path));
    }
    candidates.extend([
        std::path::PathBuf::from(r"C:\Riot Games\League of Legends\lockfile"),
        std::path::PathBuf::from(r"D:\Riot Games\League of Legends\lockfile"),
    ]);
    for variable in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Some(root) = std::env::var_os(variable) {
            candidates.push(
                std::path::PathBuf::from(root)
                    .join("Riot Games")
                    .join("League of Legends")
                    .join("lockfile"),
            );
        }
    }
    for process_name in ["LeagueClientUx.exe", "LeagueClient.exe"] {
        if let Some(directory) = overlay::find_process_exe_path(process_name) {
            candidates.push(std::path::PathBuf::from(directory).join("lockfile"));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn read_lockfile() -> Option<Lockfile> {
    let content = std::fs::read_to_string(find_lockfile()?).ok()?;
    let parts: Vec<&str> = content.trim().splitn(5, ':').collect();
    if parts.len() != 5 {
        return None;
    }
    Some(Lockfile {
        port: parts[2].parse().ok()?,
        password: parts[3].to_string(),
        protocol: parts[4].to_string(),
    })
}

/// Start the LCU monitor — WAMP WebSocket + health monitoring (Rose-style)
pub async fn start(handle: AppHandle) {
    let mut last_lcu_ok = false;
    let mut ws_connected = false;
    let mut waiting_for_connection = false;
    let mut initial_ws_done = false;
    let mut lcu_reconnected = false;
    let mut language_initialized = false;
    let mut last_language_check = Instant::now();
    let mut last_swiftplay_check = Instant::now();
    let mut language_retry_count = 0;
    let mut current_language: Option<String> = None;
    let mut _last_lockfile: Option<Lockfile> = None;
    let mut ws_task: Option<tokio::task::JoinHandle<()>> = None;
    let ws_cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));

    loop {
        let lockfile = read_lockfile();
        let lcu_ok = lockfile.is_some();

        // Phase polling (Rose-style fallback, like PhaseThread)
        if let Some(ref lf) = lockfile {
            let state = handle.state::<AppState>();
            let phase = read_phase_http(lf).await;
            if let Some(ph) = phase {
                let prev = state.current_gameflow_phase.lock().await.clone();
                if ph != prev {
                    *state.current_gameflow_phase.lock().await = ph.clone();
                    broadcast_phase(&handle, &ph, &prev).await;
                    crate::overlay::check_cleanup(&handle, &ph, &prev).await;

                    // Reset SwiftPlay state when leaving relevant phases
                    if prev != ph {
                        let was_relevant = matches!(prev.as_str(), "Lobby" | "ChampSelect" | "Matchmaking" | "PreEndOfGame");
                        let now_relevant = matches!(ph.as_str(), "Lobby" | "ChampSelect" | "Matchmaking" | "PreEndOfGame");
                        if was_relevant && !now_relevant {
                            if let Ok(mut overlay) = state.ui_overlay.write() {
                                overlay.is_swiftplay_mode = false;
                                overlay.game_mode = None;
                                overlay.queue_id = None;
                            }
                        }
                    }
                }
            }

            // Rose-style SwiftPlay detection during Lobby/ChampSelect/Matchmaking
            let swiftplay_interval = Duration::from_secs(2);
            let now = std::time::Instant::now();
            if now.duration_since(last_swiftplay_check) >= swiftplay_interval {
                last_swiftplay_check = now;
                let current_phase = state.current_gameflow_phase.lock().await.clone();
                if matches!(current_phase.as_str(), "Lobby" | "ChampSelect" | "Matchmaking" | "PreEndOfGame") {
                    if let Some((is_sp, gm, qid)) = check_swiftplay(lf).await {
                        if let Ok(mut overlay) = state.ui_overlay.write() {
                            overlay.is_swiftplay_mode = is_sp;
                            overlay.game_mode = gm;
                            overlay.queue_id = qid;
                        }
                    }
                }
            }
        }

        // ---- LCU disconnection (Rose: LCUMonitorThread detect disconnect) ----
        if last_lcu_ok && !lcu_ok {
            eprintln!("[LCUMonitor] LCU connection lost — waiting for reconnection...");
            waiting_for_connection = true;
            language_initialized = false;
            current_language = None;
            _last_lockfile = None;

            // Cancel existing WS task
            ws_cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            if let Some(task) = ws_task.take() {
                task.abort();
            }
            ws_connected = false;

            // Rose-style disconnect callback: reset ALL state
            on_lcu_disconnect(&handle).await;

            let _ = handle.emit("lcu:disconnected", serde_json::json!({
                "reason": "lockfile_gone",
            }));
        }

        // ---- LCU reconnection (Rose: detect LCU came back) ----
        if !last_lcu_ok && lcu_ok {
            if waiting_for_connection {
                eprintln!("[LCUMonitor] LCU reconnected — waiting for WebSocket...");
                waiting_for_connection = false;
                lcu_reconnected = true;
                let _ = handle.emit("lcu:reconnected", serde_json::json!({
                    "stage": "lcu_reconnected",
                }));
            }
        }

        // ---- WebSocket management (Rose: WSEventThread) ----
        if lcu_ok && !ws_connected {
            if let Some(ref lf) = lockfile {
                // Start WS connection task (non-blocking)
                let ws_handle = handle.clone();
                let ws_lf = Lockfile {
                    port: lf.port,
                    password: lf.password.clone(),
                    protocol: lf.protocol.clone(),
                };
                let ws_cancel_token = ws_cancel.clone();
                let task = tokio::spawn(async move {
                    connect_lcu_wamp(ws_handle, ws_lf, ws_cancel_token).await;
                });
                ws_task = Some(task);
                ws_connected = true; // Mark as connecting
            }
        }

        // ---- WebSocket connected -> language detection (Rose: _try_detect_language) ----
        if lcu_ok && ws_connected && !language_initialized {
            let elapsed = last_language_check.elapsed();
            if elapsed >= Duration::from_secs_f64(LANGUAGE_RETRY_INTERVAL_S) || !initial_ws_done {
                last_language_check = Instant::now();
                if let Some(ref lf) = lockfile {
                    match detect_language(lf).await {
                        Some(lang) if !lang.is_empty() => {
                            language_retry_count = 0;
                            current_language = Some(lang.clone());
                            language_initialized = true;
                            eprintln!("[LCUMonitor] Language detected: {}", lang);
                            let _ = handle.emit("lcu:language-detected", serde_json::json!({
                                "language": lang,
                            }));
                        }
                        _ => {
                            language_retry_count += 1;
                            if language_retry_count >= LANGUAGE_MAX_RETRIES {
                                eprintln!("[LCUMonitor] Language unavailable after max retries — proceeding without it");
                                language_initialized = true;
                                language_retry_count = 0;
                            }
                        }
                    }
                }

                // Rose: _check_initial_champion_state after first WS + language
                if !initial_ws_done && lcu_ok {
                    check_initial_champion_state(&handle).await;
                }

                // Rose: reconnect callback (re-activate Pengu, re-init injection)
                if initial_ws_done && lcu_reconnected {
                    lcu_reconnected = false;
                    eprintln!("[LCUMonitor] Account swap detected — re-initializing Pengu and injection...");
                    on_lcu_reconnect(&handle).await;
                }
                initial_ws_done = true;
            }
        }

        // ---- Periodic language change check (Rose: 30s) ----
        if lcu_ok && ws_connected && language_initialized {
            let elapsed = last_language_check.elapsed();
            if elapsed >= Duration::from_secs_f64(LANGUAGE_CHECK_INTERVAL_S) {
                last_language_check = Instant::now();
                if let Some(ref lf) = lockfile {
                    if let Some(new_lang) = detect_language(lf).await {
                        if !new_lang.is_empty()
                            && current_language.as_deref() != Some(&new_lang)
                        {
                            eprintln!("[LCUMonitor] Language changed: {:?} -> {}", current_language, new_lang);
                            current_language = Some(new_lang.clone());
                            let _ = handle.emit("lcu:language-detected", serde_json::json!({
                                "language": new_lang,
                            }));
                        }
                    }
                }
            }
        }

        // ---- Detect WS disconnect (Rose: WebSocket disconnected) ----
        if let Some(ref task) = ws_task {
            if task.is_finished() {
                ws_connected = false;
                ws_task = None;
                eprintln!("[LCUMonitor] WebSocket disconnected.");
                let _ = handle.emit("lcu:ws-status", serde_json::json!({
                    "connected": false,
                }));
            }
        }

        // ---- Late-lock recovery (Rose: _maybe_recover_locked_champ_select_state) ----
        if lcu_ok && ws_connected {
            check_initial_champion_state(&handle).await;
        }

        last_lcu_ok = lcu_ok;
        _last_lockfile = lockfile;

        // Sleep (Rose: LCU_MONITOR_INTERVAL or LCU_MONITOR_INTERVAL_INGAME)
        let sleep_ms = if last_lcu_ok {
            PHASE_POLL_INGAME_INTERVAL_MS
        } else {
            PHASE_POLL_INTERVAL_MS
        };
        tokio::time::sleep(Duration::from_millis(sleep_ms)).await;
    }
}

/// Rose-style WAMP WebSocket connection to LCU
async fn connect_lcu_wamp(handle: AppHandle, lockfile: Lockfile, cancel: Arc<std::sync::atomic::AtomicBool>) {
    let auth = base64::engine::general_purpose::STANDARD
        .encode(format!("riot:{}", lockfile.password));

    loop {
        if cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }

        // TCP + TLS connect
        let tcp = match tokio::net::TcpStream::connect(format!("127.0.0.1:{}", lockfile.port)).await
        {
            Ok(tcp) => tcp,
            Err(e) => {
                eprintln!("[LCU-WS] TCP connect failed: {}", e);
                tokio::time::sleep(Duration::from_secs_f64(WS_RECONNECT_DELAY_S)).await;
                continue;
            }
        };

        let tls_connector = match native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[LCU-WS] TLS connector build failed: {}", e);
                return;
            }
        };
        let tls = tokio_native_tls::TlsConnector::from(tls_connector);
        let tls_stream = match tls.connect("127.0.0.1", tcp).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[LCU-WS] TLS handshake failed: {}", e);
                tokio::time::sleep(Duration::from_secs_f64(WS_RECONNECT_DELAY_S)).await;
                continue;
            }
        };

        // WebSocket handshake with WAMP subprotocol (Rose-style)
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let url = format!("wss://127.0.0.1:{}/", lockfile.port);
        let mut request = match url.into_client_request() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[LCU-WS] Request build failed: {}", e);
                return;
            }
        };
        let headers = request.headers_mut();
        headers.insert(
            "Authorization",
            format!("Basic {}", auth).parse().unwrap(),
        );
        headers.insert(
            "Sec-WebSocket-Protocol",
            "wamp".parse().unwrap(),
        );

        let (mut ws_stream, _) = match tokio_tungstenite::client_async(request, tls_stream).await {
            Ok(ws) => ws,
            Err(e) => {
                eprintln!("[LCU-WS] WebSocket handshake failed: {}", e);
                tokio::time::sleep(Duration::from_secs_f64(WS_RECONNECT_DELAY_S)).await;
                continue;
            }
        };

        eprintln!("[LCU-WS] Connected (WAMP)");
        let _ = handle.emit("lcu:ws-status", serde_json::json!({
            "connected": true,
        }));

        // Rose: Subscribe to OnJsonApiEvent
        if let Err(e) = ws_stream
            .send(tokio_tungstenite::tungstenite::Message::Text(
                r#"[5,"OnJsonApiEvent"]"#.into(),
            ))
            .await
        {
            eprintln!("[LCU-WS] Subscribe failed: {}", e);
            tokio::time::sleep(Duration::from_secs_f64(WS_RECONNECT_DELAY_S)).await;
            continue;
        }

        // Event loop (Rose: WebSocketConnection._on_message -> WebSocketEventHandler.handle_message)
        loop {
            // Check cancel flag periodically
            if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                eprintln!("[LCU-WS] Cancelled.");
                let _ = handle.emit("lcu:ws-status", serde_json::json!({
                    "connected": false,
                    "reason": "cancelled",
                }));
                return;
            }

            tokio::select! {
                msg = ws_stream.next() => {
                    match msg {
                        Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                            handle_wamp_event(&handle, &text).await;
                        }
                        Some(Ok(tokio_tungstenite::tungstenite::Message::Ping(_))) => {
                        }
                        Some(Ok(tokio_tungstenite::tungstenite::Message::Pong(_))) => {}
                        Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_))) => {
                            eprintln!("[LCU-WS] Close frame received.");
                            break;
                        }
                        Some(Err(e)) => {
                            eprintln!("[LCU-WS] Error: {}", e);
                            break;
                        }
                        None => {
                            eprintln!("[LCU-WS] Stream ended.");
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        // Connection lost — emit status and retry
        let _ = handle.emit("lcu:ws-status", serde_json::json!({
            "connected": false,
            "reason": "disconnected",
        }));

        tokio::time::sleep(Duration::from_secs_f64(WS_RECONNECT_DELAY_S)).await;
    }
}

/// Handle WAMP event (Rose: WebSocketEventHandler.handle_message)
async fn handle_wamp_event(handle: &AppHandle, text: &str) {
    // Rose format: [8, "OnJsonApiEvent", {"eventType": "...", "uri": "...", "data": ...}]
    let data: serde_json::Value = match serde_json::from_str(text) {
        Ok(d) => d,
        Err(_) => return,
    };

    let payload = match data.as_array() {
        Some(arr) if arr.len() >= 3 && arr[0] == 8 => arr[2].clone(),
        Some(_) => return,
        None => {
            // Also handle direct dict format (fallback)
            if data.is_object() {
                data
            } else {
                return;
            }
        }
    };

    let uri = match payload.get("uri").and_then(|v| v.as_str()) {
        Some(u) => u.to_string(),
        None => return,
    };
    let _event_type = payload
        .get("eventType")
        .and_then(|v| v.as_str())
        .unwrap_or("Update");
    let event_data = payload.get("data").cloned().unwrap_or(serde_json::Value::Null);

    // Route events (Rose: WebSocketEventHandler.handle_api_event)
    match uri.as_str() {
        "/lol-gameflow/v1/gameflow-phase" => {
            if let Some(phase) = event_data.as_str() {
                let state = handle.state::<AppState>();
                let prev = state.current_gameflow_phase.lock().await.clone();
                if phase != prev {
                    *state.current_gameflow_phase.lock().await = phase.to_string();
                    broadcast_phase(handle, phase, &prev).await;
                    crate::overlay::check_cleanup(handle, phase, &prev).await;
                }
            }
        }
        "/lol-champ-select/v1/hovered-champion-id" => {
            if let Some(cid) = event_data.as_u64() {
                let _ = handle.emit("pengu:message", serde_json::json!({
                    "type": "hovered-champion",
                    "championId": cid,
                    "source": "lcu-ws",
                }));
            }
        }
        "/lol-champ-select/v1/session" => {
            if let Some(timer) = event_data.get("timer") {
                let left_ms = timer
                    .get("adjustedTimeLeftInPhase")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let phase = timer
                    .get("phase")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if left_ms > 0 {
                    let _ = handle.emit("pengu:message", serde_json::json!({
                        "type": "loadout-finalization",
                        "adjustedTimeLeftInPhase": left_ms,
                        "leftMs": left_ms,
                        "phase": phase,
                        "source": "lcu-ws",
                    }));
                }
            }

            // Rose-style: track local cell ID and compute locks
            let local_cell_opt = event_data.get("localPlayerCellId").and_then(|v| v.as_u64());
            if let Some(local_cell) = local_cell_opt {
                if let Ok(mut cell_id) = LOCAL_CELL_ID.lock() {
                    *cell_id = Some(local_cell);
                }
                // Emit skin-sync for local player (original behavior)
                if let Some(my_team) = event_data.get("myTeam").and_then(|v| v.as_array()) {
                    for player in my_team {
                        if player.get("cellId").and_then(|v| v.as_u64()) == Some(local_cell) {
                            if let Some(skin_id) = player.get("selectedSkinId").and_then(|v| v.as_u64()) {
                                // Rose-style: update UI overlay state
                                if let Ok(mut overlay) = handle.state::<AppState>().ui_overlay.write() {
                                    overlay.selected_skin_id = Some(skin_id as i32);
                                    if let Some(cid) = player.get("championId").and_then(|v| v.as_u64()) {
                                        overlay.locked_champ_id = Some(cid as i32);
                                    }
                                }
                                let _ = handle.emit("pengu:message", serde_json::json!({
                                    "type": "skin-sync",
                                    "payload": {
                                        "selectedSkinId": skin_id,
                                        "cellId": local_cell,
                                    },
                                    "source": "lcu-ws",
                                }));
                            }
                            break;
                        }
                    }
                }
            }

            // Rose: count visible players from session data
            let visible = {
                let mut cells = std::collections::HashSet::new();
                for side in &["myTeam", "theirTeam"] {
                    if let Some(team) = event_data.get(side).and_then(|v| v.as_array()) {
                        for p in team {
                            if let Some(c) = p.get("cellId").and_then(|v| v.as_u64()) {
                                cells.insert(c);
                            }
                        }
                    }
                }
                cells.len()
            };

            // Rose-style: compute locked champions from actions (compute_locked)
            let mut new_locks = HashMap::new();
            if let Some(actions) = event_data.get("actions").and_then(|v| v.as_array()) {
                let mut idx = HashMap::new();
                if let Some(my_team) = event_data.get("myTeam").and_then(|v| v.as_array()) {
                    for p in my_team {
                        if let Some(cid) = p.get("cellId").and_then(|v| v.as_u64()) {
                            idx.insert(cid, p.clone());
                        }
                    }
                }
                for rnd in actions {
                    if let Some(round) = rnd.as_array() {
                        for a in round {
                            if a.get("type").and_then(|v| v.as_str()) == Some("pick")
                                && a.get("completed").and_then(|v| v.as_bool()) == Some(true)
                            {
                                let cid = a.get("actorCellId").and_then(|v| v.as_u64());
                                let mut ch = a.get("championId").and_then(|v| v.as_u64()).unwrap_or(0);
                                if ch == 0 {
                                    if let Some(c) = cid {
                                        if let Some(p) = idx.get(&c) {
                                            ch = p.get("championId").and_then(|v| v.as_u64()).unwrap_or(0);
                                        }
                                    }
                                }
                                if ch > 0 {
                                    if let Some(c) = cid {
                                        new_locks.insert(c, ch);
                                    }
                                }
                            }
                        }
                    }
                }
                // Rose: also include players with championId > 0 and no pick intent
                for (&cid, p) in &idx {
                    let ch = p.get("championId").and_then(|v| v.as_u64()).unwrap_or(0);
                    if ch > 0 && !new_locks.contains_key(&cid) {
                        let intent = p.get("championPickIntent").and_then(|v| v.as_u64()).unwrap_or(0);
                        let is_intenting = p.get("isPickIntenting").and_then(|v| v.as_bool()).unwrap_or(false);
                        if intent == 0 && !is_intenting {
                            new_locks.insert(cid, ch);
                        }
                    }
                }
            }

            // Rose-style: detect champion exchange for local player
            let exchange = (|| -> Option<(u64, u64)> {
                let cell_id = LOCAL_CELL_ID.lock().ok()?;
                let my_cell = (*cell_id)?;
                let new_locks_snap = new_locks.clone();
                let prev_locks = LAST_LOCKS.lock().ok()?;
                let locks = prev_locks.as_ref()?;
                let &new_champ = new_locks_snap.get(&my_cell)?;
                let &old_champ = locks.get(&my_cell)?;
                if old_champ != new_champ && old_champ > 0 && new_champ > 0 {
                    Some((old_champ, new_champ))
                } else {
                    None
                }
            })();

            if let Some((old_champ, new_champ)) = exchange {
                eprintln!("[LCU-WS] Champion exchange detected: {} -> {}", old_champ, new_champ);

                // Rose handle_champion_exchange 1:1:
                //   Reset UI state + flag, cancel builds, emit event.
                {
                    if let Ok(mut ui) = handle.state::<AppState>().ui_overlay.write() {
                        ui.ui_skin_id = None;
                        ui.ui_skin_name = None;
                        ui.last_hovered_skin_id = None;
                        ui.last_hovered_skin_key = None;
                        ui.selected_skin_id = None;
                        ui.selected_chroma_id = None;
                        ui.locked_champ_id = Some(new_champ as i32);
                        ui.locked_champ_name = None;
                        ui.own_champion_locked = true;
                        ui.champion_exchange_triggered = true;
                        ui.reset_skin_notification = true;
                        ui.pending_chroma_selection = false;
                        ui.chroma_panel_open = false;
                        ui.last_notified_skin_id = None;
                    }
                }
                handle.state::<AppState>().overlay_cancel_epoch.fetch_add(1, Ordering::SeqCst);

                let _ = handle.emit("pengu:message", serde_json::json!({
                    "type": "champion-exchange",
                    "oldChampionId": old_champ,
                    "newChampionId": new_champ,
                    "source": "lcu-ws",
                }));

                // Rose: skin scraper runs after exchange. Emit champion-locked
                // with LCU skin data so frontend can resolve without waiting for DOM.
                let new_skin_id = extract_skin_id_for_cell(&event_data, LOCAL_CELL_ID.lock().ok().and_then(|g| *g));
                let _ = handle.emit("pengu:message", serde_json::json!({
                    "type": "champion-locked",
                    "championId": new_champ,
                    "selectedSkinId": new_skin_id,
                    "source": "lcu-ws-exchange",
                }));
            }

            // Persist current locks for next comparison
            if let Ok(mut locks) = LAST_LOCKS.lock() {
                *locks = Some(new_locks.clone());
            }

            // Rose: all-locked announcement
            if visible > 0 && new_locks.len() >= visible {
                eprintln!("[LCU-WS] ALL LOCKED ({}/{})", new_locks.len(), visible);
            }
        }
        _ => {}
    }
}

/// Rose-style: extract selectedSkinId from myTeam for a given cellId.
/// Falls back to championId * 1000 (base skin).
fn extract_skin_id_for_cell(event_data: &serde_json::Value, my_cell: Option<u64>) -> u64 {
    let my_cell = match my_cell {
        Some(c) => c,
        None => return 0,
    };
    event_data
        .get("myTeam")
        .and_then(|v| v.as_array())
        .and_then(|team| {
            team.iter().find(|p| p.get("cellId").and_then(|v| v.as_u64()) == Some(my_cell))
        })
        .and_then(|p| p.get("selectedSkinId").and_then(|v| v.as_u64()))
        .filter(|&id| id > 0)
        .unwrap_or(0)
}

/// Rose-style HTTP phase polling (fallback for when WS is not connected)
async fn read_phase_http(lockfile: &Lockfile) -> Option<String> {
    let auth = base64::engine::general_purpose::STANDARD
        .encode(format!("riot:{}", lockfile.password));
    let url = format!(
        "{}://127.0.0.1:{}/lol-gameflow/v1/gameflow-phase",
        lockfile.protocol, lockfile.port
    );
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_millis(900))
        .build()
        .ok()?;
    client
        .get(url)
        .header("Authorization", format!("Basic {}", auth))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<String>()
        .await
        .ok()
}

/// Rose-style SwiftPlay detection from LCU session data.
/// Polls `/lol-gameflow/v1/session` for queue info and returns
/// `(is_swiftplay, game_mode, queue_id)`. Returns `None` on failure.
async fn check_swiftplay(lockfile: &Lockfile) -> Option<(bool, Option<String>, Option<u64>)> {
    let auth = base64::engine::general_purpose::STANDARD
        .encode(format!("riot:{}", lockfile.password));
    let url = format!(
        "{}://127.0.0.1:{}/lol-gameflow/v1/session",
        lockfile.protocol, lockfile.port
    );
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_millis(900))
        .build()
        .ok()?;
    let session: serde_json::Value = client
        .get(&url)
        .header("Authorization", format!("Basic {}", auth))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let queue = session.get("gameData")?.get("queue")?;
    let game_mode = queue.get("gameMode").and_then(|v| v.as_str()).map(String::from);
    let queue_id = queue.get("queueId").and_then(|v| v.as_u64());
    let is_swiftplay = game_mode.as_deref().map(|m| m == "SWIFTPLAY" || m == "BRAWL").unwrap_or(false)
        || queue_id == Some(480);

    Some((is_swiftplay, game_mode, queue_id))
}

/// Detect LCU language (Rose: LCUProperties.client_language)
async fn detect_language(lockfile: &Lockfile) -> Option<String> {
    let auth = base64::engine::general_purpose::STANDARD
        .encode(format!("riot:{}", lockfile.password));
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;

    // Try to get locale from LCU — multiple endpoints for robustness
    for endpoint in &[
        "/lol-gameflow/v1/locale",
        "/riotclient/get_locale",
        "/lol-platform-config/v1/initial-configuration-complete",
    ] {
        let url = format!(
            "{}://127.0.0.1:{}{}",
            lockfile.protocol, lockfile.port, endpoint
        );
        if let Ok(resp) = client
            .get(&url)
            .header("Authorization", format!("Basic {}", auth))
            .send()
            .await
        {
            if let Ok(text) = resp.text().await {
                if !text.is_empty() && text.len() < 20 {
                    return Some(text.trim_matches('"').to_string());
                }
            }
        }
    }
    None
}

/// Rose-style disconnect handler: reset ALL state
async fn on_lcu_disconnect(handle: &AppHandle) {
    let state = handle.state::<AppState>();

    // Cancel early monitor if active
    state.early_monitor_active.store(false, Ordering::SeqCst);
    state.early_monitor_runoverlay_started.store(false, Ordering::SeqCst);
    let early_pid = match state.early_monitor_pid.lock() {
        Ok(mut pid) => pid.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    };
    if let Some(pid) = early_pid {
        let _ = overlay::resume_league_by_pid(pid);
    }

    // Emit state reset to frontend (Rose: WebSocketEventHandler._handle_champ_select_entry)
    let _ = handle.emit("lcu:state-reset", serde_json::json!({
        "reason": "lcu_disconnected",
    }));
}

/// Rose-style reconnect handler: re-activate Pengu and re-init injection
async fn on_lcu_reconnect(handle: &AppHandle) {
    let app_data = crate::install_dir().to_string_lossy().to_string();
    let token_dir = crate::writable_data_dir().to_string_lossy().to_string();

    commands::cleanup_pengu_proxy_on_startup(&app_data);
    commands::pengu_startup_init(&app_data, &token_dir);
    commands::pengu_install_rift_plugin_inner(&token_dir).ok();

    let _ = handle.emit("lcu:reconnect-done", serde_json::json!({
        "stage": "pengu_reactivated",
    }));
}

/// Rose-style late-lock recovery (Issue #29)
async fn check_initial_champion_state(handle: &AppHandle) {
    let lockfile = match read_lockfile() {
        Some(lf) => lf,
        None => return,
    };
    let phase = match read_phase_http(&lockfile).await {
        Some(p) => p,
        None => return,
    };
    if phase != "ChampSelect" {
        return;
    }

    // Get current session
    let auth = base64::engine::general_purpose::STANDARD
        .encode(format!("riot:{}", lockfile.password));
    let session_url = format!(
        "{}://127.0.0.1:{}/lol-champ-select/v1/session",
        lockfile.protocol, lockfile.port
    );
    let client = match reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return,
    };
    let session: serde_json::Value = match client
        .get(&session_url)
        .header("Authorization", format!("Basic {}", auth))
        .send()
        .await
    {
        Ok(resp) => match resp.json().await {
            Ok(v) => v,
            Err(_) => return,
        },
        Err(_) => return,
    };

    // Check for locked champion (Rose: compute_locked)
    let my_cell = match session.get("localPlayerCellId").and_then(|v| v.as_u64()) {
        Some(c) => c,
        None => return,
    };
    let actions = match session.get("actions").and_then(|v| v.as_array()) {
        Some(a) => a,
        None => return,
    };

    for action_round in actions {
        let actions_arr = match action_round.as_array() {
            Some(a) => a,
            None => continue,
        };
        for action in actions_arr {
            let actor_cell = match action.get("actorCellId").and_then(|v| v.as_u64()) {
                Some(c) => c,
                None => continue,
            };
            if actor_cell != my_cell {
                continue;
            }
            let is_completed = action
                .get("completed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let action_type = action
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if (action_type == "pick" && is_completed)
                || (action_type == "ban" && is_completed)
            {
                let champ_id = match action.get("championId").and_then(|v| v.as_u64()) {
                    Some(c) => c,
                    None => continue,
                };
                eprintln!(
                    "[LCUMonitor] Late-lock recovery: champion {} already locked.",
                    champ_id
                );
                // Rose-style: full bootstrap (update UI state, locks, skin ID)
                let skin_id = extract_skin_id_for_cell(&session, Some(my_cell));
                if let Ok(mut overlay) = handle.state::<AppState>().ui_overlay.write() {
                    overlay.own_champion_locked = true;
                    overlay.locked_champ_id = Some(champ_id as i32);
                }
                let mut lk = HashMap::new();
                lk.insert(my_cell, champ_id);
                if let Ok(mut locks) = LAST_LOCKS.lock() {
                    *locks = Some(lk);
                }
                let _ = handle.emit("pengu:message", serde_json::json!({
                    "type": "champion-locked",
                    "championId": champ_id,
                    "selectedSkinId": skin_id,
                    "source": "lcu-monitor-late-lock",
                    "cellId": my_cell,
                }));
                return;
            }
        }
    }
}

/// Broadcast phase change to frontend and bridge (Rose-style)
async fn broadcast_phase(handle: &AppHandle, phase: &str, previous: &str) {
    let state = handle.state::<AppState>();
    // Read game mode info from overlay state (set by check_swiftplay polling)
    let (game_mode, queue_id) = {
        let overlay = state.ui_overlay.read().unwrap_or_else(|e| e.into_inner());
        (overlay.game_mode.clone(), overlay.queue_id)
    };
    let payload = serde_json::json!({
        "type": "phase-change",
        "phase": phase,
        "previousPhase": previous,
        "gameMode": game_mode,
        "queueId": queue_id,
        "source": "lcu-ws",
    });
    // Rose-style: update UI overlay state
    if let Ok(mut overlay) = state.ui_overlay.write() {
        overlay.phase = Some(phase.to_string());
    }
    let _ = handle.emit("pengu:message", payload.clone());
    if let Ok(text) = serde_json::to_string(&payload) {
        if let Some(tx) = state.pengu_bridge_tx.lock().await.as_ref() {
            let _ = tx.send(text);
        }
    }
}
