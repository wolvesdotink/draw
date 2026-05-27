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
    //
    // Application menu is also defined in this block. Tauri provides a default
    // macOS menu when no custom one is set, but the moment we call `.menu(...)`
    // we replace it entirely — so we mirror the standard predefined items
    // (File/Edit/Window) to keep ⌘W, ⌘Z/⌘X/⌘C/⌘V, ⌘M working in any text
    // inputs (e.g. file rename). The one custom item is "Check for Updates…",
    // which fires a webview event that the frontend's useUpdater hook listens
    // for. We deliberately don't run the updater check in Rust — keeping it in
    // the React state machine avoids duplicating the
    // available/downloading/ready lifecycle on both sides.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, SubmenuBuilder};
        use tauri::{Emitter, Manager};

        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .menu(|handle| {
                let pkg = handle.package_info();
                let about = AboutMetadataBuilder::new()
                    .name(Some(pkg.name.clone()))
                    .version(Some(pkg.version.to_string()))
                    .build();
                let check_updates = MenuItem::with_id(
                    handle,
                    "check_for_updates",
                    "Check for Updates…",
                    true,
                    None::<&str>,
                )?;
                let app_submenu = SubmenuBuilder::new(handle, &pkg.name)
                    .about(Some(about))
                    .separator()
                    .item(&check_updates)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;
                let file_submenu = SubmenuBuilder::new(handle, "File").close_window().build()?;
                let edit_submenu = SubmenuBuilder::new(handle, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                let window_submenu = SubmenuBuilder::new(handle, "Window")
                    .minimize()
                    .maximize()
                    .separator()
                    .close_window()
                    .build()?;
                Menu::with_items(
                    handle,
                    &[&app_submenu, &file_submenu, &edit_submenu, &window_submenu],
                )
            })
            .on_menu_event(|app, event| {
                if event.id() == "check_for_updates" {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu://check-for-updates", ());
                    }
                }
            });
    }

    builder
        .invoke_handler(tauri::generate_handler![import_read_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
