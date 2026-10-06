// "Always allow": remembered permission rules, and the check that keeps them from
// ever covering something dangerous.
//
// Rules live in localStorage, which the island window and the settings window
// share. Matching is deliberately narrow:
//  - a shell command is matched by its first words (`npm run`), and only when it
//    has no chaining, pipes, redirects or substitution that could hide a second
//    command behind the allowed one;
//  - file edits are matched by folder;
//  - anything dangerous never gets a rule and never matches one.

import { t } from "./i18n";

const STORAGE_KEY = "coucou.allowRules";

export interface AllowRule {
  tool: string;
  /** Command prefix, or a folder for file tools, or "" for the whole tool. */
  scope: string;
  /** What the settings window and the card show. */
  label: string;
}

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** Read-only tools: one rule covers the whole tool. */
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS"]);

/** Anything that could start a second command behind the first. */
const CHAINING = /[;&|`<>\n\r]|\$\(/;

/** [pattern, what the card says]. Checked against shell commands. */
const DANGEROUS_COMMANDS: [RegExp, string][] = [
  [/\brm\s+(-\w*[rR]\w*[fF]|-\w*[fF]\w*[rR]|--recursive|--force)/, "danger.recursive"],
  [/\b(Remove-Item|rmdir|rd|del|erase)\b[^\n]*(-Recurse|\/s\b|-Force)/i, "danger.recursive"],
  [/\bsudo\b/, "danger.root"],
  [/\bgit\s+push\b[^\n]*(--force|-f\b|--delete)/, "danger.force"],
  [/\bgit\s+(reset\s+--hard|clean\s+-\w*f|checkout\s+--\s|restore\s)/, "danger.discard"],
  [/(curl|wget|iwr|Invoke-WebRequest|irm)\b[^\n|]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh)\b/i, "danger.download"],
  [/\b(iex|Invoke-Expression)\b/i, "danger.generated"],
  [/\bformat\s+[a-z]:|\b(diskpart|mkfs|fdisk)\b|\bdd\s+if=/i, "danger.disk"],
  [/\b(chmod|chown)\s+-R\b/, "danger.chmod"],
  [/\breg(\.exe)?\s+(delete|add|import)\b/i, "danger.registry"],
  [/\b(Set-ExecutionPolicy|bcdedit|netsh\s+advfirewall|schtasks\s+\/create)\b/i, "danger.system"],
  [/\b(shutdown|Restart-Computer|Stop-Computer)\b/i, "danger.shutdown"],
  [/\bnpm\s+(publish|unpublish)\b|\bgit\s+push\b[^\n]*\s(origin\s+)?:\w/, "danger.publish"],
];

/** Paths that are never edited casually. */
const SENSITIVE_PATH = /(^|[\\/])(\.env(\.[\w.-]+)?|\.ssh|id_rsa[\w.-]*|\.aws|\.npmrc|\.netrc|credentials[\w.-]*|\.claude[\\/]settings[\w.-]*)([\\/]|$)/i;

const str = (input: Record<string, unknown>, key: string): string =>
  typeof input[key] === "string" ? (input[key] as string) : "";

/** Why this request deserves a second look, or null. */
export function dangerOf(tool: string, input: Record<string, unknown>): string | null {
  if (SHELL_TOOLS.has(tool)) {
    const cmd = str(input, "command");
    for (const [pattern, why] of DANGEROUS_COMMANDS) if (pattern.test(cmd)) return t(why);
    return null;
  }
  if (FILE_TOOLS.has(tool) || READ_TOOLS.has(tool)) {
    const path = pathOf(input);
    if (SENSITIVE_PATH.test(path)) return t("danger.sensitive");
  }
  return null;
}

/**
 * A path in one shape (forward slashes), or null when it cannot be trusted to mean
 * what it says: relative paths, and anything that climbs with "..", would let
 * `C:/proj/../Windows/x` slip under a rule for `C:/proj/`.
 * (Symbolic links and junctions cannot be seen from here: a rule for a folder
 * covers whatever a link inside it points to. Keep rules to folders you own.)
 */
function cleanPath(raw: string): string | null {
  if (!raw || raw.includes("\0")) return null;
  const p = raw.replace(/\\/g, "/");
  const absolute = /^[a-zA-Z]:\//.test(p) || p.startsWith("/");
  if (!absolute) return null;
  if (p.split("/").some((part) => part === "..")) return null;
  return p;
}

/** Windows paths ignore case, Linux ones (WSL) do not. */
const fold = (p: string) => (/^[a-zA-Z]:\//.test(p) ? p.toLowerCase() : p);

function folderOf(raw: string): string {
  const p = cleanPath(raw);
  if (!p) return "";
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i + 1) : "";
}

/** Which of the tool's path fields holds the file. */
const pathOf = (input: Record<string, unknown>) =>
  str(input, "file_path") || str(input, "path") || str(input, "notebook_path");

/** The rule "Always" would save for this request, or null when none is safe. */
export function ruleFor(tool: string, input: Record<string, unknown>): AllowRule | null {
  if (dangerOf(tool, input)) return null;

  if (SHELL_TOOLS.has(tool)) {
    const cmd = str(input, "command").trim();
    if (!cmd || CHAINING.test(cmd)) return null;
    const words = cmd.split(/\s+/);
    // `npm run`, `git status`: the command and its subcommand, not its arguments.
    const scope = words.length > 1 && !words[1].startsWith("-") ? `${words[0]} ${words[1]}` : words[0];
    return { tool, scope, label: `${tool}: ${scope} …` };
  }
  if (FILE_TOOLS.has(tool)) {
    const folder = folderOf(pathOf(input));
    return folder ? { tool, scope: folder, label: t("rule.inFolder", { tool, folder }) } : null;
  }
  if (READ_TOOLS.has(tool)) return { tool, scope: "", label: t("rule.anyFile", { tool }) };
  return null;
}

export function loadRules(): AllowRule[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((r) => r && typeof r.tool === "string" && typeof r.scope === "string" && typeof r.label === "string")
      : [];
  } catch {
    return [];
  }
}

function saveRules(rules: AllowRule[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Private mode or a full disk: the rule just does not stick.
  }
}

export function addRule(rule: AllowRule) {
  const rules = loadRules();
  if (!rules.some((r) => r.tool === rule.tool && r.scope === rule.scope)) saveRules([...rules, rule]);
}

export function removeRule(rule: AllowRule) {
  saveRules(loadRules().filter((r) => !(r.tool === rule.tool && r.scope === rule.scope)));
}

/** The saved rule that covers this request, or null: then the card is shown. */
export function matchRule(tool: string, input: Record<string, unknown>): AllowRule | null {
  if (dangerOf(tool, input)) return null;
  const rules = loadRules().filter((r) => r.tool === tool);
  if (rules.length === 0) return null;

  if (SHELL_TOOLS.has(tool)) {
    const cmd = str(input, "command").trim();
    if (!cmd || CHAINING.test(cmd)) return null;
    return rules.find((r) => cmd === r.scope || cmd.startsWith(`${r.scope} `)) ?? null;
  }
  if (FILE_TOOLS.has(tool)) {
    const path = cleanPath(pathOf(input));
    if (!path) return null;
    return rules.find((r) => r.scope !== "" && fold(path).startsWith(fold(r.scope))) ?? null;
  }
  if (READ_TOOLS.has(tool)) return rules.find((r) => r.scope === "") ?? null;
  return null;
}
