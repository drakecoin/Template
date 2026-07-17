# Kerbside — Product & Engine Spec (v0.2, from prototype)

## 1. Inputs
- Destination: UK postcode (full → postcodes.io live geocode; outward district →
  offline centroid table) OR curated place search OR device GPS (clamped to
  Greater London bbox 51.28–51.70, -0.51–0.33).
- Time window: arrive + leave (datetime-local), max 48h. Presets: Now·2h, Now·4h,
  This evening (19–23), Overnight (20–08), Sat morning (9–12), Sunday (10–17).

## 2. Option types
| type   | Meaning              | Valid when                       | Cost |
|--------|----------------------|----------------------------------|------|
| cp     | Off-street car park  | Always (24/7 assumed)            | hourly, day-max cap, evening flat |
| paid   | Shared-use / P&D bay | overlap ≤ zone maxStay           | zone rate × overlap hrs; free outside hours |
| res    | Resident-only bay    | zero controlled overlap          | free |
| yellow | Single yellow line   | zero controlled overlap          | free (warn: loading bans) |
| freeSt | Uncontrolled street  | always                           | free (warn: demand) |

## 3. Ranking
score = costGBP + walkMin × 0.35. Walk speed 12.5 min/km, search radius 1.5 km.
Badges: BEST OVERALL (min score), BEST FREE (free, min walk), CLOSEST (min distance,
valid only), CHEAPEST PAID (min cost>0). Invalid options listed under a toggle with
reason strings (e.g. "Resident permit holders only Mon–Fri 08:30–18:30").

## 4. Map behaviour
- OSM tiles, zone polygons amber+shaded when active during the window, grey otherwise.
- Zone popup: name, hours, active-flag, link to borough source (verified/indicative).
- Selecting a result draws a dashed walk line dest→spot and highlights the pin.
- Every spot: "Open in Google Maps" → google.com/maps/dir/?api=1&destination=lat,lng.

## 5. Verified zone data (checked July 2026 — recheck on ingest)
- Islington Zone B (Angel): Mon–Fri 08:30–18:30, Sat 08:30–13:30.
  islington.gov.uk/parking/parking-restrictions/controlled-parking-zones
- Camden CA-F(n) Camden Town: Mon–Fri 08:30–23:00, Sat–Sun 09:30–23:00 (ETO trial).
  Remainder of CA-F: Mon–Fri 08:30–18:30, Sat/Sun 09:30–17:30 (resident bays).
- Camden CA-D King's Cross: Mon–Fri 08:30–18:30, Sat 08:30–13:30.
- Camden CA-U Highgate: Mon–Fri 10:00–12:00.
- Westminster E/F/G (Marylebone, Soho, Mayfair, Covent Gdn): Mon–Sat 08:30–18:30,
  free Sundays. Zones A1/D1/B/C: Mon–Fri 08:30–18:30.
  westminster.gov.uk/parking/parking-zones-and-prices
- Everything else in the dataset: indicative.

## 6. Engine test scenarios (all pass in prototype — port as unit tests)
Dest = Angel (51.5322,-0.1057) unless stated:
1. Tue 11:00–13:00 → paid bays charge (£6.50/h ×2), resident bays & yellows invalid,
   free uncontrolled street wins BEST FREE.
2. Tue 20:00–23:00 → everything free (zone ended 18:30); nearest bay wins all badges.
3. Sat 15:00–18:00 → free (Sat control ends 13:30). 7 free options expected.
4. Fri 20:00–Sat 08:00 overnight → free; note Sat 08:30 start not breached.
5. Mon 09:00–17:00 (8h) → bays invalid (4h max stay), car parks priced with day-cap,
   free street wins.
Camden Town (51.5390,-0.1426):
6. Sat 21:00–23:00 → bays still charge (CA-F(n) runs to 23:00); car park cheaper, wins.
7. Sat 23:30–Sun 01:00 → all free.

## 7. Known limitations / next
- Hand-drawn zone polygons; bays hard-linked to zone ids instead of spatial lookup.
- No bank-holiday handling (most zones free — model as Sunday), no match-day
  controls (Emirates!), no red routes (TfL), no loading-ban times on yellows.
- No availability data; no EV / disabled-bay filters; no price for cashless ops fees.
