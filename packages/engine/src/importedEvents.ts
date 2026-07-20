import rawEvents from "./data/zones.events.json";
import type { EventControl, SchedEntry } from "./types.js";

interface RawEventZone {
  zoneKey: string;
  name: string;
  borough: string;
  /** null for zones that exist only on event days — those never reach the engine. */
  preciseZoneId: string | null;
  eventOnly: boolean;
  regularSched: SchedEntry[];
  event: {
    venue: string | null;
    sched: SchedEntry[];
    bankHoliday: { from: string; to: string } | null;
    rawText: string;
  } | null;
}

/**
 * Event-day controls written by data/etl.ts (`transformIshareEvents`). The ETL
 * strips event clauses out of the regular schedules so the engine never claims
 * a zone is always controlled when it isn't — this file is the other half of
 * that trade: the stripped-out knowledge, kept so the engine can flag a zone
 * whose "off right now" is conditional on there being no fixture today.
 *
 * `event.sched` is empty for a couple of zones whose borough published only
 * prose, so presence of an event record — not its hours — is the risk signal.
 */
export const EVENT_CONTROLS: EventControl[] = (rawEvents as RawEventZone[])
  .filter((z): z is RawEventZone & { preciseZoneId: string } =>
    z.preciseZoneId !== null && !z.eventOnly && z.event !== null)
  .map((z) => ({
    zoneId: z.preciseZoneId,
    name: z.name,
    venue: z.event?.venue ?? "a nearby venue",
    sched: z.event?.sched ?? [],
    rawText: z.event?.rawText ?? "",
  }));
