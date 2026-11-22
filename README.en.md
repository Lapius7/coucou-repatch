<div align="center">

<p align="center"><a href="README.md">日本語</a> | <b>English</b></p>

<h1 align="center">Coucou Windows Fork</h1>

<h3 align="center">A Windows app that watches Claude Code from a small island at the top of your screen.</h3>

<p align="center">
  <a href="https://github.com/Lapius7/coucou-repatch/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Lapius7/coucou-repatch?label=release&style=flat-square&color=e8833a&logo=github"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/Lapius7/coucou-repatch?style=flat-square&color=97ca00"></a>
  <a href="https://tauri.app/"><img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square&logo=tauri&logoColor=white"></a>
  <a href="https://github.com/Lapius7/coucou-repatch/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Lapius7/coucou-repatch?style=flat-square&color=e3b341&logo=github"></a>
  <a href="https://github.com/Lapius7/coucou-repatch/commits/windows-fork"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Lapius7/coucou-repatch?label=last%20commit&style=flat-square&color=2f81f7"></a>
</p>

<p align="center"><a href="#what-it-does">What it does</a> · <a href="#getting-started">Getting started</a> · <a href="#what-is-in-this-repository">What is in this repository</a> · <a href="#license">License</a></p>

</div>

---

A Windows app that keeps an eye on Claude Code from a small island at the top of your screen. Answer permission
requests, read what Claude changed in a file, check your plan limits — without leaving what you are doing.

This is a fork of [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou) with the Windows app (`windows/`) heavily
reworked. Claude Code inside WSL is supported too.

> [!IMPORTANT]
> **Only the source code is published.** The name "Coucou", the Mochi character, the icons and the sounds belong to
> Louis Raillé ([LICENSE-ASSETS.md](LICENSE-ASSETS.md)), so builds that contain them cannot be distributed. There is
> no installer to download: **build it yourself** (one command).

## What it does

- **File-edit diffs**: what Claude changed, in colour with line numbers, next to the output of the last command
  (a test run, say).
- **Plan limits**: your 5-hour and weekly usage on the island, with Windows and WSL accounts kept apart.
- **In-app setup**: one screen connects Claude Code on Windows and in **every WSL distro**. You review the exact
  change before anything is written, a backup is taken, and uninstalling can disconnect cleanly.
- **History**: scroll back through what a session said and did (rendered as Markdown), and enlarge the island.
- **Permissions**: "always allow" rules, dangerous-command detection, buttons that are hard to press by accident,
  hotkeys, and answering Claude's questions from the island.
- **And more**: one pill per session, notifications, usage, a settings panel inside the island, full-screen app
  detection, English and Japanese.

Everything that differs from the original: **[windows/RELEASE_NOTES.en.md](windows/RELEASE_NOTES.en.md)**

## Getting started

You need Node 20 or newer, Rust (with the Visual Studio C++ build tools), and Git.

```powershell
git clone https://github.com/Lapius7/coucou-repatch.git
cd coucou-repatch\windows
powershell -ExecutionPolicy Bypass -File install-from-source.ps1
```

On a slow PC add `-Light`. When the install ends Coucou starts, and the **setup window** opens the first time. Press
**Apply** and Claude Code is connected.

More detail — troubleshooting, uninstalling, developing: **[windows/README.en.md](windows/README.en.md)**

## What is in this repository

| Where | What |
|---|---|
| `windows/` | The heart of this fork: the Windows / WSL app (Tauri 2, Rust and TypeScript). It also builds on Linux |
| `windows/docs/` | A step-by-step WSL test guide ([TESTING_WSL.md](windows/docs/TESTING_WSL.md), Japanese) and how to release ([RELEASING.md](windows/docs/RELEASING.md), Japanese) |
| `NotchBuddy/Resources/sounds/` | The sounds the app uses. They are the original author's and are not MIT-licensed ([LICENSE-ASSETS.md](LICENSE-ASSETS.md)); the Windows build reads them from here |

## License

The source code is MIT-licensed ([LICENSE](LICENSE)): original copyright Louis Raillé, changes in this fork by
Lapius7. The name, the character, the icons and the sounds are not covered ([LICENSE-ASSETS.md](LICENSE-ASSETS.md)).
To ship an app of your own, give it your own name, icon, character and sounds.
