import { BOROUGH_ZONES } from "./boroughs.js";
import BOROUGH_NAMES from "./data/boroughs.names.json";
import { EVENT_CONTROLS } from "./importedEvents.js";
import { MAPILLARY_SPOTS } from "./importedMapillary.js";
import { RED_ROUTE_SPOTS } from "./importedRedRoutes.js";
import { IMPORTED_SPOTS } from "./importedSpots.js";
import { PRECISE_ZONES } from "./precise.js";
import { byTrust, zoneTier } from "./tiers.js";
import type { Dataset, Spot, Zone } from "./types.js";

export interface Place {
  n: string;
  a: string;
  lat: number;
  lng: number;
}

// Searchable destinations
export const PLACES: Place[] = [
  { n: "Angel, Islington", a: "N1", lat: 51.5322, lng: -0.1057 },
  { n: "Upper Street", a: "Islington N1", lat: 51.5385, lng: -0.1027 },
  { n: "Islington Green", a: "N1", lat: 51.5366, lng: -0.1027 },
  { n: "Highgate Village", a: "N6", lat: 51.5716, lng: -0.1461 },
  { n: "Camden Town", a: "NW1", lat: 51.539, lng: -0.1426 },
  { n: "King's Cross", a: "N1C", lat: 51.5308, lng: -0.1238 },
  { n: "Soho", a: "W1", lat: 51.5136, lng: -0.1317 },
  { n: "Covent Garden", a: "WC2", lat: 51.5117, lng: -0.123 },
  { n: "Oxford Circus", a: "W1", lat: 51.5152, lng: -0.1418 },
  { n: "Marylebone High St", a: "W1", lat: 51.5186, lng: -0.1509 },
  { n: "Shoreditch", a: "E1/EC2", lat: 51.5265, lng: -0.0798 },
  { n: "Old Street", a: "EC1", lat: 51.5257, lng: -0.0876 },
  { n: "Brick Lane", a: "E1", lat: 51.5216, lng: -0.0713 },
  { n: "Borough Market", a: "SE1", lat: 51.5055, lng: -0.0906 },
  { n: "London Bridge", a: "SE1", lat: 51.5049, lng: -0.0865 },
  { n: "South Bank", a: "SE1", lat: 51.5058, lng: -0.115 },
  { n: "Westminster", a: "SW1", lat: 51.4995, lng: -0.1248 },
  { n: "Victoria", a: "SW1", lat: 51.4965, lng: -0.1436 },
  { n: "Hampstead", a: "NW3", lat: 51.556, lng: -0.178 },
  { n: "Notting Hill Gate", a: "W11", lat: 51.509, lng: -0.1963 },
  { n: "Kensington High St", a: "W8", lat: 51.5006, lng: -0.1925 },
  { n: "Clapham Common", a: "SW4", lat: 51.462, lng: -0.138 },
  { n: "Greenwich", a: "SE10", lat: 51.4816, lng: -0.009 },
  { n: "Canary Wharf", a: "E14", lat: 51.5054, lng: -0.0235 },
];

// Controlled Parking Zones. Hours for Islington, Camden and Westminster follow the
// borough websites (checked July 2026); everything else is indicative demo data.
export const ZONES: Zone[] = [
  {
    id: "isA",
    name: "Islington Zone B (Angel)",
    verified: true,
    src: "https://www.islington.gov.uk/parking/parking-restrictions/controlled-parking-zones",
    sched: [
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
      { days: [6], from: "08:30", to: "13:30" },
    ],
    ratePence: 650,
    maxStayHours: 4,
  },
  {
    id: "caA",
    name: "Camden CA-F(n) — Camden Town",
    verified: true,
    src: "https://www.camden.gov.uk/controlled-parking-zones",
    sched: [
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "23:00" },
      { days: [0, 6], from: "09:30", to: "23:00" },
    ],
    ratePence: 800,
    maxStayHours: 4,
  },
  {
    id: "caF",
    name: "Camden CA-D — King's Cross",
    verified: true,
    src: "https://www.camden.gov.uk/controlled-parking-zones",
    sched: [
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
      { days: [6], from: "08:30", to: "13:30" },
    ],
    ratePence: 590,
    maxStayHours: 4,
  },
  {
    id: "weW",
    name: "Westminster F/G — Soho & Covent Garden",
    verified: true,
    src: "https://www.westminster.gov.uk/parking/parking-zones-and-prices",
    sched: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" }],
    ratePence: 890,
    maxStayHours: 4,
  },
  {
    id: "weM",
    name: "Westminster E — Marylebone",
    verified: true,
    src: "https://www.westminster.gov.uk/parking/parking-zones-and-prices",
    sched: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" }],
    ratePence: 890,
    maxStayHours: 4,
  },
  {
    id: "weV",
    name: "Westminster A/D — Victoria & Pimlico",
    verified: true,
    src: "https://www.westminster.gov.uk/parking/parking-zones-and-prices",
    sched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
    ratePence: 740,
    maxStayHours: 4,
  },
  {
    id: "hxS",
    name: "Hackney Zone S (Shoreditch)",
    verified: false,
    src: "https://hackney.gov.uk/parking-zones",
    sched: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" }],
    ratePence: 500,
    maxStayHours: 4,
  },
  {
    id: "swB",
    name: "Southwark Zone B (Bankside)",
    verified: false,
    src: "https://www.southwark.gov.uk/parking/parking-zones",
    sched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
    ratePence: 460,
    maxStayHours: 3,
  },
  {
    id: "caC",
    name: "Camden CA-U — Highgate",
    verified: true,
    src: "https://www.camden.gov.uk/controlled-parking-zones",
    sched: [{ days: [1, 2, 3, 4, 5], from: "10:00", to: "12:00" }],
    ratePence: 450,
    maxStayHours: 2,
  },
  {
    id: "caH",
    name: "Camden CA-H — Hampstead",
    verified: false,
    src: "https://www.camden.gov.uk/controlled-parking-zones",
    sched: [{ days: [1, 2, 3, 4, 5], from: "09:00", to: "18:30" }],
    ratePence: 490,
    maxStayHours: 4,
  },
  {
    id: "kcN",
    name: "RBKC Zone N (Notting Hill)",
    verified: false,
    src: "https://www.rbkc.gov.uk/parking/parking-zones-and-bays",
    sched: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" }],
    ratePence: 650,
    maxStayHours: 4,
  },
  {
    id: "laC",
    name: "Lambeth Zone C (Clapham)",
    verified: false,
    src: "https://www.lambeth.gov.uk/parking-transport-streets/parking/controlled-parking-zones-cpzs",
    sched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
    ratePence: 440,
    maxStayHours: 4,
  },
  {
    id: "grT",
    name: "Greenwich Town Centre",
    verified: false,
    src: "https://www.royalgreenwich.gov.uk/parking",
    sched: [{ days: [1, 2, 3, 4, 5, 6], from: "09:00", to: "18:30" }],
    ratePence: 380,
    maxStayHours: 3,
  },
];

// Parking spots.
// type: cp (car park) | paid (shared-use / pay & display bay) | res (resident-only bay)
//       yellow (single yellow — free outside zone hours) | freeSt (uncontrolled free street)
export const SPOTS: Spot[] = [
  // ---- Angel / Islington
  { n: "N1 Centre Car Park", type: "cp", lat: 51.5344, lng: -0.1052, ratePence: 550, dayMaxPence: 2400, evePence: 800, note: "Under the N1 Centre, 24/7, height 1.9m" },
  { n: "Business Design Centre CP", type: "cp", lat: 51.5359, lng: -0.1042, ratePence: 500, dayMaxPence: 2200, evePence: 750, note: "Enter from Berners Rd, 24/7" },
  { n: "Duncan Street bays", type: "paid", zone: "isA", lat: 51.5327, lng: -0.1041, note: "Shared-use bays, pay by phone" },
  { n: "Charlton Place bays", type: "paid", zone: "isA", lat: 51.5347, lng: -0.103, note: "Short row near Camden Passage" },
  { n: "Gerrard Road (residents)", type: "res", zone: "isA", lat: 51.5335, lng: -0.0989, note: "Resident permit bays" },
  { n: "Colebrooke Row (single yellow)", type: "yellow", zone: "isA", lat: 51.5317, lng: -0.1015, note: "Free when zone hours end — check kerb markings" },
  { n: "Wharf Road (uncontrolled)", type: "freeSt", lat: 51.5297, lng: -0.0948, note: "Just outside the zone boundary" },
  // ---- Highgate
  { n: "Highgate Village bays", type: "paid", zone: "caC", lat: 51.571, lng: -0.1455, note: "Pay & display on the high street" },
  { n: "South Grove (residents)", type: "res", zone: "caC", lat: 51.5701, lng: -0.1472, note: "Resident permit bays" },
  { n: "Hampstead Lane (single yellow)", type: "yellow", zone: "caC", lat: 51.5729, lng: -0.1487, note: "Free outside 10am–12pm Mon–Fri" },
  { n: "Jackson's Lane CP", type: "cp", lat: 51.5738, lng: -0.1442, ratePence: 250, dayMaxPence: 900, evePence: 300, note: "Small community car park" },
  // ---- Camden Town
  { n: "Camden Market CP", type: "cp", lat: 51.5412, lng: -0.1458, ratePence: 600, dayMaxPence: 2600, evePence: 900, note: "Hawley Wharf entrance, 24/7" },
  { n: "Jamestown Road bays", type: "paid", zone: "caA", lat: 51.539, lng: -0.1462, note: "Pay by phone, busy at weekends" },
  { n: "Albert Street (residents)", type: "res", zone: "caA", lat: 51.5364, lng: -0.1443, note: "Resident permit bays" },
  { n: "Delancey Street (single yellow)", type: "yellow", zone: "caA", lat: 51.5369, lng: -0.1449, note: "Free after 8:30pm" },
  // ---- King's Cross
  { n: "Coal Drops Yard CP", type: "cp", lat: 51.5351, lng: -0.1258, ratePence: 650, dayMaxPence: 2800, evePence: 1000, note: "Granary Square, 24/7" },
  { n: "Wharfdale Road bays", type: "paid", zone: "caF", lat: 51.533, lng: -0.121, note: "Shared-use bays" },
  { n: "Balfe Street (residents)", type: "res", zone: "caF", lat: 51.532, lng: -0.1206, note: "Resident permit bays" },
  // ---- Soho / Covent Garden
  { n: "Q-Park Chinatown", type: "cp", lat: 51.5119, lng: -0.1302, ratePence: 1350, dayMaxPence: 5500, evePence: 2400, note: "Newport Place, 24/7, pre-book to save" },
  { n: "Parker Street CP", type: "cp", lat: 51.5152, lng: -0.1218, ratePence: 1100, dayMaxPence: 4800, evePence: 2000, note: "Near Covent Garden, 24/7" },
  { n: "Poland Street CP", type: "cp", lat: 51.515, lng: -0.1373, ratePence: 1250, dayMaxPence: 5200, evePence: 2200, note: "Central Soho, 24/7" },
  { n: "Wardour Street bays", type: "paid", zone: "weW", lat: 51.5133, lng: -0.1329, note: "Very high demand daytime" },
  { n: "Bedfordbury (single yellow)", type: "yellow", zone: "weW", lat: 51.5107, lng: -0.1258, note: "Free after 9pm — check signs" },
  // ---- Marylebone / Oxford Circus
  { n: "Q-Park Oxford Street", type: "cp", lat: 51.5171, lng: -0.1479, ratePence: 1200, dayMaxPence: 5000, evePence: 2100, note: "Cavendish Square, 24/7" },
  { n: "Moxon Street bays", type: "paid", zone: "weM", lat: 51.5199, lng: -0.152, note: "Pay by phone, 4h max" },
  { n: "Weymouth Mews (residents)", type: "res", zone: "weM", lat: 51.5194, lng: -0.147, note: "Resident permit bays" },
  // ---- Victoria / Westminster
  { n: "Semley Place CP", type: "cp", lat: 51.4938, lng: -0.149, ratePence: 900, dayMaxPence: 4000, evePence: 1500, note: "Near Victoria coach stn, 24/7" },
  { n: "Q-Park Westminster", type: "cp", lat: 51.5001, lng: -0.129, ratePence: 1150, dayMaxPence: 4700, evePence: 1900, note: "Great College St, 24/7" },
  { n: "Warwick Way bays", type: "paid", zone: "weV", lat: 51.4924, lng: -0.1418, note: "Shared-use bays" },
  // ---- Shoreditch / Old St / Brick Lane
  { n: "Curtain Road CP", type: "cp", lat: 51.5258, lng: -0.0812, ratePence: 550, dayMaxPence: 2400, evePence: 800, note: "24/7, tight ramps" },
  { n: "Rivington Street bays", type: "paid", zone: "hxS", lat: 51.5266, lng: -0.0805, note: "Pay by phone" },
  { n: "Charlotte Road (residents)", type: "res", zone: "hxS", lat: 51.5255, lng: -0.0817, note: "Resident permit bays" },
  { n: "Boundary Street (single yellow)", type: "yellow", zone: "hxS", lat: 51.5251, lng: -0.0752, note: "Free evenings & Sundays" },
  { n: "Brick Lane fringe (uncontrolled)", type: "freeSt", lat: 51.523, lng: -0.069, note: "Streets east of the zone" },
  // ---- Borough / London Bridge
  { n: "Snowsfields CP", type: "cp", lat: 51.5027, lng: -0.0855, ratePence: 700, dayMaxPence: 3000, evePence: 1100, note: "Kipling St, 24/7" },
  { n: "Park Street bays", type: "paid", zone: "swB", lat: 51.5063, lng: -0.0935, note: "Near Borough Market" },
  { n: "Union Street (single yellow)", type: "yellow", zone: "swB", lat: 51.504, lng: -0.097, note: "Free evenings & weekends" },
  // ---- South Bank
  { n: "National Theatre CP", type: "cp", lat: 51.5069, lng: -0.1136, ratePence: 850, dayMaxPence: 3600, evePence: 1300, note: "Upper Ground, 24/7" },
  // ---- Hampstead
  { n: "Hampstead High St bays", type: "paid", zone: "caH", lat: 51.5557, lng: -0.1774, note: "Pay & display" },
  { n: "Willoughby Road (residents)", type: "res", zone: "caH", lat: 51.5573, lng: -0.1755, note: "Resident permit bays" },
  { n: "East Heath Road CP", type: "cp", lat: 51.5589, lng: -0.1712, ratePence: 350, dayMaxPence: 1200, evePence: 400, note: "Heath car park, closes 9pm in demo" },
  // ---- Notting Hill / Kensington
  { n: "Kensington Place bays", type: "paid", zone: "kcN", lat: 51.5077, lng: -0.196, note: "Pay by phone" },
  { n: "Hillgate Street (residents)", type: "res", zone: "kcN", lat: 51.5082, lng: -0.1945, note: "Resident permit bays" },
  { n: "Young Street CP", type: "cp", lat: 51.5013, lng: -0.19, ratePence: 800, dayMaxPence: 3400, evePence: 1200, note: "Off Kensington High St, 24/7" },
  // ---- Clapham
  { n: "Clapham High St bays", type: "paid", zone: "laC", lat: 51.464, lng: -0.1373, note: "Pay & display" },
  { n: "Grafton Square (single yellow)", type: "yellow", zone: "laC", lat: 51.4633, lng: -0.14, note: "Free evenings & weekends" },
  { n: "The Pavement CP", type: "cp", lat: 51.4614, lng: -0.1394, ratePence: 380, dayMaxPence: 1500, evePence: 500, note: "Small surface car park" },
  // ---- Greenwich
  { n: "Cutty Sark Gardens CP", type: "cp", lat: 51.4823, lng: -0.01, ratePence: 350, dayMaxPence: 1400, evePence: 500, note: "24/7, fills early weekends" },
  { n: "Greenwich Church St bays", type: "paid", zone: "grT", lat: 51.481, lng: -0.0087, note: "Pay & display" },
  { n: "Park Row (single yellow)", type: "yellow", zone: "grT", lat: 51.4826, lng: -0.0043, note: "Free after 6:30pm & Sundays" },
  // ---- Canary Wharf
  { n: "Canada Square CP", type: "cp", lat: 51.5052, lng: -0.0208, ratePence: 500, dayMaxPence: 2500, evePence: 700, note: "24/7, weekend flat rates" },
  { n: "Westferry Circus CP", type: "cp", lat: 51.506, lng: -0.0295, ratePence: 450, dayMaxPence: 2200, evePence: 600, note: "24/7" },
  { n: "Coldharbour (uncontrolled)", type: "freeSt", lat: 51.501, lng: -0.0125, note: "Free streets near Blackwall" },
  // ---- No-stopping (red route / clearway) — never parkable.
  // The pan-London red-route network now comes from RED_ROUTE_SPOTS (imported by
  // the ETL from OSM no_stopping tagging); no hand-seeded points are needed here.
  // ---- No-loading bans (time-aware) — blocked only while the ban is posted
  { n: "Parkway loading ban", type: "noLoad", lat: 51.5372, lng: -0.1454, sched: [{ days: [1, 2, 3, 4, 5, 6], from: "07:00", to: "10:00" }], note: "Peak loading ban outside the shops" },
  { n: "Bayham Street loading ban", type: "noLoad", lat: 51.5361, lng: -0.1409, sched: [{ days: [1, 2, 3, 4, 5], from: "08:00", to: "09:30" }, { days: [1, 2, 3, 4, 5], from: "16:30", to: "18:30" }], note: "Twin-blip loading ban, peaks only" },
  { n: "Chapel Market loading ban", type: "noLoad", lat: 51.5327, lng: -0.1073, sched: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" }], note: "Market street loading restriction" },
  { n: "Berwick Street loading ban", type: "noLoad", lat: 51.5136, lng: -0.1361, sched: [{ days: [1, 2, 3, 4, 5, 6], from: "07:00", to: "11:00" }], note: "Soho market loading ban, mornings" },
];

// Postcode districts (outward code -> approx centre) for offline lookup
export const PC_DISTRICTS: Record<string, [number, number]> = {
  N1: [51.536, -0.103], N1C: [51.534, -0.126], N4: [51.573, -0.105], N5: [51.552, -0.097],
  N6: [51.571, -0.146], N7: [51.552, -0.116], N8: [51.585, -0.12], N16: [51.562, -0.076],
  N19: [51.565, -0.13], NW1: [51.535, -0.141], NW3: [51.55, -0.176], NW5: [51.554, -0.143],
  NW6: [51.544, -0.196], NW8: [51.532, -0.172], W1: [51.515, -0.141], W2: [51.514, -0.18],
  W8: [51.501, -0.193], W9: [51.527, -0.194], W10: [51.523, -0.211], W11: [51.513, -0.203],
  W14: [51.495, -0.21], WC1: [51.522, -0.123], WC2: [51.512, -0.123], EC1: [51.524, -0.101],
  EC2: [51.518, -0.088], EC3: [51.512, -0.081], EC4: [51.513, -0.1], E1: [51.517, -0.06],
  E2: [51.529, -0.062], E8: [51.545, -0.062], E14: [51.507, -0.02], SE1: [51.501, -0.095],
  SE10: [51.481, -0.008], SE11: [51.491, -0.11], SE16: [51.496, -0.052], SW1: [51.497, -0.137],
  SW3: [51.49, -0.166], SW4: [51.462, -0.138], SW7: [51.496, -0.174], SW8: [51.478, -0.135],
  SW11: [51.466, -0.166],
};

/**
 * Most trusted first — zoneAt() returns the first match.
 *
 * Ordering is by trust TIER (tiers.ts), not by which file a zone came from.
 * The two mostly agree, but not always: an imported zone whose hours we could
 * not parse is an ESTIMATE despite its exact boundary, and must not outrank a
 * zone transcribed from the council's own page. Sorting on the tier says that
 * outright instead of leaving it to the order of the spread below.
 *
 * `sort` is stable, so within a tier the previous precedence still holds:
 * imported per-zone CPZs, then curated zones, then borough-wide fallbacks.
 */
export const ALL_ZONES: Zone[] = [...PRECISE_ZONES, ...ZONES, ...BOROUGH_ZONES].sort(
  byTrust<Zone>(zoneTier),
);

/**
 * Boroughs the UI may name as having council-sourced zone hours: those with at
 * least one zone `zoneHoursTrusted` accepts — an imported per-zone CPZ, or a
 * hand-verified curated zone (Islington Zone B, Westminster E). Borough-wide
 * fallbacks are excluded by the `kind !== "borough"` test, so an estimate can
 * never put a borough on this list.
 *
 * Derived rather than hand-written: the previous fixed sentence named boroughs
 * whose data had since changed, telling users an estimate came from the council.
 */
export const PRECISE_BOROUGHS: string[] = (BOROUGH_NAMES as string[]).filter((borough) =>
  ALL_ZONES.some((z) => z.verified && z.kind !== "borough" && z.name.startsWith(borough)),
);

/**
 * Curated spots, kerb-level bays imported from borough open data / OSM,
 * no-stopping/no-loading areas from Mapillary detected signs, and the pan-London
 * TfL red-route no-stopping network.
 */
export const ALL_SPOTS: Spot[] = [
  ...SPOTS,
  ...IMPORTED_SPOTS,
  ...MAPILLARY_SPOTS,
  ...RED_ROUTE_SPOTS,
];

export const DEFAULT_DATASET: Dataset = {
  zones: ALL_ZONES,
  spots: ALL_SPOTS,
  events: EVENT_CONTROLS,
};
