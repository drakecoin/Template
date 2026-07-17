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
- `web/` — Vite + React + TypeScript + Leaflet app, a 1:1 port of the prototype UI
  (design tokens, collapsible panel, bottom-sheet results, zone polygons, Google Maps
  deep links, postcodes.io geocoding with offline district fallback).
- `prototype/index.html` — the original single-file prototype, kept untouched as the
  behavioural reference.
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

## Data status

Zone hours for Islington Zone B, Camden CA-F(n)/CA-D/CA-U and Westminster E/F/G & A/D
follow the borough websites (checked July 2026, linked from each zone's map popup).
All other zones, tariffs and bay positions are indicative demo data — the UI labels
them as such, and replacing them with real borough GeoJSON is the next milestone
(see `docs/DATA_PIPELINE.md`).
