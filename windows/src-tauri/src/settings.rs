// Preferences, stored as plain JSON in settings.json under platform::config_dir().
// No secret ever lands here — API keys live in the OS keychain (see secrets.rs).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    /// The closed island (the small notch) stays on screen; it does not hide itself after a while.
    #[serde(default = "default_true")]
    pub always_show: bool,
    pub hooks_installed: bool,
    /// Claude model used by the chat. Changeable in the settings window.
    /// Defaulted explicitly so a settings.json written by an older build still loads.
    #[serde(default = "default_model")]
    pub model: String,
    /// Seconds before a finished card closes itself; 0 = never.
    #[serde(default = "default_done_auto_close")]
    pub done_auto_close: f64,
    /// "sound", "toast", "both" or "none".
    #[serde(default = "default_notify_mode")]
    pub notify_mode: String,
    /// Global hotkeys, name → combo like "Ctrl+Alt+Y". An empty combo turns one off.
    #[serde(default = "default_hotkeys")]
    pub hotkeys: BTreeMap<String, String>,
    /// Show the 5-hour and weekly plan limits on the island.
    #[serde(default = "default_true")]
    pub show_plan_usage: bool,
    /// Whose plan limits to show: "auto" (the session on screen), "windows" or "wsl".
    #[serde(default = "default_plan_source")]
    pub plan_source: String,
    /// Open the island for a few seconds on each file edit, showing the diff.
    #[serde(default)]
    pub live_diff: bool,
    /// "auto" (follow Windows), or a language code such as "en" or "ja".
    #[serde(default = "default_language")]
    pub language: String,
    /// The first-run setup was shown (or Claude Code was already connected).
    #[serde(default)]
    pub setup_done: bool,
}

fn default_true() -> bool {
    true
}

fn default_language() -> String {
    "auto".into()
}

fn default_plan_source() -> String {
    "auto".into()
}

/// Names the island understands, with the combos they start with.
pub fn default_hotkeys() -> BTreeMap<String, String> {
    [
        ("toggle", "Ctrl+Alt+J"),
        ("allow", "Ctrl+Alt+Y"),
        ("deny", "Ctrl+Alt+N"),
        ("opt1", "Ctrl+Alt+1"),
        ("opt2", "Ctrl+Alt+2"),
        ("opt3", "Ctrl+Alt+3"),
        ("opt4", "Ctrl+Alt+4"),
        ("shot", "Ctrl+Alt+S"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect()
}

fn default_done_auto_close() -> f64 {
    6.0
}

fn default_notify_mode() -> String {
    "sound".into()
}

fn default_model() -> String {
    crate::claude::DEFAULT_MODEL.to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            absence_interval: 180.0,
            screen: "primary".into(),
            autostart: false,
            always_show: true,
            hooks_installed: false,
            model: default_model(),
            done_auto_close: default_done_auto_close(),
            notify_mode: default_notify_mode(),
            hotkeys: default_hotkeys(),
            show_plan_usage: true,
            plan_source: default_plan_source(),
            live_diff: false,
            language: default_language(),
            setup_done: false,
        }
    }
}

pub use crate::platform::{config_dir, local_dir};

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join(crate::platform::HOOK_EXE)
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    crate::platform::ensure_private_dir(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A settings.json written by an older build: no newer keys, and a key that no longer exists.
    #[test]
    fn an_old_settings_file_still_loads_and_gets_the_new_defaults() {
        let old = r#"{
            "soundEnabled": false, "soundVolume": 0.05, "autoCloseInterval": 20, "absenceInterval": 180,
            "activeIntegrations": ["integration_github"], "screen": "cursor",
            "autostart": true, "hooksInstalled": true
        }"#;
        let s: Settings = serde_json::from_str(old).expect("an old file must load");
        assert!(!s.sound_enabled);
        assert_eq!(s.screen, "cursor");
        assert!(s.hooks_installed);
        // What did not exist yet takes its default.
        assert!(s.always_show, "the notch stays on screen unless told otherwise");
        assert!(!s.setup_done);
        assert!(!s.live_diff);
        assert_eq!(s.language, "auto");
        assert_eq!(s.notify_mode, "sound");
        assert!(s.show_plan_usage);
        assert_eq!(s.hotkeys.get("toggle").map(String::as_str), Some("Ctrl+Alt+J"));
    }

    #[test]
    fn the_defaults_round_trip() {
        let json = serde_json::to_string(&Settings::default()).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(serde_json::to_string(&back).unwrap(), json);
    }
}
