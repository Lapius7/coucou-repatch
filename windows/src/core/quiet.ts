// Quiet hours: a time of day in which Coucou makes no sound and shows no notification, except (if you
// want) when Claude is waiting for you.

export interface QuietSettings {
  quietEnabled: boolean;
  /** "HH:MM", the start. */
  quietFrom: string;
  /** "HH:MM", the end. A start later than the end means the night: 23:00 → 07:00. */
  quietTo: string;
  /** A request or a question that waits for you still makes its sound. */
  quietApprovals: boolean;
}

/** "07:30" → minutes since midnight; null when it is not a time. */
export function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

export function isQuietTime(s: QuietSettings, now = new Date()): boolean {
  if (!s.quietEnabled) return false;
  const from = minutesOf(s.quietFrom);
  const to = minutesOf(s.quietTo);
  if (from === null || to === null || from === to) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  return from < to ? at >= from && at < to : at >= from || at < to;
}

/** Should this sound (or notification, named by its sound) stay silent now? */
export function mutedNow(s: QuietSettings, sound: string, now = new Date()): boolean {
  if (!isQuietTime(s, now)) return false;
  return !(s.quietApprovals && (sound === "approval" || sound === "question"));
}
