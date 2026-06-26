use std::path::Component;
use std::path::{Path, PathBuf};

pub const CATEGORIES: &[&str] = &[
    "skins",
    "maps",
    "fonts",
    "announcers",
    "voiceover",
    "ui",
    "loading_screen",
    "vfx",
    "sfx",
    "others",
];

const SKIN_EXTENSIONS: &[&str] = &[".fantome", ".zip", ".wad", ".wad.client", ".rse"];

pub struct ModStorage {
    pub root: PathBuf,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct ModEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub category: String,
    pub size: u64,
    pub extension: String,
}

impl ModStorage {
    pub fn new(app_data_dir: &str) -> Self {
        let root = PathBuf::from(app_data_dir).join("mods");
        Self { root }
    }

    pub fn ensure_layout(&self) {
        for cat in CATEGORIES {
            let _ = std::fs::create_dir_all(self.root.join(cat));
        }
    }

    pub fn list_mods_for_category(&self, category: &str) -> Vec<ModEntry> {
        let cat_dir = self.root.join(category);
        if !cat_dir.exists() {
            return Vec::new();
        }
        let mut entries = Vec::new();
        self.collect_mods_recursive(&cat_dir, category, &mut entries, 0);
        entries
    }

    fn collect_mods_recursive(
        &self,
        dir: &Path,
        category: &str,
        entries: &mut Vec<ModEntry>,
        depth: u32,
    ) {
        if depth > 3 {
            return;
        }
        if let Ok(read_dir) = std::fs::read_dir(dir) {
            for entry in read_dir.flatten() {
                let path = entry.path();
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                if path.is_dir() {
                    self.collect_mods_recursive(&path, category, entries, depth + 1);
                } else if path.is_file() {
                    let name_lower = name.to_lowercase();
                    let ext = if name_lower.ends_with(".wad.client") {
                        ".wad.client".to_string()
                    } else {
                        path.extension()
                            .map(|e| e.to_string_lossy().to_lowercase())
                            .unwrap_or_default()
                    };
                    if SKIN_EXTENSIONS.contains(&ext.as_str()) {
                        let meta = std::fs::metadata(&path).ok();
                        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                        let relative = path
                            .strip_prefix(&self.root)
                            .map(|r| r.to_string_lossy().to_string())
                            .unwrap_or_else(|_| name.clone());
                        entries.push(ModEntry {
                            id: relative.replace('\\', "/"),
                            name: name.clone(),
                            path: path.to_string_lossy().to_string(),
                            category: category.to_string(),
                            size,
                            extension: ext,
                        });
                    }
                }
            }
        }
    }

    pub fn import_mod(&self, source_path: &str, category: &str) -> Result<ModEntry, String> {
        if !CATEGORIES.contains(&category) {
            return Err(format!("Categoria invalida: {}", category));
        }
        let src = PathBuf::from(source_path);
        if !src.exists() {
            return Err(format!("Archivo no encontrado: {}", source_path));
        }
        let name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .ok_or("Nombre de archivo invalido")?;
        let dest = self.root.join(category).join(&name);
        if src.is_dir() {
            crate::junction::copy_dir_recursive(&src, &dest)?;
        } else {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            std::fs::copy(&src, &dest).map_err(|e| format!("Error copiando: {}", e))?;
        }
        let meta = std::fs::metadata(&dest).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let ext = dest
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let relative = dest
            .strip_prefix(&self.root)
            .map(|r| r.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());
        Ok(ModEntry {
            id: relative.replace('\\', "/"),
            name,
            path: dest.to_string_lossy().to_string(),
            category: category.to_string(),
            size,
            extension: ext,
        })
    }

    pub fn remove_mod(&self, category: &str, mod_id: &str) -> Result<(), String> {
        if !CATEGORIES.contains(&category) {
            return Err(format!("Categoria invalida: {}", category));
        }
        let relative =
            safe_relative_mod_path(mod_id).ok_or_else(|| "Ruta de mod invalida".to_string())?;
        let category_path = Path::new(category);
        let relative = if relative.starts_with(category_path) {
            relative
        } else {
            category_path.join(relative)
        };
        let path = self.root.join(relative);
        if !path.exists() {
            return Err("Mod no encontrado".to_string());
        }
        crate::junction::remove_entry(&path)
    }

    pub fn get_mod_path(&self, category: &str, mod_id: &str) -> Option<PathBuf> {
        if !CATEGORIES.contains(&category) {
            return None;
        }
        let relative = safe_relative_mod_path(mod_id)?;
        let path = self.root.join(category).join(&relative);
        if path.exists() {
            Some(path)
        } else {
            let path = self.root.join(relative);
            if path.exists() {
                Some(path)
            } else {
                None
            }
        }
    }

    pub fn list_all_categories(&self) -> Vec<serde_json::Value> {
        CATEGORIES
            .iter()
            .map(|cat| {
                let mods = self.list_mods_for_category(cat);
                serde_json::json!({
                    "category": cat,
                    "count": mods.len(),
                    "mods": mods,
                })
            })
            .collect()
    }
}

fn safe_relative_mod_path(value: &str) -> Option<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute() || value.trim().is_empty() {
        return None;
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(path.to_path_buf())
}
