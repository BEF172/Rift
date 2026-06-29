use serde::{Deserialize, Serialize};
use std::sync::Mutex as StdMutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tokio::sync::{broadcast, Mutex};

mod asset_server;
pub mod base_skin_tracker;
mod commands;
pub mod config;
mod downloads;
mod gameflow;
pub mod junction;
pub mod lcu_monitor;
pub mod mod_storage;
mod overlay;
mod rose_overlay;
mod ui_overlay;
mod ws_server;

/// Binary / engine directory — lives next to the exe (read-only OK).
pub(crate) fn install_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(std::path::Path::to_path_buf))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

/// Writable data directory — always `%LOCALAPPDATA%\Rift Atlas`.
///
/// All mutable runtime data (overlay cache, downloaded skins, configs,
/// Pengu Loader, etc.) MUST live here so that League of Legends (running
/// as a normal user) can read overlay files even when the app is installed
/// in a protected location like `C:\Program Files`.
pub(crate) fn writable_data_dir() -> std::path::PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(std::path::PathBuf::from)
                .map(|p| p.join("AppData").join("Local"))
        })
        .unwrap_or_else(|| install_dir())
        .join("Rift Atlas")
}

/// Migrate data from a previous build that stored everything next to the
/// exe into `%LOCALAPPDATA%\Rift Atlas`.  Existing files in the dest win.
#[cfg(not(debug_assertions))]
fn migrate_to_writable_data_dir(install_dir: &std::path::Path) {
    let writable = writable_data_dir();
    if install_dir == writable
        || install_dir
            .to_string_lossy()
            .eq_ignore_ascii_case(&writable.to_string_lossy())
    {
        return;
    }
    // Only migrate if LOCALAPPDATA is different from install_dir
    fn merge_missing(
        source: &std::path::Path,
        destination: &std::path::Path,
    ) -> std::io::Result<()> {
        if source.is_dir() {
            std::fs::create_dir_all(destination)?;
            for entry in std::fs::read_dir(source)? {
                let entry = entry?;
                merge_missing(&entry.path(), &destination.join(entry.file_name()))?;
            }
        } else if !destination.exists() {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(source, destination)?;
        }
        Ok(())
    }

    // Directories to migrate (mutable data that League needs to read)
    let migrate_dirs = [
        "overlay",
        "cslol-profiles",
        "downloaded-libraries",
        "Rose",
        "ltk-manager",
    ];
    for dir_name in &migrate_dirs {
        let src = install_dir.join(dir_name);
        let dst = writable.join(dir_name);
        if src.is_dir() && !dst.exists() {
            eprintln!("[Startup] Migrando {} -> {}", src.display(), dst.display());
            if let Err(error) = merge_missing(&src, &dst) {
                eprintln!("[Startup] Error migrando {}: {}", src.display(), error);
            }
        }
    }
}

// App State

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

pub struct AppState {
    pub pengu_bridge_server: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    pub pengu_bridge_tx: Mutex<Option<broadcast::Sender<String>>>,
    pub pengu_bridge_port: Mutex<u16>,
    pub running_overlay_process: Mutex<Option<u32>>,
    pub running_overlay_alive: Mutex<Option<Arc<AtomicBool>>>,
    pub running_overlay_ready: Mutex<Option<Arc<AtomicBool>>>,
    pub active_overlay_run: Mutex<bool>,
    pub overlay_cancel_epoch: Arc<AtomicU64>,
    pub current_overlay_error: Mutex<String>,
    pub current_overlay_path: Mutex<String>,
    pub current_gameflow_phase: Mutex<String>,
    pub overlay_log: Mutex<String>,
    pub app_data_dir: Mutex<String>,
    pub early_monitor_active: Arc<AtomicBool>,
    pub early_monitor_pid: Arc<StdMutex<Option<u32>>>,
    pub early_monitor_runoverlay_started: Arc<AtomicBool>,
    pub suspended_pid: Mutex<Option<u32>>,
    pub shutdown_cleanup_started: Arc<AtomicBool>,
    pub debug_mode: bool,
    pub bridge_ready: Arc<AtomicBool>,
    pub ui_overlay: Arc<RwLock<ui_overlay::UiOverlayState>>,
    pub selected_mods: Mutex<std::collections::HashMap<String, serde_json::Value>>,
}

fn begin_shutdown_cleanup(app: &AppHandle) {
    let state = app.state::<AppState>();
    let cleanup_started = state.shutdown_cleanup_started.clone();
    if cleanup_started
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        let app_dir = state.app_data_dir.blocking_lock().clone();
        state.early_monitor_active.store(false, Ordering::SeqCst);
        state.early_monitor_runoverlay_started.store(false, Ordering::SeqCst);
        state.overlay_cancel_epoch.fetch_add(1, Ordering::SeqCst);
        let early_pid = match state.early_monitor_pid.lock() {
            Ok(mut pid) => pid.take(),
            Err(poisoned) => poisoned.into_inner().take(),
        };
        if let Some(pid) = early_pid {
            let _ = overlay::resume_league_by_pid(pid);
        }
        if let Some(pid) = state.suspended_pid.blocking_lock().take() {
            let _ = overlay::resume_league_by_pid(pid);
        }
        let overlay_pid = state.running_overlay_process.blocking_lock().take();
        let overlay_path = state.current_overlay_path.blocking_lock().clone();
        let app_handle = app.clone();
        std::thread::spawn(move || {
            if let Some(pid) = overlay_pid {
                overlay::stop_patcher(pid, &overlay_path);
            }
            overlay::kill_all_runoverlay_processes();
            if !overlay_path.is_empty() {
                overlay::wipe_overlay_dir(&overlay_path);
            }
            commands::pengu_shutdown_cleanup(&app_dir);
            // Rose-style: free console if we allocated one
            #[cfg(windows)]
            unsafe {
                windows_sys::Win32::System::Console::FreeConsole();
            }
            app_handle.exit(0);
        });
    } else {
        app.exit(0);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModEntry {
    pub path: String,
    pub name: String,
    pub skin: String,
    pub champion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkinEntry {
    pub path: String,
    pub name: String,
    pub skin_id: Option<String>,
    pub champion_id: Option<String>,
}

// App entry point

/// Rose-style startup checks: single instance, admin rights, DLL hash
#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Rose-style: remove old Pengu Loader IFEO registry entry that can cause
/// League client crashes with newer Pengu versions.
#[cfg(windows)]
fn cleanup_old_pengu_ifeo() {
    use windows_sys::Win32::System::Registry::*;
    use windows_sys::Win32::Foundation::*;
    const IFEO_KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\LeagueClientUx.exe";
    let key = to_wide(IFEO_KEY);
    unsafe {
        let mut hkey: HKEY = std::ptr::null_mut();
        let status = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            0,
            KEY_READ | KEY_WOW64_64KEY,
            &mut hkey,
        );
        if status == ERROR_SUCCESS {
            RegCloseKey(hkey);
            // Key exists — delete it
            let _ = RegDeleteKeyW(HKEY_LOCAL_MACHINE, key.as_ptr());
            eprintln!("[Startup] Cleaned up old Pengu Loader IFEO registry entry.");
        }
    }
}

/// Rose-style: wait for LCU to be reachable before activating Pengu.
/// Polls the lockfile + does a simple HTTP GET to verify the LCU responds.
async fn wait_for_lcu_ready(timeout: std::time::Duration) -> bool {
    use base64::Engine;
    let start = std::time::Instant::now();
    loop {
        if start.elapsed() > timeout {
            eprintln!("[Startup] LCU not reachable after {:?} — proceeding without it.", timeout);
            return false;
        }
        let lockfile_path = {
            let mut candidates = Vec::new();
            if let Ok(path) = std::env::var("LCU_LOCKFILE") {
                candidates.push(std::path::PathBuf::from(path));
            }
            candidates.extend([
                std::path::PathBuf::from(r"C:\Riot Games\League of Legends\lockfile"),
                std::path::PathBuf::from(r"D:\Riot Games\League of Legends\lockfile"),
            ]);
            for var in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
                if let Some(root) = std::env::var_os(var) {
                    candidates.push(
                        std::path::PathBuf::from(root)
                            .join("Riot Games")
                            .join("League of Legends")
                            .join("lockfile"),
                    );
                }
            }
            for name in ["LeagueClientUx.exe", "LeagueClient.exe"] {
                if let Some(dir) = overlay::find_process_exe_path(name) {
                    candidates.push(std::path::PathBuf::from(dir).join("lockfile"));
                }
            }
            candidates.into_iter().find(|p| p.is_file())
        };
        let lockfile = match lockfile_path {
            Some(path) => match std::fs::read_to_string(path) {
                Ok(content) => content,
                Err(_) => {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    continue;
                }
            },
            None => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }
        };
        let parts: Vec<&str> = lockfile.trim().splitn(5, ':').collect();
        if parts.len() != 5 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            continue;
        }
        let port: u16 = match parts[2].parse() {
            Ok(p) => p,
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }
        };
        let password = parts[3];
        let auth = base64::engine::general_purpose::STANDARD
            .encode(format!("riot:{}", password));
        let url = format!("https://127.0.0.1:{}/lol-gameflow/v1/gameflow-phase", port);
        let client = match reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(2))
            .build()
        {
            Ok(c) => c,
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }
        };
        match client.get(&url).header("Authorization", format!("Basic {}", auth)).send().await {
            Ok(resp) if resp.status().is_success() => {
                eprintln!("[Startup] LCU reachable after {:?}.", start.elapsed());
                return true;
            }
            _ => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }
        }
    }
}

#[cfg(windows)]
unsafe fn check_single_instance_windows() {
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::System::Threading::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    let name = to_wide("Local\\RiftAtlasSingleInstance");
    let handle = CreateMutexW(std::ptr::null(), 0, name.as_ptr());
    if handle.is_null() {
        eprintln!("[Startup] CreateMutexW failed — allowing multiple instances.");
        return;
    }
    if GetLastError() == ERROR_ALREADY_EXISTS {
        CloseHandle(handle);
        let msg = to_wide("Another instance of Rift Atlas is already running!\n\nPlease close the existing instance before starting a new one.");
        let title = to_wide("Rift Atlas - Instance Already Running");
        MessageBoxW(std::ptr::null_mut(), msg.as_ptr(), title.as_ptr(), 0x50010);
        std::process::exit(1);
    }
    // Keep handle alive for process lifetime (released on exit)
}

#[cfg(windows)]
unsafe fn ensure_admin_rights_windows() {
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::Security::*;
    use windows_sys::Win32::System::Threading::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    let mut token: HANDLE = std::ptr::null_mut();
    if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == FALSE {
        eprintln!("[Startup] OpenProcessToken failed — cannot check admin rights.");
        return;
    }
    let mut elevation: TOKEN_ELEVATION = std::mem::zeroed();
    let mut return_len: u32 = 0;
    let result = GetTokenInformation(
        token,
        TokenElevation,
        &mut elevation as *mut _ as *mut std::ffi::c_void,
        std::mem::size_of::<TOKEN_ELEVATION>() as u32,
        &mut return_len,
    );
    CloseHandle(token);

    if result == FALSE || elevation.TokenIsElevated == 0 {
        let msg = to_wide("Rift Atlas requires administrator privileges for skin injection.\n\nPlease restart the application as Administrator.");
        let title = to_wide("Rift Atlas - Admin Required");
        MessageBoxW(std::ptr::null_mut(), msg.as_ptr(), title.as_ptr(), 0x50010);
        std::process::exit(1);
    }
}

/// Rose-style: update DisplayVersion in the Windows uninstall registry so that
/// "Apps & features" shows the correct version after auto-updates.
#[cfg(windows)]
fn update_uninstall_registry_version() {
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::System::Registry::*;
    // Tauri NSIS registers perMachine installs under the bundle identifier
    const KEY_PATH: &str =
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.riftatlas.desktop";
    let wide_key = to_wide(KEY_PATH);
    let version = env!("CARGO_PKG_VERSION");
    let wide_version = to_wide(version);
    unsafe {
        let mut hkey: HKEY = std::ptr::null_mut();
        let status = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            wide_key.as_ptr(),
            0,
            KEY_SET_VALUE,
            &mut hkey,
        );
        if status == ERROR_SUCCESS {
            RegSetValueExW(
                hkey,
                to_wide("DisplayVersion").as_ptr(),
                0,
                REG_SZ,
                wide_version.as_ptr() as *const u8,
                (wide_version.len() * 2) as u32,
            );
            RegCloseKey(hkey);
            eprintln!("[Startup] Registry DisplayVersion updated to {}", version);
        } else {
            // Also try HKCU (perUser installs)
            let wide_alt = to_wide(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.riftatlas.desktop",
            );
            let mut hkey2: HKEY = std::ptr::null_mut();
            let status2 = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                wide_alt.as_ptr(),
                0,
                KEY_SET_VALUE,
                &mut hkey2,
            );
            if status2 == ERROR_SUCCESS {
                RegSetValueExW(
                    hkey2,
                    to_wide("DisplayVersion").as_ptr(),
                    0,
                    REG_SZ,
                    wide_version.as_ptr() as *const u8,
                    (wide_version.len() * 2) as u32,
                );
                RegCloseKey(hkey2);
                eprintln!("[Startup] HKCU Registry DisplayVersion updated to {}", version);
            }
        }
    }
}

pub fn run() {
    env_logger::init();
    let debug_mode = std::env::args().any(|arg| {
        let normalized = arg.trim().to_ascii_lowercase();
        normalized == "-debug" || normalized == "--debug" || normalized == "/debug"
    });

    // Rose-style startup checks
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::SetProcessDPIAware();
        check_single_instance_windows();
        ensure_admin_rights_windows();
    }

    // Rose-style: check for leftover dirty flag from unclean shutdown
    {
        let dirty_flag = writable_data_dir().join(".pengu-active");
        if dirty_flag.exists() {
            eprintln!("[Startup] Leftover Pengu active flag detected — previous session may have crashed.");
            let _ = std::fs::remove_file(&dirty_flag);
            commands::cleanup_pengu_proxy_on_startup(&install_dir().to_string_lossy().to_string());
            if let Some(executable_path) = commands::search_pengu_exe_wide(&writable_data_dir().to_string_lossy()) {
                let _ = commands::run_pengu_loader_cli(&executable_path, &["--force-deactivate", "--silent"]);
            }
        }
    }

    // Rose-style: sync DisplayVersion in uninstall registry
    #[cfg(windows)]
    update_uninstall_registry_version();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            pengu_bridge_server: Mutex::new(None),
            pengu_bridge_tx: Mutex::new(None),
            pengu_bridge_port: Mutex::new(0),
            running_overlay_process: Mutex::new(None),
            running_overlay_alive: Mutex::new(None),
            running_overlay_ready: Mutex::new(None),
            active_overlay_run: Mutex::new(false),
            overlay_cancel_epoch: Arc::new(AtomicU64::new(0)),
            current_overlay_error: Mutex::new(String::new()),
            current_overlay_path: Mutex::new(String::new()),
            current_gameflow_phase: Mutex::new(String::new()),
            overlay_log: Mutex::new(String::new()),
            app_data_dir: Mutex::new(String::new()),
            early_monitor_active: Arc::new(AtomicBool::new(false)),
            early_monitor_pid: Arc::new(StdMutex::new(None)),
            early_monitor_runoverlay_started: Arc::new(AtomicBool::new(false)),
            suspended_pid: Mutex::new(None),
            shutdown_cleanup_started: Arc::new(AtomicBool::new(false)),
            debug_mode,
            bridge_ready: Arc::new(AtomicBool::new(false)),
            ui_overlay: Arc::new(RwLock::new(ui_overlay::UiOverlayState::new())),
            selected_mods: Mutex::new(std::collections::HashMap::new()),
        })
        .setup(move |app| {
            let app_data = install_dir();
            let writable_data = writable_data_dir();
            #[cfg(not(debug_assertions))]
            migrate_to_writable_data_dir(&app_data);
            std::fs::create_dir_all(&writable_data).ok();

            // WebView2 needs to write cache/profile data. This MUST live in
            // a writable directory.
            let webview_data_dir = writable_data.join("webview-data");

            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Rift Atlas")
            .inner_size(1200.0, 800.0)
            .min_inner_size(1040.0, 680.0)
            .resizable(true)
            .decorations(false)
            .maximized(true)
            .data_directory(webview_data_dir)
            .build()?;

            let state = app.state::<AppState>();
            // app_data_dir = writable location (LOCALAPPDATA) for overlays, downloads, etc.
            *state.app_data_dir.blocking_lock() = writable_data.to_string_lossy().to_string();

            // Startup: detect League paths (Rose-style) and emit to frontend
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                    match commands::detect_league_path().await {
                        Ok(result) => {
                            let _ = handle.emit("app:league-detected", result);
                        }
                        Err(e) => {
                            eprintln!("[Startup] detect_league_path failed: {}", e);
                        }
                    }
                });
            }

            // Listen for window maximize/unmaximize and emit to frontend
            {
                let handle = app.handle().clone();
                if let Some(window) = app.get_webview_window("main") {
                    let w = window.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::Resized(_) = event {
                            if let Ok(maximized) = w.is_maximized() {
                                let _ = handle.emit(
                                    "app:window-maximize-changed",
                                    serde_json::json!({
                                        "maximized": maximized,
                                    }),
                                );
                            }
                        }
                    });
                }
            }
            // Rose-style bridge discovery does not use a persisted authentication
            // token. Remove the legacy file left by older Rift Atlas builds.
            let _ = std::fs::remove_file(writable_data.join("bridge-token.txt"));
            // Crear canal broadcast para mensajes del bridge
            let (tx, _rx) = broadcast::channel::<String>(100);
            *state.pengu_bridge_tx.blocking_lock() = Some(tx);

            // Initialize plugin resource dir from bundled resources
            commands::init_pengu_plugin_resource_dir(app.handle());
            match commands::pengu_install_rift_plugin_inner(&writable_data.to_string_lossy()) {
                Ok(result) => {
                    eprintln!("[PenguPlugin] Plugins sincronizados al iniciar: {}", result)
                }
                Err(error) => eprintln!(
                    "[PenguPlugin] No pude sincronizar plugins al iniciar: {}",
                    error
                ),
            }

            // Iniciar servidor WebSocket bridge
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                ws_server::start_bridge(handle).await;
            });

            // Rose-style LCU WAMP WebSocket + health monitor + language
            // detection + disconnect/reconnect + late-lock recovery.
            let lcu_monitor_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                lcu_monitor::start(lcu_monitor_handle).await;
            });

            // Emitir estado inicial del bridge
            let _ = app.emit(
                "pengu:bridge-status",
                serde_json::json!({
                    "running": true,
                    "port": 0,
                    "discovering": true,
                }),
            );

            // Iniciar servidor de assets (previews HTTP, puerto 45732)
            // Asset server serves downloaded skins → writable data dir
            let asset_app_dir = writable_data.to_string_lossy().to_string();
            tauri::async_runtime::spawn(async move {
                asset_server::start_asset_server(asset_app_dir).await;
            });

            // Rose-style: cleanup old IFEO registry entry that can crash the client
            #[cfg(windows)]
            cleanup_old_pengu_ifeo();

            // Rose-style: wait for LCU to be reachable, then activate Pengu
            // (instead of a fixed 1500ms sleep). This matches Rose's flow:
            // start threads -> wait for WS -> activate Pengu -> init injection.
            let startup_app_dir = app_data.to_string_lossy().to_string();
            let startup_token_dir = writable_data.to_string_lossy().to_string();
            let startup_shutdown_cleanup = state.shutdown_cleanup_started.clone();
            let bridge_ready = state.bridge_ready.clone();
            tauri::async_runtime::spawn(async move {
                if startup_shutdown_cleanup.load(Ordering::SeqCst) {
                    return;
                }
                // Rose-style: wait for bridge WS server first (PenguSkinMonitorThread ready_event, 5s timeout)
                {
                    let start = std::time::Instant::now();
                    while !bridge_ready.load(Ordering::SeqCst) && start.elapsed() < std::time::Duration::from_secs(5) {
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                    if startup_shutdown_cleanup.load(Ordering::SeqCst) {
                        return;
                    }
                }
                // Rose-style: wait for LCU WebSocket status to be active (indefinite, like Rose)
                eprintln!("[Startup] Waiting for LCU WebSocket status to be active...");
                loop {
                    if startup_shutdown_cleanup.load(Ordering::SeqCst) {
                        return;
                    }
                    if wait_for_lcu_ready(std::time::Duration::from_secs(5)).await {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
                if startup_shutdown_cleanup.load(Ordering::SeqCst) {
                    return;
                }
                commands::pengu_startup_init(&startup_app_dir, &startup_token_dir);
            });

            // Auto-activation watcher (checkea League cada 2.5s como Electron)
            let watcher_app_dir = app_data.to_string_lossy().to_string();
            let watcher_token_dir = writable_data.to_string_lossy().to_string();
            let watcher_shutdown_cleanup = state.shutdown_cleanup_started.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(2500));
                // Skip first tick (immediate), wait for interval
                interval.tick().await;
                loop {
                    interval.tick().await;
                    if watcher_shutdown_cleanup.load(Ordering::SeqCst) {
                        break;
                    }
                    commands::pengu_try_auto_activate(&watcher_app_dir, &watcher_token_dir);
                }
            });

            let app_dir_for_tutorial = writable_data.clone();
            let tutorial_handle = app.handle().clone();
            let startup_debug_mode = debug_mode;
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                let first_run = !app_dir_for_tutorial.join(".first-run-complete").exists();
                if first_run {
                    let _ = tutorial_handle.emit(
                        "app:start-tutorial",
                        serde_json::json!({
                            "firstRun": true,
                            "flags": {
                                "debug": startup_debug_mode,
                            },
                        }),
                    );
                }
            });

            // Rose-style UI overlay main loop
            {
                let uh = app.handle().clone();
                let ustate = state.ui_overlay.clone();
                let ushutdown = state.shutdown_cleanup_started.clone();
                tauri::async_runtime::spawn(async move {
                    ui_overlay::run_ui_overlay_loop(ustate, uh, ushutdown).await;
                });
            }

            if debug_mode {
                // Allocate a console window for debug output (like Rose's CMD)
                #[cfg(windows)]
                unsafe {
                    windows_sys::Win32::System::Console::AllocConsole();
                }
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
                let _ = app.emit(
                    "app:debug-mode",
                    serde_json::json!({
                        "enabled": true,
                        "source": "-debug",
                    }),
                );
            }

            let show_item = MenuItem::with_id(app, "show", "Abrir Rift Atlas", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Cerrar Rift Atlas", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let tray_icon = app.default_window_icon().cloned();
            let mut tray_builder = TrayIconBuilder::with_id("main")
                .tooltip("Rift Atlas")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        begin_shutdown_cleanup(app);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                });
            if let Some(icon) = tray_icon {
                tray_builder = tray_builder.icon(icon);
            }
            tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // App
            commands::get_app_version,
            commands::window_start_dragging,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_is_maximized,
            commands::window_hide,
            commands::get_user_data_path,
            commands::check_updates,
            commands::download_update,
            commands::open_external,
            commands::open_user_data_path,
            commands::open_engine_folder,
            commands::open_logs_folder,
            commands::get_engine_dll_status,
            commands::export_diagnostics,
            commands::maintenance_status,
            commands::cleanup_maintenance_target,
            // Data Dragon
            commands::get_champion_data,
            commands::get_tier_lane,
            commands::get_champion_build,
            // LCU (Rose-style overlay source of truth)
            commands::get_lcu_champion_skins,
            commands::force_lcu_skin_selection,
            commands::wait_for_lcu_finalization_threshold,
            commands::resolve_league_skin_package,
            // File dialogs & mods
            commands::select_mod_folder,
            commands::select_custom_mod_files,
            commands::select_custom_mod_folder,
            commands::index_custom_mod_folder,
            commands::open_user_mods_folder,
            commands::import_mods_to_folder,
            commands::index_user_mods_folder,
            commands::open_custom_skin_mod_folder,
            commands::open_custom_mod_category_folder,
            commands::import_custom_mods_to_skin,
            commands::import_custom_mods_to_category,
            commands::reveal_path,
            commands::select_league_game,
            commands::check_league_install,
            commands::detect_league_path,
            commands::select_bocchi_sidecar,
            commands::select_bocchi_dll,
            commands::select_library_preview_image,
            commands::select_skin_library,
            // Library
            commands::read_library_index,
            commands::write_library_index,
            commands::library_cache_preview,
            // Overlay
            commands::overlay_status,
            commands::is_league_game_running,
            commands::stop_overlay,
            commands::append_overlay_log,
            commands::get_overlay_log,
            commands::run_bocchi_overlay,
            rose_overlay::run_rose_overlay_v2,
            commands::build_base_overlay,
            commands::diagnose_overlay,
            // Pengu
            commands::send_pengu_message,
            // Startup / flags
            commands::app_get_startup_flags,
            commands::app_mark_first_run_complete,
            commands::app_bootstrap_first_run,
            commands::app_factory_reset,
            commands::app_tutorial_log,
            // Mod helpers
            commands::index_custom_mod_files,
            commands::index_skin_library,
            commands::index_downloaded_league_skins,
            commands::get_downloaded_league_skins_path,
            commands::delete_user_mod_file,
            commands::mods_select_ltk,
            commands::mods_open_ltk,
            commands::ltk_detect,
            commands::ltk_get_status,
            commands::ltk_import_mods,
            commands::ltk_download_and_install,
            commands::mods_auto_configure_overlay,
            commands::start_early_monitor,
            commands::stop_early_monitor,
            commands::suspend_league_game,
            commands::resume_league_game,
            commands::mods_download_cslol_tools,
            commands::download_league_skins,
            // Party
            commands::party_get_file_info,
            commands::party_read_file_chunk,
            commands::party_write_file,
            commands::party_delete_file,
            commands::party_clear_p2p_files,
            // Pengu Loader
            commands::pengu_get_loader_status,
            commands::pengu_download_loader,
            commands::pengu_launch_loader,
            commands::pengu_deactivate_loader,
            commands::pengu_uninstall_loader,
            commands::pengu_close_loader_ui,
            commands::pengu_open_loader_folder,
            commands::pengu_install_rift_plugin,
            // Multi-mod storage
            commands::mod_storage_list_categories,
            commands::mod_storage_list_mods,
            commands::mod_storage_import_mod,
            commands::mod_storage_remove_mod,
            commands::mod_storage_select_mod,
            commands::mod_storage_deselect_mod,
            commands::mod_storage_get_selected_mods,
            commands::select_mod_file,
            // ThresholdManager
            commands::load_injection_threshold,
            commands::save_injection_threshold,
            // BaseSkinTracker
            commands::start_base_skin_tracking,
            commands::on_base_skin_confirmed,
            commands::on_champ_select_exit,
            commands::get_base_skin_tracker_stats,
            commands::clear_base_skin_tracker_samples,
            commands::clear_lcu_cache,
            // Debug console
            commands::debug_print,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
