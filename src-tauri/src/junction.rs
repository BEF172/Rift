use std::path::Path;

/// Check if a path is a Windows junction (reparse point).
#[cfg(target_os = "windows")]
pub fn is_junction(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    use std::os::windows::fs::MetadataExt;
    std::fs::metadata(path)
        .map(|m: std::fs::Metadata| m.file_attributes() & 0x400 != 0)
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
pub fn is_junction(path: &Path) -> bool {
    path.exists() && path.is_symlink()
}

/// Create a Windows junction from `link` pointing to `target`.
/// Uses kernel32 CreateFileW + DeviceIoControl for proper NTFS junctions.
/// Falls back to copytree if junction creation fails.
#[cfg(target_os = "windows")]
pub fn create_junction(target: &Path, link: &Path) -> Result<(), String> {
    if link.exists() || is_junction(link) {
        remove_entry(link).ok();
    }
    if let Some(parent) = link.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    // Try creating a proper NTFS junction via kernel32 DeviceIoControl.
    // This does NOT require elevated privileges (unlike symlinks).
    unsafe {
        type HHandle = *mut core::ffi::c_void;
        const INVALID_HANDLE_VALUE: HHandle = -1isize as HHandle;
        const OPEN_EXISTING: u32 = 3;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x00200000;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x02000000;
        const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA0000003;
        const FSCTL_SET_REPARSE_POINT: u32 = 0x000900A4;

        #[link(name = "kernel32")]
        extern "system" {
            fn CreateFileW(
                lpfilename: *const u16,
                dwdesiredaccess: u32,
                dwsharemode: u32,
                lpsecurityattributes: *mut core::ffi::c_void,
                dwcreationdisposition: u32,
                dwflagsandattributes: u32,
                htemplatefile: HHandle,
            ) -> HHandle;
            fn DeviceIoControl(
                hdevice: HHandle,
                dwiocontrolcode: u32,
                lpvinbuffer: *const core::ffi::c_void,
                nvinbuffersize: u32,
                lpvoutbuffer: *mut core::ffi::c_void,
                nvinoutbuffersize: u32,
                lpbytesreturned: *mut u32,
                lpoverlapped: *mut core::ffi::c_void,
            ) -> i32;
            fn CloseHandle(hhandle: HHandle) -> i32;
        }

        let link_wide: Vec<u16> = link
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let handle = CreateFileW(
            link_wide.as_ptr(),
            0,
            0,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            INVALID_HANDLE_VALUE,
        );
        if handle == INVALID_HANDLE_VALUE {
            return copy_dir_recursive(target, link);
        }

        let subst_name = format!("\\??\\{}", target.to_string_lossy());
        let subst_wide: Vec<u16> = subst_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let print_name = target.to_string_lossy().to_string();
        let print_wide: Vec<u16> = print_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let subst_byte_len = (subst_wide.len() * 2 - 2) as u16;
        let print_byte_len = (print_wide.len() * 2 - 2) as u32;
        let subst_offset: u16 = 8;
        let print_offset = subst_offset + subst_byte_len + 2;
        let path_buffer_size = (print_offset as usize + print_wide.len() * 2) as u32;

        let mut buf: Vec<u8> = vec![0u8; path_buffer_size as usize];

        // Header
        buf[0..4].copy_from_slice(&IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes());
        buf[4..6].copy_from_slice(&(path_buffer_size as u16 - 8).to_le_bytes());
        buf[6..8].copy_from_slice(&0u16.to_le_bytes());

        // Substitute name offset + length
        buf[8..10].copy_from_slice(&subst_offset.to_le_bytes());
        buf[10..12].copy_from_slice(&subst_byte_len.to_le_bytes());

        // Print name offset + length
        buf[12..14].copy_from_slice(&print_offset.to_le_bytes());
        buf[14..18].copy_from_slice(&print_byte_len.to_le_bytes());

        // Substitute name
        let subst_bytes = std::slice::from_raw_parts(
            subst_wide.as_ptr() as *const u8,
            subst_byte_len as usize + 2,
        );
        let subst_start = subst_offset as usize;
        buf[subst_start..subst_start + subst_bytes.len()].copy_from_slice(subst_bytes);

        // Print name
        let print_bytes = std::slice::from_raw_parts(
            print_wide.as_ptr() as *const u8,
            print_byte_len as usize + 2,
        );
        let print_start = print_offset as usize;
        buf[print_start..print_start + print_bytes.len()].copy_from_slice(print_bytes);

        let mut bytes_returned = 0u32;
        let ok = DeviceIoControl(
            handle,
            FSCTL_SET_REPARSE_POINT,
            buf.as_ptr() as *const core::ffi::c_void,
            buf.len() as u32,
            std::ptr::null_mut(),
            0,
            &mut bytes_returned,
            std::ptr::null_mut(),
        );
        CloseHandle(handle);

        if ok != 0 {
            return Ok(());
        }
    }

    // Fallback: copytree
    copy_dir_recursive(target, link)
}

#[cfg(not(target_os = "windows"))]
pub fn create_junction(target: &Path, link: &Path) -> Result<(), String> {
    if link.exists() {
        remove_entry(link).ok();
    }
    std::os::unix::fs::symlink(target, link).map_err(|e| format!("Error creating symlink: {}", e))
}

/// Remove a junction, directory, or file.
pub fn remove_entry(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if is_junction(path) {
        // junctions are removed with remove_dir (not remove_dir_all)
        std::fs::remove_dir(path).map_err(|e| format!("Error removing junction: {}", e))
    } else if path.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| format!("Error removing dir: {}", e))
    } else {
        std::fs::remove_file(path).map_err(|e| format!("Error removing file: {}", e))
    }
}

/// Extract a zip/fantome archive to a directory.
pub fn extract_zip_to_dir(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("Error opening zip: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Error reading zip: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Error reading entry {}: {}", i, e))?;
        let name = entry.name().to_string();
        if name.is_empty() {
            continue;
        }
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| format!("Ruta insegura dentro del archive: {}", name))?;
        let out_path = dest.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("Error creating directory {:?}: {}", out_path, e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&out_path)
                .map_err(|e| format!("Error creating {:?}: {}", out_path, e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Error extracting {}: {}", name, e))?;
        }
    }
    Ok(())
}

/// Recursive directory copy (fallback when junctions are not supported).
pub fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("Error creating dir: {}", e))?;
    let entries =
        std::fs::read_dir(src).map_err(|e| format!("Error reading dir {:?}: {}", src, e))?;
    for entry in entries.flatten() {
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            std::fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Error copying {:?} -> {:?}: {}", src_path, dest_path, e))?;
        }
    }
    Ok(())
}

/// Clean a directory: remove all entries (junctions, dirs, files) inside it.
pub fn clean_dir(path: &Path) {
    if !path.exists() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let _ = remove_entry(&entry.path());
        }
    }
}
