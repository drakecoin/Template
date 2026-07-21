import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeoFeatureCollection } from "../geo.js";
import type { BoroughEntry, GeoserverPortal } from "../registry.js";
import { transformArcgisCpz, transformArcgisEvents, type ArcgisCpzSpec } from "./arcgisCpz.js";
import type { ZoneRecord } from "./boroughs.js";
import type { EventZoneRecord } from "./ishareCpz.js";

/**
 * Per-zone CPZ importer for boroughs whose parking map is a **GeoServer** WFS.
 *
 * This is the Haringey lesson generalised: the data behind a council's own map
 * viewer is often public and machine-readable even when it appears in no
 * catalogue. Hackney's map (map2.hackney.gov.uk) is a Leaflet app over a
 * GeoServer whose `ows` endpoint serves GeoJSON directly — no discovery API
 * lists it, and the borough looked like a dead end until the map's JS bundle
 * gave up the URL.
 *
 * Unlike the iShare WFS (GML in British National Grid, needing reprojection),
 * GeoServer will hand back WGS84 GeoJSON on request, so once fetched the
 * features are exactly the shape `transformArcgisCpz` already consumes. That
 * transform is portal-agnostic — it only wants a FeatureCollection and a spec —
 * so the zone/event logic, including per-clause hours parsing and event-clause
 * capture, is shared rather than reimplemented here.
 */
const here = dirname(fileURLToPath(import.meta.url));

function specFor(entry: BoroughEntry): ArcgisCpzSpec | null {
  const portal = entry.portal;
  if (portal?.kind !== "geoserver" || !portal.cpz) return null;
  const cpz = portal.cpz;
  return {
    idPrefix: entry.zoneIdPrefix,
    namePrefix: entry.displayName,
    src: entry.src,
    ratePence: cpz.ratePence,
    maxStayHours: cpz.maxStayHours,
    hoursFields: cpz.hoursFields,
    zoneField: cpz.zoneField,
    hoursPerField: true,
    hoursSplit: cpz.hoursSplit,
    defaultSched: entry.fallback?.sched ?? [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
  };
}

function snapshotPath(entry: BoroughEntry): string {
  const base = entry.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return join(here, "..", "raw", base + "_cpz.geojson");
}

function featureUrl(portal: GeoserverPortal): string {
  const cpz = portal.cpz!;
  const q = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName: cpz.typeName,
    outputFormat: "application/json",
    // Ask for WGS84 explicitly: GeoServer otherwise answers in the layer's
    // native CRS, and a silently-reprojected polygon would land zones in the
    // North Sea rather than fail loudly.
    SrsName: "EPSG:4326",
  });
  return portal.baseUrl.replace(/\/+$/, "") + "/ows?" + q.toString();
}

async function fetchLive(entry: BoroughEntry): Promise<GeoFeatureCollection> {
  const portal = entry.portal as GeoserverPortal;
  const url = featureUrl(portal);
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const fc = (await r.json()) as GeoFeatureCollection;
  const polygonal = fc.features?.filter((f) => f.geometry && /Polygon/i.test(f.geometry.type));
  if (!polygonal?.length) throw new Error("no polygon features returned");
  console.log(
    "[" + entry.zoneIdPrefix + "] geoserver WFS returned " + polygonal.length + " polygon features",
  );
  return { type: "FeatureCollection", features: polygonal };
}

/** Per-zone CPZs for one GeoServer borough; null when unreachable with no snapshot. */
export async function loadGeoserverCpz(entry: BoroughEntry): Promise<ZoneRecord[] | null> {
  const spec = specFor(entry);
  if (!spec) return null;
  const label = entry.zoneIdPrefix;
  const snapshot = snapshotPath(entry);
  let fc: GeoFeatureCollection;
  try {
    fc = await fetchLive(entry);
    writeFileSync(snapshot, JSON.stringify(fc));
    console.log("[" + label + "] snapshot updated");
  } catch (e) {
    if (existsSync(snapshot)) {
      console.log("[" + label + "] live fetch failed (" + String(e) + ") — using committed snapshot");
      fc = JSON.parse(readFileSync(snapshot, "utf8")) as GeoFeatureCollection;
    } else {
      console.log("[" + label + "] SKIPPED — WFS unreachable and no snapshot yet (" + String(e) + ")");
      return null;
    }
  }
  const zones = transformArcgisCpz(fc, new Date().toISOString().slice(0, 10), spec);
  console.log("[" + label + "] " + zones.length + " per-zone CPZs (geoserver)");
  return zones;
}

/** Event-day zones read from the snapshot the precise pass just wrote. */
export function loadGeoserverEvents(entry: BoroughEntry): EventZoneRecord[] | null {
  const spec = specFor(entry);
  if (!spec) return null;
  const snapshot = snapshotPath(entry);
  if (!existsSync(snapshot)) return null;
  const fc = JSON.parse(readFileSync(snapshot, "utf8")) as GeoFeatureCollection;
  const events = transformArcgisEvents(fc, new Date().toISOString().slice(0, 10), spec);
  console.log("[" + entry.zoneIdPrefix + "] " + events.length + " event-day zones captured (geoserver)");
  return events;
}
