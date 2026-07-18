import { BOROUGH_ZONES } from "./boroughs.js";
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
    poly: [
      [51.5405, -0.1125],
      [51.5425, -0.098],
      [51.539, -0.089],
      [51.5305, -0.0925],
      [51.5262, -0.109],
      [51.533, -0.1135],
    ],
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
    poly: [
      [51.546, -0.151],
      [51.546, -0.134],
      [51.533, -0.133],
      [51.533, -0.151],
    ],
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
    poly: [
      [51.537, -0.13],
      [51.537, -0.117],
      [51.5255, -0.116],
      [51.5255, -0.13],
    ],
  },
  {
    id: "weW",
    name: "Westminster F/G — Soho & Covent Garden",
    verified: true,
    src: "https://www.westminster.gov.uk/parking/parking-zones-and-prices",
    sched: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" }],
    ratePence: 890,
    maxStayHours: 4,
    poly: [
      [51.5185, -0.145],
      [51.5185, -0.1175],
      [51.5085, -0.117],
      [51.508, -0.145],
    ],
  },
  {
    id: "weM",
    name: "Westminster E — Marylebone",
    verified: true,
    src: "https://www.westminster.gov.uk/parking/parking-zones-and-prices",
    sched: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" }],
    ratePence: 890,
    maxStayHours: 4,
    poly: [
      [51.5245, -0.158],
      [51.5245, -0.144],
      [51.515, -0.1435],
      [51.515, -0.158],
    ],
  },
  {
    id: "weV",
    name: "Westminster A/D — Victoria & Pimlico",
    verified: true,
    src: "https://www.westminster.gov.uk/parking/parking-zones-and-prices",
    sched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
    ratePence: 740,
    maxStayHours: 4,
    poly: [
      [51.501, -0.151],
      [51.501, -0.136],
      [51.4915, -0.1355],
      [51.4915, -0.151],
    ],
  },
  {
    id: "hxS",
    name: "Hackney Zone S (Shoreditch)",
    verified: false,
    src: "https://hackney.gov.uk/parking-zones",
    sched: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" }],
    ratePence: 500,
    maxStayHours: 4,
    poly: [
      [51.533, -0.088],
      [51.533, -0.072],
      [51.5205, -0.071],
      [51.5205, -0.088],
    ],
  },
  {
    id: "swB",
    name: "Southwark Zone B (Bankside)",
    verified: false,
    src: "https://www.southwark.gov.uk/parking/parking-zones",
    sched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
    ratePence: 460,
    maxStayHours: 3,
    poly: [
      [51.509, -0.1],
      [51.509, -0.082],
      [51.5, -0.0815],
      [51.5, -0.1],
    ],
  },
  {
    id: "caC",
    name: "Camden CA-U — Highgate",
    verified: true,
    src: "https://www.camden.gov.uk/controlled-parking-zones",
    sched: [{ days: [1, 2, 3, 4, 5], from: "10:00", to: "12:00" }],
    ratePence: 450,
    maxStayHours: 2,
    poly: [
      [51.576, -0.152],
      [51.576, -0.14],
      [51.567, -0.1395],
      [51.567, -0.152],
    ],
  },
  {
    id: "caH",
    name: "Camden CA-H — Hampstead",
    verified: false,
    src: "https://www.camden.gov.uk/controlled-parking-zones",
    sched: [{ days: [1, 2, 3, 4, 5], from: "09:00", to: "18:30" }],
    ratePence: 490,
    maxStayHours: 4,
    poly: [
      [51.561, -0.184],
      [51.561, -0.17],
      [51.551, -0.1695],
      [51.551, -0.184],
    ],
  },
  {
    id: "kcN",
    name: "RBKC Zone N (Notting Hill)",
    verified: false,
    src: "https://www.rbkc.gov.uk/parking/parking-zones-and-bays",
    sched: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" }],
    ratePence: 650,
    maxStayHours: 4,
    poly: [
      [51.5145, -0.204],
      [51.5145, -0.188],
      [51.504, -0.1875],
      [51.504, -0.204],
    ],
  },
  {
    id: "laC",
    name: "Lambeth Zone C (Clapham)",
    verified: false,
    src: "https://www.lambeth.gov.uk/parking-transport-streets/parking/controlled-parking-zones-cpzs",
    sched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
    ratePence: 440,
    maxStayHours: 4,
    poly: [
      [51.468, -0.145],
      [51.468, -0.13],
      [51.457, -0.1295],
      [51.457, -0.145],
    ],
  },
  {
    id: "grT",
    name: "Greenwich Town Centre",
    verified: false,
    src: "https://www.royalgreenwich.gov.uk/parking",
    sched: [{ days: [1, 2, 3, 4, 5, 6], from: "09:00", to: "18:30" }],
    ratePence: 380,
    maxStayHours: 3,
    poly: [
      [51.4865, -0.016],
      [51.4865, -0.001],
      [51.477, -0.0005],
      [51.477, -0.016],
    ],
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
 * Specific curated zones first, then borough-level fallbacks from real boundary
 * data — zoneAt() returns the first match, so precise records win.
 */
export const ALL_ZONES: Zone[] = [...ZONES, ...BOROUGH_ZONES];

export const DEFAULT_DATASET: Dataset = { zones: ALL_ZONES, spots: SPOTS };
