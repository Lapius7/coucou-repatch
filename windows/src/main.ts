// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { Bridge, IS_TAURI, onEvent } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { Island } from "./island/island";
import { registerHookHandlers } from "./island/hooks";
import { loadAccounts, loadPlans, parseAccount, parsePlan, parsePlanText, saveAccounts, savePlans, sourceOf, startPlanClock } from "./core/plan";
import { setLanguage, t } from "./core/i18n";

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  // The language is known before anything is drawn: texts are read when views are built.
  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
  }
  if (!IS_TAURI) State.settings.language = new URLSearchParams(location.search).get("lang") ?? State.settings.language;
  setLanguage(State.settings.language);
  const island = new Island(root);
  island.applySettings();
  State.loadIntegrationTasks();
  if (boot && !boot.cursorPoll) island.followPageCursor();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));

  /** Pause has to reach Rust too, or the pollers keep calling out. */
  /** The texts of the tray and right-click menu, in the interface language. */
  const pushMenuLabels = () =>
    void Bridge.setMenuLabels({
      open: t("menu.open"),
      settings: t("menu.settings"),
      pause: State.paused ? t("menu.resume") : t("menu.pause"),
      refresh: t("menu.refresh"),
      restart: t("menu.restart"),
      log: t("menu.log"),
      quit: t("menu.quit"),
    });

  const setPaused = (on: boolean) => {
    if (State.paused === on) return;
    State.paused = on;
    void Bridge.setTrayDimmed(on);
    pushMenuLabels();
  };
  pushMenuLabels();

  // Right-click on the island: the same menu as the tray icon.
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    void Bridge.contextMenu();
  });

  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "settings":
        setPaused(false);
        island.alert("settings");
        break;
      case "open":
        setPaused(false);
        island.alert(State.defaultView());
        break;
      case "pause":
        setPaused(!State.paused);
        if (State.paused) island.fsm.forceHidden();
        else island.reveal();
        break;
      case "refresh":
        // Ask each Claude Code install for its limits now, and show them.
        setPaused(false);
        island.alert(State.defaultView());
        void probePlans();
        break;
    }
  });

  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  await onEvent<string>("hotkey", (name) => island.onHotkey(name));

  // Plan limits from Claude Code's status line (see coucou-hook --statusline-relay).
  // The last known numbers are shown right away after a restart.
  State.plans = loadPlans();
  State.accounts = loadAccounts();
  const takePlan = (raw: unknown) => {
    const message = (raw ?? {}) as { rate_limits?: unknown; cwd?: unknown };
    const plan = parsePlan(message.rate_limits);
    if (!plan) return;
    // Which install said it: a relay that does not say counts as Windows.
    const source = sourceOf(message.cwd) ?? "windows";
    State.plans = { ...State.plans, [source]: plan };
    savePlans(State.plans);
    State.notify();
  };
  await onEvent<unknown>("statusline", takePlan);

  // Without waiting for a reply: ask each Claude Code install for its limits now, at
  // start and every ten minutes (`claude -p "/usage"`, no model call). Replies in the
  // terminal keep updating it in between.
  const probePlans = async () => {
    if (!State.settings.showPlanUsage) return;
    for (const probe of (await Bridge.planProbe()) ?? []) {
      if (probe.source !== "windows" && probe.source !== "wsl") continue;
      const plan = parsePlanText(probe.text);
      const account = parseAccount(probe.auth);
      if (account) {
        State.accounts = { ...State.accounts, [probe.source]: account };
        saveAccounts(State.accounts);
      }
      if (plan) {
        State.plans = { ...State.plans, [probe.source]: plan };
        savePlans(State.plans);
      }
      State.notify();
    }
  };
  window.setTimeout(() => void probePlans(), 4000);
  window.setInterval(() => void probePlans(), 10 * 60_000);
  startPlanClock(() => State.planView());
  // `npm run dev` in a plain browser: `__statusline({rate_limits: {five_hour: {...}, seven_day: {...}}, cwd: "/home/me"})`.
  if (!IS_TAURI) (window as unknown as { __statusline: (raw: unknown) => void }).__statusline = takePlan;

  // A full-screen game or video: the window is hidden on the Rust side, and the
  // hook handlers stop opening cards and playing sounds until it is gone.
  await onEvent<boolean>("fullscreen", (on) => {
    State.suppressed = on;
    if (on) island.collapse();
  });

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    // A new language needs every view built again: the simplest way is a reload.
    if (s.language !== State.settings.language) {
      location.reload();
      return;
    }
    State.settings = { ...State.settings, ...s };
    island.applySettings();
    State.loadIntegrationTasks();
  });

  registerHookHandlers(island);

  island.launch();

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();
