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
