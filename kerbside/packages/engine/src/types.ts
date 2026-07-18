/** A single controlled-hours entry. days: 0=Sun .. 6=Sat, times "HH:MM" local. */
export interface SchedEntry {
  days: number[];
  from: string;
  to: string;
}

export interface Zone {
  id: string;
  name: string;
  verified: boolean;
  /** Borough source URL for the hours. */
  src: string;
  sched: SchedEntry[];
  /** Pay-and-display rate while controlled, in pence per hour. */
  ratePence: number;
  /** Maximum stay during controlled hours, in hours. */
  maxStayHours: number;
  /** Hand-drawn boundary, [lat, lng] rings. */
  poly: [number, number][];
}

export type SpotType = "cp" | "paid" | "res" | "yellow" | "freeSt";

export interface Spot {
  n: string;
  type: SpotType;
  lat: number;
  lng: number;
  /** Zone id for on-street spots governed by a CPZ. */
  zone?: string;
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
