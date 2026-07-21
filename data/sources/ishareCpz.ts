import { TIER } from "@kerbside/engine";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { osgb36ToWgs84, simplify } from "../geo.js";
import type { BoroughEntry, IsharePortal } from "../registry.js";
import type { SchedEntry } from "@kerbside/engine";
import { parseScheduleText } from "../schedule.js";
import type { ZoneRecord } from "./boroughs.js";
import { baseControlText, normaliseHours, slug } from "./cpzText.js";
import { parseEventControl, type EventControl } from "./eventControl.js";

/**
 * Per-zone CPZ importer for boroughs whose map is an Astun **iShare** site
 * (OpenLayers + a MapServer WFS behind getows.ashx). Haringey is the first;
 * the same shape covers many other London boroughs.
 *
 * iShare quirks handled here:
 *  - The WFS only serves its native British National Grid SRS (EPSG:27700), so
 *    every coordinate is reprojected to WGS84 via geo.osgb36ToWgs84.
 *  - Output is GML 3.1.1 (geojson isn't a permitted format), parsed with
 *    regexes tuned to MapServer's stable element layout.
 *  - Control hours live in a free-text attribute (`op_times`). Only the regular
 *    (non-event) hours are imported: Tottenham-stadium "event day" clauses are
 *    stripped, and zones that ONLY control on event days are skipped rather than
 *    presented as always-controlled (a wrong £130-PCN answer — see CLAUDE.md §7).
 */
const TOLERANCE = 0.0002; // ~20 m

const here = dirname(fileURLToPath(import.meta.url));

export interface IshareCpzSpec {
  idPrefix: string;
  namePrefix: string;
  src: string;
  ratePence: number;
  maxStayHours: number;
  nameField: string;
  hoursField: string;
}

function specFor(entry: BoroughEntry): IshareCpzSpec | null {
  if (entry.portal?.kind !== "ishare" || !entry.portal.cpz) return null;
  const cpz = entry.portal.cpz;
  return {
    idPrefix: entry.zoneIdPrefix,
    namePrefix: entry.displayName,
    src: entry.src,
    ratePence: cpz.ratePence,
    maxStayHours: cpz.maxStayHours,
    nameField: cpz.nameField,
    hoursField: cpz.hoursField,
  };
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

// Re-exported for tests and callers that used to import it from here.
export { baseControlText } from "./cpzText.js";

interface ZoneGroup {
  name: string;
  hoursText: string;
  rings: number[][][];
}

/** Parse a GML posList ("E N E N …") into a reprojected, simplified [lat,lng] ring. */
function ringFromPosList(posList: string): number[][] {
  const nums = posList.trim().split(/\s+/).map(Number);
  const lngLat: number[][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    lngLat.push(osgb36ToWgs84(nums[i], nums[i + 1]));
  }
  return simplify(lngLat, TOLERANCE).map(([lng, lat]) => [
    Math.round(lat * 1e5) / 1e5,
    Math.round(lng * 1e5) / 1e5,
  ]);
}

/** Group a WFS GML document into one entry per named zone (geometry merged). */
function parseZoneGroups(gml: string, spec: IshareCpzSpec): ZoneGroup[] {
  const nameRe = new RegExp("<ms:" + spec.nameField + ">([^<]*)</ms:" + spec.nameField + ">");
  const hoursRe = new RegExp("<ms:" + spec.hoursField + ">([\\s\\S]*?)</ms:" + spec.hoursField + ">");
  const members = gml.match(/<gml:featureMember>[\s\S]*?<\/gml:featureMember>/g) ?? [];

  const groups = new Map<string, ZoneGroup>();
  for (const member of members) {
    const name = unescapeXml((nameRe.exec(member)?.[1] ?? "").trim());
    if (!name) continue;
    const hoursText = unescapeXml((hoursRe.exec(member)?.[1] ?? "").trim());
    const group = groups.get(name) ?? { name, hoursText, rings: [] };
    for (const pl of member.match(/<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>/g) ?? []) {
      const coords = pl.replace(/<[^>]+>/g, "");
      const ring = ringFromPosList(coords);
      if (ring.length >= 4) group.rings.push(ring);
    }
    groups.set(name, group);
  }
  return [...groups.values()];
}

/** A zone is event-day-only when its name says so or it has no everyday hours. */
function isEventOnly(g: ZoneGroup): boolean {
  return /\bevent day/i.test(g.name) || baseControlText(g.hoursText) === "";
}

/** Pure transform: an iShare WFS GML document -> normalised zone records. */
export function transformIshareCpz(
  gml: string,
  checkedAt: string,
  spec: IshareCpzSpec,
): ZoneRecord[] {
  const zones: ZoneRecord[] = [];
  for (const g of parseZoneGroups(gml, spec)) {
    if (!g.rings.length) continue;
    // Event-day-only zones impose NO everyday restriction — their control only
    // applies on unpredictable stadium event days, which the engine can't model,
    // so they must not be shown as always-controlled (their rules are captured
    // separately in zones.events.json — see transformIshareEvents).
    if (isEventOnly(g)) {
      console.log("[" + spec.idPrefix + "] skipped event-day-only zone: " + g.name);
      continue;
    }
    const parsed = parseScheduleText(normaliseHours(baseControlText(g.hoursText)));
    zones.push({
      id: spec.idPrefix + "-" + slug(g.name),
      name: spec.namePrefix + " " + g.name,
      kind: "cpz",
      verified: Boolean(parsed),
      tier: parsed ? TIER.COUNCIL : TIER.ESTIMATE,
      src: spec.src,
      checkedAt,
      sched: parsed ?? [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
      ratePence: spec.ratePence,
      maxStayHours: spec.maxStayHours,
      polys: g.rings,
    });
  }
  zones.sort((a, b) => a.id.localeCompare(b.id));
  return zones;
}

/**
 * Event-day CPZ record: a zone whose control changes (or only exists) on nearby
 * venue event days. Captured for a FUTURE match-day feature — the engine does
 * not consume zones.events.json yet. `rawOpTimes` is authoritative; the parsed
 * `event`/`regularSched` fields are best-effort (see docs/EVENT_DAYS.md).
 */
export interface EventZoneRecord {
  zoneKey: string;
  name: string;
  borough: string;
  /** Matching id in zones.precise.json when the zone also has everyday control. */
  preciseZoneId: string | null;
  eventOnly: boolean;
  regularSched: SchedEntry[] | null;
  event: EventControl;
  rawOpTimes: string;
  ratePence: number;
  maxStayHours: number;
  src: string;
  checkedAt: string;
  polys: number[][][];
}

/** Pure transform: an iShare WFS GML document -> event-day zone records. */
export function transformIshareEvents(
  gml: string,
  checkedAt: string,
  spec: IshareCpzSpec,
): EventZoneRecord[] {
  const records: EventZoneRecord[] = [];
  for (const g of parseZoneGroups(gml, spec)) {
    if (!g.rings.length) continue;
    const eventOnly = isEventOnly(g);
    const event = parseEventControl(g.hoursText, eventOnly);
    if (!event) continue; // no event-day component — nothing to capture here
    const base = eventOnly ? "" : baseControlText(g.hoursText);
    const zoneKey = spec.idPrefix + "-" + slug(g.name);
    records.push({
      zoneKey,
      name: g.name,
      borough: spec.namePrefix,
      preciseZoneId: base ? zoneKey : null,
      eventOnly,
      regularSched: base ? (parseScheduleText(normaliseHours(base)) ?? null) : null,
      event,
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
  const b = entry.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return join(here, "..", "raw", b + "_cpz.gml");
}

async function fetchLive(entry: BoroughEntry): Promise<string> {
  const portal = entry.portal as IsharePortal;
  const cpz = portal.cpz!;
  const base = cpz.baseUrl.replace(/\/+$/, "");
  const url =
    base +
    "/getows.ashx?mapsource=" +
    encodeURIComponent(cpz.mapsource) +
    "&service=WFS&version=1.1.0&request=GetFeature&typename=" +
    encodeURIComponent(cpz.typename);
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const text = await r.text();
  if (!/<gml:featureMember>/.test(text)) throw new Error("no featureMembers in WFS response");
  return text;
}

/**
 * Fetch the borough's WFS GML (live, snapshotting to raw/), falling back to the
 * committed snapshot offline, or null when neither is available.
 */
async function loadGml(entry: BoroughEntry): Promise<string | null> {
  const label = entry.zoneIdPrefix;
  const snapshot = snapshotPath(entry);
  try {
    const gml = await fetchLive(entry);
    writeFileSync(snapshot, gml);
    console.log("[" + label + "] iShare WFS fetched, snapshot updated");
    return gml;
  } catch (e) {
    if (existsSync(snapshot)) {
      console.log("[" + label + "] live fetch failed (" + String(e) + ") — using committed snapshot");
      return readFileSync(snapshot, "utf8");
    }
    console.log("[" + label + "] SKIPPED — iShare WFS unreachable and no snapshot yet (" + String(e) + ")");
    return null;
  }
}

/**
 * Per-zone CPZs for one iShare borough, or null when the WFS is unreachable and
 * no snapshot exists (the caller keeps any previously-committed rows).
 */
export async function loadIshareCpz(entry: BoroughEntry): Promise<ZoneRecord[] | null> {
  const spec = specFor(entry);
  if (!spec) return null;
  const gml = await loadGml(entry);
  if (gml === null) return null;
  const zones = transformIshareCpz(gml, new Date().toISOString().slice(0, 10), spec);
  console.log("[" + entry.zoneIdPrefix + "] " + zones.length + " per-zone CPZs (ishare)");
  return zones;
}

/**
 * Event-day CPZ records for one iShare borough (for the future match-day
 * feature; not consumed by the engine yet), or null when no snapshot exists.
 * Reads the snapshot loadIshareCpz writes — call loadIshareCpz first in the same
 * ETL pass so this reuses it rather than re-fetching the WFS.
 */
export function loadIshareEvents(entry: BoroughEntry): EventZoneRecord[] | null {
  const spec = specFor(entry);
  if (!spec) return null;
  const snapshot = snapshotPath(entry);
  if (!existsSync(snapshot)) return null;
  const gml = readFileSync(snapshot, "utf8");
  const events = transformIshareEvents(gml, new Date().toISOString().slice(0, 10), spec);
  console.log("[" + entry.zoneIdPrefix + "] " + events.length + " event-day zones captured (ishare)");
  return events;
}
