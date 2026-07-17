# Kerbside — London Parking Finder

## What this is
A parking-finder app for London. User enters a destination (postcode or place) and an
arrive/leave time window; the app evaluates Controlled Parking Zones (CPZs), paid bays,
car parks, resident bays, single yellows and free streets, then ranks them with badges:
Best Overall, Best Free, Closest, Cheapest Paid.

A fully working single-file prototype lives at `prototype/index.html` (vanilla JS +
Leaflet + OSM tiles). **It is the source of truth for product behaviour and the ranking
engine.** Read it before writing anything.

## Current state
- Prototype is complete and tested: search (postcode via postcodes.io with offline
  district fallback, plus curated places), time presets, CPZ time-overlap engine,
  cost model, badge ranking, map with zone polygons, Google Maps deep links,
  collapsible panel / bottom-sheet layout.
- Zone hours for Islington (Zone B Angel), Camden (CA-F(n), CA-D, CA-U) and
  Westminster (E/F/G, A/D) were verified against borough websites (July 2026).
  Other zones + all tariffs/bay positions are indicative demo data.
- Zone *boundaries* are hand-drawn polygons — replacing them with real borough
  GeoJSON is the top priority (see docs/DATA_PIPELINE.md).

## Target architecture (proposed — challenge if you disagree)
- `web/` — Vite + React + TypeScript + Leaflet (react-leaflet). Port the prototype UI.
- `api/` — small Node (Fastify) or serverless API: `/parking/search?lat&lng&from&to`
  returns evaluated, ranked options. Engine logic ported from the prototype verbatim
  first, then extended.
- `data/` — ETL scripts that ingest borough CPZ GeoJSON + tariff tables into a single
  normalised `zones.json` / PostGIS. See docs/DATA_PIPELINE.md for sources.
- Keep the engine pure and unit-tested: `evaluate(dest, start, end, dataset)`.

## Engine rules to preserve (tested behaviours)
1. CPZ overlap is computed per calendar day against `sched[]` entries
   `{days:[0=Sun..6=Sat], from:"HH:MM", to:"HH:MM"}`; multiple entries per zone
   (e.g. Islington: Mon–Fri 08:30–18:30 AND Sat 08:30–13:30).
2. Paid bays: charge rate × controlled-overlap hours only; free outside zone hours;
   invalid if overlap exceeds zone `maxStay`.
3. Resident bays & single yellows: valid only when controlled overlap is zero.
4. Car parks: hourly rate with 24h day-max cap; evening flat rate applies only when
   the stay starts 18:00–07:00 and ends by 08:00 next morning.
5. Score = cost + walkMinutes × 0.35 (£/min walk penalty). Badges assigned after
   sorting valid options. Invalid options are shown greyed-out with a human reason.
6. Never present a resident-only or restricted option as parkable during controlled
   hours — a wrong answer here means a £130 PCN for the user.

## Conventions
- TypeScript strict. No `any` in the engine.
- Unit tests for the engine are mandatory for every change (Vitest). Port the five
  scenario tests described in docs/SPEC.md §6 first.
- Money in integer pence internally; format at the edges.
- Times: all engine logic in Europe/London local time; beware DST when porting.
- UI: keep the existing design system (tokens in the prototype's `:root`) — bright
  "signage" aesthetic, P-blue #1D6FEB, signal yellow #FFCF33, ink #101A33.
- Data provenance: every zone record carries `src` (borough URL) and `verified`
  (bool + date). Show "indicative" labelling in the UI for unverified data.

## Commands (once scaffolded)
- `npm run dev` in `web/` — run the app
- `npm test` — engine unit tests (must pass before any commit)
- `npm run etl` in `data/` — rebuild zones.json from borough sources

## Suggested first tasks (in order)
1. Scaffold `web/` (Vite React TS), port prototype 1:1, keep `prototype/index.html`
   untouched as reference.
2. Extract the engine into `packages/engine` with Vitest tests (SPEC §6 scenarios).
3. Build `data/` ETL for Camden + Islington GeoJSON (docs/DATA_PIPELINE.md).
4. Swap hand-drawn polygons for real boundaries; point-in-polygon zone lookup for
   any searched destination (currently bays are hard-linked to zones by id).
5. Live car-park availability/pricing via an aggregator API (Parkopedia/AppyParking)
   behind a provider interface.
