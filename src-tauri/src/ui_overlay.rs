use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::{Arc, RwLock};
use tauri::Emitter;

/// Rose-style SharedState fields relevant to the main loop UI decisions.
pub struct UiOverlayState {
    pub phase: Option<String>,
    pub ui_skin_id: Option<i32>,
    pub ui_skin_name: Option<String>,
    pub last_hovered_skin_id: Option<i32>,
    pub last_hovered_skin_key: Option<String>,
    pub locked_champ_id: Option<i32>,
    pub locked_champ_name: Option<String>,
    pub selected_skin_id: Option<i32>,
    pub selected_chroma_id: Option<i32>,
    pub chroma_panel_open: bool,
    pub pending_chroma_selection: bool,
    pub champion_exchange_triggered: bool,
    pub own_champion_locked: bool,
    pub reset_skin_notification: bool,
    pub is_swiftplay_mode: bool,
    pub game_mode: Option<String>,
    pub queue_id: Option<u64>,
    // Debounce tracking (owned by main loop, not shared)
    pub last_notified_skin_id: Option<i32>,
}

impl UiOverlayState {
    pub fn new() -> Self {
        Self {
            phase: None,
            ui_skin_id: None,
            ui_skin_name: None,
            last_hovered_skin_id: None,
            last_hovered_skin_key: None,
            locked_champ_id: None,
            locked_champ_name: None,
            selected_skin_id: None,
            selected_chroma_id: None,
            chroma_panel_open: false,
            pending_chroma_selection: false,
            champion_exchange_triggered: false,
            own_champion_locked: false,
            reset_skin_notification: false,
            is_swiftplay_mode: false,
            game_mode: None,
            queue_id: None,
            last_notified_skin_id: None,
        }
    }

    /// Consume pending event flags and return them so the caller can react.
    pub fn take_pending(&mut self) -> PendingUiEvents {
        PendingUiEvents {
            champion_exchange: std::mem::replace(&mut self.champion_exchange_triggered, false),
            reset_skin: std::mem::replace(&mut self.reset_skin_notification, false),
        }
    }
}

/// Flags that were set by event producers (lcu_monitor, ws_server) and
/// need to be consumed by the main loop in its next iteration.
pub struct PendingUiEvents {
    pub champion_exchange: bool,
    pub reset_skin: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct UiCommand {
    #[serde(rename = "type")]
    pub cmd_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skin_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skin_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub champion_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub champion_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_chromas: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chroma_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_skin_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_chromas: Option<Vec<ChromaInfo>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChromaInfo {
    pub id: i32,
    pub name: String,
}

impl UiCommand {
    pub fn show_skin(skin_id: i32, skin_name: &str, champion_name: &str, champion_id: i32, has_chromas: bool) -> Self {
        Self {
            cmd_type: "show-skin".into(),
            skin_id: Some(skin_id),
            skin_name: Some(skin_name.into()),
            champion_id: Some(champion_id),
            champion_name: Some(champion_name.into()),
            has_chromas: Some(has_chromas),
            chroma_id: None,
            base_skin_id: None,
            available_chromas: None,
        }
    }

    pub fn champion_exchange(champion_id: Option<i32>) -> Self {
        Self {
            cmd_type: "champion-exchange".into(),
            skin_id: None,
            skin_name: None,
            champion_id,
            champion_name: None,
            has_chromas: None,
            chroma_id: None,
            base_skin_id: None,
            available_chromas: None,
        }
    }
}

/// Rose-style main loop. Polls UiOverlayState at 16-50ms intervals,
/// makes UI decisions, and emits `ui:command` events to the frontend.
pub async fn run_ui_overlay_loop(
    state: Arc<RwLock<UiOverlayState>>,
    handle: tauri::AppHandle,
    shutdown_cleanup: Arc<std::sync::atomic::AtomicBool>,
) {
    let mut last_phase: Option<String> = None;
    let mut last_loop_time = std::time::Instant::now();
    let mut last_notified_skin_id: Option<i32> = None;

    loop {
        if shutdown_cleanup.load(Ordering::SeqCst) {
            break;
        }

        let loop_start = std::time::Instant::now();
        let time_since_last = loop_start.duration_since(last_loop_time);
        if time_since_last.as_secs_f64() > 5.0 {
            eprintln!("[UiOverlay] Main loop stall detected: {:.2}s gap", time_since_last.as_secs_f64());
        }
        last_loop_time = loop_start;

        // Rose-style: process UI updates synchronously (lock acquired and released in one shot)
        let ui_activity = process_ui_updates_sync(
            &state,
            &handle,
            &mut last_notified_skin_id,
            &mut last_phase,
        );

        if shutdown_cleanup.load(Ordering::SeqCst) {
            break;
        }

        // Adaptive sleep: 16ms if UI active, 50ms if idle (Rose constants)
        let sleep_ms = if ui_activity { 16u64 } else { 50u64 };
        tokio::time::sleep(std::time::Duration::from_millis(sleep_ms)).await;
    }

    eprintln!("[UiOverlay] Main loop stopped (shutdown).");
}

/// Synchronous helper that acquires the lock, processes UI, drops the lock,
/// and returns whether any UI activity is pending.  This keeps the non‑Send
/// `RwLockWriteGuard` out of the async state machine.
fn process_ui_updates_sync(
    state: &RwLock<UiOverlayState>,
    handle: &tauri::AppHandle,
    last_notified_skin_id: &mut Option<i32>,
    last_phase: &mut Option<String>,
) -> bool {
    let mut s = match state.write() {
        Ok(s) => s,
        Err(_) => return false,
    };

    // Phase change detection (Rose-style)
    if s.phase.is_some() && s.phase != *last_phase {
        if let Some(ref phase) = s.phase {
            eprintln!("[UiOverlay] Phase changed: {} -> {}", last_phase.as_deref().unwrap_or("?"), phase);
        }
        *last_phase = s.phase.clone();
    }

    // Consume pending event flags
    let pending = s.take_pending();
    drop(s); // Explicitly drop the lock guard

    // --- Rose-style _process_ui_updates equivalent ---
    let mut activity = false;

    // Phase 1: Skin notification with debounce (Rose's show_skin via UserInterface)
    // Read current values from state (lock acquired again briefly)
    let (current_skin_id, current_champ_id, current_skin_name, locked_champ_name, chroma_panel_open, pending_chroma) = {
        let s2 = match state.read() {
            Ok(s) => s,
            Err(_) => return false,
        };
        (
            s2.last_hovered_skin_id,
            s2.locked_champ_id,
            s2.ui_skin_name.clone(),
            s2.locked_champ_name.clone(),
            s2.chroma_panel_open,
            s2.pending_chroma_selection,
        )
    };

    if let (Some(skin_id), Some(champ_id)) = (current_skin_id, current_champ_id) {
        let needs_notify = if pending.reset_skin {
            *last_notified_skin_id = None;
            true
        } else {
            last_notified_skin_id.map_or(true, |last| last != skin_id)
        };

        if needs_notify {
            let champ_name = locked_champ_name.as_deref().unwrap_or("");
            let skin_name = current_skin_name.as_deref().unwrap_or("");
            let has_chromas = false; // TODO: query from LCU scrapper

            let _ = handle.emit(
                "ui:command",
                UiCommand::show_skin(skin_id, skin_name, champ_name, champ_id, has_chromas),
            );
            activity = true;
            *last_notified_skin_id = Some(skin_id);
        }
    }

    // Phase 2: Champion exchange (Rose: champion_exchange_triggered)
    if pending.champion_exchange {
        let _ = handle.emit("ui:command", UiCommand::champion_exchange(current_champ_id));
        activity = true;
    }

    // Phase 3: Chroma panel activity (Rose: check pending flags)
    if chroma_panel_open || pending_chroma {
        activity = true;
    }

    activity
}
