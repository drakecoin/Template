# Event-day CPZ control — data captured, feature planned

Some London CPZs change their control hours (or only operate at all) on days when
a nearby venue has an event — most visibly the streets around **Tottenham Hotspur
Stadium** and, for Finsbury Park, **Arsenal (Emirates) match days**. On a match
day a zone that is normally free (or normally closes at 18:30) can be controlled
until 20:30, and separate "Event Day" zones switch on entirely.

The engine **cannot** apply these today because it has no calendar of which dates
are event days. Rather than guess (a wrong answer here is a £130 PCN — see
CLAUDE.md §7), the ETL **captures the rules now** into `zones.events.json` so the
feature can be built later without re-scraping. **No connector is built yet** —
this file is collected and stored only.

## Where the data lives

`packages/engine/src/data/zones.events.json` — written by `data/etl.ts` from the
iShare WFS snapshot (`data/sources/ishareCpz.ts` → `transformIshareEvents`). It is
**not imported by the engine**; adding an importer is the future feature's job.

Currently 15 Haringey zones (12 with everyday control + an event uplift, 3 that
are event-day-only). Regenerated on every `npm run etl`.

## Record shape (`EventZoneRecord`)

| field | meaning |
|---|---|
| `zoneKey` | stable id, e.g. `hgy-white-hart-lane` |
| `name`, `borough` | display name / borough |
| `preciseZoneId` | matching id in `zones.precise.json` when the zone also has everyday control; `null` for event-only zones |
| `eventOnly` | `true` when the zone has **no** everyday restriction (only controls on event days) |
| `regularSched` | the everyday control windows (`null` for event-only) — the same schedule the engine already uses from `zones.precise.json` |
| `event.venue` | venue whose event days trigger the control (e.g. `Tottenham Hotspur Stadium`), or `null` |
| `event.sched` | event-day control windows by weekday, `{days,from,to}[]` |
| `event.bankHoliday` | event-day control window on public/bank holidays, `{from,to}` or `null` |
| `event.rawText` | **authoritative** verbatim event clause |
| `rawOpTimes` | **authoritative** verbatim full `op_times` string from the council |
| `ratePence`, `maxStayHours`, `src`, `checkedAt` | as per the CPZ |
| `polys` | zone geometry (`[lat,lng]` rings), so the record is self-contained |

**`rawOpTimes` / `event.rawText` are the source of truth.** `event.sched` and
`event.bankHoliday` are best-effort structured parses — some councils write
comma-separated day lists ("Saturday, Sunday and Public Holidays: …") that the
current parser only partly structures. A future feature should prefer the raw
text where the structured fields look incomplete, and can tighten the parser in
`data/sources/eventControl.ts` (covered by `data/test/eventControl.test.ts`).

## How to build the feature later (sketch, not implemented)

1. **Match-day feed.** Add a source of event dates per venue. Options: the
   football fixture APIs (Tottenham Hotspur / Arsenal home fixtures), the councils'
   own event-day calendars, or a manually maintained list. Store as
   `{venue, date, kind}` and refresh like any other source. *This is the connector
   the current task deliberately does not build.*
2. **Engine input.** Extend `evaluate(...)` context with an optional
   `eventDays: Set<isoDate>` (or a `isEventDay(date, venue)` predicate). Default
   empty → today's exact behaviour, so this is backwards-compatible.
3. **Apply rules.** Load `zones.events.json` alongside `zones.precise.json`. When
   the requested date is an event day for a zone's `venue`, use `event.sched`
   (and `event.bankHoliday` on public holidays) **instead of / in addition to**
   `regularSched`; for `eventOnly` zones the zone becomes controlled only then.
4. **UI.** Surface an "event day — extended control" note on affected zones, and
   let a user confirm/update via the existing "Update me" flow. The
   `checkedAt`/`src` provenance is already carried per record.

## Refreshing / correcting the data

- Geometry + `op_times` come live from `https://my.haringey.gov.uk` iShare WFS on
  `npm run etl`; the committed GML snapshot is `data/raw/haringey_cpz.gml`.
- Hours cross-check: <https://haringey.gov.uk/parking/cpzs/all-cpz-hours>.
- Other iShare boroughs slot in by adding a `kind:"ishare"` registry portal;
  their event zones are captured automatically by the same pass.
