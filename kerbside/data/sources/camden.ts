import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { outerRings, toLatLngRing, type GeoFeatureCollection } from "../geo.js";
import { parseScheduleText } from "../schedule.js";
import type { ZoneRecord } from "./boroughs.js";
import { discoverDatasets } from "./socrata.js";

/**
 * Per-zone CPZ polygons from Camden's open data portal (Socrata).
 *
 * The dataset id is discovered at runtime through the Socrata catalogue API so
 * we don't depend on a hard-coded resource id staying stable. A successful
 * fetch is snapshotted to raw/camden_cpz.geojson; when the portal is
 * unreachable the snapshot is used, and with no snapshot the source is skipped
 * (the borough-level fallback still covers Camden).
 */
const DOMAIN = "opendata.camden.gov.uk";
const SRC_PAGE = "https://" + DOMAIN + "/";

const here = dirname(fileURLToPath(import.meta.url));
const RAW_SNAPSHOT = join(here, "..", "raw", "camden_cpz.geojson");
const TOLERANCE = 0.0002; // ~20 m — zone polygons are much smaller than boroughs

/**
 * Zones whose hours we verified against camden.gov.uk (July 2026) — see
 * docs/SPEC.md §5. Keyed by normalized sub-zone code (uppercase, alphanumeric
 * only). Only used when the portal's own control-hours fields are absent.
 */
const VERIFIED_HOURS: Record<string, { days: number[]; from: string; to: string }[]> = {
  CAFN: [
    { days: [1, 2, 3, 4, 5], from: "08:30", to: "23:00" },
    { days: [0, 6], from: "09:30", to: "23:00" },
  ],
  CAD: [
    { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
    { days: [6], from: "08:30", to: "13:30" },
  ],
  CAU: [{ days: [1, 2, 3, 4, 5], from: "10:00", to: "12:00" }],
};

const DEFAULT_SCHED = [
  { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
  { days: [6], from: "08:30", to: "13:30" },
];

function findKey(props: Record<string, unknown>, patterns: RegExp[]): string | undefined {
  const keys = Object.keys(props);
  for (const re of patterns) {
    const k = keys.find((k) => re.test(k));
    if (k) return k;
  }
  return undefined;
}

/** Parse a "HH:MM-HH:MM" control-hours field from Camden's CPZ layer. */
function parseControlRange(v: unknown): { from: string; to: string } | null {
  const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(String(v ?? "").trim());
  if (!m || m[1] >= m[2]) return null;
  return { from: m[1], to: m[2] };
}

/**
 * Build a schedule from Camden's per-day-group control fields
 * (control_monday_to_friday / control_saturday / control_sunday).
 */
function schedFromControlFields(props: Record<string, unknown>): SchedEntryLike[] | null {
  const entries: SchedEntryLike[] = [];
  const mf = parseControlRange(props.control_monday_to_friday);
  if (mf) entries.push({ days: [1, 2, 3, 4, 5], ...mf });
  const sat = parseControlRange(props.control_saturday);
  if (sat) entries.push({ days: [6], ...sat });
  const sun = parseControlRange(props.control_sunday);
  if (sun) entries.push({ days: [0], ...sun });
  return entries.length ? entries : null;
}

interface SchedEntryLike {
  days: number[];
  from: string;
  to: string;
}

interface SubZoneEntry {
  rings: number[][][];
  displayName?: string;
  sched?: SchedEntryLike[];
  hoursText?: string;
}

/** Pure transform: Camden CPZ FeatureCollection -> normalised zone records. */
export function transformCamdenFeatures(
  fc: GeoFeatureCollection,
  checkedAt: string,
): ZoneRecord[] {
  if (!fc.features?.length) return [];
  const sample = fc.features[0].properties;
  // Camden's live schema: sub_zone_name + controlled_parking_zone_name +
  // control_monday_to_friday/saturday/sunday. Generic keys as fallback.
  const subKey =
    "sub_zone_name" in sample
      ? "sub_zone_name"
      : findKey(sample, [/sub.*zone/i, /cpz.*code/i, /zone.*code/i, /^cpz$/i, /^code$/i, /^name$/i]);
  const nameKey =
    "controlled_parking_zone_name" in sample
      ? "controlled_parking_zone_name"
      : findKey(sample, [/cpz.*name/i, /zone.*name/i, /area.*name/i]);
  const genericHoursKey = findKey(sample, [/hour/i, /operat/i, /times?_of/i]);
  if (!subKey) return [];

  const bySub = new Map<string, SubZoneEntry>();
  for (const f of fc.features) {
    const sub = String(f.properties[subKey] ?? "").trim();
    if (!sub) continue;
    const entry = bySub.get(sub) ?? { rings: [] };
    for (const ring of outerRings(f)) entry.rings.push(toLatLngRing(ring, TOLERANCE));
    entry.sched = entry.sched ?? schedFromControlFields(f.properties) ?? undefined;
    if (nameKey && f.properties[nameKey]) entry.displayName = String(f.properties[nameKey]);
    if (genericHoursKey && f.properties[genericHoursKey])
      entry.hoursText = String(f.properties[genericHoursKey]);
    bySub.set(sub, entry);
  }

  const zones: ZoneRecord[] = [];
  const usedIds = new Set<string>();
  for (const [sub, entry] of bySub) {
    if (!entry.rings.length) continue;
    const fromPortal = entry.sched ?? (entry.hoursText ? parseScheduleText(entry.hoursText) : null);
    const fromTable = VERIFIED_HOURS[normalizeCode(sub)];
    const base = "cam-" + sub.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = base + "-" + n; // e.g. CA-H(b) vs CA-H/B
    usedIds.add(id);
    zones.push({
      id,
      name: "Camden " + (entry.displayName ?? sub),
      kind: "cpz",
      // portal hours come straight from the council's own layer
      verified: Boolean(fromPortal || fromTable),
      src: "https://www.camden.gov.uk/controlled-parking-zones",
      checkedAt,
      sched: fromPortal ?? fromTable ?? DEFAULT_SCHED,
      ratePence: 700,
      maxStayHours: 4,
      polys: entry.rings,
    });
  }
  zones.sort((a, b) => a.id.localeCompare(b.id));
  return zones;
}

function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function fetchLive(): Promise<GeoFeatureCollection> {
  const discovered = await discoverDatasets(DOMAIN, "controlled parking", "camden");
  const candidates = discovered.filter((r) => /controlled parking|cpz/i.test(r.name));
  for (const c of candidates) {
    const url = "https://" + DOMAIN + "/resource/" + c.id + ".geojson?$limit=50000";
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) continue;
      const fc = (await r.json()) as GeoFeatureCollection;
      const polygonal = fc.features?.filter((f) =>
        f.geometry && /Polygon/i.test(f.geometry.type),
      );
      if (polygonal?.length) {
        console.log('[camden] using dataset "' + c.name + '" (' + c.id + "), " +
          polygonal.length + " polygon features");
        return { type: "FeatureCollection", features: polygonal };
      }
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("no polygonal CPZ dataset found in catalogue (checked " + candidates.length + ")");
}

/** Per-zone Camden CPZs, or null when unreachable and no snapshot exists. */
export async function loadCamdenZones(): Promise<ZoneRecord[] | null> {
  let fc: GeoFeatureCollection;
  try {
    fc = await fetchLive();
    writeFileSync(RAW_SNAPSHOT, JSON.stringify(fc));
    console.log("[camden] snapshot updated");
  } catch (e) {
    if (existsSync(RAW_SNAPSHOT)) {
      console.log("[camden] live fetch failed (" + String(e) + ") — using committed snapshot");
      fc = JSON.parse(readFileSync(RAW_SNAPSHOT, "utf8")) as GeoFeatureCollection;
    } else {
      console.log("[camden] SKIPPED — portal unreachable and no snapshot yet (" + String(e) + ")");
      console.log("[camden] run `npm run etl` on a machine with open internet to import per-zone data");
      return null;
    }
  }
  const zones = transformCamdenFeatures(fc, new Date().toISOString().slice(0, 10));
  console.log("[camden] " + zones.length + " per-zone CPZs (src " + SRC_PAGE + ")");
  return zones;
}
