# Data pipeline — replacing demo data with real borough data

## Goal
`data/etl` produces one normalised dataset consumed by the engine:
zones (MultiPolygon, sched[], tariff, maxStay, src, verified, checkedAt),
bays (point/linestring, type, zoneId-by-spatial-join), carparks (operator feeds).

## Sources (start here)
1. **CPZ boundaries (GeoJSON/Shapefile)**
   - London Datastore (data.london.gov.uk) — search "controlled parking zones";
     several boroughs publish CPZ polygon layers.
   - Camden Open Data (opendata.camden.gov.uk) — CPZ layer with zone codes.
   - Islington: CPZ map PDF + GIS layer via their open data / FOI-published shapefiles.
   - Westminster: CPZ map PDF (westminster.gov.uk/media/document/controlled-parking-zones-map)
     + "Hours of control & parking tariffs" PDF (machine-readable table → parse).
2. **Hours & tariffs** — scrape/parse the borough pages listed in SPEC §5; store the
   source URL + retrieval date on every record. Where only PDFs exist, parse tables
   (Westminster tariff PDF is structured).
3. **On-street bays** — some boroughs publish bay-level data (Camden "Parking bays"
   dataset includes bay type, location, spaces). Fall back to zone-level modelling
   where absent.
4. **Car parks** — operator/aggregator APIs: Parkopedia, AppyParking (now
   Grid Smarter Cities), NPP/NCP feeds. Abstract behind `CarParkProvider` interface;
   ship a static seed file first.
5. **Postcodes** — postcodes.io (free, no key) for full-postcode geocoding;
   keep the offline outward-district table as fallback.
6. **Red routes** — TfL red route data (no stopping) to exclude candidate kerbside
   entirely; TfL Unified API / London Datastore.

## ETL rules
- Normalise all schedules to `{days:[0-6], from, to}` arrays (supports split hours).
- Bank holidays: treat as the zone's Sunday schedule unless the borough states
  otherwise; flag `bankHolidayAssumed:true`.
- Spatial join bays → zones (point-in-polygon) instead of hard-coded zone ids.
- Every record: `src`, `verified`, `checkedAt`. UI must label unverified data.
- Re-run monthly; diff report on hour changes (boroughs run ETOs constantly —
  Camden CA-F(n) is itself a trial order).

## Definition of done for "real data" milestone
Searching any point in Camden or Islington uses genuine zone boundaries + published
hours, with the borough page linked from the zone popup, and all SPEC §6 tests
re-pass against the real dataset (update expected values where real tariffs differ).

## Bay-data findings (researched 20 Jul 2026)

Goal was kerb-level bays beyond Camden. Conclusion: **blocked by availability,
not by our code.** What was checked and found:

1. **ArcGIS Online / borough ArcGIS servers** — searched the arcgis.com catalogue
   ("parking bays", "CPZ", "controlled parking zones", …) and probed borough
   services directly (e.g. Merton's `public_ParkingServices_Parking_Layers` has
   CPZ boundaries, permit-eligibility and school streets — no bays). No London
   borough publishes a bay-level layer this way.
2. **Socrata** — the global discovery API (api.eu.socrata.com) returns exactly
   one London bay dataset: Camden "Parking Bays" (already wired, 1,128 groups).
3. **OSM kerb tagging** (`parking:left/right/both` + legacy `parking:lane`):
   5,897 inner-London ways, but only ~136 carry a machine-usable restriction
   (res/paid). ~2,000 classify as bare "parking exists" — correctly dropped
   inside CPZs, since that is not evidence of free parking (engine rule 9).
   Widening the bbox adds more of the same; not worth it until mappers tag
   restrictions.
4. **OSM car parks** (`amenity=parking`): well-mapped (~900 ways in a central
   slice; ~60% carry `fee`, ~24% `capacity`) but effectively zero tariff data
   (`charge` ≈ 0%), so they cannot be priced without an operator feed
   (Parkopedia / NCP — see Sources §4).
5. **Mapillary sign detections**: class + position only — the detection cannot
   read the plate beneath the sign, which is where bay type (pay vs permit),
   hours, tariff and max-stay live. Hence detections are `cpzStreet`
   observations, never priced bays (CLAUDE.md rule 14).

### Proposed next step: plate-OCR spike (not yet started)

Mapillary street-level *imagery* (CC-BY-SA — allowed, unlike Google) can show
the plate. Pipeline sketch: for each `information--parking` detection, fetch
nearby images via the Mapillary Images API → crop the sign region → read the
plate with a vision model → parse hours through the existing
`parseScheduleText`, plus bay type / tariff / max-stay. Risks: plate legibility
(glare/angle/distance) will cut yield hard; a misread plate that turns a
resident bay into "free" is a £130 PCN. So: spike on a handful of known signs
first and measure accuracy; any shipped output is `verified:false`, must never
clear a restriction (rule 9), and feeds the "Update me" loop as "sign says…"
evidence rather than authoritative bays.

## Borough portal discovery sweep (21 Jul 2026)

Hunting live CPZ layers for the remaining fallback-only boroughs. **Wired: RBKC.**
What was checked, so none of it is repeated:

- **`inspire.misoportal.com` is DEAD.** data.gov.uk still lists Astun-hosted
  INSPIRE WFS/WMS endpoints for **Southwark** (CPZ, *parking bays*, and
  waiting/loading restrictions), **Hounslow** and **Bromley** CPZ. DNS resolves
  (52.16.156.33) but ports 80 and 443 are both closed — the service is
  decommissioned and those records are stale (Southwark's is from 2017). Note
  the Southwark bay-polygon record: if that data ever resurfaces it would be the
  second London borough with bay-level data, so it is worth a periodic re-probe.
- **statmap.co.uk** (Sutton `open_data_lbs_wfs`, Kingston `open_data_wfs`)
  answers **403 Forbidden** on the documented open-data endpoints, browser UA or
  not. Kingston is already wired via ArcGIS, so only Sutton is lost.
- **Westminster has no reachable CPZ layer.** No `gis./maps./geo./opendata.`
  host resolves; the council's ArcGIS server is a shared box run by RBKC
  (`www.rbkc.gov.uk/arcgis`) whose **WCC folder holds only aerial imagery,
  historic maps and FixMyStreet** — no parking layer. Westminster's zone hours
  stay the hand-verified curated ones (E, F/G, A/D).
- **Southwark** publishes no GIS endpoint of its own: `data.southwark.gov.uk` is
  a WordPress site (not CKAN/Hub), and `services.southwark.gov.uk` exposes no
  ArcGIS/GeoServer path. Also: the registry's `src` for Southwark 404s — the
  parking section moved to `/parking-streets-and-transport/parking`.
- A sweep of `gis./maps./geo./www.{borough}.gov.uk/arcgis/rest/services` across
  all 25 unwired boroughs returned exactly two live REST directories: RBKC's
  (wired below) and a Barnet URL that serves HTML, not a services catalogue.
- ArcGIS Online's public catalogue remains thin for CPZ, confirming the earlier
  finding: searches surface Camden, Kingston and a `gis_services1` org that is
  **New Westminster, Canada** — not Westminster, London.

### RBKC (wired)

`https://www.rbkc.gov.uk/arcgis/rest/services/RBKC/INSPIRE/MapServer/13`
("Residents Parking Control"): 11 features -> 9 zones, all verified. Columns are
`Control` (code, repeats across areas), `Area_Name`, and `Control_1..3` — one
day+time clause each, which is why the importer grew `hoursPerField` and
`areaField` (see CLAUDE.md §9). Layer 4 ("Controlled Parking Zones - SYL") is
single-yellow-line geometry with **no hours columns**, so it is not imported.

## Second sweep (21 Jul 2026) — Tower Hamlets wired, City of London found

Method that worked, after the `*.opendata.arcgis.com` probe proved useless
(**every** subdomain returns 200 — ArcGIS Hub wildcards, so liveness there is not
evidence a portal exists): resolve each borough's real ArcGIS org via
`https://<slug>.maps.arcgis.com/sharing/rest/portals/self?f=json`, then search
items with `orgid:<id>`. Of 24 slugs tried, only four are genuine London orgs —
Tower Hamlets, Islington, Bromley, Havering. Watch for near-miss orgs: the
`westminster` slug is **City of Westminster, Colorado** and `greenwich` is a
school, exactly like `gis_services1` was New Westminster, Canada.

- **Tower Hamlets — WIRED.** `Parking_Permit_Mini_Zones_view/FeatureServer/159`,
  16 mini-zone polygons, fields `ZONE_CODE` + `Zone_short` and **no hours**.
  Hours hand-transcribed from the council's "Parking zones and controlled
  parking times" page into `TOWER_HAMLETS_VERIFIED_HOURS` — this is what the new
  `verifiedHours` field on the ArcGIS portal is for (it already existed on the
  Socrata portal for Camden). Three zones (A6, B3, C2) are split by street
  inside one polygon with different hours per side and no way to tell them
  apart; each takes the **union** of both patterns, over-stating control,
  because rule 7 makes the opposite error a £130 PCN. B4 gains a Sunday control
  on London Stadium event days — captured via the new `verifiedEvents` field so
  rule 12 warns rather than calling a B4 Sunday free.
- **Islington, Bromley, Havering orgs hold no CPZ layer** (`orgid:` search for
  parking/cpz returns nothing usable). Havering's `maps.havering.gov.uk` is 503
  and its data.gov.uk records are car-park-zone leaflets, not a CPZ layer.

### City of London — bay-level data exists (NOT yet wired)

`https://www.mapping.cityoflondon.gov.uk/arcgis/rest/services/INSPIRE/MapServer`
carries **layer 69 "Pay Display Parking"** (155 polygons) and **76 "Resident
Parking"**, plus 52 "Waiting Restrictions". This is a genuine **second London
borough with bay-level data**, against the earlier "Camden is the only one"
conclusion — that finding was drawn from ArcGIS Online and Socrata, and this
server is on neither.

Caveats to settle before wiring:
1. `CHARGE` is empty on all 155 rows — hours (`PRESCRIBED_HOURS`,
   `CHARGE_HOURS`) and `MAXIMUM_STAY` ("4 Hours") are real and near-uniform, but
   there is **no tariff**, so bays would price off the borough rate and must
   carry the rule 9 estimate warning.
2. The host serves a **self-signed certificate**. Node's fetch rejects it, and
   disabling TLS verification for an ETL source is not something to do quietly —
   decide deliberately (pinned CA, or accept and document) before wiring.
3. It needs an ArcGIS **bays** adapter; today only Socrata bays are supported.

## Third sweep (21 Jul 2026) — Hillingdon wired, grouping bug found

Alternate org slugs are worth trying: `<slug>.maps.arcgis.com/sharing/rest/
portals/self` resolved five more London orgs under names the obvious slug
missed — `lbhillingdon`, `lbbarnet`, `cityoflondon`, `southwarkcouncil`,
`islingtoncouncil`. Of those only **Hillingdon** holds a CPZ layer; Southwark,
Islington and Barnet orgs return nothing for parking/cpz, which finally settles
Southwark (its only CPZ data was the dead misoportal WFS).

Also checked and empty: Hackney (every `data./map./maps./geo.hackney.gov.uk`
host is dead; its data.gov.uk CPZ records carry no resource URLs), Brent and
Ealing (`data.*.gov.uk` are JS portal shells with no service behind them).

**Hillingdon — WIRED.** `Car_Park__CPZ_and_Railways_WFL1/FeatureServer/4`,
84 rows -> 68 zones. `Zones` short code + `Label_2` area + `Times`
("9am to 5pm - Mon to Sat"). 15 rows have blank `Times` and land on the
indicative fallback; one row reads "8am to 6am ... Max stay 2 hours", which the
parser rejects outright rather than guessing — both correct. Note `Times`
sometimes appends "Max stay 2 hours" while the record's `maxStayHours` stays the
borough default, so don't treat this borough's max stay as authoritative.

### The grouping bug it exposed

Hillingdon publishes one zone name over rows with **different** control (Zone H1
has four schedules, from Mon-Fri 9-5 to Mon-Sun 9am-10pm). `groupZones` keyed on
code(+area), so all rows merged and the first row's hours won — the rest of the
zone's evenings and Sundays then read as uncontrolled. That is the rule 7
direction that costs £130.

The key now includes the hours text. Identical rows still collapse, so this only
splits where a borough really did publish two schedules. It was **already
wrong in production**: re-running the ETL took **Newham from 30 to 39 zones**,
e.g. Prince Regent had Mon-Sun 08:00-22:00 and Mon-Sun 08:00-18:30 collapsed
into a single record. Covered by tests in data/test/arcgisCpz.test.ts.

## Fourth pass (21 Jul 2026) — the map-viewer backend route, Hackney wired

The Haringey trick generalised, and it is now the **most productive remaining
technique**: a council's own parking map is a web app, and the service behind it
is usually public and machine-readable even when it appears in no catalogue and
no borough ArcGIS org. Find it by loading the map page and reading what it
fetches — the config, the JS bundle, or the network tab.

Note this is NOT the iShare sweep, which is finished: all 28 remaining boroughs
were checked for Astun iShare and Haringey is the only London one. The point is
that the *backend* can be anything — GeoServer, ArcGIS, statmap, Cadcorp — so
look at the map, not at a platform.

**Hackney — WIRED, via exactly this route.** Every `data./map./maps./geo.
hackney.gov.uk` host is dead and its data.gov.uk CPZ records carry no resource
URLs, so the borough looked finished. But the parking page embeds a map at
`map2.hackney.gov.uk` (a host no subdomain guess would produce). That page loads
`lbh-webmap.min.js`, and grepping the bundle yields:

    https://map2.hackney.gov.uk/geoserver/ows?service=WFS&version=2.0&request=GetFeature
      &outputFormat=application/json&SrsName=EPSG:4326&typeName=…

A public **GeoServer WFS** serving WGS84 GeoJSON, with a whole `parking:`
workspace. `parking:controlled_parking_zone` gives 32 polygons with `zone` and
`controlled_hours` -> **31 verified zones**, plus 6 event zones.

New `kind:"geoserver"` portal + `data/sources/geoserverCpz.ts`. Because GeoServer
returns GeoJSON directly (unlike the iShare GML/BNG path), the adapter is only a
fetch and a snapshot — it delegates to `transformArcgisCpz`, which is
portal-agnostic and already handles per-clause hours and event capture.

Two things Hackney's data forced:
1. **`hoursSplit`** — the hours live in ONE column with clauses joined by
   `<br>` ("Mon-Fri 8.30am-6.30pm<br>Sat 8.30am-1.30pm"). Parsed as a single
   string that yields a phantom `Sat 08:30-18:30`, the same failure RBKC showed.
   `hoursSplit` breaks the column into clauses so the existing per-clause path
   handles it.
2. **Venue-per-clause** — clauses read "Emirates Stadium events" / "QEOP Stadium
   events". Hackney borders both, so one `eventVenue` per borough is wrong;
   `venueFromEventClause` reads the venue out of the text. `isEventConditional`
   also had to widen from "event days" to plain "events".

Other `parking:` layers on that GeoServer, not yet used:
`inventory_pay_and_display_machine`, `parking_new_scheme`, `pcn_last_6_months`,
plus car-club and cycle layers. The pay-and-display machine inventory is worth a
look for bay evidence.

### Worth re-running this route on

Every borough still fallback-only that has a public parking map: Wandsworth,
Lewisham, Brent, Ealing, Croydon, Greenwich, Waltham Forest, Enfield, Islington,
Southwark. A dead `data.*`/`gis.*` host means nothing — Hackney proved that.

## Source tiers (21 Jul 2026)

Trust is now an explicit field, not something inferred from which file a record
came from. `packages/engine/src/tiers.ts` is the single definition; every zone
and spot carries a `tier`, and `ALL_ZONES` is sorted by it so `zoneAt` returns
the best available source rather than whichever array was spread first.

| Tier | Name | What it is | Live? |
|---|---|---|---|
| 1 | USER | A verified user photo of the sign on that street | **empty — see below** |
| 2 | COUNCIL | The borough's own portal, map backend, or published table | 466 zones |
| 3 | AUTHORITY | TfL red-route network (authoritative for TfL roads only) | 628 points |
| 4 | DETECTED | Mapillary sign detections — class + position, never the plate | 831 spots |
| 5 | COMMUNITY | OSM `parking:*` tagging, no verification step | 85 groups |
| 6 | ESTIMATE | Our borough-wide indicative schedule | 33 + 14 zones |

Two rules the tier encodes:
- **`tierCanClearRestriction` is tier <= 2.** Only the sign or the council can
  say a restriction is OFF. Everything below either estimates, or observes that
  a restriction exists — neither can clear a kerb (rule 9).
- **The tier describes the HOURS, not the geometry.** A council layer whose
  hours we could not parse falls back to the borough estimate and is tiered
  ESTIMATE however exact its boundary. That is why 14 precise zones sit at tier
  6 (Hillingdon's blank `Times` rows, and similar).

### Tier 1 is reserved and deliberately empty

"Update me" today stores a photo, a location and a date in **localStorage**
(`web/src/report.ts`). It never leaves the device, is never parsed into hours,
and nothing marks a report verified. So there is no user data to supersede the
council with, and `tiers.test.ts` asserts the dataset contains no tier-1 record
— if that test ever fails, the loop has been wired up and the questions below
must have been answered first.

Before anything writes tier 1, decide:
1. **What makes a report "verified"?** One photo from one person is not
   evidence — a misread or malicious report that clears a live restriction is a
   £130 PCN for the next reader. Corroboration count? Council cross-check?
   Moderation?
2. **Where do reports live?** localStorage is one device; superseding council
   data for other users needs a backend (Supabase was discussed, never built).
3. **How do hours get out of a photo?** Either OCR/vision on the plate (the
   accuracy spike in "Bay-data findings" is unstarted) or structured manual
   entry in the report form.
4. **Expiry.** A sign photo from 2024 should not outrank a council table
   refreshed last week forever; `byTrust` breaks ties on `checkedAt` within a
   tier but does not currently demote stale tier-1 across tiers.
