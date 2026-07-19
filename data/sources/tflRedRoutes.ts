import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * TfL red routes — the pan-London arterial "no stopping at any time" network.
 *
 * Red routes (single/double red lines) are the strategic roads where stopping is
 * prohibited, so no candidate kerbside on them is ever parkable. We import their
 * geometry from OpenStreetMap's parking-condition tagging (`no_stopping` under
 * either the modern `parking:<side>:restriction` scheme or the legacy
 * `parking:condition:<side>` / `parking:lane:<side>` schemes), fetched through
 * Overpass — the same license-clean, mirror-backed path the OSM kerb source
 * uses. This complements Mapillary's detected no-stopping SIGNS with the
 * continuous LINEAR network.
 *
 * Each way is sampled into evenly-spaced points along its length and deduped on
 * a coarse grid, so any destination sitting on or beside a red route surfaces a
 * nearby "No stopping" restriction without flooding results with duplicates.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const MAX_ATTEMPTS_PER_ENDPOINT = 2;
// Greater London (south,west,north,east) — red routes reach the outer boroughs.
const BBOX = "51.28,-0.52,51.70,0.33";

// Match no-stopping under every common OSM scheme; `out geom` gives us the
// full polyline so we can sample along it.
const QUERY = `
[out:json][timeout:180];
(
  way["highway"]["parking:both:restriction"="no_stopping"](${BBOX});
  way["highway"]["parking:left:restriction"="no_stopping"](${BBOX});
  way["highway"]["parking:right:restriction"="no_stopping"](${BBOX});
  way["highway"]["parking:condition:both"="no_stopping"](${BBOX});
  way["highway"]["parking:condition:left"="no_stopping"](${BBOX});
  way["highway"]["parking:condition:right"="no_stopping"](${BBOX});
  way["highway"]["parking:lane:both"="no_stopping"](${BBOX});
  way["highway"]["parking:lane:left"="no_stopping"](${BBOX});
  way["highway"]["parking:lane:right"="no_stopping"](${BBOX});
  way["highway"]["parking:both"="no_stopping"](${BBOX});
);
out tags geom;
`;

/** One point sampled every this-many metres along a red-route way. */
const SAMPLE_METRES = 350;
/** Points snapped to a grid this fine (metres) are treated as the same spot. */
const DEDUPE_METRES = 200;

const here = dirname(fileURLToPath(import.meta.url));
const RAW_SNAPSHOT = join(here, "..", "raw", "tfl_redroutes.json");

export interface OsmGeomElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}
export interface OsmGeomResponse {
  elements: OsmGeomElement[];
}

/** Engine-ready red-route restriction spot. */
export interface RedRouteSpot {
  n: string;
  type: "noStop";
  lat: number;
  lng: number;
  note: string;
}

/** True if any kerb side of this way is tagged no-stopping. */
export function isNoStopping(tags: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(tags)) {
    if (v !== "no_stopping") continue;
    if (/^parking:(both|left|right)(:restriction)?$/.test(k)) return true;
    if (/^parking:condition:(both|left|right)$/.test(k)) return true;
    if (/^parking:lane:(both|left|right)$/.test(k)) return true;
  }
  return false;
}

/** Rough metres between two lat/lng points (equirectangular; fine at this scale). */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const x = dLng * Math.cos(lat);
  return Math.hypot(dLat, x) * R;
}

/** Sample a way's polyline into points spaced ~SAMPLE_METRES apart (ends included). */
function samplePoints(geometry: { lat: number; lon: number }[]): { lat: number; lng: number }[] {
  if (geometry.length === 0) return [];
  if (geometry.length === 1) return [{ lat: geometry[0].lat, lng: geometry[0].lon }];
  const out: { lat: number; lng: number }[] = [{ lat: geometry[0].lat, lng: geometry[0].lon }];
  let carried = 0; // distance accumulated since the last emitted sample
  for (let i = 1; i < geometry.length; i++) {
    const a = geometry[i - 1];
    const b = geometry[i];
    const seg = metresBetween(a.lat, a.lon, b.lat, b.lon);
    if (seg === 0) continue;
    let dist = carried;
    while (dist + SAMPLE_METRES <= carried + seg) {
      dist += SAMPLE_METRES;
      const t = (dist - carried) / seg;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lon + (b.lon - a.lon) * t });
    }
    carried += seg;
    carried -= Math.floor(carried / SAMPLE_METRES) * SAMPLE_METRES;
  }
  return out;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/** Pure transform: Overpass geom elements -> deduped no-stopping spots. */
export function transformRedRoutes(res: OsmGeomResponse): RedRouteSpot[] {
  const cell = DEDUPE_METRES / 111320; // metres -> approx degrees latitude
  const seen = new Set<string>();
  const spots: RedRouteSpot[] = [];
  for (const el of res.elements ?? []) {
    if (!el.tags || !el.geometry?.length) continue;
    if (!isNoStopping(el.tags)) continue;
    const rawName = (el.tags.name ?? el.tags.ref ?? "").trim();
    // named roads read "Euston Road (red route)"; unnamed ones just "Red route"
    const label = rawName ? titleCase(rawName) + " (red route)" : "Red route";
    for (const p of samplePoints(el.geometry)) {
      // grid-snap so overlapping/parallel segments of the same road collapse
      const key = Math.round(p.lat / cell) + ":" + Math.round(p.lng / cell);
      if (seen.has(key)) continue;
      seen.add(key);
      spots.push({
        n: label,
        type: "noStop",
        lat: Math.round(p.lat * 1e5) / 1e5,
        lng: Math.round(p.lng * 1e5) / 1e5,
        note: "TfL red route — no stopping at any time (OSM-surveyed)",
      });
    }
  }
  spots.sort((a, b) => a.n.localeCompare(b.n) || a.lat - b.lat || a.lng - b.lng);
  return spots;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function fetchLive(): Promise<OsmGeomResponse> {
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
          signal: AbortSignal.timeout(210000),
        });
        if (r.status === 429 || r.status === 504) {
          const retryAfter = Math.min(Number(r.headers.get("retry-after")) || 30, 60);
          lastErr = "HTTP " + r.status + " from " + endpoint;
          if (attempt < MAX_ATTEMPTS_PER_ENDPOINT) {
            console.log("[redroutes] " + lastErr + " — waiting " + retryAfter + "s before retry");
            await sleep(retryAfter * 1000);
            continue;
          }
          break;
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        const json = (await r.json()) as OsmGeomResponse;
        if (!json.elements) throw new Error("no elements");
        console.log("[redroutes] fetched " + json.elements.length + " no-stopping ways from " + endpoint);
        return json;
      } catch (e) {
        lastErr = String(e) + " (" + endpoint + ")";
        break;
      }
    }
  }
  throw new Error(lastErr || "all Overpass endpoints failed");
}

/** Sampled red-route noStop spots, or null when unreachable and no snapshot exists. */
export async function loadRedRoutes(): Promise<RedRouteSpot[] | null> {
  let res: OsmGeomResponse;
  try {
    res = await fetchLive();
    writeFileSync(RAW_SNAPSHOT, JSON.stringify(res));
    console.log("[redroutes] snapshot updated");
  } catch (e) {
    if (existsSync(RAW_SNAPSHOT)) {
      console.log("[redroutes] live fetch failed (" + String(e) + ") — using committed snapshot");
      res = JSON.parse(readFileSync(RAW_SNAPSHOT, "utf8")) as OsmGeomResponse;
    } else {
      console.log("[redroutes] SKIPPED — Overpass unreachable and no snapshot yet (" + String(e) + ")");
      return null;
    }
  }
  const spots = transformRedRoutes(res);
  console.log("[redroutes] " + spots.length + " no-stopping points along the red-route network");
  return spots;
}
