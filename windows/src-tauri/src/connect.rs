// Connections: wiring Claude Code to Coucou, from inside the app.
//
// Two things get connected, on this computer and in every WSL distro:
//   - the hooks (sessions, steps, approvals), and
//   - the status line relay (the 5-hour and weekly plan limits).
//
// This replaces running coucou_statusline.py by hand and editing WSL's settings.json
// by hand. The rules of hooks.rs still hold: nothing is written without a diff that
// was shown first, a dated backup is taken, an unreadable settings.json is an error
// and never "empty", and other people's entries are left alone.
//
// WSL's files are read and written through `wsl.exe` (the same Linux user that runs
// Claude Code), so there is no path guessing and no permission trouble.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::{json, Value};

use crate::hooks::{self, HookPreview};
use crate::{platform, settings};

const NOFILE: &str = "__COUCOU_NOFILE__";

/// One place Claude Code runs: this computer, or a WSL distro.
#[derive(Clone)]
struct Side {
    id: String,
    label: String,
    distro: Option<String>,
    /// Added to the names of this side's status line files, so two sides never share one.
    suffix: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub label: String,
    /// "local" or "wsl".
    pub kind: String,
    pub hooks: bool,
    pub statusline: bool,
    pub claude_found: bool,
    pub settings_path: String,
    pub error: Option<String>,
    /// False for a stopped WSL distro that was not looked at: reading it would start it.
    pub checked: bool,
}

/// What happens to the status line.
#[derive(Debug, PartialEq)]
enum Step {
    None,
    /// Already ours: only the wrapper script is rewritten (the relay may have moved).
    Refresh,
    /// Ours replaces `previous`, which keeps running after the relay.
    Install(Option<Value>),
    Uninstall,
}

// ── WSL ───────────────────────────────────────────────────────────────────────

/// Runs `sh -c script` in a distro. Returns (success, stdout).
fn wsl_run(distro: &str, script: &str, stdin: Option<&[u8]>) -> Result<(bool, Vec<u8>), String> {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["-d", distro, "-e", "sh", "-c", script]);
    platform::no_console(&mut cmd);
    cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("wsl.exe: {e}"))?;
    if let Some(data) = stdin {
        if let Some(mut pipe) = child.stdin.take() {
            pipe.write_all(data).map_err(|e| format!("wsl.exe: {e}"))?;
        }
    }
    let out = child.wait_with_output().map_err(|e| format!("wsl.exe: {e}"))?;
    Ok((out.status.success(), out.stdout))
}

/// `wsl.exe` prints its list in UTF-16.
fn decode_wsl(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xFF, 0xFE]).unwrap_or(bytes);
    let utf16 = bytes.len() >= 2 && bytes.iter().skip(1).step_by(2).take(8).all(|b| *b == 0);
    let text = if utf16 {
        let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    };
    text.replace(['\u{feff}', '\0', '\r'], "")
}

/// The installed distros, the default one first. Empty without WSL.
fn distros() -> Vec<String> {
    wsl_list(&["-l", "-q"])
}

/// The distros that are running right now (asking does not start anything).
fn running_distros() -> Vec<String> {
    wsl_list(&["-l", "--running", "-q"])
}

fn wsl_list(args: &[&str]) -> Vec<String> {
    if !cfg!(windows) {
        return Vec::new();
    }
    let mut cmd = Command::new("wsl.exe");
    cmd.args(args);
    platform::no_console(&mut cmd);
    let Ok(out) = cmd.stdin(Stdio::null()).output() else { return Vec::new() };
    if !out.status.success() {
        return Vec::new();
    }
    decode_wsl(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop"))
        .map(String::from)
        .collect()
}

/// `C:\Users\me\x` as WSL sees it: `/mnt/c/Users/me/x`.
fn to_wsl_path(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    let b = s.as_bytes();
    if b.len() >= 2 && b[1] == b':' {
        format!("/mnt/{}{}", (b[0] as char).to_ascii_lowercase(), &s[2..])
    } else {
        s
    }
}

// ── Sides ─────────────────────────────────────────────────────────────────────

fn local_side() -> Side {
    Side {
        id: "local".into(),
        label: if cfg!(windows) { "Windows" } else { "This computer" }.into(),
        distro: None,
        suffix: String::new(),
    }
}

fn sides() -> Vec<Side> {
    let mut all = vec![local_side()];
    for (i, name) in distros().into_iter().enumerate() {
        let safe: String = name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
            .collect();
        // The default distro keeps the name the old script gave its files ("-wsl").
        let suffix = if i == 0 { "-wsl".to_string() } else { format!("-wsl-{safe}") };
        all.push(Side { id: format!("wsl:{name}"), label: format!("WSL · {name}"), distro: Some(name), suffix });
    }
    all
}

fn find(id: &str) -> Result<Side, String> {
    if id == "local" {
        return Ok(local_side());
    }
    sides().into_iter().find(|s| s.id == id).ok_or_else(|| format!("{id} was not found"))
}

impl Side {
    /// A path of the Coucou folder as this side's shell reads it.
    fn shell(&self, p: &Path) -> String {
        if self.distro.is_some() {
            to_wsl_path(p)
        } else {
            p.to_string_lossy().replace('\\', "/")
        }
    }

    fn file(&self, stem: &str, ext: &str) -> PathBuf {
        settings::local_dir().join(format!("{stem}{}.{ext}", self.suffix))
    }

    fn wrapper_path(&self) -> PathBuf {
        self.file("statusline", "sh")
    }

    fn previous_path(&self) -> PathBuf {
        self.file("statusline-previous", "sh")
    }

    fn state_path(&self) -> PathBuf {
        self.file("statusline-state", "json")
    }

    /// The status line command that is ours.
    fn ours(&self) -> String {
        format!("sh \"{}\"", self.shell(&self.wrapper_path()))
    }

    fn hook_command(&self, event: &str) -> String {
        match self.distro {
            None => hooks::hook_command(event),
            Some(_) => {
                let exe = self.shell(&settings::hook_exe_path());
                // Double quotes, as the hooks already in WSL settings are written, unless the
                // path has something the shell would still read inside them.
                if exe.contains(['$', '`', '"', '\\']) {
                    format!("'{}' {event}", exe.replace('\'', r"'\''"))
                } else {
                    format!("\"{exe}\" {event}")
                }
            }
        }
    }

    fn settings_label(&self) -> String {
        match &self.distro {
            None => hooks::settings_path().to_string_lossy().to_string(),
            Some(d) => format!("~/.claude/settings.json ({d})"),
        }
    }
}

// ── Reading and writing settings.json ─────────────────────────────────────────

/// The file's bytes; `None` when it is not there. Anything else that goes wrong is an
/// error, because not knowing what is in there is not the same as it being empty.
fn read_raw(side: &Side) -> Result<Option<Vec<u8>>, String> {
    match &side.distro {
        None => match std::fs::read(hooks::settings_path()) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("Can't read {}: {e}", side.settings_label())),
        },
        Some(distro) => {
            let script = format!(
                "if [ -f ~/.claude/settings.json ]; then cat ~/.claude/settings.json; else printf {NOFILE}; fi"
            );
            let (ok, out) = wsl_run(distro, &script, None)?;
            if !ok {
                return Err(format!("Can't read {}", side.settings_label()));
            }
            Ok(if out == NOFILE.as_bytes() { None } else { Some(out) })
        }
    }
}

fn load(side: &Side) -> Result<(Option<Vec<u8>>, Value), String> {
    let raw = read_raw(side)?;
    let value = match &raw {
        Some(bytes) => hooks::parse_settings(bytes, &side.settings_label())?,
        None => json!({}),
    };
    Ok((raw, value))
}

fn fingerprint_of(raw: &Option<Vec<u8>>) -> String {
    hooks::fingerprint(raw.as_deref().unwrap_or(b""))
}

/// Takes the dated backup, then writes. Returns where the backup went.
fn write_settings(side: &Side, text: &str) -> Result<String, String> {
    let stamp = hooks::stamp();
    match &side.distro {
        None => Ok(hooks::replace_file(&hooks::settings_path(), text)?.to_string_lossy().to_string()),
        Some(distro) => {
            let backup = format!("~/.claude/settings.json.bak-{stamp}");
            let (ok, _) = wsl_run(
                distro,
                &format!("if [ -f ~/.claude/settings.json ]; then cp -p ~/.claude/settings.json {backup}; fi"),
                None,
            )?;
            if !ok {
                return Err("backup failed".into());
            }
            // Beside the target, then renamed over it, with the old file's permissions
            // (settings.json can hold keys): a crash never leaves half a file. The umask
            // keeps the temporary file private from the moment it exists.
            let script = "umask 077 && mkdir -p ~/.claude && cat > ~/.claude/settings.json.coucou-tmp \
                && if [ -f ~/.claude/settings.json ]; then chmod --reference=$HOME/.claude/settings.json ~/.claude/settings.json.coucou-tmp; \
                else chmod 600 ~/.claude/settings.json.coucou-tmp; fi \
                && mv ~/.claude/settings.json.coucou-tmp ~/.claude/settings.json";
            let (ok, _) = wsl_run(distro, script, Some(text.as_bytes()))?;
            if !ok {
                return Err("write failed".into());
            }
            Ok(format!("{backup} ({distro})"))
        }
    }
}

// ── Planning ──────────────────────────────────────────────────────────────────

fn hooks_on(value: &Value) -> bool {
    value
        .get("hooks")
        .and_then(Value::as_object)
        .map(|h| h.values().filter_map(Value::as_array).flatten().any(hooks::entry_is_ours))
        .unwrap_or(false)
}

fn statusline_on(side: &Side, value: &Value) -> bool {
    value.pointer("/statusLine/command").and_then(Value::as_str) == Some(side.ours().as_str())
}

/// The settings as they should be, and what happens to the status line files.
/// `previous` is the status line to give back when it is switched off.
fn plan(side: &Side, current: &Value, hooks_wanted: bool, line_wanted: bool, previous: Option<Value>) -> (Value, Step) {
    let mut next = if hooks_wanted {
        hooks::merged_with(current, &|event| side.hook_command(event))
    } else {
        hooks::without_ours(current)
    };
    let ours = side.ours();
    let line = current.get("statusLine").cloned();
    let is_ours = statusline_on(side, current);

    let step = if line_wanted {
        if is_ours {
            Step::Refresh
        } else {
            // Other keys of it (such as `padding`) stay.
            let mut obj = line.as_ref().and_then(Value::as_object).cloned().unwrap_or_default();
            obj.insert("type".into(), json!("command"));
            obj.insert("command".into(), json!(ours));
            next["statusLine"] = Value::Object(obj);
            Step::Install(line)
        }
    } else if is_ours {
        match previous {
            Some(old) => next["statusLine"] = old,
            None => {
                if let Some(map) = next.as_object_mut() {
                    map.remove("statusLine");
                }
            }
        }
        Step::Uninstall
    } else {
        Step::None
    };
    (next, step)
}

fn read_previous(side: &Side) -> Option<Value> {
    let bytes = std::fs::read(side.state_path()).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value.get("previous").cloned().filter(|p| !p.is_null())
}

fn wrapper_text(side: &Side) -> String {
    let hook = side.shell(&settings::hook_exe_path());
    let previous = side.shell(&side.previous_path());
    format!(
        "#!/bin/sh\n\
         # coucou-statusline: forwards Claude Code's plan limits to Coucou, then runs the status line you had.\n\
         input=$(cat)\n\
         printf '%s' \"$input\" | \"{hook}\" --statusline-relay >/dev/null 2>&1\n\
         if [ -f \"{previous}\" ]; then\n\
         \x20 printf '%s' \"$input\" | sh \"{previous}\"\n\
         fi\n"
    )
}

/// The files the status line relay needs. `after` is the half that runs once the
/// settings are written (taking the files away); the rest runs before.
fn support(side: &Side, step: &Step, after: bool) -> Result<(), String> {
    let io = |e: std::io::Error| e.to_string();
    match step {
        Step::Install(prev) if !after => {
            platform::ensure_private_dir(&settings::local_dir()).map_err(io)?;
            match prev.as_ref().and_then(|p| p.get("command")).and_then(Value::as_str) {
                Some(cmd) if !cmd.is_empty() => {
                    std::fs::write(side.previous_path(), format!("{cmd}\n")).map_err(io)?
                }
                _ => {
                    let _ = std::fs::remove_file(side.previous_path());
                }
            }
            let state = json!({ "previous": prev, "installedAt": hooks::stamp() });
            std::fs::write(side.state_path(), serde_json::to_vec_pretty(&state).unwrap_or_default()).map_err(io)?;
            std::fs::write(side.wrapper_path(), wrapper_text(side)).map_err(io)?;
        }
        Step::Refresh if !after => {
            platform::ensure_private_dir(&settings::local_dir()).map_err(io)?;
            std::fs::write(side.wrapper_path(), wrapper_text(side)).map_err(io)?;
        }
        Step::Uninstall if after => {
            for path in [side.wrapper_path(), side.previous_path(), side.state_path()] {
                let _ = std::fs::remove_file(path);
            }
        }
        _ => {}
    }
    Ok(())
}

// ── Public API ────────────────────────────────────────────────────────────────

fn describe(side: &Side) -> Target {
    let kind = if side.distro.is_some() { "wsl" } else { "local" }.to_string();
    let base = |hooks: bool, statusline: bool, found: bool, error: Option<String>| Target {
        id: side.id.clone(),
        label: side.label.clone(),
        kind: kind.clone(),
        hooks,
        statusline,
        claude_found: found,
        settings_path: side.settings_label(),
        error,
        checked: true,
    };
    match load(side) {
        Ok((raw, value)) => {
            let found = raw.is_some()
                || match &side.distro {
                    None => hooks::settings_path().parent().map(Path::exists).unwrap_or(false),
                    Some(d) => wsl_run(d, "test -d ~/.claude", None).map(|(ok, _)| ok).unwrap_or(false),
                };
            base(hooks_on(&value), statusline_on(side, &value), found, None)
        }
        Err(e) => base(false, false, false, Some(e)),
    }
}

/// Every place Claude Code may run. A WSL distro that is stopped is only listed (reading its
/// files would start it) unless its id is in `wake`: the user asked to check it.
pub fn targets(wake: &[String]) -> Vec<Target> {
    let all = sides();
    let running = if all.iter().any(|s| s.distro.is_some()) { running_distros() } else { Vec::new() };
    all.iter()
        .map(|side| match &side.distro {
            Some(d) if !running.contains(d) && !wake.contains(&side.id) => Target {
                id: side.id.clone(),
                label: side.label.clone(),
                kind: "wsl".into(),
                hooks: false,
                statusline: false,
                claude_found: false,
                settings_path: side.settings_label(),
                error: None,
                checked: false,
            },
            _ => describe(side),
        })
        .collect()
}

/// The diff of what switching things on or off would write.
pub fn preview(id: &str, hooks_wanted: bool, line_wanted: bool) -> Result<HookPreview, String> {
    let side = find(id)?;
    let (raw, current) = load(&side)?;
    let (next, _) = plan(&side, &current, hooks_wanted, line_wanted, read_previous(&side));
    Ok(HookPreview {
        diff: hooks::unified_diff(&hooks::pretty(&current), &hooks::pretty(&next)),
        backup: format!("settings.json.bak-{}", hooks::stamp()),
        settings_path: side.settings_label(),
        fingerprint: fingerprint_of(&raw),
    })
}

/// Writes the change the user reviewed. If the file changed since, nothing is written.
pub fn apply(id: &str, hooks_wanted: bool, line_wanted: bool, fingerprint: &str) -> Result<String, String> {
    let side = find(id)?;
    let (raw, current) = load(&side)?;
    if fingerprint_of(&raw) != fingerprint {
        return Err(format!(
            "{} changed since the preview. Nothing was written — review the new diff.",
            side.settings_label()
        ));
    }
    let (next, step) = plan(&side, &current, hooks_wanted, line_wanted, read_previous(&side));
    support(&side, &step, false)?;
    let mut text = hooks::pretty(&next);
    text.push('\n');
    let backup = write_settings(&side, &text)?;
    support(&side, &step, true)?;
    Ok(backup)
}

/// Takes Coucou out of every Claude Code settings.json it is in (this computer and each
/// WSL distro). Run by the uninstaller (`coucou.exe --disconnect`) after the user agreed.
/// A backup is taken; a settings.json that can't be read is left alone.
pub fn disconnect_all() {
    for side in sides() {
        let Ok((_, current)) = load(&side) else { continue };
        let (next, step) = plan(&side, &current, false, false, read_previous(&side));
        if next != current {
            let mut text = hooks::pretty(&next);
            text.push('\n');
            if let Err(e) = write_settings(&side, &text) {
                crate::log::line(format!("disconnect {}: {e}", side.id));
                continue;
            }
        }
        let _ = support(&side, &step, true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wsl() -> Side {
        Side { id: "wsl:Ubuntu".into(), label: "WSL · Ubuntu".into(), distro: Some("Ubuntu".into()), suffix: "-wsl".into() }
    }

    #[test]
    fn windows_paths_become_mnt_paths() {
        assert_eq!(to_wsl_path(Path::new(r"C:\Users\me\AppData\Local\Coucou")), "/mnt/c/Users/me/AppData/Local/Coucou");
    }

    #[test]
    fn the_wsl_list_is_decoded_from_utf16() {
        let bytes: Vec<u8> = "\u{feff}Ubuntu\r\ndocker-desktop\r\n".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(decode_wsl(&bytes).lines().next(), Some("Ubuntu"));
    }

    #[test]
    fn installing_then_removing_gives_the_settings_back() {
        let side = wsl();
        let original = json!({
            "model": "opus",
            "statusLine": { "type": "command", "command": "echo hi", "padding": 1 },
            "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "other-tool" }] }] }
        });
        let (on, step) = plan(&side, &original, true, true, None);
        assert_eq!(step, Step::Install(original.get("statusLine").cloned()));
        assert!(hooks_on(&on) && statusline_on(&side, &on));
        assert_eq!(on["statusLine"]["padding"], 1, "other keys of the status line stay");

        let (off, step) = plan(&side, &on, false, false, original.get("statusLine").cloned());
        assert_eq!(step, Step::Uninstall);
        assert_eq!(off, original);
    }

    #[test]
    fn switching_the_status_line_off_without_a_previous_one_removes_the_key() {
        let side = wsl();
        let (on, _) = plan(&side, &json!({}), false, true, None);
        let (off, _) = plan(&side, &on, false, false, None);
        assert_eq!(off, json!({}));
    }

    /// Everything filesystem-shaped lives in one test on purpose: it points the home directory at a
    /// temp directory, and that is process-wide.
    #[test]
    fn writing_backs_up_preserves_and_refuses_a_changed_file() {
        let tmp = std::env::temp_dir().join(format!("coucou-connect-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join(".claude")).unwrap();
        std::env::set_var(platform::HOME_VAR, &tmp);

        let path = hooks::settings_path();
        assert!(path.starts_with(&tmp), "the test must not touch the real home");

        // A real-shaped file, written the way PowerShell 5 would: UTF-8 with BOM.
        let original = r#"{"model":"claude-opus-5","theme":"dark","tui":{"x":1},"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"other-tool.exe"}]}]}}"#;
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(original.as_bytes());
        std::fs::write(&path, &bytes).unwrap();

        // Connect the hooks.
        let plan = preview("local", true, false).expect("a BOM must not stop the preview");
        assert!(plan.diff.contains("coucou-hook"), "the diff must show what changes");
        let backup = apply("local", true, false, &plan.fingerprint).expect("connecting should succeed");

        // The backup holds the original bytes, BOM and all.
        assert_eq!(std::fs::read(&backup).unwrap(), bytes);

        // Everything else survived, and so did the other tool's hook.
        let after: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["tui"]["x"], 1);
        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("other-tool.exe")));
        assert!(hooks::status().installed);

        // A file that moved since the preview is refused, and left alone.
        let stale = preview("local", false, false).unwrap();
        std::fs::write(&path, br#"{"model":"someone-else-edited-this"}"#).unwrap();
        let err = apply("local", false, false, &stale.fingerprint).unwrap_err();
        assert!(err.contains("changed since the preview"), "got: {err}");
        let untouched: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(untouched["model"], "someone-else-edited-this");

        // Content we cannot parse is refused before anything is written.
        std::fs::write(&path, b"{ broken").unwrap();
        assert!(preview("local", true, false).is_err());
        assert!(apply("local", true, false, "whatever").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{ broken");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
