import { describe, expect, it } from "vitest";
import type { GeoFeatureCollection } from "../geo.js";
import { transformArcgisCpz, type ArcgisCpzSpec } from "../sources/arcgisCpz.js";

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
