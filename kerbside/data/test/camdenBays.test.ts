import { describe, expect, it } from "vitest";
import type { GeoFeatureCollection } from "../geo.js";
import type { ZoneRecord } from "../sources/boroughs.js";
import { baySpotType, transformCamdenBays } from "../sources/camdenBays.js";

const ZONE: ZoneRecord = {
  id: "cam-ca-d",
  name: "Camden CA-D",
  kind: "cpz",
  verified: true,
  src: "https://example.test",
  checkedAt: "2026-07-18",
  sched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
  ratePence: 700,
  maxStayHours: 4,
  polys: [
    [
      [51.52, -0.16],
      [51.56, -0.16],
      [51.56, -0.1],
      [51.52, -0.1],
      [51.52, -0.16],
    ],
  ],
};

const bay = (street: string, type: string, lat: number, lng: number, spaces?: number) => ({
  type: "Feature",
  properties: { street_name: street, restriction_type: type, number_of_spaces: spaces },
  geometry: { type: "Point", coordinates: [lng, lat] },
});

const FIXTURE: GeoFeatureCollection = {
  type: "FeatureCollection",
  features: [
    bay("JAMESTOWN ROAD", "paid-for", 51.539, -0.1462, 6),
    bay("JAMESTOWN ROAD", "paid-for", 51.5392, -0.146, 4),
    bay("ALBERT'S STREET", "resident permit holders only", 51.5364, -0.1443, 12),
    bay("SOMEWHERE OUTSIDE", "resident permit holders only", 51.6, -0.3, 4), // outside every zone
    bay("PRATT STREET", "disabled (blue badge)", 51.537, -0.144, 2), // not offerable
  ],
};

describe("transformCamdenBays", () => {
  const spots = transformCamdenBays(FIXTURE, [ZONE]);

  it("groups bays by street + type with summed spaces and a centroid position", () => {
    expect(spots.map((s) => s.n)).toEqual([
      "Albert's Street (resident bays)",
      "Jamestown Road (paid bays)",
    ]);
    const jamestown = spots[1];
    expect(jamestown.type).toBe("paid");
    expect(jamestown.note).toContain("10 spaces");
    expect(jamestown.lat).toBeCloseTo(51.5391, 4);
  });

  it("spatially joins controlled bays to their zone, dropping orphans", () => {
    expect(spots.every((s) => s.zone === "cam-ca-d")).toBe(true);
    expect(spots.find((s) => s.n.startsWith("Somewhere"))).toBeUndefined();
  });

  it("maps portal bay descriptions to engine spot types, exclusions first", () => {
    expect(baySpotType("paid-for")).toBe("paid");
    expect(baySpotType("paid-for / resident permit holders")).toBe("paid"); // shared-use
    expect(baySpotType("resident permit holders only")).toBe("res");
    expect(baySpotType("permit holders only")).toBe("res");
    expect(baySpotType("paid-for (solo motorcycles only)")).toBeNull();
    expect(baySpotType("free (buses)")).toBeNull();
    expect(baySpotType("disabled (blue badge)")).toBeNull();
    expect(baySpotType("electric vehicle recharging")).toBeNull();
    expect(baySpotType("car club")).toBeNull();
    expect(baySpotType("free")).toBe("freeSt");
  });
});
