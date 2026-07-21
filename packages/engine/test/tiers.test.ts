import { describe, expect, it } from "vitest";
import { ALL_ZONES } from "../src/data.js";
import { zoneHoursTrusted } from "../src/engine.js";
import { TIER, byTrust, tierCanClearRestriction, zoneGeomTier, zoneTier } from "../src/tiers.js";
import type { Zone } from "../src/types.js";

const zone = (over: Partial<Zone>): Zone => ({
  id: "z",
  name: "Z",
  verified: true,
  src: "https://example.gov.uk",
  sched: [{ days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" }],
  ratePence: 500,
  maxStayHours: 4,
  ...over,
});

describe("source tiers", () => {
  it("only council and above may clear a restriction", () => {
    expect(tierCanClearRestriction(TIER.USER)).toBe(true);
    expect(tierCanClearRestriction(TIER.COUNCIL)).toBe(true);
    // An authority feed about OTHER roads, a detected sign, crowd tagging and
    // our own estimate all describe the kerb too weakly to call it free.
    expect(tierCanClearRestriction(TIER.AUTHORITY)).toBe(false);
    expect(tierCanClearRestriction(TIER.DETECTED)).toBe(false);
    expect(tierCanClearRestriction(TIER.COMMUNITY)).toBe(false);
    expect(tierCanClearRestriction(TIER.ESTIMATE)).toBe(false);
  });

  it("derives a tier for curated zones that predate the field", () => {
    expect(zoneTier(zone({ verified: true }))).toBe(TIER.COUNCIL);
    expect(zoneTier(zone({ verified: false }))).toBe(TIER.ESTIMATE);
    expect(zoneTier(zone({ kind: "borough", verified: true }))).toBe(TIER.ESTIMATE);
  });

  it("tiers the HOURS, not the geometry", () => {
    // An exact council polygon whose hours we could not parse carries the
    // borough estimate, and must not be trusted to clear a kerb.
    const unparsed = zone({ kind: "cpz", verified: false, tier: TIER.ESTIMATE });
    expect(zoneHoursTrusted(unparsed)).toBe(false);
  });

  it("keeps zoneHoursTrusted aligned with the tier", () => {
    expect(zoneHoursTrusted(zone({ tier: TIER.COUNCIL }))).toBe(true);
    expect(zoneHoursTrusted(zone({ tier: TIER.COMMUNITY }))).toBe(false);
  });

  it("orders by tier first, then most recently checked", () => {
    const rows = [
      zone({ id: "old-council", tier: TIER.COUNCIL, checkedAt: "2020-01-01" }),
      zone({ id: "estimate", tier: TIER.ESTIMATE, checkedAt: "2026-07-21" }),
      zone({ id: "new-council", tier: TIER.COUNCIL, checkedAt: "2026-07-21" }),
    ];
    expect(rows.sort(byTrust<Zone>(zoneTier)).map((r) => r.id)).toEqual([
      "new-council",
      "old-council",
      // a fresh estimate never beats stale council data
      "estimate",
    ]);
  });

  it("orders the real dataset by boundary precision, so zoneAt lands on the CPZ", () => {
    // zoneAt returns the FIRST containing zone, and a borough outline contains
    // every CPZ inside it — so council polygons must all precede fallbacks.
    const geom = ALL_ZONES.map(zoneGeomTier);
    expect([...geom].sort((a, b) => a - b)).toEqual(geom);
  });

  it("keeps boundary tier independent of hours tier", () => {
    // A council polygon we could not read the hours off still has a
    // council-grade boundary, and must not sort behind a borough outline.
    const unreadable = zone({ kind: "cpz", tier: TIER.ESTIMATE, polys: [[[51, -0.1]]] });
    expect(zoneTier(unreadable)).toBe(TIER.ESTIMATE);
    expect(zoneGeomTier(unreadable)).toBe(TIER.COUNCIL);
  });

  it("has no live tier-1 data yet — user reports are not wired in", () => {
    // Guards the claim in tiers.ts: if this ever fails, the "Update me" loop
    // has started feeding the engine and its verification story must be real.
    expect(ALL_ZONES.some((z) => zoneTier(z) === TIER.USER)).toBe(false);
  });
});
