// Windows: Win32 for the island window and the cursor, %APPDATA% for files.

use std::collections::BTreeMap;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use ::windows::core::{BOOL, PWSTR};
use ::windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, HWND, LPARAM, LocalFree, POINT, RECT, WPARAM};
use ::windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use ::windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
use ::windows::Win32::System::SystemInformation::GetLocalTime;
use ::windows::Win32::System::Threading::{GetCurrentProcess, GetCurrentThreadId, OpenProcessToken};
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL,
    MOD_NOREPEAT, MOD_SHIFT, MOD_WIN, VK_LBUTTON,
};
use ::windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetMessageW,
    GetWindowLongPtrW, GetWindowRect, PeekMessageW, PostThreadMessageW, SetWindowLongPtrW,
    GWL_EXSTYLE, MSG, PM_NOREMOVE, WM_APP, WM_HOTKEY, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use super::LocalTime;
use crate::island::WINDOW_LABEL;

/// File name of the Claude Code relay.
pub const HOOK_EXE: &str = "coucou-hook.exe";

/// Environment variable holding the home directory.
pub const HOME_VAR: &str = "USERPROFILE";

/// Keeps spawned helpers from flashing a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ── Files ─────────────────────────────────────────────────────────────────────

/// %APPDATA%\Coucou — preferences.
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Coucou")
}

/// %LOCALAPPDATA%\Coucou — where coucou-hook.exe, the inbox and the log live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Coucou")
}

/// %APPDATA% and %LOCALAPPDATA% are already private to the user.
pub fn ensure_private_dir(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

/// Nothing to set up before the webview starts.
pub fn prepare_environment() {}

pub fn local_time() -> LocalTime {
    let t = unsafe { GetLocalTime() };
    LocalTime {
        year: t.wYear.into(),
        month: t.wMonth.into(),
        day: t.wDay.into(),
        hour: t.wHour.into(),
        minute: t.wMinute.into(),
        second: t.wSecond.into(),
    }
}

// ── Processes ─────────────────────────────────────────────────────────────────

/// Spawned helpers must never flash a console window.
pub fn no_console(cmd: &mut Command) -> &mut Command {
    cmd.creation_flags(CREATE_NO_WINDOW)
}

pub fn open_url(url: &str) {
    let _ = no_console(Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url]))
        .spawn();
}

pub fn reveal_folder(path: &str) {
    let _ = Command::new("explorer").arg(path).spawn();
}

/// Our own `where`: walks %PATH% against %PATHEXT%, no shell involved.
/// Rust quotes arguments correctly for `.cmd`/`.bat` targets since 1.77, so
/// spawning `code.cmd` directly is safe.
pub fn find_on_path(stem: &str) -> Option<PathBuf> {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let dirs = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&dirs) {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{stem}{}", ext.to_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

// ── Who we are ────────────────────────────────────────────────────────────────
//
// Named pipes share one machine-wide namespace, so the SID in the name is what
// keeps two accounts on the same machine from ever meeting on `coucou-*`.
// coucou-hook computes the same string (hook/src/win.rs) and additionally checks
// that the process serving the pipe really is us.

/// The SID of the account this process runs as, as `S-1-5-21-…`.
pub fn current_user_sid() -> Option<String> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).ok()?;

        // First call sizes the buffer, second fills it.
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
        if needed == 0 {
            let _ = CloseHandle(token);
            return None;
        }
        let mut buf = vec![0u8; needed as usize];
        let ok = GetTokenInformation(
            token,
            TokenUser,
            Some(buf.as_mut_ptr().cast()),
            needed,
            &mut needed,
        )
        .is_ok();
        let _ = CloseHandle(token);
        if !ok {
            return None;
        }

        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut text = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text).ok()?;
        let sid = text.to_string().ok();
        let _ = LocalFree(Some(HLOCAL(text.0 as *mut _)));
        sid
    }
}

// ── Cursor ────────────────────────────────────────────────────────────────────

/// The 60 Hz poll reads the cursor and flips click-through from it.
pub const CURSOR_POLL: bool = true;

/// Cursor position in physical screen pixels.
pub fn cursor_physical() -> Option<(f64, f64)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

/// True while the left mouse button is held — the only signal we get that a
/// drag might be in flight before it reaches the window.
pub fn left_button_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

// ── Hotkeys and notifications ─────────────────────────────────────────────────

/// The hotkeys the island understands. Which keys trigger them is a setting
/// (`settings.hotkeys`); an empty combo leaves that one off.
const HOTKEY_NAMES: [&str; 8] = ["toggle", "allow", "deny", "opt1", "opt2", "opt3", "opt4", "shot"];

/// Thread that owns the hotkeys: they belong to the thread that registered them.
static HOTKEY_THREAD: AtomicU32 = AtomicU32::new(0);
/// What should be registered (name, combo), and what could not be.
static HOTKEY_WANT: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
static HOTKEY_FAILED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Names whose combination is taken by another program or does not parse.
pub fn failed_hotkeys() -> Vec<String> {
    HOTKEY_FAILED.lock().unwrap().clone()
}

/// Takes the combos from the settings and has the hotkey thread register them,
/// replacing whatever was registered before.
pub fn set_hotkeys(map: &BTreeMap<String, String>) {
    let defaults = crate::settings::default_hotkeys();
    let want: Vec<(String, String)> = HOTKEY_NAMES
        .iter()
        .filter_map(|name| {
            let combo = map.get(*name).or_else(|| defaults.get(*name))?.trim().to_string();
            (!combo.is_empty()).then(|| (name.to_string(), combo))
        })
        .collect();
    *HOTKEY_WANT.lock().unwrap() = want;
    let thread = HOTKEY_THREAD.load(Ordering::Relaxed);
    if thread != 0 {
        unsafe {
            let _ = PostThreadMessageW(thread, WM_APP, WPARAM(0), LPARAM(0));
        }
    }
}

/// "Ctrl+Alt+Y" → modifiers and virtual-key code.
fn parse_combo(combo: &str) -> Option<(HOT_KEY_MODIFIERS, u32)> {
    let mut mods = HOT_KEY_MODIFIERS(0);
    let mut key = None;
    for part in combo.split('+').map(str::trim).filter(|p| !p.is_empty()) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => mods = mods | MOD_CONTROL,
            "alt" => mods = mods | MOD_ALT,
            "shift" => mods = mods | MOD_SHIFT,
            "win" | "meta" | "super" => mods = mods | MOD_WIN,
            other => key = Some(key_code(other)?),
        }
    }
    // A bare key would swallow typing everywhere: at least one modifier.
    if mods.0 == 0 {
        return None;
    }
    key.map(|k| (mods, k))
}

fn key_code(name: &str) -> Option<u32> {
    let bytes = name.as_bytes();
    if bytes.len() == 1 {
        let c = bytes[0];
        if c.is_ascii_lowercase() {
            return Some(c.to_ascii_uppercase() as u32);
        }
        if c.is_ascii_digit() {
            return Some(c as u32);
        }
    }
    if let Some(n) = name.strip_prefix('f').and_then(|n| n.parse::<u32>().ok()) {
        if (1..=24).contains(&n) {
            return Some(0x6F + n);
        }
    }
    Some(match name {
        "space" => 0x20,
        "enter" => 0x0D,
        "tab" => 0x09,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        "end" => 0x23,
        "home" => 0x24,
        "left" => 0x25,
        "up" => 0x26,
        "right" => 0x27,
        "down" => 0x28,
        "insert" => 0x2D,
        "delete" => 0x2E,
        _ => return None,
    })
}

/// Drops the current registrations and registers `HOTKEY_WANT`. Runs on the
/// hotkey thread only.
fn apply_hotkeys(registered: &mut Vec<(i32, String)>) {
    for (id, _) in registered.drain(..) {
        unsafe {
            let _ = UnregisterHotKey(None, id);
        }
    }
    let mut failed = Vec::new();
    let want = HOTKEY_WANT.lock().unwrap().clone();
    for (index, (name, combo)) in want.iter().enumerate() {
        let id = index as i32 + 1;
        let ok = parse_combo(combo)
            .map(|(mods, vk)| unsafe { RegisterHotKey(None, id, mods | MOD_NOREPEAT, vk) }.is_ok())
            .unwrap_or(false);
        if ok {
            registered.push((id, name.clone()));
        } else {
            crate::log::line(format!("hotkey {name} ({combo}) is taken or invalid — skipped"));
            failed.push(name.clone());
        }
    }
    *HOTKEY_FAILED.lock().unwrap() = failed;
}

/// Runs the hotkey thread. They reach the page as a `hotkey` event carrying the
/// name (toggle, allow, deny, opt1…opt4). A combination another program already
/// owns is simply not registered; it is logged, listed by `failed_hotkeys`, and
/// the rest still work.
pub fn start_hotkeys(app: AppHandle) {
    std::thread::spawn(move || {
        let mut msg = MSG::default();
        unsafe {
            // Touching the queue creates it, so a post from another thread lands.
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
            HOTKEY_THREAD.store(GetCurrentThreadId(), Ordering::Relaxed);
        }
        let mut registered: Vec<(i32, String)> = Vec::new();
        apply_hotkeys(&mut registered);
        while unsafe { GetMessageW(&mut msg, None, 0, 0) }.0 > 0 {
            match msg.message {
                WM_HOTKEY => {
                    let id = msg.wParam.0 as i32;
                    if let Some((_, name)) = registered.iter().find(|(i, _)| *i == id) {
                        let _ = app.emit_to(WINDOW_LABEL, "hotkey", name.as_str());
                    }
                }
                WM_APP => apply_hotkeys(&mut registered),
                _ => {}
            }
        }
    });
}

/// Saves a PNG of the display the cursor is on. Windows PowerShell does the
/// capture (System.Drawing), so no imaging crate is needed; it is marked
/// DPI-aware first, or a scaled display would come out blurry and cropped.
pub fn capture_screen(path: &std::path::Path) -> Result<(), String> {
    const SCRIPT: &str = r#"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class CoucouDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][CoucouDpi]::SetProcessDPIAware()
$b = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save($env:COUCOU_SHOT, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
"#;
    let status = no_console(
        Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", SCRIPT])
            .env("COUCOU_SHOT", path),
    )
    .status()
    .map_err(|e| format!("Could not start the screen capture: {e}"))?;
    if status.success() && path.is_file() {
        Ok(())
    } else {
        Err("The screen capture failed.".into())
    }
}

/// Makes `coucou://` open this program: that is how a click on a notification brings the island up
/// (the notification carries `coucou://open`; Windows starts the program with it, and the running
/// instance receives it through the single-instance hand-over). Only the current user's registry
/// (HKCU\Software\Classes\coucou) is written, and only what is needed.
pub fn register_protocol() {
    let Ok(exe) = std::env::current_exe() else { return };
    let command = format!("\"{}\" \"%1\"", exe.display());
    let steps: [Vec<String>; 3] = [
        vec!["add".into(), r"HKCU\Software\Classes\coucou".into(), "/ve".into(), "/d".into(), "URL:Coucou".into(), "/f".into()],
        vec!["add".into(), r"HKCU\Software\Classes\coucou".into(), "/v".into(), "URL Protocol".into(), "/d".into(), "".into(), "/f".into()],
        vec!["add".into(), r"HKCU\Software\Classes\coucou\shell\open\command".into(), "/ve".into(), "/d".into(), command, "/f".into()],
    ];
    for args in steps {
        let _ = no_console(Command::new("reg.exe").args(&args)).status();
    }
}

/// A toast in the notification centre. Windows PowerShell can raise one without
/// an installed app, under its own identity. The text goes in through the
/// environment and is XML-escaped by the script, so it never touches the command line.
pub fn notify_toast(title: &str, body: &str) {
    const SCRIPT: &str = r#"
$t = [System.Security.SecurityElement]::Escape($env:COUCOU_TITLE)
$b = [System.Security.SecurityElement]::Escape($env:COUCOU_BODY)
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml("<toast activationType='protocol' launch='coucou://open'><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>")
$n = [Windows.UI.Notifications.ToastNotification]::new($x)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show($n)
"#;
    let _ = no_console(
        Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", SCRIPT])
            .env("COUCOU_TITLE", title)
            .env("COUCOU_BODY", body),
    )
    .spawn();
}

/// True while a full-screen game or video, or a presentation, owns the screen.
/// This is the same signal Windows uses to hold back its own notifications.
///
/// `screen` is the island's display (x, y, width, height in physical pixels): a game
/// on another monitor leaves the island alone.
pub fn fullscreen_app_active(screen: Option<(i32, i32, u32, u32)>) -> bool {
    let busy = match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => {
            state == QUNS_BUSY
                || state == QUNS_RUNNING_D3D_FULL_SCREEN
                || state == QUNS_PRESENTATION_MODE
        }
        Err(_) => false,
    };
    if !busy {
        return false;
    }
    let Some((sx, sy, sw, sh)) = screen else { return true };
    // Is the window in front on the island's display? Its centre says so.
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut rect = RECT::default();
        if hwnd.0.is_null() || GetWindowRect(hwnd, &mut rect).is_err() {
            return true;
        }
        // The window in front must itself fill the island's display. A full-screen app with an
        // ordinary window on top of it (or one that is not the active window) leaves the
        // island showing: Windows keeps saying "busy" in that case, so ask the window.
        let slack = 2;
        rect.left <= sx + slack
            && rect.top <= sy + slack
            && rect.right >= sx + sw as i32 - slack
            && rect.bottom >= sy + sh as i32 - slack
    }
}

// ── Island window ─────────────────────────────────────────────────────────────

fn hwnd_of(win: &WebviewWindow) -> Option<HWND> {
    let raw = win.hwnd().ok()?.0 as isize;
    if raw == 0 {
        return None;
    }
    Some(HWND(raw as *mut _))
}

/// Lets dropped files reach the app again.
///
/// wry installs its drop target by walking the webview's child windows **once**,
/// when the webview is created. WebView2 creates `Chrome_RenderWidgetHostHWND`
/// later and registers its own target on it; being the innermost window, that one
/// wins, and since the page has no HTML5 drop handler it refuses everything — the
/// "no drop" cursor, with nothing reaching Tauri. Revoking it makes OLE fall
/// through to the target wry registered on the parent widget, which is the one
/// that feeds Tauri's drag events.
///
/// Cheap and idempotent, so it is simply re-run whenever a drag might be starting.
pub fn unblock_webview_drops(app: &AppHandle) {
    for label in [WINDOW_LABEL, "settings"] {
        let Some(win) = app.get_webview_window(label) else { continue };
        let Some(hwnd) = hwnd_of(&win) else { continue };
        unsafe {
            let _ = EnumChildWindows(Some(hwnd), Some(revoke_render_widget), LPARAM(0));
        }
    }
}

unsafe extern "system" fn revoke_render_widget(hwnd: HWND, _: LPARAM) -> BOOL {
    let mut name = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, &mut name) };
    if len > 0 {
        let class = String::from_utf16_lossy(&name[..len as usize]);
        if class == "Chrome_RenderWidgetHostHWND" {
            // Not revoked any more: the log showed that after this nothing at all was registered
            // on the window (no parent target takes over any more), so every drop was refused.
            let result: Result<(), ()> = Ok(());
            let _ = hwnd;
            // For finding out why a drop is refused: the first few answers are written to the log
            // (Ok = there was a target and it is gone; an error = there was none to remove).
            static LOGGED: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
            if LOGGED.fetch_add(1, std::sync::atomic::Ordering::Relaxed) < 8 {
                crate::log::line(format!("drop: revoke on render widget -> {result:?}"));
            }
        }
    }
    true.into()
}

/// WS_EX_NOACTIVATE keeps clicks from stealing focus; WS_EX_TOOLWINDOW keeps the
/// island out of Alt-Tab.
pub fn make_non_activating(win: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Temporarily allow activation so a text field inside the island can be typed in.
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = if activating {
            ex & !(WS_EX_NOACTIVATE.0 as isize)
        } else {
            ex | WS_EX_NOACTIVATE.0 as isize
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Click-through here is the poll's WS_EX_TRANSPARENT toggle, not a region.
pub fn set_input_region(_win: &WebviewWindow, _rect: Option<(f64, f64, f64, f64)>) {}
