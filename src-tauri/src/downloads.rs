use std::path::PathBuf;

const LTK_REPO_API: &str = "https://api.github.com/repos/LeagueToolkit/ltk-manager/releases/latest";
#[allow(dead_code)]
const CSLOL_REPO_API: &str =
    "https://api.github.com/repos/LeagueToolkit/cslol-manager/releases/latest";
const HITORI_RELEASE_API: &str =
    "https://api.github.com/repos/hitori-rebocchi/hitori-bocchi/releases/latest";
const LEAGUE_SKINS_REPO_API: &str = "https://api.github.com/repos/Alban1911/LeagueSkins";
const ROSE_PENGU_REPO_API: &str = "https://api.github.com/repos/Tariolle/ROSE-Pengu";
const MOD_PACKAGE_EXTENSIONS: &[&str] = &[".fantome", ".zip", ".wad", ".wad.client", ".rse"];

fn github_api_get(url: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e: reqwest::Error| e.to_string())?;
    let response = client
        .get(url)
        .header("User-Agent", "RiftAtlas")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .map_err(|e| format!("Error fetching {}: {}", url, e))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} fetching {}", response.status(), url));
    }
    response
        .json()
        .map_err(|e| format!("Error parsing JSON: {}", e))
}

fn download_file_with_progress<F>(url: &str, dest: &str, mut on_progress: F) -> Result<(), String>
where
    F: FnMut(u64, Option<u64>),
{
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e: reqwest::Error| e.to_string())?;
    let mut response = client
        .get(url)
        .header("User-Agent", "RiftAtlas")
        .send()
        .map_err(|e| format!("Error downloading: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} downloading {}", response.status(), url));
    }
    if let Some(parent) = PathBuf::from(dest).parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let total = response.content_length();
    let mut file =
        std::fs::File::create(dest).map_err(|e| format!("Error creating file: {}", e))?;
    let mut downloaded = 0u64;
    let mut buffer = [0u8; 256 * 1024];

    loop {
        let read = std::io::Read::read(&mut response, &mut buffer)
            .map_err(|e| format!("Error reading download: {}", e))?;
        if read == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buffer[..read])
            .map_err(|e| format!("Error writing file: {}", e))?;
        downloaded += read as u64;
        on_progress(downloaded, total);
    }

    Ok(())
}

fn download_file(url: &str, dest: &str) -> Result<(), String> {
    download_file_with_progress(url, dest, |_, _| {})
}

fn extract_zip_simple(zip_path: &str, dest: &str) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("Error opening zip: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Error reading zip: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Error reading entry: {}", e))?;
        let name = entry.name().to_string();
        if name.is_empty() {
            continue;
        }
        let out_path = PathBuf::from(dest).join(&name);
        // Zip-slip protection: skip entries that escape dest directory
        if !out_path.starts_with(dest) {
            continue;
        }
        if name.ends_with('/') {
            std::fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&out_path)
                .map_err(|e| format!("Error creating {:?}: {}", out_path, e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Error extracting: {}", e))?;
        }
    }

    std::fs::remove_file(zip_path).ok();
    Ok(())
}

fn extract_7z_or_sfx(archive_path: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    const SEVENZ_MAGIC: &[u8] = b"7z\xBC\xAF\x27\x1C";

    std::fs::create_dir_all(dest).map_err(|e| format!("Error creating extract dir: {}", e))?;

    let data = std::fs::read(archive_path)
        .map_err(|e| format!("Error reading archive {:?}: {}", archive_path, e))?;
    let offset = data
        .windows(SEVENZ_MAGIC.len())
        .position(|window| window == SEVENZ_MAGIC)
        .ok_or_else(|| format!("No encontre firma 7z dentro de {:?}", archive_path))?;

    let extract_source = if offset == 0 {
        archive_path.to_path_buf()
    } else {
        let temp_7z = archive_path.with_extension("inner.7z");
        std::fs::write(&temp_7z, &data[offset..])
            .map_err(|e| format!("Error writing inner 7z {:?}: {}", temp_7z, e))?;
        temp_7z
    };

    let result = sevenz_rust2::decompress_file(&extract_source, dest)
        .map_err(|e| format!("Error extrayendo {:?}: {}", archive_path, e));

    if extract_source != archive_path {
        std::fs::remove_file(&extract_source).ok();
    }

    result
}

fn find_file_recursive(root: &str, filename: &str) -> Option<String> {
    let mut queue = vec![PathBuf::from(root)];
    let mut seen = 0u32;

    while let Some(dir) = queue.pop() {
        if seen > 20000 {
            break;
        }
        let entries = std::fs::read_dir(&dir).ok()?;
        for entry in entries.flatten() {
            seen += 1;
            let path = entry.path();
            if path.is_file()
                && path.file_name().map(|f| f.to_string_lossy().to_lowercase())
                    == Some(filename.to_lowercase())
            {
                return Some(path.to_string_lossy().to_string());
            }
            if path.is_dir() {
                let name = path
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();
                if ![
                    "node_modules",
                    ".git",
                    "AppData",
                    "Windows",
                    "Program Files",
                    "Program Files (x86)",
                ]
                .contains(&name.as_str())
                {
                    queue.push(path);
                }
            }
        }
    }
    None
}

fn copy_engine_binary(source_engine: &PathBuf, engine_dir: &PathBuf) -> Result<PathBuf, String> {
    let installed_engine = engine_dir.join("ltk-manager.exe");
    std::fs::copy(source_engine, &installed_engine)
        .map_err(|e| format!("Error copying engine: {}", e))?;
    Ok(installed_engine)
}

fn install_setup_to_temp(
    setup_path: &PathBuf,
    temp_dir: &PathBuf,
    on_progress: &mut impl FnMut(serde_json::Value),
) -> Result<PathBuf, String> {
    let install_dir = temp_dir.join("silent-install");
    std::fs::remove_dir_all(&install_dir).ok();
    std::fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Error creating silent install dir: {}", e))?;

    let destination_arg = format!("/D={}", install_dir.to_string_lossy());

    on_progress(serde_json::json!({
        "type": "engine",
        "message": "Iniciando instalador silencioso del engine...",
        "percent": 66,
    }));

    let mut child = std::process::Command::new(setup_path)
        .args(["/S", &destination_arg])
        .spawn()
        .map_err(|e| format!("Error ejecutando instalador silencioso: {}", e))?;

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
    let mut last_percent = 66u64;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(format!("Instalador silencioso fallo con exit={}", status));
                }
                break;
            }
            Ok(None) => {}
            Err(e) => {
                return Err(format!("Error esperando instalador silencioso: {}", e));
            }
        }

        let elapsed = std::time::Instant::now();
        if elapsed >= deadline {
            let _ = child.kill();
            return Err("Tiempo de espera agotado para el instalador silencioso.".to_string());
        }

        if let Some(found) = find_file_recursive(&install_dir.to_string_lossy(), "ltk-manager.exe")
        {
            let _ = child.kill();
            return Ok(PathBuf::from(found));
        }

        let elapsed_secs =
            (std::time::Instant::now() - (deadline - std::time::Duration::from_secs(90))).as_secs();
        let percent = 66u64 + ((elapsed_secs as f64 / 90.0) * 14.0).round() as u64;
        let percent = percent.min(80).max(last_percent);
        if percent != last_percent {
            last_percent = percent;
            on_progress(serde_json::json!({
                "type": "engine",
                "message": format!("Instalando engine en modo silencioso... ({}s)", elapsed_secs),
                "percent": percent,
            }));
        }

        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    on_progress(serde_json::json!({
        "type": "engine",
        "message": "Instalador completado. Buscando engine...",
        "percent": 80,
    }));

    let poll_deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        if let Some(found) = find_file_recursive(&install_dir.to_string_lossy(), "ltk-manager.exe")
        {
            on_progress(serde_json::json!({
                "type": "engine",
                "message": "Engine encontrado tras instalacion silenciosa.",
                "percent": 82,
            }));
            return Ok(PathBuf::from(found));
        }
        if std::time::Instant::now() >= poll_deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    Err(format!(
        "No encontre ltk-manager.exe tras instalar el setup en modo silencioso."
    ))
}

// Public API

pub fn download_hitori_engine<F>(
    app_data_dir: &str,
    _engine_binary: &str,
    mut on_progress: F,
) -> Result<serde_json::Value, String>
where
    F: FnMut(serde_json::Value),
{
    let release = github_api_get(HITORI_RELEASE_API)?;
    let assets = release["assets"]
        .as_array()
        .ok_or("El release del engine no tiene assets.")?;
    let zip_asset = assets.iter().find(|a| {
        a["name"]
            .as_str()
            .map(|n| {
                let name = n.to_lowercase();
                name.contains("win-unpacked") && name.ends_with(".zip")
            })
            .unwrap_or(false)
    });
    let setup_asset = assets.iter().find(|a| {
        a["name"]
            .as_str()
            .map(|n| n.to_lowercase().ends_with("-setup.exe"))
            .unwrap_or(false)
    });
    let asset = zip_asset
        .or(setup_asset)
        .ok_or("No encontre win-unpacked.zip ni setup.exe del engine en el ultimo release.")?;

    let asset_name = asset["name"].as_str().unwrap_or("setup.exe");
    let download_url = asset["browser_download_url"]
        .as_str()
        .ok_or("No download URL")?;
    let version = release["tag_name"]
        .as_str()
        .or_else(|| release["name"].as_str())
        .unwrap_or("sin version");

    let engine_dir = PathBuf::from(app_data_dir).join("engine").join("tools");
    std::fs::create_dir_all(&engine_dir)
        .map_err(|e| format!("Error creating engine/tools dir: {}", e))?;

    let temp_dir = PathBuf::from(std::env::temp_dir()).join("rift-atlas-hitori-download");
    std::fs::remove_dir_all(&temp_dir).ok();
    std::fs::create_dir_all(&temp_dir).ok();

    let download_path = temp_dir.join(asset_name);
    download_file_with_progress(
        download_url,
        &download_path.to_string_lossy(),
        |downloaded, total| {
            let percent = total
                .filter(|value| *value > 0)
                .map(|value| ((downloaded as f64 / value as f64) * 45.0).round() as u64)
                .unwrap_or(0);
            on_progress(serde_json::json!({
                "type": "engine",
                "message": "Descargando engine...",
                "percent": percent.min(45),
                "downloaded": downloaded,
                "total": total,
            }));
        },
    )?;

    let installed_dll = engine_dir.join("cslol-dll.dll");
    let preserved_dll = temp_dir.join("preserved-cslol-dll.dll");
    let had_custom_dll = std::fs::copy(&installed_dll, &preserved_dll).is_ok();
    let source_engine = if asset_name.to_lowercase().ends_with(".zip") {
        let extract_dir = temp_dir.join("zip");
        std::fs::create_dir_all(&extract_dir).ok();
        on_progress(serde_json::json!({
            "type": "engine",
            "message": "Extrayendo engine desempaquetado...",
            "percent": 60,
        }));
        extract_zip_simple(
            &download_path.to_string_lossy(),
            &extract_dir.to_string_lossy(),
        )?;
        find_file_recursive(&extract_dir.to_string_lossy(), "ltk-manager.exe")
            .map(PathBuf::from)
            .ok_or("No encontre ltk-manager.exe dentro del zip win-unpacked del engine.")?
    } else {
        let setup_extract_dir = temp_dir.join("setup");
        std::fs::create_dir_all(&setup_extract_dir).ok();

        on_progress(serde_json::json!({
            "type": "engine",
            "message": "Extrayendo setup del engine...",
            "percent": 50,
        }));
        let setup_extract_result = extract_7z_or_sfx(&download_path, &setup_extract_dir);

        let app_archive = setup_extract_dir.join("$PLUGINSDIR").join("app-64.7z");
        if setup_extract_result.is_err() || !app_archive.exists() {
            on_progress(serde_json::json!({
                "type": "engine",
                "message": "Extraccion directa no disponible; instalando engine en modo silencioso...",
                "percent": 65,
            }));
            install_setup_to_temp(&download_path, &temp_dir, &mut on_progress)?
        } else {
            let app_extract_dir = setup_extract_dir.join("$PLUGINSDIR").join("app");
            std::fs::create_dir_all(&app_extract_dir).ok();
            on_progress(serde_json::json!({
                "type": "engine",
                "message": "Extrayendo app del engine...",
                "percent": 70,
            }));
            extract_7z_or_sfx(&app_archive, &app_extract_dir)?;

            let engine_path = app_extract_dir.join("resources").join("ltk-manager.exe");
            if !engine_path.exists() {
                return Err(
                    "No encontre el sidecar resources\\ltk-manager.exe dentro del engine."
                        .to_string(),
                );
            }
            engine_path
        }
    };

    std::fs::remove_dir_all(&engine_dir).ok();
    std::fs::create_dir_all(&engine_dir)
        .map_err(|e| format!("Error creating engine/tools dir: {}", e))?;
    let installed_engine = copy_engine_binary(&source_engine, &engine_dir)?;

    if had_custom_dll {
        std::fs::copy(&preserved_dll, &installed_dll).ok();
    }

    std::fs::write(
        PathBuf::from(app_data_dir).join("engine-version.txt"),
        version,
    )
    .ok();
    std::fs::remove_dir_all(&temp_dir).ok();

    let dll_installed = installed_dll.exists();

    Ok(serde_json::json!({
        "version": version,
        "assetName": asset_name,
        "toolsDir": engine_dir.to_string_lossy(),
        "enginePath": installed_engine.to_string_lossy(),
        "dllPath": if dll_installed { installed_dll.to_string_lossy().to_string() } else { String::new() },
        "dllSourceLabel": if dll_installed && had_custom_dll { "DLL custom preservada" } else if dll_installed { "DLL local en carpeta engine" } else { "DLL manual requerida" },
        "dllInstalled": dll_installed,
    }))
}

#[allow(dead_code)]
pub fn download_cslol_dll(_app_data_dir: &str) -> Result<String, String> {
    Err(
        "Rift Atlas no descarga cslol-dll.dll. Copiala manualmente en la carpeta engine/tools."
            .to_string(),
    )
}

pub fn download_cslol_manager_modtools<F>(
    app_data_dir: &str,
    mut on_progress: F,
) -> Result<String, String>
where
    F: FnMut(serde_json::Value),
{
    let engine_dir = PathBuf::from(app_data_dir).join("engine").join("tools");
    std::fs::create_dir_all(&engine_dir).ok();

    let modtools_path = engine_dir.join("mod-tools.exe");
    let ltk_path = engine_dir.join("ltk-manager.exe");
    if modtools_path.exists() && ltk_path.exists() {
        let same_len = std::fs::metadata(&modtools_path).ok().map(|m| m.len())
            == std::fs::metadata(&ltk_path).ok().map(|m| m.len());
        if same_len {
            let _ = std::fs::remove_file(&modtools_path);
        }
    }
    if modtools_path.exists() {
        on_progress(serde_json::json!({
            "type": "engine",
            "message": "mod-tools ya esta instalado.",
            "percent": 100,
        }));
        return Ok(modtools_path.to_string_lossy().to_string());
    }

    on_progress(serde_json::json!({
        "type": "engine",
        "message": "Buscando release de cslol-manager...",
        "percent": 5,
    }));
    let release = github_api_get(CSLOL_REPO_API)?;

    let assets = release["assets"]
        .as_array()
        .ok_or("No se encontraron assets en el release.")?;

    // Priority 1: standalone mod-tools.exe (~1 MB, instant download)
    let direct_asset = assets.iter().find(|a| {
        a["name"]
            .as_str()
            .map(|n| n.eq_ignore_ascii_case("mod-tools.exe"))
            .unwrap_or(false)
    });

    if let Some(asset) = direct_asset {
        let url = asset["browser_download_url"].as_str().ok_or("No download URL")?;
        let size = asset["size"].as_u64().unwrap_or(0);
        on_progress(serde_json::json!({
            "type": "engine",
            "message": format!("Descargando mod-tools.exe ({} KB)...", size / 1024),
            "percent": 10,
        }));
        download_file_with_progress(url, &modtools_path.to_string_lossy(), |downloaded, _| {
            let pct = if size > 0 { (downloaded.saturating_mul(90) / size).min(90) as u8 } else { 50 };
            on_progress(serde_json::json!({
                "type": "engine",
                "message": "Descargando mod-tools.exe...",
                "percent": 10u8.saturating_add(pct),
            }));
        })?;
        on_progress(serde_json::json!({
            "type": "engine",
            "message": "mod-tools.exe instalado.",
            "percent": 100,
        }));
        return Ok(modtools_path.to_string_lossy().to_string());
    }

    // Priority 2: full cslol-manager installer (extract mod-tools from it)
    let installer_asset = assets.iter().find(|a| {
        a["name"]
            .as_str()
            .map(|n| n.to_lowercase().contains("cslol-manager") && n.to_lowercase().ends_with(".exe"))
            .unwrap_or(false)
    })
    .ok_or("No se encontro cslol-manager-windows.exe ni mod-tools.exe en el release.")?;

    let url = installer_asset["browser_download_url"]
        .as_str()
        .ok_or("No download URL")?;
    let temp_dir = PathBuf::from(std::env::temp_dir()).join("rift-atlas-cslol-modtools");
    std::fs::create_dir_all(&temp_dir).ok();
    let setup_path = temp_dir.join("cslol-manager-windows.exe");

    download_file_with_progress(url, &setup_path.to_string_lossy(), |downloaded, total| {
        let percent = total
            .filter(|t| *t > 0)
            .map(|t| 10 + ((downloaded.saturating_mul(60) / t).min(60) as u64))
            .unwrap_or(20) as u8;
        on_progress(serde_json::json!({
            "type": "engine",
            "message": "Descargando mod-tools...",
            "percent": percent,
        }));
    })?;

    let extract_dir = temp_dir.join("extract");
    std::fs::create_dir_all(&extract_dir).ok();
    on_progress(serde_json::json!({
        "type": "engine",
        "message": "Extrayendo mod-tools...",
        "percent": 75,
    }));
    extract_7z_or_sfx(&setup_path, &extract_dir).ok();

    // Extract mod-tools.exe
    let modtools_found = find_file_recursive(&extract_dir.to_string_lossy(), "mod-tools.exe");
    on_progress(serde_json::json!({
        "type": "engine",
        "message": "Instalando mod-tools...",
        "percent": 85,
    }));
    if let Some(ref found) = modtools_found {
        std::fs::copy(found, &modtools_path).ok();
    }

    std::fs::remove_dir_all(&temp_dir).ok();

    if modtools_path.exists() {
        Ok(modtools_path.to_string_lossy().to_string())
    } else if let Some(found) = modtools_found {
        Err(format!("No se pudo copiar mod-tools.exe desde {}", found))
    } else {
        Err("No pude encontrar mod-tools.exe dentro de cslol-manager-windows.exe.".to_string())
    }
}

#[allow(dead_code)]
fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e: reqwest::Error| e.to_string())?;
    let response = client
        .get(url)
        .header("User-Agent", "RiftAtlas")
        .send()
        .map_err(|e| format!("Error downloading: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    response
        .bytes()
        .map(|b| b.to_vec())
        .map_err(|e: reqwest::Error| format!("Error reading: {}", e))
}

pub fn download_league_skins<F>(
    app_data_dir: &str,
    mut on_progress: F,
) -> Result<serde_json::Value, String>
where
    F: FnMut(serde_json::Value),
{
    let repo = github_api_get(LEAGUE_SKINS_REPO_API)?;
    let branch = repo["default_branch"].as_str().unwrap_or("main");
    let download_url = format!(
        "https://codeload.github.com/Alban1911/LeagueSkins/zip/refs/heads/{}",
        branch
    );

    let install_root = PathBuf::from(app_data_dir).join("downloaded-libraries");
    let target_dir = install_root.join("LeagueSkins");

    let sys_temp = std::env::temp_dir().join("rift-atlas-leagueskins");
    let temp_dir = sys_temp;

    std::fs::remove_dir_all(&temp_dir).ok();
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Error creating temp dir: {}", e))?;

    let zip_path = temp_dir.join("LeagueSkins.zip");
    let download_started_at = std::time::Instant::now();
    download_file_with_progress(
        &download_url,
        &zip_path.to_string_lossy(),
        |downloaded, total| {
            let elapsed = download_started_at.elapsed().as_secs_f64().max(0.001);
            let bytes_per_second = (downloaded as f64 / elapsed) as u64;
            let eta_seconds = total
                .filter(|value| *value > downloaded && bytes_per_second > 0)
                .map(|value| (value - downloaded).div_ceil(bytes_per_second));
            let percent = total
                .filter(|value| *value > 0)
                .map(|value| ((downloaded as f64 / value as f64) * 75.0).round() as u64)
                .unwrap_or(0);
            on_progress(serde_json::json!({
                "type": "league-skins",
                "message": "Descargando LeagueSkins...",
                "percent": percent.min(75),
                "downloaded": downloaded,
                "total": total,
                "bytesPerSecond": bytes_per_second,
                "etaSeconds": eta_seconds,
            }));
        },
    )?;

    on_progress(serde_json::json!({
        "type": "league-skins",
        "message": "Extrayendo LeagueSkins...",
        "percent": 78,
    }));

    eprintln!(
        "[LeagueSkins] Extrayendo a target_dir={}",
        target_dir.display()
    );
    std::fs::create_dir_all(&install_root).ok();
    std::fs::remove_dir_all(&target_dir).ok();
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Error creando carpeta destino: {}", e))?;

    {
        let file =
            std::fs::File::open(&zip_path).map_err(|e| format!("Error abriendo zip: {}", e))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Error leyendo zip: {}", e))?;

        let total_entries = archive.len();
        for i in 0..total_entries {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Error leyendo entrada {}: {}", i, e))?;
            let name = entry.name().to_string();
            if name.is_empty() {
                continue;
            }

            let prefix = name.split('/').next().unwrap_or("").to_string();
            let prefix_with_slash = format!("{}/", prefix);

            let relative = if name == prefix_with_slash || name.starts_with(&prefix_with_slash) {
                &name[prefix_with_slash.len()..]
            } else {
                &name
            };

            if relative.is_empty() {
                continue;
            }

            let out_path = target_dir.join(relative);
            if relative.ends_with('/') {
                std::fs::create_dir_all(&out_path).ok();
            } else {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                let mut outfile = std::fs::File::create(&out_path)
                    .map_err(|e| format!("Error creando {:?}: {}", out_path, e))?;
                std::io::copy(&mut entry, &mut outfile)
                    .map_err(|e| format!("Error extrayendo {}: {}", relative, e))?;
            }

            if (i + 1) % 500 == 0 || i + 1 == total_entries {
                let percent = 78 + ((i as f64 / total_entries as f64) * 20.0).round() as u64;
                on_progress(serde_json::json!({
                    "type": "league-skins",
                    "message": format!("Extrayendo LeagueSkins... ({}/{})", i + 1, total_entries),
                    "percent": percent.min(98),
                }));
            }
        }
    }

    std::fs::remove_file(&zip_path).ok();
    std::fs::remove_dir_all(&temp_dir).ok();

    eprintln!("[LeagueSkins] Extraccion completada OK");
    Ok(serde_json::json!({
        "folderPath": target_dir.to_string_lossy(),
        "branch": branch,
    }))
}

const LEAGUE_SKINS_COMPARE_API: &str = "https://api.github.com/repos/Alban1911/LeagueSkins/compare";
const LEAGUE_SKINS_COMMITS_API: &str =
    "https://api.github.com/repos/Alban1911/LeagueSkins/commits/main";
const LEAGUE_SKINS_RAW_BASE: &str = "https://raw.githubusercontent.com/Alban1911/LeagueSkins/main";
const INCREMENTAL_THRESHOLD: usize = 200;

fn get_local_skin_sha(skins_dir: &PathBuf) -> Option<String> {
    let version_file = skins_dir.join(".skin_version");
    std::fs::read_to_string(version_file)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn save_local_skin_sha(skins_dir: &PathBuf, sha: &str) {
    let version_file = skins_dir.join(".skin_version");
    std::fs::write(version_file, sha).ok();
}

fn fetch_remote_skin_sha() -> Option<String> {
    let commit = github_api_get(LEAGUE_SKINS_COMMITS_API).ok()?;
    commit["sha"].as_str().map(|s| s.to_string())
}

#[derive(serde::Deserialize)]
struct GitHubCompareFile {
    filename: String,
    status: String,
    previous_filename: Option<String>,
}

fn get_changed_files(old_sha: &str, new_sha: &str) -> Option<Vec<GitHubCompareFile>> {
    let url = format!("{}/{}...{}", LEAGUE_SKINS_COMPARE_API, old_sha, new_sha);
    let compare = github_api_get(&url).ok()?;
    let files = compare["files"].as_array()?;
    let mut result = Vec::new();
    for f in files {
        if let Some(filename) = f["filename"].as_str() {
            let status = f["status"].as_str().unwrap_or("modified").to_string();
            let previous_filename = f["previous_filename"].as_str().map(|s| s.to_string());
            result.push(GitHubCompareFile {
                filename: filename.to_string(),
                status,
                previous_filename,
            });
        }
    }
    Some(result)
}

fn download_single_file(url: &str, dest: &PathBuf) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    download_file(url, &dest.to_string_lossy())
}

fn download_changed_files(
    changed_files: &[GitHubCompareFile],
    skins_dir: &PathBuf,
    _branch: &str,
    mut on_progress: impl FnMut(usize, usize, &str),
) -> Result<(), String> {
    let total = changed_files.len();
    let mut failures = 0;

    for (i, file) in changed_files.iter().enumerate() {
        on_progress(i + 1, total, &file.filename);

        match file.status.as_str() {
            "removed" => {
                let local_path = skins_dir.join(&file.filename);
                if local_path.exists() {
                    std::fs::remove_file(&local_path).ok();
                }
            }
            "renamed" => {
                if let Some(ref prev) = file.previous_filename {
                    let old_path = skins_dir.join(prev);
                    let new_path = skins_dir.join(&file.filename);
                    if old_path.exists() {
                        if let Some(parent) = new_path.parent() {
                            std::fs::create_dir_all(parent).ok();
                        }
                        std::fs::rename(&old_path, &new_path).ok();
                    }
                }
                // Also download the renamed file to ensure content is correct
                let url = format!("{}/{}", LEAGUE_SKINS_RAW_BASE, file.filename);
                let dest = skins_dir.join(&file.filename);
                if download_single_file(&url, &dest).is_err() {
                    failures += 1;
                }
            }
            "added" | "modified" => {
                let url = format!("{}/{}", LEAGUE_SKINS_RAW_BASE, file.filename);
                let dest = skins_dir.join(&file.filename);
                if download_single_file(&url, &dest).is_err() {
                    failures += 1;
                }
            }
            _ => {}
        }
    }

    // Clean up empty directories left by removed files
    clean_empty_dirs(skins_dir);

    if failures > 0 {
        eprintln!(
            "[LeagueSkins] Incremental update: {} de {} archivos fallaron",
            failures, total
        );
    }
    Ok(())
}

fn clean_empty_dirs(dir: &PathBuf) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        let paths: Vec<PathBuf> = entries.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        for path in paths {
            if path.is_dir() && !path.eq(dir) {
                clean_empty_dirs(&path);
                let is_empty = std::fs::read_dir(&path)
                    .ok()
                    .map(|mut e| e.next().is_none())
                    .unwrap_or(false);
                if is_empty {
                    let _ = std::fs::remove_dir(&path);
                }
            }
        }
    }
}

pub fn download_league_skins_incremental<F>(
    app_data_dir: &str,
    mut on_progress: F,
) -> Result<serde_json::Value, String>
where
    F: FnMut(serde_json::Value),
{
    let install_root = PathBuf::from(app_data_dir).join("downloaded-libraries");
    let target_dir = install_root.join("LeagueSkins");

    let remote_sha = fetch_remote_skin_sha();
    let local_sha = get_local_skin_sha(&target_dir);

    if let (Some(ref local), Some(ref remote)) = (&local_sha, &remote_sha) {
        if local == remote {
            eprintln!(
                "[LeagueSkins] SHA unchanged ({}), skip update",
                &remote[..8]
            );
            return Ok(serde_json::json!({
                "folderPath": target_dir.to_string_lossy(),
                "incremental": true,
                "changed": 0,
                "message": "Skins ya estan actualizadas.",
            }));
        }

        if let Some(changed) = get_changed_files(local, remote) {
            if !changed.is_empty() && changed.len() <= INCREMENTAL_THRESHOLD {
                eprintln!(
                    "[LeagueSkins] Incremental: {} archivos cambiados, descargando solo esos",
                    changed.len()
                );
                on_progress(serde_json::json!({
                    "type": "league-skins",
                    "message": format!("Actualizando {} archivos...", changed.len()),
                    "percent": 10,
                }));

                let branch = github_api_get(LEAGUE_SKINS_REPO_API)
                    .ok()
                    .and_then(|r| r["default_branch"].as_str().map(|s| s.to_string()))
                    .unwrap_or_else(|| "main".to_string());

                download_changed_files(&changed, &target_dir, &branch, |i, total, name| {
                    let percent = 10 + ((i as f64 / total as f64) * 80.0).round() as u64;
                    on_progress(serde_json::json!({
                        "type": "league-skins",
                        "message": format!("Actualizando {} ({}/{})", name, i, total),
                        "percent": percent.min(90),
                    }));
                })?;

                save_local_skin_sha(&target_dir, remote);

                on_progress(serde_json::json!({
                    "type": "league-skins",
                    "message": format!("{} archivos actualizados.", changed.len()),
                    "percent": 100,
                }));

                return Ok(serde_json::json!({
                    "folderPath": target_dir.to_string_lossy(),
                    "incremental": true,
                    "changed": changed.len(),
                }));
            }
        }
    }

    eprintln!(
        "[LeagueSkins] Full download needed (local={:?}, remote={:?})",
        local_sha.as_deref().map(|s| &s[..8.min(s.len())]),
        remote_sha.as_deref().map(|s| &s[..8.min(s.len())])
    );

    let result = download_league_skins(app_data_dir, on_progress)?;

    if let Some(sha) = &remote_sha {
        save_local_skin_sha(&target_dir, sha);
    }

    Ok(result)
}

pub fn download_ltk_manager(_app_data_dir: &str) -> Result<serde_json::Value, String> {
    let release = github_api_get(LTK_REPO_API)?;
    let asset = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets.iter().find(|a| {
                let name = a["name"].as_str().unwrap_or("");
                name.to_lowercase().ends_with("-setup.exe") || name.to_lowercase().contains("setup")
            })
        })
        .ok_or("No encontre el instalador de LTK Manager.")?;

    let asset_name = asset["name"].as_str().unwrap_or("LTK-Manager-Setup.exe");
    let download_url = asset["browser_download_url"]
        .as_str()
        .ok_or("No download URL")?;
    let version = release["tag_name"]
        .as_str()
        .or_else(|| release["name"].as_str())
        .unwrap_or("sin version");

    let download_dir = std::env::temp_dir().join("rift-atlas-ltk-download");
    std::fs::create_dir_all(&download_dir).ok();
    let setup_path = download_dir.join(asset_name);

    download_file(download_url, &setup_path.to_string_lossy())?;

    Ok(serde_json::json!({
        "setupPath": setup_path.to_string_lossy(),
        "dllPath": "",
        "version": version,
        "assetName": asset_name,
    }))
}

pub fn download_pengu_loader_rose<F>(
    app_data_dir: &str,
    mut on_progress: F,
) -> Result<serde_json::Value, String>
where
    F: FnMut(serde_json::Value),
{
    let (version, asset_name, download_url) = match github_api_get(ROSE_PENGU_REPO_API) {
        Ok(repo) => {
            let branch = repo["default_branch"].as_str().unwrap_or("main");
            (
                "ROSE-Pengu".to_string(),
                format!("ROSE-Pengu-{}.zip", branch),
                format!(
                    "https://codeload.github.com/Tariolle/ROSE-Pengu/zip/refs/heads/{}",
                    branch
                ),
            )
        }
        Err(_) => {
            // Fallback: try direct download without API (rate-limit safe)
            // NEVER fall back to PenguLoader/distro — that installs the wrong Pengu.
            let branch = "main";
            (
                "ROSE-Pengu".to_string(),
                format!("ROSE-Pengu-{}.zip", branch),
                format!(
                    "https://codeload.github.com/Tariolle/ROSE-Pengu/zip/refs/heads/{}",
                    branch
                ),
            )
        }
    };

    let sys_temp = std::env::temp_dir().join("rift-atlas-pengu-download");
    let download_dir = sys_temp;
    let runtime_dir = PathBuf::from(app_data_dir).join("Pengu Loader");
    let temp_dir = download_dir.join("extract");

    std::fs::remove_dir_all(&temp_dir).ok();
    std::fs::create_dir_all(&download_dir).ok();

    let zip_path = download_dir.join(&asset_name);
    download_file_with_progress(
        &download_url,
        &zip_path.to_string_lossy(),
        |downloaded, total| {
            let percent = total
                .filter(|value| *value > 0)
                .map(|value| ((downloaded as f64 / value as f64) * 90.0).round() as u64)
                .unwrap_or(0);
            on_progress(serde_json::json!({
                "type": "pengu-loader",
                "message": "Descargando Pengu Loader...",
                "percent": percent.min(90),
                "downloaded": downloaded,
                "total": total,
            }));
        },
    )?;

    std::fs::create_dir_all(&temp_dir).ok();
    on_progress(serde_json::json!({
        "type": "pengu-loader",
        "message": "Extrayendo Pengu Loader...",
        "percent": 95,
    }));
    extract_zip_simple(&zip_path.to_string_lossy(), &temp_dir.to_string_lossy())?;

    // Find Pengu Loader.exe
    let exe_path = find_file_recursive(&temp_dir.to_string_lossy(), "Pengu Loader.exe")
        .or_else(|| find_file_recursive(&temp_dir.to_string_lossy(), "PenguLoader.exe"))
        .ok_or("No encontre Pengu Loader.exe en el ZIP descargado.")?;

    let exe_dir = PathBuf::from(&exe_path).parent().unwrap().to_path_buf();

    // Preserve existing RiftAtlas plugins before overwriting Pengu Loader dir
    let plugins_backup_dir = PathBuf::from(app_data_dir).join("pengu-plugins-backup");
    let existing_plugins = runtime_dir.join("plugins");
    if existing_plugins.exists() {
        std::fs::remove_dir_all(&plugins_backup_dir).ok();
        // Only backup RiftAtlas-* dirs (not third-party plugins)
        if let Ok(entries) = std::fs::read_dir(&existing_plugins) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("RiftAtlas-") && entry.path().is_dir() {
                    let backup_target = plugins_backup_dir.join(&name);
                    let _ = copy_dir_recursive(&entry.path(), &backup_target);
                }
            }
        }
    }

    // Copy to runtime dir
    std::fs::remove_dir_all(&runtime_dir).ok();
    std::fs::create_dir_all(&runtime_dir).ok();
    copy_dir_recursive(&exe_dir, &runtime_dir)?;

    // Restore backed up RiftAtlas plugins
    if plugins_backup_dir.exists() {
        let target_plugins = runtime_dir.join("plugins");
        std::fs::create_dir_all(&target_plugins).ok();
        if let Ok(entries) = std::fs::read_dir(&plugins_backup_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let target = target_plugins.join(entry.file_name());
                    let _ = copy_dir_recursive(&entry.path(), &target);
                }
            }
        }
        std::fs::remove_dir_all(&plugins_backup_dir).ok();
    }

    std::fs::remove_dir_all(&temp_dir).ok();

    let installed_exe = runtime_dir.join("Pengu Loader.exe");
    if !installed_exe.exists() {
        // Try alternative name
        if let Some(_found) =
            find_file_recursive(&runtime_dir.to_string_lossy(), "Pengu Loader.exe")
                .or_else(|| find_file_recursive(&runtime_dir.to_string_lossy(), "PenguLoader.exe"))
        {
            // Success
        } else {
            return Err("Pengu Loader.exe no se copio correctamente.".to_string());
        }
    }

    Ok(serde_json::json!({
        "version": version,
        "executablePath": installed_exe.to_string_lossy(),
        "runtimeDir": runtime_dir.to_string_lossy(),
        "downloadDir": download_dir.to_string_lossy(),
    }))
}

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

pub fn list_mod_packages(folder_path: &str) -> Result<Vec<serde_json::Value>, String> {
    let mut packages = Vec::new();
    let mut dirs = vec![PathBuf::from(folder_path)];
    let mut seen = std::collections::HashSet::new();

    while let Some(dir) = dirs.pop() {
        if !seen.insert(dir.clone()) {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    dirs.push(path);
                } else if path.is_file() {
                    let name = path
                        .file_name()
                        .map(|f| f.to_string_lossy().to_lowercase())
                        .unwrap_or_default();
                    let ext = if name.ends_with(".wad.client") {
                        ".wad.client".to_string()
                    } else {
                        path.extension()
                            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                            .unwrap_or_default()
                    };
                    if MOD_PACKAGE_EXTENSIONS.contains(&ext.as_str()) {
                        let meta = std::fs::metadata(&path).ok();
                        packages.push(serde_json::json!({
                            "name": path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
                            "extension": ext,
                            "path": path.to_string_lossy(),
                            "relativePath": path.strip_prefix(folder_path).map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                            "size": meta.map(|m| m.len()).unwrap_or(0),
                        }));
                    }
                }
            }
        }
    }

    Ok(packages)
}

pub fn index_skin_library(
    folder_path: &str,
    app_data_dir: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let packages = list_mod_packages(folder_path)?;
    let mut skins = Vec::new();

    for pkg in &packages {
        let path = pkg["path"].as_str().unwrap_or("");
        let name = pkg["name"].as_str().unwrap_or("");
        let relative_path = pkg["relativePath"].as_str().unwrap_or("");
        let parts: Vec<&str> = relative_path
            .split(&['\\', '/'][..])
            .filter(|s| !s.is_empty())
            .collect();
        let offset = if parts.first().map(|s| s.to_lowercase()) == Some("skins".to_string()) {
            1
        } else {
            0
        };
        let repo_parts: Vec<&str> = parts.iter().skip(offset).copied().collect();

        let raw_champion = repo_parts.first().unwrap_or(&"Sin campeon").to_string();
        let raw_skin = repo_parts.get(1).map(|s| s.to_string()).unwrap_or_else(|| {
            PathBuf::from(name)
                .file_stem()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default()
        });
        let raw_variant = repo_parts.get(2).map(|s| s.to_string()).unwrap_or_default();
        let file_base = PathBuf::from(name)
            .file_stem()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        // Try to find champion info
        let champion_key = if raw_champion.parse::<u64>().is_ok() {
            raw_champion.clone()
        } else {
            String::new()
        };

        let local_preview = find_local_preview(path, &parts, &file_base);

        skins.push(serde_json::json!({
            "path": path,
            "name": name,
            "relativePath": relative_path,
            "size": pkg["size"],
            "rawChampion": raw_champion,
            "rawSkin": raw_skin,
            "rawVariant": raw_variant,
            "fileBaseId": if file_base.parse::<u64>().is_ok() { file_base.clone() } else { String::new() },
            "champion": raw_champion,
            "championKey": champion_key,
            "championId": champion_key,
            "skin": raw_skin,
            "variant": raw_variant,
            "skinNum": serde_json::Value::Null,
            "imageSkinNum": serde_json::Value::Null,
            "baseImageSkinNum": serde_json::Value::Null,
            "imageUrl": local_preview.0,
            "localPreviewPath": local_preview.1,
            "localPreviewUri": local_preview.2,
            "extension": pkg["extension"],
            "resolved": false,
            "numericSource": raw_champion.parse::<u64>().is_ok() || raw_skin.parse::<u64>().is_ok() || file_base.parse::<u64>().is_ok(),
        }));
    }

    // Cache the index
    let cache_path = PathBuf::from(app_data_dir)
        .join("cache")
        .join("skin-library-index.json");
    std::fs::create_dir_all(cache_path.parent().unwrap()).ok();
    let cache_data = serde_json::json!({
        "version": 10,
        "folderPath": folder_path,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "skins": skins,
    });
    if let Ok(content) = serde_json::to_string_pretty(&cache_data) {
        std::fs::write(&cache_path, content).ok();
    }

    Ok(skins)
}

fn find_local_preview(path: &str, parts: &[&str], file_base: &str) -> (String, String, String) {
    let extensions = [".png", ".jpg", ".jpeg", ".webp"];
    let file_path = PathBuf::from(path);
    let parent = file_path.parent().unwrap_or(std::path::Path::new(""));
    let grandparent = parent.parent().unwrap_or(std::path::Path::new(""));

    let search_names = vec![
        file_base.to_string(),
        parts
            .iter()
            .rev()
            .nth(1)
            .map(|s| s.to_string())
            .unwrap_or_default(),
        parts.get(2).map(|s| s.to_string()).unwrap_or_default(),
        parts.get(1).map(|s| s.to_string()).unwrap_or_default(),
    ];

    for dir in &[parent.to_path_buf(), grandparent.to_path_buf()] {
        for name in &search_names {
            for ext in &extensions {
                let preview = dir.join(format!("{}{}", name, ext));
                if preview.exists() {
                    let uri = if parts.len() >= 2 {
                        format!(
                            "local-preview://{}/{}/{}/{}",
                            parts[0],
                            parts[1],
                            file_base,
                            ext.trim_start_matches('.')
                        )
                    } else {
                        String::new()
                    };
                    return (
                        preview.to_string_lossy().to_string(),
                        preview.to_string_lossy().to_string(),
                        uri,
                    );
                }
            }
        }
    }

    (String::new(), String::new(), String::new())
}
