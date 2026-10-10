<div align="center">

[日本語](README.md) · **English**

# Coucou for Windows

**A PC has no notch, so Mochi lives at the top of your screen.**

Permission requests, what your session is doing, file drops, chatting with Claude, reading file-edit diffs, checking plan limits —
all without leaving the work you are in.

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![Code: MIT](https://img.shields.io/badge/code-MIT-green)

</div>

**How is this different from the original Coucou?** See [RELEASE_NOTES.en.md](RELEASE_NOTES.en.md) for the full list.

---

## Install

> **This fork publishes source code only.** The name "Coucou", the Mochi character, the icons and the sounds belong to
> Louis Raillé ([LICENSE-ASSETS.md](../LICENSE-ASSETS.md)), so no installer is distributed. You build it yourself, with
> one command. It installs for the current user only: no administrator rights, and nothing leaves your PC.

**1. Install the tools (once)**

| Tool | Where to get it |
|---|---|
| Node 20 or newer | <https://nodejs.org> |
| Rust | <https://rustup.rs> (it also asks for the Visual Studio **C++ build tools** — accept) |
| Git | <https://git-scm.com> |

WebView2 already ships with Windows 10 and 11.

**2. Build and install**

```powershell
git clone https://github.com/Lapius7/coucou-repatch.git
cd coucou-repatch\windows
powershell -ExecutionPolicy Bypass -File install-from-source.ps1
```

On a slow PC add `-Light`: it takes a little longer but keeps the machine responsive.

**3. Start Coucou.** It starts by itself when the install ends. Mochi appears at the top of the screen, and the
**setup window** opens the first time (see [Setup](#setup)).

**4. Press Apply.** That connects Claude Code. Open a new Claude Code session and it shows up on the island.

To update, run `git pull` and the same script again. Your settings are kept.

## Setup

On first start **Settings → Connections** opens, with everything that can be connected already switched on. There is
one card for each place Claude Code runs:

| Card | What it covers |
|---|---|
| **Windows** | Claude Code in PowerShell, Windows Terminal, VS Code, Git Bash… |
| **WSL · \<distro\>** | Claude Code inside each WSL distribution (found automatically) |

Each card has two switches:

| Switch | What it does |
|---|---|
| **Claude Code** | Shows sessions, steps, permission requests and their answers. Writes Claude Code's *hooks*. |
| **Plan limits** | Shows your 5-hour and weekly usage. Puts a tiny relay in front of your status line; **what your status line prints does not change.** |

**Apply…** shows the exact diff of the file that is about to change (`~/.claude/settings.json`, on Windows or inside that
WSL distro) and the backup that will be taken. Nothing is written until you press **Write these changes**. If the file
changed in the meantime, nothing is written and you get a fresh diff.

- Your own hooks, your own status line and all other settings are left alone.
- A dated backup (`settings.json.bak-YYYYMMDD-HHMMSS`) is taken before every write.
- A `settings.json` that cannot be read, or is not valid JSON, is **never overwritten**; you get the error instead.
- Changing your mind works the same way: switch off, **Apply…**, review, write. Your previous status line comes back.

No Python, no scripts, no `.bat` files.

### Plan limits

Claude Code hands plan limits only to a status line, and only on a subscription (Pro or Max). After applying **Plan
limits**, open a new Claude Code session; the numbers show up after its first answer. If both Windows and WSL are
connected, **Settings → General → Plan limits of** picks whose limits the island shows (*Auto* follows the session on
screen).

## Uninstall

Use **Settings → Apps → Coucou → Uninstall** (or the uninstaller in `%LOCALAPPDATA%\Coucou`). It asks:

> Also remove Coucou from Claude Code's settings (Windows and WSL)?

- **Yes** — Coucou's entries are removed from `settings.json` on Windows and in every WSL distro (a backup is kept and
  other tools' hooks stay), and your previous status line is restored.
- **No** — Claude Code's settings are not touched. The leftover entries are harmless: a hook whose program is gone just
  exits without a word.

You can also disconnect first, in **Settings → Connections**, and uninstall afterwards. The uninstaller removes the
relay, the inbox and the log. Your API keys are in the Windows Credential Manager and can be removed from **Settings →
Claude**. A second question asks whether to delete the settings and saved API keys too (the default is No).

A silent uninstall (`/S`) and updates never touch Claude Code's settings.

## Troubleshooting

| Symptom | What to try |
|---|---|
| Nothing shows up when Claude Code runs | **Settings → Connections**: is the card's dot green? Then open a **new** Claude Code session — sessions that were already running don't know about new hooks. |
| "Claude Code was not found here yet" on a WSL card | Run `claude` once inside that distro (it creates `~/.claude`), then reopen Settings. You can connect it anyway. |
| A WSL distro is missing | It must appear in `wsl -l -q`. Docker's own distros are skipped. |
| A WSL card says it is stopped | Looking at a stopped distro would start it, so it is skipped. Press **Check** to start it and look. |
| No plan limits | Only a subscription reports them, and only after the first answer of a new session. The terminal version of Claude Code reports them; the Windows desktop app does not. |
| The island vanishes in a game | By design: a full-screen app in front hides it. With another window in front of the game, it shows again. |
| "`settings.json` isn't valid JSON" | Fix or move that file. Coucou will not overwrite what it can't read. |
| Where is the log? | `%LOCALAPPDATA%\Coucou\coucou.log` |

## Using it

| What you do | What happens |
|---|---|
| Move the mouse to the very top centre of the screen | Mochi peeks out |
| Click the small island | It opens |
| Click Mochi | It gets annoyed. Three times in a row and it goes dizzy |
| Keep the pointer on Mochi for two seconds | Hearts |
| Hold a file over the island (even when it is closed, from any screen) | The drop screen opens. Drop it and the question screen for that file opens at once |
| `Esc` | Closes the island |
| Tray icon | Open, Settings…, Pause, Quit |

The rest happens by itself: a Claude Code permission request opens the island with **Deny / Allow**, a finished session
shows what it did, and your sessions sit in the coloured pills next to Mochi.

## Claude Code

Connect it in **Settings → Connections** (see [Setup](#setup)).

The relay is a tiny executable, `coucou-hook.exe`, copied to `%LOCALAPPDATA%\Coucou\bin\` at launch. It waits 300 ms to
reach Coucou and ends silently if the app is closed, slow or crashed — **a Claude Code session is never blocked or slowed
down by Coucou.** If nobody answers a permission request, Coucou stays quiet and Claude Code asks in the terminal as
usual.

It works from any terminal (Windows Terminal, PowerShell, VS Code, Git Bash) and from WSL.

## Chat and keys

Put your Anthropic API key in **Settings → Claude**. Keys are stored in the **Windows Credential Manager**, never on
disk and never shown on screen: the island can only ask whether a key exists. Without
a key, the chat answers through the `claude` CLI.

There is no telemetry. Coucou only talks to the services you configure.

## Build it yourself

(`install-from-source.ps1` does all of this for you; this is the manual version.)

You need [Rust](https://rustup.rs), [Node 20+](https://nodejs.org) and the **MSVC build tools** (Visual Studio Build
Tools, "Desktop development with C++"). WebView2 ships with Windows 10 and 11.

```powershell
cd windows
pnpm install
pnpm run tauri dev      # development build with live reload
pnpm run pack           # builds the installer into windows/release/
```

`pnpm run dev` on its own serves the front end in an ordinary browser, which is enough for working on how the island
looks.

`pnpm run pack` leaves the installer in `windows/release/` (`Coucou-Windows-setup.exe` and an `.msi`). It is meant for
installing on your own PC and is not published anywhere.

Installing is optional: `target/release/coucou.exe` runs by itself. There is no taskbar window and no console. The island
at the top of the screen and Mochi in the notification area are the whole app; Quit is in its menu.

The 28 sounds are the macOS app's files and are not duplicated here. The path is declared once, as `SOUNDS_DIR` at the top
of `vite.config.ts`; if they move to `shared/sounds/`, change that one line.

The app icon and the tray icon are drawn in code, like Mochi itself:

```powershell
pnpm run icons          # regenerates src-tauri/icons from scripts/gen-icons.mjs
```

### Tests

```powershell
cd windows
pnpm test                          # front end: dangerous-command detection, diffs, plan limits, translations in step
cd src-tauri; cargo test --lib    # Rust: connections, writing settings, the picture preview's limits…
pnpm exec tsc --noEmit                  # type check
```

### Developing (live reload)

```powershell
cd windows
pnpm run tauri dev
```

Front-end changes (`src/`) appear the moment you save. Rust changes rebuild and restart the app by themselves, much faster
than a full build. Quit the installed Coucou first: only one copy can run. Put `CARGO_BUILD_JOBS=4` in front to keep the PC
responsive.

### Layout

```
windows/
  src/                 the island's front end (TypeScript, no framework)
    mochi/             Mochi and the launch greeting (Canvas 2D)
    island/            state machine, hooks
    views/             every island view
    settings/          the settings window
  src-tauri/           Rust backend: window, named pipe, Claude API, pollers
  hook/                coucou-hook.exe, the Claude Code relay
  scripts/             icon generator
```

### Log

`%LOCALAPPDATA%\Coucou\coucou.log` holds hook events, permission decisions and polling problems. It never leaves your PC.

## Supported agents

The relay (`coucou-hook.exe`) works with any tool that can run a command on hook events. Pass `--agent <name>` to get a
pill with that name.

| Agent | How to connect | Config file |
|---|---|---|
| Claude Code | **Settings → Connections** | `%USERPROFILE%\.claude\settings.json` |
| Gemini CLI | positional argument `--agent gemini` | `%USERPROFILE%\.gemini\settings.json` |
| Antigravity | positional argument `--agent antigravity` | `%USERPROFILE%\.config\antigravity\hooks.json` |
| Cursor | hooks are installed automatically | `%USERPROFILE%\.claude\settings.json` |
| Codex | positional argument `--agent codex` | `%USERPROFILE%\.codex\hooks.json` |
| Copilot CLI | positional argument `--agent copilot` + camelCase events | `%USERPROFILE%\.copilot\hooks\coucou.json` |
| Muse Code | positional argument `--agent muse` | `%USERPROFILE%\.config\muse\settings.json` |
| Anything else | positional argument `--agent <name>` | that tool's hook config |

OpenCode and Amp are not supported on Windows or Linux yet: their integration is a plugin that calls `/bin/sh` with
macOS-specific paths, and the plugin installer exists only in the Mac app.

## Differences from the Mac version

- With no notch, the island sits at the top centre of the screen and retracts into the top edge instead of hiding in a
  notch.
- Permission approval works from **any** terminal; the Mac build listens only to VS Code sessions.
- Not in this version: sending a file by email, dragging Mochi onto a window to attach it as context, and jumping to a
  specific terminal window.

## Linux

The same app builds on Linux. Everything that differs lives in `src-tauri/src/platform/`, and the relay's transport in
`hook/src/unix.rs`.

```bash
sudo apt install build-essential pkg-config \
  libwebkit2gtk-4.1-dev libgtk-layer-shell-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libdbus-1-dev patchelf \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good
pnpm install
pnpm run tauri dev      # development build with live reload
pnpm run pack           # AppImage, .deb and .rpm into windows/release/
```

What changes on Linux:

- **The island** is a gtk-layer-shell overlay anchored to the top edge, above any top panel, on compositors that support it
  (COSMIC, KDE Plasma, Hyprland, Sway and other wlroots compositors). GNOME has no layer-shell, so there the island is an
  ordinary window. `COUCOU_LAYER_SHELL=0` forces that mode anywhere.
- **Click-through** works by keeping the window's input region equal to the island's shape, so every other click reaches
  what is underneath.
- **Mochi's eyes** follow the pointer only while it is over the island: Wayland gives an app no cursor position anywhere
  else.
- **Claude Code hooks** go through `~/.local/share/coucou/bin/coucou-hook` and a Unix socket at
  `$XDG_RUNTIME_DIR/coucou.sock`. Each end checks that the other runs as the same user.
- **Keys** are stored in the Secret Service (GNOME Keyring, KWallet).
- **Files**: preferences in `~/.config/coucou/`, the log in `~/.local/share/coucou/coucou.log`.
- What the Windows build leaves out is missing here too (sending a file by email, dragging Mochi onto a window, jumping to a
  specific terminal window).

## Fork and license

This is a fork of [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou). The source code is MIT-licensed
([LICENSE](../LICENSE)). What changed in this fork is listed in [RELEASE_NOTES.en.md](RELEASE_NOTES.en.md) and
[CHANGELOG.en.md](CHANGELOG.en.md). The name, the Mochi character, the icons and the sounds are
**not** covered by the MIT license ([LICENSE-ASSETS.md](../LICENSE-ASSETS.md)); do not distribute builds that contain
them. To ship your own app from this code, give it your own name, icon, character and sounds.

A step-by-step guide to testing the connections from WSL: [docs/TESTING_WSL.md](docs/TESTING_WSL.md) (Japanese).
