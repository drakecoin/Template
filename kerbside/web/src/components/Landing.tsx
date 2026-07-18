import { PLACES, type Place } from "@kerbside/engine";
import { useEffect, useRef, useState } from "react";
import { parsePostcode } from "../geocode";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onPickPlace: (p: Place) => void;
  onPostcode: (q: string, run: boolean) => Promise<boolean>;
  dateVal: string;
  fromTime: string;
  toTime: string;
  onDateChange: (v: string) => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  ctaLabel: string;
  onCta: () => void;
  onEnterNoMatch: () => void;
  onFind: () => void;
  /** Open with the form already expanded (returning via "Edit"). */
  startExpanded: boolean;
  /** A destination is already chosen — hide suggestions until the query changes. */
  destChosen: boolean;
}

export function Landing(props: Props) {
  const [expanded, setExpanded] = useState(props.startExpanded);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const q = props.query.trim();
  const list = q
    ? PLACES.filter((p) => (p.n + " " + p.a).toLowerCase().includes(q.toLowerCase())).slice(0, 5)
    : [];
  const pc = parsePostcode(q);

  const onKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (await props.onPostcode(q, true)) return;
    const p = PLACES.find((p) => (p.n + " " + p.a).toLowerCase().includes(q.toLowerCase()));
    if (p) {
      props.onPickPlace(p);
      props.onFind();
    } else {
      props.onEnterNoMatch();
    }
  };

  return (
    <div className="hero">
      <div className="hero-card">
        <div className="hero-brand">
          <span className="p-badge">P</span>
          <span className="hero-name">Kerbside</span>
        </div>

        {!expanded ? (
          <button className="hero-hint" onClick={() => setExpanded(true)}>
            Type an address
          </button>
        ) : (
          <div className="hero-form">
            <input
              ref={inputRef}
              className="hero-input"
              type="text"
              placeholder="Address, postcode or area"
              autoComplete="off"
              aria-label="Destination"
              value={props.query}
              onChange={(e) => props.onQueryChange(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {!props.destChosen && (list.length > 0 || pc) && (
              <div className="hero-sugs">
                {pc && (
                  <button className="sug" onClick={() => void props.onPostcode(q, false)}>
                    Use postcode <b>{pc.full || pc.outward}</b>
                  </button>
                )}
                {list.map((p) => (
                  <button className="sug" key={p.n} onClick={() => props.onPickPlace(p)}>
                    {p.n}
                    <span className="area">{p.a}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="when-row">
              <label className="when-field">
                <span>Date</span>
                <input
                  id="heroDate"
                  type="date"
                  value={props.dateVal}
                  onChange={(e) => props.onDateChange(e.target.value)}
                />
              </label>
              <label className="when-field">
                <span>From</span>
                <input
                  id="heroFrom"
                  type="time"
                  value={props.fromTime}
                  onChange={(e) => props.onFromChange(e.target.value)}
                />
              </label>
              <label className="when-field">
                <span>To</span>
                <input
                  id="heroTo"
                  type="time"
                  value={props.toTime}
                  onChange={(e) => props.onToChange(e.target.value)}
                />
              </label>
            </div>
            <p className="when-hint">Leave “To” empty for a 2-hour stay. Ends earlier than it starts? That’s overnight.</p>
          </div>
        )}

        <button className="cta" onClick={props.onCta}>
          {props.ctaLabel}
        </button>
        <p className="hero-sub">
          Checks parking zones, bays, car parks and free streets for your exact times.
        </p>
      </div>
    </div>
  );
}
