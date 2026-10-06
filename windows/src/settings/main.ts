// Settings window — the place where anything that writes to disk is confirmed.
// Stage 2 covers the Claude Code hooks and the general preferences; API keys and
// integrations land here too in a later stage.

import "./settings.css";
import { Bridge, onEvent, type ConnectTarget } from "../core/bridge";
import { DEFAULT_HOTKEYS, DEFAULT_SETTINGS, HOTKEY_LABELS, type Settings } from "../core/state";
import { h, clear } from "../views/dom";
import { loadRules, removeRule } from "../core/rules";
import { LANGUAGES, setLanguage, t } from "../core/i18n";
import { loadAccounts, loadPlans, planName } from "../core/plan";
import { formatSpan, recentUsage } from "../core/usage";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const root = document.getElementById("settings-root")!;

async function save() {
  await Bridge.saveSettings(settings);
}

/** A key field's label in the interface language; unknown ones stay as written. */
function fld(label: string): string {
  const key = `fld.${label}`;
  const text = t(key);
  return text === key ? label : text;
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

function renderDiff(text: string): HTMLElement {
  const box = h("div", { class: "diff" });
  for (const line of text.split("\n")) {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    box.append(h("div", { class: cls, text: line }));
  }
  return box;
}

// ── Connections ───────────────────────────────────────────────────────────────

/** Where Claude Code runs (Windows, each WSL distro): switches, a diff, and one confirmed write. */
function connectSection(hookReady: boolean): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h("section", {}, h("h2", {}, h("span", { text: t("conn.title") })), body);
  const firstRun = !settings.setupDone;
  /** What each target should be, as the switches say (it starts as it is now). */
  const want = new Map<string, { hooks: boolean; sl: boolean }>();
  let targets: ConnectTarget[] = [];

  /** True while a diff is on screen: a refresh would pull it away. */
  let reviewing = false;
  let loading = false;

  /** `keep`: a refresh when you come back to the window keeps the switches as you left them. */
  async function load(wake: string[] = [], keep = false) {
    if (loading) return;
    loading = true;
    reviewing = false;
    if (!keep) {
      clear(body);
      body.append(h("div", { class: "hint", text: t("conn.checking") }));
    }
    targets = (await Bridge.connectTargets(wake)) ?? [];
    for (const target of targets) {
      if (keep && want.has(target.id) && target.checked) continue;
      // First run: everything that can be connected starts switched on.
      want.set(target.id, firstRun && target.claudeFound
        ? { hooks: true, sl: true }
        : { hooks: target.hooks, sl: target.statusline });
    }
    loading = false;
    draw();
  }

  // A WSL distro starts and stops by itself: look again when the window comes back to the front.
  window.addEventListener("focus", () => {
    if (!reviewing) void load([], true);
  });

  function draw() {
    reviewing = false;
    clear(body);
    if (firstRun) {
      body.append(h("div", { class: "notice ok" },
        h("span", { text: t("conn.welcome") }), " ",
        h("button", {
          text: t("conn.welcomeDone"),
          onclick: () => { settings.setupDone = true; void save(); void load(); },
        }),
      ));
    } else {
      body.append(h("div", { class: "hint", text: t("conn.hint") }));
    }
    if (!hookReady) {
      body.append(h("div", { class: "notice warn", text: t("set.relayMissing") }));
    }

    for (const target of targets) {
      if (!target.checked) {
        body.append(h("div", { class: "card" },
          h("div", { class: "row" },
            statusDot(false),
            h("strong", { text: target.label }),
            h("div", { class: "grow" }),
            h("button", { text: t("conn.check"), onclick: () => void load([target.id]) }),
          ),
          h("div", { class: "hint", text: t("conn.stopped") }),
        ));
        continue;
      }
      const w = want.get(target.id)!;
      const changed = w.hooks !== target.hooks || w.sl !== target.statusline;
      const apply = h("button", {
        class: "primary", text: t("conn.apply"),
        onclick: () => void review(target.id),
      });
      apply.disabled = !changed || !!target.error || (!hookReady && w.hooks && !target.hooks);
      body.append(h("div", { class: "card" },
        h("div", { class: "row" },
          statusDot(target.hooks),
          h("strong", { text: target.label }),
          h("span", { class: "path", text: target.settingsPath }),
          h("div", { class: "grow" }),
          apply,
        ),
        target.error
          ? h("div", { class: "notice err", text: target.error })
          : target.claudeFound
            ? null
            : h("div", { class: "hint", text: t("conn.notFound") }),
        h("div", { class: "row" },
          toggle(w.hooks, (v) => { w.hooks = v; draw(); }),
          h("label", { text: t("conn.hooks") }),
          h("span", { class: "hint", text: t("conn.hooksHint") }),
        ),
        h("div", { class: "row" },
          toggle(w.sl, (v) => { w.sl = v; draw(); }),
          h("label", { text: t("conn.sl") }),
          h("span", { class: "hint", text: t("conn.slHint") }),
        ),
      ));
    }
    if (!targets.some((x) => x.kind === "wsl")) {
      body.append(h("div", { class: "hint", text: t("conn.noWsl") }));
    }
    body.append(h("div", { class: "row" }, h("button", {
      class: "danger", text: t("conn.disconnect"),
      onclick: () => {
        for (const w of want.values()) { w.hooks = false; w.sl = false; }
        draw();
      },
    })));
  }

  async function review(id: string) {
    reviewing = true;
    const w = want.get(id)!;
    let preview;
    try {
      preview = await Bridge.connectPreview(id, w.hooks, w.sl);
    } catch (err) {
      clear(body);
      body.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", { text: t("set.back"), onclick: () => draw() })),
      );
      return;
    }
    if (!preview) return;
    clear(body);
    body.append(
      h("div", { class: "hint", text: `${preview.settingsPath}` }),
      renderDiff(preview.diff),
      h("div", { class: "row" }, h("span", { class: "path", text: `Backup → ${preview.backup}` })),
    );
    const confirm = h("button", { class: "primary", text: t("conn.write") });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.connectApply(id, w.hooks, w.sl, preview.fingerprint);
        clear(body);
        body.append(h("div", { class: "notice ok", text: t("conn.restart", { backup }) }));
        if (!settings.setupDone) {
          settings.setupDone = true;
          void save();
        }
        window.setTimeout(() => void load(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: t("set.cancel"), onclick: () => draw(),
    })));
  }

  void load();
  return section;
}

// ── Claude API section ────────────────────────────────────────────────────────

const MODELS: [string, string][] = [
  ["claude-opus-5", "Claude Opus 5"],
  ["claude-sonnet-5", "Claude Sonnet 5"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
];

function apiSection(hasKey: boolean): HTMLElement {
  const dot = statusDot(hasKey);
  const state = h("span", { class: "hint", text: hasKey ? t("set.keySaved") : t("set.keyNone") });

  const field = h("input", {
    type: "password",
    placeholder: hasKey ? "••••••••••••  (stored)" : "sk-ant-...",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;

  const saveBtn = h("button", { class: "primary", text: "Save key" });
  const clearBtn = h("button", { class: "danger", text: "Remove" });
  const feedback = h("div", {});

  async function refresh() {
    const present = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
    dot.style.background = present ? "#22c55e" : "#f4505e";
    state.textContent = present
      ? t("set.keySaved")
      : t("set.keyNone");
    field.placeholder = present ? "••••••••••••  (stored)" : "sk-ant-...";
    clearBtn.style.display = present ? "" : "none";
  }

  saveBtn.addEventListener("click", async () => {
    const value = field.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("anthropic-api-key", value);
      field.value = "";
      feedback.append(h("div", { class: "notice ok", text: "Saved. It never touches disk." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not save: ${String(err)}` }));
    }
  });

  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("anthropic-api-key");
      feedback.append(h("div", { class: "notice ok", text: "Key removed." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not remove: ${String(err)}` }));
    }
  });

  const model = h("select", {}) as HTMLSelectElement;
  for (const [id, label] of MODELS) model.append(h("option", { value: id, text: label }));
  if (!MODELS.some(([id]) => id === settings.model)) {
    model.append(h("option", { value: settings.model, text: settings.model }));
  }
  model.value = settings.model;
  model.addEventListener("change", () => {
    settings.model = model.value;
    void save();
  });

  clearBtn.style.display = hasKey ? "" : "none";

  return h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Claude" })),
    state,
    h("div", { class: "row" }, h("label", { text: fld("API key") }), field, saveBtn, clearBtn),
    h("div", { class: "row" }, h("label", { text: fld("Model") }), model),
    feedback,
  );
}

// ── General section ───────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    void save();
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  const doneClose = h("input", {
    type: "number", min: "0", max: "60", step: "1",
    value: String(Math.round(settings.doneAutoClose)),
    style: "width:72px",
  }) as HTMLInputElement;
  doneClose.addEventListener("change", () => {
    const n = Number(doneClose.value);
    settings.doneAutoClose = Number.isFinite(n) ? Math.max(0, Math.min(60, Math.round(n))) : 6;
    doneClose.value = String(settings.doneAutoClose);
    void save();
  });

  const notifyMode = h("select", {}) as HTMLSelectElement;
  notifyMode.append(
    h("option", { value: "sound", text: t("set.notify.sound") }),
    h("option", { value: "toast", text: t("set.notify.toast") }),
    h("option", { value: "both", text: t("set.notify.both") }),
    h("option", { value: "none", text: t("set.notify.none") }),
  );
  notifyMode.value = settings.notifyMode;
  notifyMode.addEventListener("change", () => {
    settings.notifyMode = notifyMode.value as Settings["notifyMode"];
    void save();
  });

  const language = h("select", {}) as HTMLSelectElement;
  for (const [code, label] of LANGUAGES) {
    language.append(h("option", { value: code, text: code === "auto" ? t("set.langAuto") : label }));
  }
  language.value = settings.language;
  language.addEventListener("change", async () => {
    settings.language = language.value;
    await save();
    // The island window reloads on its own (settings-changed); so does this one.
    location.reload();
  });

  const planSource = h("select", {}) as HTMLSelectElement;
  planSource.append(
    h("option", { value: "auto", text: t("set.planSrc.auto") }),
    h("option", { value: "windows", text: "Windows" }),
    h("option", { value: "wsl", text: "WSL" }),
  );
  planSource.value = settings.planSource;
  planSource.addEventListener("change", () => {
    settings.planSource = planSource.value;
    void save();
  });
  // What has been heard from each install, so a missing one is easy to spot.
  const heard = loadPlans();
  const ago = (ms: number) => {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return t("ago.now");
    if (m < 60) return t("ago.m", { n: m });
    if (m < 1440) return t("ago.h", { n: Math.round(m / 60) });
    return t("ago.d", { n: Math.round(m / 1440) });
  };
  const accounts = loadAccounts();
  const planSeen = (["windows", "wsl"] as const)
    .map((s) => {
      const a = accounts[s];
      const who = a?.email ? ` (${a.email}${a.plan ? ` · ${planName(a.plan)}` : ""})` : "";
      return `${s === "wsl" ? "WSL" : "Windows"}${who}: ${heard[s] ? ago(heard[s]!.updatedAt) : t("set.planNever")}`;
    })
    .join("  ·  ");

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: t("set.screen.primary") }),
    h("option", { value: "cursor", text: t("set.screen.cursor") }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("set.general") })),
    h("div", { class: "row" },
      h("label", { text: t("set.language") }),
      language,
      h("span", { class: "hint", text: t("set.languageHint") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("set.sound") }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: t("set.autoClose") }),
      autoClose,
      h("span", { class: "hint", text: t("set.autoCloseHint") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("set.finishedCard") }),
      doneClose,
      h("span", { class: "hint", text: t("set.finishedCardHint") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("set.notify") }),
      notifyMode,
      h("span", { class: "hint", text: t("set.notifyHint") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("set.screen") }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: t("set.planLimits") }),
      toggle(settings.showPlanUsage, (v) => { settings.showPlanUsage = v; void save(); }),
      h("span", { class: "hint", text: Object.keys(loadPlans()).length > 0 ? t("set.planLimitsHint") : t("set.planLimitsSetup") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("set.planSrc") }),
      planSource,
      h("span", { class: "hint", text: planSeen }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("set.liveDiff") }),
      toggle(settings.liveDiff, (v) => { settings.liveDiff = v; void save(); }),
      h("span", { class: "hint", text: t("set.liveDiffHint") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("set.autostart") }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
  );
}

// ── Usage and remembered permissions ──────────────────────────────────────────

function usageSection(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:4px" });
  const days = recentUsage();
  if (days.length === 0) {
    list.append(h("div", { class: "hint", text: t("set.usageNone") }));
  }
  const today = new Date();
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  for (const day of days) {
    const name = day.date === key(today) ? t("set.today") : day.date === key(yesterday) ? t("set.yesterday") : day.date;
    list.append(
      h("div", { class: "row" },
        h("label", { text: name }),
        h("span", {
          class: "hint",
          text: [
            t("n.turns", { n: day.turns }),
            formatSpan(day.ms),
            t("n.files", { n: day.files }),
            t("n.cmds", { n: day.commands }),
          ].join(" · "),
        }),
      ),
    );
  }
  return h("section", {}, h("h2", {}, h("span", { text: t("set.usage") })), list);
}

function rulesSection(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:6px" });
  const render = () => {
    clear(list);
    const rules = loadRules();
    if (rules.length === 0) {
      list.append(h("div", { class: "hint", text: t("set.rulesNone") }));
    }
    for (const rule of rules) {
      list.append(
        h("div", { class: "row" },
          h("label", { text: rule.label, style: "flex:1 1 auto;min-width:0" }),
          h("button", {
            class: "link-btn", text: t("set.remove"), style: "color:#f4505e",
            onclick: () => {
              removeRule(rule);
              render();
            },
          }),
        ),
      );
    }
  };
  render();
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("set.rules") })),
    h("div", { class: "hint", text: t("set.rulesHint") }),
    list,
  );
}

// ── Hotkeys section ───────────────────────────────────────────────────────────

/** "KeyA" → "A", "Digit1" → "1", "ArrowUp" → "Up"; null for keys we cannot bind. */
function keyName(e: KeyboardEvent): string | null {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c;
  const named: Record<string, string> = {
    Space: "Space", Enter: "Enter", Tab: "Tab", Home: "Home", End: "End",
    PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete",
    ArrowLeft: "Left", ArrowUp: "Up", ArrowRight: "Right", ArrowDown: "Down",
  };
  return named[c] ?? null;
}

function hotkeysSection(): HTMLElement {
  const rows = h("div", { style: "display:flex;flex-direction:column;gap:6px" });
  const warn = h("div", { class: "hint", style: "min-height:16px" });

  const checkFailed = async () => {
    // The hotkey thread registers a moment after the settings are saved.
    await new Promise((r) => setTimeout(r, 400));
    const failed = (await Bridge.hotkeysFailed()) ?? [];
    const labels = HOTKEY_LABELS.filter(([name]) => failed.includes(name)).map(([name]) => t(`hk.${name}`));
    warn.textContent = labels.length
      ? t("set.hkTaken", { labels: labels.join(", ") })
      : "";
    warn.style.color = labels.length ? "#f4505e" : "";
  };

  for (const [name] of HOTKEY_LABELS) {
    const label = t(`hk.${name}`);
    const field = h("button", { class: "hotkey", title: t("set.hkTitle") }) as HTMLButtonElement;
    const show = () => {
      field.textContent = settings.hotkeys[name] || t("set.hkOff");
      field.classList.toggle("off", !settings.hotkeys[name]);
    };
    const set = (combo: string) => {
      settings.hotkeys = { ...settings.hotkeys, [name]: combo };
      show();
      void save().then(checkFailed);
    };
    const stop = () => {
      field.classList.remove("rec");
      field.removeEventListener("keydown", onKey);
      field.removeEventListener("blur", stop);
      show();
    };
    const onKey = (e: Event) => {
      const k = e as KeyboardEvent;
      k.preventDefault();
      k.stopPropagation();
      if (["Control", "Alt", "Shift", "Meta"].includes(k.key)) return; // wait for the real key
      if (k.key === "Escape") return stop();
      if (k.key === "Backspace") {
        stop();
        return set("");
      }
      const key = keyName(k);
      const mods = [k.ctrlKey && "Ctrl", k.altKey && "Alt", k.shiftKey && "Shift", k.metaKey && "Win"].filter(Boolean);
      if (!key || mods.length === 0) return; // a bare key would swallow typing everywhere
      stop();
      set([...mods, key].join("+"));
    };
    field.addEventListener("click", () => {
      field.classList.add("rec");
      field.textContent = t("set.hkPress");
      field.addEventListener("keydown", onKey);
      field.addEventListener("blur", stop);
      field.focus();
    });
    show();
    const reset = h("button", {
      class: "link-btn", text: t("set.hkReset"), style: "color:#8e939c",
      onclick: () => set(DEFAULT_HOTKEYS[name]),
    });
    rows.append(h("div", { class: "row" }, h("label", { text: label }), field, reset));
  }

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("set.hotkeys") })),
    h("div", { class: "hint", text: t("set.hotkeysHint") }),
    rows,
    warn,
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }
  if (!boot) settings.language = new URLSearchParams(location.search).get("lang") ?? settings.language;
  setLanguage(settings.language);
  const status = (await Bridge.hooksStatus()) ?? {
    installed: false, settingsPath: "", hookPath: "", hookReady: false,
  };

  const hasKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;


  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "Coucou" }), h("span", { class: "version", text: version })),
    connectSection(status.hookReady),
    apiSection(hasKey),
    generalSection(),
    hotkeysSection(),
    rulesSection(),
    usageSection(),
    h("div", {
      class: "hint",
      text: t("set.noTelemetry"),
    }),
  );

  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
  });
}

void main();
