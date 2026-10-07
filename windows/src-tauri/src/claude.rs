// Claude API client — the same integration as ClaudeService.swift: multi-turn
// chat with web search, and files sent as document/image/text blocks.
//
// Everything happens here rather than in the island: the API key never leaves
// the Credential Manager, and file bytes never cross the IPC boundary.

use std::io::Write;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::secrets;

const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Server-side fallback: on a policy decline the API retries the same request on
/// a fallback model inside the same call, so the island never shows a dead end.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const MAX_TOKENS: u32 = 4096;
/// Text and code files are inlined; anything larger is skipped, as on macOS.
const MAX_INLINE_TEXT: u64 = 200_000;

pub const DEFAULT_MODEL: &str = "claude-opus-5";

const SYSTEM_PROMPT: &str = "You are Mochi, a personal AI assistant living at the top of the user's screen. \
You have web search access and can help with absolutely anything — research, coding, finding places, recommendations, tasks, questions. \
Respond in the user's language. Be thorough and complete — use as much detail as the task requires. \
No markdown formatting (no **, no ##, no bullet dashes). Use plain text with line breaks.";

/// Session ids the built-in chat has used with the Claude CLI. Hook events from
/// those sessions are the chat's own business, not Claude Code work to show on the
/// island (see pipe.rs).
static CHAT_SESSIONS: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn is_chat_session(id: &str) -> bool {
    !id.is_empty() && CHAT_SESSIONS.lock().unwrap().iter().any(|s| s == id)
}

/// One chat conversation on the Claude CLI.
struct CliSession {
    id: String,
    /// The first turn went through, so later ones `--resume` it.
    started: bool,
    /// Which launcher worked: the Windows CLI, or the one inside WSL.
    wsl: bool,
}

#[derive(Default)]
pub struct Chat {
    /// Full multi-turn history, including tool_use / tool_result blocks.
    messages: Mutex<Vec<Value>>,
    /// Used instead of `messages` when there is no API key.
    cli: Mutex<Option<CliSession>>,
}

impl Chat {
    pub fn reset(&self) {
        self.messages.lock().unwrap().clear();
        *self.cli.lock().unwrap() = None;
    }

    fn is_empty(&self) -> bool {
        self.messages.lock().unwrap().is_empty()
    }

    fn push(&self, message: Value) {
        self.messages.lock().unwrap().push(message);
    }

    fn pop(&self) {
        self.messages.lock().unwrap().pop();
    }

    fn snapshot(&self) -> Vec<Value> {
        self.messages.lock().unwrap().clone()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatContext {
    File { name: String, path: String },
    /// Several dropped files at once.
    Files { files: Vec<FileRef> },
    Window { app_name: String, title: String, url: Option<String> },
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileRef {
    pub name: String,
    pub path: String,
}

/// The context as a list of single items: `Files` becomes one `File` each.
fn expand_context(context: Option<ChatContext>) -> Vec<ChatContext> {
    match context {
        None => Vec::new(),
        Some(ChatContext::Files { files }) => files
            .into_iter()
            .take(8)
            .map(|f| ChatContext::File { name: f.name, path: f.path })
            .collect(),
        Some(other) => vec![other],
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
}

/// One chat turn. Returns the assistant's text, or a message the island shows
/// in the note view.
pub async fn send(
    chat: &Chat,
    model: &str,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    // No API key: the chat runs on the Claude CLI the user is already signed into.
    let Some(key) = secrets::get("anthropic-api-key") else {
        return send_cli(chat, model, query, context).await;
    };

    let mut content: Vec<Value> = Vec::new();

    // File / window context rides along with the first message only, exactly
    // like ClaudeService.chat().
    if chat.is_empty() {
        for item in expand_context(context) {
            match &item {
                ChatContext::File { name, path } => {
                    if let Some(block) = file_block(path) {
                        content.push(block);
                    }
                    content.push(json!({ "type": "text", "text": format!("File: {name}") }));
                }
                ChatContext::Window { app_name, title, url } => {
                    let mut text = format!("Context — App: {app_name}, Window: {title}");
                    if let Some(url) = url {
                        text.push_str(&format!(", URL: {url}"));
                    }
                    content.push(json!({ "type": "text", "text": text }));
                }
                ChatContext::Files { .. } => {}
            }
        }
    }
    content.push(json!({ "type": "text", "text": query }));

    chat.push(json!({ "role": "user", "content": content }));

    let body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT,
        "tools": [{ "type": "web_search_20260209", "name": "web_search", "max_uses": 5 }],
        "fallbacks": "default",
        "messages": chat.snapshot(),
    });

    let response = match call(&key, &body).await {
        Ok(v) => v,
        Err(err) => {
            chat.pop(); // keep the history consistent with what the model saw
            return Err(err);
        }
    };

    // A policy decline comes back as HTTP 200 with stop_reason "refusal".
    if response.get("stop_reason").and_then(Value::as_str) == Some("refusal") {
        chat.pop();
        let why = response
            .get("stop_details")
            .and_then(|d| d.get("explanation"))
            .and_then(Value::as_str)
            .unwrap_or("Claude declined this one.");
        return Err(why.to_string());
    }

    let Some(blocks) = response.get("content").and_then(Value::as_array).cloned() else {
        chat.pop();
        return Err("Unexpected API response.".into());
    };

    // Store the whole content — tool_use / tool_result blocks included — so the
    // next turn has the right context.
    chat.push(json!({ "role": "assistant", "content": blocks.clone() }));

    let text = blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("No response text.".into());
    }
    Ok(ChatReply { text })
}

// ── Claude CLI ────────────────────────────────────────────────────────────────

#[derive(Clone)]
enum Launcher {
    Native(std::path::PathBuf),
    /// `claude` inside WSL, reached through wsl.exe.
    #[cfg(windows)]
    Wsl,
}

impl Launcher {
    fn is_wsl(&self) -> bool {
        match self {
            Launcher::Native(_) => false,
            #[cfg(windows)]
            Launcher::Wsl => true,
        }
    }
}

/// Where a `claude` can be started. Before the first answer both the Windows CLI
/// and the WSL one are candidates; after it only the one that worked.
fn launchers(started: bool, wsl_worked: bool) -> Vec<Launcher> {
    let mut out = Vec::new();
    if !started || !wsl_worked {
        if let Some(path) = crate::platform::find_on_path("claude") {
            out.push(Launcher::Native(path));
        }
    }
    #[cfg(windows)]
    {
        if (!started || wsl_worked) && crate::platform::find_on_path("wsl").is_some() {
            out.push(Launcher::Wsl);
        }
    }
    out
}

/// CLI model names are aliases; the API ids the settings hold map onto them.
fn cli_model(model: &str) -> String {
    let lower = model.to_ascii_lowercase();
    for alias in ["opus", "sonnet", "haiku"] {
        if lower.contains(alias) {
            return alias.to_string();
        }
    }
    model.to_string()
}

/// A random UUID (v4) without pulling in a crate for it.
fn new_uuid() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut b = [0u8; 16];
    for half in 0..2 {
        let n = std::collections::hash_map::RandomState::new().build_hasher().finish();
        b[half * 8..half * 8 + 8].copy_from_slice(&n.to_le_bytes());
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: Vec<String> = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        hex[0..4].concat(),
        hex[4..6].concat(),
        hex[6..8].concat(),
        hex[8..10].concat(),
        hex[10..16].concat()
    )
}

/// C:\Users\me\a.png → /mnt/c/Users/me/a.png, for the CLI inside WSL.
fn to_wsl_path(path: &str) -> String {
    let b = path.as_bytes();
    if b.len() >= 3 && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') && b[0].is_ascii_alphabetic() {
        let rest = path[3..].replace('\\', "/");
        return format!("/mnt/{}/{}", (b[0] as char).to_ascii_lowercase(), rest);
    }
    path.replace('\\', "/")
}

/// Text and code files go into the prompt as they are; images and PDFs do not.
fn file_text(path: &str) -> Option<String> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if matches!(ext.as_str(), "pdf" | "jpg" | "jpeg" | "png" | "gif" | "webp") {
        return None;
    }
    if std::fs::metadata(path).ok()?.len() > MAX_INLINE_TEXT {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// One chat turn on the Claude CLI: `claude -p`, the prompt on stdin, one session
/// per conversation so follow-ups remember what came before.
async fn send_cli(
    chat: &Chat,
    model: &str,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let (session_id, started, wsl_worked) = {
        let mut slot = chat.cli.lock().unwrap();
        let session = slot.get_or_insert_with(|| {
            let id = new_uuid();
            CHAT_SESSIONS.lock().unwrap().push(id.clone());
            CliSession { id, started: false, wsl: false }
        });
        (session.id.clone(), session.started, session.wsl)
    };

    let candidates = launchers(started, wsl_worked);
    if candidates.is_empty() {
        return Err("No API key, and the Claude CLI was not found. Install Claude Code or add a key in settings.".into());
    }

    let contexts = expand_context(context);
    let model = cli_model(model);
    // The model comes from settings.json: never something that could read as an option.
    if model.is_empty() || model.starts_with('-') || model.contains(char::is_whitespace) {
        return Err("The chat model in settings is not a valid model name.".into());
    }
    let mut first_error: Option<String> = None;
    for launcher in candidates {
        let wsl = launcher.is_wsl();

        // Everything that depends on where the CLI runs: file paths, and so the prompt.
        let path_for_cli = |p: &str| if wsl { to_wsl_path(p) } else { p.to_string() };
        let mut prompt = String::new();
        let mut tools = vec!["WebSearch", "WebFetch"];
        let mut add_dirs: Vec<String> = Vec::new();
        if !started {
            prompt.push_str(SYSTEM_PROMPT);
            prompt.push_str("\n\n");
            for item in &contexts {
                match item {
                    ChatContext::File { name, path } => match file_text(path) {
                        Some(text) => prompt.push_str(&format!("File: {name}\nFile contents:\n{text}\n\n")),
                        None => {
                            let shown = path_for_cli(path);
                            prompt.push_str(&format!(
                                "File: {name} (saved at {shown}). Read it with the Read tool if you need it.\n\n"
                            ));
                            if !tools.contains(&"Read") {
                                tools.push("Read");
                            }
                            let dir = if wsl {
                                std::path::Path::new(&shown).parent().map(|d| d.to_string_lossy().replace('\\', "/"))
                            } else {
                                std::path::Path::new(path).parent().map(|d| d.to_string_lossy().to_string())
                            };
                            if let Some(dir) = dir {
                                if !add_dirs.contains(&dir) {
                                    add_dirs.push(dir);
                                }
                            }
                        }
                    },
                    ChatContext::Window { app_name, title, url } => {
                        prompt.push_str(&format!("Context — App: {app_name}, Window: {title}"));
                        if let Some(url) = url {
                            prompt.push_str(&format!(", URL: {url}"));
                        }
                        prompt.push_str("\n\n");
                    }
                    ChatContext::Files { .. } => {}
                }
            }
        }
        prompt.push_str(&query);

        let tool_list = tools.join(",");
        let mut args: Vec<String> = vec![
            "-p".into(),
            "--output-format".into(),
            "json".into(),
            format!("--model={model}"),
            "--tools".into(),
            tool_list.clone(),
            "--allowedTools".into(),
            tool_list,
            if started { "--resume".into() } else { "--session-id".into() },
            session_id.clone(),
        ];
        for dir in &add_dirs {
            // `=` binds the folder to the option, whatever the name looks like.
            args.push(format!("--add-dir={dir}"));
        }

        let handle = tauri::async_runtime::spawn_blocking(move || run_cli(&launcher, &args, &prompt));
        let outcome = match tokio::time::timeout(Duration::from_secs(240), handle).await {
            Ok(Ok(result)) => result,
            Ok(Err(err)) => Err(err.to_string()),
            Err(_) => Err("The Claude CLI took too long.".to_string()),
        };
        match outcome {
            Ok(text) => {
                if let Some(session) = chat.cli.lock().unwrap().as_mut() {
                    session.started = true;
                    session.wsl = wsl;
                }
                return Ok(ChatReply { text });
            }
            Err(err) => {
                crate::log::line(format!("chat on the Claude CLI failed ({}): {}", if wsl { "WSL" } else { "Windows" }, err.chars().take(200).collect::<String>()));
                first_error.get_or_insert(err);
            }
        }
    }

    // Nothing answered. A session the CLI may have half-created is not reused.
    if !started {
        *chat.cli.lock().unwrap() = None;
    }
    Err(first_error.unwrap_or_else(|| "The Claude CLI did not answer.".into()))
}

/// One install's answer to `/usage`.
#[derive(Serialize)]
pub struct PlanProbe {
    /// "windows" or "wsl".
    pub source: String,
    /// The text `/usage` printed (the island reads the numbers out of it).
    pub text: String,
    /// `claude auth status` as JSON: which account this is (email, plan). Never a token.
    pub auth: Option<String>,
}

/// Asks every Claude Code install for its plan limits: `claude -p "/usage"`, which
/// the CLI answers by itself, without calling the model (no cost, a second or two).
/// An install that is missing, signed out or slow is simply left out.
///
/// The session ids are registered like the chat's, so the island does not show these
/// runs as sessions.
pub async fn plan_probe() -> Vec<PlanProbe> {
    let mut jobs = Vec::new();
    for launcher in launchers(false, false) {
        let wsl = launcher.is_wsl();
        let id = new_uuid();
        {
            let mut known = CHAT_SESSIONS.lock().unwrap();
            if known.len() > 200 {
                known.drain(..100);
            }
            known.push(id.clone());
        }
        let args: Vec<String> = vec![
            "-p".into(),
            "--output-format".into(),
            "json".into(),
            "--no-session-persistence".into(),
            "--session-id".into(),
            id,
        ];
        // Which account: asked at the same time, since two installs may be signed in to
        // different ones and their limits are not the same.
        let for_auth = launcher.clone();
        let auth_args: Vec<String> = vec!["auth".into(), "status".into()];
        let auth_job = tauri::async_runtime::spawn_blocking(move || run_raw(&for_auth, &auth_args));
        let usage_job = tauri::async_runtime::spawn_blocking(move || run_cli(&launcher, &args, "/usage"));
        jobs.push((wsl, usage_job, auth_job));
    }
    let mut out = Vec::new();
    for (wsl, usage_job, auth_job) in jobs {
        let auth = match tokio::time::timeout(Duration::from_secs(30), auth_job).await {
            Ok(Ok(Ok(text))) => Some(text),
            _ => None,
        };
        if let Ok(Ok(Ok(text))) = tokio::time::timeout(Duration::from_secs(60), usage_job).await {
            out.push(PlanProbe { source: if wsl { "wsl" } else { "windows" }.into(), text, auth });
        }
    }
    out
}

fn spawn_cli(launcher: &Launcher, args: &[String], prompt: &str) -> Result<std::process::Output, String> {
    let mut cmd = match launcher {
        Launcher::Native(path) => {
            let mut c = std::process::Command::new(path);
            c.args(args);
            // Its own folder, so the session never lands in a project of yours.
            let dir = crate::platform::local_dir().join("chat");
            let _ = std::fs::create_dir_all(&dir);
            c.current_dir(dir);
            c
        }
        #[cfg(windows)]
        Launcher::Wsl => {
            // A login shell, so ~/.local/bin is on the PATH. "$@" keeps every argument
            // whole: a space in a path must not split it, nor a leading dash start an option.
            let mut c = std::process::Command::new("wsl.exe");
            // Started in WSL's home, not in whatever folder Coucou was launched from.
            c.args(["--cd", "~", "-e", "bash", "-lc", "exec claude \"$@\"", "_"]);
            c.args(args);
            c
        }
    };
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    crate::platform::no_console(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("Could not start the Claude CLI: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes());
    }
    child.wait_with_output().map_err(|e| e.to_string())
}

/// A `-p` run: the model's answer out of the JSON.
fn run_cli(launcher: &Launcher, args: &[String], prompt: &str) -> Result<String, String> {
    let output = spawn_cli(launcher, args, prompt)?;
    cli_result(&output)
}

/// A command that just prints (`claude auth status`): its output, as it is.
fn run_raw(launcher: &Launcher, args: &[String]) -> Result<String, String> {
    let output = spawn_cli(launcher, args, "")?;
    if !output.status.success() {
        return Err("The Claude CLI did not answer.".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// `--output-format json` prints one result object (or an array ending in it).
fn cli_result(output: &std::process::Output) -> Result<String, String> {
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let failure = |stderr: &str| -> String {
        if stderr.is_empty() {
            "The Claude CLI failed. Is it signed in? Run `claude` once in a terminal.".to_string()
        } else {
            let tail: Vec<char> = stderr.chars().rev().take(300).collect();
            tail.into_iter().rev().collect()
        }
    };

    let value = serde_json::from_str::<Value>(&out).ok().and_then(|v| match v {
        Value::Array(items) => items
            .into_iter()
            .rev()
            .find(|i| i.get("type").and_then(Value::as_str) == Some("result")),
        other => Some(other),
    });
    if let Some(v) = value {
        let text = v.get("result").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let failed = v.get("is_error").and_then(Value::as_bool).unwrap_or(false) || !output.status.success();
        if failed {
            return Err(if text.is_empty() { failure(&err) } else { text });
        }
        return if text.is_empty() { Err("No response text.".into()) } else { Ok(text) };
    }
    if output.status.success() && !out.is_empty() {
        return Ok(out);
    }
    Err(failure(&err))
}

async fn call(key: &str, body: &Value) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(ENDPOINT)
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("anthropic-beta", FALLBACK_BETA)
        .header("content-type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        // Surface the API's own message, which is what makes a bad key obvious.
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| text.chars().take(200).collect());
        return Err(format!("Claude API {status}: {detail}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("Bad API response: {e}"))
}

/// PDF → document block, image → image block, text/code → inline text.
/// Mirrors readFileAsBlock() in ClaudeService.swift.
fn file_block(path: &str) -> Option<Value> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let media_type = match ext.as_str() {
        "pdf" => Some(("document", "application/pdf")),
        "jpg" | "jpeg" => Some(("image", "image/jpeg")),
        "png" => Some(("image", "image/png")),
        "gif" => Some(("image", "image/gif")),
        "webp" => Some(("image", "image/webp")),
        _ => None,
    };

    if let Some((block_type, media)) = media_type {
        let bytes = std::fs::read(path).ok()?;
        return Some(json!({
            "type": block_type,
            "source": { "type": "base64", "media_type": media, "data": base64(&bytes) },
        }));
    }

    let len = std::fs::metadata(path).ok()?.len();
    if len > MAX_INLINE_TEXT {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    Some(json!({ "type": "text", "text": format!("File contents:\n{text}") }))
}

/// Small standalone base64 encoder — not worth another dependency.
pub(crate) fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::base64;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
