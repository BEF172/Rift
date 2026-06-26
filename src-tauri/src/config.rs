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
