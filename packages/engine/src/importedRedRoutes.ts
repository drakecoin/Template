import { TIER } from "./tiers.js";
import rawRedRoutes from "./data/spots.redroutes.json";
import type { Spot } from "./types.js";

interface RawRedRouteSpot {
  n: string;
  type: string;
  lat: number;
  lng: number;
  note: string;
}

/**
 * TfL red-route no-stopping points imported by data/etl.ts — the pan-London
 * arterial network sampled along its length. Every entry is a hard "no
 * stopping at any time" restriction (type "noStop"); empty until `npm run etl`
 * has run. Complements the Mapillary detected no-stopping SIGNS with the
 * continuous LINEAR network.
 */
export const RED_ROUTE_SPOTS: Spot[] = (rawRedRoutes as RawRedRouteSpot[])
  .filter((s) => s.type === "noStop")
  .map((s) => ({ n: s.n, type: "noStop" as const, lat: s.lat, lng: s.lng, note: s.note, tier: TIER.AUTHORITY }));
