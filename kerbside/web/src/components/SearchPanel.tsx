import { PLACES, type Place } from "@kerbside/engine";
import { useEffect, useRef, useState } from "react";
import { parsePostcode } from "../geocode";
import { PRESETS, type PresetKey } from "../time";

interface Props {
  collapsed: boolean;
  summaryDest: string;
  summaryTime: string;
  onEdit: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  onPickPlace: (p: Place) => void;
  onPostcode: (q: string, run: boolean) => Promise<boolean>;
  onGps: () => void;
  fromVal: string;
  toVal: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  activeChip: PresetKey | null;
  onChip: (key: PresetKey) => void;
  onFind: () => void;
  onEnterNoMatch: () => void;
}

export function SearchPanel(props: Props) {
  const [sugsOpen, setSugsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setSugsOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const q = props.query.trim();
  const list = q
    ? PLACES.filter((p) => (p.n + " " + p.a).toLowerCase().includes(q.toLowerCase()))
    : PLACES.slice(0, 8);
  const pc = parsePostcode(q);

  const pickPlace = (p: Place) => {
    setSugsOpen(false);
    props.onPickPlace(p);
  };

  const onKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (await props.onPostcode(q, true)) {
      setSugsOpen(false);
      return;
    }
    const p = PLACES.find((p) => (p.n + " " + p.a).toLowerCase().includes(q.toLowerCase()));
    if (p) {
      setSugsOpen(false);
      props.onPickPlace(p);
      props.onFind();
    } else {
      props.onEnterNoMatch();
    }
  };

  return (
    <div className={"panel" + (props.collapsed ? " collapsed" : "")}>
      <div className="summary-bar">
        <div className="sum-txt">
          <b>{props.summaryDest || "—"}</b>
          <span>{props.summaryTime || "—"}</span>
        </div>
        <button className="edit-btn" onClick={props.onEdit}>Edit</button>
      </div>

      <div className="search-wrap" ref={wrapRef}>
        <div className="search-row">
          <div className="search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="#8A94AC" strokeWidth="2.4" />
              <path d="M20 20l-3.2-3.2" stroke="#8A94AC" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Postcode (e.g. N1 8DU) or place"
              autoComplete="off"
              aria-label="Search a destination"
              value={props.query}
              onChange={(e) => {
                props.onQueryChange(e.target.value);
                setSugsOpen(true);
              }}
              onFocus={() => setSugsOpen(true)}
              onKeyDown={onKeyDown}
            />
          </div>
          <button className="gps-btn" title="Use my location" aria-label="Use my location" onClick={props.onGps}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="#1D6FEB" strokeWidth="2.2" strokeLinecap="round" />
              <circle cx="12" cy="12" r="6" stroke="#1D6FEB" strokeWidth="2.2" />
              <circle cx="12" cy="12" r="2" fill="#1D6FEB" />
            </svg>
          </button>
        </div>
        <div className={"suggestions" + (sugsOpen ? " open" : "")}>
          {pc && (
            <button
              className="sug"
              onClick={() => {
                setSugsOpen(false);
                void props.onPostcode(q, false);
              }}
            >
              📮 Use postcode <b style={{ marginLeft: 4 }}>{pc.full || pc.outward}</b>
              <span className="area">postcode</span>
            </button>
          )}
          {list.length
            ? list.map((p) => (
                <button className="sug" key={p.n} onClick={() => pickPlace(p)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M12 21s-7-5.1-7-11a7 7 0 1 1 14 0c0 5.9-7 11-7 11z" stroke="#1D6FEB" strokeWidth="2.2" />
                    <circle cx="12" cy="10" r="2.4" fill="#1D6FEB" />
                  </svg>
                  {p.n}
                  <span className="area">{p.a}</span>
                </button>
              ))
            : !pc && <div className="sug none">No matches — try a nearby area name</div>}
        </div>
      </div>

      <div className="time-row">
        <div className="time-field">
          <label htmlFor="fromTime">Arrive</label>
          <input
            id="fromTime"
            type="datetime-local"
            value={props.fromVal}
            onChange={(e) => props.onFromChange(e.target.value)}
          />
        </div>
        <div className="time-field">
          <label htmlFor="toTime">Leave</label>
          <input
            id="toTime"
            type="datetime-local"
            value={props.toVal}
            onChange={(e) => props.onToChange(e.target.value)}
          />
        </div>
      </div>

      <div className="chips">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={"chip" + (props.activeChip === p.key ? " on" : "")}
            onClick={() => props.onChip(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <button className="find-btn" onClick={props.onFind}>Find parking</button>
    </div>
  );
}
