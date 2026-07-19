import type { SchedEntry } from "@kerbside/engine";
import { parseScheduleText } from "../schedule.js";
import { eventControlText, joinDayAnds, normaliseHours } from "./cpzText.js";

/**
 * Parse the event-day portion of a borough op_times string into structured
 * control windows. This is deliberately captured but NOT yet consumed by the
 * engine — see docs/EVENT_DAYS.md. The parsed `sched`/`bankHoliday` fields are
 * best-effort; `rawText` is the authoritative, lossless record and should win
 * whenever the structured fields look incomplete.
 *
 * Event control means: on days when a nearby venue (e.g. Tottenham Hotspur
 * Stadium) has a fixture/event, the CPZ operates for longer hours (or at all).
 * The engine can't know which calendar days are event days without a match-day
 * feed, so today we only store the rules; a future feature will apply them.
 */
export interface EventControl {
  /** Venue whose event days trigger the control, if named (e.g. a stadium). */
  venue: string | null;
  /** Event-day control windows by weekday (best-effort). */
  sched: SchedEntry[];
  /** Event-day control window on public/bank holidays, if stated. */
  bankHoliday: { from: string; to: string } | null;
  /** The verbatim event clause — authoritative source of truth. */
  rawText: string;
}

function extractVenue(text: string): string | null {
  const paren = /\(([^)]*(?:stadium|arena|ground)[^)]*)\)/i.exec(text);
  if (paren) return paren[1].trim();
  if (/arsenal/i.test(text)) return "Arsenal (Emirates Stadium) / Finsbury Park events";
  return null;
}

const BANK_HOLIDAY_RE =
  /(?:public holiday|bank hol[a-z.]*)s?\s*[:\-]?\s*(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm|noon)?)\s*(?:-|–|to)\s*(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm|noon)?)/i;

/** Parse a single "HH..–HH.." window via a synthetic all-week schedule. */
function parseWindow(fromText: string, toText: string): { from: string; to: string } | null {
  const parsed = parseScheduleText("everyday " + normaliseHours(fromText + " to " + toText));
  return parsed?.[0] ? { from: parsed[0].from, to: parsed[0].to } : null;
}

/**
 * Extract the event-day control rules from a full op_times string, or null when
 * the string has no event component. `eventOnly` marks zones that ONLY control
 * on event days (their whole entry is the event clause).
 */
export function parseEventControl(rawOpTimes: string, eventOnly: boolean): EventControl | null {
  const clause = eventControlText(rawOpTimes, eventOnly);
  if (!clause) return null;

  const bh = BANK_HOLIDAY_RE.exec(clause);
  const bankHoliday = bh ? parseWindow(bh[1], bh[2]) : null;

  // Parse weekday windows from the clause with the bank-holiday part removed
  // (so its time isn't mis-attributed to a weekday).
  const weekdayText = clause.replace(BANK_HOLIDAY_RE, " ");
  const sched = parseScheduleText(normaliseHours(joinDayAnds(weekdayText))) ?? [];

  return { venue: extractVenue(rawOpTimes), sched, bankHoliday, rawText: clause };
}
