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

/** Zones whose hours we verified against camden.gov.uk (July 2026) — see docs/SPEC.md §5. */
const VERIFIED_HOURS: Record<string, { days: number[]; from: string; to: string }[]> = {
  "CA-F(N)": [
    { days: [1, 2, 3, 4, 5], from: "08:30", to: "23:00" },
    { days: [0, 6], from: "09:30", to: "23:00" },
  ],
  "CA-D": [
    { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
    { days: [6], from: "08:30", to: "13:30" },
  ],
  "CA-U": [{ days: [1, 2, 3, 4, 5], from: "10:00", to: "12:00" }],
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

/** Pure transform: Camden CPZ FeatureCollection -> normalised zone records. */
export function transformCamdenFeatures(
  fc: GeoFeatureCollection,
  checkedAt: string,
): ZoneRecord[] {
  if (!fc.features?.length) return [];
  const sample = fc.features[0].properties;
  const codeKey =
    findKey(sample, [/cpz.*code/i, /zone.*code/i, /^cpz$/i, /^code$/i, /zone.*(id|name)/i, /^name$/i]);
  const nameKey = findKey(sample, [/cpz.*name/i, /zone.*name/i, /area.*name/i]);
  const hoursKey = findKey(sample, [/hour/i, /operat/i, /control.*time/i, /times?$/i, /days?_?times?/i]);
  if (!codeKey) return [];

  const byCode = new Map<string, { rings: number[][][]; hoursText?: string; name?: string }>();
  for (const f of fc.features) {
    const code = String(f.properties[codeKey] ?? "").trim();
    if (!code) continue;
    const entry = byCode.get(code) ?? { rings: [] };
    for (const ring of outerRings(f)) entry.rings.push(toLatLngRing(ring, TOLERANCE));
    if (hoursKey && f.properties[hoursKey]) entry.hoursText = String(f.properties[hoursKey]);
    if (nameKey && f.properties[nameKey]) entry.name = String(f.properties[nameKey]);
    byCode.set(code, entry);
  }

  const zones: ZoneRecord[] = [];
  for (const [code, entry] of byCode) {
    if (!entry.rings.length) continue;
    const codeUpper = code.toUpperCase();
    const verified = VERIFIED_HOURS[codeUpper];
    const parsed = entry.hoursText ? parseScheduleText(entry.hoursText) : null;
    zones.push({
      id: "cam-" + code.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: "Camden " + code + (entry.name && entry.name !== code ? " — " + entry.name : ""),
      kind: "cpz",
      verified: Boolean(verified),
      src: "https://www.camden.gov.uk/controlled-parking-zones",
      checkedAt,
      sched: verified ?? parsed ?? DEFAULT_SCHED,
      ratePence: 700,
      maxStayHours: 4,
      polys: entry.rings,
    });
  }
  zones.sort((a, b) => a.id.localeCompare(b.id));
  return zones;
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
