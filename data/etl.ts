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
import { BOROUGHS } from "./registry.js";
import { loadBoroughZones, type ZoneRecord } from "./sources/boroughs.js";
import { loadMapillarySigns, type MapillarySpot } from "./sources/mapillary.js";
import { loadOsmKerbs } from "./sources/osm.js";
import { loadSocrataBays, type SpotRecord } from "./sources/socrataBays.js";
import { loadSocrataCpz } from "./sources/socrataCpz.js";
import { loadRedRoutes, type RedRouteSpot } from "./sources/tflRedRoutes.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "packages", "engine", "src", "data");
const OUT_BOROUGHS = join(OUT_DIR, "zones.boroughs.json");
const OUT_PRECISE = join(OUT_DIR, "zones.precise.json");
const OUT_BAYS = join(OUT_DIR, "spots.bays.json");
const OUT_OSM = join(OUT_DIR, "spots.osm.json");
const OUT_MAPILLARY = join(OUT_DIR, "spots.mapillary.json");
const OUT_REDROUTES = join(OUT_DIR, "spots.redroutes.json");

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

// Precise per-zone CPZs, aggregated across every Socrata borough in the
// registry. A borough that skips (portal down, no snapshot) keeps its own
// previously-committed rows (identified by zone-id prefix) so one flaky portal
// never wipes another borough's data.
const existingPrecise = readExisting<ZoneRecord>(OUT_PRECISE);
const precise: ZoneRecord[] = [];
for (const entry of BOROUGHS.filter((b) => b.portal?.cpz)) {
  const fresh = await loadSocrataCpz(entry);
  if (fresh) {
    precise.push(...fresh);
  } else {
    const kept = existingPrecise.filter((z) => z.id.startsWith(entry.zoneIdPrefix + "-"));
    if (kept.length) console.log("[" + entry.zoneIdPrefix + "] kept " + kept.length + " committed zones — source skipped");
    precise.push(...kept);
  }
}
precise.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(OUT_PRECISE, JSON.stringify(precise) + "\n");
console.log("wrote " + precise.length + " per-zone CPZs -> " + OUT_PRECISE);

// -- spots (spatial join against the freshest zone set, most precise first) --
const joinZones: ZoneRecord[] = [...precise, ...boroughs];

// Kerb-level bays, aggregated across every Socrata borough that publishes them,
// with the same per-borough keep-on-skip (matched by provenance suffix).
const existingBays = readExisting<SpotRecord>(OUT_BAYS);
const bays: SpotRecord[] = [];
for (const entry of BOROUGHS.filter((b) => b.portal?.bays)) {
  const fresh = await loadSocrataBays(entry, joinZones);
  if (fresh) {
    bays.push(...fresh);
  } else {
    const suffix = "· " + entry.displayName + " open data";
    const kept = existingBays.filter((s) => s.note.endsWith(suffix));
    if (kept.length) console.log("[" + entry.zoneIdPrefix + "-bays] kept " + kept.length + " committed bay groups — source skipped");
    bays.push(...kept);
  }
}
bays.sort((a, b) => a.n.localeCompare(b.n));
writeFileSync(OUT_BAYS, JSON.stringify(bays) + "\n");
console.log("wrote " + bays.length + " bay groups -> " + OUT_BAYS);

writeOrKeep<SpotRecord>(OUT_OSM, await loadOsmKerbs(joinZones), "OSM kerb groups");

// -- signs from Mapillary: no-stopping/loading + CPZ parking bays (zone-joined) --
writeOrKeep<MapillarySpot>(OUT_MAPILLARY, await loadMapillarySigns(joinZones), "Mapillary sign spots");

// -- TfL red routes: pan-London no-stopping arterial network (linear) --------
writeOrKeep<RedRouteSpot>(OUT_REDROUTES, await loadRedRoutes(), "red-route no-stopping points");
