/**
 * ETL orchestrator: real parking data -> normalised files for the engine.
 *
 * Outputs (all under packages/engine/src/data/):
 *   zones.precise.json   per-zone CPZs (Camden portal, …)
 *   zones.boroughs.json  borough-level fallback zones
 *   spots.bays.json      kerb-level bay groups (Camden "Parking bays")
 *   spots.osm.json       kerbside groups from OSM parking:* tagging
 *
 * Sources fetch live when they can, snapshot into raw/, fall back to the
 * committed snapshot offline, and are skipped cleanly (keeping previous
 * output) when neither is available.
 *
 * Run with: npm run etl   (from the kerbside root or data/)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBoroughZones, type ZoneRecord } from "./sources/boroughs.js";
import { loadCamdenZones } from "./sources/camden.js";
import { loadCamdenBays, type SpotRecord } from "./sources/camdenBays.js";
import { loadMapillarySigns, type MapillarySpot } from "./sources/mapillary.js";
import { loadOsmKerbs } from "./sources/osm.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "packages", "engine", "src", "data");
const OUT_BOROUGHS = join(OUT_DIR, "zones.boroughs.json");
const OUT_PRECISE = join(OUT_DIR, "zones.precise.json");
const OUT_BAYS = join(OUT_DIR, "spots.bays.json");
const OUT_OSM = join(OUT_DIR, "spots.osm.json");
const OUT_MAPILLARY = join(OUT_DIR, "spots.mapillary.json");

function readExisting<T>(path: string): T[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T[]) : [];
}

function writeOrKeep<T>(path: string, fresh: T[] | null, label: string): T[] {
  if (fresh !== null) {
    writeFileSync(path, JSON.stringify(fresh) + "\n");
    console.log("wrote " + fresh.length + " " + label + " -> " + path);
    return fresh;
  }
  const kept = readExisting<T>(path);
  if (kept.length) console.log("kept existing " + label + " (" + kept.length + ") — source skipped");
  else writeFileSync(path, "[]\n");
  return kept;
}

// -- zones ------------------------------------------------------------------
const boroughs = await loadBoroughZones();
writeFileSync(OUT_BOROUGHS, JSON.stringify(boroughs) + "\n");
console.log("wrote " + boroughs.length + " borough zones -> " + OUT_BOROUGHS);

const precise = writeOrKeep<ZoneRecord>(OUT_PRECISE, await loadCamdenZones(), "per-zone CPZs");

// -- spots (spatial join against the freshest zone set, most precise first) --
const joinZones: ZoneRecord[] = [...precise, ...boroughs];
writeOrKeep<SpotRecord>(OUT_BAYS, await loadCamdenBays(joinZones), "bay groups");
writeOrKeep<SpotRecord>(OUT_OSM, await loadOsmKerbs(joinZones), "OSM kerb groups");

// -- signs from Mapillary: no-stopping/loading + CPZ parking bays (zone-joined) --
writeOrKeep<MapillarySpot>(OUT_MAPILLARY, await loadMapillarySigns(joinZones), "Mapillary sign spots");
