import { describe, expect, it } from "vitest";
import { transformIshareEvents, type IshareCpzSpec } from "../sources/ishareCpz.js";
import { parseEventControl } from "../sources/eventControl.js";

describe("parseEventControl", () => {
  it("returns null when there is no event clause", () => {
    expect(parseEventControl("Monday to Friday 10am to 12 noon", false)).toBeNull();
  });

  it("parses an addendum clause: venue, weekday windows and bank-holiday window", () => {
    const ev = parseEventControl(
      "Monday to Sunday: 8am - 6.30pm, and on event days (Tottenham Hotspur Stadium): Monday to Friday 8am - 8.30pm, Saturday and Sunday 8am - 8pm, and Public Holidays 12 noon - 8pm",
      false,
    );
    expect(ev).not.toBeNull();
    expect(ev!.venue).toBe("Tottenham Hotspur Stadium");
    expect(ev!.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:00", to: "20:30" },
      { days: [6, 0], from: "08:00", to: "20:00" },
    ]);
    expect(ev!.bankHoliday).toEqual({ from: "12:00", to: "20:00" });
    // the raw clause is preserved for the future feature to re-parse if needed
    expect(ev!.rawText).toContain("Tottenham Hotspur Stadium");
  });

  it("treats an event-only entry as all-event, with no regular hours", () => {
    const ev = parseEventControl(
      "Monday to Friday: 5pm to 8.30pm, and Saturday, Sunday and Public Holidays: 12 noon to 8pm",
      true,
    );
    expect(ev!.sched).toEqual([{ days: [1, 2, 3, 4, 5], from: "17:00", to: "20:30" }]);
    expect(ev!.bankHoliday).toEqual({ from: "12:00", to: "20:00" });
  });
});

const SPEC: IshareCpzSpec = {
  idPrefix: "hgy",
  namePrefix: "Haringey",
  src: "https://haringey.gov.uk/parking/cpzs/all-cpz-hours",
  ratePence: 420,
  maxStayHours: 4,
  nameField: "cpz_name",
  hoursField: "op_times",
};

const ring = (e: number, n: number, d: number) =>
  [e, n, e + d, n, e + d, n + d, e, n + d, e, n].map((v) => v.toFixed(2)).join(" ");
const member = (name: string, hours: string, e: number, n: number) => `
  <gml:featureMember><ms:Controlled_Parking_Zones>
    <ms:msGeometry><gml:MultiSurface><gml:surfaceMembers><gml:Polygon><gml:exterior>
      <gml:LinearRing><gml:posList srsDimension="2">${ring(e, n, 200)}</gml:posList></gml:LinearRing>
    </gml:exterior></gml:Polygon></gml:surfaceMembers></gml:MultiSurface></ms:msGeometry>
    <ms:cpz_name>${name}</ms:cpz_name><ms:op_times>${hours}</ms:op_times>
  </ms:Controlled_Parking_Zones></gml:featureMember>`;

const GML = `<wfs:FeatureCollection>
  ${member("Bounds Green", "Monday to Friday 10am to 12 Noon", 530371, 191454)}
  ${member("White Hart Lane", "Monday to Sunday: 8am - 6.30pm, and on event days (Tottenham Hotspur Stadium): Monday to Friday 8am - 8.30pm", 533500, 191500)}
  ${member("Tottenham Event Day", "Monday to Friday: 5pm to 8.30pm, and Saturday, Sunday and Public Holidays: 12 noon to 8pm", 533600, 190600)}
</wfs:FeatureCollection>`;

describe("transformIshareEvents", () => {
  const events = transformIshareEvents(GML, "2026-07-19", SPEC);

  it("captures only zones with an event component (skips plain CPZs)", () => {
    expect(events.map((e) => e.zoneKey)).toEqual(["hgy-tottenham-event-day", "hgy-white-hart-lane"]);
  });

  it("keeps regular hours + a precise link for addendum zones", () => {
    const whl = events.find((e) => e.zoneKey === "hgy-white-hart-lane")!;
    expect(whl.eventOnly).toBe(false);
    expect(whl.preciseZoneId).toBe("hgy-white-hart-lane");
    expect(whl.regularSched).toEqual([{ days: [1, 2, 3, 4, 5, 6, 0], from: "08:00", to: "18:30" }]);
    expect(whl.polys.length).toBeGreaterThan(0);
  });

  it("marks event-only zones with no regular hours and no precise link", () => {
    const ted = events.find((e) => e.zoneKey === "hgy-tottenham-event-day")!;
    expect(ted.eventOnly).toBe(true);
    expect(ted.regularSched).toBeNull();
    expect(ted.preciseZoneId).toBeNull();
    expect(ted.rawOpTimes).toContain("12 noon to 8pm");
  });
});
