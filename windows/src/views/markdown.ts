// A small Markdown renderer for Claude's replies in the history view.
//
// It builds DOM nodes and sets text with textContent: nothing from a reply is ever
// parsed as HTML, so a reply cannot inject markup or script. Links open only when
// they are http(s). Covered: headings, bold / italic / strike, inline code, code
// blocks, bullet and numbered lists, tables, quotes, rules, links.

import { Bridge } from "../core/bridge";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// ── Inline ────────────────────────────────────────────────────────────────────

/** Code, bold, strike, link, italic: the first one that starts earliest wins. */
const INLINE_SOURCE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(__[^_\n]+?__)|(~~[^~\n]+?~~)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*?\*)|((?<![\w])_[^_\s][^_\n]*?_(?![\w]))/;

function inline(parent: HTMLElement, text: string) {
  let last = 0;
  // A regex of its own for every call: a global regex keeps its position, and this
  // function calls itself for the text inside bold, italic and strike. Sharing one
  // would rewind the outer loop and never let it finish.
  const re = new RegExp(INLINE_SOURCE.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      parent.append(el("code", "md-code", tok.slice(1, -1)));
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      const b = el("strong");
      inline(b, tok.slice(2, -2));
      parent.append(b);
    } else if (tok.startsWith("~~")) {
      const s = el("s");
      inline(s, tok.slice(2, -2));
      parent.append(s);
    } else if (tok.startsWith("[")) {
      const close = tok.indexOf("](");
      const label = tok.slice(1, close);
      const url = tok.slice(close + 2, -1);
      if (/^https?:\/\//i.test(url)) {
        const a = el("a", "md-link", label);
        a.title = url;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          void Bridge.openUrl(url);
        });
        parent.append(a);
      } else {
        parent.append(label); // not a web link: shown, never followed
      }
    } else {
      const i = el("em");
      inline(i, tok.slice(1, -1));
      parent.append(i);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

// ── Blocks ────────────────────────────────────────────────────────────────────

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** A reply as DOM nodes, ready to append. */
export function renderMarkdown(source: string): DocumentFragment {
  const out = document.createDocumentFragment();
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // A blank line separates blocks.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ``` code ```
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence, if there is one
      const pre = el("pre", "md-pre");
      pre.append(el("code", undefined, body.join("\n")));
      out.append(pre);
      continue;
    }

    // | table |
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const table = el("table", "md-table");
      const head = el("tr");
      for (const c of cells(line)) {
        const th = el("th");
        inline(th, c);
        head.append(th);
      }
      table.append(head);
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        const tr = el("tr");
        for (const c of cells(lines[i])) {
          const td = el("td");
          inline(td, c);
          tr.append(td);
        }
        table.append(tr);
        i++;
      }
      const wrap = el("div", "md-table-wrap");
      wrap.append(table);
      out.append(wrap);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const h = el("div", `md-h md-h${Math.min(heading[1].length, 3)}`);
      inline(h, heading[2].replace(/\s+#+\s*$/, ""));
      out.append(h);
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.append(el("div", "md-hr"));
      i++;
      continue;
    }

    // - bullets and 1. numbers: one row each, indented by their nesting
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const indent = (bullet ? bullet[1] : numbered![1]).replace(/\t/g, "  ").length;
      const row = el("div", "md-li");
      row.style.paddingLeft = `${Math.min(indent, 8) * 7}px`;
      row.append(el("span", "md-marker", bullet ? "•" : `${numbered![2]}.`));
      const body = el("span", "md-li-body");
      inline(body, bullet ? bullet[2] : numbered![3]);
      row.append(body);
      out.append(row);
      i++;
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      const q = el("div", "md-quote");
      const parts: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) parts.push(QUOTE.exec(lines[i++])![1]);
      inline(q, parts.join(" "));
      out.append(q);
      continue;
    }

    // A paragraph: consecutive plain lines, kept as lines (replies use single
    // newlines on purpose).
    const p = el("div", "md-p");
    let first = true;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !(TABLE_ROW.test(lines[i]) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]))
    ) {
      if (!first) p.append(document.createElement("br"));
      inline(p, lines[i]);
      first = false;
      i++;
    }
    out.append(p);
  }
  return out;
}

// ── Plain text ────────────────────────────────────────────────────────────────

/** A line with its Markdown marks taken off: for the one-line titles. */
function plain(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first line of a reply worth showing as a title, without Markdown marks. */
export function firstLine(markdown: string): string {
  let inFence = false;
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || raw.trim() === "" || RULE.test(raw) || TABLE_SEPARATOR.test(raw)) continue;
    const text = plain(raw.replace(/^\s*\|/, "").replace(/\|\s*$/, "").replace(/\|/g, " · "));
    if (text) return text;
  }
  return "";
}
