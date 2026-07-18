import rawMapillary from "./data/spots.mapillary.json";
import type { Spot, SpotType } from "./types.js";

interface RawMapillarySpot {
  n: string;
  type: string;
  lat: number;
  lng: number;
  date?: string;
  note: string;
}

const VALID_TYPES: SpotType[] = ["noStop", "noLoad"];

/**
 * No-stopping / no-loading areas imported from Mapillary detected street signs
 * by data/etl.ts (pan-London, each dated). Empty until `npm run etl` has run
 * with a MAPILLARY_TOKEN.
 */
export const MAPILLARY_SPOTS: Spot[] = (rawMapillary as RawMapillarySpot[])
  .filter((s) => VALID_TYPES.includes(s.type as SpotType))
  .map((s) => ({
    n: s.n,
    type: s.type as SpotType,
    lat: s.lat,
    lng: s.lng,
    note: s.note,
  }));
