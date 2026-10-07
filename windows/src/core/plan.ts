// Claude plan usage: the 5-hour and weekly limits, as Claude Code reports them.
//
// Claude Code hands every status line command a JSON with `rate_limits`:
//   { five_hour: { used_percentage, resets_at }, seven_day: { ... } }
// (Pro and Max plans only; `resets_at` is an epoch in seconds.) coucou-hook
// --statusline-relay forwards that to the island, so no key or login is read.
// The numbers move when Claude answers, the clock counts down every second.

import { t } from "./i18n";

const STORAGE_KEY = "coucou.plans";

export interface PlanWindow {
  /** 0–100 */
  pct: number;
  /** Epoch seconds. */
  resetsAt: number;
}

export interface PlanUsage {
  fiveHour?: PlanWindow;
  sevenDay?: PlanWindow;
  /** When Coucou last heard, epoch milliseconds. */
  updatedAt: number;
}

function window_(raw: unknown): PlanWindow | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const pct = Number(r.used_percentage);
  const resetsAt = Number(r.resets_at);
  // Absurd values are ignored, as on macOS.
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return undefined;
  if (!Number.isFinite(resetsAt) || resetsAt <= 0) return undefined;
  return { pct, resetsAt };
}

/** The `rate_limits` object → usage, or null when it holds nothing usable. */
export function parsePlan(raw: unknown): PlanUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fiveHour = window_(r.five_hour);
  const sevenDay = window_(r.seven_day);
  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay, updatedAt: Date.now() };
}

// ── `/usage` text ─────────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** How far a time zone is ahead of UTC at a given moment, in ms. */
function zoneOffsetMs(epochMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(epochMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - epochMs;
}

/** A wall-clock time in a zone ("5:39am in Asia/Tokyo") → epoch seconds. */
function wallToEpoch(y: number, mo: number, d: number, h: number, mi: number, zone?: string): number {
  if (zone) {
    try {
      const wall = Date.UTC(y, mo, d, h, mi);
      let guess = wall - zoneOffsetMs(wall, zone);
      guess = wall - zoneOffsetMs(guess, zone); // once more, across a clock change
      return Math.floor(guess / 1000);
    } catch {
      // An unknown zone name: use this computer's clock.
    }
  }
  return Math.floor(new Date(y, mo, d, h, mi).getTime() / 1000);
}

/** "Oct 7, 5:39am (Asia/Tokyo)" or just "5:39am" → epoch seconds, or null. */
function parseReset(text: string, nowMs: number): number | null {
  const zone = /\(([^)]+)\)\s*$/.exec(text.trim())?.[1];
  const time = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text);
  if (!time) return null;
  let hour = Number(time[1]) % 12;
  if (time[3].toLowerCase() === "pm") hour += 12;
  const minute = Number(time[2] ?? 0);

  const date = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/.exec(text);
  const now = new Date(nowMs);
  if (date) {
    const month = MONTHS.indexOf(date[1].toLowerCase());
    if (month < 0) return null;
    let year = now.getFullYear();
    let at = wallToEpoch(year, month, Number(date[2]), hour, minute, zone);
    // Early January for a December date, or the other way round: the nearest year.
    if (at * 1000 < nowMs - 30 * 86400_000) at = wallToEpoch(++year, month, Number(date[2]), hour, minute, zone);
    return at;
  }
  // Only a time: the next time the clock reads that.
  let at = wallToEpoch(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, zone);
  if (at * 1000 <= nowMs) at += 86400;
  return at;
}

/**
 * What `claude -p "/usage"` prints:
 *   Current session: 99% used · resets Oct 7, 5:39am (Asia/Tokyo)
 *   Current week (all models): 38% used · resets Oct 12, 1:59pm (Asia/Tokyo)
 * Anything that does not look like that gives null (a signed-out install, say).
 */
export function parsePlanText(text: string, nowMs = Date.now()): PlanUsage | null {
  const line = (label: RegExp): PlanWindow | undefined => {
    const m = new RegExp(label.source + String.raw`:\s*(\d+(?:\.\d+)?)%\s*used\s*[·•|-]\s*resets\s+([^\n]+)`, "i").exec(text);
    if (!m) return undefined;
    const resetsAt = parseReset(m[2], nowMs);
    return resetsAt ? window_({ used_percentage: Number(m[1]), resets_at: resetsAt }) : undefined;
  };
  const fiveHour = line(/Current session/);
  const sevenDay = line(/Current week \(all models\)/);
  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay, updatedAt: nowMs };
}

// ── Whose limits these are ────────────────────────────────────────────────────

const ACCOUNT_KEY = "coucou.accounts";

/** The Claude account an install is signed in to (from `claude auth status`). */
export interface PlanAccount {
  email: string;
  /** "pro", "max"… as the CLI says it. */
  plan?: string;
  /** "claude.ai" for a subscription. */
  method?: string;
}
export type AccountSet = Partial<Record<PlanSource, PlanAccount>>;

/** The JSON `claude auth status` prints → the account, or null (signed out, unreadable). */
export function parseAccount(text: string | null | undefined): PlanAccount | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    if (!v || v.loggedIn === false || typeof v.email !== "string" || !v.email) return null;
    return {
      email: v.email,
      plan: typeof v.subscriptionType === "string" ? v.subscriptionType : undefined,
      method: typeof v.authMethod === "string" ? v.authMethod : undefined,
    };
  } catch {
    return null;
  }
}

/** "pro" → "Pro", "max" → "Max": how the CLI names the plan, written out. */
export function planName(plan: string): string {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : plan;
}

export function loadAccounts(): AccountSet {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "{}");
    const out: AccountSet = {};
    for (const source of ["windows", "wsl"] as const) {
      const a = raw?.[source];
      if (a && typeof a.email === "string") out[source] = { email: a.email, plan: a.plan, method: a.method };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAccounts(set: AccountSet) {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(set));
  } catch {
    // Not stored: it is asked again at the next start.
  }
}

/** What a window shows now: once its reset time has passed it is back to 0%. */
export function shownPct(w: PlanWindow, nowMs = Date.now()): number {
  return w.resetsAt * 1000 <= nowMs ? 0 : w.pct;
}

/** Green under 50, amber to 80, red above: the macOS thresholds. */
export function planColor(pct: number): string {
  if (pct >= 80) return "#F4505E";
  if (pct >= 50) return "#F59E0B";
  return "#22C55E";
}

/** "2h 12m", "45m", "30s": time left until the window resets. */
export function timeLeft(resetsAt: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round(resetsAt - nowMs / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The reset moment as a clock: "15:40" today, "Sat 10:00" on another day. */
export function resetClock(resetsAt: number, nowMs = Date.now()): string {
  const d = new Date(resetsAt * 1000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date(nowMs).toDateString() ? time : `${t(`day.${d.getDay()}`)} ${time}`;
}

/** Windows and WSL are separate Claude Code installs, possibly signed in to different accounts. */
export type PlanSource = "windows" | "wsl";
export type PlanSet = Partial<Record<PlanSource, PlanUsage>>;

/** A path of this install: a Linux path is WSL, a drive letter or UNC path is Windows. */
export function sourceOf(cwd: unknown): PlanSource | null {
  if (typeof cwd !== "string" || !cwd) return null;
  if (cwd.startsWith("/")) return "wsl";
  if (/^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("\\\\")) return "windows";
  return null;
}

/** What to draw: the limits, and a short tag naming whose they are when it is not obvious. */
/** The window that is fullest right now (the one a limit error is about), or null. */
export function hardestWindow(plan: PlanUsage | undefined, nowMs = Date.now()): PlanWindow | null {
  const windows = [plan?.fiveHour, plan?.sevenDay].filter((w): w is PlanWindow => !!w && w.resetsAt * 1000 > nowMs);
  if (windows.length === 0) return null;
  return windows.reduce((a, b) => (shownPct(b, nowMs) > shownPct(a, nowMs) ? b : a));
}

/** The thresholds (80, 90…) that a window went up through between two readings. */
export function crossedUp(before: number | undefined, after: number, thresholds: number[] = [80, 90]): number[] {
  if (before === undefined) return []; // the first reading after a start tells nothing about a crossing
  return thresholds.filter((t) => before < t && after >= t);
}

/** What the hover on the plan numbers says: each line can be left out, the e-mail can be masked. */
export interface TipOptions {
  email: "full" | "masked" | "hidden";
  /** Windows / WSL, in front of the account. */
  source: boolean;
  /** "Plan: Pro". */
  plan: boolean;
  /** The 5-hour and the weekly line. */
  five: boolean;
  week: boolean;
  /** "…, resets 15:40" at the end of those two lines. */
  reset: boolean;
  /** "Updated 3m ago". */
  updated: boolean;
}

export const DEFAULT_TIP: TipOptions = { email: "full", source: true, plan: true, five: true, week: true, reset: true, updated: false };

export interface PlanView {
  plan: PlanUsage;
  tag?: string;
  source?: PlanSource;
  account?: PlanAccount;
  /** What the hover shows (everything but "updated" when absent). */
  tip?: TipOptions;
  /** What the closed notch shows: both windows, only the 5-hour one, only the weekly one, or nothing. */
  compact?: "both" | "five" | "week" | "none";
}

/** "work@example.com" → "w***@example.com". */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at < 1 ? "***" : `${email[0]}***${email.slice(at)}`;
}

function agoText(thenMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - thenMs) / 60_000));
  if (minutes < 1) return t("ago.now");
  if (minutes < 60) return t("ago.m", { n: minutes });
  if (minutes < 1440) return t("ago.h", { n: Math.floor(minutes / 60) });
  return t("ago.d", { n: Math.floor(minutes / 1440) });
}

/** The lines of the hover text, as the options say. Empty when everything is switched off. */
export function planTip(view: PlanView, nowMs = Date.now()): string[] {
  const o = view.tip ?? DEFAULT_TIP;
  const source = view.source === "wsl" ? "WSL" : "Windows";
  const lines: string[] = [];

  if (view.account) {
    const email = o.email === "full" ? view.account.email : o.email === "masked" ? maskEmail(view.account.email) : "";
    if (o.source && email) lines.push(t("plan.tipAccount", { source, email }));
    else if (o.source) lines.push(t("plan.tipSource", { source }));
    else if (email) lines.push(email);
  } else if (o.source) {
    lines.push(t("plan.tipNoAccount", { source }));
  }
  if (o.plan && view.account?.plan) lines.push(t("plan.tipPlan", { plan: planName(view.account.plan) }));

  const limit = (w: PlanWindow | undefined, shown: boolean, key: "five" | "week") => {
    if (!w || !shown) return;
    lines.push(t(o.reset ? `plan.${key}` : `plan.${key}NoReset`, { pct: Math.round(shownPct(w, nowMs)), at: resetClock(w.resetsAt, nowMs) }));
  };
  limit(view.plan.fiveHour, o.five, "five");
  limit(view.plan.sevenDay, o.week, "week");

  if (o.updated) lines.push(t("plan.tipUpdated", { ago: agoText(view.plan.updatedAt, nowMs) }));
  return lines;
}

/**
 * The limits to show. A chosen source shows only that one. "auto" follows the session
 * on screen (by its folder), and falls back to whichever was heard last.
 */
export function pickPlan(
  set: PlanSet,
  choice: string,
  focusCwd: string | null | undefined,
): { plan: PlanUsage; source: PlanSource } | null {
  if (choice === "windows" || choice === "wsl") {
    const plan = set[choice];
    return plan ? { plan, source: choice } : null;
  }
  const followed = sourceOf(focusCwd);
  if (followed && set[followed]) return { plan: set[followed]!, source: followed };
  const entries = (Object.entries(set) as [PlanSource, PlanUsage][]).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return entries.length > 0 ? { plan: entries[0][1], source: entries[0][0] } : null;
}

export function loadPlans(): PlanSet {
  const out: PlanSet = {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    for (const source of ["windows", "wsl"] as const) {
      const r = raw?.[source];
      if (!r || typeof r !== "object") continue;
      const fiveHour = window_({ used_percentage: r.fiveHour?.pct, resets_at: r.fiveHour?.resetsAt });
      const sevenDay = window_({ used_percentage: r.sevenDay?.pct, resets_at: r.sevenDay?.resetsAt });
      if (fiveHour || sevenDay) out[source] = { fiveHour, sevenDay, updatedAt: Number(r.updatedAt) || 0 };
    }
  } catch {
    // Unreadable: start empty.
  }
  return out;
}

export function savePlans(set: PlanSet) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(set));
  } catch {
    // Not stored: it shows again after the next answer.
  }
}

/**
 * Repaints every element marked `data-plan` once a second, so the "time left"
 * counts down and a window that has reset drops back to 0% without waiting for
 * Claude to answer.
 */
export function startPlanClock(get: () => PlanView | null) {
  window.setInterval(() => {
    const plan = get();
    for (const el of document.querySelectorAll<HTMLElement>("[data-plan]")) {
      const variant = el.dataset.plan === "header" ? "header" : el.dataset.plan === "card" ? "card" : "compact";
      // The card shows a hint of its own when there is nothing yet: do not wipe it.
      if (!plan && variant === "card") continue;
      paintPlan(el, plan, variant);
    }
  }, 1000);
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function span(cls: string, text: string, color?: string): HTMLElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  if (color) s.style.color = color;
  return s;
}

/** A thin bar showing how full a window is. */
function bar(pct: number, color: string): HTMLElement {
  const track = document.createElement("span");
  track.className = "plan-bar";
  const fill = document.createElement("i");
  fill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
  fill.style.background = color;
  track.append(fill);
  return track;
}

/**
 * Fills `el` with the plan numbers.
 *  - "compact": one short line for the closed island: `5h 23% → 15:40 · 7d 67%`
 *  - "header":  bars, percentages, time left and the reset clock, for the open one.
 * Returns false (and leaves it empty) when there is nothing to show.
 */
export function paintPlan(el: HTMLElement, view: PlanView | null, variant: "compact" | "header" | "card"): boolean {
  const plan = view?.plan;
  if (!view || !plan || (!plan.fiveHour && !plan.sevenDay)) {
    el.replaceChildren();
    delete el.dataset.sig;
    el.removeAttribute("title");
    return false;
  }
  const now = Date.now();

  const parts: ["five" | "week", PlanWindow][] = [];
  if (plan.fiveHour) parts.push(["five", plan.fiveHour]);
  if (plan.sevenDay) parts.push(["week", plan.sevenDay]);
  // The closed notch can be asked to show only one of them, or none.
  if (variant === "compact" && view.compact && view.compact !== "both") {
    const keep = parts.filter(([label]) => (view.compact === "five" ? label === "five" : view.compact === "week" ? label === "week" : false));
    parts.splice(0, parts.length, ...keep);
  }
  if (parts.length === 0) {
    el.replaceChildren();
    delete el.dataset.sig;
    el.removeAttribute("title");
    return false;
  }

  // The words after the percentage: time left and the reset clock (the closed island
  // only has room for the 5-hour clock).
  const leftText = (label: "five" | "week", w: PlanWindow): string =>
    variant !== "compact"
      ? `${timeLeft(w.resetsAt, now)} · ${resetClock(w.resetsAt, now)}`
      : label === "five"
        ? resetClock(w.resetsAt, now)
        : "";

  // Hover: what the settings say (which account, the plan, the limits…).
  const tip = planTip(view, now);

  // The same picture as a second ago: only the clocks move. Nothing is rebuilt, or a
  // tooltip waiting to appear would be lost to the DOM changing under the pointer.
  const sig = [variant, view.tag ?? "", view.source ?? "", ...parts.map(([l, w]) => `${l}:${Math.round(shownPct(w, now))}`)].join("|");
  if (el.dataset.sig === sig) {
    const clocks = el.querySelectorAll<HTMLElement>(".plan-left");
    let k = 0;
    for (const [label, w] of parts) {
      const text = leftText(label, w);
      if (!text) continue;
      const node = clocks[k++];
      if (node && node.textContent !== text) node.textContent = text;
    }
  } else {
    el.replaceChildren();
    el.dataset.sig = sig;
    if (view.tag) el.append(span("plan-src", view.tag));
    parts.forEach(([label, w], index) => {
      const pct = shownPct(w, now);
      const color = planColor(pct);
      const group = document.createElement("span");
      group.className = "plan-group";
      // The closed island has little room: the short names there.
      group.append(span("plan-label", t(variant === "compact" ? (label === "five" ? "plan.c5" : "plan.c7") : (label === "five" ? "plan.w5" : "plan.w7"))));
      if (variant !== "compact") group.append(bar(pct, color));
      group.append(span("plan-pct", `${Math.round(pct)}%`, color));
      const text = leftText(label, w);
      if (text) group.append(span("plan-left", text));
      el.append(group);
      if (index < parts.length - 1) el.append(span("plan-sep", variant === "compact" ? "·" : ""));
    });
  }

  const title = tip.join("\n");
  if (el.title !== title) el.title = title;
  if (!title) el.removeAttribute("title");
  return true;
}
