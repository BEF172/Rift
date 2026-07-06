use std::path::PathBuf;
use std::sync::OnceLock;

fn config_file_path() -> PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let dir = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| crate::install_dir());
        let config_dir = dir.join("Rift Atlas");
        std::fs::create_dir_all(&config_dir).ok();
        config_dir.join("config.ini")
    })
    .clone()
}

fn read_ini() -> ini::Ini {
    let path = config_file_path();
    ini::Ini::load_from_file(&path).unwrap_or_else(|_| ini::Ini::new())
}

fn write_ini(ini: &ini::Ini) {
    let path = config_file_path();
    let _ = ini.write_to_file(&path);
}

pub fn load_league_path() -> Option<String> {
    let ini = read_ini();
    ini.section(Some("General"))
        .and_then(|s| s.get("leaguePath"))
        .filter(|v| !v.trim().is_empty())
        .map(|v| v.to_string())
}

pub fn load_client_path() -> Option<String> {
    let ini = read_ini();
    ini.section(Some("General"))
        .and_then(|s| s.get("clientPath"))
        .filter(|v| !v.trim().is_empty())
        .map(|v| v.to_string())
}

pub fn save_league_path(path: &str) {
    let mut ini = read_ini();
    ini.with_section(Some("General")).set("leaguePath", path);
    write_ini(&ini);
}

pub fn save_client_path(path: &str) {
    let mut ini = read_ini();
    ini.with_section(Some("General")).set("clientPath", path);
    write_ini(&ini);
}

pub fn save_paths(league_path: &str, client_path: &str) {
    let mut ini = read_ini();
    ini.with_section(Some("General"))
        .set("leaguePath", league_path)
        .set("clientPath", client_path);
    write_ini(&ini);
}

pub fn load_injection_threshold() -> f64 {
    let mut ini = read_ini();
    let raw_value = ini
        .section(Some("General"))
        .and_then(|s| s.get("injection_threshold"))
        .map(|v| v.trim().to_string());
    let migrated_rose_default = ini
        .section(Some("General"))
        .and_then(|s| s.get("injection_threshold_rose_default_migrated"))
        .map(|v| v == "1")
        .unwrap_or(false);

    if !migrated_rose_default && matches!(raw_value.as_deref(), Some("0.5" | "0.50")) {
        ini.with_section(Some("General"))
            .set("injection_threshold", "0.30")
            .set("injection_threshold_rose_default_migrated", "1");
        write_ini(&ini);
        return 0.3;
    }

    raw_value
        .as_deref()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| *v >= 0.0)
        .unwrap_or(0.3)
}

pub fn save_injection_threshold(value: f64) {
    let mut ini = read_ini();
    ini.with_section(Some("General"))
        .set("injection_threshold", &format!("{:.2}", value))
        .set("injection_threshold_rose_default_migrated", "1");
    write_ini(&ini);
}

pub fn load_auto_resume_timeout() -> u64 {
    let ini = read_ini();
    ini.section(Some("General"))
        .and_then(|s| s.get("auto_resume_timeout"))
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v >= 1 && *v <= 180)
        .unwrap_or(60)
}

pub fn save_auto_resume_timeout(value: u64) {
    let mut ini = read_ini();
    ini.with_section(Some("General"))
        .set("auto_resume_timeout", &value.to_string());
    write_ini(&ini);
}

pub fn infer_client_path_from_league_path(league_path: &str) -> Option<String> {
    let path = PathBuf::from(league_path.trim());
    if path
        .file_name()
        .map(|name| {
            name.to_string_lossy()
                .eq_ignore_ascii_case("League of Legends.exe")
        })
        .unwrap_or(false)
    {
        let game_dir = path.parent()?;
        let client_dir = game_dir.parent()?;
        if client_dir.join("LeagueClient.exe").exists() {
            return Some(client_dir.to_string_lossy().to_string());
        }
    }

    if path
        .file_name()?
        .to_string_lossy()
        .eq_ignore_ascii_case("Game")
    {
        let client_dir = path.parent()?;
        if client_dir.join("LeagueClient.exe").exists() {
            return Some(client_dir.to_string_lossy().to_string());
        }
    }

    if path.join("LeagueClient.exe").exists() {
        return Some(path.to_string_lossy().to_string());
    }

    let parent = path.parent()?;
    if parent
        .file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case("Game"))
        .unwrap_or(false)
    {
        let client_dir = parent.parent()?;
        if client_dir.join("LeagueClient.exe").exists() {
            return Some(client_dir.to_string_lossy().to_string());
        }
    }

    if parent.join("LeagueClient.exe").exists() {
        Some(parent.to_string_lossy().to_string())
    } else {
        None
    }
}

pub fn infer_game_dir_from_league_path(league_path: &str) -> Option<String> {
    let path = PathBuf::from(league_path.trim());
    if path
        .file_name()
        .map(|name| {
            name.to_string_lossy()
                .eq_ignore_ascii_case("League of Legends.exe")
        })
        .unwrap_or(false)
    {
        let game_dir = path.parent()?;
        if game_dir.join("League of Legends.exe").exists() {
            return Some(game_dir.to_string_lossy().to_string());
        }
    }

    if path
        .file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case("Game"))
        .unwrap_or(false)
        && path.join("League of Legends.exe").exists()
    {
        return Some(path.to_string_lossy().to_string());
    }

    let game_dir = path.join("Game");
    if game_dir.join("League of Legends.exe").exists() {
        return Some(game_dir.to_string_lossy().to_string());
    }
    None
}
