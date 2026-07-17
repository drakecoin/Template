import { DEFAULT_DATASET } from "./data.js";
import type {
  Badge,
  Dataset,
  EvaluatedOption,
  LatLng,
  SchedEntry,
  Spot,
  Zone,
} from "./types.js";

export const WALK_MIN_PER_KM = 12.5;
export const SEARCH_RADIUS_KM = 1.5;
/** Walk penalty added to the score: pence per minute of walking. */
export const WALK_PENALTY_PENCE_PER_MIN = 35;
export const MAX_WINDOW_HOURS = 48;

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLa = ((b.lat - a.lat) * Math.PI) / 180;
  const dLo = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLa / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function hm(str: string): number {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes of [start, end) overlapping a zone's controlled hours (Europe/London local time). */
export function controlledOverlapMin(zone: Zone, start: Date, end: Date): number {
  let total = 0;
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  while (day < end) {
    for (const s of zone.sched) {
      if (!s.days.includes(day.getDay())) continue;
      const cs = new Date(day);
      cs.setMinutes(hm(s.from));
      const ce = new Date(day);
      ce.setMinutes(hm(s.to));
      const o = Math.min(end.getTime(), ce.getTime()) - Math.max(start.getTime(), cs.getTime());
      if (o > 0) total += o / 60000;
    }
    day.setDate(day.getDate() + 1);
  }
  return Math.round(total);
}

export function zoneActiveDuring(zone: Zone, start: Date, end: Date): boolean {
  return controlledOverlapMin(zone, start, end) > 0;
}

export interface CarParkCost {
  costPence: number;
  label: string;
}

export function carParkCost(spot: Spot, start: Date, end: Date): CarParkCost {
  const ratePence = spot.ratePence ?? 0;
  const dayMaxPence = spot.dayMaxPence ?? 0;
  const hrs = (end.getTime() - start.getTime()) / 3600000;
  const sh = start.getHours();
  const eveOk = spot.evePence != null && (sh >= 18 || sh < 7) && hrs <= 14;
  if (eveOk && spot.evePence != null) {
    // must end by 8am next morning to qualify for evening flat
    const cut = new Date(start);
    if (sh >= 18) cut.setDate(cut.getDate() + 1);
    cut.setHours(8, 0, 0, 0);
    if (end <= cut) return { costPence: spot.evePence, label: "evening flat rate" };
  }
  const days = Math.ceil(hrs / 24);
  const rem = hrs - (days - 1) * 24;
  const costPence =
    (days - 1) * dayMaxPence + Math.min(Math.ceil(rem) * ratePence, dayMaxPence);
  return {
    costPence,
    label: fmtGBP(ratePence) + "/hr, " + fmtGBP(dayMaxPence) + " day max",
  };
}

/** Format pence as "£x.xx" (whole pounds without decimals); 0 stays "£0.00". */
export function fmtGBP(pence: number): string {
  const pounds = pence / 100;
  return "£" + (Number.isInteger(pounds) ? String(pounds) : pounds.toFixed(2));
}

/** Format a stay cost for display: FREE when zero. */
export function fmtCost(pence: number): string {
  return pence === 0 ? "FREE" : "£" + (pence / 100).toFixed(2);
}

export function walkMinutes(km: number): number {
  return Math.max(1, Math.round(km * WALK_MIN_PER_KM));
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zoneHoursText(z: Zone): string {
  return z.sched
    .map((s: SchedEntry) => {
      const ds =
        s.days.length === 7
          ? "Every day"
          : s.days.length === 1
            ? DAY_NAMES[s.days[0]]
            : DAY_NAMES[s.days[0]] + "–" + DAY_NAMES[s.days[s.days.length - 1]];
      return ds + " " + s.from + "–" + s.to;
    })
    .join(", ");
}

export function evaluate(
  dest: LatLng,
  start: Date,
  end: Date,
  dataset: Dataset = DEFAULT_DATASET,
): EvaluatedOption[] {
  const zoneById = new Map(dataset.zones.map((z) => [z.id, z]));
  const out: EvaluatedOption[] = [];

  for (const spot of dataset.spots) {
    const km = haversineKm(dest, spot);
    if (km > SEARCH_RADIUS_KM) continue;
    const walkMin = walkMinutes(km);
    const zone = spot.zone ? zoneById.get(spot.zone) : undefined;
    const r: EvaluatedOption = {
      spot,
      km,
      walkMin,
      valid: true,
      costPence: 0,
      note: "",
      warn: "",
      typeLabel: "",
      score: 0,
      badges: [],
    };

    if (spot.type === "cp") {
      const c = carParkCost(spot, start, end);
      r.costPence = c.costPence;
      r.typeLabel = "Car park";
      r.note = c.label + " · " + spot.note;
    } else if (spot.type === "paid" && zone) {
      r.typeLabel = "Paid bay";
      const ov = controlledOverlapMin(zone, start, end);
      if (ov === 0) {
        r.costPence = 0;
        r.note =
          "Zone hours (" + zoneHoursText(zone) + ") don't apply to your times — park free";
      } else {
        const ovH = ov / 60;
        if (ovH > zone.maxStayHours) {
          r.valid = false;
          r.note =
            "Max stay " + zone.maxStayHours + "h during controlled hours — you need " +
            Math.round(ovH * 10) / 10 + "h";
        } else {
          r.costPence = Math.round((zone.ratePence * ov) / 60);
          r.note =
            "£" + (zone.ratePence / 100).toFixed(2) + "/hr while zone is active (" +
            zoneHoursText(zone) + ")";
          if (ovH < (end.getTime() - start.getTime()) / 3600000)
            r.note += " — the rest of your stay is free";
        }
      }
    } else if (spot.type === "res" && zone) {
      r.typeLabel = "Resident bay";
      const ov = controlledOverlapMin(zone, start, end);
      if (ov === 0) {
        r.costPence = 0;
        r.note = "Open to everyone outside zone hours (" + zoneHoursText(zone) + ")";
      } else {
        r.valid = false;
        r.note = "Resident permit holders only during " + zoneHoursText(zone);
      }
    } else if (spot.type === "yellow" && zone) {
      r.typeLabel = "Single yellow";
      const ov = controlledOverlapMin(zone, start, end);
      if (ov === 0) {
        r.costPence = 0;
        r.note = "No restriction at your times — free";
        r.warn = "Check the kerb for loading bans";
      } else {
        r.valid = false;
        r.note = "No parking during zone hours (" + zoneHoursText(zone) + ")";
      }
    } else if (spot.type === "freeSt") {
      r.typeLabel = "Free street";
      r.costPence = 0;
      r.note = "Uncontrolled street — free any time";
      r.warn = "Popular: arrive early";
    }

    r.score = r.valid ? r.costPence + r.walkMin * WALK_PENALTY_PENCE_PER_MIN : Infinity;
    out.push(r);
  }

  assignBadges(out);
  out.sort((a, b) =>
    a.valid === b.valid ? a.score - b.score || a.km - b.km : a.valid ? -1 : 1,
  );
  return out;
}

function addBadge(r: EvaluatedOption, badge: Badge): void {
  r.badges.push(badge);
}

function assignBadges(out: EvaluatedOption[]): void {
  const valid = out.filter((r) => r.valid);
  valid.sort((a, b) => a.score - b.score);
  if (!valid.length) return;
  addBadge(valid[0], "best");
  const free = valid.filter((r) => r.costPence === 0).sort((a, b) => a.walkMin - b.walkMin)[0];
  if (free) addBadge(free, "free");
  const closest = [...valid].sort((a, b) => a.km - b.km)[0];
  addBadge(closest, "close");
  const cheapPaid = valid
    .filter((r) => r.costPence > 0)
    .sort((a, b) => a.costPence - b.costPence || a.km - b.km)[0];
  if (cheapPaid) addBadge(cheapPaid, "cheap");
}
