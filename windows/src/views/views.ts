// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { State, formatDuration, type AgentTask, type AskQuestion } from "../core/state";
import { todayLine } from "../core/usage";
import { renderMarkdown } from "./markdown";
import { pullGrip } from "./grip";
import { fileBadge, highlightInto } from "./highlight";
import { paintPlan } from "../core/plan";
import { t } from "../core/i18n";
import { washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../mochi/minibots";
import { buildPrompt } from "./chat";
import { buildUpload } from "./upload";

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
  setFocus(id: string): void;
  openTerminal(): void;
  decide(d: "allow" | "deny"): void;
  /** Change some settings from the in-island panel (saved, and applied right away). */
  setSettings(patch: Partial<typeof State.settings>): void;
  /** The pin in the header: keep the island open. */
  togglePin(): void;
  /** Leave the diff view: back to where it was opened from. */
  leaveDiff(): void;
  /** Allow, and remember the rule so the same kind of request is not asked again. */
  always(): void;
  /** AskUserQuestion: question text → chosen label (several joined by ", "). */
  answerQuestions(answers: Record<string, string>): void;
  /** Give the question back to Claude Code's own prompt. */
  handBack(): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called each time the view comes on screen (not on every refresh). */
  activate?(): void;
  /** Called every frame while the view is on screen. */
  tick?(nowMs: number): void;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

function btn(
  label: string,
  kind: "primary" | "secondary",
  onClick: () => void,
  kbd?: string,
): HTMLElement {
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick },
    h("span", { text: label }),
    kbd ? h("span", { class: "kbd", text: kbd }) : null,
  );
}

/** AgentWho — coloured dot + task name + grey label. */
function agentWho(task: AgentTask | null, label: string): HTMLElement {
  const row = h("div", { class: "who-row" });
  if (task) {
    row.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
  }
  row.append(h("span", { text: label }));
  return row;
}

function stack(padLeft: number, padRight: number, ...children: Node[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...children);
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", title: t("tab.overview"), onclick: () => go("overview") }, svg(ICONS.house, 13));
  const tabChat = h("button", { class: "tab", title: t("tab.ask"), onclick: () => go("prompt") }, svg(ICONS.bubble, 13));

  const pinBtn = h("button", { class: "pin-btn", title: t("hdr.pin"), onclick: () => actions.togglePin() }, svg(ICONS.pin, 14));
  const tabSettings = h("button", { class: "tab", title: t("hdr.settings"), onclick: () => go("settings") }, svg(ICONS.gear, 13));
  const soundBtn = h("button", { title: t("hdr.mute"), onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 14));

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  // Between the tabs and the buttons: the 5-hour and weekly plan limits.
  const planEl = h("div", { class: "plan", "data-plan": "header" });

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabHome, tabChat, tabSettings),
    planEl,
    h("div", { class: "header-actions" }, pinBtn, soundBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      tabHome.classList.toggle("on", v === "overview" || v === "empty");
      tabChat.classList.toggle("on", v === "prompt");
      pinBtn.classList.toggle("on", State.userPinned);
      pinBtn.title = State.userPinned ? t("hdr.unpin") : t("hdr.pin");
      tabSettings.classList.toggle("on", v === "settings");
      clear(tabSettings);
      tabSettings.append(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 13));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14));
      paintPlan(planEl, State.planView(), "header");
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

function buildOverview(actions: ViewActions): ViewHost {
  const ticker = new Ticker();
  const who = h("div", { class: "who" });
  const tickerBody = h("div", { class: "card-body" }, who, ticker.el);
  // What flows past here can be read again: click for the whole history.
  tickerBody.style.cursor = "pointer";
  tickerBody.title = t("ov.showAll");
  tickerBody.addEventListener("click", () => {
    if (State.focusTask) actions.setView("log");
  });
  const leftBody = h("div", { class: "left-body" });
  const left = card(null, leftBody);
  const pills = h("div", { class: "pills" });
  // With no session to list, the right side shows the plan limits instead of staying empty.
  const planCard = h("div", { class: "plan-card", "data-plan": "card" });
  const right = card(null, pills, planCard);

  const el = h("div", { class: "view overview" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
  );

  let pillIds = "";
  let lastFocus: string | null = null;
  let mode: "ticker" | "card" | null = null;
  let cardKey = "";
  let elapsedEl: HTMLElement | null = null;

  /** The state and clock on the right of each wide pill. */
  const paintPillMeta = () => {
    for (const el of pills.querySelectorAll<HTMLElement>(".pill .meta")) {
      const t = State.tasks.find((x) => x.id === el.dataset.id);
      const text = t ? pillMeta(t) : "";
      if (el.textContent !== text) el.textContent = text;
    }
  };

  /** m:ss since the turn began, only while Claude is busy. */
  const paintElapsed = () => {
    const t = State.focusTask;
    if (!elapsedEl || !t) return;
    const busy = ["thinking", "working", "searching", "approval", "question"].includes(t.state);
    const text = busy && t.startedAt ? formatDuration(Date.now() - t.startedAt) : "";
    if (elapsedEl.textContent !== text) elapsedEl.textContent = text;
  };

  return {
    el,
    tick(nowMs: number) {
      if (mode === "ticker") {
        ticker.tick(nowMs);
        paintElapsed();
      }
      paintPillMeta();
    },
    sync() {
      const task = State.focusTask;
      if (task?.id !== lastFocus) {
        lastFocus = task?.id ?? null;
        cardKey = "";
        mode = null;
      }

      // Everything but the "no session yet" placeholder shows its steps in the ticker.
      const sessionActive =
        !!task && (task.id !== "integration_claude" || task.state !== "idle" || task.steps.length > 0);

      if (task && sessionActive) {
        if (mode !== "ticker") {
          clear(leftBody);
          leftBody.append(tickerBody);
          mode = "ticker";
          cardKey = "";
        }
        clear(who);
        who.append(
          dot(task.color, 7),
          h("span", { class: "name", text: task.name }),
          h("span", { class: "tool", text: task.source === "agent" ? "Agent" : "Claude Code" }),
        );
        elapsedEl = h("span", { class: "elapsed" });
        who.append(elapsedEl);
        paintElapsed();
        const latest = task.edits?.[task.edits.length - 1];
        if (latest) {
          who.append(
            h("button", {
              class: "diff-chip",
              title: t("diff.open"),
              // Not the whole card's click, which opens the history.
              onclick: (e: Event) => {
                e.stopPropagation();
                State.selectedEdit = null;
                actions.setView("diff");
              },
            }, `${t("diff.chip")} +${latest.add} −${latest.del}`),
          );
        }
        if (task.steps.length > 1) {
          who.append(h("span", {
            class: "count",
            text: `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}`,
          }));
        }
        ticker.sync(task);
      } else if (task) {
        const key = [task.id, task.state, task.steps.join("|")].join("~");
        if (key !== cardKey) {
          cardKey = key;
          mode = "card";
          clear(leftBody);
          // The placeholder for "no session yet": a plain message.
          leftBody.append(idleCard(actions));
        }
      }

      const shown = State.pillTasks;
      const pillKey = shown.map((t) => `${t.id}:${t.pillBadge ?? ""}:${t.id === State.focusId ? "*" : ""}`).join("|");
      if (pillKey !== pillIds) {
        pillIds = pillKey;
        clear(pills);
        for (const t of shown) pills.append(buildPill(t, actions, t.id === State.focusTask?.id));
        // One or two sessions get a full-width row each, with room for their state.
        pills.classList.toggle("wide", shown.length <= 2);
        pruneMiniBots();
      }
      paintPillMeta();

      const noSessions = shown.length === 0;
      pills.style.display = noSessions ? "none" : "";
      planCard.style.display = noSessions ? "flex" : "none";
      if (noSessions && !paintPlan(planCard, State.planView(), "card")) {
        planCard.replaceChildren(h("div", { class: "plan-waiting", text: t("ov.planWaiting") }));
      }
    },
  };
}

/** Shown while no Claude Code session exists. */
function idleCard(actions: ViewActions): HTMLElement {
  return h("div", { class: "idle-card" },
    h("div", { class: "title", text: t("ov.idleTitle") }),
    h("div", { class: "sub", text: t("ov.idleSub") }),
    btn(t("empty.ask"), "secondary", () => actions.setView("prompt")),
  );
}

/** "thinking · 0:12", "done", "needs you": what a session is up to, in a few words. */
function pillMeta(task: AgentTask): string {
  const busy = ["thinking", "working", "searching"].includes(task.state);
  const clock = task.startedAt ? ` · ${formatDuration(Date.now() - task.startedAt)}` : "";
  switch (task.state) {
    case "thinking": return `${t("pm.thinking")}${clock}`;
    case "working":
    case "searching": return `${t("pm.working")}${clock}`;
    case "approval": return t("pm.needs");
    case "question": return t("pm.asking");
    case "finished": return t("pm.done");
    case "error": return t("pm.error");
    case "ratelimit": return t("pm.rate");
    default: return busy ? clock : "";
  }
}

function buildPill(task: AgentTask, actions: ViewActions, current = false): HTMLElement {
  const label = task.id === "integration_claude" ? "VS Code" : task.name;
  const canvas = createMiniBot(task, 24);
  const pill = h(
    "div",
    { class: "pill", onclick: () => actions.setFocus(task.id) },
    canvas,
    h("span", { class: "lbl", text: label }),
    h("span", { class: "meta", "data-id": task.id }),
  );
  // The pill of the task on show is lit, the others are quiet. Positions never change.
  const rest = () => {
    pill.style.background = current ? `${task.color}2e` : "";
    pill.style.borderColor = current ? `${task.color}8c` : `${task.color}24`;
    pill.style.boxShadow = current ? `0 2px 10px ${task.color}40` : "";
    (pill.querySelector(".lbl") as HTMLElement).style.color = current ? lighten(task.color, 0.3) : "";
  };
  pill.classList.toggle("current", current);
  pill.addEventListener("mouseenter", () => {
    pill.style.background = `${task.color}2e`;
    pill.style.borderColor = `${task.color}8c`;
    pill.style.boxShadow = `0 2px 10px ${task.color}59`;
    (pill.querySelector(".lbl") as HTMLElement).style.color = lighten(task.color, 0.3);
  });
  pill.addEventListener("mouseleave", rest);
  rest();

  if (task.pillBadge) {
    const colors = { approval: "#F5A524", finished: "#22C55E", error: "#F4505E" } as const;
    const icons = { approval: ICONS.bang, finished: ICONS.check, error: ICONS.xmark } as const;
    const inner = h("i", { style: `background:${colors[task.pillBadge]}` }, svg(icons[task.pillBadge], 6, { stroke: task.pillBadge === "finished" ? 3 : 0 }));
    const badge = h("div", { class: "pill-badge" }, inner);
    badge.style.boxShadow = `0 0 4px ${colors[task.pillBadge]}99`;
    pill.append(badge);
  }
  return pill;
}

function lighten(hex: string, amount: number): string {
  const v = parseInt(hex.replace("#", ""), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) =>
    Math.min(255, Math.round(x + amount * 255)),
  );
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(actions: ViewActions): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px;flex-direction:row;align-items:center;gap:16px" },
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:5px" },
      h("div", { class: "title", text: t("empty.title") }),
      h("div", { class: "sub", text: t("empty.sub") }),
    ),
    h("div", { class: "grow" }),
    btn(t("empty.ask"), "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Approval ──────────────────────────────────────────────────────────────────

/** How long the buttons stay asleep after a card appears (longer for a dangerous one). */
const GUARD_MS = 350;
const GUARD_DANGER_MS = 900;

function buildApproval(actions: ViewActions): ViewHost {
  const who = h("div");
  const code = h("div", { class: "code wrap" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("amber", stack(116, 16, who, code, row)), pullGrip());
  let rowKey = "";
  return {
    el,
    sync() {
      const req = State.pendingApproval;
      clear(who);
      who.append(agentWho(State.focusTask, req?.danger ? `${t("ap.needs")} · ⚠ ${req.danger}` : t("ap.needs")));
      // The whole point of approving here rather than in the terminal: this is the
      // command, the file path or the URL being authorised, not just the name of
      // the tool asking. Long ones wrap instead of being cut off.
      const text = req?.command || req?.tool || "…";
      code.textContent = text;
      code.title = text;
      code.classList.toggle("danger", !!req?.danger);

      // Built once per request. Rebuilding buttons between a mouse-down and a
      // mouse-up would swallow the click.
      const key = `${req?.requestId ?? ""}|${req?.rule ? 1 : 0}`;
      if (rowKey === key) return;
      rowKey = key;
      clear(row);
      const deny = btn(t("ap.deny"), "secondary", () => actions.decide("deny"), "N");
      const allow = btn(t("ap.allow"), "primary", () => actions.decide("allow"), "Y");
      const guarded = [allow];
      row.append(deny);
      if (req?.rule) {
        const always = btn(t("ap.always"), "secondary", () => actions.always());
        always.title = t("ap.alwaysTitle", { label: req.rule.label });
        guarded.push(always);
        row.append(always);
      }
      row.append(allow);
      // Asleep for a moment, so a click aimed at something else cannot approve it.
      guarded.forEach((b) => b.classList.add("wait"));
      window.setTimeout(
        () => guarded.forEach((b) => b.classList.remove("wait")),
        req?.danger ? GUARD_DANGER_MS : GUARD_MS,
      );
    },
  };
}

// ── Log (the whole history of the focused session, scrollable) ───────────────

function buildLog(actions: ViewActions): ViewHost {
  const who = h("div");
  const list = h("div", { class: "log-list" });
  const back = h("button", { class: "log-back", title: t("log.backTitle"), onclick: () => actions.setView(State.defaultView()) }, t("log.back"));
  const head = h("div", { class: "log-head" }, who, back);
  // Shown only when you have scrolled away from the newest line.
  const latest = h("button", { class: "log-latest", onclick: () => follow() }, t("log.latest"));
  // The grip at the bottom edge: pull it down for a larger island, up to put it back.
  const el = h("div", { class: "view" }, card(null, stack(116, 16, head, list), latest), pullGrip());

  let rendered = "";
  /** Following: the view stays on the newest line as things arrive. */
  let following = true;
  /** Scroll events caused by our own scrolling are not the reader moving. */
  let quietUntil = 0;

  const toBottom = () => {
    quietUntil = performance.now() + 120;
    list.scrollTop = list.scrollHeight;
  };
  const setFollowing = (on: boolean) => {
    following = on;
    latest.style.display = on ? "none" : "";
  };
  const follow = () => {
    setFollowing(true);
    toBottom();
  };

  // Scrolling up stops following; reaching the bottom again resumes it.
  /** Where the reader was, for coming back from a diff. */
  let savedTop = 0;
  list.addEventListener("scroll", () => {
    if (performance.now() < quietUntil) return;
    savedTop = list.scrollTop;
    setFollowing(list.scrollTop + list.clientHeight >= list.scrollHeight - 12);
  });
  // The island grows to its full height while opening, which moves the bottom:
  // while following, the view keeps up.
  new ResizeObserver(() => {
    if (following) toBottom();
  }).observe(list);
  setFollowing(true);

  const draw = () => {
    const task = State.focusTask;
    clear(who);
    who.append(agentWho(task, t("log.history")));

    const log = task?.log ?? [];
    // Re-drawn only when something was added.
    const key = `${task?.id ?? ""}:${log.length}`;
    if (key === rendered) return;
    const keep = list.scrollTop;
    rendered = key;
    clear(list);
    if (log.length === 0) list.append(h("div", { class: "log-empty", text: t("log.empty") }));
    for (const entry of log) {
      if (entry.editId !== undefined) {
        const id = entry.editId;
        list.append(
          h("div", {
            class: "log-entry step log-edit",
            title: t("diff.open"),
            onclick: () => {
              State.selectedEdit = { taskId: task?.id ?? "", id };
              actions.setView("diff");
            },
          }, entry.text),
        );
      } else if (entry.kind === "reply") {
        // Claude writes Markdown: draw it.
        const node = h("div", { class: "log-entry reply md" });
        node.append(renderMarkdown(entry.text));
        list.append(node);
      } else {
        const text = entry.kind === "prompt" ? `› ${entry.text}` : entry.text;
        list.append(h("div", { class: `log-entry ${entry.kind}`, text }));
      }
    }
    if (following) toBottom();
    else list.scrollTop = keep;
  };

  return {
    el,
    sync: draw,
    // Opened: always at the newest line, and following. Coming back from a diff is not an
    // opening: it is left as it was.
    activate() {
      if (State.keepLogScroll) {
        State.keepLogScroll = false;
        draw();
        const restore = () => {
          if (following) toBottom();
          else {
            quietUntil = performance.now() + 120;
            list.scrollTop = savedTop;
          }
        };
        restore();
        requestAnimationFrame(restore);
        window.setTimeout(restore, 120);
        return;
      }
      rendered = "";
      setFollowing(true);
      draw();
      toBottom();
      // The view may not be laid out yet: settle again once it is.
      requestAnimationFrame(toBottom);
      window.setTimeout(toBottom, 120);
      window.setTimeout(toBottom, 400);
    },
  };
}

// ── Diff (a file edit: the steps on the left, the changed code on the right) ──

function buildDiff(actions: ViewActions): ViewHost {
  const name = h("div", { class: "diff-name" });
  const steps = h("div", { class: "diff-steps" });
  const left = h("div", { class: "diff-left" }, name, h("div", { class: "diff-sub", text: "Claude Code" }), steps);

  const tabs = h("div", { class: "diff-tabs" });
  const code = h("div", { class: "diff-code" });
  const out = h("div", { class: "diff-out" });
  const right = h("div", { class: "diff-right" }, tabs, code, out);
  // The wheel scrolls whatever is under it (the code, the command output) by hand: the island
  // window never has the focus, and a wheel turn must not depend on that.
  for (const pane of [code, out]) {
    pane.addEventListener("wheel", (e) => {
      if (pane.scrollHeight <= pane.clientHeight) return;
      pane.scrollTop += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }
  const el = h("div", { class: "view" }, card(null, h("div", { class: "diff-body" }, left, right)), pullGrip());

  let rendered = "";

  /** The edit on show: the one picked, else the latest of the session on screen. */
  const current = () => {
    const task = State.focusTask;
    const edits = task?.edits ?? [];
    const picked = State.selectedEdit;
    const rec = (picked && picked.taskId === task?.id ? edits.find((e) => e.id === picked.id) : undefined) ?? edits[edits.length - 1];
    return { task, edits, rec };
  };

  const draw = () => {
    const { task, edits, rec } = current();
    const key = [
      task?.id, rec?.id, rec?.rows.length, rec?.placed, edits.length,
      (task?.checklist ?? []).map((c) => `${c.label}:${c.state}`).join(","),
      task?.lastOutput?.at ?? 0, State.enlarged,
    ].join("|");
    if (key === rendered) return;
    const sameEdit = rendered.startsWith(`${task?.id}|${rec?.id}|`);
    rendered = key;

    // Left: whose session, and the steps of the turn.
    name.textContent = task?.name ?? "";
    clear(steps);
    for (const item of task?.checklist ?? []) {
      steps.append(
        h("div", { class: `diff-step ${item.state}` },
          h("span", { class: "ck", text: item.state === "done" ? "✓" : "◐" }),
          h("span", { text: item.label }),
        ),
      );
    }

    // Right, top: one tab per file edited (the latest edit of each), then the numbers.
    clear(tabs);
    const seen = new Set<string>();
    const latestPerFile = [...edits].reverse().filter((e) => (seen.has(e.file) ? false : (seen.add(e.file), true))).slice(0, 4).reverse();
    for (const e of latestPerFile) {
      const badge = fileBadge(e.file);
      const base = e.file.split(/[\\/]/).pop() ?? e.file;
      const tab = h("button", {
        class: `diff-tab${rec && e.file === rec.file ? " on" : ""}`,
        title: e.file,
        onclick: () => {
          State.selectedEdit = { taskId: task?.id ?? "", id: e.id };
          State.notify();
        },
      },
        h("i", { class: "diff-badge", text: badge.label, style: `color:${badge.color};border-color:${badge.color}66` }),
        h("span", { class: "diff-file", text: base }),
      );
      tabs.append(tab);
    }
    if (rec) {
      const parts = rec.file.split(/[\\/]/).filter(Boolean);
      // Several edits of this file: step through them, oldest to newest.
      const same = edits.filter((e) => e.file === rec.file);
      const at = same.findIndex((e) => e.id === rec.id);
      const step = (to: number) => {
        State.selectedEdit = { taskId: task?.id ?? "", id: same[to].id };
        State.notify();
      };
      const stepper = same.length > 1
        ? h("span", { class: "diff-stepper" },
            h("button", { title: t("diff.prev"), disabled: at <= 0, onclick: () => step(at - 1) }, "‹"),
            h("span", { text: `${at + 1}/${same.length}` }),
            h("button", { title: t("diff.next"), disabled: at >= same.length - 1, onclick: () => step(at + 1) }, "›"),
          )
        : null;
      tabs.append(
        h("span", { class: "diff-spacer" }),
        ...(stepper ? [stepper] : []),
        h("span", { class: "diff-counts" },
          h("b", { class: "plus", text: `+${rec.add}` }),
          h("b", { class: "minus", text: `−${rec.del}` }),
        ),
        h("span", { class: "diff-path", text: parts.slice(-3).join("/"), title: rec.file }),
      );
    }
    tabs.append(h("button", { class: "log-back", title: t("log.backTitle"), onclick: () => actions.leaveDiff() }, t("log.back")));
    // Three or more files: only the one on show keeps its name (the others are badges, the
    // full name and path are in the tooltip), or every name would be cut to a letter or two.
    tabs.classList.toggle("many", latestPerFile.length >= 3);

    // Right, middle: the changed code.
    clear(code);
    if (!rec) {
      code.append(h("div", { class: "diff-empty", text: t("diff.none") }));
    } else {
      for (const r of rec.rows) {
        if (r.kind === "gap") {
          code.append(h("div", { class: "diff-row gap" }, h("span", { class: "txt", text: r.text })));
          continue;
        }
        const txt = h("span", { class: "txt" });
        highlightInto(txt, r.text, rec.file);
        if (r.text === "") txt.append(" ");
        code.append(
          h("div", { class: `diff-row ${r.kind}` },
            h("span", { class: "no", text: r.no !== undefined ? String(r.no) : "" }),
            h("span", { class: "sign", text: r.kind === "add" ? "+" : r.kind === "del" ? "−" : "" }),
            txt,
          ),
        );
      }
      if (rec.more > 0) code.append(h("div", { class: "diff-row gap" }, h("span", { class: "txt", text: t("diff.more", { n: rec.more }) })));
      // Open on the change itself, not on the context above it.
      if (!sameEdit) {
        const firstChange = code.querySelector<HTMLElement>(".add, .del");
        code.scrollTop = firstChange ? Math.max(0, firstChange.offsetTop - 48) : 0;
      }
    }

    // Right, bottom: what the last command printed, if it came after this edit.
    clear(out);
    const o = task?.lastOutput;
    if (o && rec && o.at >= rec.at) {
      out.style.display = "";
      out.append(h("div", { class: "out-cmd", title: o.command, text: `$ ${o.command}` }));
      const lines = o.text ? o.text.split("\n") : [t("diff.noOutput")];
      for (const line of lines) {
        const tone = /\b(fail|failed|error|✗|✖)\b/i.test(line) ? "bad" : /\b(pass|passed|ok|✓|✔|success)\b/i.test(line) ? "good" : "";
        out.append(h("div", { class: `out-line ${tone}`, text: line }));
      }
      // The end is what matters (the test result): open on it, and scroll up for the rest.
      const toEnd = () => { out.scrollTop = out.scrollHeight; };
      toEnd();
      requestAnimationFrame(toEnd);
    } else {
      out.style.display = "none";
    }
  };

  return {
    el,
    sync: draw,
    // Opened: from the top of the change.
    activate() {
      rendered = "";
      draw();
    },
  };
}

// ── Ask (AskUserQuestion answered from the island) ───────────────────────────

function buildAsk(actions: ViewActions): ViewHost {
  const who = h("div");
  const question = h("div", { class: "ask-question" });
  const row = h("div", { class: "actions ask-options" });
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, question, row)), pullGrip());

  let askFor = "";
  let qIndex = 0;
  let answers: Record<string, string> = {};
  let picked: string[] = [];
  let rowKey = "";
  let optionBtns: HTMLElement[] = [];

  const current = (): { qs: AskQuestion[]; q: AskQuestion } | null => {
    const qs = State.pendingApproval?.questions;
    if (!qs || qs.length === 0) return null;
    return { qs, q: qs[Math.min(qIndex, qs.length - 1)] };
  };

  /** Records the answer to the current question; the last one sends them all. */
  const settle = (value: string) => {
    const cur = current();
    if (!cur) return;
    answers[cur.q.question] = value;
    if (qIndex + 1 >= cur.qs.length) {
      actions.answerQuestions(answers);
      return;
    }
    qIndex += 1;
    picked = [];
    State.notify();
  };

  const choose = (i: number) => {
    const cur = current();
    const opt = cur?.q.options[i];
    if (!cur || !opt) return;
    if (!cur.q.multiSelect) {
      settle(opt.label);
      return;
    }
    picked = picked.includes(opt.label) ? picked.filter((l) => l !== opt.label) : [...picked, opt.label];
    State.notify();
  };

  // Ctrl+Alt+1…4 from anywhere (see Island.onHotkey).
  window.addEventListener("coucou-pick", (e) => choose((e as CustomEvent<number>).detail));

  return {
    el,
    sync() {
      const cur = current();
      const req = State.pendingApproval;
      if (!cur || !req) return;
      if (askFor !== req.requestId) {
        askFor = req.requestId;
        qIndex = 0;
        answers = {};
        picked = [];
        rowKey = "";
      }
      const { qs, q } = cur;
      clear(who);
      who.append(agentWho(State.focusTask, qs.length > 1 ? `${t("ask.asks")} · ${qIndex + 1}/${qs.length}` : t("ask.asks")));
      question.textContent = q.question;

      // Built once per question: rebuilding buttons between a mouse-down and a
      // mouse-up would swallow the click.
      const key = `${req.requestId}#${qIndex}`;
      if (rowKey !== key) {
        rowKey = key;
        clear(row);
        optionBtns = q.options.map((o, i) => {
          const b = btn(o.label, "secondary", () => choose(i));
          if (o.description) b.title = o.description;
          return b;
        });
        row.append(...optionBtns);
        if (q.multiSelect) {
          row.append(
            btn(t("ask.send"), "primary", () => {
              if (picked.length > 0) settle(picked.join(", "));
            }),
          );
        }
        row.append(btn(t("ask.terminal"), "secondary", () => actions.handBack()));
      }
      optionBtns.forEach((b, i) => b.classList.toggle("on", picked.includes(q.options[i].label)));
    },
  };
}

// ── Question ──────────────────────────────────────────────────────────────────

function buildQuestion(): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title clamp2" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, t("q.title")));
      const task = State.focusTask;
      title.textContent = task?.steps.at(-1) ?? t("q.fallback");
      clear(row);
      row.append(h("div", { class: "sub", text: t("q.hint") }));
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", text: t("err.session") });
  const detail = h("div", { class: "detail err-detail" });
  const row = h("div", { class: "actions" },
    btn("OK", "primary", () => actions.collapse()),
    btn(t("err.history"), "secondary", () => actions.setView("log")),
  );
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
  return {
    el,
    sync() {
      const task = State.focusTask;
      clear(who);
      who.append(agentWho(task, "Claude Code"));
      title.textContent = t("err.session");
      // One line of text whatever it contains (a prompt with line breaks used to stretch the card).
      const why = (task?.lastError ?? task?.steps.at(-1) ?? t("err.noDetail")).replace(/\s+/g, " ").trim();
      detail.textContent = why;
      detail.title = why;
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

/** How many lines (1–4) a title takes in the finished card: Japanese characters are wide, the rest about half. */
function titleLines(text: string): number {
  let width = 0;
  for (const ch of text) width += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55;
  return Math.max(1, Math.min(4, Math.ceil(width / 38)));
}

function buildFinished(actions: ViewActions, onHeightChange: () => void): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title clamp4" });
  const detail = h("div", { class: "sub finished-sub" });
  const read = btn(t("fin.read"), "secondary", () => actions.setView("log"));
  const row = h("div", { class: "actions" },
    btn("OK", "primary", () => actions.collapse()),
    read,
  );
  title.style.cursor = "pointer";
  title.addEventListener("click", () => actions.setView("log"));
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, detail, row)));
  return {
    el,
    sync() {
      // Only worth a button when there is more to read than the title shows.
      const replies = (State.focusTask?.log ?? []).filter((e) => e.kind === "reply");
      const reply = replies.length > 0 ? replies[replies.length - 1].text : "";
      read.style.display = reply.length > 80 || reply.includes("\n") ? "" : "none";
      clear(who);
      const took = State.focusTask?.lastDurationMs;
      who.append(agentWho(State.focusTask, took ? t("fin.finishedIn", { time: formatDuration(took) }) : t("fin.finished")));
      const text = State.focusTask?.steps.at(-1) ?? t("fin.session");
      title.textContent = text;
      detail.textContent = [State.focusTask?.summary, todayLine()].filter(Boolean).join("  ·  ");
      // A long first line: the island grows by what the extra lines need (20 px each).
      const extra = (titleLines(text) - 1) * 20;
      if (extra !== State.finishedExtra) {
        State.finishedExtra = extra;
        onHeightChange();
      }
    },
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: t("confused.title") }),
    h("div", { class: "sub", text: t("confused.sub") }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title clamp2" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── In-island settings ────────────────────────────────────────────────────────

function buildSettings(actions: ViewActions): ViewHost {
  type S = typeof State.settings;
  const syncs: (() => void)[] = [];

  /** A row of choices; the one matching the setting is lit. */
  function seg<K extends keyof S>(key: K, options: [S[K], string][]): HTMLElement {
    const buttons = options.map(([value, label]) =>
      h("button", { onclick: () => actions.setSettings({ [key]: value } as Partial<S>) }, label));
    syncs.push(() => buttons.forEach((b, i) => b.classList.toggle("on", State.settings[key] === options[i][0])));
    return h("div", { class: "seg" }, ...buttons);
  }

  /** A switch for a yes/no setting. */
  function flag(key: "liveDiff" | "showPlanUsage" | "autostart" | "soundEnabled" | "alwaysShow", onToggle?: () => void): HTMLElement {
    const sw = h("button", {
      class: "switch",
      onclick: () => (onToggle ? onToggle() : actions.setSettings({ [key]: !State.settings[key] } as Partial<S>)),
    });
    syncs.push(() => sw.classList.toggle("on", !!State.settings[key]));
    return sw;
  }

  const row = (label: string, control: HTMLElement, extra?: HTMLElement) =>
    h("div", { class: "mini-row" }, h("span", { class: "mini-label", text: label }), ...(extra ? [extra] : []), control);

  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  syncs.push(() => {
    volume.value = String(State.settings.soundVolume);
    volume.style.opacity = State.settings.soundEnabled ? "1" : "0.4";
  });

  const claudeBadge = h("span", { class: "status-badge" });
  const apiBadge = h("span", { class: "status-badge" });
  syncs.push(() => {
    clear(claudeBadge);
    claudeBadge.append(dot(State.settings.hooksInstalled ? "#22C55E" : "#F4505E", 6), h("span", { text: "Claude Code" }));
    clear(apiBadge);
    apiBadge.append(dot("#F4505E", 6), h("span", { text: "API" }));
  });

  const left = h("div", { class: "mini-col" },
    h("div", { class: "mini-head", text: t("set.sound") }),
    row(t("set.sound"), flag("soundEnabled", () => actions.toggleSound()), volume),
    row(t("mini.notify"), seg("notifyMode", [
      ["sound", t("mini.n.sound")], ["toast", t("mini.n.toast")], ["both", t("mini.n.both")], ["none", t("mini.n.none")],
    ])),
    row(t("mini.screen"), seg("screen", [["primary", t("mini.main")], ["cursor", t("mini.cursor")]])),
    row(t("mini.always"), flag("alwaysShow")),
  );
  const right = h("div", { class: "mini-col" },
    h("div", { class: "mini-head", text: t("set.autoClose") }),
    row(t("set.autoClose"), seg("autoCloseInterval", [[10, "10s"], [15, "15s"], [30, "30s"], [60, "60s"]])),
    row(t("mini.done"), seg("doneAutoClose", [[3, "3s"], [6, "6s"], [15, "15s"], [0, t("mini.never")]])),
    row(t("mini.live"), flag("liveDiff")),
    row(t("mini.plan"), flag("showPlanUsage")),
    row(t("mini.startup"), flag("autostart")),
  );

  const footer = h("div", { class: "mini-foot" },
    claudeBadge, apiBadge, h("div", { class: "grow" }),
    h("button", {
      class: "link-btn",
      style: "color:#8e939c;font-size:11.5px",
      text: t("mini.openSettings"),
      // The window opens, and the island gets out of its way.
      onclick: () => {
        actions.openSettingsWindow();
        actions.collapse();
      },
    }),
  );

  const el = h("div", { class: "view" },
    card(null, h("div", { class: "stack mini", style: "padding:12px 18px 12px 96px" },
      h("div", { class: "mini-grid2" }, left, right), footer)));

  return {
    el,
    sync() {
      for (const f of syncs) f();
    },
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function buildViews(
  actions: ViewActions,
  onChatHeightChange: () => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  map.set("overview", buildOverview(actions));
  map.set("empty", buildEmpty(actions));
  map.set("approval", buildApproval(actions));
  map.set("ask", buildAsk(actions));
  map.set("log", buildLog(actions));
  map.set("diff", buildDiff(actions));
  map.set("question", buildQuestion());
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions, onChatHeightChange));
  map.set("confused", buildConfused());
  map.set("note", buildNote());
  map.set("settings", buildSettings(actions));
  map.set("prompt", buildPrompt(onChatHeightChange));
  map.set("upload", buildUpload());
  return map;
}
