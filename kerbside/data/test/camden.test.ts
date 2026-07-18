import { describe, expect, it } from "vitest";
import type { GeoFeatureCollection } from "../geo.js";
import { transformCamdenFeatures } from "../sources/camden.js";

// Shaped like the Camden portal's CPZ layer: one polygon feature per zone
// area, with a zone code, display name and free-text controlled hours.
const square = (lat: number, lng: number, d: number) => [
  [
    [lng, lat],
    [lng + d, lat],
    [lng + d, lat + d],
    [lng, lat + d],
    [lng, lat],
  ],
];

const FIXTURE: GeoFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        cpz_code: "CA-D",
        cpz_name: "King's Cross",
        controlled_hours: "Mon-Fri 8:30am-6:30pm; Sat 8:30am-1:30pm",
      },
      geometry: { type: "Polygon", coordinates: square(51.53, -0.125, 0.01) },
    },
    {
      type: "Feature",
      properties: {
        cpz_code: "CA-G",
        cpz_name: "Gospel Oak",
        controlled_hours: "Mon-Fri 9am-5pm",
      },
      geometry: { type: "Polygon", coordinates: square(51.554, -0.155, 0.01) },
    },
    {
      type: "Feature",
      properties: {
        cpz_code: "CA-G",
        cpz_name: "Gospel Oak",
        controlled_hours: "Mon-Fri 9am-5pm",
      },
      geometry: { type: "Polygon", coordinates: square(51.556, -0.143, 0.008) },
    },
    {
      type: "Feature",
      properties: { cpz_code: "CA-X", cpz_name: "Mystery", controlled_hours: "see signs" },
      geometry: { type: "Polygon", coordinates: square(51.54, -0.15, 0.01) },
    },
  ],
};

describe("transformCamdenFeatures", () => {
  const zones = transformCamdenFeatures(FIXTURE, "2026-07-18");

  it("produces one record per zone code, merging multi-part zones", () => {
    expect(zones.map((z) => z.id)).toEqual(["cam-ca-d", "cam-ca-g", "cam-ca-x"]);
    const gospelOak = zones.find((z) => z.id === "cam-ca-g")!;
    expect(gospelOak.polys).toHaveLength(2);
  });

  it("uses our verified hours for known zones and marks them verified", () => {
    const kingsCross = zones.find((z) => z.id === "cam-ca-d")!;
    expect(kingsCross.verified).toBe(true);
    expect(kingsCross.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
      { days: [6], from: "08:30", to: "13:30" },
    ]);
  });

  it("parses portal hours text for unknown zones, unverified", () => {
    const gospelOak = zones.find((z) => z.id === "cam-ca-g")!;
    expect(gospelOak.verified).toBe(false);
    expect(gospelOak.sched).toEqual([{ days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" }]);
  });

  it("falls back to the Camden default schedule when hours text is unparseable", () => {
    const mystery = zones.find((z) => z.id === "cam-ca-x")!;
    expect(mystery.verified).toBe(false);
    expect(mystery.sched[0]).toEqual({ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" });
  });

  it("converts rings to [lat, lng] with the ring closed", () => {
    const kingsCross = zones.find((z) => z.id === "cam-ca-d")!;
    const ring = kingsCross.polys[0];
    expect(ring[0][0]).toBeCloseTo(51.53, 5); // lat first
    expect(ring[0][1]).toBeCloseTo(-0.125, 5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
