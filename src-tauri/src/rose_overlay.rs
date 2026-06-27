use crate::{junction, overlay, AppState};
use std::collections::HashSet;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

struct RoseRunner {
    pid: u32,
    overlay_path: String,
    exited: Arc<AtomicBool>,
}

struct RoseBuild {
    mod_tools: PathBuf,
    game_dir: PathBuf,
    overlay_dir: PathBuf,
}

fn resolve_game_dir(input: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(input.trim());
    if path.as_os_str().is_empty() {
        return Err("League of Legends.exe no configurado.".to_string());
    }

    let direct_game_dir = if path.is_dir()
        && path
            .file_name()
            .map(|name| name.to_string_lossy().eq_ignore_ascii_case("Game"))
            .unwrap_or(false)
    {
        Some(path.clone())
    } else if path.is_file()
        && path
            .file_name()
            .map(|name| {
                name.to_string_lossy()
                    .eq_ignore_ascii_case("League of Legends.exe")
            })
            .unwrap_or(false)
    {
        path.parent().map(|parent| parent.to_path_buf())
    } else if path.is_file()
        && path
            .file_name()
            .map(|name| {
                name.to_string_lossy()
                    .eq_ignore_ascii_case("LeagueClient.exe")
            })
            .unwrap_or(false)
    {
        path.parent().map(|parent| parent.join("Game"))
    } else {
        let nested = path.join("Game");
        if nested.is_dir() {
            Some(nested)
        } else {
            None
        }
    };

    let game_dir = direct_game_dir
        .filter(|dir| dir.join("League of Legends.exe").is_file())
        .ok_or_else(|| {
            "No pude resolver la carpeta Game de League. Configura ...\\League of Legends\\Game o ...\\Game\\League of Legends.exe.".to_string()
        })?;

    Ok(game_dir)
}

fn prepare_rose_tools(app_dir: &str, bundled_exe: &Path) -> Result<PathBuf, String> {
    let tools_dir = PathBuf::from(app_dir).join("engine").join("tools");
    std::fs::create_dir_all(&tools_dir)
        .map_err(|error| format!("No pude crear engine/tools: {}", error))?;
    let target_exe = tools_dir.join("mod-tools.exe");
    let target_dll = tools_dir.join("cslol-dll.dll");

    // Copy bundled mod-tools only if not already present or different
    if bundled_exe.is_file() {
        let needs_copy = !target_exe.is_file()
            || std::fs::metadata(&target_exe)
                .and_then(|m| Ok(m.len()))
                .unwrap_or(0)
                != std::fs::metadata(bundled_exe)
                    .and_then(|m| Ok(m.len()))
                    .unwrap_or(0);
        if needs_copy {
            std::fs::copy(bundled_exe, &target_exe)
                .map_err(|error| format!("No pude instalar mod-tools: {}", error))?;
        }
    } else if !target_exe.is_file() {
        return Err(format!(
            "mod-tools no encontrado ni empaquetado ni en engine/tools: {}",
            bundled_exe.display()
        ));
    }

    if !target_dll.is_file() {
        return Err(format!(
            "Falta cslol-dll.dll en engine/tools/ — descargalo primero."
        ));
    }
    Ok(target_exe)
}

fn clean_directory(path: &Path) -> Result<(), String> {
    if path.exists() {
        junction::clean_dir(path);
        std::fs::remove_dir_all(path)
            .map_err(|error| format!("No pude limpiar {}: {}", path.display(), error))?;
    }
    std::fs::create_dir_all(path)
        .map_err(|error| format!("No pude crear {}: {}", path.display(), error))
}

fn safe_mod_name(path: &Path, index: usize) -> String {
    let source = if path.is_dir() {
        path.file_name()
    } else {
        path.file_stem().or_else(|| path.file_name())
    }
    .map(|value| value.to_string_lossy().to_string())
    .unwrap_or_else(|| format!("mod-{}", index + 1));
    let cleaned = source
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        format!("mod-{}", index + 1)
    } else {
        trimmed.to_string()
    }
}

fn collect_paths(payload: &serde_json::Value) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();
    for key in ["skinEntries", "extraMods"] {
        for entry in payload
            .get(key)
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let path = entry
                .get("path")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let normalized = path.replace('/', "\\").to_lowercase();
            if !path.is_empty() && seen.insert(normalized) {
                paths.push(path.to_string());
            }
        }
    }
    paths
}

fn stage_mods(mods_dir: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let mut used_names = HashSet::new();
    for (index, source_text) in paths.iter().enumerate() {
        let source = PathBuf::from(source_text);
        if !source.exists() {
            return Err(format!("Mod no encontrado: {}", source.display()));
        }
        let base_name = safe_mod_name(&source, index);
        let mut name = base_name.clone();
        let mut duplicate_index = 2;
        while !used_names.insert(name.to_ascii_lowercase()) {
            name = format!("{}-{}", base_name, duplicate_index);
            duplicate_index += 1;
        }
        let destination = mods_dir.join(&name);
        let lower = source.to_string_lossy().to_lowercase();
        if source.is_dir() {
            junction::create_junction(&source, &destination)?;
        } else if lower.ends_with(".fantome") || lower.ends_with(".zip") {
            std::fs::create_dir_all(&destination).map_err(|error| {
                format!("No pude crear staging {}: {}", destination.display(), error)
            })?;
            junction::extract_zip_to_dir(&source, &destination)?;
        } else if lower.ends_with(".wad") || lower.ends_with(".wad.client") {
            std::fs::create_dir_all(&destination)
                .map_err(|error| format!("No pude crear WAD staging: {}", error))?;
            let file_name = source
                .file_name()
                .ok_or_else(|| format!("Nombre de WAD invalido: {}", source.display()))?;
            std::fs::copy(&source, destination.join(file_name))
                .map_err(|error| format!("No pude copiar {}: {}", source.display(), error))?;
        } else {
            return Err(format!(
                "Formato de mod no compatible con Rose: {}",
                source.display()
            ));
        }
        names.push(name);
    }
    Ok(names)
}

fn collect_overlay_wads(overlay_dir: &Path) -> Vec<String> {
    let data_dir = overlay_dir.join("DATA").join("FINAL");
    let mut pending = vec![data_dir.clone()];
    let mut found = Vec::new();
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            let lower = path.to_string_lossy().to_lowercase();
            if lower.ends_with(".wad") || lower.ends_with(".wad.client") {
                let relative = path
                    .strip_prefix(&data_dir)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('/', "\\");
                found.push(relative);
            }
        }
    }
    found.sort();
    found
}

fn start_runoverlay(
    mod_tools: &Path,
    game_dir: &Path,
    overlay_dir: &Path,
) -> Result<RoseRunner, String> {
    let config_path = overlay_dir.join("cslol-config.json");
    let mut command = Command::new(mod_tools);
    command
        .arg("runoverlay")
        .arg(overlay_dir)
        .arg(&config_path)
        .arg(format!("--game:{}", game_dir.display()))
        .arg("--opts:configless");
    // Rose does NOT set current_dir — inherits parent CWD.
    // Rose also discards all stdout/stderr (DEVNULL) to avoid pipe buffer
    // deadlock that could block the DLL injection timing.

    command.stdout(Stdio::null()).stderr(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|error| format!("No pude iniciar runoverlay: {}", error))?;

    let pid = child.id();

    // Rose-style: boost runoverlay to HIGH_PRIORITY_CLASS so DLL injection
    // completes before League loads WAD files.
    overlay::boost_process_priority(pid);

    let exited = Arc::new(AtomicBool::new(false));
    let exited_thread = exited.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        exited_thread.store(true, Ordering::SeqCst);
        overlay::append_overlay_log(&format!(
            "[Engine] runoverlay termino: {:?}",
            status.ok().and_then(|value| value.code())
        ));
    });
    Ok(RoseRunner {
        pid,
        overlay_path: overlay_dir.to_string_lossy().to_string(),
        exited,
    })
}

fn build_overlay(
    payload: &serde_json::Value,
    app_dir: &str,
    rose_mod_tools: &Path,
) -> Result<RoseBuild, String> {
    let mod_tools = rose_mod_tools.to_path_buf();
    if !mod_tools.is_file()
        || !mod_tools
            .file_name()
            .map(|name| name.to_string_lossy().eq_ignore_ascii_case("mod-tools.exe"))
            .unwrap_or(false)
    {
        return Err(format!(
            "No encontre el mod-tools.exe original de Rose en {}.",
            mod_tools.display()
        ));
    }
    let game_dir = resolve_game_dir(
        payload
            .get("gamePath")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
    )?;
    let paths = collect_paths(payload);
    if paths.is_empty() {
        return Err("No hay mods para construir el overlay.".to_string());
    }

    let injection_root = PathBuf::from(app_dir).join("engine").join("injection");
    let mods_dir = injection_root.join("mods");
    let overlay_dir = injection_root.join("overlay");
    clean_directory(&mods_dir)?;
    clean_directory(&overlay_dir)?;
    let mod_names = stage_mods(&mods_dir, &paths)?;

    let args = vec![
        "mkoverlay".to_string(),
        mods_dir.to_string_lossy().to_string(),
        overlay_dir.to_string_lossy().to_string(),
        format!("--game:{}", game_dir.display()),
        format!("--mods:{}", mod_names.join("/")),
        "--noTFT".to_string(),
        "--ignoreConflict".to_string(),
    ];
    overlay::append_overlay_log(&format!(
        "[Engine] mkoverlay game={} mods={} paths={}",
        game_dir.display(),
        mod_names.join("/"),
        paths.len()
    ));
    let token = overlay::OverlayRunToken::new();
    overlay::exec_tool_with_timeout(
        &mod_tools.to_string_lossy(),
        &args,
        300_000,
        &mod_tools
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_string_lossy(),
        &token,
        None,
    )?;
    if !overlay_dir.join("DATA").is_dir() {
        return Err(format!(
            "mkoverlay no genero DATA en {}",
            overlay_dir.display()
        ));
    }
    let overlay_wads = collect_overlay_wads(&overlay_dir);
    if overlay_wads.is_empty() {
        overlay::append_overlay_log(&format!(
            "[Engine] mkoverlay genero DATA sin WADs detectables en {}.",
            overlay_dir.display()
        ));
    } else {
        overlay::append_overlay_log(&format!(
            "[Engine] overlay WADs: {}",
            overlay_wads
                .iter()
                .take(12)
                .cloned()
                .collect::<Vec<_>>()
                .join(" | ")
        ));
    }
    junction::clean_dir(&mods_dir);

    // Rose-style: hide overlay directory after mkoverlay succeeds.
    // The cslol DLL and League's mod system expect the overlay WADs to be in
    // a hidden directory. Without this, runoverlay may not detect the overlay.
    overlay::hide_overlay_dir(&overlay_dir.to_string_lossy());

    overlay::append_overlay_log(
        "[Engine] mkoverlay OK; staging limpiado; overlay oculto; esperando League suspendido.",
    );
    Ok(RoseBuild {
        mod_tools,
        game_dir,
        overlay_dir,
    })
}

#[tauri::command]
pub async fn run_rose_overlay_v2(
    payload: serde_json::Value,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    {
        let mut active = state.active_overlay_run.lock().await;
        if *active {
            return Err("Ya hay una construccion activa.".to_string());
        }
        *active = true;
    }
    let run_epoch = state.overlay_cancel_epoch.load(Ordering::SeqCst);

    if let Some(pid) = state.running_overlay_process.lock().await.take() {
        let old_path = state.current_overlay_path.lock().await.clone();
        overlay::stop_patcher(pid, &old_path);
    }
    overlay::kill_all_runoverlay_processes();
    *state.running_overlay_alive.lock().await = None;
    *state.running_overlay_ready.lock().await = None;
    *state.current_overlay_path.lock().await = String::new();

    // Reset runoverlay_started flag at the start of a new injection cycle
    state.early_monitor_runoverlay_started.store(false, Ordering::SeqCst);

    let app_dir = state.app_data_dir.lock().await.clone();
    let bundled_rose_mod_tools = match app.path().resource_dir() {
        Ok(path) => path.join("rose-tools").join("mod-tools.exe"),
        Err(error) => {
            *state.active_overlay_run.lock().await = false;
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid, &state.early_monitor_runoverlay_started);
            return Err(format!("No pude resolver recursos: {}", error));
        }
    };
    let rose_mod_tools = match prepare_rose_tools(&app_dir, &bundled_rose_mod_tools) {
        Ok(path) => path,
        Err(error) => {
            *state.active_overlay_run.lock().await = false;
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid, &state.early_monitor_runoverlay_started);
            return Err(error);
        }
    };
    let rose_mod_tools_response = rose_mod_tools.to_string_lossy().to_string();
    if !state.early_monitor_active.load(Ordering::SeqCst) {
        let monitor_game_path = payload
            .get("gamePath")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        state.early_monitor_active.store(true, Ordering::SeqCst);
        overlay::start_early_monitor(
            &monitor_game_path,
            state.early_monitor_active.clone(),
            state.early_monitor_pid.clone(),
            state.early_monitor_runoverlay_started.clone(),
        );
        overlay::append_overlay_log("[Engine] Early monitor iniciado desde run_rose_overlay_v2.");
    }
    let payload_for_build = payload.clone();
    let result = match tokio::task::spawn_blocking(move || {
        build_overlay(&payload_for_build, &app_dir, &rose_mod_tools)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            *state.active_overlay_run.lock().await = false;
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid, &state.early_monitor_runoverlay_started);
            return Err(format!("Engine worker fallo: {}", error));
        }
    };

    let result = match result {
        Ok(build) => {
            if state.overlay_cancel_epoch.load(Ordering::SeqCst) != run_epoch {
                overlay::wipe_overlay_dir(&build.overlay_dir.to_string_lossy());
                overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid, &state.early_monitor_runoverlay_started);
                *state.active_overlay_run.lock().await = false;
                return Err(
                    "La sesion termino durante mkoverlay; la inyeccion fue cancelada.".to_string(),
                );
            }

            overlay::append_overlay_log("[Engine] Overlay listo; iniciando runoverlay.");
            let runner = match start_runoverlay(
                &build.mod_tools,
                &build.game_dir,
                &build.overlay_dir,
            ) {
                    Ok(runner) => runner,
                    Err(error) => {
                        overlay::stop_early_monitor(
                            &state.early_monitor_active,
                            &state.early_monitor_pid,
                            &state.early_monitor_runoverlay_started,
                        );
                        overlay::wipe_overlay_dir(&build.overlay_dir.to_string_lossy());
                        *state.current_overlay_error.lock().await = error.clone();
                        *state.active_overlay_run.lock().await = false;
                        return Err(error);
                    }
                };

            // Rose-style: resume_game() equivalent. Rose calls this INSIDE
            // mk_run_overlay() right after runoverlay starts. It resumes the
            // frozen game and stops the monitor thread. This is the PRIMARY
            // stop mechanism; the JS finally block's stopRoseEarlyMonitor is
            // only defensive cleanup (no-op since monitor is already stopped).
            //
            // IMPORTANT: We add a small delay before resuming. In Rose, the
            // overhead of Python/psutil (Popen + Process(pid).nice()) gives
            // the DLL ~200-400ms to inject and hook CreateFileA before the
            // game resumes. Without this delay, Rust's fast spawn+resume
            // lets League load WADs before the hook is in place, causing
            // intermittent injection failures.
            std::thread::sleep(Duration::from_millis(300));
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid, &state.early_monitor_runoverlay_started);
            overlay::append_overlay_log("[Engine] runoverlay started; early monitor stopped (resume_game equivalent).");

            *state.running_overlay_process.lock().await = Some(runner.pid);
            *state.running_overlay_alive.lock().await = Some(runner.exited.clone());
            *state.running_overlay_ready.lock().await = None;
            *state.current_overlay_path.lock().await = runner.overlay_path.clone();
            *state.current_overlay_error.lock().await = String::new();

            let pid = runner.pid;
            let exited = runner.exited.clone();
            let app_watch = app.clone();
            tokio::spawn(async move {
                while !exited.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                let state = app_watch.state::<AppState>();
                if *state.running_overlay_process.lock().await == Some(pid) {
                    *state.running_overlay_process.lock().await = None;
                    *state.running_overlay_alive.lock().await = None;
                    *state.running_overlay_ready.lock().await = None;
                    overlay::append_overlay_log(&format!(
                        "[Engine] runoverlay exited pid={}. Overlay kept alive for DLL.",
                        pid
                    ));
                    let _ = app_watch.emit(
                        "patcher-died",
                        serde_json::json!({
                            "pid": pid,
                            "reason": "rose-v2-exited"
                        }),
                    );
                }
            });
            overlay::append_overlay_log(&format!(
                "[Engine] runoverlay iniciado pid={}; esperando a League sin depender de stdout.",
                runner.pid
            ));
            Ok(serde_json::json!({
                "success": true,
                "started": true,
                "ready": false,
                "pid": runner.pid,
                "profilePath": runner.overlay_path,
                "enginePath": rose_mod_tools_response,
                "runner": "rose-v2"
            }))
        }
        Err(error) => {
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid, &state.early_monitor_runoverlay_started);
            *state.current_overlay_error.lock().await = error.clone();
            Err(error)
        }
    };
    *state.active_overlay_run.lock().await = false;
    result
}
