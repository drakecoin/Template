import type { Spot, Zone } from "./types.js";

/**
 * How much a record's claim about the kerb is worth, lowest number = most
 * trusted. Every zone and spot carries one, and where two sources describe the
 * same kerb the lower tier wins (`newest-supersedes` breaks ties within a tier
 * via `checkedAt`).
 *
 * The ordering is about WHO is entitled to state the restriction, not about how
 * recent or precise the data looks:
 *
 *  1 USER      A user's photo of the sign on that street, verified. The sign is
 *              the legal instrument a PCN is issued against, so a confirmed
 *              reading of it outranks anything published centrally — councils'
 *              own pages lag street changes by weeks.
 *              NOTHING POPULATES THIS YET: "Update me" reports are photos plus
 *              a location in localStorage (web/src/report.ts), not parsed
 *              hours, they never leave the device, and no step marks one
 *              verified. The tier exists so the merge order is settled; see
 *              docs/DATA_PIPELINE.md before wiring anything into it.
 *  2 COUNCIL   Published by the borough that sets the restriction: its open-data
 *              portal, the service behind its own parking map, or hours
 *              transcribed from its published table. This is the top tier that
 *              actually carries data today.
 *  3 AUTHORITY Official, but not the borough's own CPZ record — TfL's red-route
 *              network, which is authoritative for TfL roads and silent on
 *              borough kerbs.
 *  4 DETECTED  A sign detected in street imagery (Mapillary). Says a sign of
 *              some class exists at a point; cannot read the plate beneath it,
 *              so it never states hours or tariff (rule 14).
 *  5 COMMUNITY Crowd-mapped tagging with no verification step (OSM).
 *  6 ESTIMATE  Our own generalisation — the borough-wide indicative schedule, or
 *              a council layer whose hours we could not parse. Never sufficient
 *              to clear a restriction (rule 9).
 */
export const TIER = {
  USER: 1,
  COUNCIL: 2,
  AUTHORITY: 3,
  DETECTED: 4,
  COMMUNITY: 5,
  ESTIMATE: 6,
} as const;

export type SourceTier = (typeof TIER)[keyof typeof TIER];

export const TIER_LABEL: Record<SourceTier, string> = {
  1: "Confirmed from the sign",
  2: "From the council",
  3: "From the highway authority",
  4: "Detected from street imagery",
  5: "Community-mapped",
  6: "Indicative estimate",
};

/**
 * A zone's tier. Records written by the ETL carry one explicitly; the curated
 * zones in data.ts predate the field, so fall back to what their existing flags
 * already mean — a hand-verified per-zone CPZ was transcribed from the
 * council's page (COUNCIL), anything else is our own generalisation.
 *
 * Note this is the tier of the HOURS, not of the geometry: a council layer we
 * could not parse hours from lands on the borough default and is an ESTIMATE,
 * however precise its boundary.
 */
export function zoneTier(z: Zone): SourceTier {
  if (z.tier) return z.tier;
  if (z.kind === "borough") return TIER.ESTIMATE;
  return z.verified ? TIER.COUNCIL : TIER.ESTIMATE;
}

export function spotTier(s: Spot): SourceTier {
  return s.tier ?? TIER.ESTIMATE;
}

/**
 * Whether a record is authoritative enough to say a restriction is OFF.
 * COUNCIL and above only: everything below is either an estimate or an
 * observation that a restriction exists, and neither can clear a kerb.
 */
export function tierCanClearRestriction(tier: SourceTier): boolean {
  return tier <= TIER.COUNCIL;
}

/**
 * Merge order for records describing the same kerb: better tier first, then
 * the more recently checked. Exposed so every consumer sorts the same way.
 */
export function byTrust<T extends { tier?: SourceTier; checkedAt?: string }>(
  tierOf: (r: T) => SourceTier,
): (a: T, b: T) => number {
  return (a, b) => {
    const d = tierOf(a) - tierOf(b);
    if (d !== 0) return d;
    return (b.checkedAt ?? "").localeCompare(a.checkedAt ?? "");
  };
}
