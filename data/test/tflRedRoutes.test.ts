import { describe, expect, it } from "vitest";
import {
  isNoStopping,
  transformRedRoutes,
  type OsmGeomResponse,
} from "../sources/tflRedRoutes.js";

// A ~1.4 km east–west way along a fixed latitude (0.02° lng ≈ 1.4 km at 51.5°),
// so sampling every 350 m yields several points.
const longWay = (id: number, name: string, tags: Record<string, string>) => ({
  type: "way",
  id,
  tags: { highway: "primary", name, ...tags },
  geometry: [
    { lat: 51.52, lon: -0.14 },
    { lat: 51.52, lon: -0.12 },
  ],
});

const FIXTURE: OsmGeomResponse = {
  elements: [
    longWay(1, "Euston Road", { "parking:both": "no", "parking:both:restriction": "no_stopping" }),
    // legacy condition scheme, single node -> one point
    {
      type: "way",
      id: 2,
      tags: { highway: "primary", name: "Marylebone Road", "parking:condition:left": "no_stopping" },
      geometry: [{ lat: 51.5222, lon: -0.1552 }],
    },
    // a way that merely allows parking must never become a no-stopping spot
    longWay(3, "Quiet Street", { "parking:both": "lane", "parking:both:restriction": "ticket" }),
  ],
};

describe("isNoStopping", () => {
  it("matches no_stopping across the modern, condition and lane schemes", () => {
    expect(isNoStopping({ "parking:both:restriction": "no_stopping" })).toBe(true);
    expect(isNoStopping({ "parking:condition:left": "no_stopping" })).toBe(true);
    expect(isNoStopping({ "parking:lane:right": "no_stopping" })).toBe(true);
    expect(isNoStopping({ "parking:both": "no_stopping" })).toBe(true);
  });
  it("does not match other parking values or unrelated keys", () => {
    expect(isNoStopping({ "parking:both:restriction": "ticket" })).toBe(false);
    expect(isNoStopping({ "parking:both": "no" })).toBe(false);
    expect(isNoStopping({ note: "no_stopping" })).toBe(false);
  });
});

describe("transformRedRoutes", () => {
  const spots = transformRedRoutes(FIXTURE);

  it("emits only no-stopping ways, all typed noStop", () => {
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every((s) => s.type === "noStop")).toBe(true);
    expect(spots.some((s) => s.n.startsWith("Quiet Street"))).toBe(false);
    expect(spots.some((s) => s.n.startsWith("Euston Road"))).toBe(true);
    expect(spots.some((s) => s.n.startsWith("Marylebone Road"))).toBe(true);
  });

  it("samples multiple points along a long way but only one for a single node", () => {
    const euston = spots.filter((s) => s.n.startsWith("Euston Road"));
    const marylebone = spots.filter((s) => s.n.startsWith("Marylebone Road"));
    expect(euston.length).toBeGreaterThan(2); // ~1.4 km / 350 m
    expect(marylebone).toHaveLength(1);
    expect(euston[0].note).toContain("no stopping");
  });

  it("dedupes coincident points on the grid", () => {
    const dup: OsmGeomResponse = {
      elements: [
        {
          type: "way",
          id: 10,
          tags: { highway: "primary", name: "Same Spot", "parking:both:restriction": "no_stopping" },
          geometry: [
            { lat: 51.5, lon: -0.1 },
            { lat: 51.500001, lon: -0.100001 },
          ],
        },
      ],
    };
    expect(transformRedRoutes(dup)).toHaveLength(1);
  });
});
