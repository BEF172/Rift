use crate::downloads;
use crate::gameflow;
use crate::overlay;
use crate::AppState;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;

static PENGU_PLUGIN_RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

#[tauri::command]
pub async fn get_lcu_champion_skins(champion_id: u64) -> Result<serde_json::Value, String> {
    gameflow::get_champion_skin_catalog(champion_id).await
}

#[tauri::command]
pub async fn force_lcu_skin_selection(
    champion_id: u64,
    selected_skin_id: u64,
) -> Result<serde_json::Value, String> {
    gameflow::force_selected_skin(champion_id, selected_skin_id).await
}

#[tauri::command]
pub async fn wait_for_lcu_finalization_threshold(
    threshold_ms: u64,
) -> Result<serde_json::Value, String> {
    gameflow::wait_for_finalization_threshold(threshold_ms).await
}

#[tauri::command]
pub async fn resolve_league_skin_package(
    champion_id: u64,
    skin_id: u64,
    base_skin_id: Option<u64>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if champion_id == 0 || skin_id == 0 {
        return Err("championId/skinId invalidos.".to_string());
    }
    let app_dir = state.app_data_dir.lock().await.clone();
    let champion_dir = PathBuf::from(app_dir)
        .join("downloaded-libraries")
        .join("LeagueSkins")
        .join("skins")
        .join(champion_id.to_string());
    let base_id = base_skin_id.filter(|value| *value > 0).unwrap_or(skin_id);
    let package_dir = if skin_id == base_id {
        champion_dir.join(base_id.to_string())
    } else {
        champion_dir
            .join(base_id.to_string())
            .join(skin_id.to_string())
    };
    let mut candidates = vec![
        package_dir.join(format!("{}.fantome", skin_id)),
        package_dir.join(format!("{}.zip", skin_id)),
    ];
    // Same defensive fallback as Rose's chroma resolver: locate the numeric
    // package under this champion if the repository layout moved it.
    if !candidates.iter().any(|path| path.is_file()) && champion_dir.is_dir() {
        let mut dirs = vec![champion_dir.clone()];
        while let Some(dir) = dirs.pop() {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        dirs.push(path);
                    } else if path
                        .file_name()
                        .map(|name| {
                            let name = name.to_string_lossy();
                            name.eq_ignore_ascii_case(&format!("{}.fantome", skin_id))
                                || name.eq_ignore_ascii_case(&format!("{}.zip", skin_id))
                        })
                        .unwrap_or(false)
                    {
                        candidates.push(path);
                    }
                }
            }
        }
    }
    let path = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            format!(
                "LeagueSkins no contiene el paquete champion={} base={} skin={}",
                champion_id, base_id, skin_id
            )
        })?;
    let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    Ok(serde_json::json!({
        "path": path.to_string_lossy(),
        "championId": champion_id,
        "baseSkinId": base_id,
        "skinId": skin_id,
        "fileBaseId": skin_id.to_string(),
        "rawChampion": champion_id.to_string(),
        "rawSkin": base_id.to_string(),
        "rawVariant": if skin_id != base_id { skin_id.to_string() } else { String::new() },
        "size": size,
        "source": "LeagueSkins",
        "resolvedBy": "rose-id-path"
    }))
}

fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

pub fn init_pengu_plugin_resource_dir(app: &AppHandle) {
    match app.path().resource_dir() {
        Ok(dir) => {
            let plugins_dir = dir.join("bundled-plugins");
            let plugin_dir = plugins_dir.join("RiftAtlas-00-Core");
            eprintln!("[PenguPlugin] resource_dir = {}", dir.display());
            eprintln!(
                "[PenguPlugin] plugin_resource_dir = {}",
                plugins_dir.display()
            );
            eprintln!(
                "[PenguPlugin] RiftAtlas-00-Core/index.js exists = {}",
                plugin_dir.join("index.js").exists()
            );
            PENGU_PLUGIN_RESOURCE_DIR.set(plugins_dir).ok();
        }
        Err(e) => {
            eprintln!("[PenguPlugin] ERROR getting resource_dir: {}", e);
        }
    }
}

fn is_rift_atlas_pengu_plugins_dir(path: &Path) -> bool {
    path.join("RiftAtlas-00-Core").join("index.js").is_file()
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if path.as_os_str().is_empty() {
        return;
    }
    if !paths.iter().any(|candidate| candidate == &path) {
        paths.push(path);
    }
}

fn display_user_path(path: &Path) -> String {
    let display = path.display().to_string();
    display
        .strip_prefix(r"\\?\")
        .unwrap_or(&display)
        .to_string()
}

// Basic app info

#[tauri::command]
pub fn window_start_dragging(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Ventana principal no encontrada".to_string())?;
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Ventana principal no encontrada".to_string())?;
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn window_toggle_maximize(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Ventana principal no encontrada".to_string())?;
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|error| error.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub fn window_is_maximized(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Ventana principal no encontrada".to_string())?;
    window.is_maximized().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn window_hide(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Ventana principal no encontrada".to_string())?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn get_user_data_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.app_data_dir.lock().await.clone())
}

#[tauri::command]
pub async fn check_updates(app: AppHandle) -> Result<serde_json::Value, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let update = app
        .updater()
        .map_err(|e| format!("Updater no configurado: {}", e))?
        .check()
        .await
        .map_err(|e| format!("Error checking Tauri updater: {}", e))?;

    let Some(update) = update else {
        return Ok(serde_json::json!({
            "hasUpdate": false,
            "currentVersion": current,
            "latestVersion": current,
            "releaseName": "",
            "releaseUrl": "",
            "downloadUrl": "",
            "assetName": "",
            "hasAutoUpdate": true,
            "publishedAt": "",
            "notes": "",
        }));
    };

    Ok(serde_json::json!({
        "hasUpdate": true,
        "currentVersion": current,
        "latestVersion": update.version,
        "releaseName": format!("Rift Atlas {}", update.version),
        "releaseUrl": update.raw_json.get("releaseUrl").and_then(|v| v.as_str()).unwrap_or(""),
        "downloadUrl": update.download_url.to_string(),
        "assetName": update.download_url.path_segments().and_then(|mut s| s.next_back()).unwrap_or("Rift Atlas update"),
        "hasAutoUpdate": true,
        "publishedAt": update.date.map(|d| d.to_string()).unwrap_or_default(),
        "notes": update.body.unwrap_or_default(),
    }))
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    _payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let update = app
        .updater()
        .map_err(|e| format!("Updater no configurado: {}", e))?
        .check()
        .await
        .map_err(|e| format!("Error checking Tauri updater: {}", e))?
        .ok_or_else(|| "No hay una actualizacion nueva para instalar.".to_string())?;
    let version = update.version.clone();
    let asset_name = update
        .download_url
        .path_segments()
        .and_then(|mut s| s.next_back())
        .unwrap_or("Rift Atlas update")
        .to_string();
    let progress_app = app.clone();
    let progress_version = version.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let percent = total
                    .filter(|t| *t > 0)
                    .map(|t| (downloaded as f64 / t as f64) * 100.0);
                let _ = progress_app.emit(
                    "download-progress",
                    serde_json::json!({
                        "type": "app-update",
                        "message": format!("Descargando Rift Atlas {}...", progress_version),
                        "downloaded": downloaded,
                        "total": total.unwrap_or(0),
                        "percent": percent.unwrap_or(0.0),
                    }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("Error instalando actualizacion Tauri: {}", e))?;
    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "type": "app-update",
            "message": "Actualizacion instalada. Reiniciando...",
            "percent": 100,
        }),
    );
    app.request_restart();
    Ok(serde_json::json!({
        "version": version,
        "assetName": asset_name,
        "installing": true,
    }))
}

// External URLs

#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    let allowed = [
        "https://u.gg/",
        "https://www.u.gg/",
        "https://metasrc.com/",
        "https://www.metasrc.com/",
        "https://op.gg/",
        "https://www.op.gg/",
        "https://github.com/",
        "https://discord.gg/",
        "https://www.paypal.com/",
        "https://developer.riotgames.com/",
    ];
    if !allowed.iter().any(|p| url.starts_with(p)) {
        return Err("URL no permitida".into());
    }
    open::that(&url).map_err(|e| format!("Error al abrir URL: {}", e))
}

// File dialogs

#[tauri::command]
pub async fn select_mod_folder(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = app.dialog().file().blocking_pick_folder();
    match dir {
        Some(folder_path) => {
            let folder_path = folder_path.to_string();
            let package_paths = downloads::list_mod_packages(&folder_path)?
                .into_iter()
                .filter_map(|item| item["path"].as_str().map(|p| p.to_string()))
                .collect::<Vec<_>>();
            Ok(serde_json::json!({
                "folderPath": folder_path,
                "packages": index_custom_mod_paths(package_paths, Some(&folder_path))?,
            }))
        }
        None => Ok(serde_json::json!({ "folderPath": "", "packages": [] })),
    }
}

#[tauri::command]
pub async fn select_custom_mod_files(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let files = app
        .dialog()
        .file()
        .add_filter("Mods", &["fantome", "zip", "wad", "wad.client", "rse"])
        .blocking_pick_files();
    let paths = files
        .map(|f| f.into_iter().map(|p| p.to_string()).collect())
        .unwrap_or_default();
    index_custom_mod_paths(paths, None)
}

#[tauri::command]
pub async fn select_custom_mod_folder(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = app.dialog().file().blocking_pick_folder();
    match dir {
        Some(folder_path) => {
            let folder_path = folder_path.to_string();
            let package_paths = downloads::list_mod_packages(&folder_path)?
                .into_iter()
                .filter_map(|item| item["path"].as_str().map(|p| p.to_string()))
                .collect::<Vec<_>>();
            let packages = index_custom_mod_paths(package_paths, Some(&folder_path))?;
            Ok(serde_json::json!({
                "folderPath": folder_path,
                "packages": packages,
            }))
        }
        None => Ok(serde_json::json!({ "folderPath": "", "packages": [] })),
    }
}

#[tauri::command]
pub async fn select_league_game(app: AppHandle) -> Result<String, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("League of Legends", &["exe"])
        .blocking_pick_file();
    match file {
        Some(p) => {
            let executable_path = overlay::resolve_league_game_executable(&p.to_string())?;
            let game_dir = crate::config::infer_game_dir_from_league_path(&executable_path);
            let client_dir = crate::config::infer_client_path_from_league_path(&executable_path);
            match (game_dir, client_dir) {
                (Some(game_dir), Some(client_dir)) => persist_league_paths(&game_dir, &client_dir),
                (Some(game_dir), None) => crate::config::save_league_path(&game_dir),
                (None, Some(client_dir)) => crate::config::save_client_path(&client_dir),
                (None, None) => {}
            }
            Ok(executable_path)
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
pub async fn select_bocchi_sidecar(app: AppHandle) -> Result<String, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("Ejecutable", &["exe"])
        .blocking_pick_file();
    Ok(file.map(|p| p.to_string()).unwrap_or_default())
}

#[tauri::command]
pub async fn select_bocchi_dll(app: AppHandle) -> Result<String, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("DLL", &["dll"])
        .blocking_pick_file();
    let selected = match file {
        Some(p) => p.to_string(),
        None => return Ok(String::new()),
    };
    let state = app.state::<AppState>();
    let app_dir = state.app_data_dir.lock().await.clone();
    let engine_dir = PathBuf::from(&app_dir).join("engine").join("tools");
    std::fs::create_dir_all(&engine_dir)
        .map_err(|e| format!("Error creando carpeta engine/tools: {}", e))?;
    let installed_dll = engine_dir.join("cslol-dll.dll");
    std::fs::copy(&selected, &installed_dll)
        .map_err(|e| format!("Error copiando DLL a engine/tools: {}", e))?;
    Ok(installed_dll.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn select_library_preview_image(app: AppHandle) -> Result<String, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("Imagen", &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file();
    Ok(file.map(|p| p.to_string()).unwrap_or_default())
}

#[tauri::command]
pub async fn select_skin_library(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = app.dialog().file().blocking_pick_folder();
    match dir {
        Some(p) => {
            let folder_path = p.to_string();
            let state = app.state::<AppState>();
            let app_dir = state.app_data_dir.lock().await.clone();
            let skins = downloads::index_skin_library(&folder_path, &app_dir).unwrap_or_default();
            Ok(serde_json::json!({
                "folderPath": folder_path,
                "skins": skins,
            }))
        }
        None => Ok(serde_json::json!({ "folderPath": "", "skins": [] })),
    }
}

// Skin library indexing

#[tauri::command]
pub async fn index_custom_mod_folder(folder_path: String) -> Result<serde_json::Value, String> {
    if folder_path.is_empty() {
        return Ok(serde_json::json!({ "folderPath": "", "packages": [] }));
    }
    let package_paths = downloads::list_mod_packages(&folder_path)?
        .into_iter()
        .filter_map(|item| item["path"].as_str().map(|p| p.to_string()))
        .collect::<Vec<_>>();
    let packages = index_custom_mod_paths(package_paths, Some(&folder_path))?;
    Ok(serde_json::json!({
        "folderPath": folder_path,
        "packages": packages,
    }))
}

#[tauri::command]
pub async fn index_skin_library(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let skins = downloads::index_skin_library(&folder_path, &app_dir)?;
    Ok(serde_json::json!({
        "folderPath": folder_path,
        "skins": skins,
    }))
}

#[tauri::command]
pub async fn index_downloaded_league_skins(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let path = PathBuf::from(&app_dir)
        .join("downloaded-libraries")
        .join("LeagueSkins");
    if path.exists() {
        let skins = downloads::index_skin_library(&path.to_string_lossy(), &app_dir)?;
        Ok(serde_json::json!({
            "folderPath": path.to_string_lossy(),
            "skins": skins,
        }))
    } else {
        Err("LeagueSkins descargado no encontrado.".to_string())
    }
}

#[tauri::command]
pub async fn get_downloaded_league_skins_path(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = PathBuf::from(state.app_data_dir.lock().await.clone())
        .join("downloaded-libraries")
        .join("LeagueSkins");
    let skins_dir = path.join("skins");
    if skins_dir.exists() {
        Ok(path.to_string_lossy().to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub async fn reveal_path(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err("Archivo no encontrado".into());
    }
    let _ = Command::new("explorer")
        .args(["/select,", &file_path])
        .spawn();
    Ok(())
}

// League installation

#[tauri::command]
pub async fn check_league_install(
    payload: Option<serde_json::Value>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let league_game_path = payload.and_then(|p| {
        p.get("leagueGamePath")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    });

    let selected_path = league_game_path.unwrap_or_default();
    let executable_path = overlay::resolve_league_game_executable(&selected_path)?;
    let final_dir = PathBuf::from(&executable_path)
        .parent()
        .ok_or("No pude resolver la carpeta Game de League.")?
        .join("Data")
        .join("FINAL");

    if !final_dir.exists() {
        return Err(format!(
            "No encontre Data\\FINAL en {}",
            final_dir.to_string_lossy()
        ));
    }

    let manifest_path = resolve_league_manifest_path(&app);
    let manifest_content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("No pude leer league-final-manifest.txt: {}", e))?;
    let expected_entries = parse_league_manifest(&manifest_content);
    let actual_entries = list_league_final_files(&final_dir)?;

    let mut actual_by_path = std::collections::HashMap::new();
    for entry in &actual_entries {
        actual_by_path.insert(entry.relative_path.to_lowercase(), entry.clone());
    }

    let mut expected_by_path = std::collections::HashSet::new();
    let mut missing: Vec<LeagueFileEntry> = Vec::new();
    let mut size_mismatch: Vec<serde_json::Value> = Vec::new();

    for expected in &expected_entries {
        expected_by_path.insert(expected.relative_path.to_lowercase());
        match actual_by_path.get(&expected.relative_path.to_lowercase()) {
            Some(actual) if actual.size != expected.size => {
                size_mismatch.push(serde_json::json!({
                    "relativePath": expected.relative_path,
                    "fileName": expected.file_name,
                    "expectedSize": expected.size,
                    "actualSize": actual.size,
                }));
            }
            Some(_) => {}
            None => missing.push(expected.clone()),
        }
    }

    let extra: Vec<LeagueFileEntry> = actual_entries
        .into_iter()
        .filter(|entry| !expected_by_path.contains(&entry.relative_path.to_lowercase()))
        .collect();
    let ok = missing.is_empty() && size_mismatch.is_empty();

    Ok(serde_json::json!({
        "ok": ok,
        "finalDir": final_dir.to_string_lossy(),
        "manifestPath": manifest_path.to_string_lossy(),
        "expectedCount": expected_entries.len(),
        "actualCount": actual_by_path.len(),
        "missingCount": missing.len(),
        "mismatchCount": size_mismatch.len(),
        "extraCount": extra.len(),
        "missing": missing.into_iter().take(30).map(|e| e.to_json()).collect::<Vec<_>>(),
        "sizeMismatch": size_mismatch.into_iter().take(30).collect::<Vec<_>>(),
        "extra": extra.into_iter().take(30).map(|e| e.to_json()).collect::<Vec<_>>(),
    }))
}

/// Detect League of Legends paths (Rose-style) and persist to config.ini.
/// Tries live League first, then falls back to saved config/manual selection.
#[tauri::command]
pub async fn detect_league_path() -> Result<serde_json::Value, String> {
    // 1. Running process is authoritative, like Rose.
    for process_name in ["LeagueClientUx.exe", "LeagueClient.exe"] {
        if let Some(dir) = overlay::find_process_exe_path(process_name) {
            if PathBuf::from(&dir).join("LeagueClient.exe").exists() {
                if let Some(game_dir) = find_league_game_path(&dir) {
                    persist_league_paths(&game_dir, &dir);
                    let league_exe = PathBuf::from(&game_dir).join("League of Legends.exe");
                    return Ok(serde_json::json!({
                        "detected": true,
                        "source": "process",
                        "leagueGamePath": league_exe.to_string_lossy(),
                        "leagueClientPath": dir,
                    }));
                }
            }
        }
    }

    // 2. Then the live lockfile.
    if let Some(lockfile) = find_league_client_lockfile() {
        let client_dir = PathBuf::from(&lockfile)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        if !client_dir.is_empty() && PathBuf::from(&client_dir).join("LeagueClient.exe").exists() {
            if let Some(game_dir) = find_league_game_path(&client_dir) {
                persist_league_paths(&game_dir, &client_dir);
                let league_exe = PathBuf::from(&game_dir).join("League of Legends.exe");
                return Ok(serde_json::json!({
                    "detected": true,
                    "source": "lockfile",
                    "leagueGamePath": league_exe.to_string_lossy(),
                    "leagueClientPath": client_dir,
                }));
            }
        }
    }

    // 3. Rose's own config is next; Pengu/core.dll reads this file too.
    if let Some((game_dir, client_dir)) = load_rose_league_paths() {
        persist_league_paths(&game_dir, &client_dir);
        let league_exe = PathBuf::from(&game_dir).join("League of Legends.exe");
        return Ok(serde_json::json!({
            "detected": true,
            "source": "rose-config",
            "leagueGamePath": league_exe.to_string_lossy(),
            "leagueClientPath": client_dir,
        }));
    }

    // 4. Saved Rift Atlas config/manual selection is a fallback only.
    if let Some(league) = crate::config::load_league_path() {
        if let Some(client) = crate::config::load_client_path()
            .or_else(|| crate::config::infer_client_path_from_league_path(&league))
        {
            let league_exe = overlay::resolve_league_game_executable(&league)
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from(&league).join("League of Legends.exe"));
            let client_exe = PathBuf::from(&client).join("LeagueClient.exe");
            if league_exe.exists() && client_exe.exists() {
                if let Some(game_dir) =
                    crate::config::infer_game_dir_from_league_path(&league_exe.to_string_lossy())
                {
                    persist_league_paths(&game_dir, &client);
                }
                return Ok(serde_json::json!({
                    "detected": true,
                    "source": "config",
                    "leagueGamePath": league_exe.to_string_lossy(),
                    "leagueClientPath": client,
                }));
            }
        }
    }

    // 5. Nothing found
    Ok(serde_json::json!({
        "detected": false,
        "source": "",
        "leagueGamePath": "",
        "leagueClientPath": "",
    }))
}

fn resolve_league_manifest_path(app: &AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("league-final-manifest.txt");
        if bundled.exists() {
            return bundled;
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("assets")
        .join("league-final-manifest.txt")
}

#[derive(Clone)]
struct LeagueFileEntry {
    relative_path: String,
    file_name: String,
    size: u64,
}

impl LeagueFileEntry {
    fn to_json(self) -> serde_json::Value {
        serde_json::json!({
            "relativePath": self.relative_path,
            "fileName": self.file_name,
            "size": self.size,
        })
    }
}

fn parse_league_manifest(content: &str) -> Vec<LeagueFileEntry> {
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let relative_path = parts.next()?.replace('\\', "/");
            let file_name = parts.next().unwrap_or("").to_string();
            let size = parts.next().unwrap_or("0").parse::<u64>().unwrap_or(0);
            Some(LeagueFileEntry {
                relative_path,
                file_name,
                size,
            })
        })
        .collect()
}

fn list_league_final_files(final_dir: &PathBuf) -> Result<Vec<LeagueFileEntry>, String> {
    fn walk(
        root: &PathBuf,
        dir: &PathBuf,
        entries: &mut Vec<LeagueFileEntry>,
    ) -> Result<(), String> {
        for item in std::fs::read_dir(dir)
            .map_err(|e| format!("No pude leer {}: {}", dir.to_string_lossy(), e))?
        {
            let item = item.map_err(|e| format!("No pude leer entrada: {}", e))?;
            let path = item.path();
            let metadata = item
                .metadata()
                .map_err(|e| format!("No pude leer metadata: {}", e))?;
            if metadata.is_dir() {
                walk(root, &path, entries)?;
            } else if metadata.is_file() {
                let relative_path = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let file_name = path
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();
                entries.push(LeagueFileEntry {
                    relative_path,
                    file_name,
                    size: metadata.len(),
                });
            }
        }
        Ok(())
    }

    let mut entries = Vec::new();
    walk(final_dir, final_dir, &mut entries)?;
    Ok(entries)
}

// Overlay commands

fn is_preserved_rose_overlay_path(path: &str) -> bool {
    let parts: Vec<String> = PathBuf::from(path)
        .components()
        .filter_map(|part| {
            let text = part.as_os_str().to_string_lossy().to_ascii_lowercase();
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        })
        .collect();

    parts.iter().any(|part| part == "rosev2")
        || parts
            .windows(3)
            .any(|window| window == ["engine", "injection", "overlay"])
}

#[tauri::command]
pub async fn overlay_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let has_pid = state.running_overlay_process.lock().await.is_some();
    let alive_flag = state.running_overlay_alive.lock().await.clone();
    let ready_flag = state.running_overlay_ready.lock().await.clone();
    let alive = alive_flag
        .map(|f| !f.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(false);
    let ready = ready_flag
        .map(|f| f.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(false);
    let error = state.current_overlay_error.lock().await.clone();
    let mut profile_path = state.current_overlay_path.lock().await.clone();
    let has_error = !error.is_empty();
    let mut preserved_rose_overlay = false;

    // If PID exists but process died, clean up state
    if has_pid && !alive {
        let dead_overlay_path = state.current_overlay_path.lock().await.clone();
        *state.running_overlay_process.lock().await = None;
        *state.running_overlay_alive.lock().await = None;
        *state.running_overlay_ready.lock().await = None;
        let is_rose_v2 = is_preserved_rose_overlay_path(&dead_overlay_path);
        if is_rose_v2 {
            // Rose's DLL may continue reading the generated WADs after the short-lived
            // runoverlay parent exits. Keep both the path and files until gameflow
            // reaches an end boundary (or the user explicitly stops the overlay).
            overlay::append_overlay_log(
                "[RoseV2] runoverlay termino; overlay conservado hasta el fin de partida.",
            );
            preserved_rose_overlay = true;
            profile_path = dead_overlay_path.clone();
        } else {
            *state.current_overlay_path.lock().await = String::new();
            profile_path.clear();
        }
        // Non-Rose runners own the overlay for their full lifetime, so their
        // directory can be removed as soon as the runner dies.
        if !dead_overlay_path.is_empty() && !is_rose_v2 {
            overlay::wipe_overlay_dir(&dead_overlay_path);
        }
    }
    if !profile_path.is_empty() && is_preserved_rose_overlay_path(&profile_path) {
        preserved_rose_overlay = true;
    }

    let running = (alive || preserved_rose_overlay) && !has_error;
    Ok(serde_json::json!({
        "running": running,
        "ready": ready || preserved_rose_overlay,
        "preserved": preserved_rose_overlay,
        "profilePath": profile_path,
        "error": if has_error { serde_json::Value::String(error) } else { serde_json::Value::Null },
    }))
}

#[tauri::command]
pub async fn is_league_game_running(game_path: String) -> Result<serde_json::Value, String> {
    if game_path.trim().is_empty() {
        return Ok(serde_json::json!({
            "running": false,
            "pid": 0,
        }));
    }

    let pid = overlay::find_league_process(&game_path).unwrap_or(0);
    Ok(serde_json::json!({
        "running": pid > 0,
        "pid": pid,
    }))
}

#[tauri::command]
pub async fn stop_overlay(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    state.overlay_cancel_epoch.fetch_add(1, Ordering::SeqCst);
    let pid = state.running_overlay_process.lock().await.take();
    let overlay_path = state.current_overlay_path.lock().await.clone();
    if let Some(pid) = pid {
        overlay::stop_patcher(pid, &overlay_path);
    }
    let orphan_count = tokio::task::spawn_blocking(overlay::kill_all_runoverlay_processes)
        .await
        .unwrap_or(0);
    if !overlay_path.is_empty() {
        overlay::wipe_overlay_dir(&overlay_path);
    }
    *state.current_overlay_error.lock().await = String::new();
    *state.current_overlay_path.lock().await = String::new();
    *state.running_overlay_alive.lock().await = None;
    *state.running_overlay_ready.lock().await = None;
    Ok(serde_json::json!({
        "stopped": pid.is_some() || orphan_count > 0,
        "orphanCount": orphan_count,
    }))
}

#[tauri::command]
pub async fn append_overlay_log(message: String, state: State<'_, AppState>) -> Result<(), String> {
    let text = format!("{} {}\n", chrono::Utc::now().format("%H:%M:%S"), message);
    overlay::append_overlay_log(&message);
    let mut log = state.overlay_log.lock().await;
    log.push_str(&text);
    if log.len() > 30000 {
        *log = log[log.len() - 30000..].to_string();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_overlay_log(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.overlay_log.lock().await.clone())
}

// Engine / DLL status

#[tauri::command]
pub async fn get_engine_dll_status(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let engine_dir = PathBuf::from(&app_dir).join("engine").join("tools");
    let dll_path = engine_dir.join("cslol-dll.dll");

    let engine_path = ["mod-tools.exe", "ltk-manager.exe"]
        .iter()
        .map(|name| engine_dir.join(name))
        .find(|p| p.exists())
        .unwrap_or_else(|| engine_dir.join("mod-tools.exe"));

    let dll_exists = dll_path.exists();
    let engine_exists = engine_path.exists();

    Ok(serde_json::json!({
        "installed": dll_exists,
        "exists": dll_exists,
        "path": if dll_exists { serde_json::Value::String(dll_path.to_string_lossy().to_string()) } else { serde_json::Value::Null },
        "dllPath": dll_path.to_string_lossy().to_string(),
        "engineInstalled": engine_exists,
        "enginePath": if engine_exists { serde_json::Value::String(engine_path.to_string_lossy().to_string()) } else { serde_json::Value::Null },
        "engineDir": engine_dir.to_string_lossy(),
    }))
}

#[tauri::command]
pub async fn open_engine_folder(state: State<'_, AppState>) -> Result<(), String> {
    let dir = PathBuf::from(state.app_data_dir.lock().await.clone())
        .join("engine")
        .join("tools");
    std::fs::create_dir_all(&dir).ok();
    let _ = Command::new("explorer").arg(&dir).spawn();
    Ok(())
}

#[tauri::command]
pub async fn open_user_data_path(state: State<'_, AppState>) -> Result<String, String> {
    let dir = state.app_data_dir.lock().await.clone();
    std::fs::create_dir_all(&dir).ok();
    let _ = Command::new("explorer").arg(&dir).spawn();
    Ok(dir)
}

// Data Dragon

#[tauri::command]
pub async fn get_champion_data() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let versions: Vec<String> = client
        .get("https://ddragon.leagueoflegends.com/api/versions.json")
        .send()
        .await
        .map_err(|e| format!("Error fetching versions: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Error parsing versions: {}", e))?;
    let latest = versions.first().ok_or("No versions found")?;
    let urls = [
        format!(
            "https://ddragon.leagueoflegends.com/cdn/{}/data/es_AR/champion.json",
            latest
        ),
        format!(
            "https://ddragon.leagueoflegends.com/cdn/{}/data/en_US/champion.json",
            latest
        ),
    ];
    let mut last_error = String::new();
    let mut data: Option<serde_json::Value> = None;
    for url in urls {
        match client.get(&url).send().await {
            Ok(response) if response.status().is_success() => {
                data = Some(
                    response
                        .json()
                        .await
                        .map_err(|e| format!("Error parsing champions: {}", e))?,
                );
                break;
            }
            Ok(response) => {
                last_error = format!("Data Dragon respondio HTTP {}", response.status());
            }
            Err(error) => {
                last_error = format!("Error fetching champions: {}", error);
            }
        }
    }
    let data = data.ok_or(last_error)?;
    let champions = data
        .get("data")
        .and_then(|v| v.as_object())
        .map(|items| items.values().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    Ok(serde_json::json!({
        "version": latest,
        "champions": champions
    }))
}

async fn call_opgg_mcp(tool_name: &str, arguments: serde_json::Value) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 RiftAtlas/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        },
        "id": 1,
    });

    let resp = client
        .post("https://mcp-api.op.gg/mcp")
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Error conectando con OP.GG MCP: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("OP.GG MCP respondio HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Error parseando respuesta OP.GG MCP: {}", e))?;

    let text = body
        .pointer("/result/content/0/text")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if text.is_empty() {
        return Err("OP.GG MCP returned empty response".to_string());
    }

    Ok(text.to_string())
}

fn opgg_tier_label(tier_num: i64) -> &'static str {
    match tier_num {
        1 => "S+",
        2 => "S",
        3 => "A",
        4 => "B",
        5 => "C",
        _ => "D",
    }
}

#[tauri::command]
pub async fn get_tier_lane(payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let lane = payload
        .get("lane")
        .and_then(|v| v.as_str())
        .unwrap_or("top");
    let normalized_lane = match lane {
        "top" | "jungle" | "middle" | "bottom" | "support" => lane,
        _ => "top",
    };
    let opgg_position = match normalized_lane {
        "middle" => "mid",
        "bottom" => "adc",
        other => other,
    };

    let fields = format!(
        "data.positions.{}[].{{champion,tier,win_rate,pick_rate,ban_rate,rank,kda,play}}",
        opgg_position
    );

    let arguments = serde_json::json!({
        "position": opgg_position,
        "desired_output_fields": [fields],
        "lang": "en_US",
    });

    let text = match call_opgg_mcp("lol_list_lane_meta_champions", arguments).await {
        Ok(t) => t,
        Err(e) => {
            let warning = format!(
                "OP.GG MCP no disponible: {}; usando fallback comunitario.",
                e
            );
            return fetch_huggingface_lane_tier_list(normalized_lane, warning).await;
        }
    };

    let rows = parse_opgg_tier_response(&text, normalized_lane);

    if rows.is_empty() {
        let warning = "OP.GG MCP no devolvio datos de tier.".to_string();
        return fetch_huggingface_lane_tier_list(normalized_lane, warning).await;
    }

    Ok(serde_json::json!({
        "source": "OP.GG",
        "updatedAt": chrono::Utc::now().to_rfc3339(),
        "role": normalized_lane,
        "rows": rows,
    }))
}

fn parse_opgg_tier_response(text: &str, lane: &str) -> Vec<serde_json::Value> {
    let mut rows = Vec::new();

    for cap in regex_lite::Regex::new(
        r#"(\w+)\("([^"]*)",(\d+),([\d.]+),([\d.]+),([\d.]+),(\d+),([\d.]+),(\d+)\)"#,
    )
    .unwrap()
    .captures_iter(text)
    {
        let champion_name = cap[2].to_string();
        let tier_num: i64 = cap[3].parse().unwrap_or(5);
        let win_rate: f64 = cap[4].parse().unwrap_or(0.0);
        let pick_rate: f64 = cap[5].parse().unwrap_or(0.0);
        let ban_rate: f64 = cap[6].parse().unwrap_or(0.0);
        let rank: i64 = cap[7].parse().unwrap_or(99);
        let kda: f64 = cap[8].parse().unwrap_or(0.0);
        let play: f64 = cap[9].parse().unwrap_or(0.0);

        rows.push(serde_json::json!({
            "champion": champion_name,
            "role": lane,
            "tier": opgg_tier_label(tier_num),
            "winrate": win_rate * 100.0,
            "pickrate": pick_rate * 100.0,
            "banrate": ban_rate * 100.0,
            "games": play as u64,
            "kda": kda,
            "rank": rank,
            "score": win_rate * 100.0 + pick_rate * 100.0 * 0.7 + ban_rate * 100.0 * 0.35,
        }));
    }

    rows.sort_by(|a, b| {
        let a_rank = a.get("rank").and_then(|v| v.as_i64()).unwrap_or(99);
        let b_rank = b.get("rank").and_then(|v| v.as_i64()).unwrap_or(99);
        a_rank.cmp(&b_rank)
    });

    rows
}

fn empty_tier_payload(lane: &str, warning: String) -> serde_json::Value {
    serde_json::json!({
        "source": "No disponible",
        "updatedAt": chrono::Utc::now().to_rfc3339(),
        "role": lane,
        "rows": [],
        "warning": warning,
    })
}

fn tier_for_rank(index: usize) -> &'static str {
    match index {
        0..=4 => "S",
        5..=12 => "A",
        13..=22 => "B",
        23..=32 => "C",
        _ => "D",
    }
}

fn get_user_mods_root(state: &AppState) -> Result<PathBuf, String> {
    let app_data_dir = state
        .app_data_dir
        .try_lock()
        .map_err(|_| "Directorio de datos ocupado".to_string())?
        .clone();
    Ok(PathBuf::from(app_data_dir).join("mods"))
}

fn ensure_user_mods_layout(mods_root: &PathBuf) -> Result<(), String> {
    for category in [
        "skins",
        "maps",
        "fonts",
        "announcers",
        "ui",
        "ux",
        "voiceover",
        "loading_screen",
        "vfx",
        "sfx",
        "others",
    ] {
        std::fs::create_dir_all(mods_root.join(category))
            .map_err(|e| format!("Error creando carpeta {}: {}", category, e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_user_mods_folder(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mods_root = get_user_mods_root(&state)?;
    ensure_user_mods_layout(&mods_root)?;
    open::that(&mods_root).map_err(|e| format!("Error abriendo carpeta de mods: {}", e))?;
    Ok(serde_json::json!({ "folderPath": mods_root.to_string_lossy() }))
}

#[tauri::command]
pub async fn import_mods_to_folder(
    files: Vec<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mods_root = get_user_mods_root(&state)?;
    ensure_user_mods_layout(&mods_root)?;
    let target_dir = mods_root.join("others");
    let (copied_paths, skipped) = copy_user_mod_files(files, &target_dir)?;
    let packages =
        index_custom_mod_paths(copied_paths.clone(), Some(&mods_root.to_string_lossy()))?;
    Ok(serde_json::json!({
        "folderPath": target_dir.to_string_lossy(),
        "copied": copied_paths.len(),
        "skipped": skipped.len(),
        "packages": packages,
    }))
}

#[tauri::command]
pub async fn open_custom_skin_mod_folder(
    skin_id: u64,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if skin_id == 0 {
        return Err("Skin ID invalido.".to_string());
    }
    let mods_root = get_user_mods_root(&state)?;
    ensure_user_mods_layout(&mods_root)?;
    let folder = mods_root.join("skins").join(skin_id.to_string());
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("Error creando carpeta de skin: {}", e))?;
    open::that(&folder).map_err(|e| format!("Error abriendo carpeta de skin: {}", e))?;
    Ok(serde_json::json!({
        "folderPath": folder.to_string_lossy(),
        "skinId": skin_id,
    }))
}

fn normalize_user_mod_category(category: &str) -> Option<&'static str> {
    match category.trim().to_lowercase().as_str() {
        "map" | "maps" => Some("maps"),
        "font" | "fonts" => Some("fonts"),
        "announcer" | "announcers" => Some("announcers"),
        "ui" => Some("ui"),
        "ux" => Some("ux"),
        "voice" | "voiceover" | "voice_over" => Some("voiceover"),
        "loading" | "loading_screen" | "loading-screen" => Some("loading_screen"),
        "vfx" => Some("vfx"),
        "sfx" => Some("sfx"),
        "other" | "others" | "misc" => Some("others"),
        _ => None,
    }
}

#[tauri::command]
pub async fn open_custom_mod_category_folder(
    category: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let Some(category) = normalize_user_mod_category(&category) else {
        return Err("Categoria de mod invalida.".to_string());
    };

    let mods_root = get_user_mods_root(&state)?;
    ensure_user_mods_layout(&mods_root)?;
    let folder = mods_root.join(category);
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("Error creando carpeta de mods: {}", e))?;
    open::that(&folder).map_err(|e| format!("Error abriendo carpeta de mods: {}", e))?;
    Ok(serde_json::json!({
        "folderPath": folder.to_string_lossy(),
        "category": category,
    }))
}

fn copy_user_mod_files(
    files: Vec<String>,
    target_dir: &PathBuf,
) -> Result<(Vec<String>, Vec<String>), String> {
    std::fs::create_dir_all(target_dir)
        .map_err(|e| format!("Error creando carpeta de mods: {}", e))?;

    let mut copied_paths: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();

    for source in files {
        let source_path = PathBuf::from(&source);
        if !source_path.exists() || !source_path.is_file() {
            skipped.push(source);
            continue;
        }
        let ext = get_mod_package_extension(&source_path);
        if ![".fantome", ".zip", ".wad", ".wad.client", ".rse"].contains(&ext.as_str()) {
            skipped.push(source);
            continue;
        }
        let Some(file_name) = source_path.file_name() else {
            skipped.push(source);
            continue;
        };
        let target_path = target_dir.join(file_name);
        std::fs::copy(&source_path, &target_path)
            .map_err(|e| format!("Error copiando {}: {}", source_path.to_string_lossy(), e))?;
        copied_paths.push(target_path.to_string_lossy().to_string());
    }

    Ok((copied_paths, skipped))
}

#[tauri::command]
pub async fn delete_user_mod_file(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mods_root = get_user_mods_root(&state)?;
    ensure_user_mods_layout(&mods_root)?;
    let root = mods_root
        .canonicalize()
        .map_err(|e| format!("No pude resolver la carpeta de mods: {}", e))?;
    let path = PathBuf::from(&file_path);
    let canonical = path
        .canonicalize()
        .map_err(|_| "Archivo de mod no encontrado.".to_string())?;

    if !canonical.starts_with(&root) {
        return Err("Por seguridad solo puedo eliminar archivos dentro de la carpeta de mods de Rift Atlas.".to_string());
    }
    if !canonical.is_file() {
        return Err("La ruta seleccionada no es un archivo de mod.".to_string());
    }

    std::fs::remove_file(&canonical).map_err(|e| format!("No pude eliminar el mod: {}", e))?;

    let mut cleaned_dirs: Vec<String> = Vec::new();
    let mut current = canonical.parent().map(|p| p.to_path_buf());
    while let Some(dir) = current {
        if dir == root {
            break;
        }
        match std::fs::remove_dir(&dir) {
            Ok(_) => {
                cleaned_dirs.push(dir.to_string_lossy().to_string());
                current = dir.parent().map(|p| p.to_path_buf());
            }
            Err(_) => break,
        }
    }

    Ok(serde_json::json!({
        "deleted": true,
        "path": canonical.to_string_lossy(),
        "cleanedDirs": cleaned_dirs,
    }))
}

#[tauri::command]
pub async fn import_custom_mods_to_skin(
    skin_id: u64,
    files: Vec<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if skin_id == 0 {
        return Err("Selecciona una skin valida antes de agregar mods.".to_string());
    }

    let mods_root = get_user_mods_root(&state)?;
    ensure_user_mods_layout(&mods_root)?;
    let target_dir = mods_root.join("skins").join(skin_id.to_string());
    let (copied_paths, skipped) = copy_user_mod_files(files, &target_dir)?;

    let packages =
        index_custom_mod_paths(copied_paths.clone(), Some(&mods_root.to_string_lossy()))?;

    Ok(serde_json::json!({
        "folderPath": target_dir.to_string_lossy(),
        "modsRoot": mods_root.to_string_lossy(),
        "skinId": skin_id,
        "copied": copied_paths.len(),
        "skipped": skipped.len(),
        "skippedPaths": skipped,
        "packages": packages,
    }))
}

#[tauri::command]
pub async fn import_custom_mods_to_category(
    category: String,
    files: Vec<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let Some(category) = normalize_user_mod_category(&category) else {
        return Err("Categoria de mod invalida.".to_string());
    };

    let mods_root = get_user_mods_root(&state)?;
    ensure_user_mods_layout(&mods_root)?;
    let target_dir = mods_root.join(category);
    let (copied_paths, skipped) = copy_user_mod_files(files, &target_dir)?;

    let packages =
        index_custom_mod_paths(copied_paths.clone(), Some(&mods_root.to_string_lossy()))?;

    Ok(serde_json::json!({
        "folderPath": target_dir.to_string_lossy(),
        "modsRoot": mods_root.to_string_lossy(),
        "category": category,
        "copied": copied_paths.len(),
        "skipped": skipped.len(),
        "skippedPaths": skipped,
        "packages": packages,
    }))
}

#[tauri::command]
pub async fn index_user_mods_folder(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let folder_path = get_user_mods_root(&state)?;
    ensure_user_mods_layout(&folder_path)?;
    let folder_string = folder_path.to_string_lossy().to_string();
    let package_paths = downloads::list_mod_packages(&folder_string)?
        .into_iter()
        .filter_map(|item| item["path"].as_str().map(|p| p.to_string()))
        .collect::<Vec<_>>();
    let packages = index_custom_mod_paths(package_paths, Some(&folder_string))?;
    Ok(serde_json::json!({
        "folderPath": folder_string,
        "packages": packages,
    }))
}

async fn fetch_huggingface_lane_tier_list(
    lane: &str,
    warning: String,
) -> Result<serde_json::Value, String> {
    let mut url = reqwest::Url::parse("https://datasets-server.huggingface.co/filter")
        .map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("dataset", "HakimT/lol-champion-ranked-stats")
        .append_pair("config", "default")
        .append_pair("split", "train")
        .append_pair("where", &format!(r#""role"='{}'"#, lane))
        .append_pair("orderby", r#""date" DESC"#)
        .append_pair("offset", "0")
        .append_pair("length", "100");

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 RiftAtlas/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let data: serde_json::Value = match client.get(url).send().await {
        Ok(response) if response.status().is_success() => response
            .json()
            .await
            .map_err(|e| format!("Error parseando fallback de tiers: {}", e))?,
        Ok(response) => {
            return Ok(empty_tier_payload(
                lane,
                format!("{} Fallback respondio HTTP {}", warning, response.status()),
            ));
        }
        Err(error) => {
            return Ok(empty_tier_payload(
                lane,
                format!("{} Fallback no disponible: {}", warning, error),
            ));
        }
    };

    let rows = data
        .get("rows")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let latest_date = rows
        .first()
        .and_then(|item| item.get("row"))
        .and_then(|row| row.get("date"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut tier_rows = rows
        .into_iter()
        .filter_map(|item| {
            let row = item.get("row")?;
            if !latest_date.is_empty()
                && row.get("date").and_then(|v| v.as_str()) != Some(latest_date.as_str())
            {
                return None;
            }
            let winrate = json_number(row.get("winrate"));
            let pickrate = json_number(row.get("pickrate"));
            let banrate = json_number(row.get("banrate"));
            Some(serde_json::json!({
                "champion": row.get("champion").and_then(|v| v.as_str()).unwrap_or(""),
                "role": lane,
                "patch": row.get("patch").and_then(|v| v.as_str()).unwrap_or(""),
                "date": row.get("date").and_then(|v| v.as_str()).unwrap_or(""),
                "games": 0,
                "winrate": winrate,
                "pickrate": pickrate,
                "banrate": banrate,
                "score": winrate + pickrate * 0.55 + banrate * 0.25,
            }))
        })
        .collect::<Vec<_>>();

    tier_rows.sort_by(|a, b| {
        let b_score = b.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let a_score = a.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
        b_score
            .partial_cmp(&a_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    tier_rows.truncate(35);

    let tier_rows = tier_rows
        .into_iter()
        .enumerate()
        .map(|(index, mut row)| {
            row["rank"] = serde_json::json!(index + 1);
            row["tier"] = serde_json::json!(tier_for_rank(index));
            row
        })
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "source": "HakimT/lol-champion-ranked-stats",
        "updatedAt": if latest_date.is_empty() { chrono::Utc::now().to_rfc3339() } else { latest_date },
        "role": lane,
        "rows": tier_rows,
        "warning": warning,
    }))
}

fn json_number(value: Option<&serde_json::Value>) -> f64 {
    value
        .and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
        })
        .unwrap_or(0.0)
}

#[tauri::command]
pub async fn get_champion_build(champion: String) -> Result<serde_json::Value, String> {
    let opgg_name = champion
        .to_uppercase()
        .replace([' ', '\'', '.'], "")
        .replace("&", "");

    let arguments = serde_json::json!({
        "champion": opgg_name,
        "position": "all",
        "game_mode": "ranked",
        "desired_output_fields": [
            "champion",
            "data.summary.average_stats.{win_rate,pick_rate,ban_rate,tier,kda,play}",
            "data.runes.{primary_page_name,primary_rune_names[],secondary_page_name,secondary_rune_names[],stat_mod_names[],win,play}",
            "data.skills.{order[],win,play}",
            "data.starter_items.{ids_names[],win,play}",
            "data.core_items.{ids_names[],win,play}",
            "data.summoner_spells.{ids_names[],win,play}"
        ],
        "lang": "en_US",
    });

    let text = call_opgg_mcp("lol_get_champion_analysis", arguments).await?;

    let analysis = parse_opgg_champion_analysis(&text, &champion);

    Ok(analysis)
}

fn parse_opgg_champion_analysis(text: &str, champion: &str) -> serde_json::Value {
    let mut result = serde_json::json!({
        "source": "OP.GG",
        "champion": champion,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
        "runes": { "primaryStyle": null, "subStyle": null, "perks": [], "winrate": 0, "matches": 0 },
        "summonerSpells": { "ids": [], "names": [], "winrate": 0, "matches": 0 },
        "startingItems": { "ids": [], "names": [], "winrate": 0, "matches": 0 },
        "coreItems": { "ids": [], "names": [], "winrate": 0, "matches": 0 },
        "skills": { "priority": [], "path": [], "winrate": 0, "matches": 0 },
        "matches": 0,
    });

    if let Some(caps) =
        regex_lite::Regex::new(r#"AverageStats\(([\d.]+),([\d.]+),([\d.]+),(\d+),([\d.]+),(\d+)\)"#)
            .unwrap()
            .captures(text)
    {
        let win_rate: f64 = caps[1].parse().unwrap_or(0.0);
        let pick_rate: f64 = caps[2].parse().unwrap_or(0.0);
        let ban_rate: f64 = caps[3].parse().unwrap_or(0.0);
        let tier: i64 = caps[4].parse().unwrap_or(0);
        let kda: f64 = caps[5].parse().unwrap_or(0.0);
        let play: i64 = caps[6].parse().unwrap_or(0);
        result["matches"] = serde_json::json!(play);
        result["summary"] = serde_json::json!({
            "win_rate": win_rate,
            "pick_rate": pick_rate,
            "ban_rate": ban_rate,
            "tier": tier,
            "kda": kda,
            "play": play,
        });
    }

    if let Some(caps) = regex_lite::Regex::new(
        r#"Runes\("([^"]*)",\[((?:[^\]]*)?)\],"([^"]*)",\[((?:[^\]]*)?)\],\[((?:[^\]]*)?)\],(\d+),(\d+)\)"#
    )
    .unwrap()
    .captures(text)
    {
        let primary_page = caps[1].to_string();
        let primary_runes_raw = caps[2].to_string();
        let secondary_page = caps[4].to_string();
        let secondary_runes_raw = caps[5].to_string();
        let _stat_mods_raw = caps[6].to_string();
        let wins: i64 = caps[7].parse().unwrap_or(0);
        let play: i64 = caps[8].parse().unwrap_or(0);

        let primary_runes: Vec<serde_json::Value> = primary_runes_raw
            .split(',')
            .filter_map(|s| {
                let clean = s.trim().trim_matches('"').to_string();
                if clean.is_empty() { None } else { Some(serde_json::Value::String(clean)) }
            })
            .collect();
        let secondary_runes: Vec<serde_json::Value> = secondary_runes_raw
            .split(',')
            .filter_map(|s| {
                let clean = s.trim().trim_matches('"').to_string();
                if clean.is_empty() { None } else { Some(serde_json::Value::String(clean)) }
            })
            .collect();

        let winrate = if play > 0 { (wins as f64 / play as f64) * 100.0 } else { 0.0 };

        result["runes"] = serde_json::json!({
            "primaryStyle": primary_page,
            "primaryRuneNames": primary_runes,
            "subStyle": secondary_page,
            "secondaryRuneNames": secondary_runes,
            "winrate": winrate,
            "matches": play,
        });
    }

    if let Some(caps) = regex_lite::Regex::new(r#"Skills\(\[((?:[^\]]*)?)\],(\d+),(\d+)\)"#)
        .unwrap()
        .captures(text)
    {
        let order_raw = caps[1].to_string();
        let wins: i64 = caps[2].parse().unwrap_or(0);
        let play: i64 = caps[3].parse().unwrap_or(0);

        let path: Vec<serde_json::Value> = order_raw
            .split(',')
            .filter_map(|s| {
                let clean = s.trim().trim_matches('"').to_string();
                if clean.is_empty() {
                    None
                } else {
                    Some(serde_json::Value::String(clean))
                }
            })
            .collect();

        let winrate = if play > 0 {
            (wins as f64 / play as f64) * 100.0
        } else {
            0.0
        };

        result["skills"] = serde_json::json!({
            "priority": path,
            "path": path,
            "winrate": winrate,
            "matches": play,
        });
    }

    let item_caps: Vec<_> =
        regex_lite::Regex::new(r#"StarterItems\(\[((?:[^\]]*)?)\],(\d+),(\d+)\)"#)
            .unwrap()
            .captures_iter(text)
            .collect();

    if item_caps.len() >= 1 {
        let caps = &item_caps[0];
        let names_raw = caps[1].to_string();
        let wins: i64 = caps[2].parse().unwrap_or(0);
        let play: i64 = caps[3].parse().unwrap_or(0);
        let names: Vec<String> = names_raw
            .split(',')
            .filter_map(|s| {
                let clean = s.trim().trim_matches('"').to_string();
                if clean.is_empty() {
                    None
                } else {
                    Some(clean)
                }
            })
            .collect();
        let winrate = if play > 0 {
            (wins as f64 / play as f64) * 100.0
        } else {
            0.0
        };
        result["startingItems"] = serde_json::json!({
            "names": names,
            "winrate": winrate,
            "matches": play,
        });
    }

    if item_caps.len() >= 2 {
        let caps = &item_caps[1];
        let names_raw = caps[1].to_string();
        let wins: i64 = caps[2].parse().unwrap_or(0);
        let play: i64 = caps[3].parse().unwrap_or(0);
        let names: Vec<String> = names_raw
            .split(',')
            .filter_map(|s| {
                let clean = s.trim().trim_matches('"').to_string();
                if clean.is_empty() {
                    None
                } else {
                    Some(clean)
                }
            })
            .collect();
        let winrate = if play > 0 {
            (wins as f64 / play as f64) * 100.0
        } else {
            0.0
        };
        result["coreItems"] = serde_json::json!({
            "names": names,
            "winrate": winrate,
            "matches": play,
        });
    }

    if item_caps.len() >= 3 {
        let caps = &item_caps[2];
        let ids_raw = caps[1].to_string();
        let wins: i64 = caps[2].parse().unwrap_or(0);
        let play: i64 = caps[3].parse().unwrap_or(0);
        let ids: Vec<i64> = ids_raw
            .split(',')
            .filter_map(|s| s.trim().parse::<i64>().ok())
            .collect();
        let winrate = if play > 0 {
            (wins as f64 / play as f64) * 100.0
        } else {
            0.0
        };
        result["summonerSpells"] = serde_json::json!({
            "ids": ids,
            "winrate": winrate,
            "matches": play,
        });
    }

    result
}

// Library index store

#[tauri::command]
pub async fn read_library_index(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(state.app_data_dir.lock().await.clone())
        .join("cache")
        .join("skins_index.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            serde_json::from_str(&content).map_err(|e| format!("Error parsing index: {}", e))
        }
        Err(_) => Ok(serde_json::json!({})),
    }
}

#[tauri::command]
pub async fn write_library_index(
    data: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = PathBuf::from(state.app_data_dir.lock().await.clone())
        .join("cache")
        .join("skins_index.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let content =
        serde_json::to_string_pretty(&data).map_err(|e| format!("Error serializing: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Error writing index: {}", e))
}

// Pengu message bridge

#[tauri::command]
pub async fn send_pengu_message(
    payload: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let msg_text =
        serde_json::to_string(&payload).map_err(|e| format!("Error serializing: {}", e))?;
    let tx_lock = state.pengu_bridge_tx.lock().await;
    let sent = tx_lock
        .as_ref()
        .and_then(|tx| tx.send(msg_text).ok())
        .is_some();
    Ok(serde_json::json!({ "sent": sent }))
}

// Early Game Monitor (Rose-style)

#[tauri::command]
pub async fn start_early_monitor(
    game_path: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let active = state.early_monitor_active.clone();
    let pid = state.early_monitor_pid.clone();
    let ros = state.early_monitor_runoverlay_started.clone();

    if active.load(Ordering::SeqCst) {
        return Ok(serde_json::json!({ "started": true, "alreadyRunning": true }));
    }

    active.store(true, Ordering::SeqCst);
    ros.store(false, Ordering::SeqCst);
    overlay::start_early_monitor(&game_path, active, pid, ros);
    overlay::append_overlay_log("[CMD] Early monitor iniciado desde frontend.");
    Ok(serde_json::json!({ "started": true }))
}

#[tauri::command]
pub async fn stop_early_monitor(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let had_suspended =
        overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid, &state.early_monitor_runoverlay_started);
    overlay::append_overlay_log(&format!(
        "[CMD] Early monitor detenido. suspended={}",
        had_suspended
    ));
    Ok(serde_json::json!({ "stopped": true, "hadSuspended": had_suspended }))
}

#[tauri::command]
pub async fn suspend_league_game(
    game_path: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let pid = overlay::find_and_suspend_league(&game_path)?;
    *state.suspended_pid.lock().await = Some(pid);
    Ok(serde_json::json!({ "suspended": true, "pid": pid }))
}

#[tauri::command]
pub async fn resume_league_game(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let pid = state.suspended_pid.lock().await.take();
    if let Some(pid) = pid {
        overlay::resume_league_by_pid(pid)?;
        Ok(serde_json::json!({ "resumed": true, "pid": pid }))
    } else {
        Ok(serde_json::json!({ "resumed": false }))
    }
}

// Run Bocchi Overlay

#[tauri::command]
pub async fn run_bocchi_overlay(
    payload: serde_json::Value,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<serde_json::Value, String> {
    // === Async section (fast, runs on tokio runtime) ===
    overlay::append_overlay_log("run_bocchi_overlay: INICIO");

    {
        let mut active = state.active_overlay_run.lock().await;
        if *active {
            return Err("Ya hay una inyeccion en preparacion. Espera a que termine.".to_string());
        }
        *active = true;
    }

    let run_epoch = state.overlay_cancel_epoch.load(Ordering::SeqCst);
    let mut result = run_bocchi_overlay_inner(payload, &state).await;

    // A Lobby/EndOfGame/Stop transition may occur while mkoverlay is still
    // running on the blocking pool. Never let that completed build resurrect
    // runoverlay after the game session has already ended.
    if state.overlay_cancel_epoch.load(Ordering::SeqCst) != run_epoch {
        if let Ok(value) = &result {
            let pid = value.get("pid").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let overlay_path = value
                .get("profilePath")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if pid > 0 {
                overlay::stop_patcher(pid, &overlay_path);
            }
            if !overlay_path.is_empty() {
                overlay::wipe_overlay_dir(&overlay_path);
            }
        }
        *state.running_overlay_process.lock().await = None;
        *state.running_overlay_alive.lock().await = None;
        *state.running_overlay_ready.lock().await = None;
        *state.current_overlay_path.lock().await = String::new();
        result = Err(
            "La sesion termino mientras se construia el overlay; runoverlay fue cancelado."
                .to_string(),
        );
    }

    // Spawn patcher death watcher: emit event when patcher process exits
    // Cleanup is handled by overlay_status polling (already does this)
    if result.is_ok() {
        if let Some(alive_arc) = state.running_overlay_alive.lock().await.clone() {
            let app_handle = _app.clone();
            let watched_pid = result
                .as_ref()
                .ok()
                .and_then(|value| value.get("pid"))
                .and_then(|value| value.as_u64())
                .unwrap_or(0) as u32;
            tokio::spawn(async move {
                // Poll until process_exited becomes true
                while !alive_arc.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
                // A replaced runner can exit after the new one has already
                // started. Never let that stale watcher clear the new state.
                let current_pid = *app_handle
                    .state::<AppState>()
                    .running_overlay_process
                    .lock()
                    .await;
                if current_pid == Some(watched_pid) {
                    let state = app_handle.state::<AppState>();
                    let overlay_path = state.current_overlay_path.lock().await.clone();
                    *state.running_overlay_process.lock().await = None;
                    *state.running_overlay_alive.lock().await = None;
                    *state.running_overlay_ready.lock().await = None;
                    *state.current_overlay_path.lock().await = String::new();
                    if !overlay_path.is_empty() {
                        overlay::wipe_overlay_dir(&overlay_path);
                    }
                    let _ =
                        app_handle.emit("patcher-died", serde_json::json!({ "pid": watched_pid }));
                    overlay::append_overlay_log(&format!(
                        "[PatcherWatcher] Runner pid={} termino; evento emitido.",
                        watched_pid
                    ));
                } else {
                    overlay::append_overlay_log(&format!(
                        "[PatcherWatcher] Ignorando salida vieja pid={} current={:?}.",
                        watched_pid, current_pid
                    ));
                }
            });
        }
    }

    *state.active_overlay_run.lock().await = false;
    result
}

async fn run_bocchi_overlay_inner(
    payload: serde_json::Value,
    state: &State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let replace_overlay = payload
        .get("replaceOverlay")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let rose_mode = payload
        .get("roseMode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Rose-style: replace a waiting runoverlay in-place while the early monitor keeps League frozen.
    if let Some(pid) = state.running_overlay_process.lock().await.take() {
        let alive_flag = state.running_overlay_alive.lock().await.clone();
        let alive = alive_flag
            .as_ref()
            .map(|f| !f.load(Ordering::SeqCst))
            .unwrap_or(false);
        if alive {
            if replace_overlay {
                if overlay::find_league_process("").is_some() {
                    *state.running_overlay_process.lock().await = Some(pid);
                    return Err("La partida ya inicio. Rose no reemplaza el overlay con League cargado; la nueva seleccion se aplicara en la proxima partida.".to_string());
                }
                let overlay_path = state.current_overlay_path.lock().await.clone();
                overlay::append_overlay_log(&format!(
                    "[Overlay] Reemplazando overlay activo pid={} antes de nueva inyeccion.",
                    pid
                ));
                overlay::stop_patcher(pid, &overlay_path);
                *state.running_overlay_alive.lock().await = None;
                *state.running_overlay_ready.lock().await = None;
                *state.current_overlay_path.lock().await = String::new();
            } else {
                *state.running_overlay_process.lock().await = Some(pid);
                return Err("Ya hay una inyeccion en curso. Espera a que termine.".to_string());
            }
        } else {
            *state.running_overlay_alive.lock().await = None;
            *state.running_overlay_ready.lock().await = None;
            *state.current_overlay_path.lock().await = String::new();
        }
    }
    *state.current_overlay_error.lock().await = String::new();
    let app_dir = state.app_data_dir.lock().await.clone();

    let sidecar_path = payload
        .get("sidecarPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let dll_path = payload
        .get("dllPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let raw_game_path = payload
        .get("gamePath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let game_path = overlay::resolve_league_game_executable(&raw_game_path)?;

    if game_path.is_empty() || !game_path.to_lowercase().ends_with("league of legends.exe") {
        return Err("League of Legends.exe no configurado.".to_string());
    }

    if let Some(game_pid) = overlay::find_league_process(&game_path) {
        // Give the early Rose monitor a brief chance to publish ownership of
        // a process that appeared on the same scheduling tick.
        for _ in 0..4 {
            let suspended_by_early_monitor = match state.early_monitor_pid.lock() {
                Ok(pid) => *pid == Some(game_pid),
                Err(poisoned) => *poisoned.into_inner() == Some(game_pid),
            };
            if suspended_by_early_monitor {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let suspended_by_early_monitor = match state.early_monitor_pid.lock() {
            Ok(pid) => *pid == Some(game_pid),
            Err(poisoned) => *poisoned.into_inner() == Some(game_pid),
        };
        if !suspended_by_early_monitor {
            return Err("League ya esta cargado y no fue suspendido por el monitor temprano. Se cancelo para evitar informar una inyeccion falsa.".to_string());
        }
    }

    let engine_path =
        overlay::resolve_hitori_engine(&sidecar_path, &crate::install_dir().to_string_lossy())?;
    if rose_mode && !overlay::is_mod_tools(&engine_path) {
        return Err(
            "El flujo automatico Rose requiere mod-tools.exe; LTK/patcher no se usa para esta inyeccion."
                .to_string(),
        );
    }

    let resolved_dll = if overlay::is_mod_tools(&engine_path) {
        String::new()
    } else if !dll_path.is_empty() && PathBuf::from(&dll_path).exists() {
        dll_path
    } else {
        let engine_dll = PathBuf::from(&app_dir)
            .join("engine")
            .join("tools")
            .join("cslol-dll.dll");
        if engine_dll.exists() {
            engine_dll.to_string_lossy().to_string()
        } else {
            return Err("cslol-dll.dll no encontrada en engine/tools.".to_string());
        }
    };

    let skin_entries = payload
        .get("skinEntries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // Collect multi-mod entries (map, font, announcer, voiceover, ui, etc.)
    let extra_mod_entries = payload
        .get("extraMods")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let game_folder = PathBuf::from(&game_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let base_overlay_path = payload
        .get("baseOverlayPath")
        .and_then(|v| v.as_str())
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string());

    let patcher_flags = payload
        .get("patcherFlags")
        .and_then(|v| v.as_str())
        .unwrap_or("0")
        .to_string();
    let force_fresh_overlay = payload
        .get("forceFreshOverlay")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let engine_path_for_response = engine_path.clone();

    // Capture early monitor state before spawn_blocking
    let early_active = state.early_monitor_active.clone();
    let early_pid = state.early_monitor_pid.clone();

    // === Blocking work on dedicated blocking thread pool ===
    overlay::append_overlay_log("Lanzando spawn_blocking para run_overlay_blocking...");
    let blocking_span = std::time::Instant::now();
    let blocking_result = tokio::task::spawn_blocking(move || {
        run_overlay_blocking(
            &app_dir,
            &engine_path,
            &resolved_dll,
            &game_path,
            &game_folder,
            &skin_entries,
            &extra_mod_entries,
            base_overlay_path.as_deref(),
            &patcher_flags,
            force_fresh_overlay,
            early_active,
            early_pid,
        )
    })
    .await
    .map_err(|e| format!("Panic en overlay: {}", e))?;
    overlay::append_overlay_log(&format!(
        "spawn_blocking retorno en {:.1}s",
        blocking_span.elapsed().as_secs_f64()
    ));

    // === Async section (write results back to state) ===
    match blocking_result {
        Ok((pid, overlay_path, alive, ready_flag, ready)) => {
            overlay::append_overlay_log(&format!("Guardando estado overlay: pid={}", pid));
            *state.running_overlay_process.lock().await = Some(pid);
            if let Some(alive) = alive {
                *state.running_overlay_alive.lock().await = Some(alive);
            }
            if let Some(ready_flag) = ready_flag {
                *state.running_overlay_ready.lock().await = Some(ready_flag);
            }
            *state.current_overlay_path.lock().await = overlay_path.clone();
            overlay::append_overlay_log("run_bocchi_overlay: OK, retornando respuesta.");
            Ok(serde_json::json!({
                "success": true,
                "ready": ready,
                "pid": pid,
                "profilePath": overlay_path,
                "enginePath": engine_path_for_response,
            }))
        }
        Err(e) => {
            overlay::append_overlay_log(&format!("run_bocchi_overlay: ERROR: {}", e));
            Err(e)
        }
    }
}

struct MonitorReleaseGuard(Arc<AtomicBool>);

impl Drop for MonitorReleaseGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn run_overlay_blocking(
    app_dir: &str,
    engine_path: &str,
    resolved_dll: &str,
    game_path: &str,
    game_folder: &str,
    skin_entries: &[serde_json::Value],
    extra_mod_entries: &[serde_json::Value],
    base_overlay_path: Option<&str>,
    patcher_flags: &str,
    _force_fresh_overlay: bool,
    early_active: Arc<AtomicBool>,
    early_pid: Arc<StdMutex<Option<u32>>>,
) -> Result<
    (
        u32,
        String,
        Option<Arc<AtomicBool>>,
        Option<Arc<AtomicBool>>,
        bool,
    ),
    String,
> {
    overlay::append_overlay_log(&format!(
        "[run_overlay_blocking] INICIO: engine={} game={} skins={}",
        engine_path,
        game_path,
        skin_entries.len()
    ));
    eprintln!(
        "[DIAG] INICIO: engine={} game={} skins={}",
        engine_path,
        game_path,
        skin_entries.len()
    );

    // There must be a single suspension owner. Two concurrent monitors can
    // suspend the same process twice and a single resume would leave it frozen.
    let using_early_monitor = early_active.load(Ordering::SeqCst);
    let suspension = if using_early_monitor {
        None
    } else {
        Some(overlay::GameSuspensionGuard::new(None, Some(game_path)))
    };
    let suspension_release_signal = suspension
        .as_ref()
        .map(|guard| guard.release_signal())
        .unwrap_or_else(|| early_active.clone());
    let _monitor_release = MonitorReleaseGuard(suspension_release_signal.clone());
    let early_pid_value = early_pid.lock().ok().and_then(|pid| *pid);
    if using_early_monitor {
        overlay::append_overlay_log(&format!(
            "[GameSuspend] Reutilizando monitor temprano estilo Rose (pid={:?}).",
            early_pid_value
        ));
    }
    overlay::append_overlay_log(&format!(
        "[GameSuspend] Guard creado (early={}), early monitor sigue={}.",
        using_early_monitor,
        early_active.load(Ordering::SeqCst)
    ));

    eprintln!(
        "[DIAG] Antes del bucle skin_entries. len={}",
        skin_entries.len()
    );
    let mut mod_paths: Vec<String> = Vec::new();
    for (i, entry) in skin_entries.iter().enumerate() {
        eprintln!("[DIAG] entry[{}] raw: {:?}", i, entry);
        let path = entry.get("path").and_then(|v| v.as_str()).unwrap_or("");
        eprintln!("[DIAG] entry[{}].path = {:?}", i, path);
        if path.is_empty() || !PathBuf::from(path).exists() {
            eprintln!("[DIAG] path NOT FOUND or EMPTY: {:?}", path);
            return Err(format!("Archivo no encontrado: {}", path));
        }
        overlay::append_overlay_log(&format!("Preparando mod: {}", path));
        eprintln!("[DIAG] Llamando generate_fantome_from_league_wad: {}", path);
        eprintln!("[DIAG] generate_fantome_from_league_wad COMIENZA: {}", path);
        match overlay::generate_fantome_from_league_wad(engine_path, game_path, entry, app_dir) {
            Ok(mod_path) => {
                eprintln!("[DIAG] generate_fantome_from_league_wad OK -> {}", mod_path);
                overlay::append_overlay_log(&format!("Mod preparado: {} -> {}", path, mod_path));
                mod_paths.push(mod_path);
            }
            Err(e) => {
                eprintln!("[DIAG] generate_fantome_from_league_wad ERROR: {}", e);
                overlay::append_overlay_log(&format!("Error preparando mod {}: {}", path, e));
                // Propagate error for main skin entries (user needs to know)
                return Err(format!("No pude preparar la skin {}: {}", path, e));
            }
        }
        eprintln!("[DIAG] Despues de generate_fantome (entry {})", i);
    }

    // Process extra mods (map, font, announcer, voiceover, ui, etc.)
    for (i, entry) in extra_mod_entries.iter().enumerate() {
        let path = entry.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let category = entry
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("others");
        if path.is_empty() || !PathBuf::from(path).exists() {
            eprintln!("[DIAG] extra_mod[{}] path NOT FOUND: {:?}", i, path);
            continue;
        }
        overlay::append_overlay_log(&format!("Preparando extra mod ({}): {}", category, path));
        match overlay::generate_fantome_from_league_wad(engine_path, game_path, entry, app_dir) {
            Ok(mod_path) => {
                eprintln!("[DIAG] extra_mod[{}] OK -> {}", i, mod_path);
                mod_paths.push(mod_path);
            }
            Err(e) => {
                eprintln!("[DIAG] extra_mod[{}] ERROR: {}", i, e);
                overlay::append_overlay_log(&format!(
                    "Error preparando extra mod {}: {}. Saltando.",
                    path, e
                ));
            }
        }
    }

    // Rose-style: always fresh overlay dir, no cache
    // Clean stale overlay dirs from previous builds (file lock avoidance)
    overlay::clean_all_overlay_dirs();
    // Allocate a fresh overlay directory (unique per build)
    let overlay_dir = overlay::next_overlay_dir();
    let _ = std::fs::create_dir_all(&overlay_dir);
    let profiles_dir = PathBuf::from(app_dir).join("cslol-profiles");
    std::fs::create_dir_all(&profiles_dir).ok();
    let overlay_state_dir = profiles_dir.join(".mkoverlay-state");

    let run_token = overlay::OverlayRunToken::new();
    // Rose construye un unico overlay con el conjunto final de mods. Un
    // overlay precompilado solo es valido cuando no hay mods adicionales;
    // copiar dos DATA compilados entre si puede mezclar WADs del mismo campeon.
    let can_use_base = mod_paths.is_empty()
        && base_overlay_path.map_or(false, |p| overlay::is_usable_overlay_path(p));
    if !mod_paths.is_empty() && base_overlay_path.is_some() {
        overlay::append_overlay_log(
            "Modo Rose: overlay base ignorado; se reconstruye todo en un unico mkoverlay.",
        );
    }

    overlay::append_overlay_log(&format!(
        "Mods preparados: {} use_base={}",
        mod_paths.len(),
        can_use_base
    ));

    if mod_paths.is_empty() && !can_use_base {
        return Err("Ningun mod pudo prepararse para el overlay.".to_string());
    }

    let mut final_overlay_path = String::new();
    let mut overlay_alive: Option<Arc<AtomicBool>> = None;
    let mut overlay_ready_flag: Option<Arc<AtomicBool>> = None;
    let mut overlay_ready = false;

    let result = if can_use_base && mod_paths.is_empty() {
        overlay::append_overlay_log("MODO PREBUILD DIRECTO: usando overlay base.");
        let base_path = base_overlay_path.unwrap().to_string();
        let ensured_dll = overlay::ensure_cslol_dll(engine_path, resolved_dll);

        let spawn_result = match ensured_dll {
            Ok(dll) => {
                final_overlay_path = base_path.clone();
                overlay::spawn_patcher_and_monitor(
                    engine_path,
                    &dll,
                    &base_path,
                    patcher_flags,
                    &run_token,
                    game_path,
                    Some(suspension_release_signal.clone()),
                )
                .map(|handle| {
                    overlay_ready = handle.hook_ready.load(Ordering::SeqCst);
                    overlay_ready_flag = Some(handle.hook_ready.clone());
                    overlay_alive = Some(handle.process_exited.clone());
                    handle.pid
                })
            }
            Err(e) => Err(format!("Error verificando DLL: {}", e)),
        };
        drop(suspension);
        spawn_result
    } else if can_use_base {
        overlay::append_overlay_log(&format!(
            "MODO MERGE -> fresh build (Rose-style): base={} extras={}",
            base_overlay_path.is_some(),
            mod_paths.len()
        ));

        // Rose always builds one fresh mkoverlay with all mods — no merge
        std::fs::remove_dir_all(&overlay_state_dir).ok();
        std::fs::create_dir_all(&overlay_state_dir).ok();

        overlay::append_overlay_log("Ejecutando execute_mkoverlay (merge fresh)...");
        if let Err(e) = overlay::execute_mkoverlay(
            engine_path,
            game_folder,
            &overlay_dir.to_string_lossy(),
            &overlay_state_dir.to_string_lossy(),
            &mod_paths,
            &run_token,
        ) {
            drop(suspension);
            overlay::append_overlay_log(&format!("execute_mkoverlay merge fallo: {}", e));
            return Err(format!("Error construyendo overlay: {}", e));
        }
        overlay::append_overlay_log("execute_mkoverlay merge completado.");

        let ensured_dll = overlay::ensure_cslol_dll(engine_path, resolved_dll);
        let spawn_result = match ensured_dll {
            Ok(dll) => {
                final_overlay_path = overlay_dir.to_string_lossy().to_string();
                overlay::append_overlay_log("Iniciando spawn_patcher_and_monitor (merge fresh)...");
                overlay::spawn_patcher_and_monitor(
                    engine_path,
                    &dll,
                    &overlay_dir.to_string_lossy(),
                    patcher_flags,
                    &run_token,
                    game_path,
                    Some(suspension_release_signal.clone()),
                )
                .map(|handle| {
                    overlay::append_overlay_log(&format!(
                        "spawn_patcher_and_monitor merge OK: pid={}",
                        handle.pid
                    ));
                    overlay_ready = handle.hook_ready.load(Ordering::SeqCst);
                    overlay_ready_flag = Some(handle.hook_ready.clone());
                    overlay_alive = Some(handle.process_exited.clone());
                    handle.pid
                })
                .map_err(|e| {
                    overlay::append_overlay_log(&format!(
                        "spawn_patcher_and_monitor merge fallo: {}",
                        e
                    ));
                    e
                })
            }
            Err(e) => Err(format!("Error verificando DLL: {}", e)),
        };
        drop(suspension);
        spawn_result
    } else {
        overlay::append_overlay_log(&format!(
            "MODO FULL BUILD: {} mods (siempre fresco)",
            mod_paths.len()
        ));

        std::fs::remove_dir_all(&overlay_state_dir).ok();
        std::fs::create_dir_all(&overlay_state_dir).ok();

        overlay::append_overlay_log("Ejecutando execute_mkoverlay...");
        if let Err(e) = overlay::execute_mkoverlay(
            engine_path,
            game_folder,
            &overlay_dir.to_string_lossy(),
            &overlay_state_dir.to_string_lossy(),
            &mod_paths,
            &run_token,
        ) {
            drop(suspension);
            overlay::append_overlay_log(&format!("execute_mkoverlay fallo: {}", e));
            return Err(format!("Error construyendo overlay: {}", e));
        }
        overlay::append_overlay_log("execute_mkoverlay completado.");

        let ensured_dll = overlay::ensure_cslol_dll(engine_path, resolved_dll);
        let spawn_result = match ensured_dll {
            Ok(dll) => {
                final_overlay_path = overlay_dir.to_string_lossy().to_string();
                overlay::append_overlay_log("Iniciando spawn_patcher_and_monitor...");
                overlay::spawn_patcher_and_monitor(
                    engine_path,
                    &dll,
                    &overlay_dir.to_string_lossy(),
                    patcher_flags,
                    &run_token,
                    game_path,
                    Some(suspension_release_signal.clone()),
                )
                .map(|handle| {
                    overlay::append_overlay_log(&format!(
                        "spawn_patcher_and_monitor OK: pid={}",
                        handle.pid
                    ));
                    overlay_ready = handle.hook_ready.load(Ordering::SeqCst);
                    overlay_ready_flag = Some(handle.hook_ready.clone());
                    overlay_alive = Some(handle.process_exited.clone());
                    handle.pid
                })
                .map_err(|e| {
                    overlay::append_overlay_log(&format!("spawn_patcher_and_monitor fallo: {}", e));
                    e
                })
            }
            Err(e) => Err(format!("Error verificando DLL: {}", e)),
        };
        drop(suspension);
        spawn_result
    };

    eprintln!("[DIAG] result obtenido, haciendo match...");
    match result {
        Ok(pid) => {
            overlay::append_overlay_log(&format!(
                "[run_overlay_blocking] FIN OK: pid={} path={}",
                pid, final_overlay_path
            ));
            eprintln!("[DIAG] FIN OK: pid={} path={}", pid, final_overlay_path);
            Ok((
                pid,
                final_overlay_path,
                overlay_alive,
                overlay_ready_flag,
                overlay_ready,
            ))
        }
        Err(e) => {
            overlay::append_overlay_log(&format!("[run_overlay_blocking] FIN ERROR: {}", e));
            eprintln!("[DIAG] FIN ERROR: {}", e);
            Err(e)
        }
    }
}

// Build Base Overlay

#[tauri::command]
pub async fn build_base_overlay(
    payload: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if *state.active_overlay_run.lock().await {
        overlay::append_overlay_log("Base overlay omitido: hay una inyeccion en preparacion.");
        return Ok(serde_json::json!({ "overlayPath": "" }));
    }

    let app_dir = state.app_data_dir.lock().await.clone();
    let sidecar_path = payload
        .get("sidecarPath")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let raw_game_path = payload
        .get("gamePath")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let game_path = match overlay::resolve_league_game_executable(raw_game_path) {
        Ok(path) => path,
        Err(_) => return Ok(serde_json::json!({ "overlayPath": "" })),
    };

    if game_path.is_empty() || !game_path.to_lowercase().ends_with("league of legends.exe") {
        return Ok(serde_json::json!({ "overlayPath": "" }));
    }

    let engine_path =
        match overlay::resolve_hitori_engine(sidecar_path, &crate::install_dir().to_string_lossy())
        {
            Ok(p) => p,
            Err(_) => return Ok(serde_json::json!({ "overlayPath": "" })),
        };
    if overlay::is_mod_tools(&engine_path) {
        // Rose always compiles the final mod set immediately before runoverlay.
        return Ok(serde_json::json!({ "overlayPath": "" }));
    }

    let skin_entries = payload
        .get("skinEntries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if skin_entries.is_empty() {
        return Ok(serde_json::json!({ "overlayPath": "" }));
    }

    let game_folder = PathBuf::from(&game_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let run_token = overlay::OverlayRunToken::new();
    overlay::append_overlay_log("=== PRE-BUILD BASE OVERLAY (mods custom) ===");

    let skin_paths_result: Result<Vec<String>, String> = skin_entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            if run_token.is_canceled() {
                return Err("Cancelado por el usuario.".to_string());
            }
            overlay::append_overlay_log(&format!(
                "Base mod #{}: {}",
                index + 1,
                entry.get("champion").and_then(|v| v.as_str()).unwrap_or("")
            ));
            overlay::generate_fantome_from_league_wad(&engine_path, &game_path, entry, &app_dir)
        })
        .collect();

    let skin_paths = match skin_paths_result {
        Ok(p) => p,
        Err(e) => {
            overlay::append_overlay_log(&format!("Base overlay error: {}", e));
            return Ok(serde_json::json!({ "overlayPath": "" }));
        }
    };

    overlay::append_overlay_log(&format!("Base mods finales: {}", skin_paths.join(" | ")));

    if run_token.is_canceled() {
        return Ok(serde_json::json!({ "overlayPath": "" }));
    }

    // Rose-style: fresh overlay dir
    overlay::clean_all_overlay_dirs();
    let overlay_dir = overlay::next_overlay_dir();
    let _ = std::fs::create_dir_all(&overlay_dir);

    let profiles_dir = PathBuf::from(&app_dir).join("cslol-profiles");
    std::fs::create_dir_all(&profiles_dir).ok();
    let overlay_state_dir = profiles_dir.join(".mkoverlay-state");

    overlay::append_overlay_log(&format!(
        "Base overlay path={}",
        overlay_dir.to_string_lossy()
    ));

    std::fs::create_dir_all(&profiles_dir).ok();
    std::fs::remove_dir_all(&overlay_state_dir).ok();
    std::fs::create_dir_all(&overlay_state_dir).ok();

    if let Err(e) = overlay::execute_mkoverlay(
        &engine_path,
        &game_folder,
        &overlay_dir.to_string_lossy(),
        &overlay_state_dir.to_string_lossy(),
        &skin_paths,
        &run_token,
    ) {
        overlay::append_overlay_log(&format!("Base overlay error: {}", e));
        return Ok(serde_json::json!({ "overlayPath": "" }));
    }

    if run_token.is_canceled() {
        return Ok(serde_json::json!({ "overlayPath": "" }));
    }

    let overlay_files = std::fs::read_dir(&overlay_dir)
        .map(|e| e.count())
        .unwrap_or(0);
    if overlay_files == 0 {
        overlay::append_overlay_log("mkoverlay no genero archivos");
        return Ok(serde_json::json!({ "overlayPath": "" }));
    }
    overlay::append_overlay_log(&format!(
        "Base overlay generado: {} archivos",
        overlay_files
    ));

    Ok(serde_json::json!({ "overlayPath": overlay_dir.to_string_lossy() }))
}

// Diagnose Overlay

#[tauri::command]
pub async fn diagnose_overlay(
    payload: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let mut checks: Vec<serde_json::Value> = Vec::new();

    let engine_path = payload
        .get("enginePath")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let dll_path = payload
        .get("dllPath")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let league_path = payload
        .get("leagueGamePath")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Check engine path (must end with ltk-manager.exe or mod-tools.exe)
    let engine_ok = {
        let p = PathBuf::from(engine_path);
        let basename = p
            .file_name()
            .map(|f| f.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let valid_name = basename == "ltk-manager.exe" || basename == "mod-tools.exe";
        !engine_path.is_empty() && valid_name && p.exists()
    };
    checks.push(serde_json::json!({
        "id": "engine",
        "label": "Engine",
        "ok": engine_ok,
        "value": engine_path,
        "message": if engine_ok { "OK" } else if engine_path.is_empty() {
            "Ruta no configurada"
        } else if !["ltk-manager.exe", "mod-tools.exe"].iter().any(|&n| engine_path.to_lowercase().ends_with(n)) {
            "No parece ltk-manager.exe o mod-tools.exe"
        } else {
            "No se encontro el archivo"
        },
    }));

    // Check DLL path (must end with .dll like Electron)
    let dll_name_ok = dll_path.to_lowercase().ends_with(".dll");
    let dll_ok = {
        let p = PathBuf::from(dll_path);
        !dll_path.is_empty() && dll_name_ok && p.exists()
    };
    checks.push(serde_json::json!({
        "id": "dll",
        "label": "DLL",
        "ok": dll_ok,
        "value": dll_path,
        "message": if dll_ok { "OK" } else if dll_path.is_empty() {
            "Ruta no configurada"
        } else if !dll_name_ok {
            "No parece un archivo DLL"
        } else {
            "No se encontro el archivo"
        },
    }));

    // Check League path (must end with League of Legends.exe)
    let league_name_ok = league_path
        .to_lowercase()
        .ends_with("league of legends.exe");
    let league_ok = {
        let p = PathBuf::from(league_path);
        !league_path.is_empty() && league_name_ok && p.exists()
    };
    checks.push(serde_json::json!({
        "id": "league",
        "label": "League",
        "ok": league_ok,
        "value": league_path,
        "message": if league_ok { "OK" } else if league_path.is_empty() {
            "Ruta no configurada o no valida"
        } else if !league_name_ok {
            "No parece League of Legends.exe"
        } else {
            "No se encontro el archivo"
        },
    }));

    // DLL source metadata (read as JSON, extract fields like Electron)
    let dll_meta_path = PathBuf::from(&app_dir)
        .join("engine")
        .join("tools")
        .join("dll-source.json");
    let dll_meta: Option<serde_json::Value> = std::fs::read_to_string(&dll_meta_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    let dll_meta_ok = dll_meta.is_some();
    let dll_meta_value = dll_meta
        .as_ref()
        .and_then(|m| m.get("installedPath").and_then(|v| v.as_str()))
        .unwrap_or("");
    let dll_meta_message = dll_meta
        .as_ref()
        .map(|m| {
            let source = m
                .get("sourceLabel")
                .and_then(|v| v.as_str())
                .unwrap_or("desconocida");
            let version = m.get("version").and_then(|v| v.as_str()).unwrap_or("");
            let asset = m
                .get("assetName")
                .and_then(|v| v.as_str())
                .unwrap_or("sin asset");
            format!("{} {} ({})", source, version, asset)
        })
        .unwrap_or_else(|| {
            "Sin metadata; coloca el DLL manualmente en la carpeta engine".to_string()
        });
    checks.push(serde_json::json!({
        "id": "dll-source",
        "label": "Fuente DLL",
        "ok": dll_meta_ok,
        "value": dll_meta_value,
        "message": dll_meta_message,
    }));

    // DLL runtime test
    if dll_ok && engine_ok {
        let eng = engine_path.to_string();
        let dll = dll_path.to_string();
        let test_result = tokio::task::spawn_blocking(move || test_dll_load(&eng, &dll))
            .await
            .map_err(|e| format!("Error joining test_dll_load: {}", e))?;
        checks.push(serde_json::json!({
            "id": "dll-runtime",
            "label": "Prueba DLL",
            "ok": test_result.0,
            "value": dll_path,
            "message": test_result.1,
        }));
    } else {
        checks.push(serde_json::json!({
            "id": "dll-runtime",
            "label": "Prueba DLL",
            "ok": false,
            "value": "",
            "message": "No se puede probar hasta tener Engine y DLL validos",
        }));
    }

    // Overlay status
    let overlay_running = state.running_overlay_process.lock().await.is_some();
    let overlay_path = state.current_overlay_path.lock().await.clone();
    checks.push(serde_json::json!({
        "id": "overlay",
        "label": "Overlay",
        "ok": overlay_running,
        "value": overlay_path,
        "message": if overlay_running { "Activo" } else { "Detenido" },
    }));

    let all_ok = checks
        .iter()
        .filter(|c| {
            c.get("id").and_then(|v| v.as_str()) != Some("overlay")
                && c.get("id").and_then(|v| v.as_str()) != Some("dll-source")
        })
        .all(|c| c.get("ok").and_then(|v| v.as_bool()).unwrap_or(false));

    Ok(serde_json::json!({
        "ok": all_ok,
        "checks": checks,
        "engine": engine_path,
        "league": league_path,
        "dll": dll_path,
    }))
}

fn test_dll_load(engine_path: &str, dll_path: &str) -> (bool, String) {
    let temp_root = PathBuf::from(std::env::temp_dir()).join("rift-atlas-dll-check");
    let overlay_root = temp_root.join("overlay").join("DATA");
    std::fs::create_dir_all(&overlay_root).ok();

    let tools_dir = PathBuf::from(engine_path)
        .parent()
        .unwrap_or(std::path::Path::new(""))
        .to_string_lossy()
        .to_string();

    let mut cmd = Command::new(engine_path);
    cmd.args([
        "patcher",
        "--dll",
        dll_path,
        "--overlay-root",
        &format!("{}\\", overlay_root.parent().unwrap().to_string_lossy()),
        "--flags",
        "0",
    ])
    .current_dir(&tools_dir)
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&temp_root);
            return (false, format!("No pude iniciar el patcher: {}", e));
        }
    };

    let start = std::time::Instant::now();
    let mut output = String::new();
    let timeout = std::time::Duration::from_secs(4);

    loop {
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = std::fs::remove_dir_all(&temp_root);
            if output.contains("End of life") || output.contains("EOL_TIMESTAMP") {
                return (false, "DLL vencida detectada.".to_string());
            }
            if output.contains("Initialized") || output.contains("Waiting for game") {
                return (true, "Carga inicial OK.".to_string());
            }
            return (
                true,
                format!(
                    "Sin error inmediato: {}",
                    output.chars().take(200).collect::<String>()
                ),
            );
        }

        if let Ok(Some(status)) = child.try_wait() {
            let _ = std::fs::remove_dir_all(&temp_root);
            return (
                false,
                format!(
                    "El patcher salio (code={}): {}",
                    status.code().unwrap_or(-1),
                    output.chars().take(200).collect::<String>()
                ),
            );
        }

        if let Some(mut stdout) = child.stdout.take() {
            let mut buf = [0u8; 4096];
            if let Ok(n) = stdout.read(&mut buf) {
                output.push_str(&String::from_utf8_lossy(&buf[..n]));
            }
            child.stdout = Some(stdout);
        }

        if output.contains("End of life") || output.contains("EOL_TIMESTAMP") {
            let _ = child.kill();
            let _ = std::fs::remove_dir_all(&temp_root);
            return (false, "DLL vencida detectada.".to_string());
        }

        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

// Maintenance

#[tauri::command]
pub async fn maintenance_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let base = PathBuf::from(&app_dir);
    let mut target_rows = Vec::new();
    let targets = [
        ("overlays", "overlay"),
        ("staging", "mod-tools-mods"),
        ("previews", "cache/previews"),
        ("party", "p2p"),
        ("party-transfers", "party-transfers"),
        ("downloads", "downloads"),
    ];

    for (key, sub) in &targets {
        let p = base.join(sub);
        let size = dir_size(&p);
        target_rows.push(serde_json::json!({
            "key": key,
            "name": key,
            "exists": p.exists(),
            "size": size,
            "path": p.to_string_lossy(),
        }));
    }

    Ok(serde_json::json!({
        "appDataDir": app_dir,
        "targets": target_rows,
    }))
}

#[tauri::command]
pub async fn cleanup_maintenance_target(
    targets: Vec<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let allowed = [
        ("overlays", "overlay"),
        ("previews", "cache/previews"),
        ("party", "p2p"),
        ("party-transfers", "party-transfers"),
        ("downloads", "downloads"),
        ("staging", "mod-tools-mods"),
    ];

    let mut removed: Vec<String> = Vec::new();
    for target in &targets {
        if let Some((_, sub_path)) = allowed.iter().find(|(key, _)| key == target) {
            let path = PathBuf::from(&app_dir).join(sub_path);
            if path.exists() {
                std::fs::remove_dir_all(&path).ok();
                removed.push(path.to_string_lossy().to_string());
            }
        }
    }

    Ok(serde_json::json!({ "removed": removed }))
}

#[tauri::command]
pub async fn export_diagnostics(
    payload: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let diagnostics = serde_json::json!({
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "appDataDir": app_dir,
        "clientPayload": payload,
        "maintenance": {
            "overlays": dir_size(&PathBuf::from(&app_dir).join("overlay")),
            "previews": dir_size(&PathBuf::from(&app_dir).join("cache").join("previews")),
            "party": dir_size(&PathBuf::from(&app_dir).join("p2p")),
            "staging": dir_size(&PathBuf::from(&app_dir).join("mod-tools-mods")),
        },
    });

    let export_path = PathBuf::from(&app_dir).join(format!(
        "rift-atlas-diagnostics-{}.json",
        chrono::Utc::now().timestamp_millis()
    ));

    let content = serde_json::to_string_pretty(&diagnostics)
        .map_err(|e| format!("Error serializing: {}", e))?;
    std::fs::write(&export_path, &content).map_err(|e| format!("Error writing: {}", e))?;

    let _ = Command::new("explorer")
        .args(["/select,", &export_path.to_string_lossy()])
        .spawn();

    Ok(serde_json::json!({
        "exportPath": export_path.to_string_lossy(),
        "appDataDir": app_dir,
    }))
}

#[tauri::command]
pub async fn open_logs_folder(state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.app_data_dir.lock().await.clone();
    std::fs::create_dir_all(&dir).ok();
    let _ = Command::new("explorer").arg(&dir).spawn();
    Ok(())
}

// Startup / flags

#[tauri::command]
pub async fn app_get_startup_flags(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let first_run_path = PathBuf::from(&app_dir).join(".first-run-complete");
    let first_run = !first_run_path.exists();
    let debug = state.debug_mode;
    Ok(serde_json::json!({
        "firstRun": first_run,
        "flags": {
            "debug": debug,
        },
    }))
}

#[tauri::command]
pub async fn app_mark_first_run_complete(state: State<'_, AppState>) -> Result<(), String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let path = PathBuf::from(&app_dir).join(".first-run-complete");
    std::fs::write(&path, chrono::Utc::now().to_rfc3339()).map_err(|e| format!("Error: {}", e))
}

fn league_skins_install_ready(path: &std::path::Path) -> bool {
    path.join("skins").is_dir() && path.join("resources").is_dir()
}

#[tauri::command]
pub async fn app_bootstrap_first_run(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let base = PathBuf::from(&app_dir);
    let marker = base.join(".first-run-dependencies-complete");
    let engine_dir = base.join("engine").join("tools");
    let engine_path = ["mod-tools.exe", "ltk-manager.exe"]
        .iter()
        .map(|name| engine_dir.join(name))
        .find(|p| p.is_file());
    let dll_path = engine_dir.join("cslol-dll.dll");
    let league_skins_path = base.join("downloaded-libraries").join("LeagueSkins");
    let pengu_dir = base.join(PENGU_LOADER_DIR);

    let pengu_path = find_pengu_exe(&pengu_dir).unwrap_or_default();
    let all_present = engine_path.is_some()
        && league_skins_install_ready(&league_skins_path)
        && !pengu_path.is_empty();

    if all_present {
        if !marker.exists() {
            let _ = std::fs::write(&marker, chrono::Utc::now().to_rfc3339());
        }
        return Ok(serde_json::json!({
            "complete": true,
            "skipped": true,
            "enginePath": engine_path.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            "dllReady": dll_path.is_file(),
            "dllPath": dll_path.to_string_lossy(),
            "injectionReady": dll_path.is_file(),
            "leagueSkinsPath": league_skins_path.to_string_lossy(),
            "penguPath": pengu_path,
            "errors": [],
        }));
    }

    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "type": "first-run-bootstrap",
            "message": "Preparando componentes iniciales...",
            "percent": 0,
        }),
    );

    // Check for bundled rose-tools BEFORE the blocking task
    let bundled_mod_tools = app.path().resource_dir().ok()
        .map(|res| res.join("rose-tools").join("mod-tools.exe"))
        .filter(|p| p.is_file())
        .or_else(|| {
            // NSIS places resources alongside the exe
            let exe_dir = crate::install_dir();
            let f = exe_dir.join("rose-tools").join("mod-tools.exe");
            if f.is_file() { Some(f) } else { None }
        })
        .or_else(|| {
            // Dev mode (npm start): rose-tools/ at project root
            std::env::current_exe().ok().and_then(|exe| {
                let mut path = exe.parent()?;
                for _ in 0..4 { path = path.parent()?; }
                let f = path.join("rose-tools").join("mod-tools.exe");
                if f.is_file() { Some(f) } else { None }
            })
        });

    let app_for_download = app.clone();
    let app_dir_for_download = app_dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let base = PathBuf::from(&app_dir_for_download);
        let engine_dir = base.join("engine").join("tools");
        let engine_exists = ["mod-tools.exe", "ltk-manager.exe"]
            .iter()
            .any(|name| engine_dir.join(name).is_file());
        let league_skins_path = base.join("downloaded-libraries").join("LeagueSkins");
        let pengu_dir = base.join(PENGU_LOADER_DIR);
        let mut errors: Vec<String> = Vec::new();

        if !engine_exists {
            // Try bundled rose-tools first (from NSIS installer)
            let mut copied = false;
            if let Some(bundled_exe) = bundled_mod_tools.as_ref() {
                let target = engine_dir.join("mod-tools.exe");
                std::fs::create_dir_all(&engine_dir).ok();
                if std::fs::copy(bundled_exe, &target).is_ok() {
                    copied = true;
                }
            }
            if !copied {
                let progress_app = app_for_download.clone();
                if let Err(error) =
                    downloads::download_cslol_manager_modtools(&app_dir_for_download, move |payload| {
                        let _ = progress_app.emit("download-progress", payload);
                    })
                {
                    errors.push(format!("Engine mod-tools: {}", error));
                }
            }
        }

        let league_ready = league_skins_install_ready(&league_skins_path);
        if !league_ready {
            let progress_app = app_for_download.clone();
            if let Err(error) =
                downloads::download_league_skins(&app_dir_for_download, move |payload| {
                    let _ = progress_app.emit("download-progress", payload);
                })
            {
                errors.push(format!("LeagueSkins: {}", error));
            }
        } else {
            let progress_app = app_for_download.clone();
            let _ = downloads::download_league_skins_incremental(
                &app_dir_for_download,
                move |payload| {
                    let _ = progress_app.emit("download-progress", payload);
                },
            );
        }

        let existing_pengu = find_pengu_exe(&pengu_dir).unwrap_or_default();
        if existing_pengu.is_empty() {
            let progress_app = app_for_download.clone();
            if let Err(error) =
                downloads::download_pengu_loader_rose(&app_dir_for_download, move |payload| {
                    let _ = progress_app.emit("download-progress", payload);
                })
            {
                errors.push(format!("Pengu Loader: {}", error));
            }
        }

        let final_pengu = find_pengu_exe(&pengu_dir).unwrap_or_default();
        let final_engine_exists = ["mod-tools.exe", "ltk-manager.exe"]
            .iter()
            .any(|name| engine_dir.join(name).is_file());
        (final_engine_exists, league_skins_path, final_pengu, errors)
    })
    .await
    .map_err(|error| format!("Error preparando primera ejecucion: {}", error))?;

    let (engine_ready, league_skins_path, pengu_path, mut errors) = result;
    let league_ready = league_skins_install_ready(&league_skins_path);
    let dll_ready = dll_path.is_file();
    let mut pengu_ready = !pengu_path.is_empty();
    if pengu_ready {
        if let Err(error) = pengu_install_rift_plugin_inner(&app_dir) {
            errors.push(format!("Plugins de Pengu: {}", error));
            pengu_ready = false;
        }
    }

    let mut complete = engine_ready && league_ready && pengu_ready && errors.is_empty();
    if complete {
        if let Err(error) = std::fs::write(&marker, chrono::Utc::now().to_rfc3339()) {
            errors.push(format!("No pude guardar el estado inicial: {}", error));
            complete = false;
        }
    }

    let message = if complete && dll_ready {
        "Componentes iniciales listos para inyectar."
    } else if complete {
        "Descargas iniciales listas. Falta agregar cslol-dll.dll para poder inyectar."
    } else {
        "La preparacion inicial quedo incompleta; se reintentara al abrir Rift Atlas."
    };
    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "type": "first-run-bootstrap",
            "message": message,
            "percent": if complete { 100 } else { 0 },
        }),
    );

    let final_engine_path = if engine_ready {
        ["mod-tools.exe", "ltk-manager.exe"]
            .iter()
            .map(|name| base.join("engine").join("tools").join(name))
            .find(|p| p.is_file())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    Ok(serde_json::json!({
        "complete": complete,
        "skipped": false,
        "enginePath": final_engine_path,
        "dllReady": dll_ready,
        "dllPath": dll_path.to_string_lossy().to_string(),
        "injectionReady": complete && dll_ready,
        "leagueSkinsPath": if league_ready { league_skins_path.to_string_lossy().to_string() } else { String::new() },
        "penguPath": pengu_path,
        "errors": errors,
    }))
}

#[tauri::command]
pub async fn app_factory_reset(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let base = PathBuf::from(&app_dir);

    // Stop overlay first
    let mut proc = state.running_overlay_process.lock().await;
    if let Some(pid) = proc.take() {
        overlay::stop_patcher(pid, "");
    }
    drop(proc);

    // Kill Pengu processes and deactivate (like Electron)
    for exe in &["Pengu Loader.exe", "PenguLoader.exe", "pengu-loader.exe"] {
        let _ = hidden_command("taskkill").args(["/IM", exe, "/F"]).output();
    }
    let _ = set_rose_pengu_disabled(true);
    clear_pengu_active_flag(&app_dir);

    let reset_targets = [
        "cache",
        "overlay",
        "cslol-profiles",
        "downloaded-libraries",
        "downloaded-updates",
        "engine",
        "hashtable",
        "ltk-dll",
        "mod-files",
        "cslol-mod-staging",
        "party",
        "party-transfers",
        "pengu-loader",
        "Pengu Loader",
        "presets",
        "skin-library-index.json",
        "engine-version.txt",
        "overlay.log",
        "last-overlay-log.txt",
        ".first-run-complete",
        ".first-run-dependencies-complete",
        "p2p",
        "downloads",
    ];

    let mut removed: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();

    for target in &reset_targets {
        let path = base.join(target);
        if path.exists() {
            let result = if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
            match result {
                Ok(_) => removed.push(target.to_string()),
                Err(e) => failed.push(format!("{}: {}", target, e)),
            }
        }
    }

    // Schedule app relaunch after returning (like Electron's app.relaunch() + app.exit(0))
    let app_for_restart = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        app_for_restart.restart();
    });

    Ok(serde_json::json!({
        "scheduled": true,
        "userDataPath": app_dir,
        "removed": removed,
        "failed": failed,
    }))
}

#[tauri::command]
pub async fn app_tutorial_log(payload: String) -> Result<(), String> {
    println!("[Tutorial] {}", payload);
    Ok(())
}

// Library cache

#[tauri::command]
pub async fn library_cache_preview(
    payload: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let source = payload
        .get("source")
        .or_else(|| payload.get("url"))
        .or_else(|| payload.get("path"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if source.is_empty() {
        return Err("No source provided".to_string());
    }

    let app_dir = state.app_data_dir.lock().await.clone();
    let cache_dir = PathBuf::from(&app_dir).join("cache").join("previews");
    std::fs::create_dir_all(&cache_dir).ok();

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(source.as_bytes());
    let key = hex::encode(hasher.finalize());
    let key = &key[..40];

    let ext = if source.starts_with("http") {
        ".jpg"
    } else {
        let p = PathBuf::from(source);
        match p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("jpg")
            .to_lowercase()
            .as_str()
        {
            "png" => ".png",
            "webp" => ".webp",
            "jpg" | "jpeg" => ".jpg",
            _ => ".jpg",
        }
    };

    let preview_path = cache_dir.join(format!("{}{}", key, ext));

    let data = if source.starts_with("http") {
        let bytes = overlay::download_url(source)?;
        std::fs::write(&preview_path, &bytes)
            .map_err(|e| format!("Error writing preview: {}", e))?;
        bytes
    } else if PathBuf::from(source).exists() {
        let bytes = std::fs::read(source).map_err(|e| format!("Error reading source: {}", e))?;
        std::fs::write(&preview_path, &bytes)
            .map_err(|e| format!("Error writing preview: {}", e))?;
        bytes
    } else {
        return Err("Source not found".to_string());
    };

    Ok(serde_json::json!({
        "previewPath": preview_path.to_string_lossy(),
        "previewUrl": format!("file:///{}", preview_path.to_string_lossy().replace('\\', "/")),
        "size": data.len(),
    }))
}

// Mod helpers

#[tauri::command]
pub async fn index_custom_mod_files(files: Vec<String>) -> Result<Vec<serde_json::Value>, String> {
    index_custom_mod_paths(files, None)
}

fn index_custom_mod_paths(
    files: Vec<String>,
    root_path: Option<&str>,
) -> Result<Vec<serde_json::Value>, String> {
    let mut entries = Vec::new();
    for f in &files {
        let p = PathBuf::from(f);
        if !p.exists() {
            continue;
        }
        let file_name = p
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let stem = p
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let ext = get_mod_package_extension(&p);
        if ![".fantome", ".zip", ".wad", ".wad.client", ".rse"].contains(&ext.as_str()) {
            continue;
        }
        let meta = std::fs::metadata(&p).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);

        let archive_info = overlay::inspect_archive(&p.to_string_lossy())
            .unwrap_or_else(|_| serde_json::json!({}));
        let relative_path = root_path
            .and_then(|root| p.strip_prefix(root).ok())
            .map(|rel| rel.to_string_lossy().to_string())
            .unwrap_or_else(|| file_name.clone());
        let relative_parts: Vec<String> = relative_path
            .split(&['\\', '/'][..])
            .filter(|part| !part.is_empty())
            .map(|part| part.to_string())
            .collect();
        let rose_skin_id = if relative_parts
            .first()
            .map(|part| part.eq_ignore_ascii_case("skins"))
            .unwrap_or(false)
        {
            relative_parts
                .get(1)
                .and_then(|part| part.parse::<u64>().ok())
        } else {
            None
        };
        let rose_champion_id = rose_skin_id.map(|id| id / 1000).filter(|id| *id > 0);
        let rose_skin_num = rose_skin_id.map(|id| id % 1000);
        let champion_value = rose_champion_id
            .map(|id| id.to_string())
            .unwrap_or_default();
        let skin_value = rose_skin_id.map(|id| id.to_string()).unwrap_or_default();
        let variant_value = if rose_skin_id.is_some() {
            stem.clone()
        } else {
            stem.clone()
        };

        entries.push(serde_json::json!({
            "path": p.to_string_lossy(),
            "name": file_name,
            "extension": ext,
            "size": size,
            "skin": skin_value,
            "champion": champion_value,
            "rawChampion": champion_value,
            "rawSkin": skin_value,
            "rawVariant": variant_value,
            "championKey": champion_value,
            "championId": champion_value,
            "skinId": rose_skin_id,
            "skinNum": rose_skin_num,
            "variant": variant_value,
            "relativePath": relative_path,
            "custom": true,
            "source": if rose_skin_id.is_some() { "user-mods" } else { "local" },
            "archiveInfo": archive_info,
            "targetWads": archive_info.as_object().and_then(|o| o.get("targetWads")).cloned().unwrap_or(serde_json::Value::Array(vec![])),
            "targetSkinNums": archive_info.as_object().and_then(|o| o.get("targetSkinNums")).cloned().unwrap_or(serde_json::Value::Array(vec![])),
        }));
    }
    Ok(entries)
}

fn get_mod_package_extension(path: &PathBuf) -> String {
    let lower = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if lower.ends_with(".wad.client") {
        ".wad.client".to_string()
    } else {
        path.extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default()
    }
}

#[tauri::command]
pub async fn mods_select_ltk(app: AppHandle) -> Result<String, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("LTK Manager", &["exe"])
        .blocking_pick_file();
    Ok(file.map(|p| p.to_string()).unwrap_or_default())
}

#[tauri::command]
pub async fn mods_open_ltk(executable_path: String) -> Result<(), String> {
    let _ = Command::new(&executable_path).spawn();
    Ok(())
}

#[tauri::command]
pub async fn ltk_detect() -> Result<serde_json::Value, String> {
    let known_binaries = ["ltk-manager.exe", "mod-tools.exe"];
    let mut candidates = Vec::new();
    for bin in &known_binaries {
        candidates.push(
            crate::install_dir()
                .join("engine")
                .join("tools")
                .join(bin)
                .to_string_lossy()
                .to_string(),
        );
        candidates.push(format!("C:\\Program Files\\LTK Manager\\{}", bin));
        candidates.push(format!("C:\\Program Files (x86)\\LTK Manager\\{}", bin));
    }

    for path in &candidates {
        if PathBuf::from(path).exists() {
            return Ok(serde_json::json!({ "installed": true, "path": path }));
        }
    }
    Ok(serde_json::json!({ "installed": false }))
}

#[tauri::command]
pub async fn ltk_get_status(
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let exe_path = payload
        .and_then(|p| {
            p.get("exePath")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();
    let exe_exists = !exe_path.is_empty() && PathBuf::from(&exe_path).exists();

    let data_dir = crate::install_dir().join("ltk-manager");
    let data_dir_exists = data_dir.exists();

    let library = if data_dir_exists {
        let lib_path = data_dir.join("library.json");
        std::fs::read_to_string(&lib_path)
            .ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
    } else {
        None
    };

    Ok(serde_json::json!({
        "exePath": exe_path,
        "exeExists": exe_exists,
        "dataDir": data_dir.to_string_lossy(),
        "dataDirExists": data_dir_exists,
        "library": library,
    }))
}

#[tauri::command]
pub async fn ltk_import_mods(
    payload: serde_json::Value,
    _state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    use uuid::Uuid;

    let mods = payload
        .get("mods")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if mods.is_empty() {
        return Err("No hay mods para importar.".to_string());
    }

    let data_dir = crate::install_dir().join("ltk-manager");
    let archives_dir = data_dir.join("archives");
    let mods_dir = data_dir.join("mods");
    let library_path = data_dir.join("library.json");
    let archives_meta_path = data_dir.join("archives.json");

    std::fs::create_dir_all(&archives_dir).ok();
    std::fs::create_dir_all(&mods_dir).ok();

    // Read or create library
    let mut library: serde_json::Value = std::fs::read_to_string(&library_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_else(|| {
            serde_json::json!({
                "profiles": [],
                "mods": [],
                "folders": [],
                "last_opened": null,
            })
        });

    let mut archives_meta: serde_json::Value = std::fs::read_to_string(&archives_meta_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_else(|| serde_json::json!({ "archives": [] }));

    // Collect existing names
    let mut existing_names: Vec<String> = Vec::new();
    if let Some(mods_arr) = library["mods"].as_array() {
        for m in mods_arr {
            if let Some(name) = m["source_filename"].as_str() {
                existing_names.push(name.to_lowercase());
            }
        }
    }
    if let Some(archives_arr) = archives_meta["archives"].as_array() {
        for a in archives_arr {
            if let Some(name) = a["original_name"].as_str() {
                existing_names.push(name.to_lowercase());
            }
        }
    }

    let mut results: Vec<serde_json::Value> = Vec::new();
    let mut new_mods: Vec<serde_json::Value> = Vec::new();

    for m in &mods {
        let source_path = m.get("path").and_then(|v| v.as_str()).unwrap_or("");
        if source_path.is_empty() || !PathBuf::from(source_path).exists() {
            results.push(serde_json::json!({
                "path": source_path,
                "success": false,
                "error": "Archivo no encontrado",
            }));
            continue;
        }

        let ext = PathBuf::from(source_path)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if ext != "fantome" && ext != "modpkg" {
            results.push(serde_json::json!({
                "path": source_path,
                "success": false,
                "error": format!("Extension no soportada: .{}", ext),
            }));
            continue;
        }

        let source_filename = PathBuf::from(source_path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        if existing_names.contains(&source_filename.to_lowercase()) {
            results.push(serde_json::json!({
                "path": source_path,
                "success": true,
                "skipped": true,
                "message": "Ya importado anteriormente",
            }));
            continue;
        }

        let mod_id = Uuid::new_v4().to_string();
        let champion = m
            .get("champion")
            .and_then(|v| v.as_str())
            .unwrap_or("Desconocido");
        let skin_name = m
            .get("skin")
            .and_then(|v| v.as_str())
            .unwrap_or(&source_filename);
        let variant = m.get("variant").and_then(|v| v.as_str()).unwrap_or("");
        let display_name = if variant.is_empty() {
            format!("{} - {}", champion, skin_name)
        } else {
            format!("{} - {} - {}", champion, skin_name, variant)
        };

        let archive_path = archives_dir.join(format!("{}.{}", mod_id, ext));
        std::fs::copy(source_path, &archive_path).map_err(|e| format!("Error copying: {}", e))?;

        let meta =
            std::fs::metadata(source_path).map_err(|e| format!("Error reading metadata: {}", e))?;
        let now = chrono::Utc::now().to_rfc3339();

        // Add to archives meta
        if let Some(archives_arr) = archives_meta["archives"].as_array_mut() {
            archives_arr.push(serde_json::json!({
                "id": mod_id,
                "original_name": source_filename,
                "title": display_name,
                "size": meta.len(),
                "compression": null,
                "created_at": now,
            }));
        }

        // Create mod config
        let mod_config = serde_json::json!({
            "id": mod_id,
            "title": display_name,
            "author": "",
            "version": "1.0.0",
            "description": "",
            "groups": [],
            "tags": [],
            "color": null,
            "size": meta.len(),
            "installed_size": null,
            "enabled": true,
            "source_archive": mod_id,
            "source_filename": source_filename,
            "champion_name": champion,
            "skin_name": skin_name,
            "created_at": now,
        });

        let mod_config_dir = mods_dir.join(&mod_id);
        std::fs::create_dir_all(&mod_config_dir).ok();
        std::fs::write(
            mod_config_dir.join("mod.config.json"),
            serde_json::to_string_pretty(&mod_config).unwrap(),
        )
        .ok();

        new_mods.push(mod_config.clone());

        if let Some(mods_arr) = library["mods"].as_array_mut() {
            mods_arr.push(mod_config);
        }

        existing_names.push(source_filename.to_lowercase());

        results.push(serde_json::json!({
            "path": source_path,
            "modId": mod_id,
            "displayName": display_name,
            "success": true,
        }));
    }

    // Ensure Rift Atlas profile
    let now = chrono::Utc::now().to_rfc3339();
    let mut rift_profile: Option<usize> = None;
    if let Some(profiles) = library["profiles"].as_array_mut() {
        for (i, p) in profiles.iter().enumerate() {
            if p["name"].as_str() == Some("Rift Atlas") {
                rift_profile = Some(i);
                break;
            }
        }

        match rift_profile {
            Some(idx) => {
                let profile = &mut profiles[idx];
                if let Some(profile_mods) = profile["mods"].as_array_mut() {
                    let existing_ids: std::collections::HashSet<String> = profile_mods
                        .iter()
                        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                        .collect();
                    for m in &new_mods {
                        let mid = m["id"].as_str().unwrap_or("");
                        if !existing_ids.contains(mid) {
                            profile_mods.push(serde_json::json!({ "id": mid, "enabled": true }));
                        }
                    }
                }
            }
            None => {
                let new_profile = serde_json::json!({
                    "id": Uuid::new_v4().to_string(),
                    "name": "Rift Atlas",
                    "mods": new_mods.iter().map(|m| serde_json::json!({ "id": m["id"], "enabled": true })).collect::<Vec<_>>(),
                    "created_at": now,
                });
                profiles.push(new_profile);
            }
        }
    }

    library["last_opened"] = serde_json::json!(library["profiles"]
        .as_array()
        .and_then(|p| p.iter().find(|p| p["name"] == "Rift Atlas"))
        .and_then(|p| p["id"].as_str()));

    std::fs::write(
        &library_path,
        serde_json::to_string_pretty(&library).unwrap(),
    )
    .ok();
    std::fs::write(
        &archives_meta_path,
        serde_json::to_string_pretty(&archives_meta).unwrap(),
    )
    .ok();

    let imported = results
        .iter()
        .filter(|r| r["success"].as_bool() == Some(true) && r["skipped"].as_bool() != Some(true))
        .count();
    let skipped = results
        .iter()
        .filter(|r| r["skipped"].as_bool() == Some(true))
        .count();
    let failed = results
        .iter()
        .filter(|r| r["success"].as_bool() != Some(true))
        .count();
    let profile_id = library["profiles"]
        .as_array()
        .and_then(|p| p.iter().find(|p| p["name"] == "Rift Atlas"))
        .and_then(|p| p["id"].as_str().map(|s| s.to_string()));

    Ok(serde_json::json!({
        "success": true,
        "imported": imported,
        "skipped": skipped,
        "failed": failed,
        "results": results,
        "profileId": profile_id,
    }))
}

#[tauri::command]
pub async fn ltk_download_and_install(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    downloads::download_ltk_manager(&app_dir)
}

fn resolve_preferred_engine(
    selected_path: Option<&str>,
    app_dir: &str,
    preferred_binary: &str,
) -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(path) = selected_path.filter(|p| !p.is_empty()) {
        let selected = PathBuf::from(path);
        let selected_name = selected
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if selected_name == preferred_binary {
            candidates.push(selected.clone());
        }
        if selected.is_dir() {
            candidates.push(selected.join(preferred_binary));
        }
        if let Some(parent) = selected.parent() {
            candidates.push(parent.join(preferred_binary));
        }
    }

    candidates.push(
        PathBuf::from(app_dir)
            .join("engine")
            .join("tools")
            .join(preferred_binary),
    );

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    overlay::resolve_hitori_engine("", &crate::install_dir().to_string_lossy())
        .ok()
        .filter(|path| {
            PathBuf::from(path)
                .file_name()
                .map(|n| n.to_string_lossy().eq_ignore_ascii_case(preferred_binary))
                .unwrap_or(false)
        })
}

#[tauri::command]
pub async fn mods_auto_configure_overlay(
    payload: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let engine_path = payload
        .as_ref()
        .and_then(|p| p.get("enginePath").and_then(|v| v.as_str()));
    let engine_binary = payload
        .as_ref()
        .and_then(|p| p.get("engineBinary").and_then(|v| v.as_str()))
        .filter(|v| *v == "mod-tools.exe" || *v == "ltk-manager.exe")
        .unwrap_or("mod-tools.exe");
    let league_path = payload
        .as_ref()
        .and_then(|p| p.get("leagueGamePath").and_then(|v| v.as_str()));
    let dll_from_payload = payload
        .as_ref()
        .and_then(|p| p.get("dllPath").and_then(|v| v.as_str()));

    let mut warnings: Vec<String> = Vec::new();

    let engine = resolve_preferred_engine(engine_path, &app_dir, engine_binary);
    if engine.is_none() {
        warnings.push(format!(
            "No encontre {}. Instalalo desde Descargas o selecciona el ejecutable manualmente.",
            engine_binary
        ));
    }

    // league: try given path, then fallback candidates (like resolveLeagueGameExecutableOptional)
    let league = league_path
        .filter(|p| !p.is_empty())
        .and_then(|p| overlay::resolve_league_game_executable(p).ok())
        .or_else(|| {
            let candidates = [
                "C:\\Riot Games\\League of Legends\\Game\\League of Legends.exe",
                "D:\\Riot Games\\League of Legends\\Game\\League of Legends.exe",
            ];
            for c in &candidates {
                if let Ok(p) = overlay::resolve_league_game_executable(c) {
                    return Some(p);
                }
            }
            None
        });
    if league.is_none() {
        warnings.push("No encontre League of Legends.exe.".to_string());
    }

    // dll: try from payload, then engine dir, then app_dir/engine/cslol-dll.dll
    let dll_path = dll_from_payload
        .filter(|p| !p.is_empty())
        .filter(|p| PathBuf::from(p).exists())
        .map(|p| p.to_string())
        .or_else(|| {
            let dll = PathBuf::from(&app_dir)
                .join("engine")
                .join("tools")
                .join("cslol-dll.dll");
            if dll.exists() {
                Some(dll.to_string_lossy().to_string())
            } else {
                None
            }
        });
    if dll_path.is_none() {
        warnings.push(
            "No encontre cslol-dll.dll junto al engine. Pegalo manualmente en la carpeta engine."
                .to_string(),
        );
    }

    Ok(serde_json::json!({
        "success": engine.is_some() && dll_path.is_some() && league.is_some(),
        "enginePath": engine,
        "dllPath": dll_path,
        "leagueGamePath": league,
        "ltkPath": "",
        "warnings": warnings,
    }))
}

#[tauri::command]
pub async fn mods_download_cslol_tools(
    payload: Option<serde_json::Value>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let engine_binary = payload
        .as_ref()
        .and_then(|p| p.get("engineBinary").and_then(|v| v.as_str()))
        .filter(|v| *v == "mod-tools.exe" || *v == "ltk-manager.exe")
        .unwrap_or("mod-tools.exe")
        .to_string();
    let engine_label = if engine_binary == "mod-tools.exe" {
        "mod-tools"
    } else {
        "LTK"
    };
    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "type": "engine",
            "message": format!("Descargando {}...", engine_label),
            "percent": 0,
        }),
    );

    let app_for_download = app.clone();
    let app_dir_for_download = app_dir.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        if engine_binary == "mod-tools.exe" {
            downloads::download_cslol_manager_modtools(&app_dir_for_download, |payload| {
                let _ = app_for_download.emit("download-progress", payload);
            })
                .map(|engine_path| {
                    let engine_dir = PathBuf::from(&app_dir_for_download).join("engine").join("tools");
                    let dll_path = engine_dir.join("cslol-dll.dll");
                    serde_json::json!({
                        "version": "cslol-manager",
                        "assetName": "cslol-manager-windows.exe",
                        "toolsDir": engine_dir.to_string_lossy(),
                        "enginePath": engine_path,
                        "dllPath": if dll_path.exists() { dll_path.to_string_lossy().to_string() } else { String::new() },
                        "dllInstalled": dll_path.exists(),
                        "dllSourceLabel": if dll_path.exists() { "DLL en carpeta engine" } else { "DLL manual requerida" },
                        "manualDllRequired": !dll_path.exists(),
                    })
                })
        } else {
            downloads::download_hitori_engine(&app_dir_for_download, &engine_binary, |payload| {
                let _ = app_for_download.emit("download-progress", payload);
            })
        }
    })
    .await
    .map_err(|e| format!("Error ejecutando descarga: {}", e))??;

    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "type": "engine",
            "message": "Engine descargado. Verificando DLL...",
            "percent": 90,
        }),
    );

    let dll_path = result
        .get("dllPath")
        .and_then(|v: &serde_json::Value| v.as_str())
        .unwrap_or("");

    if !dll_path.is_empty() {
        let _ = app.emit(
            "download-progress",
            serde_json::json!({
                "type": "engine",
                "message": format!("DLL lista: {}", dll_path),
                "percent": 100,
            }),
        );
    }

    Ok(serde_json::json!({
        "enginePath": result["enginePath"],
        "sidecarPath": result["enginePath"],
        "version": result["version"],
        "assetName": result["assetName"],
        "toolsDir": result["toolsDir"],
        "dllPath": dll_path,
        "dllSourcePath": dll_path,
        "dllSourceLabel": if dll_path.is_empty() { "DLL manual requerida" } else { "DLL local en carpeta engine" },
        "manualDllRequired": dll_path.is_empty(),
        "dllInstallMessage": if dll_path.is_empty() {
            "DLL no encontrada. Pegala manualmente en la carpeta engine.".to_string()
        } else {
            format!("DLL lista junto al engine: {}", dll_path)
        },
    }))
}

#[tauri::command]
pub async fn download_league_skins(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();

    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "type": "league-skins",
            "message": "Descargando LeagueSkins...",
            "percent": 0,
        }),
    );

    let app_for_download = app.clone();
    let app_dir_for_download = app_dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        downloads::download_league_skins_incremental(&app_dir_for_download, |payload| {
            let _ = app_for_download.emit("download-progress", payload);
        })
    })
    .await
    .map_err(|e| format!("Error ejecutando descarga: {}", e))??;

    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "type": "league-skins",
            "message": "Indexando LeagueSkins...",
            "percent": 80,
        }),
    );

    let folder_path = result["folderPath"].as_str().unwrap_or("");
    let skins = if !folder_path.is_empty() {
        downloads::index_skin_library(folder_path, &app_dir).unwrap_or_default()
    } else {
        Vec::new()
    };

    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "type": "league-skins",
            "message": format!("LeagueSkins listo: {} paquete(s).", skins.len()),
            "percent": 100,
        }),
    );

    Ok(serde_json::json!({
        "folderPath": folder_path,
        "branch": result["branch"],
        "skins": skins,
    }))
}

// Party file operations

#[tauri::command]
pub async fn party_get_file_info(file_path: String) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err("Archivo no encontrado".into());
    }
    let meta = std::fs::metadata(&path).map_err(|e| format!("Error reading metadata: {}", e))?;
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    // Calculate SHA256
    use sha2::{Digest, Sha256};
    let data = std::fs::read(&path).map_err(|e| format!("Error reading: {}", e))?;
    let hash = hex::encode(Sha256::digest(&data));

    let mime = match ext.to_lowercase().as_str() {
        "wad" | "wad.client" => "application/x-wad",
        "zip" => "application/zip",
        "fantome" => "application/x-fantome",
        _ => "application/octet-stream",
    };

    Ok(serde_json::json!({
        "name": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "size": meta.len(),
        "hash": hash,
        "mimeType": mime,
        "extension": ext,
        "path": file_path,
    }))
}

#[tauri::command]
pub async fn party_read_file_chunk(payload: serde_json::Value) -> Result<Vec<u8>, String> {
    let path = payload
        .get("filePath")
        .or_else(|| payload.get("path"))
        .and_then(|v| v.as_str())
        .ok_or("Missing path")?;
    let offset = payload.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);
    let size = payload
        .get("size")
        .or_else(|| payload.get("length"))
        .and_then(|v| v.as_u64())
        .unwrap_or(65536)
        .min(262144) as usize;

    let mut file = std::fs::File::open(path).map_err(|e| format!("Error opening: {}", e))?;
    use std::io::{Read, Seek, SeekFrom};
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Error seeking: {}", e))?;
    let mut buf = vec![0u8; size];
    let n = file
        .read(&mut buf)
        .map_err(|e| format!("Error reading: {}", e))?;
    buf.truncate(n);

    Ok(buf)
}

#[tauri::command]
pub async fn party_write_file(
    payload: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let file_name = payload
        .get("fileName")
        .or_else(|| payload.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("party-mod.fantome");

    let chunks = payload
        .get("chunks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let skin = payload.get("skin").cloned().unwrap_or_default();

    let app_dir = state.app_data_dir.lock().await.clone();
    let output_dir = PathBuf::from(&app_dir).join("p2p");
    std::fs::create_dir_all(&output_dir).ok();

    let output_path = output_dir.join(format!(
        "{}-{}",
        chrono::Utc::now().timestamp_millis(),
        sanitize_file_name(file_name)
    ));

    // Write all chunks
    let mut all_data = Vec::new();
    for chunk in &chunks {
        let b64 = chunk.as_str().unwrap_or("");
        if !b64.is_empty() {
            let data = base64_decode(b64).map_err(|e| format!("Error decoding chunk: {}", e))?;
            all_data.extend_from_slice(&data);
        } else if let Some(arr) = chunk.as_array() {
            let bytes: Vec<u8> = arr
                .iter()
                .filter_map(|v| v.as_u64().map(|b| b as u8))
                .collect();
            all_data.extend_from_slice(&bytes);
        }
    }

    std::fs::write(&output_path, &all_data).map_err(|e| format!("Error writing file: {}", e))?;

    let meta =
        std::fs::metadata(&output_path).map_err(|e| format!("Error reading metadata: {}", e))?;
    let ext = PathBuf::from(file_name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_else(|| ".fantome".to_string());

    let skin_name = skin
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(file_name);
    let champion = skin
        .get("champion")
        .and_then(|v| v.as_str())
        .unwrap_or("Party");
    let source = skin.get("source").and_then(|v| v.as_str()).unwrap_or("");

    Ok(serde_json::json!({
        "path": output_path.to_string_lossy(),
        "relativePath": output_path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
        "name": skin_name,
        "champion": champion,
        "skin": skin_name,
        "variant": format!("P2P {}", source).trim().to_string(),
        "extension": ext,
        "size": meta.len(),
        "source": "p2p",
        "custom": true,
        "importedAt": chrono::Utc::now().to_rfc3339(),
    }))
}

#[tauri::command]
pub async fn party_delete_file(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if path.exists() {
        std::fs::remove_file(&path).ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn party_clear_p2p_files(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    for sub in &["p2p", "party-transfers"] {
        let path = PathBuf::from(&app_dir).join(sub);
        if path.exists() {
            std::fs::remove_dir_all(&path).ok();
        }
        std::fs::create_dir_all(&path).ok();
    }
    Ok(
        serde_json::json!({ "folderPath": PathBuf::from(&app_dir).join("p2p").to_string_lossy().to_string() }),
    )
}

// Pengu Loader management

const PENGU_LOADER_DIR: &str = "Pengu Loader";

#[tauri::command]
pub async fn pengu_get_loader_status(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let loader_dir = PathBuf::from(&app_dir).join(PENGU_LOADER_DIR);
    let executable_path = find_pengu_exe(&loader_dir).unwrap_or_default();
    let running = check_process_running("Pengu Loader.exe")
        || check_process_running("PenguLoader.exe")
        || check_process_running("pengu-loader.exe");

    let activation = get_pengu_loader_activation_status(&executable_path, &app_dir);
    let installed = !executable_path.is_empty();

    Ok(serde_json::json!({
        "installed": installed,
        "running": running,
        "active": activation["active"],
        "disabled": activation["disabled"],
        "proxyInstalled": activation["proxyInstalled"],
        "ifeoActive": activation["ifeoActive"],
        "proxyPath": activation["proxyPath"],
        "configPath": activation["configPath"],
        "leagueClientPath": activation["leagueClientPath"],
        "leagueGamePath": activation["leagueGamePath"],
        "lockfilePath": activation["lockfilePath"],
        "leagueReady": activation["leagueReady"],
        "executablePath": executable_path,
        "runtimeDir": loader_dir.to_string_lossy().to_string(),
        "path": loader_dir.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
pub async fn pengu_download_loader(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();

    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "type": "pengu-loader",
            "message": "Descargando Pengu Loader...",
            "percent": 0,
        }),
    );

    let app_for_download = app.clone();
    let app_dir_for_download = app_dir.clone();
    let download_result = tauri::async_runtime::spawn_blocking(move || {
        downloads::download_pengu_loader_rose(&app_dir_for_download, |payload| {
            let _ = app_for_download.emit("download-progress", payload);
        })
    })
    .await
    .map_err(|e| format!("Error ejecutando descarga: {}", e))?;

    match download_result {
        Ok(result) => {
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "type": "pengu-loader",
                    "message": "Pengu Loader descargado.",
                    "percent": 100,
                }),
            );

            // Install Rift Atlas plugin
            let plugin_result = pengu_install_rift_plugin_inner(&app_dir);

            Ok(serde_json::json!({
                "downloaded": true,
                "executablePath": result["executablePath"],
                "runtimeDir": result["runtimeDir"],
                "version": result["version"],
                "plugin": plugin_result.unwrap_or(serde_json::json!({"installed": false})),
            }))
        }
        Err(e) => Err(format!("Error descargando Pengu Loader: {}", e)),
    }
}

#[tauri::command]
pub async fn pengu_launch_loader(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let loader_dir = PathBuf::from(&app_dir).join(PENGU_LOADER_DIR);

    let executable_path = match find_pengu_exe(&loader_dir) {
        Some(p) => p,
        None => {
            return Ok(serde_json::json!({
                "launched": false, "alreadyRunning": false, "executablePath": "", "missing": true
            }))
        }
    };
    let league_state = get_league_client_ready_state();
    let league_client_path = league_state["leagueClientPath"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let league_game_path = league_state["leagueGamePath"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let restart_client = league_state["running"].as_bool().unwrap_or(false);

    // Install Rift Atlas plugin (best-effort)
    let _ = pengu_install_rift_plugin_inner(&app_dir);

    terminate_pengu_loader_ui();

    // Write Rose config
    let config_result = if !executable_path.is_empty() && !league_client_path.is_empty() {
        write_rose_pengu_config(&executable_path, &league_client_path).ok()
    } else {
        None
    };

    // --set-league-path (like Electron: pass League root, not Game dir)
    if !league_game_path.is_empty() {
        let league_root = PathBuf::from(&league_game_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        if !league_root.is_empty() {
            let _ = run_pengu_loader_cli(
                &executable_path,
                &["--set-league-path", &league_root, "--silent"],
            );
        }
    }

    // --force-activate
    let activate_result = run_pengu_loader_cli(&executable_path, &["--force-activate", "--silent"]);
    cleanup_legacy_pengu_ifeo();
    write_pengu_active_flag(&app_dir);

    let proxy_state = get_pengu_loader_activation_status(&executable_path, &app_dir);

    let mut restarted_client = false;
    if restart_client {
        match run_pengu_loader_cli(&executable_path, &["--restart-client", "--silent"]) {
            Ok(_) => restarted_client = true,
            Err(restart_err) => {
                terminate_pengu_loader_ui();
                let mut result = serde_json::json!({
                    "launched": true,
                    "activated": activate_result.is_ok(),
                    "alreadyRunning": is_pengu_loader_running(),
                    "executablePath": executable_path,
                    "leagueClientPath": league_client_path,
                    "leagueGamePath": league_game_path,
                    "needsClientRestart": true,
                    "restartedClient": false,
                    "restartError": restart_err,
                    "method": "rose-cli",
                });
                merge_json(&mut result, &proxy_state);
                return Ok(result);
            }
        }
    }

    terminate_pengu_loader_ui();

    let mut result = serde_json::json!({
        "launched": true,
        "activated": activate_result.is_ok(),
        "alreadyRunning": is_pengu_loader_running(),
        "executablePath": executable_path,
        "leagueClientPath": league_client_path,
        "leagueGamePath": league_game_path,
        "needsClientRestart": restart_client,
        "restartedClient": restarted_client,
        "configPath": config_result.unwrap_or_default(),
        "method": "rose-cli",
    });
    merge_json(&mut result, &proxy_state);
    Ok(result)
}

#[tauri::command]
pub async fn pengu_deactivate_loader(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let loader_dir = PathBuf::from(&app_dir).join(PENGU_LOADER_DIR);
    let executable_path = find_pengu_exe(&loader_dir)
        .or_else(|| search_pengu_exe_wide(&app_dir))
        .unwrap_or_default();
    let league_state = get_league_client_ready_state();
    let league_client_path = league_state["leagueClientPath"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let restart_client = league_state["running"].as_bool().unwrap_or(false);

    terminate_pengu_loader_ui();
    let _ = set_rose_pengu_disabled(true);

    if !executable_path.is_empty() {
        let _ = run_pengu_loader_cli(&executable_path, &["--force-deactivate", "--silent"]);
    }

    // Remove proxy from actual League path (not just common paths)
    let mut proxy_removed = remove_pengu_proxy_files(&league_client_path);
    let proxy_path_str = if !league_client_path.is_empty() {
        PathBuf::from(&league_client_path)
            .join("d3d9.dll")
            .to_string_lossy()
            .to_string()
    } else {
        find_pengu_proxy_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    };
    if !executable_path.is_empty() {
        remove_managed_ifeo(&executable_path);
    }
    cleanup_legacy_pengu_ifeo();

    clear_pengu_active_flag(&app_dir);
    let proxy_state = get_pengu_loader_activation_status(&executable_path, &app_dir);

    let mut restarted_client = false;
    if restart_client && !executable_path.is_empty() {
        match run_pengu_loader_cli(&executable_path, &["--restart-client", "--silent"]) {
            Ok(_) => restarted_client = true,
            Err(_) => restarted_client = false,
        }
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
        proxy_removed = remove_pengu_proxy_files(&league_client_path);
    }

    terminate_pengu_loader_ui();

    let mut result = serde_json::json!({
        "deactivated": !proxy_state["active"].as_bool().unwrap_or(true),
        "executablePath": executable_path,
        "leagueClientPath": league_client_path,
        "needsClientRestart": restart_client,
        "restartedClient": restarted_client,
        "proxyRemoved": proxy_removed,
        "proxyPath": proxy_path_str,
        "method": "rose-cli",
    });
    merge_json(&mut result, &proxy_state);
    Ok(result)
}

fn remove_managed_ifeo(_executable_path: &str) {
    let ikey = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\LeagueClientUx.exe";
    let output = hidden_command("reg")
        .args(["query", ikey, "/v", "Debugger"])
        .output()
        .ok();
    if let Some(out) = output {
        let stdout = String::from_utf8_lossy(&out.stdout);
        if stdout.contains("core.dll") {
            let _ = hidden_command("reg")
                .args(["delete", ikey, "/v", "Debugger", "/f"])
                .output();
        }
    }
}

#[tauri::command]
pub async fn pengu_uninstall_loader(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();

    // Deactivate first
    let _ = pengu_deactivate_loader_inner(&app_dir);

    let loader_dir = PathBuf::from(&app_dir).join(PENGU_LOADER_DIR);
    if loader_dir.exists() {
        std::fs::remove_dir_all(&loader_dir).ok();
    }

    // Remove pengu-loader download dir
    let download_dir = PathBuf::from(&app_dir).join("pengu-loader");
    if download_dir.exists() {
        std::fs::remove_dir_all(&download_dir).ok();
    }

    Ok(serde_json::json!({ "uninstalled": true }))
}

#[tauri::command]
pub async fn pengu_close_loader_ui() -> Result<(), String> {
    for exe in &["Pengu Loader.exe", "PenguLoader.exe", "pengu-loader.exe"] {
        let _ = hidden_command("taskkill").args(["/IM", exe, "/F"]).output();
    }
    Ok(())
}

#[tauri::command]
pub async fn pengu_open_loader_folder(state: State<'_, AppState>) -> Result<String, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let dir = PathBuf::from(&app_dir).join(PENGU_LOADER_DIR);
    std::fs::create_dir_all(&dir).ok();
    let _ = Command::new("explorer").arg(&dir).spawn();
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn pengu_install_rift_plugin(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    pengu_install_rift_plugin_inner(&app_dir)
}

pub(crate) fn pengu_install_rift_plugin_inner(app_dir: &str) -> Result<serde_json::Value, String> {
    let loader_dir = PathBuf::from(app_dir).join(PENGU_LOADER_DIR);
    let plugins_dir = loader_dir.join("plugins");

    // Find the source plugins root. The shared Rose-style monitor is mandatory:
    // every UI plugin consumes its window.__roseBridge instance.
    // Build candidate root paths
    let mut root_candidates: Vec<PathBuf> = Vec::new();

    // 1. Bundled resource dir (Tauri resource_dir)
    if let Some(dir) = PENGU_PLUGIN_RESOURCE_DIR.get() {
        push_unique_path(&mut root_candidates, dir.clone());
    }

    // 2. Relative to current_exe parent dir (production NSIS install)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            push_unique_path(&mut root_candidates, parent.join("bundled-plugins"));
            push_unique_path(
                &mut root_candidates,
                parent.join("Pengu Loader").join("plugins"),
            );
        }
    }

    // 3. Try relative to exe with ../ (Tauri NSIS may place resources one level up)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            if let Some(grandparent) = parent.parent() {
                push_unique_path(&mut root_candidates, grandparent.join("bundled-plugins"));
                push_unique_path(
                    &mut root_candidates,
                    grandparent.join("Pengu Loader").join("plugins"),
                );
            }
        }
    }

    // 4. Dev-only fallbacks. Avoid leaking the CI compile path embedded by
    // env!("CARGO_MANIFEST_DIR") into installed builds.
    let cwd = std::env::current_dir().unwrap_or_default();
    push_unique_path(
        &mut root_candidates,
        cwd.join("Pengu Loader").join("plugins"),
    );

    #[cfg(debug_assertions)]
    {
        let cargo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        push_unique_path(
            &mut root_candidates,
            cargo_root.join("..").join("Pengu Loader").join("plugins"),
        );
    }

    // Find the first root that contains at least one plugin directory
    let source_root = root_candidates
        .iter()
        .find(|p| is_rift_atlas_pengu_plugins_dir(p));

    let source_root = match source_root {
        Some(r) => r.clone(),
        None => {
            let tried: Vec<String> = root_candidates
                .iter()
                .filter(|p| !p.display().to_string().contains(r"\a\Rift\Rift"))
                .map(|p| display_user_path(p))
                .collect();
            let msg = format!(
                "Plugins de Rift Atlas no encontrados. Busque en: {}",
                tried.join(", ")
            );
            eprintln!("[PenguPlugin] {}", msg);
            return Err(msg);
        }
    };

    // Copy all plugin directories from source to runtime (like Electron does)
    std::fs::create_dir_all(&plugins_dir)
        .map_err(|e| format!("Error creando carpeta plugins: {}", e))?;

    // Replace our complete managed plugin set atomically enough for startup.
    // This removes stale RiftAtlas plugins left by older builds without touching
    // third-party Pengu plugins owned by the user.
    if let Ok(entries) = std::fs::read_dir(&plugins_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let managed = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("RiftAtlas-"))
                .unwrap_or(false);
            if managed && path.is_dir() {
                std::fs::remove_dir_all(path).ok();
            }
        }
    }

    let mut installed_plugins: Vec<String> = Vec::new();

    // Read all plugin subdirectories from source
    if let Ok(entries) = std::fs::read_dir(&source_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let plugin_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            // Only install Rift-Atlas plugins (not ROSE-* or other third-party)
            if !plugin_name.starts_with("RiftAtlas-") {
                continue;
            }
            let plugin_dest = plugins_dir.join(&plugin_name);
            if plugin_dest.exists() {
                std::fs::remove_dir_all(&plugin_dest).ok();
            }
            if let Err(e) = copy_dir_recursive(&path, &plugin_dest) {
                eprintln!("[PenguPlugin] Error copiando {}: {}", plugin_name, e);
                continue;
            }
            installed_plugins.push(plugin_name);
        }
    }

    if installed_plugins.is_empty() {
        return Err("No se pudo instalar ningun plugin de Rift Atlas.".to_string());
    }

    Ok(serde_json::json!({
        "installed": true,
        "pluginDir": plugins_dir.to_string_lossy().to_string(),
        "plugins": installed_plugins,
    }))
}

// Helpers

fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                total += std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            } else if p.is_dir() {
                total += dir_size(&p);
            }
        }
    }
    total
}

fn check_process_running(name: &str) -> bool {
    overlay::find_pid_by_process_name(name).is_some()
}

pub fn find_pengu_exe(loader_dir: &std::path::Path) -> Option<String> {
    let names = ["Pengu Loader.exe", "PenguLoader.exe", "pengu-loader.exe"];
    for name in &names {
        let p = loader_dir.join(name);
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

#[allow(dead_code)]
fn find_pengu_proxy_path() -> Option<PathBuf> {
    // 1. Try detected League path (Rose-style: from running process)
    if let Some(client_dir) = find_league_client_path() {
        let p = PathBuf::from(&client_dir).join("d3d9.dll");
        if p.exists() {
            return Some(p);
        }
    }
    // 2. Try PROGRAMFILES env vars (no hardcoded drive letters)
    let mut candidates = Vec::new();
    if let Ok(pf) = std::env::var("PROGRAMFILES") {
        candidates.push(PathBuf::from(pf).join("Riot Games\\League of Legends\\d3d9.dll"));
    }
    if let Ok(pf) = std::env::var("PROGRAMFILES(X86)") {
        candidates.push(PathBuf::from(pf).join("Riot Games\\League of Legends\\d3d9.dll"));
    }
    candidates.into_iter().find(|path| path.exists())
}

fn remove_pengu_proxy_files(league_client_path: &str) -> bool {
    let mut candidates = Vec::new();
    if !league_client_path.is_empty() {
        candidates.push(PathBuf::from(league_client_path).join("d3d9.dll"));
    }
    // Fallback: detect from running process (Rose-style)
    if let Some(detected) = find_league_client_path() {
        candidates.push(PathBuf::from(&detected).join("d3d9.dll"));
    }
    // Last resort: PROGRAMFILES env vars
    if let Ok(pf) = std::env::var("PROGRAMFILES") {
        candidates.push(PathBuf::from(pf).join("Riot Games\\League of Legends\\d3d9.dll"));
    }
    if let Ok(pf) = std::env::var("PROGRAMFILES(X86)") {
        candidates.push(PathBuf::from(pf).join("Riot Games\\League of Legends\\d3d9.dll"));
    }

    let mut removed_or_absent = true;
    candidates.sort();
    candidates.dedup();
    for dll in candidates {
        if dll.exists() && std::fs::remove_file(&dll).is_err() {
            removed_or_absent = false;
        }
    }
    removed_or_absent
}

fn pengu_deactivate_loader_inner_with_options(
    app_dir: &str,
    persist_disabled: bool,
) -> Result<serde_json::Value, String> {
    let loader_dir = PathBuf::from(app_dir).join(PENGU_LOADER_DIR);
    let executable_path = find_pengu_exe(&loader_dir)
        .or_else(|| search_pengu_exe_wide(app_dir))
        .unwrap_or_default();
    let league_state = get_league_client_ready_state();
    let league_client_path = league_state["leagueClientPath"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let restart_client = league_state["running"].as_bool().unwrap_or(false);

    terminate_pengu_loader_ui();
    if persist_disabled {
        let _ = set_rose_pengu_disabled(true);
    }

    if !executable_path.is_empty() {
        let _ = run_pengu_loader_cli(&executable_path, &["--force-deactivate", "--silent"]);
    }

    let _ = remove_pengu_proxy_files(&league_client_path);
    if !executable_path.is_empty() {
        remove_managed_ifeo(&executable_path);
    }

    cleanup_legacy_pengu_ifeo();

    if restart_client && !executable_path.is_empty() {
        let _ = run_pengu_loader_cli(&executable_path, &["--restart-client", "--silent"]);
        std::thread::sleep(std::time::Duration::from_millis(1200));
        let _ = remove_pengu_proxy_files(&league_client_path);
    }

    terminate_pengu_loader_ui();
    clear_pengu_active_flag(app_dir);

    Ok(serde_json::json!({ "deactivated": true }))
}

fn pengu_deactivate_loader_inner(app_dir: &str) -> Result<serde_json::Value, String> {
    pengu_deactivate_loader_inner_with_options(app_dir, true)
}

pub fn pengu_shutdown_cleanup(app_dir: &str) {
    // Rose's deactivate_on_exit() force-deactivates the proxy and clears the
    // dirty flag, but it does not leave Pengu disabled for the next launch.
    let _ = pengu_deactivate_loader_inner_with_options(app_dir, false);
    let _ = std::fs::remove_dir_all(PathBuf::from(app_dir).join("mod-files"));
    terminate_pengu_loader_ui();
}

// --- Pengu Loader helper functions ---

fn is_pengu_loader_running() -> bool {
    check_process_running("Pengu Loader.exe")
        || check_process_running("PenguLoader.exe")
        || check_process_running("pengu-loader.exe")
}

fn terminate_pengu_loader_ui() {
    for exe in &["Pengu Loader.exe", "PenguLoader.exe", "pengu-loader.exe"] {
        let _ = hidden_command("taskkill").args(["/IM", exe, "/F"]).output();
    }
}

fn get_rose_config_path() -> PathBuf {
    // Inside our own data dir: %LOCALAPPDATA%\Rift Atlas\Rose\config.ini
    crate::writable_data_dir().join("Rose").join("config.ini")
}

/// Try to create a directory junction from the legacy `%LOCALAPPDATA%\Rose`
/// to `%LOCALAPPDATA%\Rift Atlas\Rose` so that external binaries (e.g.
/// cslol-dll.dll) can still find shared data via the old path.
fn ensure_rose_junction() {
    #[cfg(windows)]
    {
        let old_root = std::env::var_os("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| crate::install_dir());
        // Only bother if the old root is actually different from our data dir
        let our_root = crate::writable_data_dir();
        if old_root == our_root {
            return;
        }
        let old_path = old_root.join("Rose");
        let new_path = our_root.join("Rose");

        if old_path.exists() {
            // Already exists — nothing to do
            return;
        }
        // Ensure target exists first
        std::fs::create_dir_all(&new_path).ok();
        // Try junction via cmd.exe mklink /J
        let result = std::process::Command::new("cmd")
            .arg("/c")
            .arg("mklink")
            .arg("/J")
            .arg(&old_path)
            .arg(&new_path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        match result {
            Ok(status) if status.success() => {
                eprintln!("[RoseJunction] Creado junction: {} -> {}",
                    old_path.display(), new_path.display());
            }
            _ => {
                eprintln!("[RoseJunction] No se pudo crear junction en {} (puede que necesite permisos de admin)",
                    old_path.display());
            }
        }
    }
}

fn read_ini_value(content: &str, key: &str) -> Option<String> {
    let re = regex_lite::Regex::new(&format!(
        r"(?m)^\s*{}\s*=\s*(.+?)\s*$",
        regex_lite::escape(key)
    ))
    .ok()?;
    re.captures(content)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn set_ini_value(content: &str, key: &str, value: &str) -> String {
    // Do not use regex replacement here: Windows paths contain backslashes and
    // replacement engines may interpret them. Rose writes plain key=value INI
    // lines; keep the value byte-for-byte on the same line.
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let key_prefix = format!("{}=", key);
    let mut replaced = false;

    for line in &mut lines {
        let trimmed = line.trim_start();
        if trimmed.starts_with(&key_prefix)
            || trimmed
                .split_once('=')
                .map(|(name, _)| name.trim().eq_ignore_ascii_case(key))
                .unwrap_or(false)
        {
            *line = format!("{}={}", key, value);
            replaced = true;
            break;
        }
    }

    if !replaced {
        let general_idx = lines.iter().position(|l| l.trim() == "[General]");
        if let Some(idx) = general_idx {
            let insert_pos = idx
                + 1
                + lines[idx + 1..]
                    .iter()
                    .position(|l| l.trim().starts_with('['))
                    .unwrap_or(lines[idx + 1..].len());
            lines.insert(insert_pos, format!("{}={}", key, value));
        } else {
            if lines.last().map(|l| !l.trim().is_empty()).unwrap_or(false) {
                lines.push(String::new());
            }
            lines.push("[General]".to_string());
            lines.push(format!("{}={}", key, value));
        }
    }

    lines.join("\n")
}

fn clean_general_ini_content(content: &str) -> String {
    let mut lines = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('[')
            || trimmed.starts_with(';')
            || trimmed.starts_with('#')
        {
            lines.push(line.to_string());
            continue;
        }

        // Drop orphan continuation lines left by older buggy writes such as:
        // loaderpath=
        // C:\Users\...\Pengu Loader
        if trimmed.contains('=') {
            lines.push(line.to_string());
        }
    }
    lines.join("\n")
}

fn write_rose_league_paths(client_path: &str, game_path: &str) -> Result<String, String> {
    let config_path = get_rose_config_path();
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Error creating Rose config dir: {}", e))?;
    }
    let content =
        std::fs::read_to_string(&config_path).unwrap_or_else(|_| "[General]\n".to_string());
    let content = clean_general_ini_content(&content);
    let content = set_ini_value(&content, "clientpath", client_path);
    let content = set_ini_value(&content, "leaguepath", game_path);
    let content = set_ini_value(&content, "disabled", "0");
    std::fs::write(&config_path, &content)
        .map_err(|e| format!("Error writing Rose config: {}", e))?;
    Ok(config_path.to_string_lossy().to_string())
}

fn load_rose_league_paths() -> Option<(String, String)> {
    let content = std::fs::read_to_string(get_rose_config_path()).ok()?;
    let client_path =
        read_ini_value(&content, "clientpath").filter(|value| !value.trim().is_empty())?;
    let league_path =
        read_ini_value(&content, "leaguepath").filter(|value| !value.trim().is_empty())?;
    let client_dir = PathBuf::from(client_path.trim());
    let game_dir = PathBuf::from(league_path.trim());
    if client_dir.join("LeagueClient.exe").exists()
        && game_dir.join("League of Legends.exe").exists()
    {
        Some((
            game_dir.to_string_lossy().to_string(),
            client_dir.to_string_lossy().to_string(),
        ))
    } else {
        None
    }
}

fn persist_league_paths(game_path: &str, client_path: &str) {
    crate::config::save_paths(game_path, client_path);
    let _ = write_rose_league_paths(client_path, game_path);
}

fn write_rose_pengu_config(
    executable_path: &str,
    league_client_path: &str,
) -> Result<String, String> {
    let config_path = get_rose_config_path();
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Error creating Rose config dir: {}", e))?;
    }
    let content =
        std::fs::read_to_string(&config_path).unwrap_or_else(|_| "[General]\n".to_string());
    let content = clean_general_ini_content(&content);
    let content = set_ini_value(&content, "clientpath", league_client_path);
    let league_game_path = PathBuf::from(league_client_path).join("Game");
    let content = if league_game_path.exists() {
        set_ini_value(&content, "leaguepath", &league_game_path.to_string_lossy())
    } else {
        content
    };
    let content = set_ini_value(&content, "disabled", "0");
    let loader_dir = PathBuf::from(executable_path)
        .parent()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let content = set_ini_value(&content, "loaderpath", &loader_dir);
    std::fs::write(&config_path, &content)
        .map_err(|e| format!("Error writing Rose config: {}", e))?;
    Ok(config_path.to_string_lossy().to_string())
}

fn set_rose_pengu_disabled(disabled: bool) -> Result<String, String> {
    let config_path = get_rose_config_path();
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Error creating Rose config dir: {}", e))?;
    }
    let content =
        std::fs::read_to_string(&config_path).unwrap_or_else(|_| "[General]\n".to_string());
    let content = set_ini_value(&content, "disabled", if disabled { "1" } else { "0" });
    std::fs::write(&config_path, &content)
        .map_err(|e| format!("Error writing Rose config: {}", e))?;
    Ok(config_path.to_string_lossy().to_string())
}

fn is_rose_pengu_disabled() -> bool {
    let config_path = get_rose_config_path();
    let config_content = std::fs::read_to_string(&config_path).unwrap_or_default();
    read_ini_value(&config_content, "disabled")
        .map(|v| v.trim() == "1")
        .unwrap_or(false)
}

fn get_pengu_active_flag_path(app_dir: &str) -> PathBuf {
    PathBuf::from(app_dir).join(".pengu-active")
}

fn write_pengu_active_flag(app_dir: &str) {
    let flag = get_pengu_active_flag_path(app_dir);
    std::fs::create_dir_all(flag.parent().unwrap_or(std::path::Path::new(""))).ok();
    std::fs::write(&flag, "active").ok();
}

fn clear_pengu_active_flag(app_dir: &str) {
    std::fs::remove_file(get_pengu_active_flag_path(app_dir)).ok();
}

pub fn run_pengu_loader_cli(executable_path: &str, args: &[&str]) -> Result<String, String> {
    let loader_dir = PathBuf::from(executable_path)
        .parent()
        .unwrap()
        .to_path_buf();
    let mut cmd = Command::new(executable_path);
    cmd.args(args).current_dir(&loader_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Error running Pengu CLI: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!(
            "Pengu CLI exit code {}: {} {}",
            output.status.code().unwrap_or(-1),
            stdout,
            stderr
        ))
    }
}

pub fn search_pengu_exe_wide(app_dir: &str) -> Option<String> {
    let names = ["Pengu Loader.exe", "PenguLoader.exe", "pengu-loader.exe"];

    // Runtime dir first (app_data/Pengu Loader/)
    let runtime_dir = PathBuf::from(app_dir).join(PENGU_LOADER_DIR);
    for name in &names {
        let p = runtime_dir.join(name);
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }

    None
}

pub fn cleanup_pengu_proxy_on_startup(_app_dir: &str) {
    let league_client_path = find_league_client_path().unwrap_or_default();
    if !league_client_path.is_empty() {
        let proxy_path = PathBuf::from(&league_client_path).join("d3d9.dll");
        if proxy_path.exists() {
            std::fs::remove_file(&proxy_path).ok();
        }
    }
}

pub fn pengu_startup_init(app_dir: &str, token_dir: &str) {
    eprintln!(
        "[PenguStartup] INICIO app_dir={} token_dir={}",
        app_dir, token_dir
    );
    ensure_rose_junction();
    // Search order: app_dir first (production), then token_dir/writable_data (dev/downloads)
    let executable_path = {
        let loader_dir_app = PathBuf::from(app_dir).join(PENGU_LOADER_DIR);
        let loader_dir_token = PathBuf::from(token_dir).join(PENGU_LOADER_DIR);
        match find_pengu_exe(&loader_dir_app) {
            Some(p) => p,
            None => match find_pengu_exe(&loader_dir_token) {
                Some(p) => p,
                None => match search_pengu_exe_wide(app_dir) {
                    Some(p) => p,
                    None => match search_pengu_exe_wide(token_dir) {
                        Some(p) => p,
                        None => {
                            eprintln!(
                                "[PenguStartup] PenguLoader.exe no encontrado en {} ni {}",
                                loader_dir_app.display(),
                                loader_dir_token.display()
                            );
                            return;
                        }
                    },
                },
            },
        }
    };
    eprintln!("[PenguStartup] pengu_exe={}", executable_path);
    let runtime_app_dir = PathBuf::from(&executable_path)
        .parent()
        .and_then(|loader_dir| loader_dir.parent())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| token_dir.to_string());
    eprintln!(
        "[PenguStartup] runtime_app_dir={} token_dir={}",
        runtime_app_dir, token_dir
    );

    cleanup_pengu_proxy_on_startup(&runtime_app_dir);

    // Rose activates Pengu on app startup. A stale disabled=1 left by an older
    // Rift build must not permanently block activation on the next launch.
    let _ = set_rose_pengu_disabled(false);

    match pengu_install_rift_plugin_inner(&runtime_app_dir) {
        Ok(v) => eprintln!("[PenguStartup] Plugin instalado: {}", v),
        Err(e) => eprintln!("[PenguStartup] Plugin install ERROR: {}", e),
    }

    let league_state = get_league_client_ready_state();
    let league_client_path = league_state["leagueClientPath"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if league_client_path.is_empty() {
        eprintln!("[PenguStartup] League client no detectado, abortando activacion");
        return;
    }
    eprintln!(
        "[PenguStartup] leagueClientPath={} running={}",
        league_client_path, league_state["running"]
    );

    terminate_pengu_loader_ui();
    match write_rose_pengu_config(&executable_path, &league_client_path) {
        Ok(_) => eprintln!("[PenguStartup] Rose config escrita OK"),
        Err(e) => eprintln!("[PenguStartup] Rose config ERROR: {}", e),
    }

    let league_game_path = league_state["leagueGamePath"].as_str().unwrap_or("");
    if !league_game_path.is_empty() {
        let league_root = PathBuf::from(league_game_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        if !league_root.is_empty() {
            match run_pengu_loader_cli(
                &executable_path,
                &["--set-league-path", &league_root, "--silent"],
            ) {
                Ok(stdout) => {
                    eprintln!("[PenguStartup] --set-league-path OK stdout={}", stdout);
                }
                Err(e) => eprintln!("[PenguStartup] --set-league-path error: {}", e),
            }
        }
    }

    // Rose-style: write active flag BEFORE --force-activate (crash safety)
    write_pengu_active_flag(&runtime_app_dir);

    match run_pengu_loader_cli(&executable_path, &["--force-activate", "--silent"]) {
        Ok(stdout) => {
            eprintln!("[PenguStartup] --force-activate OK stdout={}", stdout);
        }
        Err(e) => eprintln!("[PenguStartup] --force-activate error: {}", e),
    }

    cleanup_legacy_pengu_ifeo();

    let league_running = league_state["running"].as_bool().unwrap_or(false);
    if league_running {
        match run_pengu_loader_cli(&executable_path, &["--restart-client", "--silent"]) {
            Ok(stdout) => {
                eprintln!("[PenguStartup] --restart-client OK stdout={}", stdout);
            }
            Err(e) => eprintln!("[PenguStartup] --restart-client error: {}", e),
        }
    }
    eprintln!("[PenguStartup] FIN");
}

pub fn pengu_try_auto_activate(app_dir: &str, token_dir: &str) {
    let executable_path = {
        let loader_dir_app = PathBuf::from(app_dir).join(PENGU_LOADER_DIR);
        let loader_dir_token = PathBuf::from(token_dir).join(PENGU_LOADER_DIR);
        match find_pengu_exe(&loader_dir_app) {
            Some(p) => p,
            None => match find_pengu_exe(&loader_dir_token) {
                Some(p) => p,
                None => match search_pengu_exe_wide(app_dir) {
                    Some(p) => p,
                    None => match search_pengu_exe_wide(token_dir) {
                        Some(p) => p,
                        None => return,
                    },
                },
            },
        }
    };
    let runtime_app_dir = PathBuf::from(&executable_path)
        .parent()
        .and_then(|loader_dir| loader_dir.parent())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| token_dir.to_string());

    let league_state = get_league_client_ready_state();
    if !league_state["ready"].as_bool().unwrap_or(false) {
        return;
    }

    let activation = get_pengu_loader_activation_status(&executable_path, app_dir);
    if activation["active"].as_bool().unwrap_or(false) {
        return;
    }

    let league_client_path = league_state["leagueClientPath"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if league_client_path.is_empty() {
        return;
    }

    eprintln!("[PenguAutoAct] Pengu no activo, intentando activar...");
    let _ = set_rose_pengu_disabled(false);

    match pengu_install_rift_plugin_inner(&runtime_app_dir) {
        Ok(v) => eprintln!("[PenguAutoAct] Plugin: {}", v),
        Err(e) => eprintln!("[PenguAutoAct] Plugin ERROR: {}", e),
    }
    terminate_pengu_loader_ui();
    match write_rose_pengu_config(&executable_path, &league_client_path) {
        Ok(_) => eprintln!("[PenguAutoAct] Config escrita OK"),
        Err(e) => eprintln!("[PenguAutoAct] Config ERROR: {}", e),
    }
    let league_game_path = league_state["leagueGamePath"].as_str().unwrap_or("");
    if !league_game_path.is_empty() {
        let league_root = PathBuf::from(league_game_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        if !league_root.is_empty() {
            match run_pengu_loader_cli(
                &executable_path,
                &["--set-league-path", &league_root, "--silent"],
            ) {
                Ok(stdout) => {
                    eprintln!("[PenguAutoAct] --set-league-path OK stdout={}", stdout);
                }
                Err(e) => eprintln!("[PenguAutoAct] --set-league-path error: {}", e),
            }
        }
    }
    match run_pengu_loader_cli(&executable_path, &["--force-activate", "--silent"]) {
        Ok(stdout) => {
            eprintln!("[PenguAutoAct] --force-activate OK stdout={}", stdout);
        }
        Err(e) => eprintln!("[PenguAutoAct] --force-activate error: {}", e),
    }
    cleanup_legacy_pengu_ifeo();
    write_pengu_active_flag(&runtime_app_dir);
    terminate_pengu_loader_ui();
    eprintln!("[PenguAutoAct] Activacion completada");
}

fn find_league_client_lockfile() -> Option<String> {
    for process_name in ["LeagueClientUx.exe", "LeagueClient.exe"] {
        if let Some(dir) = overlay::find_process_exe_path(process_name) {
            let lockfile = PathBuf::from(&dir).join("lockfile");
            if lockfile.exists() {
                return Some(lockfile.to_string_lossy().to_string());
            }
        }
    }

    if let Some((_, client)) = load_rose_league_paths() {
        let lockfile = PathBuf::from(&client).join("lockfile");
        if lockfile.exists() {
            return Some(lockfile.to_string_lossy().to_string());
        }
    }

    if let Some(client) = crate::config::load_client_path() {
        let lockfile = PathBuf::from(&client).join("lockfile");
        if lockfile.exists() {
            return Some(lockfile.to_string_lossy().to_string());
        }
    }

    let candidates = [
        std::env::var("LCU_LOCKFILE").ok(),
        Some("C:\\Riot Games\\League of Legends\\lockfile".to_string()),
        Some("D:\\Riot Games\\League of Legends\\lockfile".to_string()),
        std::env::var("PROGRAMFILES")
            .ok()
            .map(|p| format!("{}\\Riot Games\\League of Legends\\lockfile", p)),
        std::env::var("PROGRAMFILES(X86)")
            .ok()
            .map(|p| format!("{}\\Riot Games\\League of Legends\\lockfile", p)),
    ];
    for candidate in candidates.into_iter().flatten() {
        let p = PathBuf::from(&candidate);
        if p.exists() {
            return Some(candidate);
        }
    }
    None
}

fn find_league_client_path() -> Option<String> {
    // 1. Get path from running process (Rose-style: reads exe path from memory)
    if let Some(dir) = overlay::find_process_exe_path("LeagueClientUx.exe") {
        if PathBuf::from(&dir).join("LeagueClient.exe").exists() {
            return Some(dir);
        }
    }
    if let Some(dir) = overlay::find_process_exe_path("LeagueClient.exe") {
        if PathBuf::from(&dir).join("LeagueClient.exe").exists() {
            return Some(dir);
        }
    }

    // 2. Try lockfile dir
    if let Some(lockfile) = find_league_client_lockfile() {
        let dir = PathBuf::from(&lockfile)
            .parent()?
            .to_string_lossy()
            .to_string();
        if PathBuf::from(&dir).join("LeagueClient.exe").exists() {
            return Some(dir);
        }
    }

    // 3. Fall back to Rose config/manual selection.
    if let Some((_, client)) = load_rose_league_paths() {
        if PathBuf::from(&client).join("LeagueClient.exe").exists() {
            return Some(client);
        }
    }

    // 4. Fall back to saved Rift Atlas config/manual selection.
    if let Some(client) = crate::config::load_client_path() {
        if PathBuf::from(&client).join("LeagueClient.exe").exists() {
            return Some(client);
        }
    }
    None
}

fn find_league_game_path(league_client_path: &str) -> Option<String> {
    let game_dir = PathBuf::from(league_client_path).join("Game");
    if game_dir.join("League of Legends.exe").exists() {
        return Some(game_dir.to_string_lossy().to_string());
    }
    None
}

fn get_league_client_ready_state() -> serde_json::Value {
    let league_client_path = find_league_client_path().unwrap_or_default();
    let league_game_path = if !league_client_path.is_empty() {
        find_league_game_path(&league_client_path).unwrap_or_default()
    } else {
        String::new()
    };
    let running = check_process_running("LeagueClient.exe")
        || check_process_running("LeagueClientUx.exe")
        || check_process_running("LeagueClientUxRender.exe");
    let lockfile_path = find_league_client_lockfile().unwrap_or_default();
    let ready = running && !lockfile_path.is_empty();
    serde_json::json!({
        "running": running,
        "ready": ready,
        "lockfilePath": lockfile_path,
        "leagueClientPath": league_client_path,
        "leagueGamePath": league_game_path,
    })
}

pub fn get_pengu_loader_activation_status(executable_path: &str, _app_dir: &str) -> serde_json::Value {
    let league_state = get_league_client_ready_state();
    let league_client_path = league_state["leagueClientPath"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let disabled = is_rose_pengu_disabled();
    if executable_path.is_empty() || league_client_path.is_empty() {
        return serde_json::json!({
            "active": false, "proxyInstalled": false, "proxyPath": "",
            "disabled": disabled,
            "ifeoActive": false,
            "leagueClientPath": league_client_path,
            "leagueGamePath": league_state["leagueGamePath"],
            "lockfilePath": league_state["lockfilePath"],
            "leagueReady": league_state["ready"],
        });
    }
    let proxy_path = PathBuf::from(&league_client_path).join("d3d9.dll");
    let proxy_installed = proxy_path.exists();
    let config_path = get_rose_config_path();
    // Check IFEO
    let ifeo_active = hidden_command("reg")
        .args(["query", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\LeagueClientUx.exe", "/v", "Debugger"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.contains("core.dll"))
        .unwrap_or(false);
    serde_json::json!({
        "active": (proxy_installed || ifeo_active) && !disabled,
        "proxyInstalled": proxy_installed,
        "ifeoActive": ifeo_active,
        "disabled": disabled,
        "configPath": config_path.to_string_lossy().to_string(),
        "proxyPath": proxy_path.to_string_lossy().to_string(),
        "leagueClientPath": league_client_path,
        "leagueGamePath": league_state["leagueGamePath"],
        "lockfilePath": league_state["lockfilePath"],
        "leagueReady": league_state["ready"],
    })
}

fn cleanup_legacy_pengu_ifeo() {
    let output = hidden_command("reg")
        .args(["query", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\LeagueClientUx.exe", "/v", "Debugger"])
        .output()
        .ok();
    if let Some(out) = output {
        if String::from_utf8_lossy(&out.stdout).contains("core.dll") {
            let _ = hidden_command("reg")
                .args(["delete", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\LeagueClientUx.exe", "/v", "Debugger", "/f"])
                .output();
        }
    }
}

fn merge_json(base: &mut serde_json::Value, overlay: &serde_json::Value) {
    if let (serde_json::Value::Object(base_map), serde_json::Value::Object(overlay_map)) =
        (base, overlay)
    {
        for (key, val) in overlay_map {
            base_map.insert(key.clone(), val.clone());
        }
    }
}

// --- End Pengu Loader helpers ---

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    if !dst.exists() {
        std::fs::create_dir_all(dst).map_err(|e| format!("Error creating dir: {}", e))?;
    }
    for entry in std::fs::read_dir(src).map_err(|e| format!("Error reading dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Error reading entry: {}", e))?;
        let ty = entry
            .file_type()
            .map_err(|e| format!("Error getting type: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| format!("Error copying: {}", e))?;
        }
    }
    Ok(())
}

#[allow(dead_code)]
fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Base64 error: {}", e))
}

fn sanitize_file_name(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\x00'..='\x1f' => ' ',
            _ => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(120)
        .collect()
}

// === Multi-mod Storage Commands ===

#[tauri::command]
pub async fn mod_storage_list_categories(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let storage = crate::mod_storage::ModStorage::new(&app_dir);
    storage.ensure_layout();
    Ok(serde_json::json!({
        "categories": storage.list_all_categories(),
    }))
}

#[tauri::command]
pub async fn mod_storage_list_mods(
    state: State<'_, AppState>,
    category: String,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let storage = crate::mod_storage::ModStorage::new(&app_dir);
    storage.ensure_layout();
    let mods = storage.list_mods_for_category(&category);
    Ok(serde_json::json!({
        "category": category,
        "mods": mods,
    }))
}

#[tauri::command]
pub async fn mod_storage_import_mod(
    state: State<'_, AppState>,
    source_path: String,
    category: String,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let storage = crate::mod_storage::ModStorage::new(&app_dir);
    storage.ensure_layout();
    let entry = storage.import_mod(&source_path, &category)?;
    Ok(serde_json::json!({
        "imported": true,
        "mod": entry,
    }))
}

#[tauri::command]
pub async fn mod_storage_remove_mod(
    state: State<'_, AppState>,
    category: String,
    mod_id: String,
) -> Result<serde_json::Value, String> {
    let app_dir = state.app_data_dir.lock().await.clone();
    let storage = crate::mod_storage::ModStorage::new(&app_dir);
    storage.remove_mod(&category, &mod_id)?;
    Ok(serde_json::json!({ "removed": true }))
}

#[tauri::command]
pub async fn mod_storage_select_mod(
    state: State<'_, AppState>,
    category: String,
    mod_id: String,
    mod_path: String,
    mod_name: String,
) -> Result<serde_json::Value, String> {
    let mut selected = state.selected_mods.lock().await;
    selected.insert(
        category.clone(),
        serde_json::json!({
            "mod_id": mod_id,
            "mod_path": mod_path,
            "mod_name": mod_name,
            "category": category,
        }),
    );
    Ok(serde_json::json!({ "selected": true, "category": category }))
}

#[tauri::command]
pub async fn mod_storage_get_selected_mods(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let selected = state.selected_mods.lock().await;
    let mods: serde_json::Value = selected
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    Ok(serde_json::json!({ "selectedMods": mods }))
}

#[tauri::command]
pub async fn mod_storage_deselect_mod(
    state: State<'_, AppState>,
    category: String,
) -> Result<serde_json::Value, String> {
    let mut selected = state.selected_mods.lock().await;
    selected.remove(&category);
    Ok(serde_json::json!({ "deselected": true, "category": category }))
}

#[tauri::command]
pub async fn select_mod_file(app: AppHandle) -> Result<serde_json::Value, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("Mods", &["fantome", "zip", "wad", "wad.client", "rse"])
        .blocking_pick_file();
    match file {
        Some(path) => Ok(serde_json::json!({ "canceled": false, "filePath": path.to_string() })),
        None => Ok(serde_json::json!({ "canceled": true, "filePath": "" })),
    }
}

#[tauri::command]
pub fn debug_print(message: String) {
    use windows_sys::Win32::System::Console::{GetStdHandle, WriteConsoleA, STD_OUTPUT_HANDLE};
    unsafe {
        let handle = GetStdHandle(STD_OUTPUT_HANDLE);
        if handle.is_null() {
            return;
        }
        let bytes = message.as_bytes();
        let mut written = 0u32;
        WriteConsoleA(
            handle,
            bytes.as_ptr() as *const _,
            bytes.len() as u32,
            &mut written,
            std::ptr::null_mut(),
        );
    }
}

// =============================================================================
// ThresholdManager — configurable injection cooldown
// =============================================================================

#[tauri::command]
pub fn load_injection_threshold() -> f64 {
    crate::config::load_injection_threshold()
}

#[tauri::command]
pub fn save_injection_threshold(value: f64) {
    let value = value.max(0.0).min(2.0);
    crate::config::save_injection_threshold(value);
}

// =============================================================================
// BaseSkinTracker — PATCH→confirmation latency tracking
// =============================================================================

#[tauri::command]
pub fn start_base_skin_tracking(skin_id: u64) {
    crate::base_skin_tracker::start_tracking(skin_id);
}

#[tauri::command]
pub fn on_base_skin_confirmed(skin_id: u64) -> Option<f64> {
    crate::base_skin_tracker::on_skin_confirmed(skin_id)
}

#[tauri::command]
pub fn on_champ_select_exit() -> Option<f64> {
    crate::base_skin_tracker::on_champ_select_exit()
}

#[tauri::command]
pub fn get_base_skin_tracker_stats() -> serde_json::Value {
    crate::base_skin_tracker::get_stats()
}

#[tauri::command]
pub fn clear_base_skin_tracker_samples() {
    crate::base_skin_tracker::clear_samples();
}

#[tauri::command]
pub fn clear_lcu_cache() {
    crate::gameflow::lcu_cache_clear();
}
