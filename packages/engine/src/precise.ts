import rawPrecise from "./data/zones.precise.json";
import type { SchedEntry, Zone } from "./types.js";

interface RawPreciseZone {
  id: string;
  name: string;
  kind: string;
  verified: boolean;
  src: string;
  checkedAt: string;
  sched: SchedEntry[];
  ratePence: number;
  maxStayHours: number;
  polys: number[][][];
}

/**
 * Per-zone CPZs imported from borough open-data portals by data/etl.ts
 * (empty until `npm run etl` has run somewhere with access to the portals).
 * These outrank both the hand-drawn zones and the borough fallbacks.
 */
export const PRECISE_ZONES: Zone[] = (rawPrecise as RawPreciseZone[]).map((z) => ({
  id: z.id,
  name: z.name,
  kind: "cpz",
  verified: z.verified,
  src: z.src,
  checkedAt: z.checkedAt,
  sched: z.sched,
  ratePence: z.ratePence,
  maxStayHours: z.maxStayHours,
  polys: z.polys.map((ring) => ring.map((p) => [p[0], p[1]] as [number, number])),
}));
