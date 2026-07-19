import { describe, expect, it } from "vitest";
import { baseControlText, transformIshareCpz, type IshareCpzSpec } from "../sources/ishareCpz.js";

const SPEC: IshareCpzSpec = {
  idPrefix: "hgy",
  namePrefix: "Haringey",
  src: "https://haringey.gov.uk/parking/cpzs/all-cpz-hours",
  ratePence: 420,
  maxStayHours: 4,
  nameField: "cpz_name",
  hoursField: "op_times",
};

// A square ring in British National Grid (EPSG:27700), ~Haringey.
const ring = (e: number, n: number, d: number) =>
  [e, n, e + d, n, e + d, n + d, e, n + d, e, n].map((v) => v.toFixed(2)).join(" ");

const member = (name: string, hours: string, e: number, n: number) => `
  <gml:featureMember>
    <ms:Controlled_Parking_Zones>
      <ms:msGeometry><gml:MultiSurface srsName="EPSG:27700"><gml:surfaceMembers>
        <gml:Polygon><gml:exterior><gml:LinearRing>
          <gml:posList srsDimension="2">${ring(e, n, 200)}</gml:posList>
        </gml:LinearRing></gml:exterior></gml:Polygon>
      </gml:surfaceMembers></gml:MultiSurface></ms:msGeometry>
      <ms:cpz_name>${name}</ms:cpz_name>
      <ms:op_times>${hours}</ms:op_times>
    </ms:Controlled_Parking_Zones>
  </gml:featureMember>`;

const GML = `<?xml version="1.0"?><wfs:FeatureCollection>
  ${member("Bounds Green", "Monday to Friday 10am to 12 Noon", 530371, 191454)}
  ${member("Bruce Grove West", "Monday to Friday: 2 - 4pm", 533800, 190800)}
  ${member("White Hart Lane", "Monday to Sunday: 8am - 6.30pm, and on event days (Tottenham Hotspur Stadium): Monday to Friday 8am - 8.30pm", 533500, 191500)}
  ${member("Tottenham Event Day", "Monday to Friday: 5pm to 8.30pm, and Saturday, Sunday and Public Holidays: 12 noon to 8pm", 533600, 190600)}
</wfs:FeatureCollection>`;

describe("baseControlText", () => {
  it("drops the '…and on event days…' addendum", () => {
    expect(baseControlText("Mon to Fri 8am to 6.30pm, and on event days: 8am to 8.30pm")).toBe(
      "Mon to Fri 8am to 6.30pm",
    );
  });
  it("returns '' when the entry is event-day-only", () => {
    expect(baseControlText("Event Days (Tottenham Hotspur Stadium): Monday to Friday: 5pm - 8.30pm")).toBe("");
  });
});

describe("transformIshareCpz (Haringey iShare WFS)", () => {
  const zones = transformIshareCpz(GML, "2026-07-19", SPEC);

  it("skips event-day-only zones (named '… Event Day')", () => {
    expect(zones.map((z) => z.id)).toEqual([
      "hgy-bounds-green",
      "hgy-bruce-grove-west",
      "hgy-white-hart-lane",
    ]);
  });

  it("parses free-text hours, treating '12 Noon' as midday", () => {
    expect(zones.find((z) => z.id === "hgy-bounds-green")!.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "10:00", to: "12:00" },
    ]);
  });

  it("reads a bare '2 - 4pm' range as afternoon (copies the trailing meridiem)", () => {
    expect(zones.find((z) => z.id === "hgy-bruce-grove-west")!.sched).toEqual([
      { days: [1, 2, 3, 4, 5], from: "14:00", to: "16:00" },
    ]);
  });

  it("imports only the non-event base hours for event-addendum zones", () => {
    const whl = zones.find((z) => z.id === "hgy-white-hart-lane")!;
    expect(whl.verified).toBe(true);
    expect(whl.sched).toEqual([{ days: [1, 2, 3, 4, 5, 6, 0], from: "08:00", to: "18:30" }]);
  });

  it("reprojects BNG geometry into WGS84 over Haringey", () => {
    const ring0 = zones.find((z) => z.id === "hgy-bounds-green")!.polys[0];
    const [lat, lng] = ring0[0];
    expect(lat).toBeGreaterThan(51.55);
    expect(lat).toBeLessThan(51.65);
    expect(lng).toBeGreaterThan(-0.2);
    expect(lng).toBeLessThan(-0.05);
  });
});
