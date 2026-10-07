**[日本語](RELEASE_NOTES.md)** · English

# Coucou for Windows — repatch

A fork of [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou), starting from its Windows app
**0.1.1** (`windows/`, commit `83708fe`). This page lists **everything that differs from the original**.
Changes version by version are in [CHANGELOG.en.md](CHANGELOG.en.md).

> Source only. The name Coucou, the Mochi character, the icons and the sounds belong to Louis Raillé
> ([LICENSE-ASSETS.md](../LICENSE-ASSETS.md)); no installer is distributed. Build it yourself — see the
> [README](README.en.md).

## At a glance

| Area | What you get |
|---|---|
| **File edits** | A diff view: what Claude changed, in colour, with line numbers, next to the steps of the turn and what the last command printed |
| **Plan limits** | Your 5-hour and weekly usage on the island, per Windows / WSL account |
| **Setup** | One screen connects Claude Code on Windows **and every WSL distro**; first-run welcome; uninstall that can disconnect cleanly |
| **History** | Read back everything a session said and did, with Markdown rendering, and a larger island |
| **Permissions** | "Always" rules, danger detection, safer buttons, hotkeys, answer Claude's questions from the island |
| **Everyday** | Per-session pills, notifications, usage, a settings panel in the island, full-screen awareness, English / 日本語 |

---

## Added

### File-edit diffs (the live diff view)
- When Claude edits a file you can see **what changed**: left, Mochi with the session name and the steps
  (`Read ✓ / Edit ✓ / Run ◐ / Done`); right, one **tab per file** (latest four, with an extension badge),
  `+N −M`, the path, and the **colour-highlighted code** (removed = red and struck through, added = green,
  line numbers, three lines of context). Long edits are cut at 160 lines with "… N more".
- Below the code, the **output of the last command** (`npm test` and the like): `PASS` / `✓` lines green,
  `FAIL` / `✗` lines red. Pull the island down and it grows (700×480) to show more.
- Three ways in: the **"Diff +3 −1"** chip on the overview, a click on an **"Edit · file" line in the history**,
  or **Settings → "File edits, live"** (off by default), which opens the island for 8 seconds on every edit
  (it waits while the mouse is on it).
- **‹ 2/3 ›** steps through the several edits of one file. **Back / Esc** returns to where the diff was
  opened from — the history keeps its enlarged size and scroll position.
- With 3 or more files only the tab on show keeps its name, so names are never cut to a letter.
- Works for `Edit`, `MultiEdit`, `Write` and `NotebookEdit`; line numbers come from reading the file after the
  edit (Windows paths directly, WSL paths through `wsl.exe`), up to 400 KB of text.
- **Sensitive files are never shown or read**: `.env`, `.ssh`, credentials, `.claude/settings`… show
  "Hidden: sensitive file", and the Rust side refuses the read too. Paths containing `..` are refused.
- The relay used to drop every `tool_response`; it now keeps it for **Bash / PowerShell only** (2,000 chars).

### Plan limits (5 hours and weekly)
- The island shows how much of your **5-hour** and **weekly** limit is used, and when it resets — on the
  closed island (`WSL 5h 59% 07:29 · week 21%`), in the open header, and as bars in the empty overview.
- It comes from the status line data Claude Code already hands to a command (Pro / Max). Nothing is read
  from your login or tokens.
- **Windows and WSL are kept apart** (they can be different accounts). Settings → "Plan limits of":
  *Auto* (the session on screen), *Windows*, or *WSL*. Hover the numbers to see the account e-mail and plan
  (read with `claude auth status`).
- Fetched at startup, without waiting for a first answer (`claude -p "/usage"`, which makes no model call).
- **What the hover shows is a setting** (Settings → General → On hover): the e-mail shown, partly hidden or left
  out; the Windows / WSL name, the plan name, the 5-hour and weekly limits, the reset time and the last update each
  on or off. With a preview.
- Your own status line keeps printing exactly as before: the relay runs in front of it and puts it back when
  switched off.

### In-app setup: Connections
- **Settings → Connections** replaces editing `settings.json` and running a script by hand. One card for
  Windows and one for **each WSL distro**, each with two switches: *Claude Code* (hooks) and *Plan limits*
  (status line).
- **Apply…** shows the exact diff, the backup it will take, and writes only after you click. If the file
  changed since the diff, nothing is written. A dated backup is made every time. A `settings.json` that can't
  be read or isn't valid JSON is never overwritten. Other tools' hooks, your own status line and
  your own matchers (such as `^(?!AskUserQuestion$).*`) are left alone.
- WSL files are read and written through `wsl.exe` (the same Linux user that runs Claude Code), with the
  file's permissions kept. **Stopped distros are not started just to look**: press *Check*. The list refreshes
  when the window comes back to the front.
- **First run**: the setup opens by itself with everything that can be connected already switched on.
  Someone who is already connected isn't welcomed again.
- **Uninstall** asks, when run by hand: *also remove Coucou from Claude Code's settings?* (and, separately,
  *also delete the settings and the API keys it saved?*, default No). Silent uninstalls and updates never
  touch them. `coucou.exe --disconnect` / `--purge` do the same from the command line.
- `install-from-source.ps1` builds and installs in one command (`-Light` for a gentle build).

### History view
- Click the flowing line on the overview to **scroll back through the session**: your questions, every tool
  that ran (shell commands in full) and Claude's replies **in full** (up to ~30,000 characters; the relay used
  to cut them at a few hundred).
- Replies are **rendered as Markdown** — headings, bold / italic / strike, inline code, code blocks, nested
  lists, tables, quotes, rules, `http(s)` links — with no library and no HTML (everything is built with
  `textContent`, so a `<script>` in a reply is just text).
- It follows new lines while you are at the bottom, doesn't move while you read higher up, and offers
  "↓ Latest". **Back** (or Esc) goes up one level.
- **Pull the island down** (history, permission, question and chat views) and it grows to **700×480**; pull
  up and it shrinks back first, then closes.

### Permissions and questions
- **Always**: allow this kind of request from now on. Rules are per command + sub-command (`npm run`),
  per folder for edits, per tool for `Read`/`Glob`/`Grep`/`LS`; they are listed (and removable) in Settings.
  Commands with `; && | > <` backticks or `$(` never become rules.
- **Danger detection**: recursive deletes, `sudo`, force push, `git reset --hard`, download-and-run, `iex`,
  disk and registry operations, `shutdown`, `npm publish`, and edits of `.env` / `.ssh` / credentials /
  `.claude/settings` get a red card, a reason, and no "Always". Rule paths with `..` or relative paths are
  refused.
- Safer buttons: the full command (3 lines, 16 when enlarged), and Allow / Always can't be pressed for the
  first 0.35 s (0.9 s when dangerous), so a card that pops up mid-click is never accepted by accident.
- **Answer Claude's questions from the island** (`AskUserQuestion`): options, several questions in a row,
  multi-select with *Send*, or *Terminal* to hand it back. *Experimental — see Known limits.*
- **Global hotkeys** (editable in Settings; `Ctrl+Alt+…`): open/close `J`, allow `Y`, deny `N`, options `1`–`4`,
  ask about the screen `S`. Conflicts with other apps are reported, the rest still work.
- **Ask about the screen** (`Ctrl+Alt+S`): the display under the cursor is saved as a PNG and attached to a chat
  question; nothing is sent until you send the question.

### Sessions and the island
- **One pill per session** (name = folder, `· WSL` suffix, automatic colour). Pills stay **in place** when you
  click, the focused one is highlighted, VS Code is no longer shown. One or two sessions get a full-width row
  with a state and time (`working · 0:07`, `needs you`, `done`).
- Elapsed time while thinking (`0:22`) and on the finished card (`finished · 1:01`); the finished card closes
  itself (default 6 s, waits while the mouse is on it).
- The finished card shows the first line of Claude's last message, and a summary (`2 files edited · 3 commands`).
- **Today's usage** (turns, time, files, commands; last 14 days, last 7 in Settings) — from hook events only.
- **Notifications**: sound, a Windows toast, both, or none, for finished turns, permission requests and errors.
- **File drop**: no more drop tab. From any screen, even with the island closed, hold a file over the island (the top
  centre of the screen when it is closed) and the drop screen opens; move away and it goes back. Drop it and the
  question screen for that file opens at once — no confirmation card, no swallowing animation. Only the notch's
  surroundings and the island react; anywhere else a file can still be dropped on the app underneath. In the
  question screen a click removes a file; a picture gets a larger **preview** (its name small over it) that opens
  **large on a click** and goes away with the × or when **dragged sideways**.
- **Closed shape**: instead of the small notch, only a **thin bar** at the top of the screen; its colour shows what the session is doing.
- **Island size**: 80 % – 150 % (mini settings panel, Settings → General).
- **Always show the notch**: the small closed notch does not hide itself after a while (switch it off in the settings).
- **Pin** (top right of the header): while pinned the island does not close by itself — not when the mouse leaves,
  not by the finished card's timer, not with Esc or a pull up. Press it again to let go.
- **Long text**: when the first line of the finished card is long, the island grows taller to fit it (up to four lines).
- **Right-click menu** (on the island and on the tray icon, same entries): open Coucou, refresh Claude limits,
  settings, hide / show the island, restart Coucou, open the log folder, quit. **Double-click the tray icon** to
  hide or show the island.
- **Error card**: shows the reason Claude Code gave ("Usage limit reached"…), and keeps long text to two lines.
- **Mini settings panel in the island** (gear): sound and volume, notify mode, display, auto-close,
  finished-card timer, live diff, plan limits, autostart, and an "Open settings" button that also collapses
  the island.
- **English / 日本語** (and a simple way to add a language): `Settings → General → Language`.
- **Chat without an API key**: with no key saved, the chat answers through the `claude` CLI (Windows first,
  then WSL), keeps the conversation with `--session-id` / `--resume`, and limits tools to web search and fetch.
- **Full-screen awareness**: while a game, video or presentation owns the screen, the island hides itself, never
  takes focus, and sends permission requests straight back to the terminal. If another window is in front of the
  full-screen app, the island shows again. A game on another monitor doesn't hide it.

## Changed

- The finished card has just **OK** (no "Open terminal"). The "↗ open in VS Code" buttons are gone.
- The thinking line no longer overlaps itself; the ticker follows the session you switch to and says
  "Waiting for a prompt" instead of an empty line.
- Bash / PowerShell commands are no longer put into the flowing steps (their first 40 characters were always
  `cd … &&`); the full command is in the history.
- `SubagentStop` no longer overwrites the finished message with "subagent done".
- Drag the island **sideways** to switch tabs (home / chat / settings); not while a permission request is waiting.
- Drag the island **up** to close it; it follows your finger and springs back. (Not while a permission
  request is waiting.)
- The hook relay keeps longer text: replies up to 96,000 bytes, prompts and file contents up to 24,000.
- The settings window gained Connections, Hotkeys, Remembered permissions, Usage and Plan limits sections.
- The closed island is wider (288 → 328 px) so the plan limits fit.
- Hooks are written for WSL with the path of the Windows relay (`/mnt/c/…`); the Windows relay is the only
  program involved.

## Removed

- The release and installer-publishing workflows (the original's Windows and Linux packaging workflows, and its macOS tag build check).
  `npm run pack` still builds an installer, for your own PC.
- `coucou_statusline.py`: the app does that job now.

- **The service integrations** (Stripe, GitHub, Vercel, n8n, Resend, Notion, Cal.com): their pills, cards,
  polling, the Integrations section of the settings, the API keys it stored and the "Open in n8n" button are all
  gone — they had nothing to do with Claude Code. Keys saved by older versions are removed by "also delete the saved
  API keys" at uninstall.

## Fixed

- Replies were cut at roughly 660 characters (Japanese) by the relay: it now truncates per field.
- Switching to another session left the previous session's message on the ticker.
- Pills could be pushed past the edge of the card by a long name.
- Re-applying the hooks dropped a matcher you had added to Coucou's entries.
- A WSL distro list with a UTF-16 byte-order mark was misread.

## Security

- API keys stay in the Windows Credential Manager; the island can only ask whether one exists.
- Allow rules reject path tricks (`..`, relative paths); `Read` tools on secrets count as dangerous.
- The WSL launcher passes arguments as `"$@"`, rejects dash- and space-prefixed values, and the status line
  and hook commands quote paths so a path can't become a command.
- `settings.json` is only ever replaced after a diff you saw, with a backup, atomically, and with its
  permissions kept; the temporary file is private from the moment it exists.
- No telemetry. The only network calls are to services you configured.

## Known limits

- **Not signed, not distributed.** You build it yourself.
- **`AskUserQuestion` from the island is experimental.** If it misbehaves for you, add the matcher
  `^(?!AskUserQuestion$).*` to Coucou's `PreToolUse` and `PermissionRequest` entries: Coucou keeps it when you
  press Apply again, and the question is answered in the terminal as usual.
- Plan limits need a **Pro / Max** subscription and Claude Code **in a terminal** (the desktop app doesn't
  report them).
- Syntax colours are a simple line-by-line version (no multi-line strings).
- Symbolic links and junctions inside a rule's folder can't be seen from the front end: only add rules to
  folders you control.
- The connection screen and the uninstaller questions are the newest parts and have had the least testing.
