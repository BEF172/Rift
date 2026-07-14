use crate::overlay;
use base64::Engine;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct Lockfile {
    pub port: u16,
    pub password: String,
    pub protocol: String,
}

/// Rose 1:1: cached LCU session — the connection handler maintains `self.lcu.session`
/// as a cached object that is read without HTTP. We replicate this with a global
/// `Mutex<Option<...>>` that is updated by every successful LCU read and consumed
/// by `force_selected_skin` to avoid the ~150ms HTTP round-trip that causes the
/// action to become `completed=true` before the PATCH arrives.
static CACHED_LCU_SESSION: Mutex<Option<(Instant, serde_json::Value)>> = Mutex::new(None);
const CACHED_SESSION_MAX_AGE_MS: u128 = 2000;

fn read_cached_session() -> Option<serde_json::Value> {
    let guard = CACHED_LCU_SESSION.lock().ok()?;
    let Some((ts, ref value)) = *guard else {
        return None;
    };
    if ts.elapsed().as_millis() < CACHED_SESSION_MAX_AGE_MS {
        Some(value.clone())
    } else {
        None
    }
}

fn write_cached_session(session: &serde_json::Value) {
    if let Ok(mut guard) = CACHED_LCU_SESSION.lock() {
        *guard = Some((Instant::now(), session.clone()));
    }
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
    let response = client
        .get(url)
        .header("Authorization", format!("Basic {}", auth))
        .send()
        .await
        .map_err(|error| format!("LCU no respondio: {}", error))?
        .error_for_status()
        .map_err(|error| format!("LCU respondio con error: {}", error))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Respuesta LCU invalida: {}", error))?;
    Ok(response)
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

/// Rose-style PATCH with transport-level retry. On connection/timeout
/// errors, refreshes the lockfile once and retries (Rose parity:
/// `connection.refresh_if_needed(force=True)` + single retry).
async fn lcu_patch_skin(
    client: &reqwest::Client,
    lockfile: &Lockfile,
    path: &str,
    skin_id: u64,
) -> Result<(bool, u16, String), String> {
    let payload = serde_json::json!({ "selectedSkinId": skin_id });
    match do_lcu_patch(client, lockfile, path, &payload).await {
        Ok(result) => Ok(result),
        Err(err) if is_transport_error(&err) => {
            eprintln!(
                "[LCU-Force] transport error on PATCH {}, refreshing lockfile and retrying: {}",
                path, err
            );
            if let Some(fresh) = read_lockfile() {
                do_lcu_patch(client, &fresh, path, &payload)
                    .await
                    .map_err(|e| format!("LCU PATCH {} fallo (retry): {}", path, e))
            } else {
                Err(format!("LCU PATCH {} fallo: {} (lockfile refresh failed)", path, err))
            }
        }
        Err(err) => Err(format!("LCU PATCH {} fallo: {}", path, err)),
    }
}

async fn do_lcu_patch(
    client: &reqwest::Client,
    lockfile: &Lockfile,
    path: &str,
    payload: &serde_json::Value,
) -> Result<(bool, u16, String), reqwest::Error> {
    let response = client
        .patch(lcu_url(lockfile, path))
        .header("Authorization", lcu_auth(lockfile))
        .json(payload)
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    Ok((status.is_success(), status.as_u16(), text))
}

fn is_transport_error(err: &reqwest::Error) -> bool {
    err.is_connect() || err.is_timeout() || err.is_request()
}

async fn verify_lcu_skin(
    client: &reqwest::Client,
    lockfile: &Lockfile,
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
    write_cached_session(&session);
    local_selection(&session)
        .map(|(_, _, selected_skin_id)| selected_skin_id)
        .unwrap_or(0)
}

/// Load the local player's owned skin IDs directly from the LCU inventory.
/// This is the Rose-style fallback when the Pengu owned-skins message is late
/// or missing, so an owned target skin is never treated as unknown.
pub async fn fetch_owned_skins() -> Result<serde_json::Value, String> {
    let path = "/lol-inventory/v2/inventory/CHAMPION_SKIN";
    let lockfile = read_lockfile().ok_or_else(|| "LCU lockfile no encontrado.".to_string())?;
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| format!("No pude crear cliente LCU: {}", error))?;
    let auth =
        base64::engine::general_purpose::STANDARD.encode(format!("riot:{}", lockfile.password));
    let response = client
        .get(lcu_url(&lockfile, path))
        .header("Authorization", format!("Basic {}", auth))
        .send()
        .await
        .map_err(|error| format!("LCU no respondio: {}", error))?
        .error_for_status()
        .map_err(|error| format!("LCU respondio con error: {}", error))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Respuesta LCU invalida: {}", error))?;
    let items = response.as_array().ok_or_else(|| "Respuesta de inventario no es un array.".to_string())?;
    let owned_skin_ids: Vec<u64> = items
        .iter()
        .filter_map(|item| {
            item.get("itemId")
                .and_then(|v| v.as_u64())
                .or_else(|| item.get("skinId").and_then(|v| v.as_u64()))
                .or_else(|| item.get("id").and_then(|v| v.as_u64()))
                .or_else(|| item.get("inventoryTypeItemId").and_then(|v| v.as_u64()))
        })
        .filter(|id| *id > 0)
        .collect();
    Ok(serde_json::json!({
        "ownedSkinIds": owned_skin_ids,
        "count": owned_skin_ids.len(),
        "source": "lcu-inventory"
    }))
}

/// Force a champ-select skin directly through the authenticated LCU, matching
/// Rose's action-first, my-selection-fallback flow without a Pengu round trip.
#[allow(unused_assignments)]
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
    // Rose 1:1: read from cached session first (Rose: self.lcu.session).
    // The cached session is maintained by every successful LCU read. Using the
    // cache avoids the ~100-150ms HTTP round-trip that causes the pick action
    // to become `completed=true` before the PATCH arrives.
    let session_source;
    let session = if let Some(cached) = read_cached_session() {
        session_source = "cached";
        cached
    } else {
        session_source = "http";
        let fresh = client
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
        write_cached_session(&fresh);
        fresh
    };
    eprintln!("[LCU-Force] session source={}", session_source);
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
    let mut action_id_seen: Option<u64> = None;
    let mut action_completed_seen: Option<bool> = None;
    let mut last_error = String::new();

    if let Some((action_id, completed)) = local_pick_action(&session, local_cell_id) {
        action_id_seen = Some(action_id);
        action_completed_seen = Some(completed);
        eprintln!("[LCU-Force] pick action id={} completed={}", action_id, completed);
        // Rose 1:1: use the action endpoint only while the pick action is open.
        // Completed actions fall through to the my-selection fallback.
        if !completed {
            let path = format!("/lol-champ-select/v1/session/actions/{}", action_id);
            match lcu_patch_skin(&client, &lockfile, &path, selected_skin_id).await {
                Ok((true, status, _body)) => {
                    request_accepted = true;
                    method = "action".to_string();
                    eprintln!("[LCU-Force] action PATCH accepted status={} completed={}", status, completed);
                }
                Ok((_, status, body)) => {
                    last_error = format!(
                        "action HTTP {} {}",
                        status,
                        body.chars().take(240).collect::<String>()
                    );
                    eprintln!("[LCU-Force] action PATCH failed: {}", last_error);
                }
                Err(error) => {
                    eprintln!("[LCU-Force] action PATCH error: {}", error);
                    last_error = error;
                }
            }
        } else {
            last_error = "pick action already completed".to_string();
        }
    } else {
        last_error = "no local pick action found".to_string();
        eprintln!("[LCU-Force] {}", last_error);
    }

    // Rose 1:1: single my-selection fallback after action PATCH, then verify.
    // Rose does NOT retry aggressively — it sends one action PATCH, one
    // my-selection, waits BASE_SKIN_VERIFICATION_WAIT_S (150ms), verifies,
    // and moves on. Retrying for seconds races with ChampSelect→InProgress
    // and causes false-negative verification (session gone = verifiedSkinId=0).
    let verified;
    {
        // Try my-selection only as fallback, matching Rose.
        if !request_accepted {
            match lcu_patch_skin(
                &client,
                &lockfile,
                "/lol-champ-select/v1/session/my-selection",
                selected_skin_id,
            )
            .await
            {
                Ok((true, status, _body)) => {
                    request_accepted = true;
                    method = "my-selection".to_string();
                    eprintln!("[LCU-Force] my-selection PATCH accepted status={}", status);
                }
                Ok((_, status, body)) => {
                    last_error = format!(
                        "my-selection HTTP {} {}",
                        status,
                        body.chars().take(240).collect::<String>()
                    );
                    eprintln!("[LCU-Force] my-selection PATCH failed: {}", last_error);
                }
                Err(error) => {
                    eprintln!("[LCU-Force] my-selection PATCH error: {}", error);
                    last_error = error;
                }
            }
        }
        // Rose parity: single verify after BASE_SKIN_VERIFICATION_WAIT_S (150ms)
        verified = verify_lcu_skin(&client, &lockfile).await;
        eprintln!("[LCU-Force] verify desired={} verified={} method={}", selected_skin_id, verified, method);
    }
    let force_ok = verified == selected_skin_id;
    if force_ok {
        last_error.clear();
    } else if last_error.is_empty() {
        last_error = format!("LCU no confirmo {}; actual={}", selected_skin_id, verified);
    }
    Ok(serde_json::json!({
        "forceOk": force_ok,
        "requestAccepted": request_accepted,
        "forceMethod": method,
        "verifiedSkinId": verified,
        "forceError": last_error,
        "actionId": action_id_seen,
        "actionCompleted": action_completed_seen,
    }))
}

/// Rose-style: check if the local player's champion is locked in champ select.
/// Returns { championId, selectedSkinId } or 0s if not locked.
pub async fn check_champion_lock() -> Result<serde_json::Value, String> {
    let lockfile = match read_lockfile() {
        Some(lf) => lf,
        None => return Ok(serde_json::json!({"championId": 0, "selectedSkinId": 0})),
    };
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("LCU client: {}", e))?;
    let response = client
        .get(lcu_url(&lockfile, "/lol-champ-select/v1/session"))
        .header("Authorization", lcu_auth(&lockfile))
        .send()
        .await
        .map_err(|e| format!("LCU session: {}", e))?;
    if !response.status().is_success() {
        return Ok(serde_json::json!({"championId": 0, "selectedSkinId": 0}));
    }
    let session: serde_json::Value = response.json().await.map_err(|e| format!("LCU json: {}", e))?;
    let local_cell = session.get("localPlayerCellId").and_then(|v| v.as_i64()).unwrap_or(0);
    if local_cell == 0 {
        return Ok(serde_json::json!({"championId": 0, "selectedSkinId": 0}));
    }
    // Find completed pick action for local cell
    if let Some(actions) = session.get("actions").and_then(|v| v.as_array()) {
        for round in actions {
            if let Some(round_arr) = round.as_array() {
                for action in round_arr {
                    let actor = action.get("actorCellId").and_then(|v| v.as_i64()).unwrap_or(0);
                    if actor != local_cell { continue; }
                    let completed = action.get("completed").and_then(|v| v.as_bool()).unwrap_or(false);
                    if completed {
                        let champion_id = action.get("championId").and_then(|v| v.as_u64()).unwrap_or(0);
                        let selected_skin_id = action.get("selectedSkinId").and_then(|v| v.as_u64()).unwrap_or(0);
                        return Ok(serde_json::json!({
                            "championId": champion_id,
                            "selectedSkinId": selected_skin_id
                        }));
                    }
                }
            }
        }
    }
    Ok(serde_json::json!({"championId": 0, "selectedSkinId": 0}))
}

/// Rose-style countdown ticker: polls LCU timer to set/resync a local
/// monotonic deadline, fires when remaining <= threshold.
///
/// Matches Rose's LoadoutTicker:
///   - deadline from first successful poll (any timer phase)
///   - resync updates deadline only when candidate is shorter
///   - anti-jitter clamp (remain_ms never goes up)
///   - HTTP errors are non-fatal — countdown continues from local deadline
pub async fn wait_for_finalization_threshold(
    threshold_ms: u64,
) -> Result<serde_json::Value, String> {
    let threshold_ms = threshold_ms.clamp(0, 2_000);
    let lockfile = read_lockfile().ok_or_else(|| "LCU lockfile no encontrado.".to_string())?;
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| format!("No pude crear cliente LCU: {}", error))?;
    let started_at = Instant::now();
    let mut last_poll = Instant::now() - Duration::from_millis(200);
    let mut deadline: Option<Instant> = None;
    let mut prev_remain_ms = u64::MAX;

    loop {
        if started_at.elapsed() > Duration::from_secs(300) {
            return Err("Ticker expiro.".to_string());
        }

        // Periodic LCU resync (Rose-style)
        if last_poll.elapsed() >= Duration::from_millis(200) && deadline.is_some() {
            last_poll = Instant::now();
            if let Ok(response) = client
                .get(lcu_url(&lockfile, "/lol-champ-select/v1/session"))
                .header("Authorization", lcu_auth(&lockfile))
                .send()
                .await
            {
                if let Ok(session) = response.json::<serde_json::Value>().await {
                    write_cached_session(&session);
                    if let Some(timer) = session.get("timer").cloned() {
                        let left_ms = timer
                            .get("adjustedTimeLeftInPhase")
                            .and_then(|value| value.as_u64())
                            .unwrap_or(0);
                        if left_ms > 0 {
                            let candidate = Instant::now() + Duration::from_millis(left_ms);
                            // Only accept shorter deadline (Rose: line 85-86)
                            if deadline.map(|d| candidate < d).unwrap_or(true) {
                                deadline = Some(candidate);
                            }
                        }
                    }
                }
            }
        }

        // First deadline from initial poll (Rose: starts at first session event)
        if deadline.is_none() {
            if let Ok(response) = client
                .get(lcu_url(&lockfile, "/lol-champ-select/v1/session"))
                .header("Authorization", lcu_auth(&lockfile))
                .send()
                .await
            {
                if response.status().is_success() {
                    if let Ok(session) = response.json::<serde_json::Value>().await {
                        write_cached_session(&session);
                        if let Some(timer) = session.get("timer").cloned() {
                            let left_ms = timer
                                .get("adjustedTimeLeftInPhase")
                                .and_then(|value| value.as_u64())
                                .unwrap_or(0);
                            if left_ms > 0 {
                                deadline = Some(Instant::now() + Duration::from_millis(left_ms));
                            }
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
            continue;
        }

        // Local countdown (Rose-style)
        if let Some(deadline) = deadline {
            let mut remaining_ms = deadline
                .checked_duration_since(Instant::now())
                .unwrap_or_default()
                .as_millis() as u64;

            // Anti-jitter clamp: never go up (Rose: line 94-96)
            if remaining_ms > prev_remain_ms {
                remaining_ms = prev_remain_ms;
            }
            prev_remain_ms = remaining_ms;

            if remaining_ms <= threshold_ms {
                // Rose-style: read actual LCU selection at injection time so the
                // frontend doesn't rely on stale cached variables between games.
                // Also cache this session so force_selected_skin uses it without
                // an extra HTTP round-trip (Rose: self.lcu.session).
                let actual = match client
                    .get(lcu_url(&lockfile, "/lol-champ-select/v1/session"))
                    .header("Authorization", lcu_auth(&lockfile))
                    .send()
                    .await
                {
                    Ok(resp) => match resp.json::<serde_json::Value>().await {
                        Ok(session) => {
                            write_cached_session(&session);
                            local_selection(&session)
                        }
                        Err(_) => None,
                    },
                    Err(_) => None,
                };
                return Ok(serde_json::json!({
                    "ready": true,
                    "source": "rust-lcu-monotonic",
                    "thresholdMs": threshold_ms,
                    "remainingMs": remaining_ms,
                    "championId": actual.map(|(_, cid, _)| cid).unwrap_or(0),
                    "actualLcuSkinId": actual.map(|(_, _, sid)| sid).unwrap_or(0),
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

pub fn read_lockfile() -> Option<Lockfile> {
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

// =============================================================================
// Rose-style ownership helpers
// =============================================================================

/// Rose `is_default_skin()`: champion base skin always has skin_id % 1000 == 0.
/// e.g. champion 36 → base skin 36000, champion 123 → base skin 123000.
pub fn is_default_skin(skin_id: u64) -> bool {
    skin_id > 0 && skin_id % 1000 == 0
}

/// Rose `get_base_skin_id_for_champion()`: champion_id * 1000.
pub fn get_base_skin_id(champion_id: u64) -> u64 {
    champion_id * 1000
}

/// Rose `is_owned()`: base skin is always owned; otherwise check the set.
/// Returns `None` if owned_skins_ready is false (data not yet loaded).
pub fn is_skin_owned(owned_skin_ids: &std::collections::HashSet<u64>, skin_id: u64) -> Option<bool> {
    if skin_id == 0 {
        return None;
    }
    if is_default_skin(skin_id) {
        return Some(true);
    }
    Some(owned_skin_ids.contains(&skin_id))
}

/// Refresh owned skin IDs from LCU and update AppState.
/// Returns the count of owned skins, or an error.
pub async fn refresh_owned_skins(
    owned_skin_ids: &std::sync::Arc<std::sync::RwLock<std::collections::HashSet<u64>>>,
    owned_skins_ready: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<usize, String> {
    let result = fetch_owned_skins().await?;
    let ids = result
        .get("ownedSkinIds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_u64())
                .filter(|id| *id > 0)
                .collect::<Vec<u64>>()
        })
        .unwrap_or_default();
    let count = ids.len();
    if let Ok(mut set) = owned_skin_ids.write() {
        set.clear();
        set.extend(ids);
    }
    owned_skins_ready.store(true, std::sync::atomic::Ordering::SeqCst);
    eprintln!("[Rose-Ownership] Refreshed owned skins: {} skins loaded.", count);
    Ok(count)
}

/// Rose-style `force_skin_rose_style()`: the atomic ownership-aware force.
///
/// 1. Owned skin → PATCH the actual skin ID (game loads from Riot servers)
/// 2. Unowned skin → PATCH base skin (champion_id * 1000), overlay WAD remaps
/// 3. Chroma on owned base → PATCH the chroma ID
///
/// Returns the decision so the caller knows whether overlay WADs are needed.
pub async fn force_skin_rose_style(
    owned_skin_ids: &std::sync::Arc<std::sync::RwLock<std::collections::HashSet<u64>>>,
    owned_skins_ready: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    champion_id: u64,
    target_skin_id: u64,
    selected_chroma_id: Option<u64>,
) -> Result<serde_json::Value, String> {
    if champion_id == 0 || target_skin_id == 0 {
        return Err("championId/targetSkinId invalidos.".to_string());
    }

    let base_skin_id = get_base_skin_id(champion_id);

    // Determine effective skin ID (chroma takes precedence if it belongs to this skin)
    let effective_skin_id = if let Some(chroma_id) = selected_chroma_id {
        if chroma_id > 0 && chroma_id > target_skin_id && chroma_id < target_skin_id + 100 {
            chroma_id
        } else {
            target_skin_id
        }
    } else {
        target_skin_id
    };

    // Check ownership — scope the lock so the guard is dropped before any .await
    let (effective_owned, ui_owned, ready) = {
        let owned_set = owned_skin_ids.read().map_err(|e| format!("Lock poisoned: {}", e))?;
        let ready = owned_skins_ready.load(std::sync::atomic::Ordering::SeqCst);
        let effective_owned = is_skin_owned(&owned_set, effective_skin_id);
        let ui_owned = is_skin_owned(&owned_set, target_skin_id);
        (effective_owned, ui_owned, ready)
    };

    // Determine desired skin ID (Rose decision tree)
    let (desired_skin_id, branch, is_owned) = if effective_owned == Some(true) {
        // Rose `_force_owned_skin()`: PATCH actual owned skin ID
        (effective_skin_id, "owned-effective", true)
    } else if ui_owned == Some(true) && effective_skin_id != target_skin_id {
        // Rose: chroma on owned base — force the chroma ID (which is owned)
        (effective_skin_id, "owned-base-selected-chroma", true)
    } else {
        // Rose `_force_unowned_skin()`: force base skin, overlay WAD needed
        (base_skin_id, "always-force-base", false)
    };

    // If LCU already has the target skin and it's owned, skip force
    if is_owned && desired_skin_id != base_skin_id {
        // Read current LCU selection to check if already set (use cached session)
        let session = if let Some(cached) = read_cached_session() {
            cached
        } else {
            read_lcu_json("/lol-champ-select/v1/session").await.unwrap_or(serde_json::Value::Null)
        };
        if let Some((_, _, current_skin_id)) = local_selection(&session) {
            if current_skin_id == desired_skin_id {
                return Ok(serde_json::json!({
                    "forceOk": true,
                    "forceMethod": "already-selected",
                    "verifiedSkinId": current_skin_id,
                    "desiredSkinId": desired_skin_id,
                    "isOwned": is_owned,
                    "branch": branch,
                    "needsOverlay": false,
                }));
            }
        }
    }

    // Force via LCU
    let force_result = force_selected_skin(champion_id, desired_skin_id).await?;

    // For unowned skins, also send skip-base-skin broadcast
    if !is_owned {
        eprintln!("[Rose-Ownership] Unowned skin {} — forced base {}; overlay WAD needed.", target_skin_id, base_skin_id);
    } else {
        eprintln!("[Rose-Ownership] Owned skin {} — forced desiredSkinId={}; branch={}.", target_skin_id, desired_skin_id, branch);
    }

    // Determine if overlay is needed
    // Owned skins without chromas/custom mods: NO overlay needed
    // Unowned skins: YES overlay needed (WAD remaps base → target)
    // Chromas: YES overlay needed (chroma texture)
    let needs_overlay = !is_owned || selected_chroma_id.is_some();

    Ok(serde_json::json!({
        "forceOk": force_result.get("forceOk").and_then(|v| v.as_bool()).unwrap_or(false),
        "requestAccepted": force_result.get("requestAccepted").and_then(|v| v.as_bool()).unwrap_or(false),
        "forceMethod": force_result.get("forceMethod").and_then(|v| v.as_str()).unwrap_or(""),
        "verifiedSkinId": force_result.get("verifiedSkinId").and_then(|v| v.as_u64()).unwrap_or(0),
        "forceError": force_result.get("forceError").and_then(|v| v.as_str()).unwrap_or(""),
        "desiredSkinId": desired_skin_id,
        "isOwned": is_owned,
        "branch": branch,
        "needsOverlay": needs_overlay,
        "championBaseId": base_skin_id,
        "ownedReady": ready,
    }))
}

