import { DEFAULT_DATASET } from "./data.js";
import type {
  Badge,
  Dataset,
  EvaluatedOption,
  EventControl,
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
/**
 * Fallback "last updated" date for records without their own `checkedAt`
 * (YYYY-MM-DD). Matches the ETL snapshot date of the imported borough data.
 */
export const DATA_UPDATED = "2026-07-18";

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

/** Minutes of [start, end) overlapping a set of scheduled hours (Europe/London local time). */
export function schedOverlapMin(sched: SchedEntry[], start: Date, end: Date): number {
  let total = 0;
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  while (day < end) {
    for (const s of sched) {
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

/** Minutes of [start, end) overlapping a zone's controlled hours (Europe/London local time). */
export function controlledOverlapMin(zone: Zone, start: Date, end: Date): number {
  return schedOverlapMin(zone.sched, start, end);
}

export function zoneActiveDuring(zone: Zone, start: Date, end: Date): boolean {
  return controlledOverlapMin(zone, start, end) > 0;
}

/** Ray-casting point-in-polygon test (poly is [lat, lng] vertices). */
export function pointInPolygon(pt: LatLng, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [lat1, lng1] = poly[i];
    const [lat2, lng2] = poly[j];
    const intersects =
      (lng1 > pt.lng) !== (lng2 > pt.lng) &&
      pt.lat < ((lat2 - lat1) * (pt.lng - lng1)) / (lng2 - lng1) + lat1;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** All boundary rings of a zone, whichever representation it uses. */
export function zoneRings(z: Zone): [number, number][][] {
  return z.polys ?? (z.poly ? [z.poly] : []);
}

export function pointInZone(pt: LatLng, z: Zone): boolean {
  return zoneRings(z).some((ring) => pointInPolygon(pt, ring));
}

/**
 * The zone whose boundary contains the point, if any. Zone order matters:
 * specific CPZ records come before borough-level fallbacks in ALL_ZONES, so
 * the most precise match wins.
 */
export function zoneAt(pt: LatLng, zones: Zone[]): Zone | undefined {
  return zones.find((z) => pointInZone(pt, z));
}

/**
 * On-street parking at the searched destination itself.
 *
 * Zone membership tells us the area is controlled and when — it does NOT tell
 * us what the kerb outside the destination actually is. Most CPZ kerbside is
 * resident-permit bays, so synthesising a priced pay-and-display bay from a
 * zone polygon invents a bay that may not exist and can send a driver into a
 * resident bay (§7). Inside a zone this is a `cpzStreet` advisory, not a
 * ranked, priced bay; outside every zone it stays an uncontrolled free street.
 */
export function destinationStreetSpot(dest: LatLng, zones: Zone[]): Spot {
  const zone = zoneAt(dest, zones);
  if (zone) {
    return {
      n: "Streets at your destination",
      type: "cpzStreet",
      zone: zone.id,
      lat: dest.lat,
      lng: dest.lng,
      virtual: true,
      note: "Zone-level data — we don't know this street's kerb markings",
    };
  }
  return {
    n: "Streets at your destination",
    type: "freeSt",
    lat: dest.lat,
    lng: dest.lng,
    virtual: true,
    note: "No controls in our dataset — check signage carefully",
  };
}

/** Metres per degree of latitude; longitude is scaled by cos(lat). */
const M_PER_DEG_LAT = 111_320;

/** Nearest point to `pt` on the segment a→b, in lat/lng. */
function nearestOnSegment(
  pt: LatLng,
  a: [number, number],
  b: [number, number],
): LatLng {
  // Work in a local equirectangular frame so the projection is distance-true.
  const kx = Math.cos((pt.lat * Math.PI) / 180);
  const ax = a[1] * kx, ay = a[0];
  const bx = b[1] * kx, by = b[0];
  const px = pt.lng * kx, py = pt.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { lat: ay + t * dy, lng: (ax + t * dx) / kx };
}

/**
 * The point of `zone` closest to `pt` — `pt` itself when it is already inside,
 * otherwise the nearest point on any boundary ring, nudged `inset` metres
 * inward so it lands on a street within the zone rather than exactly on the
 * boundary line.
 *
 * Returns undefined for a zone with no boundary geometry. Such zones exist
 * (the curated `ZONES` carry hours but no rings), and answering `pt` for them
 * would claim the zone reaches wherever the caller happens to be standing.
 */
export function nearestPointInZone(pt: LatLng, zone: Zone, inset = 20): LatLng | undefined {
  if (!zoneRings(zone).length) return undefined;
  if (pointInZone(pt, zone)) return pt;
  let best: LatLng | null = null;
  let bestKm = Infinity;
  for (const ring of zoneRings(zone)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const c = nearestOnSegment(pt, ring[j], ring[i]);
      const km = haversineKm(pt, c);
      if (km < bestKm) {
        bestKm = km;
        best = c;
      }
    }
  }
  if (!best) return undefined;
  // Push past the boundary along pt→best so the point sits inside the zone.
  const km = haversineKm(pt, best);
  if (km === 0) return best;
  const f = (km + inset / 1000) / km;
  const inside: LatLng = {
    lat: pt.lat + (best.lat - pt.lat) * f,
    lng: pt.lng + (best.lng - pt.lng) * f,
  };
  return pointInZone(inside, zone) ? inside : best;
}

/**
 * Whether a zone's hours are specific enough to clear a restriction on a
 * particular kerb. Borough-level fallbacks and unverified records carry
 * indicative, area-wide hours: fine for "this area is probably controlled",
 * not good enough to tell someone a resident bay or yellow line is off.
 */
export function zoneHoursTrusted(z: Zone): boolean {
  return z.verified && z.kind !== "borough";
}

/**
 * Human-readable caveat for a zone that is off on its regular hours but runs
 * event-day controls. We can't tell whether today is an event day, so we say
 * so plainly rather than implying the kerb is unconditionally free.
 */
export function eventRiskWarning(ev: EventControl): string {
  const hours = ev.sched.length ? " (" + zoneHoursText({ sched: ev.sched }) + ")" : "";
  return (
    "Free only if there's no event at " + ev.venue + " today — on event days this zone " +
    "is controlled" + hours + ". Check before you leave the car."
  );
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

export function zoneHoursText(z: Pick<Zone, "sched">): string {
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

/** How many "zone is off right now" suggestions to synthesise, nearest first. */
export const MAX_OFF_ZONE_SUGGESTIONS = 3;
/** A synthesised point this close (m) to a no-stopping point is dropped. */
const NO_STOP_CLEARANCE_M = 40;

/**
 * Free on-street parking in nearby CPZs that are *not* controlled during the
 * stay. A zone whose hours don't cover the window is ordinary unrestricted
 * kerbside, and often the best answer going — but it only shows up if we
 * suggest a point in it, because there is no curated spot there. We offer the
 * closest point inside each such zone.
 *
 * Only `verified`, per-zone CPZs qualify. Borough-level fallbacks carry
 * indicative, borough-wide hours: "this whole borough is off right now" is a
 * guess, and telling someone to park free on it is exactly the area-for-street
 * mistake in reverse.
 */
export function offZoneStreetSpots(
  dest: LatLng,
  zones: Zone[],
  start: Date,
  end: Date,
  spots: Spot[] = [],
  events: EventControl[] = [],
): Spot[] {
  const here = zoneAt(dest, zones);
  const noStop = spots.filter((s) => s.type === "noStop");
  const eventZones = new Set(events.map((e) => e.zoneId));
  const cands: { spot: Spot; km: number; conditional: boolean }[] = [];

  for (const z of zones) {
    if (z.kind === "borough" || !z.verified) continue;
    if (z.id === here?.id) continue; // the containing zone is already offered
    if (zoneActiveDuring(z, start, end)) continue;
    const pt = nearestPointInZone(dest, z);
    if (!pt) continue; // no boundary geometry — we can't say where the zone is
    const km = haversineKm(dest, pt);
    if (km > SEARCH_RADIUS_KM) continue;
    // The nearest point may sit inside a more precise zone that IS controlled;
    // zoneAt resolves precise-first, so trust it over our own zone id.
    const at = zoneAt(pt, zones);
    if (at && at.id !== z.id && zoneActiveDuring(at, start, end)) continue;
    if (noStop.some((s) => haversineKm(pt, s) * 1000 < NO_STOP_CLEARANCE_M)) continue;
    cands.push({
      spot: {
        n: z.name + " — nearest street",
        type: "cpzStreet",
        zone: z.id,
        lat: pt.lat,
        lng: pt.lng,
        virtual: true,
        note: "Closest point in this zone — check signage on the street you pick",
      },
      km,
      conditional: eventZones.has(z.id),
    });
  }

  // Zones whose "off" is unconditional come first, so a zone that is free only
  // when there's no fixture can't crowd a dependable one out of the slots.
  return cands
    .sort((a, b) => Number(a.conditional) - Number(b.conditional) || a.km - b.km)
    .slice(0, MAX_OFF_ZONE_SUGGESTIONS)
    .map((c) => c.spot);
}

export interface EvaluateOptions {
  /** Add a synthesised on-street option at the destination itself (zone lookup by polygon). */
  destinationStreets?: boolean;
}

export function evaluate(
  dest: LatLng,
  start: Date,
  end: Date,
  dataset: Dataset = DEFAULT_DATASET,
  opts: EvaluateOptions = {},
): EvaluatedOption[] {
  const zoneById = new Map(dataset.zones.map((z) => [z.id, z]));
  const eventByZone = new Map((dataset.events ?? []).map((e) => [e.zoneId, e]));
  const out: EvaluatedOption[] = [];
  const spots = opts.destinationStreets
    ? [
        ...dataset.spots,
        destinationStreetSpot(dest, dataset.zones),
        ...offZoneStreetSpots(dest, dataset.zones, start, end, dataset.spots, dataset.events),
      ]
    : dataset.spots;

  for (const spot of spots) {
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
      if (!zoneHoursTrusted(zone))
        r.warn =
          "Rate and hours are a " + (zone.kind === "borough" ? "borough-wide" : "zone-wide") +
          " estimate — the price on the sign wins";
    } else if (spot.type === "cpzStreet" && zone) {
      // A zone polygon says "controlled area", never "there is a bay here".
      // Priced only via a real bay record; here we can only tell the driver
      // whether the zone is running, and admit what we don't know.
      const ov = controlledOverlapMin(zone, start, end);
      if (ov === 0) {
        r.typeLabel = "Free street (zone off)";
        r.costPence = 0;
        r.note =
          zone.name + " isn't controlled during your times (" + zoneHoursText(zone) +
          ") — on-street parking here is free";
        r.warn = zoneHoursTrusted(zone)
          ? "Resident bays and yellow lines still apply where signed"
          : "Hours are an area-wide estimate — check the zone sign before you leave the car";
      } else {
        r.valid = false;
        r.typeLabel = "Controlled zone";
        r.note =
          "In " + zone.name + ", controlled " + zoneHoursText(zone) +
          " — we have no kerb-level bay data for this street, so we can't tell you " +
          "if there's a payable bay here or whether the kerb is resident-only";
      }
    } else if (spot.type === "res" && zone) {
      r.typeLabel = "Resident bay";
      const ov = controlledOverlapMin(zone, start, end);
      if (ov > 0) {
        r.valid = false;
        r.note = "Resident permit holders only during " + zoneHoursText(zone);
      } else if (!zoneHoursTrusted(zone)) {
        // Indicative, area-wide hours can't clear a resident bay: if the real
        // hours are wider than our guess, "open to everyone" is a £130 PCN.
        r.valid = false;
        r.note =
          "Resident bay — our hours for this street are a " +
          (zone.kind === "borough" ? "borough-wide" : "zone-wide") +
          " estimate, so we can't confirm it's outside controlled hours";
      } else {
        r.costPence = 0;
        r.note = "Open to everyone outside zone hours (" + zoneHoursText(zone) + ")";
      }
    } else if (spot.type === "yellow" && zone) {
      r.typeLabel = "Single yellow";
      const ov = controlledOverlapMin(zone, start, end);
      if (ov > 0) {
        r.valid = false;
        r.note = "No parking during zone hours (" + zoneHoursText(zone) + ")";
      } else if (!zoneHoursTrusted(zone)) {
        r.valid = false;
        r.note =
          "Single yellow — our hours for this street are a " +
          (zone.kind === "borough" ? "borough-wide" : "zone-wide") +
          " estimate, so we can't confirm the restriction is off";
      } else {
        r.costPence = 0;
        r.note = "No restriction at your times — free";
        r.warn = "Check the kerb for loading bans";
      }
    } else if (spot.type === "freeSt") {
      r.typeLabel = "Free street";
      r.costPence = 0;
      r.note = "Uncontrolled street — free any time";
      r.warn = "Popular: arrive early";
    } else if (spot.type === "noStop") {
      r.typeLabel = "No stopping";
      r.valid = false;
      r.note = "Red route / clearway — no stopping at any time";
    } else if (spot.type === "noLoad") {
      // Advisory, never a ranked bay: a loading-ban stretch isn't parking. It's
      // a hard "no" while the ban is posted, and off-ban it still carries the
      // caveat that the kerb line beneath governs whether you can park at all.
      r.typeLabel = "No loading";
      r.valid = false;
      const banText = spot.sched ? zoneHoursText({ sched: spot.sched }) : "at all times";
      const ov = spot.sched ? schedOverlapMin(spot.sched, start, end) : 1;
      r.note =
        ov > 0
          ? "Loading ban active during your times (" + banText + ") — no waiting or parking"
          : "Loading ban (" + banText + ") not active for your times — but this isn't a bay; check the kerb line beneath";
    } else {
      // An on-street bay whose governing zone is missing from the dataset. We
      // know it is restricted kerbside but not when — never show that as free.
      r.valid = false;
      r.typeLabel = "Unknown restriction";
      r.note = "We don't have the controlled hours governing this bay — check the signs";
    }

    // Event-day guard. Applied once, after the type branches, so every path
    // that clears a restriction because "the zone is off" is covered — the ETL
    // strips event clauses out of `sched`, so an untreated zero-overlap here
    // silently means "off on regular hours", not "off today".
    const ev = zone ? eventByZone.get(zone.id) : undefined;
    if (ev && r.valid) {
      const ovMin = controlledOverlapMin(zone!, start, end);
      const stayMin = (end.getTime() - start.getTime()) / 60000;
      // Only a stay with un-charged time rests on the zone being off.
      if (ovMin < stayMin) {
        r.eventRisk = ev;
        r.warn = eventRiskWarning(ev);
      }
    }

    // Surface the spot's own provenance for synthesised options and for
    // Mapillary sign observations (which carry the detection date + caveat).
    if (spot.virtual || spot.type === "cpzStreet") r.note += " · " + spot.note;
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
  // Two kinds of free option never get a badge, though both still appear:
  //  - one whose freeness hinges on there being no event today (eventRisk) — a
  //    green "Recommended" would out-shout the caveat beside it;
  //  - a Mapillary parking-sign observation (non-virtual cpzStreet) — it marks
  //    that regulated parking exists, not that a usable free bay is confirmed,
  //    so it shouldn't be promoted over the destination or a real bay.
  const badgeable = (r: EvaluatedOption): boolean =>
    r.valid &&
    !(r.eventRisk && r.costPence === 0) &&
    !(r.spot.type === "cpzStreet" && !r.spot.virtual);
  const valid = out.filter(badgeable);
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
