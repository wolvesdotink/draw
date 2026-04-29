/// Read a user-picked file by absolute path. Used by the Import flow.
///
/// We deliberately keep the fs plugin scope locked to $APPDATA/drawings/**, so
/// the Import flow can't be implemented via the fs plugin alone. This command
/// is the explicit, audited entry point for reading external files.
///
/// Guards:
///   - rejects directories (drag-drop can deliver them; the dialog filter
///     usually catches them but we double-check)
///   - caps reads at 200 MB. Real .excalidraw files with embedded base64
///     images can be a few MB; 200 MB is a generous ceiling that protects
///     against accidental drops of huge unrelated files.
///
/// Returns the file contents as UTF-8 text. Non-UTF-8 inputs (e.g. random
/// binary files dragged in) surface as an error string from `read_to_string`.
#[tauri::command]
fn import_read_file(path: String) -> Result<String, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        return Err("Path is a directory.".into());
    }
    if metadata.len() > 200 * 1024 * 1024 {
        return Err("File too large (>200 MB).".into());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    // Updater + process are desktop-only. The frontend invokes these through
    // @tauri-apps/plugin-updater and @tauri-apps/plugin-process; we only need
    // to register them on the Rust side here. Updates are signed/verified
    // against the public key in tauri.conf.json (plugins.updater.pubkey) and
    // fetched from the configured endpoints (latest.json on GitHub releases).
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![import_read_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
