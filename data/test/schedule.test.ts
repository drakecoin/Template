import { describe, expect, it } from "vitest";
import { parseScheduleText } from "../schedule.js";

describe("parseScheduleText", () => {
  it("parses 'Mon-Fri 8:30am-6:30pm'", () => {
    expect(parseScheduleText("Mon-Fri 8:30am-6:30pm")).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
    ]);
  });

  it("parses long day names and dotted times: 'Monday to Saturday 8.30am - 1.30pm'", () => {
    expect(parseScheduleText("Monday to Saturday 8.30am - 1.30pm")).toEqual([
      { days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "13:30" },
    ]);
  });

  it("parses multiple segments: 'Mon-Fri 08:30-18:30; Sat 09:30-13:30'", () => {
    expect(parseScheduleText("Mon-Fri 08:30-18:30; Sat 09:30-13:30")).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
      { days: [6], from: "09:30", to: "13:30" },
    ]);
  });

  it("parses 'Every day 8:30am-11pm'", () => {
    expect(parseScheduleText("Every day 8:30am-11pm")).toEqual([
      { days: [0, 1, 2, 3, 4, 5, 6], from: "08:30", to: "23:00" },
    ]);
  });

  it("wraps weekend ranges: 'Sat-Sun 9:30am-5:30pm'", () => {
    expect(parseScheduleText("Sat-Sun 9:30am-5:30pm")).toEqual([
      { days: [6, 0], from: "09:30", to: "17:30" },
    ]);
  });

  it("infers pm on the start when only the end is marked: 'Mon-Fri 8.30-6.30pm'", () => {
    expect(parseScheduleText("Mon-Fri 8.30-6.30pm")).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
    ]);
  });

  it("parses time-first am/pm form: '8:30am - 5:30pm Monday - Friday' (Lambeth)", () => {
    expect(parseScheduleText("8:30am - 5:30pm Monday - Friday")).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "17:30" },
    ]);
  });

  it("captures Saturday in a time-first Mon–Sat range (never hides weekend control)", () => {
    expect(parseScheduleText("8:30am - 6:30pm Monday - Saturday")).toEqual([
      { days: [1, 2, 3, 4, 5, 6], from: "08:30", to: "18:30" },
    ]);
    expect(
      parseScheduleText("8:30am - 6:30pm Monday - Friday and 8:30am - 1:00pm Saturday"),
    ).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
      { days: [6], from: "08:30", to: "13:00" },
    ]);
  });

  it("dedupes and keeps split midday periods in time-first strings", () => {
    expect(
      parseScheduleText("8:30am - 6:30pm Monday - Friday & 10am - 12pm Mon - Fri"),
    ).toEqual([
      { days: [1, 2, 3, 4, 5], from: "08:30", to: "18:30" },
      { days: [1, 2, 3, 4, 5], from: "10:00", to: "12:00" },
    ]);
  });

  it("reads 'at any time' / '24 hours' as round-the-clock every day", () => {
    const allWeek = [{ days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" }];
    expect(parseScheduleText("At any time")).toEqual(allWeek);
    expect(parseScheduleText("At Any Time (permit holders only)")).toEqual(allWeek);
    expect(parseScheduleText("24 hours")).toEqual(allWeek);
  });

  it("handles noon and midnight (Harrow): '8am - Midnight Mon - Sun'", () => {
    expect(parseScheduleText("8am - Midnight Mon - Sun")).toEqual([
      { days: [1, 2, 3, 4, 5, 6, 0], from: "08:00", to: "23:59" },
    ]);
    expect(parseScheduleText("11am - 12 noon Mon - Fri")).toEqual([
      { days: [1, 2, 3, 4, 5], from: "11:00", to: "12:00" },
    ]);
  });

  it("infers the start meridiem from the end: '2 - 3pm' is 2pm, not 2am", () => {
    expect(parseScheduleText("2 - 3pm Mon - Fri")).toEqual([
      { days: [1, 2, 3, 4, 5], from: "14:00", to: "15:00" },
    ]);
    // but only when it keeps the range valid: "8 - 6.30pm" is 8am, not 8pm
    expect(parseScheduleText("8 - 6.30pm Mon - Sat")).toEqual([
      { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "18:30" },
    ]);
  });

  it("applies one trailing day-group to every period: '10am - 11am & 3pm - 4pm Mon - Fri'", () => {
    expect(parseScheduleText("10am - 11am & 3pm - 4pm Mon - Fri")).toEqual([
      { days: [1, 2, 3, 4, 5], from: "10:00", to: "11:00" },
      { days: [1, 2, 3, 4, 5], from: "15:00", to: "16:00" },
    ]);
  });

  it("returns null for unrecognisable or ambiguous text instead of guessing", () => {
    expect(parseScheduleText("See street signage")).toBeNull();
    expect(parseScheduleText("")).toBeNull();
    // no meridiems at all — don't guess whether "8-6.30" is am or pm
    expect(parseScheduleText("8-6.30 Mon - Sat")).toBeNull();
  });
});
