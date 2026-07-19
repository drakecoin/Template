# Park Up — London Parking Finder

## What this is
A parking-finder web app for London (formerly "Kerbside" — the brand is **Park Up**;
internal npm package names still use the `kerbside` prefix). User enters a destination
(postcode or place) and an arrive/leave time window; the app evaluates Controlled
Parking Zones (CPZs), paid bays, car parks, resident bays, single yellows, free
streets, and no-stopping/no-loading areas, then ranks the parkable ones with badges:
Best Overall, Best Free, Closest, Cheapest Paid.

## Current state
- Live: deployed on **Netlify**, git-based auto-deploy from the **`main`** branch of
  `github.com/drakecoin/Template` (config in root `netlify.toml`; no `base` — the repo
  IS the app). Fully client-side; no backend.
- The app is a repo-root npm-workspaces monorepo (`packages/engine`, `web`, `data`).
- First screen is a map-forward splash (clear map, "Park Up", "Type an address",
  hero P location-pin, "Park here and now").
- Real Camden per-zone CPZ boundaries + hours import from the borough's open-data
  portal (Socrata); other boroughs use real-boundary borough-level fallbacks. Hours
  for Islington Zone B, Camden CA-F(n)/CA-D/CA-U and Westminster E/F/G & A/D were
  verified against borough sites (July 2026). Tariffs/bay positions elsewhere are
  indicative and labelled as such.
- "Update me" flow: users photograph a street sign; EXIF GPS (or device location, or
  manual) + a thumbnail are logged to localStorage as a dated report. Results show a
  per-zone "Last updated" date.
- Data expansion plan (all London) is in `docs/DATA_PIPELINE.md`; next source is
  **Mapillary** detected traffic signs (do NOT scrape Google Street View — ToS).

## Architecture
- `web/` — Vite + React + TypeScript + Leaflet. Port target for all UI.
- `packages/engine/` — pure, strictly-typed ranking engine
  (`evaluate(dest, start, end, dataset)`), consumed by `web` directly from TS source.
- `data/` — ETL that ingests borough CPZ GeoJSON + hours into normalised
  `packages/engine/src/data/zones.{precise,boroughs}.json`. Adapters in
  `data/sources/`.

## Engine rules to preserve (tested behaviours)
1. CPZ overlap is computed per calendar day against `sched[]` entries
   `{days:[0=Sun..6=Sat], from:"HH:MM", to:"HH:MM"}`; multiple entries per zone
   (e.g. Islington: Mon–Fri 08:30–18:30 AND Sat 08:30–13:30).
2. Paid bays: charge rate × controlled-overlap hours only; free outside zone hours;
   invalid if overlap exceeds zone `maxStay`.
3. Resident bays & single yellows: valid only when controlled overlap is zero.
4. Car parks: hourly rate with 24h day-max cap; evening flat rate applies only when
   the stay starts 18:00–07:00 and ends by 08:00 next morning.
5. No-stopping (`noStop`, red routes) is never parkable. No-loading (`noLoad`) is an
   advisory, never a ranked bay: its note is time-aware against the posted ban hours.
6. Score = cost + walkMinutes × 0.35 (£/min walk penalty). Badges assigned after
   sorting valid options; restriction areas never receive badges. Invalid options are
   shown greyed-out with a human reason.
7. Never present a resident-only or restricted option as parkable during controlled
   hours — a wrong answer here means a £130 PCN for the user.

## Conventions
- TypeScript strict. No `any` in the engine.
- Unit tests for the engine are mandatory for every change (Vitest); keep the SPEC §6
  scenarios (`docs/SPEC.md`) passing.
- Money in integer pence internally; format at the edges.
- Times: all engine logic in Europe/London local time; beware DST.
- UI design system tokens live in `web/src/styles.css` `:root` — bright "signage"
  aesthetic: P-blue #1D6FEB, ink #0E1526, serif accents (`--serif`) for the brand.
- Data provenance: every zone record carries `src`, `verified`, `checkedAt`. The UI
  labels unverified data "indicative".

## Commands
- `npm run dev` — run the web app (Vite)
- `npm test` — engine + data unit tests (must pass before any commit)
- `npm run build` — typecheck + production build (output `web/dist`)
- `npm run etl` — rebuild zone data from borough sources (in `data/`)

## Next tasks (see docs/DATA_PIPELINE.md)
1. Mapillary detected-sign importer → dated restriction/hours signals (done).
2. Config-driven borough registry (`data/registry.ts`) — all 33 boroughs slot in
   declaratively: a `fallback` CPZ (real boundary + indicative hours) and an
   optional Socrata `portal` (CPZ + bays). Generic loaders (`sources/socrataCpz`,
   `sources/socrataBays`) loop over it; ETL aggregates per-borough with
   keep-on-skip. Adding all 33 fallbacks unlocked Mapillary parking signs 15→172.
   Outer-borough hours are indicative placeholders (flagged unverified) — replace
   with per-zone portal data as boroughs are wired up. (done)
3. TfL red routes → pan-London `noStop` (done). `data/sources/tflRedRoutes.ts`
   imports the arterial no-stopping network from OSM `no_stopping` tagging via
   Overpass, samples points along each way, and writes `spots.redroutes.json`
   (~628 points / 349 roads). Loaded by engine `importedRedRoutes.ts` into
   `ALL_SPOTS`; the old hand-seeded red-route points in `data.ts` were removed.
4. ArcGIS Feature/Map Service CPZ import alongside Socrata (done).
   `data/sources/arcgisCpz.ts` + a `kind:"arcgis"` portal in the registry point
   straight at a layer REST URL (…/FeatureServer/0 or …/MapServer/10), query it
   as GeoJSON, and parse control hours via the shared schedule parser. Wired:
   Kingston (RB Kingston INSPIRE CPZ, combined `TimeOfOperation` string → 28
   verified zones) and Hammersmith & Fulham (LBHF INSPIRE CPZ, separate
   ZONE_/DAYS/TIME_ columns → 31 verified zones).
5. Astun **iShare** WFS CPZ import (done). `data/sources/ishareCpz.ts` +
   a `kind:"ishare"` portal fetch a borough's MapServer WFS (GML, native British
   National Grid), reproject EPSG:27700→WGS84 via `geo.osgb36ToWgs84`, and parse
   the free-text `op_times` control hours. **Haringey** wired (my.haringey.gov.uk
   iShare, `Controlled_Parking_Zones` layer → 43 verified per-zone CPZs). Only
   the regular (non-event) hours drive the engine: Tottenham-stadium "event day"
   clauses are stripped and event-day-only zones skipped (never present a zone as
   always-controlled when it isn't — §7). `zones.precise.json` now carries
   Camden + Kingston + H&F + Haringey (151 zones).
6. Event-day CPZ rules captured for a FUTURE match-day feature (done, data only —
   no connector). `transformIshareEvents` writes `zones.events.json` (15 Haringey
   zones: venue, event-day `sched`, `bankHoliday` window, `regularSched`, lossless
   `rawOpTimes`, polygons). The engine does NOT consume it yet. Plan + record
   shape in `docs/EVENT_DAYS.md`; parser in `data/sources/eventControl.ts`.
7. Wire more borough portals; parsed tariff tables (COST columns); kerb-level
   bay data beyond Camden; build the match-day feed + engine hook (docs/EVENT_DAYS.md).
