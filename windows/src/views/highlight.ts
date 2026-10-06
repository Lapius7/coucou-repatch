// A small syntax colouring for the diff view: comments, strings, numbers, keywords.
// One line at a time and by regular expression, so it is only an approximation
// (a string that runs over several lines is not followed), but it reads like code.
// It builds DOM nodes and sets text with textContent: nothing from a file is parsed
// as HTML.

type Family = "js" | "py" | "sh" | "c" | "css" | "json" | "plain";

const FAMILY: Record<string, Family> = {
  ts: "js", tsx: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", vue: "js", svelte: "js",
  py: "py", rb: "py",
  sh: "sh", bash: "sh", zsh: "sh", ps1: "sh", yml: "sh", yaml: "sh", toml: "sh",
  rs: "c", go: "c", java: "c", c: "c", h: "c", cpp: "c", cs: "c", swift: "c", kt: "c", php: "c",
  css: "css", scss: "css", html: "css",
  json: "json",
};

const KEYWORDS: Record<Family, string> = {
  js: "const let var function return if else for while switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of interface type enum implements public private protected readonly static null undefined true false this void",
  py: "def class return if elif else for while in not and or is import from as with try except finally raise pass lambda yield None True False self async await global",
  sh: "if then else elif fi for do done while case esac function in echo export local return exit true false",
  c: "fn let mut pub struct enum impl trait use mod match if else for while loop return func var const type package import interface class new static void int bool string true false nil null self this async await",
  css: "",
  json: "true false null",
  plain: "",
};

/** Two-letter badge and colour for the file tab. */
export function fileBadge(file: string): { label: string; color: string } {
  const ext = (file.split(/[\\/]/).pop() ?? "").split(".").pop()?.toLowerCase() ?? "";
  const known: Record<string, [string, string]> = {
    ts: ["TS", "#3B82F6"], tsx: ["TX", "#3B82F6"], js: ["JS", "#EAB308"], jsx: ["JX", "#EAB308"],
    py: ["PY", "#34D399"], json: ["{}", "#A3A3A3"], md: ["MD", "#A78BFA"], rs: ["RS", "#FB923C"],
    go: ["GO", "#22D3EE"], css: ["CS", "#60A5FA"], html: ["HT", "#F87171"], sh: ["SH", "#9CA3AF"],
    yml: ["YM", "#F472B6"], yaml: ["YM", "#F472B6"], toml: ["TM", "#F472B6"], sql: ["SQ", "#FBBF24"],
  };
  const hit = known[ext];
  return hit ? { label: hit[0], color: hit[1] } : { label: (ext || "·").slice(0, 2).toUpperCase(), color: "#8E939C" };
}

const cache = new Map<Family, RegExp>();

function matcher(family: Family): RegExp {
  let re = cache.get(family);
  if (!re) {
    const comment = family === "py" || family === "sh" ? String.raw`#.*$` : family === "css" ? String.raw`\/\*.*?\*\/|\/\/.*$` : String.raw`\/\/.*$|\/\*.*?\*\/`;
    const string = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`";
    const number = String.raw`\b\d+(?:\.\d+)?\b`;
    const words = KEYWORDS[family].split(" ").filter(Boolean);
    const keyword = words.length ? String.raw`\b(?:${words.join("|")})\b` : "(?!)";
    re = new RegExp(`(${comment})|(${string})|(${number})|(${keyword})`, "gm");
    cache.set(family, re);
  }
  re.lastIndex = 0;
  return re;
}

/** Fills `parent` with `text`, coloured for the file's kind. */
export function highlightInto(parent: HTMLElement, text: string, file: string): void {
  const ext = (file.split(/[\\/]/).pop() ?? "").split(".").pop()?.toLowerCase() ?? "";
  const family = FAMILY[ext] ?? "plain";
  if (family === "plain" || text.length > 400) {
    parent.append(text);
    return;
  }
  const re = matcher(family);
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) parent.append(text.slice(last, m.index));
    const span = document.createElement("span");
    span.className = m[1] ? "tk-c" : m[2] ? "tk-s" : m[3] ? "tk-n" : "tk-k";
    span.textContent = m[0];
    parent.append(span);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}
