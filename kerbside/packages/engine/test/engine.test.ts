import { describe, expect, it } from "vitest";
import {
  ALL_ZONES,
  BOROUGH_ZONES,
  carParkCost,
  controlledOverlapMin,
  DEFAULT_DATASET,
  evaluate,
  pointInPolygon,
  SPOTS,
  zoneAt,
  zoneRings,
  ZONES,
  type EvaluatedOption,
} from "../src/index.js";

// SPEC §6 engine scenarios. Fixed week in July 2026:
// Mon 13th, Tue 14th, Fri 17th, Sat 18th, Sun 19th (Europe/London, BST).
const ANGEL = { lat: 51.5322, lng: -0.1057 };
const CAMDEN_TOWN = { lat: 51.539, lng: -0.1426 };

const d = (day: number, h: number, m = 0) => new Date(2026, 6, day, h, m);

const byName = (res: EvaluatedOption[], name: string): EvaluatedOption => {
  const r = res.find((x) => x.spot.n === name);
  if (!r) throw new Error(name + " not in results");
  return r;
};

describe("SPEC §6 scenarios — Angel", () => {
  it("1. Tue 11:00–13:00: paid bays charge £13, res/yellows invalid, free street is BEST FREE", () => {
    const res = evaluate(ANGEL, d(14, 11), d(14, 13));

    const duncan = byName(res, "Duncan Street bays");
    expect(duncan.valid).toBe(true);
    expect(duncan.costPence).toBe(1300); // £6.50/h × 2h
    expect(byName(res, "Charlton Place bays").costPence).toBe(1300);

    expect(byName(res, "Gerrard Road (residents)").valid).toBe(false);
    expect(byName(res, "Colebrooke Row (single yellow)").valid).toBe(false);

    const wharf = byName(res, "Wharf Road (uncontrolled)");
    expect(wharf.valid).toBe(true);
    expect(wharf.costPence).toBe(0);
    expect(wharf.badges).toContain("free");
  });

  it("2. Tue 20:00–23:00: zone ended 18:30 so everything on-street is free; nearest bay sweeps the badges", () => {
    const res = evaluate(ANGEL, d(14, 20), d(14, 23));

    for (const r of res.filter((x) => x.spot.type !== "cp")) {
      expect(r.valid, r.spot.n).toBe(true);
      expect(r.costPence, r.spot.n).toBe(0);
    }

    const top = res[0];
    expect(top.spot.n).toBe("Duncan Street bays"); // nearest on-street option to Angel
    expect(top.badges).toEqual(expect.arrayContaining(["best", "free", "close"]));
  });

  it("3. Sat 15:00–18:00: Saturday control ended 13:30 — 7 free options", () => {
    const res = evaluate(ANGEL, d(18, 15), d(18, 18));
    const free = res.filter((r) => r.valid && r.costPence === 0);
    expect(free).toHaveLength(7);
    for (const r of free) expect(r.spot.type).not.toBe("cp");
  });

  it("4. Fri 20:00 – Sat 08:00 overnight: free — Saturday's 08:30 start is not breached", () => {
    const res = evaluate(ANGEL, d(17, 20), d(18, 8));
    for (const r of res.filter((x) => x.spot.type !== "cp")) {
      expect(r.valid, r.spot.n).toBe(true);
      expect(r.costPence, r.spot.n).toBe(0);
    }
    // car parks fall back to the evening flat rate for this window
    expect(byName(res, "N1 Centre Car Park").costPence).toBe(800);
  });

  it("5. Mon 09:00–17:00 (8h): bays invalid (4h max stay), car parks day-capped, free street wins", () => {
    const res = evaluate(ANGEL, d(13, 9), d(13, 17));

    expect(byName(res, "Duncan Street bays").valid).toBe(false);
    expect(byName(res, "Charlton Place bays").valid).toBe(false);

    expect(byName(res, "N1 Centre Car Park").costPence).toBe(2400); // 8h × £5.50 capped at £24
    expect(byName(res, "Business Design Centre CP").costPence).toBe(2200);

    const top = res[0];
    expect(top.spot.n).toBe("Wharf Road (uncontrolled)");
    expect(top.badges).toContain("best");
  });
});

describe("SPEC §6 scenarios — Camden Town", () => {
  it("6. Sat 21:00–23:00: CA-F(n) runs to 23:00 so bays still charge; car park evening rate wins", () => {
    const res = evaluate(CAMDEN_TOWN, d(18, 21), d(18, 23));

    const bays = byName(res, "Jamestown Road bays");
    expect(bays.valid).toBe(true);
    expect(bays.costPence).toBe(1600); // £8/h × 2h

    expect(byName(res, "Albert Street (residents)").valid).toBe(false);
    expect(byName(res, "Delancey Street (single yellow)").valid).toBe(false);

    const cp = byName(res, "Camden Market CP");
    expect(cp.costPence).toBe(900); // evening flat
    expect(cp.badges).toContain("best");
    expect(res[0].spot.n).toBe("Camden Market CP");
  });

  it("7. Sat 23:30 – Sun 01:00: control ends 23:00, Sunday starts 09:30 — all street options free", () => {
    const res = evaluate(CAMDEN_TOWN, d(18, 23, 30), d(19, 1));
    for (const r of res.filter((x) => x.spot.type !== "cp")) {
      expect(r.valid, r.spot.n).toBe(true);
      expect(r.costPence, r.spot.n).toBe(0);
    }
  });
});

describe("destination streets (zone lookup by polygon)", () => {
  // Real-postcode locations reported in user testing. The hand-drawn zone
  // polygons are gone: spatial lookup uses imported real boundaries only
  // (per-zone CPZs when the ETL has fetched them, else borough fallbacks).
  const N6_5TS = { lat: 51.5723, lng: -0.1455 }; // Highgate (Camden)
  const N1_2RE = { lat: 51.5385, lng: -0.0955 }; // Essex Road (Islington)

  it("hand-drawn zones no longer answer location lookups", () => {
    expect(zoneAt(N6_5TS, ZONES)).toBeUndefined();
    expect(ZONES.every((z) => !z.poly && !z.polys)).toBe(true);
  });

  it("N6 5TS on a Sunday: your own street is free and wins", () => {
    const res = evaluate(N6_5TS, d(19, 10), d(19, 12), DEFAULT_DATASET, {
      destinationStreets: true,
    });
    const top = res[0];
    expect(top.spot.n).toBe("Streets at your destination");
    expect(top.valid).toBe(true);
    expect(top.costPence).toBe(0);
    expect(top.badges).toContain("best");
  });

  it("N1 2RE Saturday morning: destination street is a paid option at the zone rate, hours in the note", () => {
    const res = evaluate(N1_2RE, d(18, 9), d(18, 11), DEFAULT_DATASET, {
      destinationStreets: true,
    });
    const street = byName(res, "Streets at your destination");
    expect(street.valid).toBe(true);
    expect(street.costPence).toBe(1300); // £6.50/h × 2h of Sat 08:30–13:30 control
    expect(street.note).toContain("Sat 08:30–13:30");
    expect(street.note).toContain("check signage");
  });

  it("outside every zone the destination street is free with a data caveat", () => {
    // Wimbledon (Merton) — no borough fallback configured there
    const res = evaluate({ lat: 51.42, lng: -0.21 }, d(14, 11), d(14, 13), DEFAULT_DATASET, {
      destinationStreets: true,
    });
    const street = byName(res, "Streets at your destination");
    expect(street.valid).toBe(true);
    expect(street.costPence).toBe(0);
    expect(street.note).toContain("No controls in our dataset");
  });

  it("is off by default so the SPEC §6 expectations are unchanged", () => {
    const res = evaluate(ANGEL, d(18, 15), d(18, 18));
    expect(res.find((r) => r.spot.n === "Streets at your destination")).toBeUndefined();
  });
});

describe("borough fallback zones (real boundary data)", () => {
  // Highbury: inside the real Islington borough boundary but outside every
  // hand-drawn specific zone — the case reported failing with N1 2RE.
  const HIGHBURY = { lat: 51.548, lng: -0.1 };

  it("resolves points to real borough boundaries when no specific zone matches", () => {
    expect(zoneAt(HIGHBURY, ALL_ZONES)?.id).toBe("boro-islington");
    expect(zoneAt({ lat: 51.5504, lng: -0.1425 }, ALL_ZONES)?.id).toBe("boro-camden"); // Kentish Town
    expect(zoneAt(ANGEL, ALL_ZONES)?.id).toBe("boro-islington"); // Angel too, until per-zone data is imported
    expect(zoneAt({ lat: 51.42, lng: -0.21 }, ALL_ZONES)).toBeUndefined(); // Wimbledon
  });

  it("imported per-zone CPZs outrank the borough fallback", () => {
    const fakePrecise = {
      ...BOROUGH_ZONES[0],
      id: "cam-test",
      name: "Camden TEST",
      kind: "cpz" as const,
      polys: [
        [
          [51.54, -0.11],
          [51.56, -0.11],
          [51.56, -0.09],
          [51.54, -0.09],
          [51.54, -0.11],
        ] as [number, number][],
      ],
    };
    expect(zoneAt(HIGHBURY, [fakePrecise, ...BOROUGH_ZONES])?.id).toBe("cam-test");
  });

  it("Sat 10:30–14:30 in Islington outside the curated zones now charges for the controlled hours", () => {
    const res = evaluate(HIGHBURY, d(18, 10, 30), d(18, 14, 30), DEFAULT_DATASET, {
      destinationStreets: true,
    });
    const street = byName(res, "Streets at your destination");
    expect(street.valid).toBe(true);
    expect(street.costPence).toBe(1950); // Sat control 08:30–13:30 → 3h × £6.50
    expect(street.note).toContain("Sat 08:30–13:30");
  });

  it("borough records are labelled unverified with a source and check date", () => {
    for (const z of BOROUGH_ZONES) {
      expect(z.verified).toBe(false);
      expect(z.src).toMatch(/^https:/);
      expect(z.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(zoneRings(z).length).toBeGreaterThan(0);
    }
  });
});

describe("engine internals", () => {
  const islington = ZONES.find((z) => z.id === "isA")!;

  it("computes controlled overlap per calendar day across multiple sched entries", () => {
    // Fri 17:00 → Sat 14:00 spans Fri 17:00–18:30 (90 min) + Sat 08:30–13:30 (300 min)
    expect(controlledOverlapMin(islington, d(17, 17), d(18, 14))).toBe(390);
    // Sunday: no control at all
    expect(controlledOverlapMin(islington, d(19, 9), d(19, 18))).toBe(0);
  });

  it("clips overlap to the stay window", () => {
    expect(controlledOverlapMin(islington, d(14, 18), d(14, 20))).toBe(30); // 18:00–18:30
  });

  it("denies the evening flat rate when the stay runs past 08:00 next morning", () => {
    const cp = SPOTS.find((s) => s.n === "N1 Centre Car Park")!;
    expect(carParkCost(cp, d(17, 20), d(18, 8)).costPence).toBe(800); // ends exactly 08:00 → flat
    const late = carParkCost(cp, d(17, 20), d(18, 9)); // 13h, ends 09:00 → hourly, capped
    expect(late.costPence).toBe(2400);
  });

  it("charges multi-day car park stays with the 24h day-max cap", () => {
    const cp = SPOTS.find((s) => s.n === "N1 Centre Car Park")!;
    // 30h from Mon 09:00: one full day max + remainder (6h × £5.50 = £33, capped at £24)
    expect(carParkCost(cp, d(13, 9), d(14, 15)).costPence).toBe(2400 + 2400);
  });
});
