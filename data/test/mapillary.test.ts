import { describe, expect, it } from "vitest";
import { buildSpots, signToSpotType } from "../sources/mapillary.js";

describe("mapillary sign mapping", () => {
  it("maps no-stopping and clearway signs to noStop", () => {
    expect(signToSpotType("regulatory--no-stopping--g1")?.type).toBe("noStop");
    expect(signToSpotType("regulatory--clearway--g1")?.type).toBe("noStop");
  });

  it("maps no-loading signs to noLoad", () => {
    expect(signToSpotType("regulatory--no-loading--g1")?.type).toBe("noLoad");
  });

  it("ignores non-regulatory and unrelated signs", () => {
    expect(signToSpotType("regulatory--maximum-speed-limit-30--g1")).toBeNull();
    expect(signToSpotType("information--parking--g1")).toBeNull();
    expect(signToSpotType("warning--curve-left--g1")).toBeNull();
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
});
