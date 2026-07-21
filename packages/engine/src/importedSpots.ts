import { TIER, type SourceTier } from "./tiers.js";
import rawBays from "./data/spots.bays.json";
import rawOsm from "./data/spots.osm.json";
import type { Spot, SpotType } from "./types.js";

interface RawImportedSpot {
  n: string;
  type: string;
  lat: number;
  lng: number;
  zone?: string;
  note: string;
}

const VALID_TYPES: SpotType[] = ["cp", "paid", "res", "yellow", "freeSt"];

function load(raw: RawImportedSpot[], tier: SourceTier): Spot[] {
  return raw
    .filter((s) => VALID_TYPES.includes(s.type as SpotType))
    .map((s) => ({
      n: s.n,
      type: s.type as SpotType,
      lat: s.lat,
      lng: s.lng,
      zone: s.zone,
      note: s.note,
      tier,
    }));
}

/** Kerb-level bays imported from borough open data by data/etl.ts. */
export const BAY_SPOTS: Spot[] = load(rawBays as RawImportedSpot[], TIER.COUNCIL);

/** Kerbside segments imported from OpenStreetMap parking:* tagging by data/etl.ts. */
// OSM tagging is crowd-mapped with no verification step, so it sits well below
// the borough's own bay data even though both describe a kerb.
export const OSM_SPOTS: Spot[] = load(rawOsm as RawImportedSpot[], TIER.COMMUNITY);

export const IMPORTED_SPOTS: Spot[] = [...BAY_SPOTS, ...OSM_SPOTS];
