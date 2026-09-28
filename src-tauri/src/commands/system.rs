/// Newest-first snapshot of the backend activity log (panel hydration).
#[tauri::command]
pub fn get_activity(limit: Option<usize>) -> Vec<crate::activity::ActivityEntry> {
    crate::activity::snapshot(limit.unwrap_or(200))
}

/// Wipe the activity log (panel trash button) — in memory and on disk.
/// `conn_key`/`conn_id` scope the clear to one connection's entries (the
/// feed is usually filtered to one connection when this is clicked, and
/// wiping every OTHER connection's history too would be a surprising
/// side effect); both omitted clears everything, same as before this param
/// existed.
#[tauri::command]
pub fn clear_activity(app: tauri::AppHandle, conn_key: Option<String>, conn_id: Option<String>) {
    crate::activity::clear_matching(conn_key.as_deref(), conn_id.as_deref());
    crate::activity_store::persist(&app);
}

/// Read a file from disk as raw bytes (opened via the native dialog).
#[tauri::command]
pub fn read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// Write raw bytes to a file (chosen via the native save dialog).
#[tauri::command]
pub fn write_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Open a brand-new, independent app window (File → New Window). Each window
/// is its own webview with its own frontend state (open tabs, active
/// connection…) — like a new browser window, not a duplicate of the current
/// one — but they all talk to the same backend, so connections opened in one
/// are reusable from another. Mirrors the main window's chrome (custom
/// title bar on Windows/Linux via `decorations(false)`, native overlay title
/// bar on macOS) since this is built at runtime rather than from
/// `tauri.conf.json`, which only configures the window(s) present at
/// startup. Must stay `async` — building a window synchronously from a
/// command deadlocks on Windows (see `WebviewWindowBuilder::new`'s docs).
#[tauri::command]
pub async fn open_new_window(app: tauri::AppHandle) -> Result<(), String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    static NEXT_ID: AtomicU32 = AtomicU32::new(1);
    let label = format!("window-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));

    #[allow(unused_mut)]
    let mut builder =
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
            .title("DH Studio")
            .inner_size(800.0, 600.0)
            .resizable(true);

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.decorations(false);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

/// Show Windows 11's native Snap Layout flyout, called when the pointer
/// enters our custom-drawn maximize button (see `title-bar.tsx`). We run
/// with `decorations: false` on Windows (custom title bar, like every
/// platform here), so there's no real native maximize caption button for
/// the DWM shell to hover-detect on its own. Rather than reimplementing
/// DWM's window-chrome/hit-testing machinery, this simulates the OS's own
/// Win+Z shortcut — the same trick `tauri-plugin-decorum` uses internally —
/// which pops the identical flyout without touching window decorations at
/// all. The trailing Alt tap clears the ghost keyboard-focus rectangle Win+Z
/// leaves on the taskbar/desktop afterward.
#[tauri::command]
pub fn show_snap_overlay() {
    #[cfg(target_os = "windows")]
    {
        use enigo::{
            Direction::{Click, Press, Release},
            Enigo, Key, Keyboard, Settings,
        };
        std::thread::spawn(|| {
            let Ok(mut enigo) = Enigo::new(&Settings::default()) else {
                return;
            };
            let _ = enigo.key(Key::Meta, Press);
            let _ = enigo.key(Key::Unicode('z'), Click);
            let _ = enigo.key(Key::Meta, Release);
            std::thread::sleep(std::time::Duration::from_millis(50));
            let _ = enigo.key(Key::Alt, Click);
        });
    }
}
