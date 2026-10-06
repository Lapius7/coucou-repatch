// The diff of a file edit, for the diff view.
//
// Claude Code's hooks give the edit as text (`old_string` → `new_string`, or a whole
// `content`), not as a diff, and not with line numbers. The lines are compared here;
// the line numbers and the code around the change come from reading the file
// afterwards (see hooks.ts), when it can be read.

export type DiffKind = "ctx" | "add" | "del" | "gap";

export interface DiffRow {
  kind: DiffKind;
  text: string;
  /** Line number in the file after the edit (before it, for a removed line). */
  no?: number;
}

/** One replacement: what was there, what is there now. A new file has `old` = "". */
export interface Hunk {
  old: string;
  new: string;
}

export interface EditRows {
  rows: DiffRow[];
  add: number;
  del: number;
  /** Rows left out to keep the view small. */
  more: number;
  /** True when line numbers and surrounding code could be placed. */
  placed: boolean;
}

/** Lines of context shown above and below a change. */
const CONTEXT = 3;
/** Rows kept per edit: enough to read, small enough to draw at once. */
const MAX_ROWS = 160;
/** Beyond this many table cells, the comparison is skipped (everything out, everything in). */
const MAX_CELLS = 250_000;

/** Lines of a text. A final newline ends the last line; it does not start another. */
const split = (s: string): string[] => {
  if (s === "") return [];
  const out = s.replace(/\r\n?/g, "\n").split("\n");
  if (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out;
};

type Op = { kind: "ctx" | "add" | "del"; text: string };

/** Line diff by longest common subsequence, with the common start and end cut off first. */
export function diffLines(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: Op[] = a.slice(0, start).map((text) => ({ kind: "ctx", text }));
  const tail: Op[] = a.slice(endA).map((text) => ({ kind: "ctx", text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);

  let middle: Op[] = [];
  if (x.length * y.length > MAX_CELLS) {
    middle = [...x.map((text): Op => ({ kind: "del", text })), ...y.map((text): Op => ({ kind: "add", text }))];
  } else {
    // dp[i][j]: length of the longest common run of x[i…] and y[j…].
    const dp: Uint32Array[] = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) {
        middle.push({ kind: "ctx", text: x[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        middle.push({ kind: "del", text: x[i++] });
      } else {
        middle.push({ kind: "add", text: y[j++] });
      }
    }
    while (i < x.length) middle.push({ kind: "del", text: x[i++] });
    while (j < y.length) middle.push({ kind: "add", text: y[j++] });
  }
  return [...head, ...middle, ...tail];
}

/** The 1-based line where `needle` starts in `text`, or null. Falls back to its first real line. */
function lineOf(text: string, needle: string): number | null {
  const at = (n: string) => {
    const idx = n ? text.indexOf(n) : -1;
    return idx < 0 ? null : text.slice(0, idx).split("\n").length;
  };
  const whole = at(needle);
  if (whole !== null) return whole;
  // A long text arrives cut off ("…"): its first line still finds the place.
  const first = split(needle).find((l) => l.trim().length >= 8);
  return first ? at(first) : null;
}

/**
 * The rows to draw for an edit. With the file's text (read after the edit) the rows get
 * line numbers and a few lines of code on each side; without it, only the change.
 */
export function buildRows(hunks: Hunk[], fileText: string | null): EditRows {
  // The file's lines: its final newline is not a line of its own.
  const fileLines = fileText ? split(fileText) : null;
  const rows: DiffRow[] = [];
  let add = 0;
  let del = 0;
  let placed = false;

  hunks.forEach((hunk, index) => {
    const before = split(hunk.old);
    const after = split(hunk.new);
    const ops = diffLines(before, after);
    const start = fileText && fileLines ? lineOf(fileText.replace(/\r\n?/g, "\n"), hunk.new) : null;

    if (index > 0) rows.push({ kind: "gap", text: "⋯" });
    if (start !== null && fileLines) {
      placed = true;
      for (let n = Math.max(1, start - CONTEXT); n < start; n++) rows.push({ kind: "ctx", text: fileLines[n - 1], no: n });
    }
    let oldNo = start;
    let newNo = start;
    for (const op of ops) {
      if (op.kind === "del") {
        rows.push({ kind: "del", text: op.text, no: oldNo ?? undefined });
        del++;
        if (oldNo !== null) oldNo++;
      } else if (op.kind === "add") {
        rows.push({ kind: "add", text: op.text, no: newNo ?? undefined });
        add++;
        if (newNo !== null) newNo++;
      } else {
        rows.push({ kind: "ctx", text: op.text, no: newNo ?? undefined });
        if (oldNo !== null) oldNo++;
        if (newNo !== null) newNo++;
      }
    }
    if (start !== null && fileLines) {
      const next = start + after.length;
      for (let n = next; n < next + CONTEXT && n <= fileLines.length; n++) rows.push({ kind: "ctx", text: fileLines[n - 1], no: n });
    }
  });

  const more = Math.max(0, rows.length - MAX_ROWS);
  return { rows: more ? rows.slice(0, MAX_ROWS) : rows, add, del, more, placed };
}
