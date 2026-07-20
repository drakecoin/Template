import { describe, expect, it } from "vitest";
import type { ZoneRecord } from "../sources/boroughs.js";
import { buildSpots, lat2tile, lon2tile, signToSpotType } from "../sources/mapillary.js";

describe("mapillary sign mapping", () => {
  it("maps no-stopping and clearway signs to noStop", () => {
    expect(signToSpotType("regulatory--no-stopping--g1")?.type).toBe("noStop");
    expect(signToSpotType("regulatory--clearway--g1")?.type).toBe("noStop");
  });

  it("maps no-loading signs to noLoad", () => {
    expect(signToSpotType("regulatory--no-loading--g1")?.type).toBe("noLoad");
  });

  it("maps parking / CPZ signs to a cpzStreet advisory, not a priced bay", () => {
    // A sign detection reads the sign class, never the plate beneath, so it
    // can't confirm a payable bay (vs resident-only) — engine rule 8.
    expect(signToSpotType("information--parking--g1")?.type).toBe("cpzStreet");
    expect(signToSpotType("information--parking--g5")?.type).toBe("cpzStreet");
  });

  it("never maps a no-parking sign to a parkable bay", () => {
    expect(signToSpotType("regulatory--no-parking--g1")).toBeNull();
    // the combined sign is a no-stopping restriction, not a bay
    expect(signToSpotType("regulatory--no-parking-or-no-stopping--g1")?.type).toBe("noStop");
  });

  it("excludes ambiguous parking signs that aren't bays", () => {
    expect(signToSpotType("regulatory--end-of-parking-zone--g2")).toBeNull();
    expect(signToSpotType("regulatory--parking-restrictions--g2")).toBeNull();
  });

  it("ignores unrelated signs", () => {
    expect(signToSpotType("regulatory--maximum-speed-limit-30--g1")).toBeNull();
    expect(signToSpotType("warning--curve-left--g1")).toBeNull();
  });
});

describe("mapillary slippy-tile math", () => {
  it("increases x with longitude and y as latitude falls (north = smaller y)", () => {
    expect(lon2tile(-0.2, 14)).toBeLessThan(lon2tile(0.0, 14));
    expect(lat2tile(51.56, 14)).toBeLessThan(lat2tile(51.46, 14));
  });

  it("places central London in the expected z14 tile", () => {
    // Trafalgar Square-ish (lng -0.128, lat 51.508)
    expect(lon2tile(-0.128, 14)).toBe(8186);
    expect(lat2tile(51.508, 14)).toBe(5448);
  });
});

describe("mapillary buildSpots (dedupe + newest-wins)", () => {
  const feat = (value: string, lng: number, lat: number, last: number) => ({
    object_value: value,
    geometry: { coordinates: [lng, lat] as [number, number] },
    last_seen_at: last,
  });
  const JUN_2024 = Date.UTC(2024, 5, 1);
  const JUN_2025 = Date.UTC(2025, 5, 1);

  it("keeps only the most recent detection of the same sign at one spot", () => {
    const spots = buildSpots([
      feat("regulatory--no-stopping--g1", -0.14, 51.53, JUN_2024),
      feat("regulatory--no-stopping--g1", -0.140001, 51.530001, JUN_2025), // ~0.1m away, newer
    ]);
    expect(spots).toHaveLength(1);
    expect(spots[0].date).toBe("2025-06-01");
  });

  it("keeps distinct signs and distinct nearby classes", () => {
    const spots = buildSpots([
      feat("regulatory--no-stopping--g1", -0.14, 51.53, JUN_2025),
      feat("regulatory--no-loading--g1", -0.14, 51.53, JUN_2025), // same spot, different class
      feat("regulatory--no-stopping--g1", -0.20, 51.50, JUN_2025), // far away
    ]);
    expect(spots).toHaveLength(3);
    expect(new Set(spots.map((s) => s.type))).toEqual(new Set(["noStop", "noLoad"]));
  });

  it("drops detections with no usable class or coordinates", () => {
    const spots = buildSpots([
      { object_value: "warning--curve-left--g1", geometry: { coordinates: [-0.14, 51.53] }, last_seen_at: JUN_2025 },
      { object_value: "regulatory--no-stopping--g1", last_seen_at: JUN_2025 },
    ]);
    expect(spots).toHaveLength(0);
  });

  // A box around central London (rings are [lat,lng]).
  const ZONE = {
    id: "z-test",
    polys: [[[51.52, -0.16], [51.55, -0.16], [51.55, -0.12], [51.52, -0.12], [51.52, -0.16]]],
  } as unknown as ZoneRecord;

  it("joins a parking sign to its containing zone", () => {
    const spots = buildSpots([feat("information--parking--g1", -0.14, 51.53, JUN_2025)], [ZONE]);
    expect(spots).toHaveLength(1);
    expect(spots[0].type).toBe("cpzStreet");
    expect(spots[0].zone).toBe("z-test");
  });

  it("drops a parking sign that falls outside every zone", () => {
    const spots = buildSpots([feat("information--parking--g1", -0.30, 51.60, JUN_2025)], [ZONE]);
    expect(spots).toHaveLength(0);
  });
});
