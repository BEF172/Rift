use crate::{junction, overlay, AppState};
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
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
    hook_ready: Arc<AtomicBool>,
}

struct RoseBuild {
    mod_tools: PathBuf,
    game_dir: PathBuf,
    overlay_dir: PathBuf,
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
    let source = path
        .file_stem()
        .or_else(|| path.file_name())
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
    format!("{:03}-{}", index + 1, cleaned.trim())
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
    for (index, source_text) in paths.iter().enumerate() {
        let source = PathBuf::from(source_text);
        if !source.exists() {
            return Err(format!("Mod no encontrado: {}", source.display()));
        }
        let name = safe_mod_name(&source, index);
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
            let wad_dir = destination.join("WAD");
            std::fs::create_dir_all(&wad_dir)
                .map_err(|error| format!("No pude crear WAD staging: {}", error))?;
            let file_name = source
                .file_name()
                .ok_or_else(|| format!("Nombre de WAD invalido: {}", source.display()))?;
            std::fs::copy(&source, wad_dir.join(file_name))
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

fn start_runoverlay(
    mod_tools: &Path,
    game_dir: &Path,
    overlay_dir: &Path,
) -> Result<RoseRunner, String> {
    let config_path = overlay_dir.join("cslol-config.json");
    // Rose passes this path together with --opts:configless. The file does not
    // need to exist; mod-tools uses the configless runtime configuration.
    let mut command = Command::new(mod_tools);
    command
        .arg("runoverlay")
        .arg(overlay_dir)
        .arg(&config_path)
        .arg(format!("--game:{}", game_dir.display()))
        .arg("--opts:configless")
        .current_dir(mod_tools.parent().unwrap_or_else(|| Path::new(".")))
        // mod-tools keeps its runoverlay loop alive while stdin remains open.
        // Rose inherits an open stdin; our generic runner uses the same explicit
        // pipe guard. Stdio::null() sends EOF and makes runoverlay exit with code
        // 0 immediately after printing "Waiting for league match to start".
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|error| format!("No pude iniciar runoverlay: {}", error))?;
    let pid = child.id();
    let stdin_guard = child.stdin.take();
    let hook_ready = Arc::new(AtomicBool::new(false));
    if let Some(stdout) = child.stdout.take() {
        let stdout_hook_ready = hook_ready.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let line = line.trim();
                if !line.is_empty() {
                    overlay::append_overlay_log(&format!("[RoseV2/runoverlay] {}", line));
                    let lower = line.to_lowercase();
                    if lower.contains("hook applied")
                        || lower.contains("init done")
                        || lower.contains("overlay active")
                        || lower.contains("redirected wad")
                    {
                        stdout_hook_ready.store(true, Ordering::SeqCst);
                    }
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let line = line.trim();
                if !line.is_empty() {
                    overlay::append_overlay_log(&format!("[RoseV2/runoverlay:stderr] {}", line));
                }
            }
        });
    }
    let exited = Arc::new(AtomicBool::new(false));
    let exited_thread = exited.clone();
    std::thread::spawn(move || {
        let _keep_stdin_open = stdin_guard;
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
        hook_ready,
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
    let game_exe = PathBuf::from(
        payload
            .get("gamePath")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
    );
    let game_dir = game_exe
        .parent()
        .filter(|path| path.is_dir())
        .ok_or_else(|| "League of Legends.exe no configurado.".to_string())?;
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
        "[Engine] mkoverlay mods={} paths={}",
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
    junction::clean_dir(&mods_dir);
    overlay::append_overlay_log(
        "[Engine] mkoverlay OK; staging limpiado; esperando League suspendido.",
    );
    Ok(RoseBuild {
        mod_tools,
        game_dir: game_dir.to_path_buf(),
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

    let app_dir = state.app_data_dir.lock().await.clone();
    let bundled_rose_mod_tools = match app.path().resource_dir() {
        Ok(path) => path.join("rose-tools").join("mod-tools.exe"),
        Err(error) => {
            *state.active_overlay_run.lock().await = false;
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid);
            return Err(format!("No pude resolver recursos: {}", error));
        }
    };
    let rose_mod_tools = match prepare_rose_tools(&app_dir, &bundled_rose_mod_tools) {
        Ok(path) => path,
        Err(error) => {
            *state.active_overlay_run.lock().await = false;
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid);
            return Err(error);
        }
    };
    let rose_mod_tools_response = rose_mod_tools.to_string_lossy().to_string();
    let payload_for_build = payload.clone();
    let result = match tokio::task::spawn_blocking(move || {
        build_overlay(&payload_for_build, &app_dir, &rose_mod_tools)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            *state.active_overlay_run.lock().await = false;
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid);
            return Err(format!("Engine worker fallo: {}", error));
        }
    };

    let result = match result {
        Ok(build) => {
            if state.overlay_cancel_epoch.load(Ordering::SeqCst) != run_epoch {
                overlay::wipe_overlay_dir(&build.overlay_dir.to_string_lossy());
                overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid);
                *state.active_overlay_run.lock().await = false;
                return Err(
                    "La sesion termino durante mkoverlay; la inyeccion fue cancelada.".to_string(),
                );
            }

            // Rose starts runoverlay immediately after mkoverlay. The monitor
            // handles suspension independently; runoverlay will wait for League
            // internally if needed.
            overlay::append_overlay_log(
                "[Engine] Overlay listo; iniciando runoverlay.",
            );
            let runner =
                match start_runoverlay(&build.mod_tools, &build.game_dir, &build.overlay_dir) {
                    Ok(runner) => runner,
                    Err(error) => {
                        overlay::stop_early_monitor(
                            &state.early_monitor_active,
                            &state.early_monitor_pid,
                        );
                        overlay::wipe_overlay_dir(&build.overlay_dir.to_string_lossy());
                        *state.current_overlay_error.lock().await = error.clone();
                        *state.active_overlay_run.lock().await = false;
                        return Err(error);
                    }
                };

            // Exact Rose ordering: runoverlay exists before League is resumed.
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid);

            // Rose does not wait for stdout confirmation. It just trusts
            // that runoverlay will find League on its own.
            *state.running_overlay_process.lock().await = Some(runner.pid);
            *state.running_overlay_alive.lock().await = Some(runner.exited.clone());
            *state.running_overlay_ready.lock().await = Some(runner.hook_ready.clone());
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
                    // Rose-style: do NOT wipe overlay on runoverlay exit.
                    // The DLL inside League reads overlay files at runtime.
                    // Overlay is cleaned up when: (1) game ends, or (2) a new overlay is built.
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
                "ready": runner.hook_ready.load(Ordering::SeqCst),
                "pid": runner.pid,
                "profilePath": runner.overlay_path,
                "enginePath": rose_mod_tools_response,
                "runner": "rose-v2"
            }))
        }
        Err(error) => {
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid);
            *state.current_overlay_error.lock().await = error.clone();
            Err(error)
        }
    };
    *state.active_overlay_run.lock().await = false;
    result
}
