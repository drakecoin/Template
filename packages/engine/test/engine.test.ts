import { describe, expect, it } from "vitest";
import {
  ALL_ZONES,
  BOROUGH_ZONES,
  carParkCost,
  controlledOverlapMin,
  evaluate,
  EVENT_CONTROLS,
  nearestPointInZone,
  offZoneStreetSpots,
  SPOTS,
  zoneAt,
  zoneRings,
  ZONES,
  type EvaluatedOption,
  type EventControl,
} from "../src/index.js";

// SPEC §6 engine scenarios. Fixed week in July 2026:
// Mon 13th, Tue 14th, Fri 17th, Sat 18th, Sun 19th (Europe/London, BST).
const ANGEL = { lat: 51.5322, lng: -0.1057 };
const CAMDEN_TOWN = { lat: 51.539, lng: -0.1426 };

// DEFAULT_DATASET grows as `npm run etl` imports real zones and kerb spots, so
// machines differ. Tests pin explicit datasets: the curated demo data for the
// SPEC scenarios, and the committed borough tier for fallback behaviour.
const CURATED = { zones: ZONES, spots: SPOTS };
const BOROUGH_DATASET = { zones: BOROUGH_ZONES, spots: SPOTS };

const d = (day: number, h: number, m = 0) => new Date(2026, 6, day, h, m);

// On-street types that become free parking once controlled hours end. Excludes
// car parks (always charge) and no-stopping / no-loading areas (never a bay).
const PARKABLE_STREET = new Set(["paid", "res", "yellow", "freeSt"]);

const byName = (res: EvaluatedOption[], name: string): EvaluatedOption => {
  const r = res.find((x) => x.spot.n === name);
  if (!r) throw new Error(name + " not in results");
  return r;
};

describe("SPEC §6 scenarios — Angel", () => {
  it("1. Tue 11:00–13:00: paid bays charge £13, res/yellows invalid, free street is BEST FREE", () => {
    const res = evaluate(ANGEL, d(14, 11), d(14, 13), CURATED);

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
    const res = evaluate(ANGEL, d(14, 20), d(14, 23), CURATED);

    for (const r of res.filter((x) => PARKABLE_STREET.has(x.spot.type))) {
      expect(r.valid, r.spot.n).toBe(true);
      expect(r.costPence, r.spot.n).toBe(0);
    }

    const top = res[0];
    expect(top.spot.n).toBe("Duncan Street bays"); // nearest on-street option to Angel
    expect(top.badges).toEqual(expect.arrayContaining(["best", "free", "close"]));
  });

  it("3. Sat 15:00–18:00: Saturday control ended 13:30 — 7 free options", () => {
    const res = evaluate(ANGEL, d(18, 15), d(18, 18), CURATED);
    const free = res.filter((r) => r.valid && r.costPence === 0);
    expect(free).toHaveLength(7);
    for (const r of free) expect(r.spot.type).not.toBe("cp");
  });

  it("4. Fri 20:00 – Sat 08:00 overnight: free — Saturday's 08:30 start is not breached", () => {
    const res = evaluate(ANGEL, d(17, 20), d(18, 8), CURATED);
    for (const r of res.filter((x) => PARKABLE_STREET.has(x.spot.type))) {
      expect(r.valid, r.spot.n).toBe(true);
      expect(r.costPence, r.spot.n).toBe(0);
    }
    // car parks fall back to the evening flat rate for this window
    expect(byName(res, "N1 Centre Car Park").costPence).toBe(800);
  });

  it("5. Mon 09:00–17:00 (8h): bays invalid (4h max stay), car parks day-capped, free street wins", () => {
    const res = evaluate(ANGEL, d(13, 9), d(13, 17), CURATED);

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
    const res = evaluate(CAMDEN_TOWN, d(18, 21), d(18, 23), CURATED);

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
    const res = evaluate(CAMDEN_TOWN, d(18, 23, 30), d(19, 1), CURATED);
    for (const r of res.filter((x) => PARKABLE_STREET.has(x.spot.type))) {
      expect(r.valid, r.spot.n).toBe(true);
      expect(r.costPence, r.spot.n).toBe(0);
    }
  });
});

describe("no-stopping and no-loading areas", () => {
  it("red routes are never parkable, whatever the time", () => {
    // The pan-London red-route network is imported (RED_ROUTE_SPOTS) rather than
    // hand-seeded, so pin an explicit noStop spot to test the engine behaviour.
    const redSpot = {
      n: "Camden High Street (red route)",
      type: "noStop" as const,
      lat: CAMDEN_TOWN.lat,
      lng: CAMDEN_TOWN.lng,
      note: "TfL red route — no stopping at any time",
    };
    const ds = { zones: ZONES, spots: [redSpot] };
    const day = evaluate(CAMDEN_TOWN, d(14, 11), d(14, 13), ds);
    const night = evaluate(CAMDEN_TOWN, d(18, 23, 30), d(19, 1), ds);
    for (const res of [day, night]) {
      const red = byName(res, "Camden High Street (red route)");
      expect(red.valid).toBe(false);
      expect(red.typeLabel).toBe("No stopping");
      expect(red.badges).toHaveLength(0);
      expect(red.note).toContain("no stopping");
    }
  });

  it("a loading ban's note is time-aware but it is never a ranked bay", () => {
    // Parkway ban runs Mon–Sat 07:00–10:00.
    const during = byName(evaluate(CAMDEN_TOWN, d(14, 8), d(14, 9), CURATED), "Parkway loading ban");
    expect(during.valid).toBe(false);
    expect(during.note).toContain("active during your times");
    expect(during.note).toContain("07:00–10:00");

    const after = byName(evaluate(CAMDEN_TOWN, d(14, 11), d(14, 13), CURATED), "Parkway loading ban");
    expect(after.valid).toBe(false); // advisory only — never recommended as parking
    expect(after.note).toContain("not active for your times");
    expect(after.badges).toHaveLength(0);
  });

  it("restriction areas never sort above valid options", () => {
    const res = evaluate(CAMDEN_TOWN, d(14, 11), d(14, 13), CURATED);
    const firstInvalid = res.findIndex((r) => !r.valid);
    const lastValid = res.map((r) => r.valid).lastIndexOf(true);
    expect(firstInvalid).toBeGreaterThan(lastValid);
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
    const res = evaluate(N6_5TS, d(19, 10), d(19, 12), BOROUGH_DATASET, {
      destinationStreets: true,
    });
    const top = res[0];
    expect(top.spot.n).toBe("Streets at your destination");
    expect(top.valid).toBe(true);
    expect(top.costPence).toBe(0);
    expect(top.badges).toContain("best");
  });

  it("N1 2RE Saturday morning: an active zone yields an advisory, never an invented priced bay", () => {
    const res = evaluate(N1_2RE, d(18, 9), d(18, 11), BOROUGH_DATASET, {
      destinationStreets: true,
    });
    const street = byName(res, "Streets at your destination");
    // A zone polygon means "controlled area", not "there is a payable bay on
    // this street" — pricing one from the polygon invents a bay that may not
    // exist and hides that the kerb could be resident-only.
    expect(street.spot.type).toBe("cpzStreet");
    expect(street.valid).toBe(false);
    expect(street.costPence).toBe(0);
    expect(street.badges).toEqual([]);
    expect(street.note).toContain("Sat 08:30–13:30");
    expect(street.note).toContain("no kerb-level bay data");
  });

  it("outside every zone the destination street is free with a data caveat", () => {
    // Surrey, well outside Greater London — no borough boundary reaches here
    const res = evaluate({ lat: 51.2, lng: -0.2 }, d(14, 11), d(14, 13), BOROUGH_DATASET, {
      destinationStreets: true,
    });
    const street = byName(res, "Streets at your destination");
    expect(street.valid).toBe(true);
    expect(street.costPence).toBe(0);
    expect(street.note).toContain("No controls in our dataset");
  });

  // Reported: N6 5TS, Mon 10:15–12:15. The containing zone was controlled, but
  // a zone two minutes' walk away was NOT — and the app never offered it,
  // because nothing curated sits inside it. It instead offered a car park and
  // an invented "paid bay" on the destination street.
  describe("nearby zones that are off during the stay", () => {
    const CONTROLLED = {
      id: "z-here",
      name: "Test Zone Here",
      kind: "cpz" as const,
      verified: true,
      src: "https://example.gov.uk/cpz",
      sched: [{ days: [1, 2, 3, 4, 5], from: "10:00", to: "12:00" }],
      ratePence: 420,
      maxStayHours: 2,
      // a box around (51.5720, -0.1450)
      polys: [[[51.570, -0.147], [51.574, -0.147], [51.574, -0.143], [51.570, -0.143], [51.570, -0.147]] as [number, number][]],
    };
    // Directly east, sharing the -0.143 edge; controlled in the afternoon only.
    const OFF_PEAK = {
      ...CONTROLLED,
      id: "z-next",
      name: "Test Zone Next",
      sched: [{ days: [1, 2, 3, 4, 5], from: "14:00", to: "16:00" }],
      polys: [[[51.570, -0.143], [51.574, -0.143], [51.574, -0.139], [51.570, -0.139], [51.570, -0.143]] as [number, number][]],
    };
    const HERE = { lat: 51.572, lng: -0.1455 };
    const DATASET = { zones: [CONTROLLED, OFF_PEAK], spots: SPOTS };

    it("offers the closest point in the uncontrolled zone as free parking", () => {
      const res = evaluate(HERE, d(13, 10, 15), d(13, 12, 15), DATASET, {
        destinationStreets: true,
      });
      const next = byName(res, "Test Zone Next — nearest street");
      expect(next.valid).toBe(true);
      expect(next.costPence).toBe(0);
      expect(next.note).toContain("isn't controlled during your times");
      // and it really is the closest point in that zone, not its centroid
      expect(next.km).toBeLessThan(0.35);
      expect(zoneAt({ lat: next.spot.lat, lng: next.spot.lng }, [CONTROLLED, OFF_PEAK])?.id)
        .toBe("z-next");
    });

    it("beats the controlled destination street, which is not parkable", () => {
      const res = evaluate(HERE, d(13, 10, 15), d(13, 12, 15), DATASET, {
        destinationStreets: true,
      });
      expect(byName(res, "Streets at your destination").valid).toBe(false);
      const free = res.find((r) => r.badges.includes("free"));
      expect(free?.spot.n).toBe("Test Zone Next — nearest street");
    });

    it("does not offer a zone that is controlled during the stay", () => {
      const res = evaluate(HERE, d(13, 14, 15), d(13, 15, 15), DATASET, {
        destinationStreets: true,
      });
      expect(res.find((r) => r.spot.n === "Test Zone Next — nearest street")).toBeUndefined();
    });

    it("never offers a zone with no boundary geometry", () => {
      // The curated ZONES carry hours but no rings. Without a guard, the
      // nearest-point fallback answers the destination itself, so an Islington
      // zone gets offered as "nearest street" to someone standing in Tottenham.
      const ringless = { ...OFF_PEAK, id: "z-ringless", name: "Ringless Zone", polys: undefined };
      const res = evaluate(HERE, d(13, 10, 15), d(13, 12, 15), {
        zones: [CONTROLLED, ringless],
        spots: SPOTS,
      }, { destinationStreets: true });
      expect(res.find((r) => r.spot.n.startsWith("Ringless Zone"))).toBeUndefined();
      expect(nearestPointInZone(HERE, ringless)).toBeUndefined();
    });

    it("never offers borough-level or unverified zones — those hours are guesses", () => {
      const indicative = { ...OFF_PEAK, id: "b-next", name: "Borough Next", kind: "borough" as const };
      const res = evaluate(HERE, d(13, 10, 15), d(13, 12, 15), {
        zones: [CONTROLLED, indicative],
        spots: SPOTS,
      }, { destinationStreets: true });
      expect(res.find((r) => r.spot.n === "Borough Next — nearest street")).toBeUndefined();
    });
  });

  // The ETL strips event-day clauses out of zone `sched` so a match-day-only
  // zone is never shown as always-controlled. The cost of that trade: a zero
  // overlap means "off on regular hours", NOT "off today". Recommending such a
  // zone as free is a PCN on a fixture day.
  describe("event-day controls", () => {
    const OFF_TODAY = {
      id: "z-spurs",
      name: "Tottenham North",
      kind: "cpz" as const,
      verified: true,
      src: "https://haringey.gov.uk/parking",
      sched: [{ days: [1, 2, 3, 4, 5], from: "08:00", to: "18:30" }], // weekdays only
      ratePence: 420,
      maxStayHours: 4,
      polys: [[[51.570, -0.075], [51.574, -0.075], [51.574, -0.071], [51.570, -0.071], [51.570, -0.075]] as [number, number][]],
    };
    const EVENT: EventControl = {
      zoneId: "z-spurs",
      name: "Tottenham North",
      venue: "Tottenham Hotspur Stadium",
      sched: [{ days: [0, 6], from: "08:00", to: "20:00" }],
      rawText: "on event days: 8am - 8pm",
    };
    const bay = {
      n: "Test street bay",
      type: "res" as const,
      zone: "z-spurs",
      lat: 51.572,
      lng: -0.073,
      note: "resident bays",
    };
    const HERE = { lat: 51.572, lng: -0.073 };
    // Sunday — the zone's regular hours don't run, so the engine sees it as off.
    const SUNDAY: [Date, Date] = [d(19, 10), d(19, 12)];

    it("warns that a free option is only free when there's no event", () => {
      const res = evaluate(HERE, ...SUNDAY, {
        zones: [OFF_TODAY], spots: [bay], events: [EVENT],
      });
      const r = byName(res, "Test street bay");
      expect(r.valid).toBe(true);
      expect(r.costPence).toBe(0);
      expect(r.eventRisk?.venue).toBe("Tottenham Hotspur Stadium");
      expect(r.warn).toContain("Tottenham Hotspur Stadium");
      expect(r.warn).toContain("event days");
    });

    it("never badges a free option whose freeness depends on there being no event", () => {
      const res = evaluate(HERE, ...SUNDAY, {
        zones: [OFF_TODAY], spots: [bay], events: [EVENT],
      });
      expect(byName(res, "Test street bay").badges).toEqual([]);
    });

    it("badges it normally once the event control is gone", () => {
      const res = evaluate(HERE, ...SUNDAY, { zones: [OFF_TODAY], spots: [bay] });
      const r = byName(res, "Test street bay");
      expect(r.eventRisk).toBeUndefined();
      expect(r.badges.length).toBeGreaterThan(0);
    });

    it("covers the synthesised off-zone suggestion too — the path that created this risk", () => {
      const res = evaluate({ lat: 51.572, lng: -0.0762 }, ...SUNDAY, {
        zones: [OFF_TODAY], spots: [], events: [EVENT],
      }, { destinationStreets: true });
      const r = byName(res, "Tottenham North — nearest street");
      expect(r.valid).toBe(true);
      expect(r.eventRisk?.venue).toBe("Tottenham Hotspur Stadium");
      expect(r.badges).toEqual([]);
    });

    it("prefers an unconditional zone over an event-day one for the suggestion slots", () => {
      const clean = {
        ...OFF_TODAY,
        id: "z-clean",
        name: "Clean Zone",
        // further away than z-spurs from the search point below
        polys: [[[51.570, -0.086], [51.574, -0.086], [51.574, -0.082], [51.570, -0.082], [51.570, -0.086]] as [number, number][]],
      };
      const spots = offZoneStreetSpots(
        { lat: 51.572, lng: -0.0785 }, [OFF_TODAY, clean], d(19, 10), d(19, 12), [], [EVENT],
      );
      expect(spots[0].zone).toBe("z-clean");
    });

    it("the real Haringey dataset flags its event zones", () => {
      const ids = new Set(EVENT_CONTROLS.map((e) => e.zoneId));
      expect(ids.size).toBeGreaterThanOrEqual(12);
      // every flagged zone must actually exist in the engine's zone list
      for (const e of EVENT_CONTROLS) {
        expect(ALL_ZONES.find((z) => z.id === e.zoneId), e.zoneId).toBeDefined();
        expect(e.venue.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Mapillary parking-sign observations (non-virtual cpzStreet)", () => {
    const zone = {
      id: "z-sign",
      name: "Sign Test Zone",
      kind: "cpz" as const,
      verified: true,
      src: "https://example.gov.uk",
      sched: [{ days: [1, 2, 3, 4, 5], from: "10:00", to: "12:00" }],
      ratePence: 420,
      maxStayHours: 2,
      polys: [[[51.50, -0.11], [51.52, -0.11], [51.52, -0.09], [51.50, -0.09], [51.50, -0.11]] as [number, number][]],
    };
    // A detected parking sign, exactly as the Mapillary importer emits it.
    const sign = {
      n: "Parking sign (check bay type) · seen 2026-01",
      type: "cpzStreet" as const,
      zone: "z-sign",
      lat: 51.51,
      lng: -0.1,
      note: "Parking-place sign seen here (Mapillary, 2026-01-17) — check the plate",
    };
    const HERE = { lat: 51.51, lng: -0.1 };

    it("is a priced-nothing advisory during controlled hours, never a payable bay", () => {
      const res = evaluate(HERE, d(13, 10, 30), d(13, 11, 30), { zones: [zone], spots: [sign] });
      const r = byName(res, sign.n);
      expect(r.valid).toBe(false);
      expect(r.typeLabel).not.toBe("Paid bay");
      expect(r.costPence).toBe(0);
      expect(r.note).toContain("Mapillary");
    });

    it("is free when the zone is off, but never wins a badge — a sign isn't a confirmed bay", () => {
      const res = evaluate(HERE, d(19, 10), d(19, 12), { zones: [zone], spots: [sign] });
      const r = byName(res, sign.n);
      expect(r.valid).toBe(true);
      expect(r.costPence).toBe(0);
      expect(r.badges).toEqual([]);
    });

    it("does not out-rank the destination street for the badges", () => {
      const res = evaluate(HERE, d(19, 10), d(19, 12), { zones: [zone], spots: [sign] }, {
        destinationStreets: true,
      });
      const best = res.find((r) => r.badges.includes("best"));
      expect(best?.spot.n).toBe("Streets at your destination");
    });
  });

  describe("area-wide hours never clear a specific kerb", () => {
    const boroughZone = BOROUGH_ZONES.find((z) => z.id === "boro-islington")!;
    const resBay = {
      n: "Test resident bay",
      type: "res" as const,
      zone: boroughZone.id,
      lat: 51.548,
      lng: -0.1,
      note: "imported from OSM tagging",
    };

    it("a resident bay governed by an indicative borough schedule is never 'open to everyone'", () => {
      // Sunday: the borough-wide guess says no control, but the real zone hours
      // for this street are unknown — occupying a resident bay is the offence.
      const res = evaluate({ lat: 51.548, lng: -0.1 }, d(19, 10), d(19, 12), {
        zones: BOROUGH_ZONES,
        spots: [resBay],
      });
      const bay = byName(res, "Test resident bay");
      expect(bay.valid).toBe(false);
      expect(bay.note).toContain("borough-wide");
    });

    it("a verified per-zone schedule still clears a resident bay outside hours", () => {
      const res = evaluate(ANGEL, d(19, 10), d(19, 12), CURATED);
      const bay = byName(res, "Gerrard Road (residents)");
      expect(bay.valid).toBe(true);
      expect(bay.costPence).toBe(0);
    });
  });

  it("is off by default so the SPEC §6 expectations are unchanged", () => {
    const res = evaluate(ANGEL, d(18, 15), d(18, 18), CURATED);
    expect(res.find((r) => r.spot.n === "Streets at your destination")).toBeUndefined();
  });
});

describe("borough fallback zones (real boundary data)", () => {
  // Highbury: inside the real Islington borough boundary but outside every
  // hand-drawn specific zone — the case reported failing with N1 2RE.
  const HIGHBURY = { lat: 51.548, lng: -0.1 };

  it("resolves points to real borough boundaries when no specific zone matches", () => {
    expect(zoneAt(HIGHBURY, BOROUGH_ZONES)?.id).toBe("boro-islington");
    expect(zoneAt({ lat: 51.5504, lng: -0.1425 }, BOROUGH_ZONES)?.id).toBe("boro-camden"); // Kentish Town
    expect(zoneAt(ANGEL, BOROUGH_ZONES)?.id).toBe("boro-islington"); // Angel too, until per-zone data is imported
    expect(zoneAt({ lat: 51.2, lng: -0.2 }, BOROUGH_ZONES)).toBeUndefined(); // Surrey, outside London
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

  it("Sat 10:30–14:30 in Islington: a borough-wide polygon can't price a bay on one street", () => {
    const res = evaluate(HIGHBURY, d(18, 10, 30), d(18, 14, 30), BOROUGH_DATASET, {
      destinationStreets: true,
    });
    const street = byName(res, "Streets at your destination");
    expect(street.valid).toBe(false);
    expect(street.costPence).toBe(0);
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
