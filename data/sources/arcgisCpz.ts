import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { outerRings, toLatLngRing, type GeoFeatureCollection } from "../geo.js";
import type { ArcgisPortal, BoroughEntry, CpzHours } from "../registry.js";
import { parseScheduleText } from "../schedule.js";
import type { ZoneRecord } from "./boroughs.js";
import type { EventZoneRecord } from "./ishareCpz.js";

/**
 * Generic per-zone CPZ importer for London boroughs that publish their CPZ layer
 * through an ArcGIS Feature/Map Service (the Esri INSPIRE-style open-data
 * pattern most boroughs use instead of Socrata).
 *
 * Unlike Socrata, ArcGIS portals don't share a discovery API worth relying on,
 * so the registry entry points straight at the layer's REST URL
 * (…/FeatureServer/0 or …/MapServer/10). We query it as GeoJSON, snapshot the
 * result to raw/{borough}_cpz.geojson, fall back to that snapshot offline, and
 * skip cleanly (borough-level fallback still covers the borough) when neither is
 * available — exactly like the Socrata importer.
 *
 * Two borough schema shapes are absorbed:
 *  - Separate columns for the schedule (Hammersmith & Fulham: ZONE_, DAYS, TIME_)
 *    — `zoneField` names the code column and `hoursFields` the columns to join.
 *  - One combined string (Kingston: "CPZ Mon-Sat excl Bank Hols 8.30am-6.30pm
 *    Zone C - Canbury Gardens") — omit `zoneField`; the code and area name are
 *    parsed out of the joined `hoursFields` text.
 * Either way the control hours run through the shared parseScheduleText.
 */
const TOLERANCE = 0.0002; // ~20 m — zone polygons are much smaller than boroughs

const here = dirname(fileURLToPath(import.meta.url));

export interface ArcgisCpzSpec {
  idPrefix: string;
  namePrefix: string;
  src: string;
  ratePence: number;
  maxStayHours: number;
  hoursFields: string[];
  zoneField?: string;
  defaultSched: CpzHours[];
  eventStatusField?: string;
  eventStatusMatch?: RegExp;
  eventVenue?: string;
}

function specFor(entry: BoroughEntry): ArcgisCpzSpec | null {
  const portal = entry.portal;
  if (portal?.kind !== "arcgis" || !portal.cpz) return null;
  const cpz = portal.cpz;
  const defaultSched = entry.fallback?.sched ?? [
    { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
  ];
  return {
    idPrefix: entry.zoneIdPrefix,
    namePrefix: entry.displayName,
    src: entry.src,
    ratePence: cpz.ratePence,
    maxStayHours: cpz.maxStayHours,
    hoursFields: cpz.hoursFields,
    zoneField: cpz.zoneField,
    defaultSched,
    eventStatusField: cpz.eventStatusField,
    eventStatusMatch: cpz.eventStatusMatch,
    eventVenue: cpz.eventVenue,
  };
}

/** Remove noise the schedule parser can't read that sits between day and time. */
function cleanHoursText(text: string): string {
  return text
    .replace(/excl(?:uding)?\.?\s*bank\s*hol(?:iday|s|)\.?s?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Zone code from a combined string, e.g. "…Zone A/A1 - Kingston Town" -> "A/A1". */
function extractZoneCode(text: string): string | undefined {
  const m = /\bzone\s+([a-z0-9/]+)/i.exec(text);
  return m ? m[1] : undefined;
}

/** Descriptive area from a combined string, e.g. "Zone C - Canbury Gardens". */
function extractZoneArea(text: string): string | undefined {
  const m = /\bzone\s+[a-z0-9/]+\s*[-–]\s*(.+)$/i.exec(text);
  return m ? m[1].trim() : undefined;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Display label for a zone. Boroughs put different things in the zone column:
 * a bare code ("A", "A1", "A/A1", "2F") that reads better as "Zone A"; a label
 * that already says "Zone 2F" (Merton) which must not become "Zone Zone 2F";
 * or a place name ("Beckton", "Canning Town North" — Newham) that isn't a code
 * at all and shouldn't be dressed up as one.
 */
function zoneLabel(code: string, area?: string): string {
  const isCode = /^[a-z0-9/]{1,5}$/i.test(code) && !/^zone$/i.test(code);
  const head = isCode ? "Zone " + code : code;
  return area ? head + " " + area : head;
}

interface ZoneGroup {
  code: string;
  area?: string;
  hoursText: string;
  /** Raw value of the borough's event-status column, when it declares one. */
  eventStatus?: string;
  rings: number[][][];
}

/**
 * Group raw features into zones and assign each a stable id. Shared by the
 * zone and event transforms so an event record's `preciseZoneId` is guaranteed
 * to match the id the zone pass emits.
 */
function groupZones(
  fc: GeoFeatureCollection,
  spec: ArcgisCpzSpec,
): { id: string; group: ZoneGroup }[] {
  const groups = new Map<string, ZoneGroup>();
  for (const f of fc.features ?? []) {
    const props = f.properties;
    const rawText = spec.hoursFields
      .map((k) => String(props[k] ?? "").trim())
      .filter(Boolean)
      .join(" ");
    const code = spec.zoneField
      ? String(props[spec.zoneField] ?? "").trim()
      : extractZoneCode(rawText);
    if (!code) continue;
    const area = spec.zoneField ? undefined : extractZoneArea(rawText);
    const eventStatus = spec.eventStatusField
      ? String(props[spec.eventStatusField] ?? "").trim() || undefined
      : undefined;
    // Group so that distinct hour/area variants of a code stay separate
    // (Kingston Zone S central vs outer differ), but identical rows merge.
    const key = spec.zoneField ? code : rawText;
    const group =
      groups.get(key) ?? { code, area, hoursText: rawText, eventStatus, rings: [] };
    // One flagged row is enough to mark the whole zone.
    if (eventStatus && !group.eventStatus) group.eventStatus = eventStatus;
    for (const ring of outerRings(f)) group.rings.push(toLatLngRing(ring, TOLERANCE));
    groups.set(key, group);
  }

  const out: { id: string; group: ZoneGroup }[] = [];
  const usedIds = new Set<string>();
  for (const g of groups.values()) {
    if (!g.rings.length) continue;
    const base = spec.idPrefix + "-" + slug(g.code) + (g.area ? "-" + slug(g.area) : "");
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = base + "-" + n;
    usedIds.add(id);
    out.push({ id, group: g });
  }
  return out;
}

/** Pure transform: an ArcGIS CPZ FeatureCollection -> normalised zone records. */
export function transformArcgisCpz(
  fc: GeoFeatureCollection,
  checkedAt: string,
  spec: ArcgisCpzSpec,
): ZoneRecord[] {
  if (!fc.features?.length) return [];

  const zones: ZoneRecord[] = [];
  for (const { id, group: g } of groupZones(fc, spec)) {
    const parsed = parseScheduleText(cleanHoursText(g.hoursText));
    const label = zoneLabel(g.code, g.area);
    zones.push({
      id,
      name: spec.namePrefix + " " + label,
      kind: "cpz",
      // hours come straight from the council's own published layer
      verified: Boolean(parsed),
      src: spec.src,
      checkedAt,
      sched: parsed ?? spec.defaultSched,
      ratePence: spec.ratePence,
      maxStayHours: spec.maxStayHours,
      polys: g.rings,
    });
  }
  zones.sort((a, b) => a.id.localeCompare(b.id));
  return zones;
}

/**
 * Pure transform: event-day zone records for boroughs that flag them with a
 * status column. The layer publishes only the zone's *regular* hours, so the
 * event `sched` is empty — presence of the record is the signal the engine
 * needs, and `rawText` keeps the borough's own wording.
 */
export function transformArcgisEvents(
  fc: GeoFeatureCollection,
  checkedAt: string,
  spec: ArcgisCpzSpec,
): EventZoneRecord[] {
  if (!spec.eventStatusField || !spec.eventStatusMatch) return [];
  const match = spec.eventStatusMatch;
  const records: EventZoneRecord[] = [];
  for (const { id, group: g } of groupZones(fc, spec)) {
    if (!g.eventStatus || !match.test(g.eventStatus)) continue;
    const label = zoneLabel(g.code, g.area);
    records.push({
      zoneKey: id,
      name: label,
      borough: spec.namePrefix,
      // These zones keep everyday control too, so they stay in zones.precise.
      preciseZoneId: id,
      eventOnly: false,
      regularSched: parseScheduleText(cleanHoursText(g.hoursText)) ?? null,
      event: {
        venue: spec.eventVenue ?? null,
        // The status column states no hours — only that event days extend control.
        sched: [],
        bankHoliday: null,
        rawText:
          g.eventStatus +
          (spec.eventVenue ? " (" + spec.eventVenue + ")" : "") +
          " — extra controls apply on event days; hours published as " +
          JSON.stringify(g.hoursText) + " are the regular hours only",
      },
      rawOpTimes: g.hoursText,
      ratePence: spec.ratePence,
      maxStayHours: spec.maxStayHours,
      src: spec.src,
      checkedAt,
      polys: g.rings,
    });
  }
  records.sort((a, b) => a.zoneKey.localeCompare(b.zoneKey));
  return records;
}

function snapshotPath(entry: BoroughEntry): string {
  const base = entry.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return join(here, "..", "raw", base + "_cpz.geojson");
}

interface EsriResponse {
  features?: { attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }[];
}

/** Convert an ArcGIS esriJSON polygon response (WGS84) to a GeoJSON collection. */
function esriToFeatureCollection(esri: EsriResponse): GeoFeatureCollection {
  const features: GeoFeatureCollection["features"] = [];
  for (const f of esri.features ?? []) {
    const rings = f.geometry?.rings;
    if (!Array.isArray(rings) || !rings.length) continue;
    // Treat every ring as its own polygon outer ring (CPZ zones are solid, so
    // ignoring hole nesting is safe and outerRings() reads them all).
    features.push({
      type: "Feature",
      properties: f.attributes ?? {},
      geometry: { type: "MultiPolygon", coordinates: rings.map((r) => [r]) },
    });
  }
  return { type: "FeatureCollection", features };
}

async function fetchLive(entry: BoroughEntry): Promise<GeoFeatureCollection> {
  const portal = entry.portal as ArcgisPortal;
  const cpz = portal.cpz!;
  const label = entry.zoneIdPrefix;
  const fields = [cpz.zoneField, ...cpz.hoursFields, cpz.eventStatusField]
    .filter(Boolean)
    .join(",");
  const base = cpz.layerUrl.replace(/\/+$/, "") + "/query";
  const enc = encodeURIComponent(fields);

  // 1. GeoJSON — hosted ArcGIS Online FeatureServers serve this directly.
  try {
    const url = base + "?where=1%3D1&outFields=" + enc + "&f=geojson";
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (r.ok) {
      const fc = (await r.json()) as GeoFeatureCollection;
      const polygonal = fc.features?.filter((f) => f.geometry && /Polygon/i.test(f.geometry.type));
      if (polygonal?.length) {
        console.log("[" + label + "] arcgis layer returned " + polygonal.length + " polygon features (geojson)");
        return { type: "FeatureCollection", features: polygonal };
      }
    }
  } catch {
    /* fall through to esriJSON */
  }

  // 2. esriJSON — older / self-hosted MapServers don't offer f=geojson. Ask for
  // WGS84 (outSR=4326) so no reprojection is needed, and convert the rings.
  const url = base + "?where=1%3D1&outFields=" + enc + "&returnGeometry=true&outSR=4326&f=json";
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const fc = esriToFeatureCollection((await r.json()) as EsriResponse);
  if (!fc.features.length) throw new Error("no polygon features returned");
  console.log("[" + label + "] arcgis layer returned " + fc.features.length + " polygon features (esriJSON)");
  return fc;
}

/**
 * Per-zone CPZs for one ArcGIS borough, or null when the layer is unreachable
 * and no snapshot exists (the caller keeps any previously-committed rows).
 */
export async function loadArcgisCpz(entry: BoroughEntry): Promise<ZoneRecord[] | null> {
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
      console.log("[" + label + "] SKIPPED — ArcGIS layer unreachable and no snapshot yet (" + String(e) + ")");
      return null;
    }
  }
  const zones = transformArcgisCpz(fc, new Date().toISOString().slice(0, 10), spec);
  console.log("[" + label + "] " + zones.length + " per-zone CPZs (arcgis)");
  return zones;
}

/**
 * Event-day zones for one ArcGIS borough, read from the snapshot the precise
 * pass just wrote (same pattern as loadIshareEvents). Null when the borough
 * declares no event-status column or has no snapshot yet.
 */
export function loadArcgisEvents(entry: BoroughEntry): EventZoneRecord[] | null {
  const spec = specFor(entry);
  if (!spec?.eventStatusField) return null;
  const snapshot = snapshotPath(entry);
  if (!existsSync(snapshot)) return null;
  const fc = JSON.parse(readFileSync(snapshot, "utf8")) as GeoFeatureCollection;
  const events = transformArcgisEvents(fc, new Date().toISOString().slice(0, 10), spec);
  console.log("[" + entry.zoneIdPrefix + "] " + events.length + " event-day zones captured (arcgis)");
  return events;
}
