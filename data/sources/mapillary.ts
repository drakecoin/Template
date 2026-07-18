import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Detected parking/stopping street signs from Mapillary (crowd-sourced,
 * CC-BY-SA street imagery with automated traffic-sign detection). This is the
 * legally-clean equivalent of "sample the signs per area": each detection has a
 * location and a capture date, so we keep the most recent detection per spot and
 * let it supersede older ones.
 *
 * We do NOT scrape Google Street View — its terms forbid building a derived
 * dataset from the imagery. Mapillary's Graph API is licensed for exactly this.
 *
 * Needs a token in MAPILLARY_TOKEN (a Mapillary "client token", format
 * `MLY|<app-id>|<secret>`). Run: MAPILLARY_TOKEN=… npm run etl
 * Without a token (and no snapshot) the source is skipped, like the others.
 */
const API = "https://graph.mapillary.com/map_features";

// Greater London bounding box, tiled so no single request is truncated.
const LONDON = { w: -0.52, s: 51.28, e: 0.33, n: 51.70 };
const TILE_DEG = 0.03; // ~3 km cells
const REQUEST_PAUSE_MS = 120; // be gentle on the API
/** Two detections within this many metres of the same class are the same sign. */
const DEDUPE_METRES = 18;

const here = dirname(fileURLToPath(import.meta.url));
const RAW_SNAPSHOT = join(here, "..", "raw", "mapillary_signs.json");

/** Engine-ready restriction spot derived from a detected sign. */
export interface MapillarySpot {
  n: string;
  type: "noStop" | "noLoad";
  lat: number;
  lng: number;
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
 * Map a Mapillary traffic-sign class onto one of our restriction spot types.
 * Only signs we can represent faithfully are kept — no-stopping/clearway and
 * no-loading. Parking-hour plates and P-permitted signs are future work
 * (the detector classifies the pictogram, not the text plate beneath it).
 */
export function signToSpotType(objectValue: string): { type: MapillarySpot["type"]; label: string } | null {
  const v = objectValue.toLowerCase();
  if (!v.includes("regulatory")) return null;
  if (/no-loading/.test(v)) return { type: "noLoad", label: "No loading" };
  if (/no-stopping|clearway/.test(v)) return { type: "noStop", label: "No stopping" };
  return null;
}

/** The sign classes we ask Mapillary for (comma-separated in the query). */
const OBJECT_VALUES = [
  "regulatory--no-stopping--g1",
  "regulatory--no-stopping--g2",
  "regulatory--no-stopping--g15",
  "regulatory--no-parking-or-no-stopping--g1",
  "regulatory--no-loading--g1",
  "regulatory--clearway--g1",
];

function toIsoDate(ts: number | string | undefined): string {
  if (ts == null) return "";
  const ms = typeof ts === "number" ? ts : Number(ts);
  const d = new Date(Number.isFinite(ms) ? ms : Date.parse(String(ts)));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
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

async function fetchTile(token: string, w: number, s: number, e: number, n: number): Promise<RawFeature[]> {
  const url =
    API +
    "?fields=object_value,geometry,first_seen_at,last_seen_at" +
    "&object_values=" + OBJECT_VALUES.join(",") +
    "&bbox=" + [w, s, e, n].join(",");
  const r = await fetch(url, {
    headers: { Authorization: "OAuth " + token },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " for bbox " + [w, s, e, n].join(","));
  const j = (await r.json()) as { data?: RawFeature[] };
  return j.data ?? [];
}

async function fetchAll(token: string): Promise<RawFeature[]> {
  const out: RawFeature[] = [];
  let tiles = 0;
  for (let x = LONDON.w; x < LONDON.e; x += TILE_DEG) {
    for (let y = LONDON.s; y < LONDON.n; y += TILE_DEG) {
      const w = x;
      const s = y;
      const e = Math.min(x + TILE_DEG, LONDON.e);
      const n = Math.min(y + TILE_DEG, LONDON.n);
      try {
        const feats = await fetchTile(token, w, s, e, n);
        out.push(...feats);
      } catch (err) {
        console.log("[mapillary] tile failed: " + String(err));
      }
      tiles++;
      await new Promise((res) => setTimeout(res, REQUEST_PAUSE_MS));
    }
  }
  console.log("[mapillary] fetched " + out.length + " sign detections across " + tiles + " tiles");
  return out;
}

/** Turn raw detections into deduped, newest-wins restriction spots. */
export function buildSpots(features: RawFeature[]): MapillarySpot[] {
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
    const dup = kept.find(
      (k) => k.type === mapped.type && metresBetween(k.lat, k.lng, lat, lng) < DEDUPE_METRES,
    );
    if (dup) continue; // an equal-or-newer detection of this sign is already kept
    kept.push({
      n: mapped.label + (at ? " · sign seen " + at.slice(0, 7) : ""),
      type: mapped.type,
      lat,
      lng,
      date: at,
      note: "Detected street sign (" + f.object_value + ") via Mapillary" + (at ? ", " + at : ""),
    });
  }
  return kept;
}

/**
 * Fetch live when a token is set (snapshotting the raw detections), fall back to
 * the committed snapshot, and return null (skip) when neither is available.
 */
export async function loadMapillarySigns(): Promise<MapillarySpot[] | null> {
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

  const spots = buildSpots(features);
  console.log("[mapillary] " + spots.length + " restriction spots after dedupe");
  return spots;
}
