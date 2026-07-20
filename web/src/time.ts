export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

export function toHM(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes());
}

/** Round up to the next quarter hour. */
export function roundQuarter(input: Date): Date {
  const d = new Date(input);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}

export const DEFAULT_STAY_HOURS = 2;

export interface StayWindow {
  start: Date;
  end: Date;
}

/**
 * Build the stay window from the form fields. An empty "to" means a default
 * 2-hour stay; a "to" at or before "from" rolls over to the next day (overnight).
 */
export function buildWindow(date: string, from: string, to: string): StayWindow | null {
  if (!date || !from) return null;
  const start = new Date(date + "T" + from);
  if (isNaN(start.getTime())) return null;
  let end: Date;
  if (to) {
    end = new Date(date + "T" + to);
    if (isNaN(end.getTime())) return null;
    if (end <= start) end.setDate(end.getDate() + 1);
  } else {
    end = new Date(start.getTime() + DEFAULT_STAY_HOURS * 36e5);
  }
  return { start, end };
}

export function fmtDT(d: Date): string {
  return (
    d.toLocaleDateString("en-GB", { weekday: "short" }) + " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

/**
 * Distance (metres) within which an option counts as being at the destination
 * rather than a walk away.
 */
export const AT_LOCATION_M = 50;

/**
 * Walk text for an option. `walkMinutes` floors at 1, so an option on the
 * destination itself reads "1 min walk" — which is wrong and, on the street
 * you are already standing on, faintly absurd. Those read "At location".
 * `withKm` adds the distance, which the map popup has no room for.
 */
export function fmtWalk(km: number, walkMin: number, withKm = true): string {
  if (km * 1000 <= AT_LOCATION_M) return "At location";
  const walk = walkMin + " min walk";
  return withKm ? walk + " · " + Math.round(km * 100) / 100 + " km" : walk;
}

export function gmapsLink(lat: number, lng: number): string {
  return (
    "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng + "&travelmode=driving"
  );
}
