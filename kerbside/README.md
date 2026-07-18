# Kerbside — London parking finder

Enter a destination (postcode or place) and an arrive/leave window; Kerbside evaluates
Controlled Parking Zones, paid bays, car parks, resident bays, single yellows and free
streets around it, then ranks them with badges: **Best Overall**, **Best Free**,
**Closest**, **Cheapest Paid**.

## Layout

- `packages/engine/` — the ranking engine as pure, strictly-typed TypeScript
  (`evaluate(dest, start, end, dataset)`), plus the demo dataset. Money is integer
  pence internally; all time logic runs in Europe/London local time. Vitest covers the
  7 SPEC §6 scenarios and the cost-model edge cases.
- `web/` — Vite + React + TypeScript + Leaflet app: glass landing overlay
  ("Park here and now" / address + date + time form), full-bleed map with zone
  polygons, ranked results with badges, Google Maps deep links, postcodes.io
  geocoding with offline district fallback. It's an installable PWA (see below).
- `prototype/index.html` — the original single-file prototype, kept untouched as the
  behavioural reference.
- `data/` — ETL (`npm run etl`) with per-source adapters in `data/sources/`:
  real London borough boundaries (snapshot committed in `data/raw/`) and
  per-zone Camden CPZs from the borough's open-data portal (dataset discovered
  via the Socrata catalogue; free-text controlled hours parsed by
  `data/schedule.ts`). Sources snapshot on success, use the snapshot offline,
  and are skipped cleanly when neither is available. Output goes to
  `packages/engine/src/data/zones.{precise,boroughs}.json`.
- `docs/` — product/engine spec (`SPEC.md`) and the real-data plan (`DATA_PIPELINE.md`).
- `CLAUDE.md` — project context and conventions for future work.

## Commands

From this directory (npm workspaces):

```sh
npm install
npm test          # engine unit tests — must pass before any commit
npm run dev       # run the web app (Vite dev server)
npm run build     # typecheck + production build
npm run typecheck # engine + web
```

## Installing on a phone or computer

The web app is a Progressive Web App: responsive for phones and desktops, and
installable ("downloadable") from any Chromium browser or iOS Safari when served
over HTTPS (or localhost):

- **Android / Chrome / Edge / desktop Chrome:** use the "Install Kerbside on this
  device" button on the landing card, or the install icon in the address bar.
- **iPhone / iPad (Safari):** Share → "Add to Home Screen".

Once installed it opens standalone (no browser chrome), keeps the app shell and
recently viewed map tiles available offline, and auto-updates when a new version
is deployed. To self-host, serve the static `web/dist/` output (from
`npm run build`) over HTTPS — no server-side code is required.

## Data status

Four data tiers, most precise first (`zoneAt` returns the first match):

1. **Imported per-zone CPZs** (`zones.precise.json`) — real zone polygons from
   borough open-data portals (Camden wired up; more sources slot into
   `data/sources/`). Hours use our verified table where we have one, else the
   portal's own hours text parsed by `data/schedule.ts`, else the borough
   default — only the first is marked *verified*. Empty until `npm run etl`
   has run with portal access.
2. **Curated zones** — 13 hand-drawn CPZs; hours for Islington Zone B, Camden
   CA-F(n)/CA-D/CA-U and Westminster E/F/G & A/D follow the borough websites
   (checked July 2026, linked from each zone's map popup).
3. **Borough fallbacks** — real boundary polygons for 11 inner-London boroughs
   with (nearly) borough-wide CPZ coverage, carrying each borough's most common
   hours. Always labelled *indicative*.
4. **Everywhere else** — treated as uncontrolled, with an explicit "check
   signage" caveat.

Next: more per-zone sources (Islington, Westminster), parsed tariff tables, and
kerb-level bay data — see `docs/DATA_PIPELINE.md`.
