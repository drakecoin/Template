// "Update me" sign reports: read a photo's location from its EXIF GPS tags,
// fall back to the device's location, and persist reports in the browser.
// No backend in this repo — reports live in localStorage for later review.

export type LocationSource = "photo-exif" | "device-gps" | "manual";

export interface ReportLocation {
  lat: number;
  lng: number;
  source: LocationSource;
}

export interface ParkingReport {
  id: string;
  createdAt: string; // ISO 8601
  photoName: string;
  photoSize: number;
  /** Downscaled JPEG data URL, kept small so localStorage doesn't overflow. */
  thumbnail?: string;
  lat: number | null;
  lng: number | null;
  locationSource: LocationSource | null;
  zoneId?: string;
  zoneName?: string;
  note?: string;
}

const STORAGE_KEY = "kerbside.reports.v1";

/* ------------------------------------------------------------------ *
 *  EXIF GPS extraction (minimal JPEG APP1 reader, no dependencies)   *
 * ------------------------------------------------------------------ */

/** Read GPS lat/lng from a JPEG's EXIF, or null when absent/unsupported. */
export async function readExifGps(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG

    // Walk JPEG markers to find APP1 (0xFFE1) carrying an "Exif\0\0" header.
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1) {
        const exifStart = offset + 4;
        if (
          view.getUint32(exifStart) === 0x45786966 && // "Exif"
          view.getUint16(exifStart + 4) === 0x0000
        ) {
          return parseTiffForGps(view, exifStart + 6);
        }
      }
      // Markers 0xFFD0–0xFFD9 (RST/SOI/EOI) have no length payload; stop at SOS.
      if (marker === 0xffda) break;
      if (size < 2) break;
      offset += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTiffForGps(view: DataView, tiff: number): { lat: number; lng: number } | null {
  const le = view.getUint16(tiff) === 0x4949; // "II" little-endian, "MM" big-endian
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);

  if (u16(tiff + 2) !== 0x002a) return null;
  const ifd0 = tiff + u32(tiff + 4);
  const gpsPtr = findTag(view, ifd0, 0x8825, u16, u32);
  if (gpsPtr == null) return null;

  const gpsIfd = tiff + gpsPtr;
  const latRef = readAscii(view, gpsIfd, 0x0001, tiff, u16, u32);
  const lat = readRationalTriplet(view, gpsIfd, 0x0002, tiff, le, u16, u32);
  const lngRef = readAscii(view, gpsIfd, 0x0003, tiff, u16, u32);
  const lng = readRationalTriplet(view, gpsIfd, 0x0004, tiff, le, u16, u32);
  if (lat == null || lng == null) return null;

  const latSigned = latRef === "S" ? -lat : lat;
  const lngSigned = lngRef === "W" ? -lng : lng;
  if (!Number.isFinite(latSigned) || !Number.isFinite(lngSigned)) return null;
  return { lat: latSigned, lng: lngSigned };
}

/** Return the value/offset of a tag in an IFD, or null. */
function findTag(
  view: DataView,
  ifd: number,
  tag: number,
  u16: (o: number) => number,
  u32: (o: number) => number,
): number | null {
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) === tag) return u32(entry + 8);
  }
  return null;
}

function readAscii(
  view: DataView,
  ifd: number,
  tag: number,
  tiff: number,
  u16: (o: number) => number,
  u32: (o: number) => number,
): string | null {
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) !== tag) continue;
    // ASCII refs of 1–3 useful chars live inline in the value field.
    const ch = view.getUint8(u32(entry + 8) <= 4 ? entry + 8 : tiff + u32(entry + 8));
    return String.fromCharCode(ch);
  }
  return null;
}

/** Read a GPS coordinate (3 rationals: deg, min, sec) as decimal degrees. */
function readRationalTriplet(
  view: DataView,
  ifd: number,
  tag: number,
  tiff: number,
  le: boolean,
  u16: (o: number) => number,
  u32: (o: number) => number,
): number | null {
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) !== tag) continue;
    const base = tiff + u32(entry + 8); // 3 rationals = 24 bytes, always out-of-line
    const rat = (o: number) => {
      const num = view.getUint32(o, le);
      const den = view.getUint32(o + 4, le);
      return den === 0 ? 0 : num / den;
    };
    const deg = rat(base);
    const min = rat(base + 8);
    const sec = rat(base + 16);
    return deg + min / 60 + sec / 3600;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Thumbnail + persistence                                          *
 * ------------------------------------------------------------------ */

/** Downscale an image file to a small JPEG data URL (max ~320px longest side). */
export async function makeThumbnail(file: File, max = 320): Promise<string | undefined> {
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.7);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return undefined;
  }
}

export function loadReports(): ParkingReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ParkingReport[]) : [];
  } catch {
    return [];
  }
}

export function saveReport(report: ParkingReport): void {
  try {
    const all = loadReports();
    all.unshift(report);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, 50)));
  } catch {
    // storage full / unavailable — the report is still surfaced in the console
    console.warn("[kerbside] could not persist report", report);
  }
}

/** Best-effort device location; resolves null if unavailable or denied. */
export function deviceLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation || !window.isSecureContext) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
