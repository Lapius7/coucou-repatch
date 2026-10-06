// "Today": how much Claude Code worked, counted from the hook events the island
// already sees. Kept in localStorage (shared with the settings window), one record
// per day, two weeks of history.

import { t } from "./i18n";

const STORAGE_KEY = "coucou.usage";
const KEEP_DAYS = 14;

export interface DayUsage {
  date: string; // YYYY-MM-DD, local time
  turns: number;
  ms: number;
  files: number;
  commands: number;
}

const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const empty = (date: string): DayUsage => ({ date, turns: 0, ms: 0, files: 0, commands: 0 });

function load(): DayUsage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((d) => d && typeof d.date === "string") : [];
  } catch {
    return [];
  }
}

function save(days: DayUsage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(days.slice(-KEEP_DAYS)));
  } catch {
    // No storage: the numbers simply start over next time.
  }
}

/** One finished turn. */
export function recordTurn(ms: number, files: number, commands: number) {
  const days = load();
  const key = dateKey();
  let today = days.find((d) => d.date === key);
  if (!today) {
    today = empty(key);
    days.push(today);
  }
  today.turns += 1;
  today.ms += Math.max(0, ms);
  today.files += files;
  today.commands += commands;
  save(days);
}

export function todayUsage(): DayUsage {
  const key = dateKey();
  return load().find((d) => d.date === key) ?? empty(key);
}

export function recentUsage(): DayUsage[] {
  return load().slice(-7).reverse();
}

/** 3_900_000 → "1h 05m", 125_000 → "2m", 40_000 → "40s". */
export function formatSpan(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "12 turns · 1h 05m", for the finished card. */
export function todayLine(): string {
  const u = todayUsage();
  if (u.turns === 0) return "";
  return t("use.today", { turns: t("n.turns", { n: u.turns }), span: formatSpan(u.ms) });
}
