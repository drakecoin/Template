/** A single controlled-hours entry. days: 0=Sun .. 6=Sat, times "HH:MM" local. */
export interface SchedEntry {
  days: number[];
  from: string;
  to: string;
}

export interface Zone {
  id: string;
  name: string;
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
  /** No stopping at any time (red route / clearway) — never parkable. */
  | "noStop"
  /** Loading ban — parking blocked only while the posted ban is active. */
  | "noLoad";

export interface Spot {
  n: string;
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

export interface Dataset {
  zones: Zone[];
  spots: Spot[];
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
}
