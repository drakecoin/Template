import {
  DATA_UPDATED,
  fmtCost,
  SEARCH_RADIUS_KM,
  WALK_MIN_PER_KM,
  zoneHoursText,
  type Badge,
  type EvaluatedOption,
  type LatLng,
  type Spot,
  type Zone,
} from "@kerbside/engine";
import { useEffect, useRef, useState } from "react";
import { fmtDT, gmapsLink } from "../time";
import { UpdateDialog } from "./UpdateDialog";

type SheetState = "normal" | "peek" | "tall";

interface Props {
  results: EvaluatedOption[] | null;
  window: { start: Date; end: Date } | null;
  destName: string;
  destZone: Zone | null;
  dest: LatLng | null;
  selectedIdx: number | null;
  /** True when the selection came from the map, so its card should scroll into view. */
  autoScroll: boolean;
  onSelectCard: (idx: number) => void;
  onToast: (msg: string) => void;
}

const ICONS: Record<Spot["type"], [string, string]> = {
  cp: ["P", "cp"],
  paid: ["£", "paid"],
  res: ["R", "res"],
  yellow: ["F", "free"],
  freeSt: ["F", "free"],
  noStop: ["⊘", "nostop"],
  noLoad: ["L", "noload"],
};

/** Format a YYYY-MM-DD date as e.g. "18 Jul 2026". */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return d + " " + months[m - 1] + " " + y;
}

const BADGE_TAGS: Record<Badge, { cls: string; label: string }> = {
  best: { cls: "best", label: "Recommended" },
  free: { cls: "freet", label: "Closest free" },
  close: { cls: "close", label: "Closest" },
  cheap: { cls: "cheap", label: "Cheapest paid" },
};

/** Top-picks slots, in display order. */
const TOP_SLOTS: { badge: Badge; label: string }[] = [
  { badge: "best", label: "Recommended" },
  { badge: "close", label: "Closest" },
  { badge: "free", label: "Closest free" },
  { badge: "cheap", label: "Cheapest paid" },
];

function Card({
  r,
  idx,
  selected,
  canScroll,
  onSelect,
}: {
  r: EvaluatedOption;
  idx: number;
  selected: boolean;
  /** Whether this card may pull the list to itself when selected. */
  canScroll: boolean;
  onSelect: (idx: number) => void;
}) {
  const [ch, cls] = ICONS[r.spot.type];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected && canScroll) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected, canScroll]);
  return (
    <div
      ref={ref}
      className={
        "card" + (r.badges.includes("best") ? " best" : "") + (r.valid ? "" : " na") + (selected ? " sel" : "")
      }
      onClick={() => onSelect(idx)}
    >
      <div className={"c-icon " + cls}>{ch}</div>
      <div className="c-body">
        <div className="c-top">
          <div className="c-name">{r.spot.n}</div>
          <div className={"c-cost " + (r.valid && r.costPence === 0 ? "free" : "paid")}>
            {r.valid ? fmtCost(r.costPence) : "—"}
          </div>
        </div>
        <div className="c-meta">
          {r.walkMin} min walk · {Math.round(r.km * 100) / 100} km
        </div>
        <div className={"c-note" + (r.valid ? "" : " bad")}>{r.note}</div>
        {r.warn && <div className="c-note warn">{r.warn}</div>}
        <a
          className="gm-link"
          href={gmapsLink(r.spot.lat, r.spot.lng)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          Open in Google Maps ↗
        </a>
        <div className="tags">
          {r.badges.map((b) => (
            <span key={b} className={"tag " + BADGE_TAGS[b].cls}>
            {BADGE_TAGS[b].label}
          </span>
          ))}
          <span className="tag type">{r.typeLabel.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
}

export function ResultsSheet({
  results,
  window: win,
  destName,
  destZone,
  dest,
  selectedIdx,
  autoScroll,
  onSelectCard,
  onToast,
}: Props) {
  const [sheet, setSheet] = useState<SheetState>("normal");
  const [naOpen, setNaOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchY = useRef<number | null>(null);
  const lastUpdated = destZone?.checkedAt ?? DATA_UPDATED;

  useEffect(() => {
    setNaOpen(false);
    if (results) {
      setSheet(results.length ? "normal" : "tall");
      scrollRef.current?.scrollTo(0, 0);
    }
  }, [results]);

  const cycle = () => setSheet((s) => (s === "peek" ? "normal" : s === "normal" ? "tall" : "peek"));

  const onTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest(".grab,.res-head")) touchY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchY.current === null) return;
    const dy = e.changedTouches[0].clientY - touchY.current;
    touchY.current = null;
    if (dy < -28) setSheet((s) => (s === "peek" ? "normal" : "tall"));
    else if (dy > 28) setSheet((s) => (s === "tall" ? "normal" : "peek"));
  };

  const valid = results?.filter((r) => r.valid) ?? [];
  const na = results?.filter((r) => !r.valid) ?? [];
  const topPicks = TOP_SLOTS
    .map((s) => ({ ...s, r: valid.find((r) => r.badges.includes(s.badge)) }))
    .filter((s): s is typeof s & { r: EvaluatedOption } => s.r !== undefined);

  return (
    <div
      className={"results" + (sheet === "peek" ? " peek" : sheet === "tall" ? " tall" : "")}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button className="grab" onClick={cycle} aria-label="Resize the results panel"><i /></button>
      <div className="res-head">
        <h2>
          {!results
            ? "Where to?"
            : valid.length
              ? valid.length + " options near " + destName
              : "Nothing close enough"}
        </h2>
        <p>
          {!results || !win ? (
            <>Search a place or tap the GPS button, pick your times, then hit <b>Find parking</b>.</>
          ) : (
            fmtDT(win.start) + " → " + fmtDT(win.end) + " · within a " +
            Math.round(SEARCH_RADIUS_KM * WALK_MIN_PER_KM) + "-min walk"
          )}
        </p>
        {results && destZone && (
          <p className="res-zone">
            You're in {destZone.name} — controlled {zoneHoursText(destZone)}
            {destZone.verified ? "" : " (indicative)"}
          </p>
        )}
        {results && (
          <div className="res-updated">
            <span className="upd-date">Last updated: {fmtDate(lastUpdated)}</span>
            <button className="upd-btn" onClick={() => setUpdateOpen(true)}>
              Update me
            </button>
          </div>
        )}
      </div>

      <UpdateDialog
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        destZone={destZone}
        dest={dest}
        onSubmitted={onToast}
      />
      <div className="res-scroll" ref={scrollRef}>
        {!results ? (
          <div className="empty">
            Park Up checks controlled parking zones, paid bays, car parks and free streets around
            your destination — and tells you the best place to leave the car for <b>your exact times</b>.
          </div>
        ) : !results.length ? (
          <div className="empty">
            <b>No parking data within 1.5 km.</b>
            <br />
            This demo covers central &amp; inner London hotspots — try Angel, Soho, Camden,
            Shoreditch, Borough, Greenwich…
          </div>
        ) : (
          <>
            {topPicks.length > 0 && (
              <>
                {topPicks.map(({ badge, label, r }) => (
                  <div className="top-slot" key={badge}>
                    <div className="slot-label">{label}</div>
                    <Card
                      r={r}
                      idx={results.indexOf(r)}
                      selected={selectedIdx === results.indexOf(r)}
                      canScroll={false}
                      onSelect={onSelectCard}
                    />
                  </div>
                ))}
                <div className="sec-label">All options</div>
              </>
            )}
            {valid.map((r) => (
              <Card
                key={r.spot.n}
                r={r}
                idx={results.indexOf(r)}
                selected={selectedIdx === results.indexOf(r)}
                canScroll={autoScroll}
                onSelect={onSelectCard}
              />
            ))}
            {na.length > 0 && (
              <>
                <button className="na-toggle" onClick={() => setNaOpen((o) => !o)}>
                  {(naOpen ? "Hide " : "Show ") + na.length + " unavailable for your times " + (naOpen ? "▴" : "▾")}
                </button>
                {naOpen &&
                  na.map((r) => (
                    <Card
                      key={r.spot.n}
                      r={r}
                      idx={results.indexOf(r)}
                      selected={selectedIdx === results.indexOf(r)}
                      canScroll={autoScroll}
                      onSelect={onSelectCard}
                    />
                  ))}
              </>
            )}
          </>
        )}
      </div>
      <div className="disclaimer">
        Zone hours for Islington, Camden &amp; Westminster follow the borough websites (tap a zone
        for the source). Other zones, tariffs &amp; bay positions are indicative — always check
        street signage.
      </div>
    </div>
  );
}
