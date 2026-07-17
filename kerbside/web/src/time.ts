export type PresetKey = "now2" | "now4" | "evening" | "overnight" | "satmorn" | "sunday";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "now2", label: "Now · 2 hrs" },
  { key: "now4", label: "Now · 4 hrs" },
  { key: "evening", label: "This evening" },
  { key: "overnight", label: "Overnight" },
  { key: "satmorn", label: "Sat morning" },
  { key: "sunday", label: "Sunday" },
];

export function toLocalISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    "T" + p(d.getHours()) + ":" + p(d.getMinutes())
  );
}

function roundQ(input: Date): Date {
  const d = new Date(input);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}

export function presetWindow(key: PresetKey, now = new Date()): { start: Date; end: Date } {
  const nextDow = (dow: number, h: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + (((dow - d.getDay() + 7) % 7) || 7));
    d.setHours(h, 0, 0, 0);
    return d;
  };
  let s: Date;
  let e: Date;
  if (key === "now2") {
    s = roundQ(now);
    e = new Date(s.getTime() + 2 * 36e5);
  } else if (key === "now4") {
    s = roundQ(now);
    e = new Date(s.getTime() + 4 * 36e5);
  } else if (key === "evening") {
    s = new Date(now);
    s.setHours(19, 0, 0, 0);
    if (s < now) s.setDate(s.getDate() + 1);
    e = new Date(s);
    e.setHours(23, 0);
  } else if (key === "overnight") {
    s = new Date(now);
    s.setHours(20, 0, 0, 0);
    if (s < now) s.setDate(s.getDate() + 1);
    e = new Date(s);
    e.setDate(e.getDate() + 1);
    e.setHours(8, 0);
  } else if (key === "satmorn") {
    s = nextDow(6, 9);
    e = new Date(s);
    e.setHours(12, 0);
  } else {
    s = nextDow(0, 10);
    e = new Date(s);
    e.setHours(17, 0);
  }
  return { start: s, end: e };
}

export function fmtDT(d: Date): string {
  return (
    d.toLocaleDateString("en-GB", { weekday: "short" }) + " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

export function gmapsLink(lat: number, lng: number): string {
  return (
    "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng + "&travelmode=driving"
  );
}
