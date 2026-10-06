// Claude Code hook events → island state.
// Port of HookServer.processEvent / processPermissionRequest from the macOS app.
// Difference from macOS: no terminal filter. On Windows the hook fires from any
// terminal (Windows Terminal, VS Code, PowerShell…) and all of them are handled.

import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, SESSION_PREFIX, formatDuration, type AskQuestion } from "../core/state";
import { dangerOf, matchRule, ruleFor } from "../core/rules";
import { recordTurn } from "../core/usage";
import { buildRows, type Hunk } from "../core/diff";
import { t as tr } from "../core/i18n";
import { firstLine } from "../views/markdown";
import type { Island } from "./island";

const CLAUDE_ID = "integration_claude";

/** Clears the approval card if no decision was made before the hook gave up. */
let pendingTimeout: number | null = null;

interface HookPayload {
  hook_event_name?: string;
  request_id?: string;
  session_id?: string;
  cwd?: string;
  message?: string;
  /** StopFailure: what went wrong (`rate_limit`, `authentication_failed`…) and the details. */
  error?: string;
  error_details?: string;
  /** Stop / SubagentStop: the text of Claude's final message of the turn. */
  last_assistant_message?: string;
  /** Only a shell command's (the relay drops every other tool's). */
  tool_response?: unknown;
  /** UserPromptSubmit carries `prompt`; `message` belongs to Notification/Stop. */
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /** Optional agent tag: lowercase, digits and hyphens, ≤ 24 chars. */
  coucou_agent?: string;
}

/** Same rule as HookServer.validateAgent on macOS. "claude" is reserved. */
function validateAgent(raw: string | undefined): string | null {
  if (!raw || raw.length > 24 || raw === "claude") return null;
  if (!/^[a-z0-9-]+$/.test(raw)) return null;
  return raw;
}

const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

function agentColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

const PROJECT_ALIASES: Record<string, string> = {
  "notch-buddy": "Notch Buddy",
  notchbuddy: "Notch Buddy",
  notch_buddy: "Notch Buddy",
};

function aliasProjectName(name: string): string {
  return PROJECT_ALIASES[name.toLowerCase()] ?? name;
}

function lastPathComponent(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** frenchStep() — same labels as the macOS app. */
/** The verb shown before what a tool touched, in the interface language. */
function toolLabel(tool: string): string {
  const key = `tool.${tool}`;
  const text = tr(key);
  return text === key ? tool : text;
}

/** Tools whose command text is not shown as a ticker step. */
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
/** Tools that change a file: counted for the summary when the turn ends. */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function editedFile(input: Record<string, unknown>): string {
  for (const key of ["file_path", "path", "notebook_path"]) {
    if (typeof input[key] === "string") return input[key] as string;
  }
  return "";
}

function stepLabel(tool: string, input: Record<string, unknown>): string {
  const label = toolLabel(tool);
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const cmd = str("command");
  if (cmd) return `${label} · ${cmd.slice(0, 40)}`;
  const path = str("path");
  if (path) return `${label} · ${lastPathComponent(path)}`;
  const file = str("file_path");
  if (file) return `${label} · ${lastPathComponent(file)}`;
  const query = str("query");
  if (query) return `${label} · ${query.slice(0, 40)}`;
  return label;
}

/**
 * What the Allow button actually authorises. Approving "Write" tells you nothing
 * — approving `Write · C:\…\.env` tells you everything, and the difference is
 * the whole point of approving from the island rather than blind.
 *
 * Ordered by how specific the field is, so an unfamiliar tool still shows
 * whatever identifying string it carries instead of falling back to its name.
 */
const APPROVAL_FIELDS = [
  "command", // Bash, PowerShell
  "file_path", // Write, Edit, MultiEdit, NotebookEdit
  "path", // Read, LS
  "url", // WebFetch
  "query", // WebSearch
  "pattern", // Glob, Grep
  "prompt", // Task
] as const;

function approvalTarget(tool: string, input: Record<string, unknown>): string {
  for (const field of APPROVAL_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) {
      return `${tool} · ${value.trim()}`;
    }
  }
  return tool;
}

function upsert(projectName: string, cwd: string) {
  const t = State.tasks.find((x) => x.id === CLAUDE_ID);
  if (!t) return;
  t.name = projectName;
  if (cwd) t.sessionCwd = cwd;
}

function clearSession() {
  const t = State.tasks.find((x) => x.id === CLAUDE_ID);
  if (!t) return;
  t.steps = [];
  t.stepIndex = 0;
  t.name = "VS Code";
  t.pillBadge = null;
}

/** Folder name, with a tag when the session runs inside WSL (a Linux path). */
function sessionLabel(cwd: string): string {
  const base = aliasProjectName(lastPathComponent(cwd) || "Session");
  return cwd.startsWith("/") ? `${base} · WSL` : base;
}

/** Sessions that ended without a SessionEnd (terminal killed) are swept after this. */
const STALE_SESSION_MS = 30 * 60 * 1000;

export function registerHookHandlers(island: Island) {
  void onEvent<HookPayload>("hook", (payload) => handleHook(island, payload));
  // `npm run dev` in a plain browser has no Rust behind it: this lets the
  // console play hook events, e.g. `__hook({hook_event_name: "Stop", session_id: "a"})`.
  if (!IS_TAURI) (window as unknown as { __hook: (p: HookPayload) => void }).__hook = (p) => handleHook(island, p);
  window.setInterval(() => {
    const now = Date.now();
    for (const t of [...State.tasks]) {
      if (!t.id.startsWith(SESSION_PREFIX)) continue;
      if (t.state === "idle" && now - (t.lastEventAt ?? now) > STALE_SESSION_MS) State.removeTask(t.id);
    }
  }, 60_000);
}

/** A finished card puts itself away, unless you are looking at it. */
function scheduleDoneClose(island: Island, taskId: string) {
  scheduleViewClose(island, taskId, "finished", State.settings.doneAutoClose);
}

/** When the last live diff was opened: a newer one has its own timer, so an older one stands down. */
let liveDiffAt = 0;

function scheduleViewClose(island: Island, taskId: string, view: "finished" | "diff", sec: number, tries = 0) {
  if (!(sec > 0)) return;
  window.setTimeout(() => {
    if (State.mode !== "expanded" || State.view !== view || State.focusId !== taskId) return;
    if (State.keepOpen) return;
    if (view === "diff" && Date.now() - liveDiffAt < sec * 1000 - 300) return;
    // Hovering means reading: wait, but not forever.
    if (island.isPointerInside() && tries < 8) {
      scheduleViewClose(island, taskId, view, sec, tries + 1);
      return;
    }
    island.collapse();
  }, (tries === 0 ? sec : 2) * 1000);
}

/** Edit / MultiEdit / Write / NotebookEdit → the replacements it made. */
function hunksOf(tool: string, input: Record<string, unknown>): Hunk[] {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits
      .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : {}))
      .map((e) => ({ old: text(e.old_string), new: text(e.new_string) }))
      .filter((h) => h.old !== h.new);
  }
  if (tool === "Write") return [{ old: "", new: text(input.content) }];
  if (tool === "NotebookEdit") return [{ old: "", new: text(input.new_source) }];
  return [{ old: text(input.old_string), new: text(input.new_string) }].filter((h) => h.old !== h.new);
}

/** A file edit finished: keep it for the diff view, and show it if live diff is on. */
function recordEdit(island: Island, agentId: string, focused: boolean, tool: string, input: Record<string, unknown>) {
  const file = editedFile(input);
  const hunks = hunksOf(tool, input);
  if (!file || hunks.length === 0) return;

  // A sensitive file's text never reaches the screen, nor is the file read.
  const hidden = dangerOf(tool, input) !== null;
  const first = buildRows(hunks, null);
  const rec = {
    id: State.nextEditId++,
    tool,
    file,
    hunks: hidden ? [] : hunks,
    at: Date.now(),
    rows: hidden ? [{ kind: "gap" as const, text: tr("diff.hidden") }] : first.rows,
    add: first.add,
    del: first.del,
    more: hidden ? 0 : first.more,
    placed: false,
    hidden,
  };
  State.addEdit(agentId, rec);
  State.appendLog(agentId, "step", `${toolLabel(tool)} · ${lastPathComponent(file)}  +${first.add} −${first.del}`, rec.id);

  // Line numbers and the code around the change come from the file itself, read now.
  if (!hidden) {
    void Bridge.readTextFile(file).then((text) => {
      if (!text) return;
      const full = buildRows(hunks, text);
      Object.assign(rec, { rows: full.rows, more: full.more, placed: full.placed });
      State.notify();
    });
  }

  if (
    State.settings.liveDiff && focused && !State.isPinned && !State.pendingApproval &&
    State.view !== "approval" && State.view !== "ask"
  ) {
    State.selectedEdit = { taskId: agentId, id: rec.id };
    liveDiffAt = Date.now();
    island.alert("diff");
    scheduleViewClose(island, agentId, "diff", 8);
  }
}

/** A shell command finished: keep the end of what it printed (the `npm test` result). */
function recordOutput(agentId: string, input: Record<string, unknown>, response: unknown) {
  const t = State.tasks.find((x) => x.id === agentId);
  if (!t) return;
  const r = (response && typeof response === "object" ? response : {}) as Record<string, unknown>;
  const text = [r.stdout, r.stderr]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join("\n")
    .trim();
  const command = typeof input.command === "string" ? input.command.trim() : "";
  t.lastOutput = { command: command.slice(0, 160), text: text.split("\n").slice(-200).join("\n").slice(-12000), at: Date.now() };
  State.notify();
}

/** The one place that decides how an event gets your attention. */
function cue(kind: "finish" | "approval" | "error", title: string, body: string) {
  const mode = State.settings.notifyMode;
  if (mode === "sound" || mode === "both") Sound.play(kind);
  if (mode === "toast" || mode === "both") void Bridge.notify(title, body);
}

/** AskUserQuestion's tool_input, if it is shaped the way we can answer. */
function parseQuestions(input: Record<string, unknown>): AskQuestion[] | null {
  const raw = input.questions;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) return null;
  const out: AskQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") return null;
    const r = q as Record<string, unknown>;
    if (typeof r.question !== "string" || !Array.isArray(r.options)) return null;
    const options = r.options
      .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>) : null))
      .filter((o): o is Record<string, unknown> => !!o && typeof o.label === "string")
      .map((o) => ({
        label: o.label as string,
        description: typeof o.description === "string" ? o.description : undefined,
      }));
    if (options.length < 2 || options.length > 4) return null;
    out.push({
      question: r.question,
      header: typeof r.header === "string" ? r.header : undefined,
      multiSelect: r.multiSelect === true,
      options,
    });
  }
  return out;
}

function handleHook(island: Island, payload: HookPayload) {
  if (State.paused || State.suppressed) {
    // Silence here used to cost Claude Code nearly two minutes: the relay waited
    // for a decision from an island that had already decided not to look. Say so,
    // and the terminal takes the question immediately.
    if (payload.request_id) void Bridge.approvalDecline(payload.request_id);
    return;
  }

  const name = payload.hook_event_name ?? "";
  const cwd = payload.cwd ?? "";
  const raw = lastPathComponent(cwd);
  const projectName = aliasProjectName(raw || "Session");

  // Route to the right pill. Valid coucou_agent → dynamic "agent_<name>" pill.
  // "claude" is reserved; absent or invalid → Claude Code pill unchanged.
  // Claude Code itself gets one pill per session, so parallel sessions stay apart.
  const validAgent = validateAgent(payload.coucou_agent);
  const isExternalAgent = validAgent !== null;
  const sessionId = payload.session_id ?? "";
  const agentId = validAgent
    ? `agent_${validAgent}`
    : sessionId
      ? `${SESSION_PREFIX}${sessionId.slice(0, 8)}`
      : CLAUDE_ID;
  const isSession = agentId.startsWith(SESSION_PREFIX);

  let focused = State.focusId === agentId;

  /** Alerts force the island open; work events only reveal the compact island. */
  const surface = (view: Parameters<Island["alert"]>[0], isAlert: boolean) => {
    if (State.mode === "expanded") {
      if (isAlert) island.setView(view);
    } else if (isAlert) {
      island.alert(view);
    } else if (State.mode === "hidden") {
      island.reveal();
    }
  };

  /** Ensure the agent pill exists. */
  const ensurePill = () => {
    if (isExternalAgent) {
      State.upsertExternalAgent(agentId, validAgent!, agentColor(validAgent!));
    } else if (isSession) {
      State.upsertSession(agentId, sessionLabel(cwd), cwd);
    } else {
      upsert(projectName, cwd);
    }
  };
  const self = () => State.tasks.find((t) => t.id === agentId);
  if (name !== "SessionEnd") {
    ensurePill();
    const t = self();
    if (t) t.lastEventAt = Date.now();
    focused = State.focusId === agentId;
  }

  switch (name) {
    case "SessionStart":
      ensurePill();
      surface("overview", false);
      Sound.play("work");
      break;

    case "UserPromptSubmit": {
      ensurePill();
      State.updateTask(agentId, "thinking");
      {
        const t = self();
        if (t) {
          t.startedAt = Date.now();
          t.lastDurationMs = null;
          t.turn = { files: [], commands: 0 };
          t.summary = "";
          t.checklist = [];
          t.lastOutput = null;
        }
      }
      // The field is `prompt`; reading `message` meant this step was always blank.
      const asked = payload.prompt ?? payload.message;
      if (asked) {
        State.appendStep(agentId, asked.slice(0, 60));
        State.appendLog(agentId, "prompt", asked.slice(0, 8000));
      }
      surface("overview", false);
      break;
    }

    case "PreToolUse": {
      ensurePill();
      State.updateTask(agentId, "working");
      {
        const t = self();
        if (t && !t.startedAt) t.startedAt = Date.now();
      }
      const tool = payload.tool_name ?? "Tool";
      {
        // The steps of the turn, for the diff view's left column.
        const t = self();
        if (t) t.checklist = [...(t.checklist ?? []), { label: toolLabel(tool), state: "running" as const }].slice(-5);
      }
      {
        const t = self();
        if (t) {
          t.turn ??= { files: [], commands: 0 };
          if (SHELL_TOOLS.has(tool)) {
            t.turn.commands += 1;
          } else if (EDIT_TOOLS.has(tool)) {
            const file = editedFile(payload.tool_input ?? {});
            if (file && !t.turn.files.includes(file)) t.turn.files.push(file);
          }
        }
      }
      // Shell commands stay off the ticker: their first 40 characters are usually
      // `cd <project> && …`, which says nothing. The opening message stays up.
      if (!SHELL_TOOLS.has(tool)) {
        State.appendStep(agentId, stepLabel(tool, payload.tool_input ?? {}));
      }
      // The log keeps what the ticker leaves out: the commands, in full.
      {
        const input = payload.tool_input ?? {};
        const command = typeof input.command === "string" ? input.command.trim() : "";
        if (!EDIT_TOOLS.has(tool)) {
          State.appendLog(agentId, "step", SHELL_TOOLS.has(tool) ? `$ ${command.slice(0, 200)}` : stepLabel(tool, input));
        }
      }
      surface("overview", false);
      break;
    }

    case "PostToolUse": {
      State.updateTask(agentId, "working");
      const tool = payload.tool_name ?? "";
      const t = self();
      if (t?.checklist) {
        for (let i = t.checklist.length - 1; i >= 0; i--) {
          if (t.checklist[i].state === "running") {
            t.checklist[i].state = "done";
            break;
          }
        }
      }
      if (EDIT_TOOLS.has(tool)) recordEdit(island, agentId, focused, tool, payload.tool_input ?? {});
      else if (SHELL_TOOLS.has(tool)) recordOutput(agentId, payload.tool_input ?? {}, payload.tool_response);
      break;
    }

    case "PostToolUseFailure":
      State.updateTask(agentId, "working");
      State.appendStep(agentId, tr("step.failed"));
      State.appendLog(agentId, "step", tr("step.failed"));
      break;

    case "Notification": {
      const message = payload.message ?? "";
      const lower = message.toLowerCase();
      if (lower.includes("rate limit") || lower.includes("limite d")) {
        State.updateTask(agentId, "ratelimit");
        Sound.play("rate");
      } else if (message.endsWith("?")) {
        State.updateTask(agentId, "question");
        State.appendStep(agentId, message);
      }
      break;
    }

    case "Stop":
      State.updateTask(agentId, "finished");
      {
        const t = self();
        if (t) {
          t.lastDurationMs = t.startedAt ? Date.now() - t.startedAt : null;
          t.startedAt = null;
          const files = t.turn?.files.length ?? 0;
          const commands = t.turn?.commands ?? 0;
          t.summary = [
            files ? tr("n.files", { n: files }) : "",
            commands ? tr("n.cmds", { n: commands }) : "",
          ]
            .filter(Boolean)
            .join(" · ");
          if (t.lastDurationMs) recordTurn(t.lastDurationMs, files, commands);
          t.checklist = [...(t.checklist ?? []), { label: tr("diff.done"), state: "done" as const }].slice(-5);
          t.turn = undefined;
        }
      }
      {
        const said = (payload.last_assistant_message ?? payload.message ?? "").trim();
        const first = firstLine(said);
        if (first) State.appendStep(agentId, first.replace(/\s+/g, " ").trim().slice(0, 80));
        // The whole message goes to the log, so it can be read and scrolled.
        State.appendLog(agentId, "reply", said.slice(0, 40_000));
      }
      {
        const t = self();
        const took = t?.lastDurationMs ? ` (${formatDuration(t.lastDurationMs)})` : "";
        cue(
          "finish",
          tr("cue.finished", { name: t?.name ?? "Claude Code", took }),
          [t?.steps.at(-1), t?.summary].filter(Boolean).join(" — "),
        );
      }
      if (focused) {
        surface("finished", true);
        scheduleDoneClose(island, agentId);
      } else {
        State.setPillBadge(agentId, "finished");
      }
      window.setTimeout(() => {
        if (isExternalAgent) {
          State.removeTask(agentId);
        } else {
          State.updateTask(agentId, "idle");
          State.setPillBadge(agentId, null);
        }
      }, 5200);
      break;

    case "StopFailure": {
      const kind = payload.error ?? "";
      const known = kind ? tr(`err.type.${kind}`) : "";
      const t = State.tasks.find((x) => x.id === agentId);
      if (t) {
        // The reason Claude Code gave, not the last thing the session did.
        t.lastError = [known && known !== `err.type.${kind}` ? known : kind, payload.error_details ?? payload.message ?? ""]
          .map((x) => String(x).replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join(" — ") || null;
      }
      State.updateTask(agentId, "error");
      cue("error", tr("cue.error", { name: self()?.name ?? "Claude Code" }), payload.message ?? "");
      if (focused) surface("error", true);
      else State.setPillBadge(agentId, "error");
      break;
    }

    case "SessionEnd":
      if (isExternalAgent || isSession) {
        State.removeTask(agentId);
      } else {
        State.updateTask(agentId, "idle");
        clearSession();
      }
      break;

    case "SubagentStart":
      State.appendStep(agentId, "+ subagent");
      break;

    case "SubagentStop":
      // No step: it fires right after Stop and would replace Claude's message.
      break;

    case "PermissionRequest": {
      // External agents do not get an approval card — showing one would look like
      // a Claude Code request. Decline immediately so the agent re-asks in its
      // terminal. Approval support for other agents will come with Codex support.
      if (isExternalAgent) {
        if (payload.request_id) void Bridge.approvalDecline(payload.request_id);
        break;
      }

      const requestId = payload.request_id ?? "";
      // A permission you said "Always" to: allowed without a card. AskUserQuestion is
      // never auto-answered, and dangerous requests never match a rule.
      if (requestId && payload.tool_name !== "AskUserQuestion") {
        const saved = matchRule(payload.tool_name ?? "", payload.tool_input ?? {});
        if (saved) {
          void Bridge.approvalDecision(requestId, "allow");
          State.appendStep(agentId, tr("step.allowed", { label: saved.label }));
          break;
        }
      }
      // One card, one request. A second one must never quietly replace the first
      // — that would leave a human staring at request B while request A waits for
      // a decision nobody can give. Hand it straight back to the terminal.
      if (State.pendingApproval && State.pendingApproval.requestId !== requestId) {
        if (requestId) void Bridge.approvalDecline(requestId);
        break;
      }
      if (pendingTimeout != null) window.clearTimeout(pendingTimeout);
      const tool = payload.tool_name ?? "Tool";
      const input = payload.tool_input ?? {};
      // AskUserQuestion is answered from the island: the choices, not Allow / Deny.
      const questions = tool === "AskUserQuestion" ? parseQuestions(input) : null;
      State.pendingApproval = {
        requestId,
        sessionId: payload.session_id ?? "",
        tool,
        command: approvalTarget(tool, input),
        taskId: agentId,
        questions: questions ?? undefined,
        danger: dangerOf(tool, input),
        rule: questions ? null : ruleFor(tool, input),
      };
      // A request takes the view whichever session it comes from.
      State.focusId = agentId;
      focused = true;
      // The relay's short ack window closes in 800 ms; everything below this
      // line is synchronous, so the card really is up by the time it lands.
      if (requestId) void Bridge.approvalAck(requestId);
      State.updateTask(agentId, "approval");
      State.isPinned = true;
      cue(
        "approval",
        tr(questions ? "cue.asks" : "cue.needs", { name: self()?.name ?? "Claude Code" }),
        questions ? questions[0].question : approvalTarget(tool, input),
      );
      if (focused) {
        island.alert(questions ? "ask" : "approval");
      } else {
        // Another agent holds the view, so the card would yank it away. The badge
        // is the signal instead — but it has to be on screen for that to mean
        // anything, hence the reveal. We just told the relay a human can act.
        State.setPillBadge(agentId, "approval");
        island.reveal();
      }
      // Coucou answers within 108 s or not at all; after that the terminal has
      // taken over and the card would be lying.
      pendingTimeout = window.setTimeout(() => {
        pendingTimeout = null;
        if (!State.pendingApproval) return;
        State.pendingApproval = null;
        State.isPinned = false;
        island.dropPin();
        State.updateTask(agentId, "working");
        State.setPillBadge(agentId, null);
        if (State.view === "approval" || State.view === "ask") island.setView(State.defaultView());
        State.notify();
      }, 110_000);
      break;
    }

    default:
      break;
  }
  State.notify();
}
