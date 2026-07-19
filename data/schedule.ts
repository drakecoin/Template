import type { SchedEntry } from "@kerbside/engine";

/**
 * Parse free-text controlled-hours strings from borough datasets into the
 * engine's normalised schedule entries.
 *
 * Handles the common shapes:
 *   "Mon-Fri 8:30am-6:30pm"
 *   "Monday to Saturday 8.30am - 1.30pm"
 *   "Mon-Fri 08:30-18:30; Sat 09:30-13:30"
 *   "Every day 8:30am-11pm"
 * Returns null when nothing recognisable is found — callers must fall back to
 * a labelled-indicative default rather than guessing.
 */
const DAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

// Day-first, e.g. "Mon-Fri 8:30am-6:30pm", "Every day 8:30am-11pm".
const SEGMENT_RE =
  /(?:(all\s*week|every\s*day|daily|7\s*days)|(sun|mon|tue|wed|thu|fri|sat)[a-z]*(?:\s*(?:-|–|to)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*)?)\s*:?,?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/g;

// Time-first, e.g. "8:30am - 5:30pm Monday - Friday" (Lambeth's ArcGIS layer).
// The day token must follow the time range on whitespace so day-first strings
// like "Mon-Fri 08:30-18:30; Sat 09:30-13:30" can't match here by accident.
const SEGMENT_TIME_FIRST_RE =
  /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*(?:\s*(?:-|–|to)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*)?/g;

function toMinuteTime(hourStr: string, minStr: string | undefined, meridiem: string | undefined): string {
  let h = Number(hourStr);
  const m = minStr ? Number(minStr) : 0;
  if (meridiem === "pm" && h < 12) h += 12;
  if (meridiem === "am" && h === 12) h = 0;
  const p = (n: number) => String(n).padStart(2, "0");
  return p(h) + ":" + p(m);
}

function dayRange(from: number, to: number): number[] {
  const days: number[] = [];
  for (let d = from; ; d = (d + 1) % 7) {
    days.push(d);
    if (d === to) break;
    if (days.length > 7) break;
  }
  return days;
}

/** Build one entry from a matched day-group + start/end time parts. */
function buildEntry(
  everyday: string | undefined,
  dayFrom: string | undefined,
  dayTo: string | undefined,
  h1: string,
  m1: string | undefined,
  mer1raw: string | undefined,
  h2: string,
  m2: string | undefined,
  mer2: string | undefined,
): SchedEntry | null {
  // "8-6pm": a meridiem on the end time only also applies to the start
  // when the start would otherwise be later than the end.
  const from0 = toMinuteTime(h1, m1, mer1raw ?? undefined);
  let from = from0;
  const to = toMinuteTime(h2, m2, mer2 ?? undefined);
  if (!mer1raw && mer2 === "pm" && from0 > to) {
    from = toMinuteTime(h1, m1, "pm");
    if (from > to) from = from0;
  }
  if (from >= to) return null; // unparseable / overnight controls not supported
  const days = everyday
    ? [0, 1, 2, 3, 4, 5, 6]
    : dayRange(DAY_INDEX[dayFrom!], dayTo ? DAY_INDEX[dayTo] : DAY_INDEX[dayFrom!]);
  return { days, from, to };
}

export function parseScheduleText(text: string): SchedEntry[] | null {
  const entries: SchedEntry[] = [];
  const seen = new Set<string>();
  const add = (e: SchedEntry | null) => {
    if (!e) return;
    const key = e.days.join(",") + " " + e.from + "-" + e.to;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(e);
  };
  const norm = text.toLowerCase();
  for (const m of norm.matchAll(SEGMENT_RE)) {
    const [, everyday, dayFrom, dayTo, h1, m1, mer1, h2, m2, mer2] = m;
    add(buildEntry(everyday, dayFrom, dayTo, h1, m1, mer1, h2, m2, mer2));
  }
  for (const m of norm.matchAll(SEGMENT_TIME_FIRST_RE)) {
    const [, h1, m1, mer1, h2, m2, mer2, dayFrom, dayTo] = m;
    add(buildEntry(undefined, dayFrom, dayTo, h1, m1, mer1, h2, m2, mer2));
  }
  return entries.length ? entries : null;
}
