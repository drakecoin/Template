import { describe, expect, it } from "vitest";
import type { ZoneRecord } from "../sources/boroughs.js";
import { classifyWay, transformOsmKerbs, type OsmResponse } from "../sources/osm.js";

const ZONE: ZoneRecord = {
  id: "boro-islington",
  name: "Islington CPZ",
  kind: "borough",
  verified: false,
  src: "https://example.test",
  checkedAt: "2026-07-18",
  sched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
  ratePence: 650,
  maxStayHours: 4,
  polys: [
    [
      [51.52, -0.13],
      [51.56, -0.13],
      [51.56, -0.08],
      [51.52, -0.08],
      [51.52, -0.13],
    ],
  ],
};

const way = (id: number, name: string, tags: Record<string, string>, lat = 51.54, lon = -0.1) => ({
  type: "way",
  id,
  center: { lat, lon },
  tags: { highway: "residential", name, ...tags },
});

const FIXTURE: OsmResponse = {
  elements: [
    way(1, "Ticket Street", { "parking:both": "lane", "parking:both:restriction": "ticket" }),
    way(2, "Ticket Street", { "parking:left": "lane", "parking:left:fee": "yes" }, 51.541, -0.101),
    way(3, "Resident Road", { "parking:lane:both": "parallel", "parking:condition:both": "residents" }),
    way(4, "Banned Alley", { "parking:both": "no" }),
    way(5, "Free Way", { "parking:right": "lane" }),
    way(6, "Orphan Road", { "parking:both": "lane", "parking:both:restriction": "residents" }, 51.6, -0.3),
  ],
};

describe("transformOsmKerbs", () => {
  const spots = transformOsmKerbs(FIXTURE, [ZONE]);

  it("classifies both modern and legacy schemas", () => {
    expect(classifyWay({ "parking:both": "lane", "parking:both:restriction": "ticket" })).toBe("paid");
    expect(classifyWay({ "parking:lane:both": "parallel", "parking:condition:both": "residents" })).toBe("res");
    expect(classifyWay({ "parking:both": "no" })).toBeNull();
    expect(classifyWay({ "parking:right": "lane" })).toBe("freeSt");
  });

  it("groups ways by street + type, joins zones, drops banned and orphan streets", () => {
    expect(spots.map((s) => s.n)).toEqual([
      "Free Way (free kerb)",
      "Resident Road (resident kerb)",
      "Ticket Street (on-street parking)",
    ]);
    const ticket = spots[2];
    expect(ticket.type).toBe("paid");
    expect(ticket.zone).toBe("boro-islington");
    expect(ticket.note).toContain("2 segments");
    expect(spots.find((s) => s.n.startsWith("Banned"))).toBeUndefined();
    expect(spots.find((s) => s.n.startsWith("Orphan"))).toBeUndefined();
  });
});
