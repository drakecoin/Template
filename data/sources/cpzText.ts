/**
 * Shared text helpers for turning borough free-text control-hours strings into
 * something the schedule parser can read. Kept in its own module so both the
 * iShare CPZ importer and the event-day extractor can use them without an
 * import cycle.
 */

/** The "…and on event days…" / "…for Arsenal match day…" clause marker. */
const EVENT_MARKER = /[,.]?\s*\b(and|or)\s+(on|for)\b/i;

/**
 * Reduce a free-text op_times string to its regular (everyday) controlled
 * hours: drop any event-day clause, and return "" for entries that are ONLY
 * about event days (so the caller can skip them).
 */
export function baseControlText(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (/^event\s+day/i.test(text)) return "";
  const cut = text.search(EVENT_MARKER);
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

/**
 * The event-day clause of an op_times string ("" if there is none). For
 * event-only entries the whole string is the event clause (minus any leading
 * "Event Days (venue):" label).
 */
export function eventControlText(raw: string, eventOnly: boolean): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (eventOnly) {
    return text
      .replace(/^event\s+days?\s*\([^)]*\)\s*:?/i, "")
      .replace(/^event\s+days?\s*:?/i, "")
      .trim();
  }
  const m = EVENT_MARKER.exec(text);
  return m ? text.slice(m.index).replace(/^[,.]?\s*/, "").trim() : "";
}

/**
 * True when a control clause applies ONLY on event / special-occasion days
 * ("8.30am - 5pm Saturday to Sunday (on event days)", "1:00pm - 5:00pm Sunday
 * on special occasions" — both RBKC).
 *
 * Boroughs that split their schedule one clause per column state the condition
 * inside the clause rather than in a status column, and the "and on…" shape
 * EVENT_MARKER looks for never appears. Such a clause must not become regular
 * hours: the engine has no match-day calendar, so it would show a normally-free
 * Sunday as controlled and send drivers past a legal free space.
 */
const EVENT_CONDITION = /\b(?:event\s+days?|special\s+occasions?|match\s+days?)\b/i;

export function isEventConditional(text: string): boolean {
  return EVENT_CONDITION.test(text);
}

/** Normalise an hours fragment so parseScheduleText can read it. */
export function normaliseHours(text: string): string {
  return (
    text
      // non-ASCII (mojibake en-dashes from the ISO-8859-1/UTF-8 muddle) -> hyphen
      .replace(/[^\x00-\x7f]+/g, " - ")
      .replace(/\bnoon\b/gi, "pm")
      .replace(/\bmidnight\b/gi, "am")
      // copy a trailing am/pm back onto a bare start time: "2 - 4pm" -> "2pm to 4pm"
      .replace(
        /(\d{1,2}(?:[.:]\d{2})?)\s*(?:-|–|to)\s*(\d{1,2}(?:[.:]\d{2})?\s*(am|pm))/gi,
        (_m, a: string, b: string, mer: string) => a + mer + " to " + b,
      )
  );
}

/** Turn "Saturday and Sunday" into "Saturday to Sunday" so day ranges parse. */
export function joinDayAnds(text: string): string {
  const DAY = "(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*";
  return text.replace(new RegExp("(" + DAY + ")\\s+and\\s+(" + DAY + ")", "gi"), "$1 to $2");
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
