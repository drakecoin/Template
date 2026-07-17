import { describe, expect, it } from "vitest";
import {
  carParkCost,
  controlledOverlapMin,
  evaluate,
  SPOTS,
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
