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

/* ---------- full address / place geocoding ---------- */

export interface AddressHit {
  lat: number;
  lng: number;
  name: string;
}

const LONDON = { latMin: 51.28, latMax: 51.7, lngMin: -0.51, lngMax: 0.33 };

function inLondon(lat: number, lng: number): boolean {
  return (
    lat >= LONDON.latMin && lat <= LONDON.latMax &&
    lng >= LONDON.lngMin && lng <= LONDON.lngMax
  );
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    city?: string;
    postcode?: string;
  };
}

function photonLabel(p: PhotonFeature["properties"]): string {
  const road = [p.housenumber, p.street].filter(Boolean).join(" ");
  const parts = [p.name, road !== p.name ? road : "", p.district || p.city, p.postcode];
  return parts.filter(Boolean).join(", ");
}

/**
 * Free-text search for addresses, streets and places inside Greater London.
 * Photon (komoot) first — fast, CORS-friendly, typo-tolerant — with a
 * Nominatim fallback. Returns [] on network failure rather than throwing.
 */
export async function searchAddress(q: string, limit = 5): Promise<AddressHit[]> {
  const query = q.trim();
  if (query.length < 3) return [];
  try {
    const u =
      "https://photon.komoot.io/api/?q=" + encodeURIComponent(query) +
      "&limit=" + limit * 2 +
      "&lat=51.51&lon=-0.12" + // bias to central London
      "&bbox=" + [LONDON.lngMin, LONDON.latMin, LONDON.lngMax, LONDON.latMax].join(",");
    const r = await fetch(u, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const j = (await r.json()) as { features?: PhotonFeature[] };
      const hits = (j.features ?? [])
        .map((f) => ({
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0],
          name: photonLabel(f.properties),
        }))
        .filter((h) => h.name && inLondon(h.lat, h.lng));
      // de-duplicate by label
      const seen = new Set<string>();
      const out = hits.filter((h) => !seen.has(h.name) && seen.add(h.name) !== undefined);
      if (out.length) return out.slice(0, limit);
    }
  } catch {
    /* fall through to Nominatim */
  }
  try {
    const u =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=" +
      limit + "&viewbox=" +
      [LONDON.lngMin, LONDON.latMax, LONDON.lngMax, LONDON.latMin].join(",") +
      "&bounded=1&q=" + encodeURIComponent(query);
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const j = (await r.json()) as { lat: string; lon: string; display_name: string }[];
      return j
        .map((h) => ({
          lat: Number(h.lat),
          lng: Number(h.lon),
          name: h.display_name.split(",").slice(0, 3).join(",").trim(),
        }))
        .filter((h) => inLondon(h.lat, h.lng))
        .slice(0, limit);
    }
  } catch {
    /* offline — caller shows its own message */
  }
  return [];
}
