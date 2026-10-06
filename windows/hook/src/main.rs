//! coucou-hook — the relay Claude Code runs on every hook event.
//!
//! Reads the hook JSON on stdin, adds a little terminal context, and hands it to
//! Coucou over the named pipe `\\.\pipe\coucou-<sid>` (Windows) or the Unix
//! socket `$XDG_RUNTIME_DIR/coucou.sock` (Linux).
//!
//! Hard rule (docs/CLAUDE.md): **never block Claude Code.**
//! * If the pipe does not exist — Coucou is closed — we exit 0 immediately with
//!   nothing on stdout, and the session carries on untouched.
//! * Every step runs under a deadline enforced by the main thread, so a pipe that
//!   accepts the connection and then stops reading cannot wedge the session
//!   either: we abandon the worker and exit.
//! * Only `PermissionRequest` waits for an answer, because approving from the
//!   island is the whole point. No answer means empty stdout, and Claude Code
//!   asks in the terminal exactly as if Coucou were not installed.
//!
//! Usage: `coucou-hook <EventName>` (the name is also read from the JSON).

use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::Duration;

/// Budget for getting a pipe connection. Beyond this Claude Code wins, always.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
/// Whole-run budget for an event nobody waits on: connect and write, no more.
const FIRE_AND_FORGET_BUDGET: Duration = Duration::from_secs(2);
/// How long a permission prompt may stay on screen before the terminal takes over.
const DECISION_BUDGET: Duration = Duration::from_secs(110);

/// Fields that are pointless to forward and can be enormous (a whole file read,
/// a full command output). The island never shows them.
const DROPPED_FIELDS: &[&str] = &["tool_response", "transcript_path"];
/// Longest string forwarded for any single field; the island truncates to far
/// less than this anyway.
///
/// This is in BYTES, not characters: a Japanese character takes three, so 2 000 bytes cut
/// a reply off after about 660 characters. The fields the island reads in full have
/// their own, larger allowance (see `limit_for`).
const MAX_FIELD_LEN: usize = 4_000;

#[cfg(windows)]
mod win;
#[cfg(windows)]
use win::connect;

#[cfg(target_os = "linux")]
mod unix;
#[cfg(target_os = "linux")]
use unix::connect;

fn main() {
    // Claude Code's status line: pass the plan limits on, print nothing, never wait.
    if std::env::args().skip(1).any(|a| a == "--statusline-relay") {
        statusline_relay();
        std::process::exit(0);
    }

    let Some((payload, event)) = read_event() else { std::process::exit(0) };

    let waits_for_answer = event == "PermissionRequest";
    let budget = if waits_for_answer { DECISION_BUDGET } else { FIRE_AND_FORGET_BUDGET };

    // The worker owns every blocking call. If it overruns the budget we simply
    // stop listening and exit: the process dying takes the pipe handle with it.
    // (No catch_unwind here — the release profile is panic = "abort", so it would
    // be dead code. `talk` is written to have nothing to panic on instead.)
    let (tx, rx) = mpsc::channel::<Option<String>>();
    // An AskUserQuestion answer is built from the questions in this same payload.
    let original = payload.clone();
    std::thread::spawn(move || {
        let _ = tx.send(talk(&payload, waits_for_answer));
    });

    if let Ok(Some(decision)) = rx.recv_timeout(budget) {
        let json = match decision.strip_prefix("answers:") {
            Some(answers) => answers_json(answers, &original),
            None => decision_json(&decision),
        };
        if let Some(json) = json {
            let mut out = std::io::stdout();
            let _ = writeln!(out, "{json}");
            let _ = out.flush();
        }
    }
    // Nothing printed: Claude Code asks in the terminal, as if we were not here.
    std::process::exit(0);
}

/// `--statusline-relay`: reads the JSON Claude Code gives its status line command
/// and forwards the plan limits (`rate_limits`) and the session id to Coucou.
/// It prints nothing: the status line you already had is run by the wrapper script
/// around this call (see scripts/coucou_statusline.py), so what it shows is untouched.
/// Same rules as every other relay run: a short deadline, silence if Coucou is closed.
fn statusline_relay() {
    let mut raw = Vec::new();
    if std::io::stdin().take(1_000_000).read_to_end(&mut raw).is_err() || raw.is_empty() {
        return;
    }
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }
    let Ok(input) = serde_json::from_slice::<serde_json::Value>(&raw) else { return };
    // Free plans, and a session's first answer, have no `rate_limits`: nothing to say.
    let Some(limits) = input.get("rate_limits").filter(|v| v.is_object()) else { return };

    // Where Claude Code is running tells which one it is: a Linux path is WSL, a drive
    // letter is Windows. The two may be signed in to different accounts, so the island
    // keeps their limits apart.
    let cwd = input
        .get("cwd")
        .or_else(|| input.get("workspace").and_then(|w| w.get("current_dir")));
    let mut line = serde_json::json!({
        "coucou_kind": "statusline",
        "session_id": input.get("session_id"),
        "cwd": cwd,
        "rate_limits": limits,
    })
    .to_string();
    line.push('\n');

    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let _ = tx.send(talk(&line, false));
    });
    let _ = rx.recv_timeout(FIRE_AND_FORGET_BUDGET);
}

/// The documented PermissionRequest output. Anything we do not recognise prints
/// nothing at all rather than guessing — silence is the safe answer.
/// See https://code.claude.com/docs/en/hooks
fn decision_json(decision: &str) -> Option<String> {
    let behavior = match decision.trim() {
        // "always" still answers a plain allow; remembering it is the island's
        // business, not Claude Code's.
        "allow" | "always" => r#"{"behavior":"allow"}"#.to_string(),
        "deny" => r#"{"behavior":"deny","message":"Denied from Coucou"}"#.to_string(),
        _ => return None,
    };
    Some(format!(
        r#"{{"hookSpecificOutput":{{"hookEventName":"PermissionRequest","decision":{behavior}}}}}"#
    ))
}

/// The answer to an AskUserQuestion: allow, with the tool input carrying the
/// questions it was called with plus `answers` (question text → chosen label), which
/// is how Claude Code takes an answer that was given somewhere other than its own
/// prompt. No questions in the payload, or answers that are not an object: silence.
fn answers_json(answers: &str, payload: &str) -> Option<String> {
    let answers: serde_json::Value = serde_json::from_str(answers).ok()?;
    if !answers.is_object() {
        return None;
    }
    let payload: serde_json::Value = serde_json::from_str(payload).ok()?;
    let questions = payload.get("tool_input")?.get("questions")?.clone();
    Some(
        serde_json::json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": {
                    "behavior": "allow",
                    "updatedInput": { "questions": questions, "answers": answers }
                }
            }
        })
        .to_string(),
    )
}

/// Reads stdin and returns the payload to forward plus the event name.
fn read_event() -> Option<(String, String)> {
    let mut raw = Vec::new();
    if std::io::stdin().read_to_end(&mut raw).is_err() || raw.is_empty() {
        return None;
    }
    // Some shells hand us a UTF-8 BOM; serde_json would choke on it.
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }

    let mut payload = serde_json::from_slice::<serde_json::Value>(&raw).ok()?;
    let map = payload.as_object_mut()?;

    // Parse argv: "coucou-hook.exe [--agent <name>] [<EventName>]"
    // --agent tags the payload with coucou_agent so the app routes to the right pill.
    // Absent or invalid names are validated and discarded by the app, not here.
    let mut agent = String::new();
    let mut arg_event = String::new();
    {
        let mut it = std::env::args().skip(1);
        while let Some(arg) = it.next() {
            if arg == "--agent" {
                agent = it.next().unwrap_or_default();
            } else if arg_event.is_empty() {
                arg_event = arg;
            }
        }
    }
    // Which agent this hook was installed for. Absent means Claude Code,
    // so existing hook commands keep working unchanged.
    if !agent.is_empty() {
        map.insert("coucou_agent".into(), serde_json::Value::String(agent));
    }
    let event = map
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or(arg_event);
    map.insert("hook_event_name".into(), serde_json::Value::String(event.clone()));

    // What a shell command printed (an `npm test` result) is shown on the island. What
    // every other tool answered (a whole file, say) is not worth forwarding.
    let keep_output = matches!(
        map.get("tool_name").and_then(|v| v.as_str()),
        Some("Bash") | Some("PowerShell")
    );
    for field in DROPPED_FIELDS {
        if *field == "tool_response" && keep_output {
            continue;
        }
        map.remove(*field);
    }

    let cwd_missing = map
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::is_empty)
        .unwrap_or(true);
    if cwd_missing {
        if let Ok(cwd) = std::env::current_dir() {
            map.insert(
                "cwd".into(),
                serde_json::Value::String(cwd.to_string_lossy().to_string()),
            );
        }
    }

    // Which terminal the session runs in. Unlike macOS, Coucou here accepts
    // events from every terminal, so this is context only — never a filter.
    for (key, var) in [
        ("term_program", "TERM_PROGRAM"),
        ("wt_session", "WT_SESSION"),
        ("term_session_id", "TERM_SESSION_ID"),
        ("vscode_pid", "VSCODE_PID"),
        ("session_pid", "CLAUDE_CODE_SSE_PORT"),
    ] {
        if !map.contains_key(key) {
            let value = std::env::var(var).unwrap_or_default();
            map.insert(key.into(), serde_json::Value::String(value));
        }
    }

    truncate_strings(&mut payload, None);

    let mut line = payload.to_string();
    line.push('\n');
    Some((line, event))
}

/// How many bytes a string may keep, by the name of the field it is in. The island
/// shows Claude's whole reply and the text of an edit, so those are not cut short; a
/// whole payload still stays well under what the pipe accepts (1 MB).
fn limit_for(key: Option<&str>) -> usize {
    match key {
        Some("last_assistant_message") => 96_000,
        Some("prompt") => 24_000,
        Some("content") | Some("old_string") | Some("new_string") | Some("new_source") => 24_000,
        // What a command printed: the end is the result (the failing test, the exit message).
        Some("stdout") | Some("stderr") => 16_000,
        _ => MAX_FIELD_LEN,
    }
}

/// Caps every string in the payload. A single Write can carry a whole file.
fn truncate_strings(value: &mut serde_json::Value, key: Option<&str>) {
    match value {
        serde_json::Value::String(s) => {
            let limit = limit_for(key);
            if s.len() > limit && matches!(key, Some("stdout") | Some("stderr")) {
                // Keep the tail, from a char boundary.
                let mut start = s.len() - limit;
                while start < s.len() && !s.is_char_boundary(start) {
                    start += 1;
                }
                *s = format!("…{}", &s[start..]);
            } else if s.len() > limit {
                // Cut on a char boundary; a lone byte index can split UTF-8.
                let mut end = limit;
                while end > 0 && !s.is_char_boundary(end) {
                    end -= 1;
                }
                s.truncate(end);
                s.push('…');
            }
        }
        // An array keeps its field's name: the `edits` of a MultiEdit are objects of old / new text.
        serde_json::Value::Array(items) => items.iter_mut().for_each(|v| truncate_strings(v, key)),
        serde_json::Value::Object(map) => map.iter_mut().for_each(|(k, v)| truncate_strings(v, Some(k.as_str()))),
        _ => {}
    }
}

/// Connect, send, and — for a permission request — wait for the island's word.
fn talk(payload: &str, waits_for_answer: bool) -> Option<String> {
    let mut pipe = connect()?;

    if pipe.write_all(payload.as_bytes()).is_err() {
        return None;
    }
    let _ = pipe.flush();

    if !waits_for_answer {
        return None;
    }

    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.contains(&b'\n') {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let answer = String::from_utf8_lossy(&buf).trim().to_string();
    (!answer.is_empty()).then_some(answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decision_json_matches_the_documented_shape() {
        assert_eq!(
            decision_json("allow").unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#
        );
        assert_eq!(
            decision_json("deny").unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied from Coucou"}}}"#
        );
        // "always" is an island concept; Claude Code just gets an allow.
        assert!(decision_json("always").unwrap().contains(r#""behavior":"allow""#));
    }

    #[test]
    fn anything_unrecognised_prints_nothing() {
        assert!(decision_json("").is_none());
        assert!(decision_json("maybe").is_none());
        // The shape the app used to send must not be mistaken for a decision.
        assert!(decision_json(r#"{"permissionDecision":"allow"}"#).is_none());
    }

    #[test]
    fn answers_carry_the_original_questions() {
        let payload = r#"{"hook_event_name":"PermissionRequest","tool_input":{"questions":[{"question":"Which?","options":[{"label":"A"},{"label":"B"}]}]}}"#;
        let out = answers_json(r#"{"Which?":"A"}"#, payload).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let d = &v["hookSpecificOutput"]["decision"];
        assert_eq!(d["behavior"], "allow");
        assert_eq!(d["updatedInput"]["answers"]["Which?"], "A");
        assert_eq!(d["updatedInput"]["questions"][0]["question"], "Which?");
    }

    #[test]
    fn answers_without_questions_print_nothing() {
        assert!(answers_json(r#"{"Which?":"A"}"#, r#"{"tool_input":{}}"#).is_none());
        assert!(answers_json("[]", r#"{"tool_input":{"questions":[]}}"#).is_none());
        assert!(answers_json("nonsense", "{}").is_none());
    }

    #[test]
    fn long_strings_are_cut_on_a_char_boundary() {
        let mut v = serde_json::json!({ "tool_input": { "other": "é".repeat(4000) } });
        truncate_strings(&mut v, None);
        let s = v["tool_input"]["other"].as_str().unwrap();
        assert!(s.len() <= MAX_FIELD_LEN + 4);
        assert!(s.ends_with('…'));
    }

    #[test]
    fn a_long_reply_and_an_edit_keep_far_more() {
        // 30 000 Japanese characters = 90 000 bytes: under the reply's allowance.
        let reply = "あ".repeat(30_000);
        let mut v = serde_json::json!({
            "last_assistant_message": reply,
            "tool_input": { "edits": [{ "old_string": "x".repeat(20_000), "new_string": "y".repeat(30_000) }] },
        });
        truncate_strings(&mut v, None);
        assert_eq!(v["last_assistant_message"].as_str().unwrap().chars().count(), 30_000);
        assert_eq!(v["tool_input"]["edits"][0]["old_string"].as_str().unwrap().len(), 20_000);
        // Past its own allowance it is still cut.
        assert!(v["tool_input"]["edits"][0]["new_string"].as_str().unwrap().ends_with('…'));
    }
}
