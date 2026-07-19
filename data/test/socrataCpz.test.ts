import { describe, expect, it } from "vitest";
import type { GeoFeatureCollection } from "../geo.js";
import { transformCpzFeatures, type CpzSpec } from "../sources/socrataCpz.js";

// The Camden portal, expressed as a registry-derived CpzSpec — exercises the
// generic transform against Camden's real live schema.
const CAMDEN_SPEC: CpzSpec = {
  idPrefix: "cam",
  namePrefix: "Camden",
  src: "https://www.camden.gov.uk/controlled-parking-zones",
  ratePence: 700,
  maxStayHours: 4,
  verifiedHours: {
    CAFN: [
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "23:00" },
      { days: [0, 6], from: "09:30", to: "23:00" },
    ],
  },
  defaultSched: [
    { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
    { days: [6], from: "08:30", to: "13:30" },
  ],
};

// Shaped like Camden's live CPZ layer: one polygon per sub-zone area with
// per-day-group control fields (nullable) and a display name.
const square = (lat: number, lng: number, d: number) => [
  [
    [lng, lat],
    [lng + d, lat],
    [lng + d, lat + d],
    [lng, lat + d],
    [lng, lat],
  ],
];

const feature = (
  sub: string,
  name: string,
  mf: string | null,
  sat: string | null,
  sun: string | null,
  lat: number,
  lng: number,
) => ({
  type: "Feature",
  properties: {
    sub_zone_name: sub,
    controlled_parking_zone_code: sub.replace(/[^A-Za-z]/g, "").toUpperCase(),
    controlled_parking_zone_name: name,
    control_monday_to_friday: mf,
    control_saturday: sat,
    control_sunday: sun,
  },
  geometry: { type: "Polygon", coordinates: square(lat, lng, 0.01) },
});

const FIXTURE: GeoFeatureCollection = {
  type: "FeatureCollection",
  features: [
    feature("CA-B", "CA-B Belsize", "09:00-18:30", "09:30-13:30", null, 51.55, -0.17),
    feature("CA-H(b)", "CA-H(b) Hampstead and Vale of Heath", "09:00-20:00", "09:00-20:00", null, 51.556, -0.176),
    // multi-part sub-zone: two polygons, one record
    feature("CA-M", "CA-M East Kentish Town", "08:30-18:30", null, null, 51.552, -0.135),
    feature("CA-M", "CA-M East Kentish Town", "08:30-18:30", null, null, 51.549, -0.132),
    // no control fields at all: falls back to our verified table by code
    {
      type: "Feature",
      properties: { sub_zone_name: "CA-F(n)", controlled_parking_zone_name: "CA-F(n) Camden Town" },
      geometry: { type: "Polygon", coordinates: square(51.54, -0.146, 0.01) },
    },
  ],
};

describe("transformCpzFeatures (Camden live portal schema)", () => {
  const zones = transformCpzFeatures(FIXTURE, "2026-07-18", CAMDEN_SPEC);

  it("produces one record per sub-zone with the council display name", () => {
    expect(zones.map((z) => z.id)).toEqual(["cam-ca-b", "cam-ca-f-n", "cam-ca-h-b", "cam-ca-m"]);
    expect(zones.find((z) => z.id === "cam-ca-b")!.name).toBe("Camden CA-B Belsize");
    expect(zones.find((z) => z.id === "cam-ca-m")!.polys).toHaveLength(2);
  });

  it("builds schedules from the per-day control fields, marked verified", () => {
    const belsize = zones.find((z) => z.id === "cam-ca-b")!;
    expect(belsize.verified).toBe(true);
    expect(belsize.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:30" },
      { days: [6], from: "09:30", to: "13:30" },
    ]);
    const kentishTown = zones.find((z) => z.id === "cam-ca-m")!;
    expect(kentishTown.sched).toEqual([{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }]);
  });

  it("falls back to our verified table (normalized code) when control fields are missing", () => {
    const camdenTown = zones.find((z) => z.id === "cam-ca-f-n")!;
    expect(camdenTown.verified).toBe(true);
    expect(camdenTown.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "23:00" },
      { days: [0, 6], from: "09:30", to: "23:00" },
    ]);
  });

  it("converts rings to closed [lat, lng]", () => {
    const ring = zones.find((z) => z.id === "cam-ca-b")!.polys[0];
    expect(ring[0][0]).toBeCloseTo(51.55, 5);
    expect(ring[0][1]).toBeCloseTo(-0.17, 5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
