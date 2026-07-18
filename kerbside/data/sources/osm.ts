import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ZoneRecord } from "./boroughs.js";
import type { SpotRecord } from "./camdenBays.js";

/**
 * Street-side parking from OpenStreetMap kerb tagging (the parking:left/right/
 * both schema and the legacy parking:lane / parking:condition schema).
 *
 * Ways tagged free/ticket/residents become spots at the way's midpoint,
 * grouped by street name + type; "no parking/stopping" ways are skipped.
 * Controlled types (ticket/residents) are joined to the containing zone so the
 * engine prices them with real hours; without a containing zone they're
 * dropped rather than guessed. Coverage is whatever mappers have surveyed —
 * every spot carries an OSM provenance note.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const MAX_ATTEMPTS_PER_ENDPOINT = 2;
// Inner London: matches where we have zone data for pricing
const BBOX = "51.46,-0.25,51.60,0.05"; // south,west,north,east

const QUERY = `
[out:json][timeout:120];
(
  way["highway"]["name"][~"^parking:(left|right|both)$"~"."](${BBOX});
  way["highway"]["name"][~"^parking:lane:(left|right|both)$"~"."](${BBOX});
);
out tags center;
`;

const here = dirname(fileURLToPath(import.meta.url));
const RAW_SNAPSHOT = join(here, "..", "raw", "osm_kerbs.json");

export interface OsmElement {
  type: string;
  id: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
export interface OsmResponse {
  elements: OsmElement[];
}

type KerbKind = "paid" | "res" | "freeSt" | null;

/** Classify one side's tag values under either OSM parking schema. */
function classifySide(tags: Record<string, string>, side: string): KerbKind {
  // modern schema: parking:<side>=lane/street_side/no + parking:<side>:*
  const position = tags["parking:" + side];
  const legacyLane = tags["parking:lane:" + side];
  if (position === "no" || legacyLane === "no" || legacyLane === "no_parking" || legacyLane === "no_stopping")
    return null;
  const present =
    (position && position !== "separate") ||
    (legacyLane && ["parallel", "diagonal", "perpendicular", "marked", "yes"].includes(legacyLane));
  if (!present) return null;
  const restriction =
    tags["parking:" + side + ":restriction"] ??
    tags["parking:condition:" + side] ??
    tags["parking:" + side + ":fee"] ??
    tags["parking:condition:" + side + ":default"];
  if (!restriction) return "freeSt";
  const r = restriction.toLowerCase();
  if (/no_parking|no_stopping|loading/.test(r)) return null;
  if (/residents|private/.test(r)) return "res";
  if (/ticket|yes|customers|paid/.test(r)) return "paid"; // fee=yes lands here
  if (/free/.test(r)) return "freeSt";
  return "freeSt";
}

/** Strongest classification across both kerbs: paid > res > free. */
export function classifyWay(tags: Record<string, string>): KerbKind {
  const kinds = ["left", "right", "both"]
    .map((s) => classifySide(tags, s))
    .filter((k): k is Exclude<KerbKind, null> => k !== null);
  if (!kinds.length) return null;
  if (kinds.includes("paid")) return "paid";
  if (kinds.includes("res")) return "res";
  return "freeSt";
}

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

const TYPE_LABEL: Record<string, string> = {
  paid: "on-street parking",
  res: "resident kerb",
  freeSt: "free kerb",
};

/** Pure transform: Overpass elements + zone records -> grouped spot records. */
export function transformOsmKerbs(res: OsmResponse, zones: ZoneRecord[]): SpotRecord[] {
  interface Group {
    type: Exclude<KerbKind, null>;
    name: string;
    lats: number[];
    lngs: number[];
    ways: number;
  }
  const groups = new Map<string, Group>();
  for (const el of res.elements ?? []) {
    if (!el.tags || !el.center) continue;
    const name = (el.tags.name ?? "").trim();
    if (!name) continue;
    const kind = classifyWay(el.tags);
    if (!kind) continue;
    const key = name.toLowerCase() + "|" + kind;
    const g = groups.get(key) ?? { type: kind, name, lats: [], lngs: [], ways: 0 };
    g.lats.push(el.center.lat);
    g.lngs.push(el.center.lon);
    g.ways += 1;
    groups.set(key, g);
  }

  const spots: SpotRecord[] = [];
  for (const g of groups.values()) {
    const lat = g.lats.reduce((a, b) => a + b, 0) / g.lats.length;
    const lng = g.lngs.reduce((a, b) => a + b, 0) / g.lngs.length;
    const zone = zones.find((z) => pointInRings(lat, lng, z.polys));
    if ((g.type === "paid" || g.type === "res") && !zone) continue;
    // "free" here mostly means OSM recorded that parking exists without
    // recording the restriction. Inside a CPZ that is NOT evidence of free
    // parking — offering it risks a PCN, so drop it. Outside every zone,
    // free is the honest reading.
    if (g.type === "freeSt" && zone) continue;
    spots.push({
      n: g.name + " (" + TYPE_LABEL[g.type] + ")",
      type: g.type,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      zone: zone?.id,
      note: "Kerb survey from OpenStreetMap (" + g.ways + " segment" + (g.ways === 1 ? "" : "s") + ") — verify signage",
    });
  }
  spots.sort((a, b) => a.n.localeCompare(b.n));
  return spots;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function fetchLive(): Promise<OsmResponse> {
  let lastErr = "";
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_ENDPOINT; attempt++) {
      try {
        const r = await fetch(endpoint, {
          method: "POST",
          body: "data=" + encodeURIComponent(QUERY),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "kerbside-etl/0.1 (parking data import; contact via repo)",
          },
          signal: AbortSignal.timeout(150000),
        });
        if (r.status === 429 || r.status === 504) {
          // rate-limited or overloaded: honour Retry-After (capped), then retry once
          const retryAfter = Math.min(Number(r.headers.get("retry-after")) || 30, 60);
          lastErr = "HTTP " + r.status + " from " + endpoint;
          if (attempt < MAX_ATTEMPTS_PER_ENDPOINT) {
            console.log("[osm] " + lastErr + " — waiting " + retryAfter + "s before retry");
            await sleep(retryAfter * 1000);
            continue;
          }
          break; // move on to the next mirror
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        const json = (await r.json()) as OsmResponse;
        if (!json.elements) throw new Error("no elements");
        console.log("[osm] fetched " + json.elements.length + " tagged ways from " + endpoint);
        return json;
      } catch (e) {
        lastErr = String(e) + " (" + endpoint + ")";
        break; // non-retryable error: try the next mirror
      }
    }
  }
  throw new Error(lastErr || "all Overpass endpoints failed");
}

/** Grouped OSM kerb spots, or null when unreachable and no snapshot exists. */
export async function loadOsmKerbs(zones: ZoneRecord[]): Promise<SpotRecord[] | null> {
  let res: OsmResponse;
  try {
    res = await fetchLive();
    writeFileSync(RAW_SNAPSHOT, JSON.stringify(res));
    console.log("[osm] snapshot updated");
  } catch (e) {
    if (existsSync(RAW_SNAPSHOT)) {
      console.log("[osm] live fetch failed (" + String(e) + ") — using committed snapshot");
      res = JSON.parse(readFileSync(RAW_SNAPSHOT, "utf8")) as OsmResponse;
    } else {
      console.log("[osm] SKIPPED — Overpass unreachable and no snapshot yet (" + String(e) + ")");
      return null;
    }
  }
  const spots = transformOsmKerbs(res, zones);
  console.log("[osm] " + spots.length + " street/type kerb groups");
  return spots;
}
