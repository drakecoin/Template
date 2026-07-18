/**
 * ETL: real borough boundaries -> normalised zone records for the engine.
 *
 * Fetches London borough boundary GeoJSON (falls back to the committed snapshot
 * in raw/ when offline), joins each configured borough onto its CPZ config,
 * simplifies the rings for map rendering, and writes
 * packages/engine/src/data/zones.boroughs.json.
 *
 * Run with: npm run etl   (from the kerbside root or data/)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOROUGH_CONFIG } from "./config.js";

const SOURCE_URL =
  "https://raw.githubusercontent.com/radoi90/housequest-data/master/london_boroughs.geojson";

const here = dirname(fileURLToPath(import.meta.url));
const RAW_SNAPSHOT = join(here, "raw", "london_boroughs.geojson");
const OUT = join(here, "..", "packages", "engine", "src", "data", "zones.boroughs.json");

interface Feature {
  type: string;
  properties: { name: string };
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
}
interface FeatureCollection {
  type: string;
  features: Feature[];
}

/** Ramer–Douglas–Peucker simplification on [lng, lat] pairs (planar, fine at city scale). */
function simplify(ring: number[][], tolerance: number): number[][] {
  if (ring.length <= 4) return ring;
  const sqTol = tolerance * tolerance;
  const keep = new Array<boolean>(ring.length).fill(false);
  keep[0] = keep[ring.length - 1] = true;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let maxSq = 0;
    let index = 0;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(ring[i], ring[first], ring[last]);
      if (sq > maxSq) {
        index = i;
        maxSq = sq;
      }
    }
    if (maxSq > sqTol) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

function sqSegDist(p: number[], a: number[], b: number[]): number {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

async function loadBoundaries(): Promise<FeatureCollection> {
  try {
    const r = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const text = await r.text();
    const fc = JSON.parse(text) as FeatureCollection;
    if (!fc.features?.length) throw new Error("no features");
    writeFileSync(RAW_SNAPSHOT, text);
    console.log("fetched live boundaries (" + fc.features.length + " boroughs), snapshot updated");
    return fc;
  } catch (e) {
    console.log("live fetch failed (" + String(e) + ") — using committed snapshot");
    return JSON.parse(readFileSync(RAW_SNAPSHOT, "utf8")) as FeatureCollection;
  }
}

/** Outer rings of a Polygon or MultiPolygon, as [lng, lat] pairs. */
function outerRings(f: Feature): number[][][] {
  if (f.geometry.type === "Polygon") return [(f.geometry.coordinates as number[][][])[0]];
  if (f.geometry.type === "MultiPolygon")
    return (f.geometry.coordinates as number[][][][]).map((poly) => poly[0]);
  throw new Error("unsupported geometry " + f.geometry.type);
}

const fc = await loadBoundaries();
const checkedAt = new Date().toISOString().slice(0, 10);
const TOLERANCE = 0.0006; // ~60 m — keeps map rendering light without visible distortion

const zones = BOROUGH_CONFIG.map((cfg) => {
  const feature = fc.features.find((f) => f.properties.name === cfg.borough);
  if (!feature) throw new Error("borough not found in boundaries: " + cfg.borough);
  const polys = outerRings(feature).map((ring) =>
    simplify(ring, TOLERANCE).map(([lng, lat]) => [
      Math.round(lat * 1e5) / 1e5,
      Math.round(lng * 1e5) / 1e5,
    ]),
  );
  const points = polys.reduce((n, r) => n + r.length, 0);
  console.log(cfg.borough.padEnd(24), points + " boundary points");
  return {
    id: cfg.id,
    name: cfg.name,
    kind: "borough",
    verified: false,
    src: cfg.src,
    checkedAt,
    sched: cfg.sched,
    ratePence: cfg.ratePence,
    maxStayHours: cfg.maxStayHours,
    polys,
  };
});

writeFileSync(OUT, JSON.stringify(zones) + "\n");
console.log("wrote " + zones.length + " borough zones -> " + OUT);
