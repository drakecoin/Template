import rawMapillary from "./data/spots.mapillary.json";
import type { Spot, SpotType } from "./types.js";

interface RawMapillarySpot {
  n: string;
  type: string;
  lat: number;
  lng: number;
  zone?: string;
  date?: string;
  note: string;
}

const VALID_TYPES: SpotType[] = ["noStop", "noLoad", "cpzStreet"];

/**
 * Spots imported from Mapillary detected street signs by data/etl.ts (pan-London,
 * each dated): no-stopping/no-loading restriction areas, plus parking-place signs
 * (`cpzStreet`, carrying the zone whose hours govern them — a sign detection
 * can't read the plate, so bay type/tariff are unknown). Empty until `npm run
 * etl` has run with a MAPILLARY_TOKEN.
 */
export const MAPILLARY_SPOTS: Spot[] = (rawMapillary as RawMapillarySpot[])
  .filter((s) => VALID_TYPES.includes(s.type as SpotType))
  // a cpzStreet with no zone has no governing hours — drop it defensively
  .filter((s) => s.type !== "cpzStreet" || Boolean(s.zone))
  .map((s) => ({
    n: s.n,
    type: s.type as SpotType,
    lat: s.lat,
    lng: s.lng,
    zone: s.zone,
    note: s.note,
  }));
