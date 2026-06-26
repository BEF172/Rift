use crate::{overlay, AppState};
use base64::Engine;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone)]
struct Lockfile {
    port: u16,
    password: String,
    protocol: String,
}

async fn read_lcu_json(path: &str) -> Result<serde_json::Value, String> {
    let lockfile = read_lockfile().ok_or_else(|| "LCU lockfile no encontrado.".to_string())?;
    let auth =
        base64::engine::general_purpose::STANDARD.encode(format!("riot:{}", lockfile.password));
    let url = format!(
        "{}://127.0.0.1:{}{}",
        lockfile.protocol, lockfile.port, path
    );
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| format!("No pude crear cliente LCU: {}", error))?;
    client
        .get(url)
        .header("Authorization", format!("Basic {}", auth))
        .send()
        .await
        .map_err(|error| format!("LCU no respondio: {}", error))?
        .error_for_status()
        .map_err(|error| format!("LCU respondio con error: {}", error))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Respuesta LCU invalida: {}", error))
}

fn lcu_auth(lockfile: &Lockfile) -> String {
    let encoded =
        base64::engine::general_purpose::STANDARD.encode(format!("riot:{}", lockfile.password));
    format!("Basic {}", encoded)
}

fn lcu_url(lockfile: &Lockfile, path: &str) -> String {
    format!(
        "{}://127.0.0.1:{}{}",
        lockfile.protocol, lockfile.port, path
    )
}

fn local_selection(session: &serde_json::Value) -> Option<(i64, u64, u64)> {
    let local_cell_id = session.get("localPlayerCellId")?.as_i64()?;
    let player = session.get("myTeam")?.as_array()?.iter().find(|player| {
        player.get("cellId").and_then(|value| value.as_i64()) == Some(local_cell_id)
    })?;
    Some((
        local_cell_id,
        player
            .get("championId")
            .and_then(|value| value.as_u64())
            .unwrap_or(0),
        player
            .get("selectedSkinId")
            .and_then(|value| value.as_u64())
            .unwrap_or(0),
    ))
}

fn local_pick_action(session: &serde_json::Value, local_cell_id: i64) -> Option<(u64, bool)> {
    session
        .get("actions")?
        .as_array()?
        .iter()
        .filter_map(|round| round.as_array())
        .flat_map(|round| round.iter())
        .find(|action| {
            action.get("actorCellId").and_then(|value| value.as_i64()) == Some(local_cell_id)
                && action.get("type").and_then(|value| value.as_str()) == Some("pick")
        })
        .and_then(|action| {
            Some((
                action.get("id")?.as_u64()?,
                action
                    .get("completed")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
            ))
        })
}

async fn lcu_patch_skin(
    client: &reqwest::Client,
    lockfile: &Lockfile,
    path: &str,
    skin_id: u64,
) -> Result<(bool, u16, String), String> {
    let response = client
        .patch(lcu_url(lockfile, path))
        .header("Authorization", lcu_auth(lockfile))
        .json(&serde_json::json!({ "selectedSkinId": skin_id }))
        .send()
        .await
        .map_err(|error| format!("LCU PATCH {} fallo: {}", path, error))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    Ok((status.is_success(), status.as_u16(), text))
}

async fn verify_lcu_skin(
    client: &reqwest::Client,
    lockfile: &Lockfile,
    expected_skin_id: u64,
) -> u64 {
    // Rose waits BASE_SKIN_VERIFICATION_WAIT_S (150 ms) once, then reads
    // myTeam.selectedSkinId. The PATCH acceptance is what matters for timing;
    // verification is diagnostic and must not consume the FINALIZATION window.
    tokio::time::sleep(Duration::from_millis(150)).await;
    let response = client
        .get(lcu_url(lockfile, "/lol-champ-select/v1/session"))
        .header("Authorization", lcu_auth(lockfile))
        .send()
        .await;
    let Ok(response) = response else {
        return 0;
    };
    let Ok(session) = response.json::<serde_json::Value>().await else {
        return 0;
    };
    local_selection(&session)
        .map(|(_, _, selected_skin_id)| selected_skin_id)
        .unwrap_or(expected_skin_id)
}

/// Force a champ-select skin directly through the authenticated LCU, matching
/// Rose's action-first, my-selection-fallback flow without a Pengu round trip.
pub async fn force_selected_skin(
    champion_id: u64,
    selected_skin_id: u64,
) -> Result<serde_json::Value, String> {
    if champion_id == 0 || selected_skin_id == 0 {
        return Err("championId/selectedSkinId invalidos.".to_string());
    }
    let lockfile = read_lockfile().ok_or_else(|| "LCU lockfile no encontrado.".to_string())?;
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| format!("No pude crear cliente LCU: {}", error))?;
    let session = client
        .get(lcu_url(&lockfile, "/lol-champ-select/v1/session"))
        .header("Authorization", lcu_auth(&lockfile))
        .send()
        .await
        .map_err(|error| format!("No pude leer ChampSelect: {}", error))?
        .error_for_status()
        .map_err(|error| format!("ChampSelect no disponible: {}", error))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Sesion ChampSelect invalida: {}", error))?;
    let (local_cell_id, session_champion_id, current_skin_id) =
        local_selection(&session).ok_or_else(|| "Jugador local no encontrado.".to_string())?;
    if session_champion_id != 0 && session_champion_id != champion_id {
        return Err(format!(
            "Champion mismatch: esperado={} actual={}",
            champion_id, session_champion_id
        ));
    }
    if current_skin_id == selected_skin_id {
        return Ok(serde_json::json!({
            "forceOk": true,
            "requestAccepted": true,
            "forceMethod": "already-selected",
            "verifiedSkinId": current_skin_id,
        }));
    }

    let mut request_accepted = false;
    let mut method = String::new();
    let mut last_error = String::new();

    if let Some((action_id, completed)) = local_pick_action(&session, local_cell_id) {
        if !completed {
            let path = format!("/lol-champ-select/v1/session/actions/{}", action_id);
            match lcu_patch_skin(&client, &lockfile, &path, selected_skin_id).await {
                Ok((true, _, _)) => {
                    request_accepted = true;
                    method = "action".to_string();
                    let verified = verify_lcu_skin(&client, &lockfile, selected_skin_id).await;
                    if verified == selected_skin_id {
                        return Ok(serde_json::json!({
                            "forceOk": true,
                            "requestAccepted": true,
                            "forceMethod": method,
                            "verifiedSkinId": verified,
                        }));
                    }
                    last_error = "action aceptada sin confirmacion".to_string();
                }
                Ok((_, status, body)) => {
                    last_error = format!(
                        "action HTTP {} {}",
                        status,
                        body.chars().take(240).collect::<String>()
                    );
                }
                Err(error) => last_error = error,
            }
        }
    }

    match lcu_patch_skin(
        &client,
        &lockfile,
        "/lol-champ-select/v1/session/my-selection",
        selected_skin_id,
    )
    .await
    {
        Ok((true, _, _)) => {
            request_accepted = true;
            method = "my-selection".to_string();
        }
        Ok((_, status, body)) => {
            last_error = format!(
                "my-selection HTTP {} {}",
                status,
                body.chars().take(240).collect::<String>()
            );
        }
        Err(error) => last_error = error,
    }
    let verified = verify_lcu_skin(&client, &lockfile, selected_skin_id).await;
    let force_ok = verified == selected_skin_id;
    if force_ok {
        last_error.clear();
    } else if last_error.is_empty() {
        last_error = format!("LCU no confirmo {}; actual=?", selected_skin_id);
    }
    Ok(serde_json::json!({
        "forceOk": force_ok,
        "requestAccepted": request_accepted,
        "forceMethod": method,
        "verifiedSkinId": verified,
        "forceError": last_error,
    }))
}

/// Rose-style FINALIZATION ticker: LCU resync every 200 ms and one local,
/// monotonic deadline evaluated every 25 ms.
pub async fn wait_for_finalization_threshold(
    threshold_ms: u64,
) -> Result<serde_json::Value, String> {
    let threshold_ms = threshold_ms.clamp(100, 2_000);
    let lockfile = read_lockfile().ok_or_else(|| "LCU lockfile no encontrado.".to_string())?;
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| format!("No pude crear cliente LCU: {}", error))?;
    let started_at = Instant::now();
    let mut last_poll = Instant::now() - Duration::from_millis(200);
    let mut deadline: Option<Instant> = None;
    let mut saw_session = false;
    let mut saw_finalization = false;

    loop {
        if started_at.elapsed() > Duration::from_secs(300) {
            return Err("Ticker FINALIZATION local expiro.".to_string());
        }
        if last_poll.elapsed() >= Duration::from_millis(200) {
            last_poll = Instant::now();
            let response = client
                .get(lcu_url(&lockfile, "/lol-champ-select/v1/session"))
                .header("Authorization", lcu_auth(&lockfile))
                .send()
                .await
                .map_err(|error| format!("Ticker LCU no respondio: {}", error))?;
            if !response.status().is_success() {
                if saw_session {
                    return Err(format!(
                        "ChampSelect cerro antes del umbral: HTTP {}",
                        response.status().as_u16()
                    ));
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
                continue;
            }
            let session = response
                .json::<serde_json::Value>()
                .await
                .map_err(|error| format!("Sesion ChampSelect invalida: {}", error))?;
            saw_session = true;
            let timer = session.get("timer").cloned().unwrap_or_default();
            let phase = timer
                .get("phase")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_ascii_uppercase();
            let left_ms = timer
                .get("adjustedTimeLeftInPhase")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            if phase == "FINALIZATION" && left_ms > 0 {
                saw_finalization = true;
                let candidate = Instant::now() + Duration::from_millis(left_ms);
                if deadline.map(|current| candidate < current).unwrap_or(true) {
                    deadline = Some(candidate);
                }
            } else if saw_finalization {
                return Err(format!("FINALIZATION termino en fase {}.", phase));
            }
        }

        if let Some(deadline) = deadline {
            let remaining_ms = deadline
                .checked_duration_since(Instant::now())
                .unwrap_or_default()
                .as_millis() as u64;
            if remaining_ms <= threshold_ms {
                return Ok(serde_json::json!({
                    "ready": true,
                    "source": "rust-lcu-monotonic",
                    "thresholdMs": threshold_ms,
                    "remainingMs": remaining_ms,
                }));
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// Rose-style skin catalog: the running League client is the source of truth.
/// This intentionally avoids Data Dragon so localized names, new skins and
/// chromas always match the exact client build currently in use.
pub async fn get_champion_skin_catalog(champion_id: u64) -> Result<serde_json::Value, String> {
    if champion_id == 0 {
        return Err("championId invalido.".to_string());
    }
    let endpoints = [
        format!("/lol-game-data/assets/v1/champions/{}.json", champion_id),
        format!(
            "/lol-champions/v1/inventories/scouting/champions/{}",
            champion_id
        ),
    ];
    let mut last_error = String::new();
    for endpoint in endpoints {
        match read_lcu_json(&endpoint).await {
            Ok(payload)
                if payload
                    .get("skins")
                    .and_then(|value| value.as_array())
                    .is_some() =>
            {
                return Ok(serde_json::json!({
                    "championId": champion_id,
                    "championName": payload.get("name").cloned().unwrap_or(serde_json::Value::Null),
                    "skins": payload.get("skins").cloned().unwrap_or_else(|| serde_json::json!([])),
                    "source": "lcu"
                }));
            }
            Ok(_) => last_error = format!("{} no contiene skins", endpoint),
            Err(error) => last_error = error,
        }
    }
    Err(format!(
        "No pude obtener las skins del campeon {} desde LCU: {}",
        champion_id, last_error
    ))
}

fn find_lockfile() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("LCU_LOCKFILE") {
        candidates.push(PathBuf::from(path));
    }
    candidates.extend([
        PathBuf::from(r"C:\Riot Games\League of Legends\lockfile"),
        PathBuf::from(r"D:\Riot Games\League of Legends\lockfile"),
    ]);
    for variable in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Some(root) = std::env::var_os(variable) {
            candidates.push(
                PathBuf::from(root)
                    .join("Riot Games")
                    .join("League of Legends")
                    .join("lockfile"),
            );
        }
    }
    for process_name in ["LeagueClientUx.exe", "LeagueClient.exe"] {
        if let Some(directory) = overlay::find_process_exe_path(process_name) {
            candidates.push(PathBuf::from(directory).join("lockfile"));
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

async fn read_phase(client: &reqwest::Client, lockfile: &Lockfile) -> Option<String> {
    let auth =
        base64::engine::general_purpose::STANDARD.encode(format!("riot:{}", lockfile.password));
    let url = format!(
        "{}://127.0.0.1:{}/lol-gameflow/v1/gameflow-phase",
        lockfile.protocol, lockfile.port
    );
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

fn phase_needs_cleanup(phase: &str, previous: &str) -> bool {
    // Rose treats Lobby as a clean boundary and kills every old runoverlay
    // there. That also repairs a stale runner when Rift Atlas starts after a
    // crash or after missing the EndOfGame transition.
    phase == "Lobby"
        || matches!(phase, "PreEndOfGame" | "EndOfGame" | "WaitingForStats")
        || (matches!(phase, "Matchmaking" | "ReadyCheck" | "None")
            && matches!(
                previous,
                "ChampSelect"
                    | "FINALIZATION"
                    | "GameStart"
                    | "InProgress"
                    | "Reconnect"
                    | "PreEndOfGame"
                    | "EndOfGame"
                    | "WaitingForStats"
            ))
}

async fn stop_overlay_for_phase(app: &AppHandle, phase: &str, previous: &str) {
    let state = app.state::<AppState>();

    if matches!(phase, "None" | "Matchmaking" | "ReadyCheck") {
        let has_runner = state.running_overlay_process.lock().await.is_some();
        let building = *state.active_overlay_run.lock().await;
        let early_active = state.early_monitor_active.load(Ordering::SeqCst);
        let has_preserved_overlay = !state.current_overlay_path.lock().await.is_empty();
        if has_runner || building || early_active || has_preserved_overlay {
            overlay::append_overlay_log(&format!(
                "[Gameflow] {} -> {}: cleanup diferido; overlay activo/building={} early={} runner={} preserved={}.",
                previous,
                phase,
                building,
                early_active,
                has_runner,
                has_preserved_overlay
            ));
            return;
        }
    }

    state.overlay_cancel_epoch.fetch_add(1, Ordering::SeqCst);
    state.early_monitor_active.store(false, Ordering::SeqCst);
    let early_pid = match state.early_monitor_pid.lock() {
        Ok(mut pid) => pid.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    };
    if let Some(pid) = early_pid {
        let _ = overlay::resume_league_by_pid(pid);
    }

    let pid = state.running_overlay_process.lock().await.take();
    let overlay_path = state.current_overlay_path.lock().await.clone();
    if let Some(pid) = pid {
        overlay::append_overlay_log(&format!(
            "[Gameflow] {} -> {}: deteniendo runoverlay PID {}.",
            previous, phase, pid
        ));
        overlay::stop_patcher(pid, &overlay_path);
        state.running_overlay_alive.lock().await.take();
        state.running_overlay_ready.lock().await.take();
        *state.active_overlay_run.lock().await = false;
        *state.current_overlay_path.lock().await = String::new();
        let _ = app.emit(
            "patcher-died",
            serde_json::json!({
                "pid": pid,
                "reason": "gameflow-ended",
                "phase": phase,
            }),
        );
    }
    let _ = tokio::task::spawn_blocking(overlay::kill_all_runoverlay_processes).await;
    if !overlay_path.is_empty() {
        overlay::wipe_overlay_dir(&overlay_path);
    }
}

async fn broadcast_phase(app: &AppHandle, phase: &str, previous: &str) {
    let payload = serde_json::json!({
        "type": "phase-change",
        "phase": phase,
        "previousPhase": previous,
        "source": "lcu-gameflow-monitor",
    });
    let state = app.state::<AppState>();
    *state.current_gameflow_phase.lock().await = phase.to_string();
    let _ = app.emit("pengu:message", payload.clone());
    if let Ok(text) = serde_json::to_string(&payload) {
        if let Some(tx) = state.pengu_bridge_tx.lock().await.as_ref() {
            let _ = tx.send(text);
        }
    }
}

/// Rose-style LCU phase loop. It does not depend on Pengu or on the webview being visible.
pub async fn start(app: AppHandle) {
    let client = match reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_millis(900))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            eprintln!("[Gameflow] No pude crear el cliente LCU: {}", error);
            return;
        }
    };

    let mut previous = String::new();
    let mut null_polls = 0u8;
    let mut unchanged_polls = 0u8;
    let mut interval = tokio::time::interval(Duration::from_millis(650));
    loop {
        interval.tick().await;
        let phase = match read_lockfile() {
            Some(lockfile) => read_phase(&client, &lockfile).await,
            None => None,
        };
        let phase = match phase {
            Some(phase) if !phase.is_empty() => {
                null_polls = 0;
                phase
            }
            _ => {
                null_polls = null_polls.saturating_add(1);
                if null_polls < 3 || previous.is_empty() {
                    continue;
                }
                "None".to_string()
            }
        };
        if phase == previous {
            // Events emitted before the webview/plugin subscribed would otherwise
            // be lost. Rose continuously exposes current phase state, so replay a
            // cheap snapshot every few polls without repeating cleanup actions.
            unchanged_polls = unchanged_polls.saturating_add(1);
            if unchanged_polls >= 5 {
                broadcast_phase(&app, &phase, &phase).await;
                unchanged_polls = 0;
            }
            continue;
        }
        unchanged_polls = 0;
        let old_phase = previous.clone();
        eprintln!(
            "[Gameflow] {} -> {}",
            if old_phase.is_empty() {
                "?"
            } else {
                &old_phase
            },
            phase
        );
        broadcast_phase(&app, &phase, &old_phase).await;
        if phase_needs_cleanup(&phase, &old_phase) {
            stop_overlay_for_phase(&app, &phase, &old_phase).await;
        }
        previous = phase;
    }
}

#[cfg(test)]
mod tests {
    use super::{local_pick_action, local_selection, phase_needs_cleanup};

    #[test]
    fn lobby_is_always_a_clean_overlay_boundary() {
        assert!(phase_needs_cleanup("Lobby", ""));
        assert!(phase_needs_cleanup("Lobby", "InProgress"));
    }

    #[test]
    fn game_end_phases_stop_the_overlay() {
        assert!(phase_needs_cleanup("PreEndOfGame", "InProgress"));
        assert!(phase_needs_cleanup("EndOfGame", "InProgress"));
        assert!(phase_needs_cleanup("WaitingForStats", "EndOfGame"));
    }

    #[test]
    fn ordinary_pregame_transitions_do_not_stop_a_new_overlay() {
        assert!(!phase_needs_cleanup("ChampSelect", "ReadyCheck"));
        assert!(!phase_needs_cleanup("GameStart", "ChampSelect"));
        assert!(!phase_needs_cleanup("InProgress", "GameStart"));
    }

    #[test]
    fn reads_local_skin_and_pick_action_like_rose() {
        let session = serde_json::json!({
            "localPlayerCellId": 3,
            "myTeam": [
                { "cellId": 3, "championId": 518, "selectedSkinId": 518047 }
            ],
            "actions": [[
                { "id": 91, "actorCellId": 3, "type": "pick", "completed": false }
            ]]
        });
        assert_eq!(local_selection(&session), Some((3, 518, 518047)));
        assert_eq!(local_pick_action(&session, 3), Some((91, false)));
    }
}
