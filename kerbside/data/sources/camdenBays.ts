import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { centroid, type GeoFeatureCollection } from "../geo.js";
import type { ZoneRecord } from "./boroughs.js";
import { discoverDatasets } from "./socrata.js";

/**
 * Kerb-level parking bays from Camden's open data portal ("Parking bays"
 * dataset: individual bays with type, street and spaces). Bays are grouped by
 * street + type into one spot per group, and spatially joined to the zone
 * containing their centroid so the engine prices them with real zone hours.
 */
const DOMAIN = "opendata.camden.gov.uk";

const here = dirname(fileURLToPath(import.meta.url));
const RAW_SNAPSHOT = join(here, "..", "raw", "camden_bays.geojson");

export interface SpotRecord {
  n: string;
  type: "cp" | "paid" | "res" | "yellow" | "freeSt";
  lat: number;
  lng: number;
  zone?: string;
  note: string;
}

function findKey(props: Record<string, unknown>, patterns: RegExp[]): string | undefined {
  const keys = Object.keys(props);
  for (const re of patterns) {
    const k = keys.find((k) => re.test(k));
    if (k) return k;
  }
  return undefined;
}

/** Map a portal bay-type description onto the engine's spot types. */
export function baySpotType(desc: string): SpotRecord["type"] | null {
  const t = desc.toLowerCase();
  if (/resident/.test(t)) return "res";
  if (/shared|pay\s*(&|and)\s*display|paid|p\s*&\s*d|cashless|chargeable/.test(t)) return "paid";
  if (/free|uncontrolled/.test(t)) return "freeSt";
  // disabled, doctor, car club, motorcycle, loading, business, taxi… not offerable
  return null;
}

const TYPE_LABEL: Record<string, string> = {
  paid: "paid bays",
  res: "resident bays",
  freeSt: "free bays",
};

function pointInRings(lat: number, lng: number, rings: number[][][]): boolean {
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [lat1, lng1] = ring[i];
      const [lat2, lng2] = ring[j];
      const intersects =
        (lng1 > lng) !== (lng2 > lng) &&
        lat < ((lat2 - lat1) * (lng - lng1)) / (lng2 - lng1) + lat1;
      if (intersects) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** Pure transform: bay features + zone records -> grouped spot records. */
export function transformCamdenBays(
  fc: GeoFeatureCollection,
  zones: ZoneRecord[],
): SpotRecord[] {
  if (!fc.features?.length) return [];
  const sample = fc.features[0].properties;
  const streetKey = findKey(sample, [/street/i, /road.*name/i, /location/i]);
  const typeKey = findKey(sample, [/type.*(desc|of)/i, /bay.*type/i, /restriction/i, /^type$/i, /category/i, /description/i]);
  const spacesKey = findKey(sample, [/spaces/i, /bays?_?count/i, /number.*bays/i]);
  if (!streetKey || !typeKey) return [];

  interface Group {
    type: SpotRecord["type"];
    street: string;
    lats: number[];
    lngs: number[];
    spaces: number;
    count: number;
  }
  const groups = new Map<string, Group>();
  for (const f of fc.features) {
    const street = String(f.properties[streetKey] ?? "").trim();
    const typeDesc = String(f.properties[typeKey] ?? "");
    const type = baySpotType(typeDesc);
    if (!street || !type) continue;
    const c = centroid(f.geometry);
    if (!c) continue;
    const key = street.toLowerCase() + "|" + type;
    const g = groups.get(key) ?? { type, street, lats: [], lngs: [], spaces: 0, count: 0 };
    g.lats.push(c.lat);
    g.lngs.push(c.lng);
    const spaces = spacesKey ? Number(f.properties[spacesKey]) : NaN;
    g.spaces += Number.isFinite(spaces) && spaces > 0 ? spaces : 1;
    g.count += 1;
    groups.set(key, g);
  }

  const spots: SpotRecord[] = [];
  for (const g of groups.values()) {
    const lat = g.lats.reduce((a, b) => a + b, 0) / g.lats.length;
    const lng = g.lngs.reduce((a, b) => a + b, 0) / g.lngs.length;
    const zone = zones.find((z) => pointInRings(lat, lng, z.polys));
    // controlled bay types need a zone for hours; skip orphans rather than guess
    if ((g.type === "paid" || g.type === "res") && !zone) continue;
    spots.push({
      n: titleCase(g.street) + " (" + (TYPE_LABEL[g.type] ?? g.type) + ")",
      type: g.type,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      zone: zone?.id,
      note: g.spaces + " space" + (g.spaces === 1 ? "" : "s") + " · Camden open data",
    });
  }
  spots.sort((a, b) => a.n.localeCompare(b.n));
  return spots;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

async function fetchLive(): Promise<GeoFeatureCollection> {
  const discovered = await discoverDatasets(DOMAIN, "parking bays", "camden-bays");
  const candidates = discovered.filter((r) => /parking bays/i.test(r.name));
  for (const c of candidates) {
    const url = "https://" + DOMAIN + "/resource/" + c.id + ".geojson?$limit=100000";
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) continue;
      const fc = (await r.json()) as GeoFeatureCollection;
      if (fc.features?.length) {
        console.log('[camden-bays] using dataset "' + c.name + '" (' + c.id + "), " +
          fc.features.length + " bay features");
        return fc;
      }
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("no parking-bays dataset found (checked " + candidates.length + " candidates)");
}

/** Grouped Camden bay spots, or null when unreachable and no snapshot exists. */
export async function loadCamdenBays(zones: ZoneRecord[]): Promise<SpotRecord[] | null> {
  let fc: GeoFeatureCollection;
  try {
    fc = await fetchLive();
    writeFileSync(RAW_SNAPSHOT, JSON.stringify(fc));
    console.log("[camden-bays] snapshot updated");
  } catch (e) {
    if (existsSync(RAW_SNAPSHOT)) {
      console.log("[camden-bays] live fetch failed (" + String(e) + ") — using committed snapshot");
      fc = JSON.parse(readFileSync(RAW_SNAPSHOT, "utf8")) as GeoFeatureCollection;
    } else {
      console.log("[camden-bays] SKIPPED — portal unreachable and no snapshot yet (" + String(e) + ")");
      return null;
    }
  }
  const spots = transformCamdenBays(fc, zones);
  console.log("[camden-bays] " + spots.length + " street/type bay groups");
  return spots;
}
