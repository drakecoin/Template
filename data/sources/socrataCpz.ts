import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { outerRings, toLatLngRing, type GeoFeatureCollection } from "../geo.js";
import type { BoroughEntry, CpzHours } from "../registry.js";
import { parseScheduleText } from "../schedule.js";
import type { ZoneRecord } from "./boroughs.js";
import { discoverDatasets } from "./socrata.js";

/**
 * Generic per-zone CPZ importer for any Socrata-based borough open-data portal.
 *
 * The dataset id is discovered at runtime through the Socrata catalogue API so
 * we don't depend on a hard-coded resource id staying stable. A successful
 * fetch is snapshotted to raw/{borough}_cpz.geojson; when the portal is
 * unreachable the snapshot is used, and with no snapshot the source is skipped
 * (the borough-level fallback still covers the borough).
 *
 * A borough's schema differences (Camden's sub_zone_name / control_* fields,
 * generic name/hours keys elsewhere) are absorbed by heuristic key detection;
 * its id prefix, display name, tariff and verified-hours table come from the
 * registry entry.
 */
const TOLERANCE = 0.0002; // ~20 m — zone polygons are much smaller than boroughs

const here = dirname(fileURLToPath(import.meta.url));

/** Everything transformCpzFeatures needs that varies per borough. */
export interface CpzSpec {
  idPrefix: string;
  namePrefix: string;
  src: string;
  ratePence: number;
  maxStayHours: number;
  verifiedHours: Record<string, CpzHours[]>;
  defaultSched: CpzHours[];
}

function specFor(entry: BoroughEntry): CpzSpec | null {
  if (entry.portal?.kind !== "socrata") return null;
  const cpz = entry.portal.cpz;
  if (!cpz) return null;
  // Fall back to the borough's indicative hours when the portal gives us none.
  const defaultSched = entry.fallback?.sched ?? [
    { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
  ];
  return {
    idPrefix: entry.zoneIdPrefix,
    namePrefix: entry.displayName,
    src: entry.src,
    ratePence: cpz.ratePence,
    maxStayHours: cpz.maxStayHours,
    verifiedHours: cpz.verifiedHours ?? {},
    defaultSched,
  };
}

function findKey(props: Record<string, unknown>, patterns: RegExp[]): string | undefined {
  const keys = Object.keys(props);
  for (const re of patterns) {
    const k = keys.find((k) => re.test(k));
    if (k) return k;
  }
  return undefined;
}

/** Parse a "HH:MM-HH:MM" control-hours field. */
function parseControlRange(v: unknown): { from: string; to: string } | null {
  const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(String(v ?? "").trim());
  if (!m || m[1] >= m[2]) return null;
  return { from: m[1], to: m[2] };
}

/**
 * Build a schedule from per-day-group control fields
 * (control_monday_to_friday / control_saturday / control_sunday).
 */
function schedFromControlFields(props: Record<string, unknown>): CpzHours[] | null {
  const entries: CpzHours[] = [];
  const mf = parseControlRange(props.control_monday_to_friday);
  if (mf) entries.push({ days: [1, 2, 3, 4, 5], ...mf });
  const sat = parseControlRange(props.control_saturday);
  if (sat) entries.push({ days: [6], ...sat });
  const sun = parseControlRange(props.control_sunday);
  if (sun) entries.push({ days: [0], ...sun });
  return entries.length ? entries : null;
}

interface SubZoneEntry {
  rings: number[][][];
  displayName?: string;
  sched?: CpzHours[];
  hoursText?: string;
}

function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Pure transform: a borough CPZ FeatureCollection -> normalised zone records. */
export function transformCpzFeatures(
  fc: GeoFeatureCollection,
  checkedAt: string,
  spec: CpzSpec,
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
    const fromTable = spec.verifiedHours[normalizeCode(sub)];
    const base =
      spec.idPrefix + "-" + sub.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = base + "-" + n; // e.g. CA-H(b) vs CA-H/B
    usedIds.add(id);
    zones.push({
      id,
      name: spec.namePrefix + " " + (entry.displayName ?? sub),
      kind: "cpz",
      // portal hours come straight from the council's own layer
      verified: Boolean(fromPortal || fromTable),
      src: spec.src,
      checkedAt,
      sched: fromPortal ?? fromTable ?? spec.defaultSched,
      ratePence: spec.ratePence,
      maxStayHours: spec.maxStayHours,
      polys: entry.rings,
    });
  }
  zones.sort((a, b) => a.id.localeCompare(b.id));
  return zones;
}

function snapshotPath(entry: BoroughEntry): string {
  const base = entry.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return join(here, "..", "raw", base + "_cpz.geojson");
}

async function fetchLive(entry: BoroughEntry): Promise<GeoFeatureCollection> {
  const portal = entry.portal!;
  if (portal.kind !== "socrata") throw new Error("not a socrata portal");
  const cpz = portal.cpz!;
  const label = entry.zoneIdPrefix;
  const discovered = await discoverDatasets(portal.domain, cpz.query, label);
  const candidates = discovered.filter((r) => cpz.match.test(r.name));
  for (const c of candidates) {
    const url = "https://" + portal.domain + "/resource/" + c.id + ".geojson?$limit=50000";
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) continue;
      const fc = (await r.json()) as GeoFeatureCollection;
      const polygonal = fc.features?.filter((f) => f.geometry && /Polygon/i.test(f.geometry.type));
      if (polygonal?.length) {
        console.log('[' + label + '] using dataset "' + c.name + '" (' + c.id + "), " +
          polygonal.length + " polygon features");
        return { type: "FeatureCollection", features: polygonal };
      }
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("no polygonal CPZ dataset found in catalogue (checked " + candidates.length + ")");
}

/**
 * Per-zone CPZs for one Socrata borough, or null when the portal is unreachable
 * and no snapshot exists (the caller keeps any previously-committed rows).
 */
export async function loadSocrataCpz(entry: BoroughEntry): Promise<ZoneRecord[] | null> {
  const spec = specFor(entry);
  if (!spec) return null;
  const label = entry.zoneIdPrefix;
  const snapshot = snapshotPath(entry);
  let fc: GeoFeatureCollection;
  try {
    fc = await fetchLive(entry);
    writeFileSync(snapshot, JSON.stringify(fc));
    console.log("[" + label + "] snapshot updated");
  } catch (e) {
    if (existsSync(snapshot)) {
      console.log("[" + label + "] live fetch failed (" + String(e) + ") — using committed snapshot");
      fc = JSON.parse(readFileSync(snapshot, "utf8")) as GeoFeatureCollection;
    } else {
      console.log("[" + label + "] SKIPPED — portal unreachable and no snapshot yet (" + String(e) + ")");
      console.log("[" + label + "] run `npm run etl` on a machine with open internet to import per-zone data");
      return null;
    }
  }
  const zones = transformCpzFeatures(fc, new Date().toISOString().slice(0, 10), spec);
  console.log("[" + label + "] " + zones.length + " per-zone CPZs (socrata)");
  return zones;
}
