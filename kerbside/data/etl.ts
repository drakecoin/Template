/**
 * ETL orchestrator: real parking data -> normalised zone files for the engine.
 *
 * Tiers written (most precise first in the engine's lookup):
 *   packages/engine/src/data/zones.precise.json   per-zone CPZs (Camden portal, …)
 *   packages/engine/src/data/zones.boroughs.json  borough-level fallbacks
 *
 * Sources fetch live when they can, snapshot into raw/, and fall back to the
 * committed snapshot offline. A source with neither is skipped without
 * clobbering previously generated output.
 *
 * Run with: npm run etl   (from the kerbside root or data/)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBoroughZones, type ZoneRecord } from "./sources/boroughs.js";
import { loadCamdenZones } from "./sources/camden.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "packages", "engine", "src", "data");
const OUT_BOROUGHS = join(OUT_DIR, "zones.boroughs.json");
const OUT_PRECISE = join(OUT_DIR, "zones.precise.json");

const boroughs = await loadBoroughZones();
writeFileSync(OUT_BOROUGHS, JSON.stringify(boroughs) + "\n");
console.log("wrote " + boroughs.length + " borough zones -> " + OUT_BOROUGHS);

const preciseSources: (ZoneRecord[] | null)[] = [await loadCamdenZones()];
const fetched = preciseSources.filter((s): s is ZoneRecord[] => s !== null);

if (fetched.length === preciseSources.length) {
  const precise = fetched.flat();
  writeFileSync(OUT_PRECISE, JSON.stringify(precise) + "\n");
  console.log("wrote " + precise.length + " per-zone CPZs -> " + OUT_PRECISE);
} else if (existsSync(OUT_PRECISE)) {
  const kept = JSON.parse(readFileSync(OUT_PRECISE, "utf8")) as ZoneRecord[];
  console.log("kept existing zones.precise.json (" + kept.length + " zones) — some sources skipped");
} else {
  writeFileSync(OUT_PRECISE, "[]\n");
  console.log("wrote empty zones.precise.json — no per-zone source reachable yet");
}
