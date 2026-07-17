import { PC_DISTRICTS } from "@kerbside/engine";

export interface ParsedPostcode {
  outward: string;
  full: string | null;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  name: string;
  exact: boolean;
}

const PC_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})?$/i;

export function parsePostcode(q: string): ParsedPostcode | null {
  const m = q.trim().toUpperCase().match(PC_RE);
  if (!m) return null;
  return { outward: m[1], full: m[2] ? m[1] + " " + m[2] : null };
}

interface PostcodesIoResponse {
  result?: { latitude: number; longitude: number } | null;
}

export async function geocodePostcode(pc: ParsedPostcode): Promise<GeocodeResult | null> {
  if (pc.full) {
    try {
      const r = await fetch(
        "https://api.postcodes.io/postcodes/" + encodeURIComponent(pc.full),
        { signal: AbortSignal.timeout(5000) },
      );
      if (r.ok) {
        const j = (await r.json()) as PostcodesIoResponse;
        if (j.result)
          return { lat: j.result.latitude, lng: j.result.longitude, name: pc.full, exact: true };
      }
    } catch {
      /* offline / blocked -> fall through to the district table */
    }
  }
  const d = PC_DISTRICTS[pc.outward];
  if (d) return { lat: d[0], lng: d[1], name: pc.outward + " (district centre)", exact: false };
  return null;
}
