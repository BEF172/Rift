use serde_json;
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[allow(dead_code)]
const MOD_PACKAGE_EXTENSIONS: &[&str] = &[".fantome", ".zip", ".rse", ".wad", ".wad.client"];
const SUSPICIOUS_WAD_SIZE: u64 = 1024 * 1024;
const MKOVERLAY_BASE_TIMEOUT_MS: u64 = 1000 * 60 * 5;
const MKOVERLAY_PER_MB_TIMEOUT_MS: u64 = 1000 * 20;
const MKOVERLAY_MAX_TIMEOUT_MS: u64 = 1000 * 60 * 30;
const EARLY_MONITOR_AUTO_RESUME_SECS: u64 = 120;

#[derive(Clone)]
pub struct OverlayRunToken {
    pub canceled: Arc<AtomicBool>,
    pub reason: Arc<Mutex<String>>,
}

impl OverlayRunToken {
    pub fn new() -> Self {
        Self {
            canceled: Arc::new(AtomicBool::new(false)),
            reason: Arc::new(Mutex::new(String::new())),
        }
    }

    pub fn cancel(&self, reason: &str) {
        self.canceled.store(true, Ordering::SeqCst);
        let reason_str = reason.to_string();
        let reason_clone = self.reason.clone();
        tokio::spawn(async move {
            *reason_clone.lock().await = reason_str;
        });
    }

    pub fn is_canceled(&self) -> bool {
        self.canceled.load(Ordering::SeqCst)
    }

    #[allow(dead_code)]
    pub async fn get_reason(&self) -> String {
        self.reason.lock().await.clone()
    }
}

pub struct GameSuspensionGuard {
    active: Arc<AtomicBool>,
    suspended_pid: Arc<StdMutex<Option<u32>>>,
}

/// Extract PID from a StdMutex, recovering from poisoning (panic while locked).
/// If the mutex is poisoned, we still recover the inner value to avoid leaving
/// the game suspended forever.
fn take_pid_from_mutex(mutex: &StdMutex<Option<u32>>) -> Option<u32> {
    match mutex.lock() {
        Ok(mut guard) => guard.take(),
        Err(poisoned) => {
            // Lock was poisoned (panic while held). Recover the inner value.
            append_overlay_log("[GameSuspensionGuard] Mutex poisoned, recovering PID from poison.");
            poisoned.into_inner().take()
        }
    }
}

impl GameSuspensionGuard {
    /// Creates a new suspension guard.
    ///
    /// If `pid` is `Some(pid)`, the process is assumed to already be suspended
    /// and no polling loop is spawned — the guard just watches the release
    /// signal and resumes the process when signalled (Rose-style early monitor).
    pub fn new(pid: Option<u32>, game_path: Option<&str>) -> Self {
        let active = Arc::new(AtomicBool::new(true));
        let suspended_pid = Arc::new(StdMutex::new(pid));

        if let Some(_) = pid {
            // Process is already suspended by the early monitor.
            // Spawn a simple thread that watches the release signal.
            let active_clone = active.clone();
            let pid_clone = suspended_pid.clone();
            std::thread::spawn(move || {
                while active_clone.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(100));
                }
                if let Some(pid) = take_pid_from_mutex(&pid_clone) {
                    let _ = resume_process(pid);
                }
            });
        } else if let Some(gp) = game_path {
            let active_clone = active.clone();
            let pid_clone = suspended_pid.clone();
            let game_path = gp.to_string();
            tokio::spawn(async move {
                suspend_league_loop(&game_path, active_clone, pid_clone).await;
            });
        }

        Self {
            active,
            suspended_pid,
        }
    }

    pub fn release_signal(&self) -> Arc<AtomicBool> {
        self.active.clone()
    }

    pub fn release(&self) {
        self.active.store(false, Ordering::SeqCst);
        let pid = take_pid_from_mutex(&self.suspended_pid);
        if let Some(pid) = pid {
            match resume_process(pid) {
                Ok(()) => append_overlay_log(&format!(
                    "[GameSuspend] League reanudado inmediato pid={}",
                    pid
                )),
                Err(error) => append_overlay_log(&format!(
                    "[GameSuspend] ERROR reanudando inmediato pid={}: {}",
                    pid, error
                )),
            }
        }
    }
}

impl Drop for GameSuspensionGuard {
    fn drop(&mut self) {
        self.release();
    }
}

async fn suspend_league_loop(
    game_path: &str,
    active: Arc<AtomicBool>,
    suspended_pid_shared: Arc<StdMutex<Option<u32>>>,
) {
    let start = Instant::now();
    // Rose safety window: never leave League suspended indefinitely if the
    // overlay preparation fails before the runner starts.
    let max_duration = Duration::from_secs(60);
    let mut suspended_pid: Option<u32> = None;
    let mut logged_waiting = false;
    let mut immediate_checks = 0u32;

    while active.load(Ordering::SeqCst) && start.elapsed() < max_duration {
        if let Some(pid) = find_league_process(game_path) {
            if suspended_pid != Some(pid) {
                match suspend_process(pid) {
                    Ok(()) => {
                        append_overlay_log(&format!("[GameSuspend] League suspendido pid={}", pid))
                    }
                    Err(error) => {
                        append_overlay_log(&format!(
                            "[GameSuspend] ERROR suspendiendo pid={}: {}",
                            pid, error
                        ));
                        break;
                    }
                }
                suspended_pid = Some(pid);
                match suspended_pid_shared.lock() {
                    Ok(mut shared) => *shared = Some(pid),
                    Err(poisoned) => *poisoned.into_inner() = Some(pid),
                }
            }
            logged_waiting = false;
        } else {
            if !logged_waiting {
                append_overlay_log("[GameSuspend] Esperando proceso League durante preparacion.");
                logged_waiting = true;
            }
        }
        immediate_checks += 1;
        let delay = if immediate_checks < 20 { 25 } else { 250 };
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }

    if let Some(pid) = suspended_pid {
        let should_resume = match suspended_pid_shared.lock() {
            Ok(mut shared) => shared.take() == Some(pid),
            Err(poisoned) => poisoned.into_inner().take() == Some(pid),
        };
        if !should_resume {
            return;
        }
        match resume_process(pid) {
            Ok(()) => append_overlay_log(&format!("[GameSuspend] League reanudado pid={}", pid)),
            Err(error) => append_overlay_log(&format!(
                "[GameSuspend] ERROR reanudando pid={}: {}",
                pid, error
            )),
        }
    }
}

pub fn start_early_monitor(
    game_path: &str,
    active: Arc<AtomicBool>,
    pid_shared: Arc<StdMutex<Option<u32>>>,
) {
    let gp = game_path.to_string();
    tokio::spawn(async move {
        let start = Instant::now();
        let max_duration = Duration::from_secs(60);
        // Safety timeout: only resume if GameSuspensionGuard never takes over
        // (e.g., run_overlay_blocking was never called or crashed before creating guard)
        let auto_resume_timeout = Duration::from_secs(EARLY_MONITOR_AUTO_RESUME_SECS);
        let mut suspended_pid: Option<u32> = None;
        let mut suspended_at: Option<Instant> = None;
        let mut logged_waiting = false;
        let mut immediate_checks = 0u32;

        append_overlay_log("[EarlyMonitor] Monitor temprano iniciado (50ms poll).");
        while active.load(Ordering::SeqCst) && start.elapsed() < max_duration {
            if let Some(pid) = find_league_process(&gp) {
                if suspended_pid != Some(pid) {
                    match suspend_process(pid) {
                        Ok(()) => {
                            append_overlay_log(&format!(
                                "[EarlyMonitor] League suspendido pid={} auto_resume={}s",
                                pid, EARLY_MONITOR_AUTO_RESUME_SECS
                            ));
                        }
                        Err(e) => {
                            append_overlay_log(&format!(
                                "[EarlyMonitor] ERROR suspendiendo pid={}: {}",
                                pid, e
                            ));
                            break;
                        }
                    }
                    suspended_pid = Some(pid);
                    suspended_at = Some(Instant::now());
                    match pid_shared.lock() {
                        Ok(mut shared) => *shared = Some(pid),
                        Err(poisoned) => *poisoned.into_inner() = Some(pid),
                    }
                }

                // Rose-style auto-resume safety timeout. Rose defaults this to
                // 60s for real injections; shorter windows can release League
                // before mkoverlay finishes on slower first builds.
                if let Some(since) = suspended_at {
                    if since.elapsed() >= auto_resume_timeout {
                        append_overlay_log(&format!(
                            "[EarlyMonitor] AUTO-RESUME tras {:.0}s (safety timeout)",
                            since.elapsed().as_secs_f64()
                        ));
                        if let Some(p) = suspended_pid.take() {
                            let _ = resume_process(p);
                        }
                        match pid_shared.lock() {
                            Ok(mut shared) => *shared = None,
                            Err(poisoned) => *poisoned.into_inner() = None,
                        }
                        active.store(false, Ordering::SeqCst);
                        break;
                    }
                }

                logged_waiting = false;
            } else {
                if !logged_waiting {
                    append_overlay_log("[EarlyMonitor] Esperando proceso League.");
                    logged_waiting = true;
                }
            }
            immediate_checks += 1;
            let delay = if immediate_checks < 10 { 5 } else { 50 };
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }

        if let Some(pid) = suspended_pid {
            let should_resume = match pid_shared.lock() {
                Ok(mut shared) => shared.take() == Some(pid),
                Err(poisoned) => poisoned.into_inner().take() == Some(pid),
            };
            if should_resume {
                match resume_process(pid) {
                    Ok(()) => {
                        append_overlay_log(&format!("[EarlyMonitor] League reanudado pid={}", pid));
                    }
                    Err(e) => {
                        append_overlay_log(&format!(
                            "[EarlyMonitor] ERROR reanudando pid={}: {}",
                            pid, e
                        ));
                    }
                }
            }
        }
        // Always clear the active flag so a new monitor can be started for the next game.
        active.store(false, Ordering::SeqCst);
        append_overlay_log("[EarlyMonitor] Monitor temprano finalizado.");
    });
}

pub fn stop_early_monitor(active: &AtomicBool, pid_shared: &StdMutex<Option<u32>>) -> bool {
    active.store(false, Ordering::SeqCst);
    let pid = match pid_shared.lock() {
        Ok(mut g) => g.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    };
    if let Some(pid) = pid {
        match resume_process(pid) {
            Ok(()) => append_overlay_log(&format!(
                "[EarlyMonitor] League reanudado por stop pid={}",
                pid
            )),
            Err(error) => append_overlay_log(&format!(
                "[EarlyMonitor] ERROR reanudando por stop pid={}: {}",
                pid, error
            )),
        }
        return true;
    }
    false
}

fn process_entry_name(entry: &[u16]) -> String {
    let len = entry.iter().position(|&c| c == 0).unwrap_or(entry.len());
    String::from_utf16_lossy(&entry[..len])
}

fn process_image_path(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }

        let mut buf_size: u32 = 1024;
        let mut buf: Vec<u16> = vec![0u16; buf_size as usize];
        let ret = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut buf_size);
        CloseHandle(handle);

        if ret == 0 {
            return None;
        }

        Some(String::from_utf16_lossy(&buf[..buf_size as usize]))
    }
}

pub fn find_league_process(_game_path: &str) -> Option<u32> {
    find_pid_by_process_name("League of Legends.exe")
}

/// Find the full exe path of a running process by name (Rose-style: gets path
/// from the process in memory, never searches disk).
pub fn find_process_exe_path(target_name: &str) -> Option<String> {
    let (_, path) = find_processes_by_name(target_name).into_iter().next()?;
    let path_buf = PathBuf::from(&path);
    let dir = path_buf.parent()?;
    Some(dir.to_string_lossy().to_string())
}

fn find_processes_by_name(target_name: &str) -> Vec<(u32, String)> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            return Vec::new();
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        let mut result = Vec::new();

        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                let exe_name = process_entry_name(&entry.szExeFile);
                if exe_name.eq_ignore_ascii_case(target_name) {
                    let pid = entry.th32ProcessID;
                    let path = process_image_path(pid).unwrap_or_default();
                    result.push((pid, path));
                }
                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
        result
    }
}

pub fn find_pid_by_process_name(target_name: &str) -> Option<u32> {
    find_processes_by_name(target_name)
        .into_iter()
        .next()
        .map(|(pid, _)| pid)
}

pub fn suspend_process(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SUSPEND_RESUME};

    unsafe {
        let handle = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
        if handle.is_null() {
            return Err(format!(
                "OpenProcess failed for pid={} (error={})",
                pid,
                std::io::Error::last_os_error()
            ));
        }
        let raw = handle as isize;
        let status = nt_suspend_process(raw);
        CloseHandle(handle);
        if status == 0 {
            Ok(())
        } else {
            Err(format!("NtSuspendProcess failed: NTSTATUS={}", status))
        }
    }
}

pub fn resume_process(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SUSPEND_RESUME};

    unsafe {
        let handle = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
        if handle.is_null() {
            return Err(format!(
                "OpenProcess failed for pid={} (error={})",
                pid,
                std::io::Error::last_os_error()
            ));
        }
        let raw = handle as isize;
        let mut successful_resume = false;
        let mut statuses = Vec::with_capacity(4);
        for _ in 0..4 {
            let status = nt_resume_process(raw);
            statuses.push(status);
            successful_resume |= status == 0;
            std::thread::sleep(Duration::from_millis(25));
        }
        CloseHandle(handle);
        if !successful_resume {
            return Err(format!(
                "NtResumeProcess failed for pid={}: NTSTATUS={:?}",
                pid, statuses
            ));
        }
        if !is_process_alive(pid) {
            return Err(format!(
                "League pid={} termino durante la verificacion de resume",
                pid
            ));
        }
        append_overlay_log(&format!(
            "[GameSuspend] Resume verificado pid={} intentos={} statuses={:?}",
            pid,
            statuses.len(),
            statuses
        ));
        Ok(())
    }
}

type NtSysCall = unsafe extern "system" fn(isize) -> u32;

fn get_nt_func(name: &[u8]) -> Option<NtSysCall> {
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress};
    unsafe {
        let ntdll = GetModuleHandleA(b"ntdll.dll\0".as_ptr());
        if ntdll.is_null() {
            return None;
        }
        let addr = GetProcAddress(ntdll, name.as_ptr());
        addr.map(|f| std::mem::transmute(f))
    }
}

unsafe fn nt_suspend_process(handle: isize) -> u32 {
    if let Some(f) = get_nt_func(b"NtSuspendProcess\0") {
        f(handle)
    } else {
        0xC0000001
    }
}

unsafe fn nt_resume_process(handle: isize) -> u32 {
    if let Some(f) = get_nt_func(b"NtResumeProcess\0") {
        f(handle)
    } else {
        0xC0000001
    }
}

/// Find and suspend the League of Legends process, returning its PID.
/// This mirrors what Rose does: freeze the game before overlay rebuild so
/// textures already in memory stay frozen while mkoverlay runs.
pub fn find_and_suspend_league(game_path: &str) -> Result<u32, String> {
    let pid = find_league_process(game_path)
        .ok_or_else(|| "League of Legends.exe no encontrado.".to_string())?;
    suspend_process(pid)?;
    append_overlay_log(&format!(
        "[GameSuspend] League suspendido externamente pid={}",
        pid
    ));
    Ok(pid)
}

pub fn resume_league_by_pid(pid: u32) -> Result<(), String> {
    resume_process(pid)?;
    append_overlay_log(&format!(
        "[GameSuspend] League reanudado externamente pid={}",
        pid
    ));
    Ok(())
}

pub fn append_overlay_log(message: &str) {
    println!("[Overlay] {}", message);
    if let Some(path) = overlay_log_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(file, "{} {}", chrono::Utc::now().to_rfc3339(), message);
        }
    }
}

fn overlay_log_path() -> Option<PathBuf> {
    Some(writable_data_dir_path().join("last-overlay-log.txt"))
}

fn writable_data_dir_path() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(std::path::PathBuf::from)
                .map(|p| p.join("AppData").join("Local"))
        })
        .unwrap_or_else(|| crate::install_dir())
        .join("Rift Atlas")
}

pub fn get_mod_package_extension(file_path: &str) -> String {
    let lower = file_path.to_lowercase();
    if lower.ends_with(".wad.client") {
        ".wad.client".to_string()
    } else {
        PathBuf::from(file_path)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default()
    }
}

#[allow(dead_code)]
pub fn is_mod_extension(ext: &str) -> bool {
    MOD_PACKAGE_EXTENSIONS.contains(&ext)
}

pub fn get_files_total_size(paths: &[String]) -> u64 {
    let mut total = 0u64;
    for p in paths {
        let path = PathBuf::from(p);
        if path.is_file() {
            total += std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        } else if path.is_dir() {
            total += dir_size(&path);
        }
    }
    total
}

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

pub fn get_mkoverlay_timeout_ms(bytes: u64) -> u64 {
    let extra = (bytes / (1024 * 1024)).saturating_mul(MKOVERLAY_PER_MB_TIMEOUT_MS);
    MKOVERLAY_BASE_TIMEOUT_MS
        .saturating_add(extra)
        .min(MKOVERLAY_MAX_TIMEOUT_MS)
}

// ── Overlay cache helpers (matching Electron) ──

pub fn is_usable_overlay_path(path: &str) -> bool {
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return false;
    }
    let data_dir = p.join("DATA");
    data_dir.is_dir() && dir_contains_wad(&data_dir)
}

fn dir_contains_wad(path: &Path) -> bool {
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            if dir_contains_wad(&entry_path) {
                return true;
            }
            continue;
        }
        let lower = entry_path.to_string_lossy().to_lowercase();
        if lower.ends_with(".wad") || lower.ends_with(".wad.client") {
            return true;
        }
    }
    false
}

/// Set HIDDEN+SYSTEM attributes on overlay directory (matching Rose _hide_directory).
/// Prevents users from accidentally deleting overlay WADs.
#[cfg(target_os = "windows")]
pub fn hide_overlay_dir(overlay_path: &str) {
    if overlay_path.is_empty() {
        return;
    }
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x02;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x04;
    let attrs = FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM;

    let dir = PathBuf::from(overlay_path);
    if dir.is_dir() {
        // Hide the directory itself
        let wide: Vec<u16> = dir
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            windows_sys::Win32::Storage::FileSystem::SetFileAttributesW(wide.as_ptr(), attrs);
        }
        // Hide all files inside
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let wide: Vec<u16> = entry_path
                    .to_string_lossy()
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                unsafe {
                    windows_sys::Win32::Storage::FileSystem::SetFileAttributesW(
                        wide.as_ptr(),
                        attrs,
                    );
                }
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn hide_overlay_dir(_overlay_path: &str) {}

/// Wipe overlay directory after game ends (matching Rose _wipe_overlay_dir).
/// Removes all patched WAD files that are no longer needed.
pub fn wipe_overlay_dir(overlay_path: &str) {
    if overlay_path.is_empty() {
        return;
    }
    let dir = PathBuf::from(overlay_path);
    if !dir.is_dir() {
        return;
    }
    // Remove all contents but keep the directory
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let _ = crate::junction::remove_entry(&entry.path());
        }
    }
    append_overlay_log(&format!("Overlay limpiado post-juego: {}", overlay_path));
}

/// Always-fresh overlay directory (like Rose's `%LOCALAPPDATA%\Rose\injection\overlay`).
/// No cache — mkoverlay runs fresh every time.  This matches Rose's approach:
/// clean → extract → mkoverlay → runoverlay → clean.
/// Uses a unique subdirectory per build to avoid file lock conflicts when the
/// previous patcher's DLL still holds handles on overlay WAD files.
static OVERLAY_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

pub fn next_overlay_dir() -> PathBuf {
    let n = OVERLAY_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    writable_data_dir_path().join(format!("overlay-{}", n))
}

#[allow(dead_code)]
pub fn current_overlay_dir() -> PathBuf {
    let n = OVERLAY_COUNTER.load(std::sync::atomic::Ordering::Relaxed);
    if n == 0 {
        writable_data_dir_path().join("overlay")
    } else {
        writable_data_dir_path().join(format!("overlay-{}", n))
    }
}

#[allow(dead_code)]
pub fn clean_overlay_dir() {
    let dir = current_overlay_dir();
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    let _ = std::fs::create_dir_all(&dir);
}

/// Clean ALL overlay-* directories (stale overlays from previous builds).
pub fn clean_all_overlay_dirs() {
    let base = writable_data_dir_path();
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if (name.starts_with("overlay") && name != "overlay") && entry.path().is_dir() {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
    // Also clean legacy "overlay" directory
    let legacy = base.join("overlay");
    if legacy.is_dir() {
        let _ = std::fs::remove_dir_all(&legacy);
    }
}

pub fn ensure_cslol_dll(sidecar_path: &str, dll_path: &str) -> Result<String, String> {
    // Rose/mod-tools embeds its own runoverlay flow and does not use the LTK
    // patcher DLL.
    if is_mod_tools(sidecar_path) {
        return Ok(String::new());
    }
    let bundled_dll = PathBuf::from(dll_path);
    if bundled_dll.exists() {
        return Ok(bundled_dll.to_string_lossy().to_string());
    }
    // Engine DLL lives next to the exe (read-only install dir)
    let install = crate::install_dir();
    let engine_dll = install.join("engine").join("tools").join("cslol-dll.dll");
    if engine_dll.exists() {
        return Ok(engine_dll.to_string_lossy().to_string());
    }
    Err("cslol-dll.dll no encontrada. Pegala manualmente en engine/tools dentro de la instalacion de Rift Atlas.".to_string())
}

// ── Fantome generation (matching Electron generateFantomeFromLeagueWad) ──

pub fn generate_fantome_from_league_wad(
    sidecar_path: &str,
    game_path: &str,
    skin: &serde_json::Value,
    app_data_dir: &str,
) -> Result<String, String> {
    let source_path = skin
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let extension = get_mod_package_extension(&source_path);
    let display_name = skin
        .get("champion")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
        + " - "
        + &skin
            .get("skin")
            .or_else(|| skin.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

    append_overlay_log(&format!(
        "Preparando mod: ext={} display={}",
        extension, display_name
    ));

    if extension == ".zip" {
        return handle_zip_mod(skin, sidecar_path, game_path, app_data_dir);
    }

    if extension == ".fantome" {
        let is_local_custom = is_local_custom_archive(skin, &source_path);
        if is_local_custom {
            let archive_info = skin.get("archiveInfo").cloned();
            let has_wad = archive_info
                .as_ref()
                .and_then(|a| a.get("hasWadFolder").and_then(|v| v.as_bool()))
                .unwrap_or(false);
            let wad_count = archive_info
                .as_ref()
                .and_then(|a| a.get("wadCount").and_then(|v| v.as_u64()))
                .unwrap_or(0);
            if has_wad || wad_count > 0 {
                append_overlay_log(&format!("Mod local .fantome con WAD: {}", source_path));
                return Ok(source_path);
            }
        }
        append_overlay_log(&format!("Usando .fantome directo: {}", source_path));
        return Ok(source_path);
    }

    // Handle WAD files via fantonize
    let resolved = resolve_fantonize_skin_entry(skin, game_path);
    if !resolved.needs_fantonize {
        if !resolved.path.is_empty() {
            return Ok(resolved.path);
        }
        return Ok(source_path);
    }

    generate_resolved_fantonize_package(sidecar_path, game_path, &resolved, app_data_dir)
}

struct ResolvedSkinEntry {
    needs_fantonize: bool,
    path: String,
    champion_key: String,
    skin_number: u64,
}

fn resolve_fantonize_skin_entry(skin: &serde_json::Value, _game_path: &str) -> ResolvedSkinEntry {
    let champion_key = skin
        .get("championKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let skin_number = skin.get("skinNum").and_then(|v| v.as_u64()).unwrap_or(0);
    let source_path = skin
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if source_path.to_lowercase().ends_with(".wad")
        || source_path.to_lowercase().ends_with(".wad.client")
    {
        return ResolvedSkinEntry {
            needs_fantonize: true,
            path: source_path,
            champion_key,
            skin_number,
        };
    }

    if champion_key.is_empty() || skin_number == 0 {
        return ResolvedSkinEntry {
            needs_fantonize: false,
            path: source_path,
            champion_key,
            skin_number,
        };
    }

    ResolvedSkinEntry {
        needs_fantonize: true,
        path: source_path,
        champion_key,
        skin_number,
    }
}

fn generate_resolved_fantonize_package(
    sidecar_path: &str,
    game_path: &str,
    resolved: &ResolvedSkinEntry,
    app_data_dir: &str,
) -> Result<String, String> {
    let game_exe_parent = PathBuf::from(game_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let game_folder = if game_exe_parent
        .file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case("Game"))
        .unwrap_or(false)
    {
        game_exe_parent
    } else {
        game_exe_parent.join("Game")
    };

    // Build champion WAD path: Game/DATA/FINAL/Champions/{championKey}.wad.client
    let wad_path = game_folder
        .join("DATA")
        .join("FINAL")
        .join("Champions")
        .join(format!("{}.wad.client", resolved.champion_key))
        .to_string_lossy()
        .to_string();

    let clean_skin_name = format!("skin{}", resolved.skin_number);
    let output_dir = writable_data_dir_path()
        .join("Downloaded-Champions")
        .join(&resolved.champion_key);

    // Check for cached .fantome
    let expected_path = output_dir.join(format!(
        "{}_{}.fantome",
        resolved.champion_key, clean_skin_name
    ));
    if expected_path.exists() {
        if let Ok(meta) = std::fs::metadata(&expected_path) {
            if meta.len() > 1024 {
                append_overlay_log(&format!(
                    "Fantome cache HIT: {}",
                    expected_path.to_string_lossy()
                ));
                return Ok(expected_path.to_string_lossy().to_string());
            }
        }
    }

    append_overlay_log(&format!(
        "Fantonize: {} skin#{} desde {}",
        resolved.champion_key, resolved.skin_number, wad_path
    ));

    let ht_path = ensure_game_hashtable(app_data_dir).unwrap_or_default();
    execute_fantonize(
        sidecar_path,
        &wad_path,
        &resolved.champion_key,
        resolved.skin_number,
        &output_dir.to_string_lossy(),
        &ht_path,
    )
}

fn is_local_custom_archive(skin: &serde_json::Value, source_path: &str) -> bool {
    let is_custom = skin
        .get("custom")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !is_custom {
        return false;
    }
    let lower = source_path.replace('/', "\\").to_lowercase();
    !lower.contains("\\rift atlas\\downloaded-libraries\\leagueskins\\")
}

fn handle_zip_mod(
    skin: &serde_json::Value,
    _sidecar_path: &str,
    _game_path: &str,
    _app_data_dir: &str,
) -> Result<String, String> {
    let source_path = skin
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let archive_info = skin.get("archiveInfo").cloned();

    let suspicious = archive_info
        .as_ref()
        .and_then(|a| a.get("suspicious").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    if suspicious {
        return Err(format!(
            "No pude resolver {} a una skin de League. Reindexa o revisa el paquete.",
            source_path
        ));
    }

    if is_local_custom_archive(skin, &source_path) {
        let has_wad = archive_info
            .as_ref()
            .and_then(|a| a.get("hasWadFolder").and_then(|v| v.as_bool()))
            .unwrap_or(false);
        let wad_count = archive_info
            .as_ref()
            .and_then(|a| a.get("wadCount").and_then(|v| v.as_u64()))
            .unwrap_or(0);
        if has_wad || wad_count > 0 {
            append_overlay_log(&format!("Mod local .fantome con WAD: {}", source_path));
            return Ok(source_path);
        }
    }

    // Normal ZIP: use directly (prepare_mkoverlay_mods will extract)
    append_overlay_log(&format!("Usando ZIP directo: {}", source_path));
    Ok(source_path)
}

pub fn get_overlay_mod_fallback_paths(_mod_paths: &[String]) -> Option<Vec<String>> {
    None
}

// ── execToolWithTimeout (matching Electron) ──

pub fn exec_tool_with_timeout(
    cmd: &str,
    args: &[String],
    timeout_ms: u64,
    cwd: &str,
    run_token: &OverlayRunToken,
    input: Option<&str>,
) -> Result<String, String> {
    if run_token.is_canceled() {
        return Err("Ejecucion cancelada por el usuario.".to_string());
    }

    let mut builder = Command::new(cmd);
    builder
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        builder.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = builder
        .spawn()
        .map_err(|e| format!("Error al ejecutar {}: {}", cmd, e))?;

    // Rose boosts the short-lived mkoverlay process so it finishes before the
    // FINALIZATION window closes. Runoverlay intentionally remains normal
    // priority because it lives for the whole match.
    if args
        .first()
        .map(|arg| arg.eq_ignore_ascii_case("mkoverlay"))
        .unwrap_or(false)
    {
        boost_process_priority(child.id());
    }

    if let Some(input_str) = input {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input_str.as_bytes());
            let _ = stdin.flush();
        }
    } else {
        // Drop stdin pipe so child never blocks on stdin EOF
        child.stdin.take();
    }

    // Pipe buffer deadlock fix: read stdout/stderr concurrently.
    // We spawn threads to drain the pipes while the main thread
    // polls for process completion. Without this, if the child
    // writes enough output to fill the OS pipe buffer (~4-64KB on
    // Windows), the child's write() blocks, try_wait() never
    // completes, and we deadlock.
    let stdout_handle = child.stdout.take().map(|stream| {
        std::thread::spawn(move || {
            let mut output = String::new();
            let _ =
                std::io::Read::read_to_string(&mut std::io::BufReader::new(stream), &mut output);
            output
        })
    });

    let stderr_handle = child.stderr.take().map(|stream| {
        std::thread::spawn(move || {
            let mut output = String::new();
            let _ =
                std::io::Read::read_to_string(&mut std::io::BufReader::new(stream), &mut output);
            output
        })
    });

    let start = Instant::now();
    let timeout_dur = Duration::from_millis(timeout_ms);

    // Helper to kill child + close pipes so reader threads unblock
    let cleanup = |child: &mut std::process::Child| {
        let _ = child.kill();
        // Dropping stdin closes the pipe, helping reader threads
        // see EOF even if kill is slow.
        child.stdin.take();
    };

    let status = loop {
        if run_token.is_canceled() {
            cleanup(&mut child);
            // Reader threads will unblock once the pipe closes.
            return Err("Ejecucion cancelada por el usuario.".to_string());
        }

        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() > timeout_dur {
                    cleanup(&mut child);
                    return Err(format!(
                        "Proceso {} excedio el timeout de {}s.",
                        cmd,
                        timeout_ms / 1000
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                cleanup(&mut child);
                return Err(format!("Error esperando {}: {}", cmd, e));
            }
        }
    };

    // Wait for reader threads to finish draining the pipes
    let stdout = stdout_handle
        .map(|h| h.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = stderr_handle
        .map(|h| h.join().unwrap_or_default())
        .unwrap_or_default();

    if status.success() {
        Ok(stdout)
    } else {
        let combined = if stderr.is_empty() { stdout } else { stderr };
        let msg = if combined.len() > 4000 {
            format!(
                "{} (exit code {})",
                &combined[combined.len().saturating_sub(4000)..],
                status.code().unwrap_or(-1)
            )
        } else {
            format!("{} (exit code {})", combined, status.code().unwrap_or(-1))
        };
        Err(msg)
    }
}

#[cfg(windows)]
fn boost_process_priority(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, SetPriorityClass, HIGH_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_SET_INFORMATION, 0, pid);
        if handle.is_null() {
            append_overlay_log(&format!(
                "No pude elevar prioridad de mkoverlay pid={}",
                pid
            ));
            return;
        }
        if SetPriorityClass(handle, HIGH_PRIORITY_CLASS) != 0 {
            append_overlay_log(&format!("mkoverlay prioridad alta pid={}", pid));
        } else {
            append_overlay_log(&format!(
                "No pude elevar prioridad de mkoverlay pid={}",
                pid
            ));
        }
        CloseHandle(handle);
    }
}

#[cfg(not(windows))]
fn boost_process_priority(_pid: u32) {}

// ── mkoverlay with fallback (matching Electron execMkoverlayWithFallback) ──

pub fn execute_mkoverlay(
    sidecar_path: &str,
    game_folder: &str,
    overlay_path: &str,
    state_path: &str,
    mod_paths: &[String],
    run_token: &OverlayRunToken,
) -> Result<String, String> {
    let prepared_mods = prepare_mkoverlay_mods(sidecar_path, state_path, mod_paths)?;
    let active_mod_paths = prepared_mods.as_deref().unwrap_or(mod_paths);
    let args = build_mkoverlay_args(
        sidecar_path,
        game_folder,
        overlay_path,
        state_path,
        active_mod_paths,
    );
    let input_bytes = get_files_total_size(mod_paths);
    let timeout_ms = get_mkoverlay_timeout_ms(input_bytes);
    let tools_dir = PathBuf::from(sidecar_path)
        .parent()
        .unwrap_or(std::path::Path::new(""))
        .to_string_lossy()
        .to_string();

    append_overlay_log(&format!(
        "mkoverlay timeout: {}s para {} bytes",
        timeout_ms / 1000,
        input_bytes
    ));

    let result = match exec_tool_with_timeout(
        sidecar_path,
        &args,
        timeout_ms,
        &tools_dir,
        run_token,
        None,
    ) {
        Ok(stdout) => Ok(stdout),
        Err(error) => {
            append_overlay_log(&format!("mkoverlay fallo, intentando fallback: {}", error));
            if let Some(fallback_paths) = get_overlay_mod_fallback_paths(mod_paths) {
                append_overlay_log("Usando paths originales como fallback...");
                let _ = std::fs::remove_dir_all(overlay_path);
                let _ = std::fs::remove_dir_all(state_path);
                let _ = std::fs::create_dir_all(state_path);

                let fallback_prepared =
                    prepare_mkoverlay_mods(sidecar_path, state_path, &fallback_paths)?;
                let active_fallback_paths = fallback_prepared.as_ref().unwrap_or(&fallback_paths);
                let fallback_args = build_mkoverlay_args(
                    sidecar_path,
                    game_folder,
                    overlay_path,
                    state_path,
                    active_fallback_paths,
                );
                let fallback_bytes = get_files_total_size(&fallback_paths);
                let fallback_timeout = get_mkoverlay_timeout_ms(fallback_bytes);

                append_overlay_log(&format!(
                    "mkoverlay fallback timeout: {}s para {} bytes",
                    fallback_timeout / 1000,
                    fallback_bytes
                ));
                exec_tool_with_timeout(
                    sidecar_path,
                    &fallback_args,
                    fallback_timeout,
                    &tools_dir,
                    run_token,
                    None,
                )
            } else {
                Err(error)
            }
        }
    };

    // Verify overlay has files
    if result.is_ok() {
        let overlay_dir = PathBuf::from(overlay_path);
        if overlay_dir.is_dir() {
            let has_data = overlay_dir.join("DATA").is_dir();
            if !has_data {
                append_overlay_log(&format!("mkoverlay no genero archivos en {}", overlay_path));
                return Err(format!("mkoverlay no genero archivos en {}", overlay_path));
            }
        } else {
            append_overlay_log(&format!("mkoverlay no creo directorio en {}", overlay_path));
            return Err(format!("mkoverlay no creo directorio en {}", overlay_path));
        }

        // Clean staging after mkoverlay (like Rose _wipe_mods_dir)
        let staging_dir = PathBuf::from(state_path).join("mod-tools-mods");
        if staging_dir.is_dir() {
            crate::junction::clean_dir(&staging_dir);
            append_overlay_log("Staging limpiado post-mkoverlay");
        }

        // Hide overlay dir (like Rose _hide_directory)
        hide_overlay_dir(overlay_path);
    }

    result
}

fn prepare_mkoverlay_mods(
    sidecar_path: &str,
    state_path: &str,
    mod_paths: &[String],
) -> Result<Option<Vec<String>>, String> {
    if !is_mod_tools(sidecar_path) {
        return Ok(None);
    }

    let staging_dir = PathBuf::from(state_path).join("mod-tools-mods");
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("No pude crear staging mod-tools: {}", e))?;

    // Clean staging like Rose does (_clean_mods_dir)
    crate::junction::clean_dir(&staging_dir);

    let mut staged_paths = Vec::new();
    let mut used_names = HashSet::new();
    for (index, mod_path) in mod_paths.iter().enumerate() {
        let source = PathBuf::from(mod_path);
        let original_name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| format!("mod-{}", index + 1));
        let stem = if source.is_dir() {
            original_name.clone()
        } else {
            source
                .file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| original_name.clone())
        };
        let base_name = sanitize_mod_folder_name(&stem);
        let mut staged_name = base_name.clone();
        let mut duplicate_index = 2;
        while !used_names.insert(staged_name.to_ascii_lowercase()) {
            staged_name = format!("{}-{}", base_name, duplicate_index);
            duplicate_index += 1;
        }
        let target = staging_dir.join(&staged_name);

        if source.is_dir() {
            // Directory → junction from staging → source (zero-copy, like Rose)
            if !crate::junction::is_junction(&target) {
                crate::junction::create_junction(&source, &target)?;
            }
        } else if is_zip_like_mod(&source) {
            // ZIP/fantome → extract directly to staging (like Rose extract_zip_to_mod)
            std::fs::create_dir_all(&target)
                .map_err(|e| format!("No pude crear carpeta de extraccion: {}", e))?;
            crate::junction::extract_zip_to_dir(&source, &target)?;
        } else if is_wad_mod(&source) {
            // WAD → copy (single file, small)
            std::fs::create_dir_all(&target)
                .map_err(|e| format!("No pude crear carpeta WAD para mod-tools: {}", e))?;
            std::fs::copy(&source, target.join(&original_name))
                .map_err(|e| format!("No pude preparar WAD para mod-tools: {}", e))?;
        } else {
            std::fs::create_dir_all(&target)
                .map_err(|e| format!("No pude crear carpeta para mod-tools: {}", e))?;
            std::fs::copy(&source, target.join(&original_name))
                .map_err(|e| format!("No pude copiar mod para mod-tools: {}", e))?;
        }
        staged_paths.push(target.to_string_lossy().to_string());
    }

    Ok(Some(staged_paths))
}

fn is_zip_like_mod(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_lowercase();
    lower.ends_with(".zip") || lower.ends_with(".fantome")
}

fn is_wad_mod(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_lowercase();
    lower.ends_with(".wad") || lower.ends_with(".wad.client")
}

fn sanitize_mod_folder_name(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .to_string();
    if sanitized.is_empty() {
        "mod".to_string()
    } else {
        sanitized
    }
}

fn build_mkoverlay_args(
    sidecar_path: &str,
    game_folder: &str,
    overlay_path: &str,
    state_path: &str,
    mod_paths: &[String],
) -> Vec<String> {
    if is_mod_tools(sidecar_path) {
        let mod_names: Vec<String> = mod_paths
            .iter()
            .filter_map(|p| {
                Path::new(p)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
            })
            .collect();
        // Use staging dir as mods_dir (all mods are staged there by prepare_mkoverlay_mods)
        let mods_dir = PathBuf::from(state_path)
            .join("mod-tools-mods")
            .to_string_lossy()
            .to_string();
        return vec![
            "mkoverlay".to_string(),
            mods_dir,
            overlay_path.to_string(),
            format!("--game:{}", game_folder),
            format!("--mods:{}", mod_names.join("/")),
            "--noTFT".to_string(),
            "--ignoreConflict".to_string(),
        ];
    }

    let mut args = vec![
        "mkoverlay".to_string(),
        "--game".to_string(),
        game_folder.to_string(),
        "--overlay".to_string(),
        overlay_path.to_string(),
        "--state".to_string(),
        state_path.to_string(),
    ];
    for mp in mod_paths {
        args.push("--mod".to_string());
        args.push(mp.clone());
    }
    args
}

pub(crate) fn is_mod_tools(sidecar_path: &str) -> bool {
    Path::new(sidecar_path)
        .file_name()
        .map(|n| n.to_string_lossy().eq_ignore_ascii_case("mod-tools.exe"))
        .unwrap_or(false)
}

// ── Patcher spawn and monitor (matching Electron spawnPatcherAndMonitor) ──

fn is_process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut exit_code: u32 = 0;
        let ret = windows_sys::Win32::System::Threading::GetExitCodeProcess(handle, &mut exit_code);
        CloseHandle(handle);
        if ret == 0 {
            return false;
        }
        // STILL_ACTIVE = 259 (0x103)
        exit_code == 259
    }
}

#[allow(dead_code)]
pub struct PatcherHandle {
    pub pid: u32,
    pub overlay_path: String,
    pub process_exited: Arc<AtomicBool>,
    pub hook_ready: Arc<AtomicBool>,
}

pub fn spawn_patcher_and_monitor(
    sidecar_path: &str,
    dll_path: &str,
    overlay_path: &str,
    flags: &str,
    run_token: &OverlayRunToken,
    _game_path: &str,
    game_release_signal: Option<Arc<AtomicBool>>,
) -> Result<PatcherHandle, String> {
    let uses_mod_tools = is_mod_tools(sidecar_path);
    let args: Vec<String> = if uses_mod_tools {
        let game_folder = PathBuf::from(_game_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let cfg = PathBuf::from(overlay_path).join("cslol-config.json");
        vec![
            "runoverlay".to_string(),
            overlay_path.to_string(),
            cfg.to_string_lossy().to_string(),
            format!("--game:{}", game_folder),
            "--opts:configless".to_string(),
        ]
    } else {
        let bundled_dll = PathBuf::from(dll_path);
        if !bundled_dll.exists() {
            return Err(format!("cslol-dll.dll no encontrada en {}.", dll_path));
        }
        vec![
            "patcher".to_string(),
            "--dll".to_string(),
            dll_path.to_string(),
            "--overlay-root".to_string(),
            overlay_path.to_string(),
            "--flags".to_string(),
            flags.to_string(),
        ]
    };

    append_overlay_log(&format!(
        "Iniciando overlay engine: {} {:?}",
        sidecar_path, args
    ));

    let tools_dir = PathBuf::from(sidecar_path)
        .parent()
        .unwrap_or(std::path::Path::new(""))
        .to_string_lossy()
        .to_string();

    let mut cmd = Command::new(sidecar_path);
    cmd.args(&args)
        .current_dir(&tools_dir)
        .stdin(Stdio::piped());
    // Always pipe stdout to detect hook confirmation and errors (like Rose)
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Error al iniciar patcher: {}", e))?;

    let pid = child.id();
    let stdin_guard = child.stdin.take();
    let hook_ready = Arc::new(AtomicBool::new(false));
    let process_exited = Arc::new(AtomicBool::new(false));

    if uses_mod_tools {
        if let Some(signal) = &game_release_signal {
            signal.store(false, Ordering::SeqCst);
            append_overlay_log(
                "[GameSuspend] runoverlay iniciado; monitor de suspension liberado estilo Rose.",
            );
        }
    }

    // Read stdout for BOTH mod-tools and ltk-manager (like Rose reads patcher output)
    let stdout_stream = match child.stdout.take() {
        Some(s) => s,
        None => {
            return Err("No pude capturar stdout del patcher.".to_string());
        }
    };
    let run_token_clone = run_token.clone();
    let release_signal = game_release_signal.clone();
    let stdout_hook_ready = hook_ready.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout_stream);
        for line in reader.lines() {
            if let Ok(l) = line {
                let text = l.trim().to_string();
                if !text.is_empty() {
                    append_overlay_log(&format!("[PATCHER] {}", text));
                    let lower = text.to_lowercase();
                    if lower.contains("hook applied")
                        || lower.contains("status: waiting for exit")
                        || lower.contains("init in process")
                        || lower.contains("init done")
                        || lower.contains("overlay active")
                    {
                        stdout_hook_ready.store(true, Ordering::SeqCst);
                        if let Some(signal) = &release_signal {
                            signal.store(false, Ordering::SeqCst);
                        }
                    }
                    if lower.contains("end of life reached")
                        || lower.contains("eol_timestamp")
                        || lower.contains("timestamp > eol")
                    {
                        append_overlay_log("DLL vencida detectada (End of life reached). Reemplaza cslol-dll.dll manualmente.");
                        run_token_clone.cancel("DLL vencida (EOL)");
                    }
                    // Detect errors from mod-tools
                    if lower.contains("error")
                        || lower.contains("failed")
                        || lower.contains("not found")
                    {
                        append_overlay_log(&format!("[PATCHER ERROR] {}", text));
                    }
                }
            }
        }
    });

    let stderr_stream = match child.stderr.take() {
        Some(s) => s,
        None => {
            append_overlay_log("[PATCHER] Advertencia: no pude capturar stderr del patcher.");
            // Continue without stderr — stdout monitoring is sufficient
            return Ok(PatcherHandle {
                pid,
                overlay_path: overlay_path.to_string(),
                process_exited,
                hook_ready,
            });
        }
    };
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr_stream);
        for line in reader.lines() {
            if let Ok(l) = line {
                let text = l.trim().to_string();
                if !text.is_empty() {
                    append_overlay_log(&format!("[PATCHER:err] {}", text));
                }
            }
        }
    });

    // Wait for hook confirmation from stdout OR timeout (like Rose)
    let hook_wait_start = std::time::Instant::now();
    let hook_timeout = Duration::from_secs(10);
    while hook_wait_start.elapsed() < hook_timeout {
        if hook_ready.load(Ordering::SeqCst) {
            break;
        }
        if run_token.is_canceled() {
            let _ = child.kill();
            return Err("Ejecucion cancelada por el usuario.".to_string());
        }
        // Check if process exited early via Win32 API (like Rose)
        if !is_process_alive(pid) {
            return Err("El patcher salio antes de tiempo.".to_string());
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    if !hook_ready.load(Ordering::SeqCst) {
        // No confirmation from stdout, but process is alive — assume hook applied
        // (mod-tools runoverlay may not output confirmation text)
        append_overlay_log(
            "Runner iniciado, pero la DLL aun no confirmo el hook; estado=esperando.",
        );
    }

    // Spawn process exit monitor (child moved here, no longer needed in handle)
    let exit_monitor = process_exited.clone();
    std::thread::spawn(move || {
        let _keep_stdin_open = stdin_guard;
        let status = child.wait();
        let code = status
            .ok()
            .and_then(|s| s.code().map(|c| c.to_string()))
            .unwrap_or_else(|| "signal?".to_string());
        exit_monitor.store(true, Ordering::SeqCst);
        append_overlay_log(&format!("Patcher proceso terminado. exit_code={}", code));
    });

    append_overlay_log(&format!("Patcher activo. PID: {}", pid));
    Ok(PatcherHandle {
        pid,
        overlay_path: overlay_path.to_string(),
        process_exited,
        hook_ready,
    })
}

pub fn stop_patcher(pid: u32, _overlay_path: &str) {
    if !is_process_alive(pid) {
        return;
    }
    append_overlay_log(&format!("Deteniendo runner anterior pid={}", pid));
    let _ = hidden_command("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output();

    let deadline = Instant::now() + Duration::from_secs(5);
    while is_process_alive(pid) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    if is_process_alive(pid) {
        append_overlay_log(&format!(
            "Advertencia: runner pid={} no termino dentro de 5s",
            pid
        ));
    } else {
        append_overlay_log(&format!("Runner anterior pid={} detenido", pid));
    }
}

/// Kill orphaned Rose/mod-tools runners that are no longer represented in
/// AppState (for example after an app crash). Only `mod-tools.exe` processes
/// whose command line contains the `runoverlay` verb are affected.
pub fn kill_all_runoverlay_processes() -> u32 {
    let script = r#"$targets = @(Get-CimInstance Win32_Process -Filter "Name = 'mod-tools.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '(?i)(^|\s)runoverlay(\s|$)' }); $count = $targets.Count; foreach ($target in $targets) { Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Output $count"#;
    let output = hidden_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output();
    let count = output
        .ok()
        .and_then(|value| String::from_utf8(value.stdout).ok())
        .and_then(|value| value.trim().lines().last()?.trim().parse::<u32>().ok())
        .unwrap_or(0);
    if count > 0 {
        append_overlay_log(&format!(
            "Limpieza Rose: {} proceso(s) runoverlay huerfano(s) detenido(s).",
            count
        ));
    }
    count
}

// ── Path resolution ──

pub fn resolve_league_game_executable(selected_path: &str) -> Result<String, String> {
    let target = selected_path.trim().to_string();
    if target.is_empty() {
        return Err("Configura League of Legends.exe antes de importar.".to_string());
    }

    let target_path = PathBuf::from(&target);
    let filename = target_path
        .file_name()
        .map(|f| f.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let candidates = if target_path.is_dir() {
        if filename == "game" {
            vec![target_path
                .join("League of Legends.exe")
                .to_string_lossy()
                .to_string()]
        } else {
            vec![target_path
                .join("Game")
                .join("League of Legends.exe")
                .to_string_lossy()
                .to_string()]
        }
    } else {
        if !target.to_lowercase().ends_with(".exe") {
            return Err("Configura League of Legends.exe antes de importar.".to_string());
        }

        let parent = target_path
            .parent()
            .unwrap_or(std::path::Path::new(""))
            .to_path_buf();
        if filename == "leagueclient.exe" {
            vec![parent
                .join("Game")
                .join("League of Legends.exe")
                .to_string_lossy()
                .to_string()]
        } else {
            vec![
                target.clone(),
                parent
                    .join("Game")
                    .join("League of Legends.exe")
                    .to_string_lossy()
                    .to_string(),
            ]
        }
    };

    for candidate in &candidates {
        let p = PathBuf::from(candidate);
        if p.is_file()
            && p.file_name().map(|f| f.to_string_lossy().to_lowercase())
                == Some("league of legends.exe".to_string())
        {
            return Ok(candidate.clone());
        }
    }

    Err("Selecciona el ejecutable del juego: ...\\League of Legends\\Game\\League of Legends.exe, no LeagueClient.exe.".to_string())
}

const ENGINE_BINARIES: &[&str] = &["mod-tools.exe", "ltk-manager.exe"];

fn try_engine_in_dir(dir: &Path) -> Option<String> {
    for bin in ENGINE_BINARIES {
        let candidate = dir.join(bin);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

pub fn resolve_hitori_engine(selected_path: &str, app_data_dir: &str) -> Result<String, String> {
    let target = selected_path.to_string();
    let mut candidates = Vec::new();

    if !target.is_empty() {
        let target_path = PathBuf::from(&target);
        let basename = target_path
            .file_name()
            .map(|f| f.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let is_valid = ENGINE_BINARIES.iter().any(|b| *b == basename);
        if is_valid {
            candidates.push(target.clone());
        }
        candidates.push(
            target_path
                .join("ltk-manager.exe")
                .to_string_lossy()
                .to_string(),
        );
        candidates.push(
            target_path
                .join("mod-tools.exe")
                .to_string_lossy()
                .to_string(),
        );
        let parent = target_path
            .parent()
            .unwrap_or(std::path::Path::new(""))
            .to_path_buf();
        candidates.push(parent.join("ltk-manager.exe").to_string_lossy().to_string());
        candidates.push(parent.join("mod-tools.exe").to_string_lossy().to_string());
    }

    for candidate in &candidates {
        if PathBuf::from(candidate).exists() {
            return Ok(candidate.clone());
        }
    }

    let engine_dir = PathBuf::from(app_data_dir).join("engine").join("tools");
    if let Some(found) = try_engine_in_dir(&engine_dir) {
        return Ok(found);
    }

    Err("No se encontro el engine (mod-tools.exe o ltk-manager.exe) en engine/tools.".to_string())
}

// ── Archive inspection ──

pub fn inspect_archive(file_path: &str) -> Result<serde_json::Value, String> {
    let ext = get_mod_package_extension(file_path);

    if ext == ".wad" || ext == ".wad.client" {
        let meta =
            std::fs::metadata(file_path).map_err(|e| format!("Error reading metadata: {}", e))?;
        let suspicious = meta.len() > 0 && meta.len() < SUSPICIOUS_WAD_SIZE;
        return Ok(serde_json::json!({
            "wadCount": 1,
            "maxWadSize": meta.len(),
            "suspicious": suspicious,
            "targetWads": [PathBuf::from(file_path).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()],
            "targetSkinNums": [],
        }));
    }

    if ext != ".zip" && ext != ".fantome" {
        return Ok(serde_json::json!({}));
    }

    let file = std::fs::File::open(file_path).map_err(|e| format!("Error opening: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Error reading zip: {}", e))?;

    let mut wad_count = 0u32;
    let mut max_wad_size = 0u64;
    let mut has_meta_info = false;
    let mut has_meta_details = false;
    let mut has_wad_folder = false;
    let mut target_wads: Vec<String> = Vec::new();
    let mut target_skin_nums: Vec<u64> = Vec::new();

    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("Error reading entry: {}", e))?;
        let name = entry.name().to_lowercase().replace('\\', "/");

        if name == "meta/info.json" {
            has_meta_info = true;
        }
        if name == "meta/details.json" {
            has_meta_details = true;
        }
        if name.starts_with("wad/") {
            has_wad_folder = true;
        }

        if let Some(wad) = name
            .split('/')
            .find(|p| p.ends_with(".wad") || p.ends_with(".wad.client"))
        {
            if !target_wads.contains(&wad.to_string()) {
                target_wads.push(wad.to_string());
            }
        }

        if name.contains(".wad") || name.contains(".wad.client") {
            wad_count += 1;
            if entry.size() > max_wad_size {
                max_wad_size = entry.size();
            }
        }

        if let Some(cap) = name.split('/').find_map(|p| {
            let re = regex_lite::Regex::new(r"skins/skin(\d+)").ok()?;
            re.captures(p).and_then(|c| c.get(1))
        }) {
            let num: u64 = cap.as_str().parse().unwrap_or(0);
            if num > 0 && !target_skin_nums.contains(&num) {
                target_skin_nums.push(num);
            }
        }
    }

    let suspicious = wad_count > 0 && max_wad_size > 0 && max_wad_size < SUSPICIOUS_WAD_SIZE;

    target_wads.sort();
    target_skin_nums.sort();

    Ok(serde_json::json!({
        "wadCount": wad_count,
        "maxWadSize": max_wad_size,
        "suspicious": suspicious,
        "hasMetaInfo": has_meta_info,
        "hasMetaDetails": has_meta_details,
        "hasWadFolder": has_wad_folder,
        "targetWads": target_wads,
        "targetSkinNums": target_skin_nums,
    }))
}

pub fn download_url(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e: reqwest::Error| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("Error downloading: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let bytes = response
        .bytes()
        .map_err(|e| format!("Error reading: {}", e))?;
    Ok(bytes.to_vec())
}

#[allow(dead_code)]
pub fn download_and_extract_zip(url: &str, extract_to: &str) -> Result<(), String> {
    let data = download_url(url)?;
    let temp_zip = PathBuf::from(extract_to).join("download.zip");
    std::fs::create_dir_all(extract_to).map_err(|e| format!("Error creating dir: {}", e))?;
    std::fs::write(&temp_zip, &data).map_err(|e| format!("Error writing zip: {}", e))?;

    let file = std::fs::File::open(&temp_zip).map_err(|e| format!("Error opening zip: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Error reading zip: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Error reading entry: {}", e))?;
        let name = entry.name().to_string();
        let out_path = PathBuf::from(extract_to).join(&name);
        if name.ends_with('/') {
            std::fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&out_path)
                .map_err(|e| format!("Error creating file: {}", e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Error extracting: {}", e))?;
        }
    }

    std::fs::remove_file(&temp_zip).ok();
    Ok(())
}

pub fn ensure_game_hashtable(app_data_dir: &str) -> Result<String, String> {
    let hashtable_path = PathBuf::from(app_data_dir)
        .join("hashtable")
        .join("hashes.game.txt");

    if hashtable_path.exists()
        && std::fs::metadata(&hashtable_path)
            .map(|m| m.len())
            .unwrap_or(0)
            > 10 * 1024 * 1024
    {
        return Ok(hashtable_path.to_string_lossy().to_string());
    }

    std::fs::create_dir_all(hashtable_path.parent().unwrap()).ok();
    let url = "https://raw.communitydragon.org/data/hashes/lol/hashes.game.txt";
    let data = download_url(url)?;
    std::fs::write(&hashtable_path, &data)
        .map_err(|e| format!("Error writing hashtable: {}", e))?;
    Ok(hashtable_path.to_string_lossy().to_string())
}

pub fn execute_fantonize(
    sidecar_path: &str,
    wad_path: &str,
    champion_key: &str,
    skin_num: u64,
    output_dir: &str,
    hashtable_path: &str,
) -> Result<String, String> {
    let request = serde_json::json!({
        "wadPath": wad_path,
        "champion": champion_key,
        "items": [{
            "skinNumber": skin_num,
            "fileLabel": format!("{}_{}", champion_key, skin_num),
            "displayName": format!("skin{}", skin_num),
        }],
        "outputDir": output_dir,
        "author": "Rift Atlas",
        "hashtablePath": hashtable_path,
        "petNames": [],
    });

    let tools_dir = PathBuf::from(sidecar_path)
        .parent()
        .unwrap_or(std::path::Path::new(""))
        .to_string_lossy()
        .to_string();
    let request_json =
        serde_json::to_string(&request).map_err(|e| format!("Error serializing: {}", e))?;

    let args = vec![
        "fantonize".to_string(),
        "--request-json".to_string(),
        "-".to_string(),
    ];

    match exec_tool_with_timeout(
        sidecar_path,
        &args,
        480_000,
        &tools_dir,
        &OverlayRunToken::new(),
        Some(&request_json),
    ) {
        Ok(stdout) => {
            let trimmed = stdout.trim();
            let results: Vec<serde_json::Value> = serde_json::from_str(trimmed)
                .map_err(|e| format!("fantonize no devolvio JSON: {}", e))?;

            let written = results
                .iter()
                .find(|r| r.get("success").and_then(|v| v.as_bool()) == Some(true));
            match written {
                Some(item) => {
                    let path = item
                        .get("outputPath")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    Ok(path.to_string())
                }
                None => {
                    let error = results
                        .first()
                        .and_then(|r| r.get("error").and_then(|v| v.as_str()))
                        .unwrap_or("sin detalle");
                    Err(format!("fantonize no pudo generar: {}", error))
                }
            }
        }
        Err(e) => Err(format!("fantonize fallo: {}", e)),
    }
}

#[allow(dead_code)]
pub fn dll_source_metadata_path(app_data_dir: &str) -> String {
    PathBuf::from(app_data_dir)
        .join("dll-source-metadata.json")
        .to_string_lossy()
        .to_string()
}

#[allow(dead_code)]
pub fn read_dll_source_metadata(app_data_dir: &str) -> Option<serde_json::Value> {
    let path = dll_source_metadata_path(app_data_dir);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

#[allow(dead_code)]
pub fn write_dll_source_metadata(app_data_dir: &str, metadata: &serde_json::Value) {
    let path = dll_source_metadata_path(app_data_dir);
    if let Some(parent) = PathBuf::from(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let meta = metadata.clone();
    if let Some(obj) = meta.as_object() {
        let mut map = obj.clone();
        map.insert(
            "downloadedAt".to_string(),
            serde_json::json!(chrono::Utc::now().to_rfc3339()),
        );
        if let Ok(content) = serde_json::to_string_pretty(&serde_json::Value::Object(map)) {
            let _ = std::fs::write(&path, content);
        }
    }
}
