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
8. **A zone polygon is an area fact, never a kerb fact.** Zone membership says the
   area is controlled and when; it never says a bay exists on a given street. Only
   a real bay record (`spots.bays.json`, OSM) may be typed `paid` and priced.
   Kerbside known only from a polygon is `cpzStreet` — an advisory, unranked and
   unpriced while the zone is active (we can't tell payable bay from resident-only).
9. **Area-wide hours can't clear a specific kerb.** `zoneHoursTrusted(z)`
   (`verified && kind !== "borough"`) gates any claim that a restriction is OFF.
   A resident bay or single yellow governed by an indicative borough-wide schedule
   is invalid, not "open to everyone" — the guess may be narrower than reality.
   Paid bays keep their price but carry an explicit estimate warning.
10. A CPZ that is *not* controlled during the window is ordinary free kerbside and
   often the best answer, but has no curated spots — `offZoneStreetSpots` synthesises
   the closest point inside each such zone (`nearestPointInZone`, nudged 20 m inside
   the boundary). Verified per-zone CPZs only; skipped if the point resolves into a
   controlled zone or sits within 40 m of a red-route `noStop` point.
11. Any on-street bay whose governing zone is missing from the dataset is invalid —
   unknown hours must never render as free.
12. **Zero controlled overlap means "off on regular hours", not "off today".** The
   ETL strips event-day clauses out of zone `sched`, so `zones.events.json`
   (`EVENT_CONTROLS`, on `Dataset.events`) carries the stripped knowledge back.
   `evaluate` applies the guard in ONE pass after the type branches — every path
   that clears a restriction is covered. An option with un-charged time in a zone
   that has event controls gets `eventRisk` + a warning naming the venue, and is
   excluded from badges when free: no green "Recommended" on a kerb that may be
   controlled. `offZoneStreetSpots` ranks unconditional zones ahead of these.
   Resolving event risk properly needs a fixture feed (docs/EVENT_DAYS.md).
13. `nearestPointInZone` returns undefined for a zone with no rings. The curated
   `ZONES` carry hours but no geometry; answering `pt` for them claimed the zone
   reached wherever the user stood, offering Islington streets to Tottenham.
14. **A Mapillary sign detection is a sign class + position, never the plate.**
   It can't read pay-vs-permit, hours or tariff, so a parking-place sign is a
   `cpzStreet` observation (non-virtual), NOT a priced `paid` bay — governed by
   its containing zone's hours, greyed during control, free-with-caveat when off.
   `assignBadges` excludes non-virtual `cpzStreet` from every badge: a detected
   sign marks that regulated parking exists, not that a usable free bay is
   confirmed, so it must never out-rank the destination or a real bay record.

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
   ZONE_/DAYS/TIME_ columns → 31 verified zones), plus Lambeth (20), Harrow (74),
   **Merton** (`Zone_Label` + `Operation_Summary` → 72) and **Newham**
   (`NAME` + `TIMES` → 30, incl. 5 London Stadium event zones).
   `zoneLabel()` decides whether the zone column holds a code ("A", "2F" →
   "Zone A"), an already-prefixed label (Merton "Zone 2F") or a place name
   (Newham "Canning Town") — don't reintroduce a blanket "Zone " prefix.
5. Astun **iShare** WFS CPZ import (done). `data/sources/ishareCpz.ts` +
   a `kind:"ishare"` portal fetch a borough's MapServer WFS (GML, native British
   National Grid), reproject EPSG:27700→WGS84 via `geo.osgb36ToWgs84`, and parse
   the free-text `op_times` control hours. **Haringey** wired (my.haringey.gov.uk
   iShare, `Controlled_Parking_Zones` layer → 43 verified per-zone CPZs). Only
   the regular (non-event) hours drive the engine: Tottenham-stadium "event day"
   clauses are stripped and event-day-only zones skipped (never present a zone as
   always-controlled when it isn't — §7). `zones.precise.json` carries **347
   zones across 8 boroughs**: Harrow 74, Merton 72, Camden 49, Haringey 43,
   H&F 31, Newham 30, Kingston 28, Lambeth 20. The other 25 boroughs still fall
   back to borough-level indicative hours, which rule 9 refuses to use for
   clearing a restriction — so widening this list directly widens rule 10.
6. Event-day CPZ rules captured for a FUTURE match-day feature (done, data only —
   no connector). `transformIshareEvents` writes `zones.events.json` (15 Haringey
   zones: venue, event-day `sched`, `bankHoliday` window, `regularSched`, lossless
   `rawOpTimes`, polygons). Plan + record shape in `docs/EVENT_DAYS.md`; parser in
   `data/sources/eventControl.ts`. **The engine now consumes this** — see rule 12.
   ArcGIS boroughs that flag event zones with a status column instead of hours
   text (Newham `CPZ_Status`) declare `eventStatusField`/`eventStatusMatch`/
   `eventVenue` in the registry; `transformArcgisEvents` emits matching records
   whose `preciseZoneId` is guaranteed to equal the zone pass's id (both go
   through the shared `groupZones`). 20 event zones: 15 Haringey + 5 Newham.
7. Kerb-level bays beyond Camden — **blocked by data availability, not code**
   (researched July 2026, see docs/DATA_PIPELINE.md "Bay-data findings"):
   Camden is the only London borough publishing bay-level open data (nothing on
   ArcGIS Online, nothing else on Socrata). OSM kerb tagging: 5,897 inner-London
   ways but only ~136 carry a usable restriction — the rest record that parking
   exists without the restriction, and are correctly dropped inside CPZs (a bare
   "parking exists" inside a CPZ is not evidence of free parking). OSM
   `amenity=parking` car parks are well-mapped (~900 ways central) but carry no
   tariff (`charge` ≈ 0%), so they can't be priced without an operator feed.
8. The credible path to bay attributes at scale: Mapillary street-level IMAGERY
   + a vision model reading the text plate under each detected P-sign (licence
   permits it; Google Street View does not). Proposed as a spike first: pull
   images near known detections, crop, read plate, parse via `parseScheduleText`;
   measure accuracy before committing. Output must ship indicative and must not
   clear restrictions (rule 9) — a misread plate is a £130 PCN. Position it as
   "sign says…" evidence feeding the "Update me" loop, not authoritative bays.
9. **RBKC wired** (July 2026) from the council's own ArcGIS server, layer
   `RBKC/INSPIRE/MapServer/13` "Residents Parking Control" -> 9 verified zones,
   `zones.precise.json` now **356 zones across 9 boroughs**. Two mechanisms were
   added for it and are reusable:
   - `hoursPerField` — parse each hours column separately and concatenate.
     RBKC puts one whole clause per column (Control_1 weekdays, Control_2 Sat,
     Control_3 Sun); space-joining them first makes `parseScheduleText` pair a
     later clause's end time with an earlier clause's days and emit a phantom
     window. Joining stays the default (H&F splits ONE clause across columns).
   - `areaField` — a second column to disambiguate a zone code that repeats
     across areas (RBKC "Control 1" covers three named areas). Remember to add
     any new field to the `outFields` list in `fetchLive`, or it comes back
     empty and the zones silently merge.
   RBKC states event rules inside the hours text ("(on event days)", "on
   special occasions") rather than in a status column, so `isEventConditional`
   (cpzText) drops those clauses from regular hours and `transformClauseEvents`
   captures them — 22 event zones now (15 Haringey, 5 Newham, 2 RBKC).
10. `PRECISE_BOROUGHS` (engine `data.ts`) derives the boroughs the UI may call
   council-sourced from zones `zoneHoursTrusted` accepts, using the borough
   names the ETL writes to `boroughs.names.json`. It replaced a hardcoded
   sentence in `ResultsSheet` that had gone stale and was telling users
   estimated hours came from the council. Don't hand-edit that list again.
11. **Tower Hamlets wired** (July 2026): `Parking_Permit_Mini_Zones_view`
   FeatureServer/159, 16 mini zones. The layer has geometry + `ZONE_CODE` and
   **no hours**, so `verifiedHours` (previously Socrata-only, for Camden) now
   exists on the ArcGIS portal too and carries hours transcribed from the
   council's published table. `zones.precise.json` = **372 zones across 10
   boroughs**. Two safety decisions to preserve:
   - A6/B3/C2 are split by street inside a single polygon with different hours
     per side, and the layer can't distinguish them. Each takes the **union** of
     both patterns — deliberately over-stating control, because rule 7 makes
     "free when actually controlled" the expensive direction.
   - B4's Sunday control applies **only on London Stadium event days**, so it
     is NOT in the regular sched; `verifiedEvents` emits a `zones.events.json`
     record instead and rule 12 warns. 23 event zones now.
12. **City of London has bay-level data** (`mapping.cityoflondon.gov.uk`,
   INSPIRE MapServer layers 69 Pay Display / 76 Resident / 52 Waiting) — a
   second borough beyond Camden, which the July research missed because it
   searched only ArcGIS Online and Socrata. Not wired: `CHARGE` is empty (hours
   and max-stay are real), the host serves a **self-signed cert** that Node will
   reject, and it needs an ArcGIS bays adapter. See docs/DATA_PIPELINE.md.
13. **Hillingdon wired** (July 2026): `Car_Park__CPZ_and_Railways_WFL1`
   FeatureServer/4, 68 zones (60 verified; 8 have a blank `Times` and correctly
   stay indicative). `Zones` is the short code, `Label_2` the area, `Times` a
   time-first string the shared parser already reads.
14. **Grouping now keys on the hours text too** (`groupZones`). A borough can
   publish one zone name over rows with genuinely different control —
   Hillingdon's Zone H1 spans four schedules, Mon-Fri 9-5 through Mon-Sun
   9am-10pm. Keying on code(+area) alone merged them and kept whichever row came
   first, so the stricter rows' evenings and Sundays silently read as free.
   This was live, not hypothetical: the fix split **Newham 30 -> 39 zones**
   (Prince Regent alone had Mon-Sun 08:00-22:00 and 08:00-18:30 merged into
   one). Rows that agree still collapse — the key only splits on real
   disagreement. `zones.precise.json` = **449 zones across 11 boroughs**.
15. **Hackney wired via its map viewer's backend** (July 2026) — the Haringey
   route generalised, and the most productive technique left. Hackney's
   `data./map./gis.` hosts are all dead, but its parking page embeds a map at
   `map2.hackney.gov.uk` whose JS bundle exposes a public **GeoServer WFS**
   serving WGS84 GeoJSON. `parking:controlled_parking_zone` -> 31 verified
   zones + 6 event zones. New `kind:"geoserver"` portal and
   `data/sources/geoserverCpz.ts`, which is just fetch + snapshot: GeoServer
   returns GeoJSON, so it delegates to `transformArcgisCpz` (portal-agnostic).
   `zones.precise.json` = **480 zones across 12 boroughs**; 29 event zones.
   - `hoursSplit` splits one column holding several clauses ("Mon-Fri
     8.30am-6.30pm<br>Sat 8.30am-1.30pm"); parsed whole it invents a phantom
     Sat 08:30-18:30, the same failure RBKC showed.
   - `venueFromEventClause` reads the venue out of the clause: Hackney borders
     both the Emirates and the Olympic Park, so one venue per borough is wrong.
   **Do not conclude a borough is a dead end from dead `data.*`/`gis.*` hosts —
   look at what its parking map actually fetches.** The iShare sweep IS
   finished (Haringey is London's only one); the point is the backend can be
   any platform.
16. Wire more borough portals (21 still fallback-only); parsed tariff tables
   (COST columns); build the match-day feed + engine hook (docs/EVENT_DAYS.md)
   so event-risk warnings become real evaluations.
