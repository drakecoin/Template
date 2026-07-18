import { PLACES, type Place } from "@kerbside/engine";
import { useEffect, useRef, useState } from "react";
import { parsePostcode, searchAddress, type AddressHit } from "../geocode";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onPickPlace: (p: Place) => void;
  onPickAddress: (hit: AddressHit) => void;
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
  /** Present when the browser offers PWA installation. */
  onInstall: (() => void) | null;
}

/** The Park Up mark: a blue location pin with a white "P". */
function PinMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M24 2C13 2 4 11 4 22c0 14.5 20 39 20 39s20-24.5 20-39C44 11 35 2 24 2Z"
        fill="var(--accent)"
      />
      <circle cx="24" cy="22" r="12.5" fill="#fff" />
      <text
        x="24"
        y="22"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="18"
        fontWeight="800"
        fontFamily="Georgia, 'Times New Roman', serif"
        fill="var(--accent)"
      >
        P
      </text>
    </svg>
  );
}

/** A date/time field that opens its native picker wherever you tap the box. */
function WhenField({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: "date" | "time";
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    try {
      el.showPicker?.();
    } catch {
      /* needs a user gesture or unsupported — focus alone still works */
    }
  };
  return (
    <label className="when-field" onClick={open}>
      <span>{label}</span>
      <input
        ref={ref}
        type={type}
        value={value}
        onClick={open}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function Landing(props: Props) {
  const [expanded, setExpanded] = useState(props.startExpanded);
  const [addrHits, setAddrHits] = useState<AddressHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const q = props.query.trim();
  const list = q
    ? PLACES.filter((p) => (p.n + " " + p.a).toLowerCase().includes(q.toLowerCase())).slice(0, 4)
    : [];
  const pc = parsePostcode(q);
  const isPc = pc !== null;

  // live address lookup (debounced) — skipped for postcodes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const seq = ++seqRef.current;
    if (props.destChosen || q.length < 3 || isPc) {
      setAddrHits([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void searchAddress(q).then((hits) => {
        if (seqRef.current === seq) setAddrHits(hits);
      });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, isPc, props.destChosen]);

  const onKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (await props.onPostcode(q, true)) return;
    const p = PLACES.find((p) => (p.n + " " + p.a).toLowerCase().includes(q.toLowerCase()));
    if (p) {
      props.onPickPlace(p);
      props.onFind();
      return;
    }
    const hits = addrHits.length ? addrHits : await searchAddress(q);
    if (hits.length) {
      props.onPickAddress(hits[0]);
      props.onFind();
    } else {
      props.onEnterNoMatch();
    }
  };

  const showSugs = !props.destChosen && (list.length > 0 || pc !== null || addrHits.length > 0);

  // First screen: a clean, map-forward splash (no card).
  if (!expanded) {
    return (
      <div className="hero splash">
        <h1 className="brand-title">Park&nbsp;Up</h1>
        <div className="splash-mid">
          <button className="splash-address" onClick={() => setExpanded(true)}>
            Type an address
          </button>
          <PinMark className="splash-pin" />
        </div>
        <button className="splash-cta" onClick={props.onCta}>
          {props.ctaLabel}
        </button>
        {props.onInstall && (
          <button className="install-btn splash-install" onClick={props.onInstall}>
            Install Park Up on this device
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="hero expanded">
      <div className="hero-card">
        <div className="hero-brand">
          <PinMark className="brand-pin" />
          <span className="hero-name">Park Up</span>
        </div>

        <div className="hero-form">
          <input
            ref={inputRef}
            className="hero-input"
            type="text"
            placeholder="Address, postcode or place"
            autoComplete="off"
            aria-label="Destination"
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {showSugs && (
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
              {addrHits.map((h) => (
                <button className="sug" key={h.name} onClick={() => props.onPickAddress(h)}>
                  {h.name}
                  <span className="area">address</span>
                </button>
              ))}
            </div>
          )}
          <div className="when-row">
            <WhenField label="Date" type="date" value={props.dateVal} onChange={props.onDateChange} />
            <WhenField label="From" type="time" value={props.fromTime} onChange={props.onFromChange} />
            <WhenField label="To" type="time" value={props.toTime} onChange={props.onToChange} />
          </div>
          <p className="when-hint">Leave “To” empty for a 2-hour stay. Ends earlier than it starts? That’s overnight.</p>
        </div>

        <button className="cta" onClick={props.onCta}>
          {props.ctaLabel}
        </button>
        <p className="hero-sub">
          Checks parking zones, bays, car parks and free streets for your exact times.
        </p>
        {props.onInstall && (
          <button className="install-btn" onClick={props.onInstall}>
            Install Park Up on this device
          </button>
        )}
      </div>
    </div>
  );
}
