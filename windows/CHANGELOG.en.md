[日本語](CHANGELOG.md) · **English**

# Changelog

What changed in each published version. The same text goes into the GitHub release
(see [docs/RELEASING.md](docs/RELEASING.md), Japanese). Newest first.

## [Unreleased]

- **Fixed**: around the closed notch (a few dozen pixels) clicks were swallowed, so the window underneath could not be
  touched. The margin of the hit area went from 14 px to 3 px.
- **Added**: the closed island can be a **thin bar** (mini settings panel, Settings → General → "When closed"). Only a wide, rounded
  line floating a little below the top edge stays (like the iPad's home indicator), tinted by what the focused session is doing (blue: working, purple: thinking,
  orange: waiting for you, red: error, green: done).

## [1.1.0] — island size and hover options

- **Added**: the **size of the island** can be changed (80 % – 150 %), from the mini settings panel or Settings → General.
  It suits small screens and high-resolution monitors.

- **Added**: what the hover on the plan numbers shows can be changed in Settings → General → "On hover". The account
  e-mail can be shown, partly hidden or left out; the Windows / WSL name, the plan name, the 5-hour and weekly limits,
  the reset time and the last update can each be switched on or off. A preview sits under the options.

## [1.0.1] — fixes and clean-up

- **Fixed**: in Settings → Connections, the switches of a WSL distro that had been stopped showed as off after it started.
- **Changed**: plan limits are fetched with `/usage` every 30 minutes instead of 10 (while Claude Code is in use they
  update with every reply anyway).
- **Cleaned up**: removed code that was no longer used (old hook commands, the swallowing animation screen…); added
  automated tests (`npm test`, `cargo test --lib`).
- **Fixed**: the small notch vanished from the screen after a while without use. It now **stays on screen**
  (the setting "Always show the notch" brings back the old hiding behaviour).

## [1.0.0] — first release

The first published version of this fork of [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou), starting from its
Windows app 0.1.1. **Everything** that differs from the original is in [RELEASE_NOTES.en.md](RELEASE_NOTES.en.md). The main
points:

- File-edit diffs (colour, line numbers, the output of the last command)
- Plan limits (5-hour and weekly)
- In-app setup that connects Windows and every WSL distro (review the diff, then write; uninstalling disconnects)
- History view (rendered as Markdown), enlarging the island, dragging it sideways to switch tabs (home / chat / settings), a pin to keep it open
- Permissions: "always allow", dangerous-command detection, hotkeys, answering Claude's questions from the island
- A right-click menu, and a double-click on the tray icon to hide / show the island
- File drop: from any screen, even with the island closed; picture previews
- English and Japanese

**Removed**: the service integrations (Stripe, GitHub, Vercel, n8n, Resend, Notion, Cal.com), the macOS and iPhone files,
the distribution workflows.
