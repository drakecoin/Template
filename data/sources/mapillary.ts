import { VectorTile } from "@mapbox/vector-tile";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PbfReader } from "pbf";
import type { ZoneRecord } from "./boroughs.js";

/**
 * Detected parking/stopping street signs from Mapillary (crowd-sourced,
 * CC-BY-SA street imagery with automated traffic-sign detection). This is the
 * legally-clean equivalent of "sample the signs per area": each detection has a
 * location and a capture date, so we keep the most recent detection per spot and
 * let it supersede older ones.
 *
 * We do NOT scrape Google Street View — its terms forbid building a derived
 * dataset from the imagery. Mapillary is CC-BY-SA and licensed for exactly this.
 *
 * Data comes from Mapillary's map-feature VECTOR TILES (the Graph API's bbox
 * queries are too slow for bulk): one small protobuf per z14 tile off a CDN,
 * decoded locally. Each traffic-sign feature carries its class ("value") and
 * capture dates, so we keep the most recent detection per spot.
 *
 * Needs a token in MAPILLARY_TOKEN (a Mapillary "client token", format
 * `MLY|<app-id>|<secret>`). Run: MAPILLARY_TOKEN=… npm run etl
 * Without a token (and no snapshot) the source is skipped, like the others.
 */
const TILE_URL = "https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2";
const ZOOM = 14; // Mapillary recommends z14 for map features
// Gentler by default to stay under the tile API's rate limit on big runs.
const CONCURRENCY = Number(process.env.MAPILLARY_CONCURRENCY) || 4;

// Greater London bounding box. Tunable via env for a quicker first run, e.g.
// inner London only:  MAPILLARY_BBOX="-0.23,51.46,0.0,51.56" npm run etl
const DEFAULT_BBOX = { w: -0.52, s: 51.28, e: 0.33, n: 51.70 };
const TIMEOUT_MS = Number(process.env.MAPILLARY_TIMEOUT_MS) || 30000;
const RETRIES = 3;
/** Two detections within this many metres of the same class are the same sign. */
const DEDUPE_METRES = 18;

function bbox(): { w: number; s: number; e: number; n: number } {
  const env = process.env.MAPILLARY_BBOX;
  if (env) {
    const [w, s, e, n] = env.split(",").map(Number);
    if ([w, s, e, n].every(Number.isFinite)) return { w, s, e, n };
    console.log("[mapillary] ignoring malformed MAPILLARY_BBOX; using default");
  }
  return DEFAULT_BBOX;
}

const here = dirname(fileURLToPath(import.meta.url));
const RAW_SNAPSHOT = join(here, "..", "raw", "mapillary_signs.json");

/** Engine-ready spot derived from a detected sign. */
export interface MapillarySpot {
  n: string;
  /**
   * noStop/noLoad are restriction areas. `cpzStreet` is a parking-place sign:
   * we know regulated parking exists at this point, but a sign detection reads
   * only the sign *class*, never the plate beneath it — so we can't tell a pay
   * bay from a resident bay, nor its hours or tariff. The engine treats it as
   * an advisory governed by the containing zone's hours, never a priced bay.
   */
  type: "noStop" | "noLoad" | "cpzStreet";
  lat: number;
  lng: number;
  /** Zone id for a parking sign, so the engine reads that zone's hours. */
  zone?: string;
  /** Capture date of the most recent detection (YYYY-MM-DD). */
  date: string;
  note: string;
}

interface RawFeature {
  object_value?: string;
  geometry?: { coordinates?: [number, number] };
  last_seen_at?: number | string;
  first_seen_at?: number | string;
}

/**
 * Map a Mapillary traffic-sign class onto a spot type.
 *  - no-loading            -> noLoad     (advisory)
 *  - no-stopping/clearway  -> noStop     (never parkable)
 *  - CPZ / parking place   -> cpzStreet  (regulated parking here; bay type unknown)
 *
 * Order matters for safety: restrictions and "no-parking" are matched BEFORE the
 * generic "parking" rule, so a no-parking sign is never turned into a parkable
 * spot (that would be a £130-PCN error). "no-parking" itself is skipped — we
 * only surface a spot where the sign says parking is permitted.
 *
 * A parking-place sign is deliberately NOT a priced bay: the detection reads the
 * sign class only, not the plate that states pay-vs-permit, hours and tariff, so
 * pricing one would invent a bay we can't confirm (see engine rule 8).
 */
export function signToSpotType(objectValue: string): { type: MapillarySpot["type"]; label: string } | null {
  const v = objectValue.toLowerCase();
  if (/no-loading/.test(v)) return { type: "noLoad", label: "No loading" };
  if (/no-stopping|clearway/.test(v)) return { type: "noStop", label: "No stopping" };
  if (/no-parking|end-of-parking/.test(v)) return null; // "no parking" / "zone ends" — not a bay
  if (/information--parking/.test(v)) return { type: "cpzStreet", label: "Parking" }; // blue "P" parking place
  return null; // other parking-* signs (e.g. parking-restrictions) are ambiguous — skip
}

function toIsoDate(ts: number | string | undefined): string {
  if (ts == null) return "";
  const ms = typeof ts === "number" ? ts : Number(ts);
  const d = new Date(Number.isFinite(ms) ? ms : Date.parse(String(ts)));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Ray-casting point-in-polygon over a zone's [lat,lng] rings. */
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

/** Rough metres between two lat/lng points (equirectangular; fine at this scale). */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const x = dLng * Math.cos(lat);
  return Math.hypot(dLat, x) * R;
}

/** Web-Mercator slippy-map tile indices for a lon/lat at a given zoom. */
export function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
export function lat2tile(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** Decode one map-feature vector tile into the traffic-sign detections we want. */
function decodeTile(buf: ArrayBuffer, x: number, y: number, z: number): RawFeature[] {
  const tile = new VectorTile(new PbfReader(new Uint8Array(buf)));
  const layer = tile.layers["traffic_sign"] ?? tile.layers[Object.keys(tile.layers)[0]];
  if (!layer) return [];
  const out: RawFeature[] = [];
  for (let i = 0; i < layer.length; i++) {
    const feat = layer.feature(i);
    const props = feat.properties as Record<string, string | number | boolean | undefined>;
    const value = String(props.value ?? props.object_value ?? "");
    if (!value || !signToSpotType(value)) continue; // keep only signs we map
    const gj = feat.toGeoJSON(x, y, z);
    if (gj.geometry.type !== "Point") continue;
    const [lng, lat] = gj.geometry.coordinates as [number, number];
    out.push({
      object_value: value,
      geometry: { coordinates: [lng, lat] },
      last_seen_at: props.last_seen_at as number | string | undefined,
      first_seen_at: props.first_seen_at as number | string | undefined,
    });
  }
  return out;
}

async function fetchTileVT(token: string, z: number, x: number, y: number): Promise<RawFeature[]> {
  const url = TILE_URL + "/" + z + "/" + x + "/" + y + "?access_token=" + encodeURIComponent(token);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r.status === 404 || r.status === 204) return []; // empty tile
      if (r.status === 429) {
        // rate limited — honour Retry-After (capped) and try again
        const wait = Math.min(10000, (Number(r.headers.get("retry-after")) || 2) * 1000);
        await new Promise((res) => setTimeout(res, wait));
        throw new Error("HTTP 429 (rate limited)");
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return decodeTile(await r.arrayBuffer(), x, y, z);
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await new Promise((res) => setTimeout(res, 400 * attempt));
    }
  }
  throw lastErr;
}

async function fetchAll(token: string): Promise<RawFeature[]> {
  const box = bbox();
  const xMin = lon2tile(box.w, ZOOM);
  const xMax = lon2tile(box.e, ZOOM);
  const yMin = lat2tile(box.n, ZOOM); // north edge -> smaller y
  const yMax = lat2tile(box.s, ZOOM);
  const tiles: { x: number; y: number }[] = [];
  for (let x = xMin; x <= xMax; x++) for (let y = yMin; y <= yMax; y++) tiles.push({ x, y });

  const total = tiles.length;

  // Preflight: probe one tile so a bad token or a hard block fails fast with a
  // clear reason instead of grinding through every tile.
  try {
    await fetchTileVT(token, ZOOM, tiles[0].x, tiles[0].y);
  } catch (err) {
    throw new Error(
      "preflight tile failed (" + String(err) + ") — check MAPILLARY_TOKEN is set in this shell " +
        "and has read access; if it's a 429 you're being rate limited (lower MAPILLARY_CONCURRENCY).",
    );
  }

  console.log(
    "[mapillary] " + total + " z" + ZOOM + " tiles over bbox " +
      [box.w, box.s, box.e, box.n].join(",") + " — concurrency " + CONCURRENCY,
  );

  const out: RawFeature[] = [];
  const errSamples: string[] = [];
  let next = 0;
  let done = 0;
  let failed = 0;
  async function worker(): Promise<void> {
    while (next < tiles.length) {
      const t = tiles[next++];
      try {
        out.push(...(await fetchTileVT(token, ZOOM, t.x, t.y)));
      } catch (err) {
        failed++;
        if (errSamples.length < 3) errSamples.push(String(err));
      }
      done++;
      if (done % 50 === 0 || done === total) {
        console.log("[mapillary] " + done + "/" + total + " tiles · " + out.length + " detections · " + failed + " failed");
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  if (errSamples.length) console.log("[mapillary] sample failures: " + errSamples.join(" | "));
  console.log("[mapillary] fetched " + out.length + " sign detections (" + failed + "/" + total + " tiles failed)");
  return out;
}

/**
 * Turn raw detections into deduped, newest-wins spots. Parking ("paid") signs
 * are spatially joined to the zone that contains them so the engine can price
 * them; a parking sign that falls outside every known zone is dropped rather
 * than guessed at.
 */
export function buildSpots(features: RawFeature[], zones: ZoneRecord[] = []): MapillarySpot[] {
  // newest first so the first detection kept at a location supersedes the rest
  const dated = features
    .map((f) => ({ f, at: toIsoDate(f.last_seen_at ?? f.first_seen_at) }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const kept: MapillarySpot[] = [];
  for (const { f, at } of dated) {
    const coords = f.geometry?.coordinates;
    const mapped = f.object_value ? signToSpotType(f.object_value) : null;
    if (!coords || !mapped) continue;
    const [lng, lat] = coords;

    let zone: string | undefined;
    if (mapped.type === "cpzStreet") {
      const z = zones.find((zz) => pointInRings(lat, lng, zz.polys));
      if (!z) continue; // no containing zone -> no hours to govern it — skip
      zone = z.id;
    }

    const dup = kept.find(
      (k) => k.type === mapped.type && metresBetween(k.lat, k.lng, lat, lng) < DEDUPE_METRES,
    );
    if (dup) continue; // an equal-or-newer detection of this sign is already kept

    const seen = at ? " · seen " + at.slice(0, 7) : "";
    kept.push({
      n: mapped.type === "cpzStreet" ? "Parking sign (check bay type)" + seen : mapped.label + (at ? " · sign seen " + at.slice(0, 7) : ""),
      type: mapped.type,
      lat,
      lng,
      zone,
      date: at,
      note:
        mapped.type === "cpzStreet"
          ? "Parking-place sign seen here (Mapillary" + (at ? ", " + at : "") +
            ") — the plate states the bay type, hours & tariff; we can't read it, so check on the street"
          : "Detected street sign (" + f.object_value + ") via Mapillary" + (at ? ", " + at : ""),
    });
  }
  return kept;
}

/**
 * Fetch live when a token is set (snapshotting the raw detections), fall back to
 * the committed snapshot, and return null (skip) when neither is available.
 */
export async function loadMapillarySigns(zones: ZoneRecord[] = []): Promise<MapillarySpot[] | null> {
  const token = process.env.MAPILLARY_TOKEN;
  let features: RawFeature[] | null = null;

  if (token) {
    try {
      features = await fetchAll(token);
      writeFileSync(RAW_SNAPSHOT, JSON.stringify(features) + "\n");
      console.log("[mapillary] snapshot -> " + RAW_SNAPSHOT);
    } catch (err) {
      console.log("[mapillary] live fetch failed: " + String(err));
    }
  } else {
    console.log("[mapillary] no MAPILLARY_TOKEN set — using snapshot if present");
  }

  if (!features && existsSync(RAW_SNAPSHOT)) {
    features = JSON.parse(readFileSync(RAW_SNAPSHOT, "utf8")) as RawFeature[];
  }
  if (!features) return null;

  const spots = buildSpots(features, zones);
  const parking = spots.filter((s) => s.type === "cpzStreet").length;
  console.log(
    "[mapillary] " + spots.length + " spots after dedupe (" + parking + " parking, " +
      (spots.length - parking) + " no-stopping/loading)",
  );
  return spots;
}
