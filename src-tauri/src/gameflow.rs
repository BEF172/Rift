use crate::overlay;
use base64::Engine;
use std::path::PathBuf;
use std::time::{Duration, Instant};

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
    let mut action_id_seen: Option<u64> = None;
    let mut action_completed_seen: Option<bool> = None;
    let mut last_error = String::new();

    if let Some((action_id, completed)) = local_pick_action(&session, local_cell_id) {
        action_id_seen = Some(action_id);
        action_completed_seen = Some(completed);
        eprintln!("[LCU-Force] pick action id={} completed={}", action_id, completed);
        // Rose 1:1: always try the action PATCH first, even when completed.
        // The LCU still accepts skin changes on completed actions; my-selection
        // PATCH alone does not override the locked selectedSkinId after lock-in.
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
        last_error = "no local pick action found".to_string();
        eprintln!("[LCU-Force] {}", last_error);
    }

    // Rose 1:1: retry loop. The LCU sometimes accepts a PATCH (204) but the
    // skin does not actually change because of a race with the client's
    // internal state machine. Rose retries until confirmation or timeout.
    // Rose retries for ~2-3 seconds; we use 10 attempts × 250ms = 2.5s.
    const MAX_FORCE_RETRIES: u32 = 10;
    const RETRY_DELAY_MS: u64 = 250;
    let mut attempt = 0u32;
    let mut verified = 0u64;
    let mut last_method = method.clone();
    loop {
        attempt += 1;
        // Rose parity: always try my-selection as fallback when previous attempt
        // did not confirm the desired skin, regardless of whether action PATCH
        // was accepted. The LCU silently accepts action PATCHes on completed
        // actions (204) without actually changing selectedSkinId.
        if verified != selected_skin_id {
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
                    last_method = "my-selection".to_string();
                    eprintln!("[LCU-Force] my-selection PATCH accepted status={} attempt={}", status, attempt);
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
        verified = verify_lcu_skin(&client, &lockfile).await;
        eprintln!("[LCU-Force] verify desired={} verified={} attempt={} method={}", selected_skin_id, verified, attempt, last_method);
        if verified == selected_skin_id || attempt >= MAX_FORCE_RETRIES {
            break;
        }
        eprintln!("[LCU-Force] retry {}/{} in {}ms", attempt, MAX_FORCE_RETRIES, RETRY_DELAY_MS);
        tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS)).await;
    }
    method = last_method;
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
                let actual = match client
                    .get(lcu_url(&lockfile, "/lol-champ-select/v1/session"))
                    .header("Authorization", lcu_auth(&lockfile))
                    .send()
                    .await
                {
                    Ok(resp) => match resp.json::<serde_json::Value>().await {
                        Ok(session) => local_selection(&session),
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



