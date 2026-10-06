// The menu of the notification-area icon, and the same menu when you right-click the island:
// Open, Settings, Pause, Refresh Claude limits, Restart, Open log folder, Quit.
//
// The texts come from the page (it knows the interface language) through `set_labels`;
// until it has said, they are English.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::island::WINDOW_LABEL;
use crate::{platform, settings};

#[derive(Clone, Deserialize)]
pub struct Labels {
    pub open: String,
    pub settings: String,
    pub pause: String,
    pub refresh: String,
    pub restart: String,
    pub log: String,
    pub quit: String,
}

impl Default for Labels {
    fn default() -> Self {
        Self {
            open: "Open Coucou".into(),
            settings: "Settings…".into(),
            pause: "Hide island".into(),
            refresh: "Refresh Claude limits".into(),
            restart: "Restart Coucou".into(),
            log: "Open log folder".into(),
            quit: "Quit".into(),
        }
    }
}

static LABELS: Mutex<Option<Labels>> = Mutex::new(None);

fn labels() -> Labels {
    LABELS.lock().ok().and_then(|l| l.clone()).unwrap_or_default()
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let l = labels();
    let open = MenuItem::with_id(app, "open", &l.open, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", &l.settings, true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", &l.pause, true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", &l.refresh, true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", &l.restart, true, None::<&str>)?;
    let log = MenuItem::with_id(app, "log", &l.log, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", &l.quit, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[&open, &sep1, &refresh, &settings, &pause, &sep2, &restart, &log, &sep3, &quit],
    )
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    // Right-click: the menu. Double-click: the island on / off (the same as the menu's first
    // choice below "Open"). A single left click does nothing, so a double click never opens the menu.
    let mut builder = TrayIconBuilder::with_id("coucou")
        .tooltip("Coucou")
        .menu(&menu(app)?)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = event {
                let _ = tray.app_handle().emit_to(WINDOW_LABEL, "tray", "pause".to_string());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// A choice from the tray menu or the right-click menu (the app's menu-event listener).
pub fn handle(app: &AppHandle, id: &str) {
    match id {
        "quit" => app.exit(0),
        "settings" => crate::show_settings_window(app),
        "restart" => app.restart(),
        "log" => platform::reveal_folder(&settings::local_dir().to_string_lossy()),
        // open, pause, refresh: the page does these.
        other => {
            let _ = app.emit_to(WINDOW_LABEL, "tray", other.to_string());
        }
    }
}

/// New texts for the menu (the interface language, or Pause ↔ Resume, changed).
pub fn set_labels(app: &AppHandle, new: Labels) {
    if let Ok(mut slot) = LABELS.lock() {
        *slot = Some(new);
    }
    if let Some(tray) = app.tray_by_id("coucou") {
        if let Ok(menu) = menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// The icon in colour, or in grey while the island is switched off.
pub fn set_dimmed(app: &AppHandle, dimmed: bool) {
    let Some(tray) = app.tray_by_id("coucou") else { return };
    let Some(icon) = app.default_window_icon() else { return };
    let image = if dimmed {
        let mut rgba = icon.rgba().to_vec();
        for px in rgba.chunks_exact_mut(4) {
            // Luminance, a little darker: it reads as "off" next to the coloured icons.
            let grey = ((px[0] as u32 * 299 + px[1] as u32 * 587 + px[2] as u32 * 114) / 1000) as f32 * 0.8;
            px[0] = grey as u8;
            px[1] = grey as u8;
            px[2] = grey as u8;
        }
        tauri::image::Image::new_owned(rgba, icon.width(), icon.height())
    } else {
        icon.clone()
    };
    let _ = tray.set_icon(Some(image));
    let _ = tray.set_tooltip(Some(if dimmed { "Coucou (off)" } else { "Coucou" }));
}

/// The same menu, where the mouse is, over the island.
pub fn popup(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else { return };
    if let Ok(menu) = menu(app) {
        let _ = menu.popup(window.as_ref().window());
    }
}
