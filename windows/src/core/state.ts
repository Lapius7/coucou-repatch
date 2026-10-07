// App state — mirror of AppState.swift (the parts the island needs).

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../mochi/engine";
import type { AllowRule } from "./rules";
import { pickPlan, type AccountSet, type PlanSet, type PlanView } from "./plan";
import type { DiffRow, Hunk } from "./diff";

export type AgentSource = "claudeCode" | "agent";
export type PillBadge = "approval" | "finished" | "error";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
  sessionCwd?: string | null;
  /** When the current turn began (UserPromptSubmit); null between turns. */
  startedAt?: number | null;
  /** How long the last finished turn took. */
  lastDurationMs?: number | null;
  /** The kind of the last error (`rate_limit`…), as Claude Code named it. */
  lastErrorKind?: string | null;
  /** Why the last turn stopped with an error (StopFailure), as Claude Code said it. */
  lastError?: string | null;
  /** Last hook event seen, to sweep sessions that vanished without a SessionEnd. */
  lastEventAt?: number;
  /** What the current turn has done so far, for the summary when it ends. */
  turn?: { files: string[]; commands: number };
  /** "3 files edited · 5 commands", set when the turn ends. */
  summary?: string;
  /** Everything that happened, newest last: what you asked, what ran, what Claude said. */
  log?: LogEntry[];
  /** File edits, newest last. */
  edits?: EditRecord[];
  checklist?: ChecklistItem[];
  lastOutput?: CommandOutput | null;
}

/** One line of a session's history, for the scrollable log. */
export interface LogEntry {
  kind: "prompt" | "step" | "reply";
  text: string;
  at: number;
  /** A file edit: clicking the line opens its diff. */
  editId?: number;
}

/** One file edit, as the diff view shows it. */
export interface EditRecord {
  id: number;
  tool: string;
  file: string;
  hunks: Hunk[];
  at: number;
  rows: DiffRow[];
  add: number;
  del: number;
  /** Rows left out of `rows`. */
  more: number;
  /** Line numbers and surrounding code are in `rows` (the file could be read). */
  placed: boolean;
  /** A sensitive file: its text is not shown. */
  hidden?: boolean;
}

/** The steps of a turn, as the diff view's left column lists them. */
export interface ChecklistItem {
  label: string;
  state: "running" | "done";
}

/** What the last shell command printed. */
export interface CommandOutput {
  command: string;
  text: string;
  at: number;
}

/** Entries kept per task: enough for a long session, small enough to stay cheap. */

/** Claude Code is either the VS Code pill or one pill per running session. */
export const SESSION_PREFIX = "session_";
export const isClaudeTask = (t: { id: string } | null | undefined): boolean =>
  !!t && (t.id === "integration_claude" || t.id.startsWith(SESSION_PREFIX));

/** One colour per session, picked so that two sessions never look alike. */
export const SESSION_COLORS = ["#60A5FA", "#34D399", "#F472B6", "#FBBF24", "#A78BFA", "#FB923C"];

/** 83000 ms → "1:23". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One question of an AskUserQuestion tool call. */
export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: { label: string; description?: string }[];
}

export interface ApprovalInfo {
  requestId: string;
  sessionId: string;
  tool: string;
  command: string;
  /** The pill that raised it, so the answer lands on the right session. */
  taskId: string;
  /** Present for AskUserQuestion: the card shows the choices instead of Allow / Deny. */
  questions?: AskQuestion[];
  /** Why the card is flagged (a recursive delete, a force push…), or null. */
  danger?: string | null;
  /** What "Always" would remember for this request; null = no button. */
  rule?: AllowRule | null;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface ResultItem {
  label: string;
  detail: string;
  url?: string;
}

export interface SearchResult {
  title: string;
  items: ResultItem[];
  note?: string;
}

const task = (
  id: string, name: string, color: string, source: AgentSource,
): AgentTask => ({
  id, name, color, state: "idle", stepIndex: 0, steps: [], source, isIntegration: true,
});

/** AgentTask.integrationAgents — same ids, names and colours as macOS. */
export const INTEGRATION_AGENTS: AgentTask[] = [
  task("integration_claude", "VS Code", "#F5F6F8", "claudeCode"),
];

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  absenceInterval: number;
  screen: "primary" | "cursor";
  autostart: boolean;
  /** The small closed island stays on screen instead of hiding itself after a while. */
  alwaysShow: boolean;
  hooksInstalled: boolean;
  /** Claude model used by the chat. */
  model: string;
  /** Seconds before a finished card puts itself away; 0 = never. */
  doneAutoClose: number;
  /** How a finished turn, an approval or an error gets your attention. */
  notifyMode: "sound" | "toast" | "both" | "none";
  /** Global hotkeys, name → combo like "Ctrl+Alt+Y"; empty = off. */
  hotkeys: Record<string, string>;
  /** Show the 5-hour and weekly plan limits on the island. */
  showPlanUsage: boolean;
  /** Open the island for a few seconds on each file edit, showing the diff. */
  liveDiff: boolean;
  /** Whose plan limits to show: "auto" (the session on screen), "windows" or "wsl". */
  planSource: string;
  /** "auto" (follow Windows) or a language code from core/i18n.ts. */
  language: string;
  /** Lines of code around a change in the diff view. */
  diffContext: number;
  /** Entries kept in a session's history. */
  logLimit: number;
  /** Minutes between plan-limit probes (0 = never). */
  planProbeMinutes: number;
  /** What the closed notch shows of the plan limits. */
  compactPlan: "both" | "five" | "week" | "none";
  /** Wave hello at launch. */
  showGreeting: boolean;
  quietEnabled: boolean;
  quietFrom: string;
  quietTo: string;
  quietApprovals: boolean;
  /** Days a remembered "always allow" lasts (0 = for ever). */
  ruleDays: number;
  /** Island position, px from the centre (negative = left). */
  uiOffsetX: number;
  /** The closed island opens when the pointer rests on it. */
  hoverOpen: boolean;
  /** Tell when a plan limit passes 80 % and 90 %. */
  planWarn: boolean;
  /** Ask GitHub once a day for a newer version. */
  checkUpdates: boolean;
  /** How the closed island looks: the small notch, or a thin bar. */
  closedStyle: "notch" | "bar";
  /** How large the island is drawn (0.8 – 1.5). */
  uiScale: number;
  /** What the hover on the plan numbers shows. */
  tipEmail: "full" | "masked" | "hidden";
  tipSource: boolean;
  tipPlan: boolean;
  tipFive: boolean;
  tipWeek: boolean;
  tipReset: boolean;
  tipUpdated: boolean;
  /** The first-run setup was shown. */
  setupDone: boolean;
}

/** What each hotkey does, in the order the settings window lists them. */
export const HOTKEY_LABELS: [string, string][] = [
  ["toggle", "Open / close the island"],
  ["allow", "Allow a permission request"],
  ["deny", "Deny a permission request"],
  ["opt1", "Answer 1 on a question"],
  ["opt2", "Answer 2 on a question"],
  ["opt3", "Answer 3 on a question"],
  ["opt4", "Answer 4 on a question"],
  ["shot", "Ask Claude about the screen"],
];

export const DEFAULT_HOTKEYS: Record<string, string> = {
  toggle: "Ctrl+Alt+J",
  allow: "Ctrl+Alt+Y",
  deny: "Ctrl+Alt+N",
  opt1: "Ctrl+Alt+1",
  opt2: "Ctrl+Alt+2",
  opt3: "Ctrl+Alt+3",
  opt4: "Ctrl+Alt+4",
  shot: "Ctrl+Alt+S",
};

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  absenceInterval: 180,
  screen: "primary",
  autostart: false,
  alwaysShow: true,
  hooksInstalled: false,
  model: "claude-opus-5",
  doneAutoClose: 6,
  notifyMode: "sound",
  hotkeys: { ...DEFAULT_HOTKEYS },
  showPlanUsage: true,
  liveDiff: false,
  planSource: "auto",
  language: "auto",
  diffContext: 3,
  logLimit: 120,
  planProbeMinutes: 30,
  compactPlan: "both",
  showGreeting: true,
  quietEnabled: false,
  quietFrom: "23:00",
  quietTo: "07:00",
  quietApprovals: true,
  ruleDays: 0,
  uiOffsetX: 0,
  hoverOpen: false,
  planWarn: true,
  checkUpdates: false,
  closedStyle: "notch",
  uiScale: 1,
  tipEmail: "full",
  tipSource: true,
  tipPlan: true,
  tipFive: true,
  tipWeek: true,
  tipReset: true,
  tipUpdated: false,
  setupDone: false,
};

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;

  /** Cursor in logical screen pixels, origin top-left (like AppState.mousePosition). */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  /** The pin in the header: the island stays open until it is unpinned (or closed by hand). */
  userPinned = false;
  /** Open for a reason that keeps the auto-close away: a request waiting, or the pin. */
  get keepOpen(): boolean {
    return this.isPinned || this.userPinned;
  }
  /** The history is pulled larger. Only until the island is closed. */
  enlarged = false;
  /** The edit the diff view shows; null = the latest of the session on screen. */
  selectedEdit: { taskId: string; id: number } | null = null;
  /** The view the diff was opened from, so "back" returns there (history, overview…). */
  diffFrom: IslandViewName | null = null;
  /** Coming back to the history from a diff: keep it as it was (scroll position, following). */
  keepLogScroll = false;
  nextEditId = 1;
  /** The Claude plan limits last reported by Claude Code, kept apart per install. */
  plans: PlanSet = {};
  /** Which account each install is signed in to. */
  accounts: AccountSet = {};

  /** The plan limits to draw now, or null. */
  planView(): PlanView | null {
    if (!this.settings.showPlanUsage) return null;
    const hit = pickPlan(this.plans, this.settings.planSource, this.focusTask?.sessionCwd);
    if (!hit) return null;
    // Two installs report: say whose these are, or the numbers would look like they jump.
    const both = !!(this.plans.windows && this.plans.wsl);
    return {
      plan: hit.plan,
      tag: both ? (hit.source === "wsl" ? "WSL" : "Win") : undefined,
      source: hit.source,
      account: this.accounts[hit.source],
      compact: this.settings.compactPlan,
      tip: {
        email: this.settings.tipEmail,
        source: this.settings.tipSource,
        plan: this.settings.tipPlan,
        five: this.settings.tipFive,
        week: this.settings.tipWeek,
        reset: this.settings.tipReset,
        updated: this.settings.tipUpdated,
      },
    };
  }
  paused = false;
  /** A full-screen game or video is in front: the island stays out of the way. */
  suppressed = false;

  /** Extra height of the finished card, for a long first line. */
  finishedExtra = 0;
  /** Extra height of the chat for the preview of a dropped picture. */
  promptExtra = 0;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  /** The files that came with the question (dropped, or a picture of the screen). */
  droppedFiles: { name: string; path: string }[] = [];
  /** Sessions that finished a moment ago (newest last), so a card can point at the others. */
  recentDone: { id: string; at: number }[] = [];
  /** The first of them (several files can be dropped at once). */
  get droppedFile(): { name: string; path: string } | null {
    return this.droppedFiles[0] ?? null;
  }
  set droppedFile(file: { name: string; path: string } | null) {
    this.droppedFiles = file ? [file] : [];
  }
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  pendingApproval: ApprovalInfo | null = null;


  lastActivity = performance.now();

  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  /**
   * The pills of the overview, in a fixed order: picking one only highlights it,
   * nothing moves. If the focused task is past the fourth slot it takes the last
   * one, so it is never missing from the list.
   */
  get pillTasks(): AgentTask[] {
    // The VS Code pill is only a placeholder for "no session yet": not worth a slot.
    const shown = this.tasks.filter((t) => t.id !== "integration_claude").slice(0, 4);
    const focus = this.focusTask;
    if (focus && focus.id !== "integration_claude" && !shown.includes(focus) && shown.length > 0) {
      shown[shown.length - 1] = focus;
    }
    return shown;
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    t.pillBadge = null;
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.steps.push(step.replace(/\s+/g, " ").trim());
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    this.notify();
  }

  /** Keeps a file edit for the diff view (the last 20 per task). */
  addEdit(id: string, edit: EditRecord) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    (t.edits ??= []).push(edit);
    if (t.edits.length > 20) t.edits.splice(0, t.edits.length - 20);
    this.notify();
  }

  appendLog(id: string, kind: LogEntry["kind"], text: string, editId?: number) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t || !text) return;
    (t.log ??= []).push({ kind, text, at: Date.now(), editId });
    const limit = Math.max(20, this.settings.logLimit || 120);
    if (t.log.length > limit) t.log.splice(0, t.log.length - limit);
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  /** The "no session yet" placeholder is always there, first. */
  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      if (!this.tasks.some((t) => t.id === proto.id)) this.tasks.push({ ...proto, steps: [] });
    }
    this.tasks.sort((a, b) => (a.id === "integration_claude" ? -1 : b.id === "integration_claude" ? 1 : 0));
    if (!this.focusId) this.focusId = "integration_claude";
    this.notify();
  }

  removeTask(id: string) {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.tasks.splice(idx, 1);
    if (this.focusId === id) this.focusId = this.tasks[0]?.id ?? "integration_claude";
    this.notify();
  }

  /** Creates a dynamic agent_ pill on first event; no-ops if it already exists.
   *  Inserted right after integration_claude so it appears in the visible slice(0,4). */
  upsertExternalAgent(id: string, name: string, color: string) {
    if (this.tasks.some((t) => t.id === id)) return;
    const at = this.tasks.findIndex((t) => t.id === "integration_claude") + 1;
    this.tasks.splice(at, 0, {
      id, name, color,
      state: "idle", stepIndex: 0, steps: [],
      source: "agent", isIntegration: false,
    });
    if (!this.focusId) this.focusId = id;
    this.notify();
  }

  /** One pill per Claude Code session, named after its folder, in its own colour. */
  upsertSession(id: string, name: string, cwd: string) {
    const existing = this.tasks.find((t) => t.id === id);
    if (existing) {
      existing.name = name;
      if (cwd) existing.sessionCwd = cwd;
      return;
    }
    const used = new Set(this.tasks.filter((t) => t.id.startsWith(SESSION_PREFIX)).map((t) => t.color));
    const color = SESSION_COLORS.find((c) => !used.has(c)) ?? SESSION_COLORS[this.tasks.length % SESSION_COLORS.length];
    const at = this.tasks.findIndex((t) => t.id === "integration_claude") + 1;
    this.tasks.splice(at, 0, {
      id, name, color,
      state: "idle", stepIndex: 0, steps: [],
      source: "claudeCode", isIntegration: false,
      sessionCwd: cwd || null,
    });
    // The VS Code pill is only a placeholder once a real session exists.
    if (this.focusId === "integration_claude") this.focusId = id;
    this.notify();
  }

  defaultView(): IslandViewName {
    return this.tasks.length === 0 ? "empty" : "overview";
  }
}

export const State = new AppState();
