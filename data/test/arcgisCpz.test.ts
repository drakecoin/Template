import { describe, expect, it } from "vitest";
import type { GeoFeatureCollection } from "../geo.js";
import {
  transformArcgisCpz,
  transformArcgisEvents,
  type ArcgisCpzSpec,
} from "../sources/arcgisCpz.js";

const square = (lat: number, lng: number, d: number) => [
  [
    [lng, lat],
    [lng + d, lat],
    [lng + d, lat + d],
    [lng, lat + d],
    [lng, lat],
  ],
];

// --- Hammersmith & Fulham shape: separate ZONE_/DAYS/TIME_ columns ----------
const HF_SPEC: ArcgisCpzSpec = {
  idPrefix: "hf",
  namePrefix: "Hammersmith & Fulham",
  src: "https://www.lbhf.gov.uk/parking",
  ratePence: 250,
  maxStayHours: 4,
  hoursFields: ["DAYS", "TIME_"],
  zoneField: "ZONE_",
  defaultSched: [{ days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" }],
};

const hfFeature = (zone: string, days: string, time: string, lat: number, lng: number) => ({
  type: "Feature",
  properties: { ZONE_: zone, DAYS: days, TIME_: time },
  geometry: { type: "Polygon", coordinates: square(lat, lng, 0.01) },
});

const HF_FIXTURE: GeoFeatureCollection = {
  type: "FeatureCollection",
  features: [
    hfFeature("T", "Monday to Friday", "9.00am to 5.00pm", 51.49, -0.21),
    hfFeature("B", "Monday to Sunday", "8.30am to 11.00pm", 51.5, -0.22),
    // same code split across two polygons -> one merged record
    hfFeature("S", "Monday to Saturday", "9.00am to 5.00pm", 51.48, -0.2),
    hfFeature("S", "Monday to Saturday", "9.00am to 5.00pm", 51.485, -0.205),
  ],
};

describe("transformArcgisCpz — Hammersmith & Fulham (separate columns)", () => {
  const zones = transformArcgisCpz(HF_FIXTURE, "2026-07-19", HF_SPEC);

  it("produces one verified record per zone code, merging split polygons", () => {
    expect(zones.map((z) => z.id)).toEqual(["hf-b", "hf-s", "hf-t"]);
    expect(zones.find((z) => z.id === "hf-s")!.polys).toHaveLength(2);
    expect(zones.every((z) => z.verified)).toBe(true);
  });

  it("parses DAYS + TIME_ into engine schedules", () => {
    expect(zones.find((z) => z.id === "hf-t")!.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" },
    ]);
    // "Monday to Sunday" wraps through the week to all seven days
    expect(zones.find((z) => z.id === "hf-b")!.sched).toEqual([
      { days: [1, 2, 3, 4, 5, 6, 0], from: "08:30", to: "23:00" },
    ]);
  });
});

// --- Kingston shape: one combined TimeOfOperation string --------------------
const KNG_SPEC: ArcgisCpzSpec = {
  idPrefix: "kng",
  namePrefix: "Kingston upon Thames",
  src: "https://www.kingston.gov.uk/parking",
  ratePence: 340,
  maxStayHours: 4,
  hoursFields: ["TimeOfOperation"],
  defaultSched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
};

const kngFeature = (time: string, lat: number, lng: number) => ({
  type: "Feature",
  properties: { TimeOfOperation: time },
  geometry: { type: "Polygon", coordinates: square(lat, lng, 0.01) },
});

const KNG_FIXTURE: GeoFeatureCollection = {
  type: "FeatureCollection",
  features: [
    kngFeature("CPZ Mon-Sat excl Bank Hols 8.30am-6.30pm and Sun 11am-5pm Zone B - Canbury (Inner Area)", 51.41, -0.3),
    // same code, different area + hours -> a distinct record (not merged)
    kngFeature("CPZ Mon-Fri excl Bank Hols 10am-3pm Zone B - Canbury (Outer Area One)", 51.42, -0.31),
    kngFeature("CPZ Mon-Sat excl Bank Hols 11am-2pm Zone C - Canbury Gardens", 51.43, -0.32),
  ],
};

describe("transformArcgisCpz — Kingston (combined string)", () => {
  const zones = transformArcgisCpz(KNG_FIXTURE, "2026-07-19", KNG_SPEC);

  it("extracts code + area, keeping distinct hour variants of a code apart", () => {
    expect(zones.map((z) => z.id).sort()).toEqual([
      "kng-b-canbury-inner-area",
      "kng-b-canbury-outer-area-one",
      "kng-c-canbury-gardens",
    ]);
    expect(zones.find((z) => z.id === "kng-c-canbury-gardens")!.name).toBe(
      "Kingston upon Thames Zone C Canbury Gardens",
    );
  });

  it("strips 'excl Bank Hols' and parses split Mon-Sat/Sun hours", () => {
    const inner = zones.find((z) => z.id === "kng-b-canbury-inner-area")!;
    expect(inner.verified).toBe(true);
    expect(inner.sched).toEqual([
      { days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" },
      { days: [0], from: "11:00", to: "17:00" },
    ]);
  });
});

// --- Newham shape: place-name zones + an event-day status column ------------
// The layer publishes each zone's REGULAR hours and flags the London Stadium
// zones separately, so a zone that looks free on a Saturday may be controlled
// on a match day. Those must reach zones.events.json or the engine will badge
// them "free" (engine §12).
const NWM_SPEC: ArcgisCpzSpec = {
  idPrefix: "nwm",
  namePrefix: "Newham",
  src: "https://www.newham.gov.uk/parking-roads-travel",
  ratePence: 380,
  maxStayHours: 4,
  hoursFields: ["TIMES"],
  zoneField: "NAME",
  defaultSched: [{ days: [1, 2, 3, 4, 5], from: "08:00", to: "18:30" }],
  eventStatusField: "CPZ_Status",
  eventStatusMatch: /event\s*day/i,
  eventVenue: "London Stadium",
};

const nwmFeature = (name: string, times: string, status: string, lat: number, lng: number) => ({
  type: "Feature",
  properties: { NAME: name, TIMES: times, CPZ_Status: status },
  geometry: { type: "Polygon", coordinates: square(lat, lng, 0.01) },
});

const NWM_FIXTURE: GeoFeatureCollection = {
  type: "FeatureCollection",
  features: [
    nwmFeature("Stratford SW", "10am - 12 Noon (Mon-Fri)", "Event Day Parking Zone", 51.53, 0.0),
    nwmFeature("Ruskin", "9am - 5pm (Mon-Sat)", " ", 51.54, 0.01),
  ],
};

describe("transformArcgisCpz — Newham (place-name zones)", () => {
  const zones = transformArcgisCpz(NWM_FIXTURE, "2026-07-20", NWM_SPEC);

  it("does not dress a place name up as a zone code", () => {
    expect(zones.map((z) => z.name)).toEqual(["Newham Ruskin", "Newham Stratford SW"]);
  });

  it("still parses the published regular hours", () => {
    const ruskin = zones.find((z) => z.id === "nwm-ruskin")!;
    expect(ruskin.verified).toBe(true);
    expect(ruskin.sched).toEqual([{ days: [1, 2, 3, 4, 5, 6], from: "09:00", to: "17:00" }]);
  });
});

describe("transformArcgisEvents — status-column event zones", () => {
  const events = transformArcgisEvents(NWM_FIXTURE, "2026-07-20", NWM_SPEC);

  it("captures only the flagged zones", () => {
    expect(events).toHaveLength(1);
    expect(events[0].zoneKey).toBe("nwm-stratford-sw");
    expect(events[0].event.venue).toBe("London Stadium");
  });

  it("links to the id the zone pass emits, so the engine can join them", () => {
    const zones = transformArcgisCpz(NWM_FIXTURE, "2026-07-20", NWM_SPEC);
    expect(zones.some((z) => z.id === events[0].preciseZoneId)).toBe(true);
  });

  it("keeps the published hours as REGULAR hours, with no invented event sched", () => {
    expect(events[0].regularSched).toEqual([{ days: [1, 2, 3, 4, 5], from: "10:00", to: "12:00" }]);
    expect(events[0].event.sched).toEqual([]);
    expect(events[0].event.rawText).toContain("regular hours only");
  });

  it("emits nothing for a borough that declares no event column", () => {
    expect(transformArcgisEvents(HF_FIXTURE, "2026-07-20", HF_SPEC)).toEqual([]);
  });
});

// --- RBKC shape: one day+time clause per column, code repeated across areas --
const RBKC_SPEC: ArcgisCpzSpec = {
  idPrefix: "rbkc",
  namePrefix: "Kensington & Chelsea",
  src: "https://www.rbkc.gov.uk/parking/parking-zones-and-bays",
  ratePence: 650,
  maxStayHours: 4,
  hoursFields: ["Control_1", "Control_2", "Control_3"],
  zoneField: "Control",
  areaField: "Area_Name",
  hoursPerField: true,
  defaultSched: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" }],
};

const rbkcFeature = (
  control: string,
  area: string,
  c1: string,
  c2: string,
  c3: string,
  lat: number,
  lng: number,
) => ({
  type: "Feature",
  properties: { Control: control, Area_Name: area, Control_1: c1, Control_2: c2, Control_3: c3 },
  geometry: { type: "Polygon", coordinates: square(lat, lng, 0.01) },
});

const WEEKDAYS = "8:30am - 10:00pm Monday to Friday";
const RBKC_FIXTURE: GeoFeatureCollection = {
  type: "FeatureCollection",
  features: [
    rbkcFeature("Control 1", "Queensdale Area", WEEKDAYS, "8:30am - 6:30pm Saturday", "1:00pm - 5:00pm Sunday", 51.5, -0.21),
    // same code, different area -> must stay a separate record
    rbkcFeature("Control 1", "Knightsbridge Shopping Area", WEEKDAYS, "8:30am - 6:30pm Saturday", "1:00pm - 5:00pm Sunday", 51.49, -0.16),
    // event-conditional Sunday clause -> must not become regular hours
    rbkcFeature("Control 8", "Earls Court Exhibition Centre", WEEKDAYS, "8:30am - 6:30pm Saturday", "8.30am - 5pm Saturday to Sunday (on event days)", 51.49, -0.2),
    // unnamed area -> still imported, keyed on the control code alone
    rbkcFeature("Control 4", "", "8:30am - 6:30pm Monday to Friday", "8:30am - 1:30pm Saturday", "", 51.48, -0.18),
  ],
};

describe("transformArcgisCpz — RBKC (one clause per column)", () => {
  const zones = transformArcgisCpz(RBKC_FIXTURE, "2026-07-21", RBKC_SPEC);

  it("keeps a repeated control code separate per named area", () => {
    expect(zones.map((z) => z.id)).toEqual([
      "rbkc-control-1-knightsbridge-shopping-area",
      "rbkc-control-1-queensdale-area",
      "rbkc-control-4",
      "rbkc-control-8-earls-court-exhibition-centre",
    ]);
  });

  it("concatenates per-column clauses without inventing a phantom window", () => {
    // Joining the columns first makes the parser pair Saturday's 6:30pm end
    // with Monday-Friday, emitting an extra 08:30-18:30 weekday entry.
    expect(zones.find((z) => z.id === "rbkc-control-1-queensdale-area")!.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "22:00" },
      { days: [6], from: "08:30", to: "18:30" },
      { days: [0], from: "13:00", to: "17:00" },
    ]);
  });

  it("never lets an event-day clause become regular hours", () => {
    const earls = zones.find((z) => z.id === "rbkc-control-8-earls-court-exhibition-centre")!;
    expect(earls.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "22:00" },
      { days: [6], from: "08:30", to: "18:30" },
    ]);
    // no Sunday control on an ordinary week
    expect(earls.sched.some((s) => s.days.includes(0))).toBe(false);
    expect(earls.verified).toBe(true);
  });

  it("imports zones whose area column is blank", () => {
    const c4 = zones.find((z) => z.id === "rbkc-control-4")!;
    expect(c4.name).toBe("Kensington & Chelsea Control 4");
    expect(c4.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
      { days: [6], from: "08:30", to: "13:30" },
    ]);
  });
});

describe("transformArcgisEvents — clause-column event zones", () => {
  const events = transformArcgisEvents(RBKC_FIXTURE, "2026-07-21", RBKC_SPEC);

  it("captures only the zone with an event clause, verbatim", () => {
    expect(events).toHaveLength(1);
    expect(events[0].zoneKey).toBe("rbkc-control-8-earls-court-exhibition-centre");
    expect(events[0].event.rawText).toBe("8.30am - 5pm Saturday to Sunday (on event days)");
  });

  it("records the ordinary-week hours and invents no event schedule", () => {
    expect(events[0].eventOnly).toBe(false);
    expect(events[0].preciseZoneId).toBe("rbkc-control-8-earls-court-exhibition-centre");
    expect(events[0].event.sched).toEqual([]);
    expect(events[0].regularSched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "22:00" },
      { days: [6], from: "08:30", to: "18:30" },
    ]);
  });
});

// --- Tower Hamlets shape: geometry-only layer, hours from a verified table ---
const TWH_SPEC: ArcgisCpzSpec = {
  idPrefix: "twh",
  namePrefix: "Tower Hamlets",
  src: "https://www.towerhamlets.gov.uk/parking",
  ratePence: 450,
  maxStayHours: 4,
  hoursFields: [],
  zoneField: "ZONE_CODE",
  verifiedHours: {
    A3: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "17:30" }],
    B4: [{ days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "19:30" }],
  },
  verifiedEvents: {
    B4: { venue: "London Stadium", rawText: "Event days only sun 8.30am to 7.30pm" },
  },
  defaultSched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "17:30" }],
};

const twhFeature = (code: string, lat: number, lng: number) => ({
  type: "Feature",
  properties: { ZONE_CODE: code },
  geometry: { type: "Polygon", coordinates: square(lat, lng, 0.01) },
});

const TWH_FIXTURE: GeoFeatureCollection = {
  type: "FeatureCollection",
  features: [
    twhFeature("A3", 51.52, -0.06),
    twhFeature("B4", 51.51, -0.02),
    // a code with no table entry -> must fall back, and NOT claim to be verified
    twhFeature("Z9", 51.53, -0.05),
  ],
};

describe("transformArcgisCpz — Tower Hamlets (hours from verified table)", () => {
  const zones = transformArcgisCpz(TWH_FIXTURE, "2026-07-21", TWH_SPEC);

  it("takes hours from the table when the layer carries none", () => {
    expect(zones.find((z) => z.id === "twh-a3")!.sched).toEqual([
      { days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "17:30" },
    ]);
    expect(zones.find((z) => z.id === "twh-a3")!.verified).toBe(true);
  });

  it("leaves an untabulated zone on the indicative fallback, unverified", () => {
    const z9 = zones.find((z) => z.id === "twh-z9")!;
    expect(z9.sched).toEqual(TWH_SPEC.defaultSched);
    // rule 9: an unverified schedule must never be trusted to clear a restriction
    expect(z9.verified).toBe(false);
  });

  it("keeps event-day control out of B4's regular hours", () => {
    // Sunday is controlled ONLY on London Stadium event days
    expect(zones.find((z) => z.id === "twh-b4")!.sched).toEqual([
      { days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "19:30" },
    ]);
  });
});

describe("transformArcgisEvents — verified-table event zones", () => {
  const events = transformArcgisEvents(TWH_FIXTURE, "2026-07-21", TWH_SPEC);

  it("emits a record only for the declared code, so rule 12 can warn", () => {
    expect(events.map((e) => e.zoneKey)).toEqual(["twh-b4"]);
    expect(events[0].event.venue).toBe("London Stadium");
    expect(events[0].preciseZoneId).toBe("twh-b4");
  });

  it("carries the regular hours and invents no event schedule", () => {
    expect(events[0].event.sched).toEqual([]);
    expect(events[0].regularSched).toEqual([
      { days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "19:30" },
    ]);
  });
});

// --- Hillingdon shape: one zone code published with several different hours --
const HIL_SPEC: ArcgisCpzSpec = {
  idPrefix: "hil",
  namePrefix: "Hillingdon",
  src: "https://www.hillingdon.gov.uk/parking",
  ratePence: 300,
  maxStayHours: 4,
  hoursFields: ["Times"],
  zoneField: "Zones",
  areaField: "Label_2",
  defaultSched: [{ days: [1, 2, 3, 4, 5], from: "08:00", to: "18:30" }],
};

const hilFeature = (code: string, area: string, times: string, lat: number, lng: number) => ({
  type: "Feature",
  properties: { Zones: code, Label_2: area, Times: times },
  geometry: { type: "Polygon", coordinates: square(lat, lng, 0.01) },
});

const HIL_FIXTURE: GeoFeatureCollection = {
  type: "FeatureCollection",
  features: [
    // one code, two areas, genuinely different control
    hilFeature("H1", "Harmondsworth", "9am to 5pm - Mon to Fri", 51.48, -0.48),
    hilFeature("H1", "Harlington", "9am to 10pm - Mon to Sun", 51.49, -0.42),
    // identical rows for one area still collapse into a single record
    hilFeature("HY1", "Nield Road", "9am to 5pm - Mon to Sat", 51.51, -0.42),
    hilFeature("HY1", "Nield Road", "9am to 5pm - Mon to Sat", 51.515, -0.425),
    // blank hours -> indicative fallback, never presented as sourced
    hilFeature("TC", "Hayes Town", " ", 51.5, -0.41),
  ],
};

describe("transformArcgisCpz — Hillingdon (same code, differing hours)", () => {
  const zones = transformArcgisCpz(HIL_FIXTURE, "2026-07-21", HIL_SPEC);

  it("keeps each published schedule instead of letting the first row win", () => {
    // Merging H1 would apply Mon-Fri 9-5 to Harlington, whose evenings and
    // Sundays ARE controlled — the costly direction under rule 7.
    const harlington = zones.find((z) => z.id === "hil-h1-harlington")!;
    expect(harlington.sched).toEqual([
      { days: [1, 2, 3, 4, 5, 6, 0], from: "09:00", to: "22:00" },
    ]);
    expect(zones.find((z) => z.id === "hil-h1-harmondsworth")!.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" },
    ]);
  });

  it("still merges rows that agree, rather than splitting on geometry", () => {
    const hy1 = zones.filter((z) => z.id.startsWith("hil-hy1"));
    expect(hy1).toHaveLength(1);
    expect(hy1[0].polys).toHaveLength(2);
  });

  it("leaves a blank-hours zone indicative", () => {
    const tc = zones.find((z) => z.id.startsWith("hil-tc"))!;
    expect(tc.verified).toBe(false);
    expect(tc.sched).toEqual(HIL_SPEC.defaultSched);
  });
});

// --- Hackney shape: several clauses in ONE column, split on <br> -------------
const HCK_SPEC: ArcgisCpzSpec = {
  idPrefix: "hck",
  namePrefix: "Hackney",
  src: "https://www.hackney.gov.uk/parking-zones",
  ratePence: 500,
  maxStayHours: 4,
  hoursFields: ["controlled_hours"],
  zoneField: "zone",
  hoursPerField: true,
  hoursSplit: /<br\s*\/?>/i,
  defaultSched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
};

const hckFeature = (zone: string, hours: string, lat: number, lng: number) => ({
  type: "Feature",
  properties: { zone, controlled_hours: hours },
  geometry: { type: "Polygon", coordinates: square(lat, lng, 0.01) },
});

const HCK_FIXTURE: GeoFeatureCollection = {
  type: "FeatureCollection",
  features: [
    hckFeature("Zone F", "Mon-Fri 8.30am-6.30pm<br>Sat 8.30am-1.30pm", 51.55, -0.06),
    hckFeature("Zone G", "Mon-Fri 8.30am-6.30pm<br>Emirates Stadium events", 51.56, -0.09),
    hckFeature("Zone K", "Mon-Fri 8.30am-6.30pm<br>QEOP Stadium events", 51.54, -0.02),
  ],
};

describe("transformArcgisCpz — Hackney (clauses joined by <br>)", () => {
  const zones = transformArcgisCpz(HCK_FIXTURE, "2026-07-21", HCK_SPEC);

  it("splits the column so no phantom window is invented", () => {
    // Parsing "Mon-Fri 8.30am-6.30pm Sat 8.30am-1.30pm" as one string also
    // yields a bogus Sat 08:30-18:30 entry.
    expect(zones.find((z) => z.id === "hck-zone-f")!.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
      { days: [6], from: "08:30", to: "13:30" },
    ]);
  });

  it("drops a stadium-events clause from regular hours but keeps the zone", () => {
    const g = zones.find((z) => z.id === "hck-zone-g")!;
    expect(g.verified).toBe(true);
    expect(g.sched).toEqual([{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }]);
  });
});

describe("transformArcgisEvents — venue read from the clause", () => {
  const events = transformArcgisEvents(HCK_FIXTURE, "2026-07-21", HCK_SPEC);

  it("names the venue each zone actually borders", () => {
    expect(events.map((e) => [e.zoneKey, e.event.venue])).toEqual([
      ["hck-zone-g", "Emirates Stadium"],
      ["hck-zone-k", "QEOP Stadium"],
    ]);
  });

  it("leaves a zone with no event clause alone", () => {
    expect(events.some((e) => e.zoneKey === "hck-zone-f")).toBe(false);
  });
});
