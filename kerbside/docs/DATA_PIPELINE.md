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
