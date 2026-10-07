[日本語](CHANGELOG.md) · **English**

# Changelog

What changed in each published version. The same text goes into the GitHub release
(see [docs/RELEASING.md](docs/RELEASING.md), Japanese). Newest first.

## [Unreleased]

- **Added**: **several files can be dropped at once** (up to 8; they all go with the question).
- **Added**: **clicking a Windows notification opens the island**. For that, at startup Coucou registers a `coucou://` link in the
  current user's registry (`HKCU\Software\Classes\coucou`); uninstalling removes it.
- **Added**: a **copy button** on replies, questions and commands in the history (it shows on hover).
- **Added**: on a usage-limit error the **reset time** is shown on the error card.
- **Added**: when several sessions finish one after another, the finished card shows **the other finished sessions** as buttons.
- **Added**: a **connection self-check** (once a day): if Claude Code had been connected and its hooks are gone, the island says so.
- **Added**: a warning once when a plan limit passes **80 % and 90 %** (can be switched off).
- **Added**: a **new-version notice** (off by default; when on, it asks GitHub once a day).
- **Added**: an "open when the pointer rests on it" setting; hovering the thin bar names the sessions at work.
- **Added**: the half-written chat question is kept, even after closing the island or restarting.

- **Changed**: "Read" on the finished card (and a click on its title) and "Open history" on the error card now open the history
  at the **larger size**, the same as when you pull the island down.

## [1.2.1] — a picture fix

- **Fixed**: in a conversation where the question had already been sent, the attached picture (file) could still be removed by
  dragging it or with the ×. After sending you can look at it (click to enlarge) but not take it away.

## [1.2.0] — the thin bar and more settings

- **Added**: a "More settings" section in the settings window:
  - lines around a change in the diff (0–10), entries kept in the history, how often plan limits are fetched (never / 10 / 30 / 60 min)
  - what the closed notch shows of the limits (both / one / nothing)
  - **quiet hours** (no sound, no notification; optionally still ring when Claude waits for you)
  - how long an "always allow" lasts (for ever / 1, 7, 30 days), the launch greeting on or off
  - **island position** (up to 400 px left or right of the centre)
  - copy the settings, paste them back in, reset to the defaults

- **Fixed**: around the closed notch (a few dozen pixels) clicks were swallowed, so the window underneath could not be
  touched. The margin of the hit area went from 14 px to 3 px.
- **Added**: the closed island can be a **thin bar** (mini settings panel, Settings → General → "When closed"). Only a wide, rounded
  line floating a little below the top edge stays (like the iPad's home indicator), with a gradient that never stops flowing, made of **the colours of the AI sessions that are working**; orange when something waits for you, red on an error, green when done.
  Everything above the bar (up to the top edge) and a margin to the sides reacts to a click, and when the island closes it turns into the bar only once it has shrunk to it (blue: working, purple: thinking,
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
