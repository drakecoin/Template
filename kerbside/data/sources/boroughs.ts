import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOROUGH_CONFIG } from "../config.js";
import { outerRings, toLatLngRing, type GeoFeatureCollection } from "../geo.js";

const SOURCE_URL =
  "https://raw.githubusercontent.com/radoi90/housequest-data/master/london_boroughs.geojson";

const here = dirname(fileURLToPath(import.meta.url));
const RAW_SNAPSHOT = join(here, "..", "raw", "london_boroughs.geojson");
const TOLERANCE = 0.0006; // ~60 m

export interface ZoneRecord {
  id: string;
  name: string;
  kind: "cpz" | "borough";
  verified: boolean;
  src: string;
  checkedAt: string;
  sched: { days: number[]; from: string; to: string }[];
  ratePence: number;
  maxStayHours: number;
  polys: number[][][];
}

async function loadBoundaries(): Promise<GeoFeatureCollection> {
  try {
    const r = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const text = await r.text();
    const fc = JSON.parse(text) as GeoFeatureCollection;
    if (!fc.features?.length) throw new Error("no features");
    writeFileSync(RAW_SNAPSHOT, text);
    console.log("[boroughs] fetched live boundaries, snapshot updated");
    return fc;
  } catch (e) {
    console.log("[boroughs] live fetch failed (" + String(e) + ") — using committed snapshot");
    return JSON.parse(readFileSync(RAW_SNAPSHOT, "utf8")) as GeoFeatureCollection;
  }
}

/** Borough-level fallback zones: real boundaries + configured indicative hours. */
export async function loadBoroughZones(): Promise<ZoneRecord[]> {
  const fc = await loadBoundaries();
  const checkedAt = new Date().toISOString().slice(0, 10);
  return BOROUGH_CONFIG.map((cfg) => {
    const feature = fc.features.find((f) => f.properties.name === cfg.borough);
    if (!feature) throw new Error("borough not found in boundaries: " + cfg.borough);
    const polys = outerRings(feature).map((ring) => toLatLngRing(ring, TOLERANCE));
    const points = polys.reduce((n, r) => n + r.length, 0);
    console.log("[boroughs] " + cfg.borough.padEnd(24) + points + " boundary points");
    return {
      id: cfg.id,
      name: cfg.name,
      kind: "borough" as const,
      verified: false,
      src: cfg.src,
      checkedAt,
      sched: cfg.sched,
      ratePence: cfg.ratePence,
      maxStayHours: cfg.maxStayHours,
      polys,
    };
  });
}
