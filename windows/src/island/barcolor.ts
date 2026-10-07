// The colours of the thin bar (the closed island): a gradient that says which AI sessions are working.
//
//  - a session waiting for you: warm ambers, quick;
//  - the focused session failed: reds;
//  - sessions at work: their own colours (each session pill has one), each with a shifted and a lighter
//    variant, so one session still makes a gradient;
//  - the focused session just finished: greens;
//  - otherwise: a calm rainbow.

export interface BarPalette {
  /** Colours along the bar; the gradient comes back to the first, so it flows without a seam. */
  stops: string[];
  /** Seconds for the colours to move once along the bar. */
  speed: number;
  /** The soft light under the bar, as an rgba() colour. */
  glow: string;
}

export interface BarTask {
  id: string;
  color: string;
  state: string;
}

const RAINBOW = ["#ff6b8b", "#f7b32b", "#2dd4a7", "#38bdf8", "#a78bfa"];
const WARM = ["#fbbf24", "#fb923c", "#f472b6", "#fde047", "#f97316"];
const RED = ["#f4505e", "#fb7185", "#e11d48", "#f97316", "#fb7185"];
const GREEN = ["#34d399", "#2dd4bf", "#a3e635", "#38bdf8", "#34d399"];

const FALLBACK = "#a78bfa";

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return parseHex(FALLBACK);
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** A colour as #rrggbb (anything unreadable becomes the fallback colour). */
const normalize = (hex: string) => toHex(...parseHex(hex));

/** The same colour turned along the colour wheel. */
export function shiftHue(hex: string, degrees: number): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl(h + degrees, s, l);
}

/** The same colour, a quarter of the way to white. */
export function lighten(hex: string): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl(h, s, l + (1 - l) * 0.25);
}

function glowOf(hex: string): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, 0.5)`;
}

const palette = (stops: string[], speed: number): BarPalette => ({ stops, speed, glow: glowOf(stops[0]) });

/** `focusState`: what the session on screen is doing. */
export function barPalette(tasks: BarTask[], focusState = "idle"): BarPalette {
  if (tasks.some((t) => t.state === "approval" || t.state === "question")) return palette(WARM, 1.8);
  if (focusState === "error") return palette(RED, 3);

  // The "no session yet" placeholder is not a session.
  const working = tasks.filter((t) => t.id !== "integration_claude" && (t.state === "working" || t.state === "thinking" || t.state === "searching"));
  if (working.length > 0) {
    const colors = [...new Set(working.map((t) => normalize(t.color)))].slice(0, 4);
    const stops = colors.flatMap((c) => [c, shiftHue(c, 30), lighten(c)]);
    const quick = working.some((t) => t.state !== "thinking");
    return palette(stops, quick ? 3.2 : 4.5);
  }
  if (focusState === "finished") return palette(GREEN, 6);
  return palette(RAINBOW, 7);
}

/** Who is at work, for the bar's hover text: the names of the sessions that are working or thinking. */
export function workingNames(tasks: (BarTask & { name: string })[]): string[] {
  return tasks
    .filter((t) => t.id !== "integration_claude" && (t.state === "working" || t.state === "thinking" || t.state === "searching"))
    .map((t) => t.name);
}

/** The CSS gradient for the palette. */
export function barGradient(p: BarPalette): string {
  return `linear-gradient(90deg, ${[...p.stops, p.stops[0]].join(", ")})`;
}
