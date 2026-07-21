import type { SourceTier } from "./tiers.js";
/** A single controlled-hours entry. days: 0=Sun .. 6=Sat, times "HH:MM" local. */
export interface SchedEntry {
  days: number[];
  from: string;
  to: string;
}

export interface Zone {
  id: string;
  name: string;
  /** Trust tier of these hours — see tiers.ts. Absent on curated zones, whose
   *  tier is derived from `verified`/`kind` by `zoneTier()`. */
  tier?: SourceTier;
  /** "cpz" (default): a specific zone. "borough": borough-level fallback from real boundary data. */
  kind?: "cpz" | "borough";
  verified: boolean;
  /** Borough source URL for the hours. */
  src: string;
  /** Date the hours/tariff were last checked against the source (YYYY-MM-DD). */
  checkedAt?: string;
  sched: SchedEntry[];
  /** Pay-and-display rate while controlled, in pence per hour. */
  ratePence: number;
  /** Maximum stay during controlled hours, in hours. */
  maxStayHours: number;
  /** Single boundary ring, [lat, lng] (hand-drawn zones). */
  poly?: [number, number][];
  /** Multiple boundary rings, [lat, lng] (imported real boundaries). */
  polys?: [number, number][][];
}

export type SpotType =
  | "cp"
  | "paid"
  | "res"
  | "yellow"
  | "freeSt"
  /**
   * Kerbside inside a CPZ where we have no kerb-level bay data: we know the
   * zone and its hours, but not whether this street has pay-and-display bays,
   * resident-only bays or no bays at all. Never priced as a paid bay.
   */
  | "cpzStreet"
  /** No stopping at any time (red route / clearway) — never parkable. */
  | "noStop"
  /** Loading ban — parking blocked only while the posted ban is active. */
  | "noLoad";

export interface Spot {
  n: string;
  /** Trust tier of this record — see tiers.ts. */
  tier?: SourceTier;
  type: SpotType;
  lat: number;
  lng: number;
  /** Zone id for on-street spots governed by a CPZ. */
  zone?: string;
  /** Posted ban hours for a "noLoad" area; absent means banned at all times. */
  sched?: SchedEntry[];
  /** Car-park hourly rate in pence. */
  ratePence?: number;
  /** Car-park 24h day-max cap in pence. */
  dayMaxPence?: number;
  /** Car-park evening flat rate in pence. */
  evePence?: number;
  /** Synthesised at the searched destination rather than a curated location. */
  virtual?: boolean;
  note: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Extra controlled hours a zone runs on event days (a stadium fixture, a park
 * event). The borough publishes these alongside the regular hours, but whether
 * today IS an event day needs a fixture feed we don't have — so this is a
 * known-unknown attached to the zone, never a schedule we can evaluate.
 */
export interface EventControl {
  /** Matches Zone.id of the precise CPZ this applies to. */
  zoneId: string;
  name: string;
  /** Stadium or park driving the event control. */
  venue: string;
  /** Parsed event-day hours; empty when the borough published only prose. */
  sched: SchedEntry[];
  /** The borough's own wording, kept lossless for display. */
  rawText: string;
}

export interface Dataset {
  zones: Zone[];
  spots: Spot[];
  /** Event-day controls, keyed to zones by `zoneId`. */
  events?: EventControl[];
}

export type Badge = "best" | "free" | "close" | "cheap";

export interface EvaluatedOption {
  spot: Spot;
  km: number;
  walkMin: number;
  valid: boolean;
  /** Cost of the stay in pence (0 when free or invalid). */
  costPence: number;
  note: string;
  warn: string;
  typeLabel: string;
  /** costPence + walkMin * walk-penalty; Infinity when invalid. */
  score: number;
  badges: Badge[];
  /**
   * Set when this option is only free/parkable because its zone's *regular*
   * hours are off, and that zone also runs event-day controls we can't resolve
   * to today. Such options never receive badges — we won't put a green
   * "Recommended" on a kerb that may be controlled.
   */
  eventRisk?: EventControl;
}
