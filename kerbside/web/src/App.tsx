import {
  evaluate,
  fmtCost,
  MAX_WINDOW_HOURS,
  PLACES,
  type EvaluatedOption,
  type LatLng,
  type Place,
} from "@kerbside/engine";
import { useCallback, useRef, useState } from "react";
import { Landing } from "./components/Landing";
import { MapView, type Selection } from "./components/MapView";
import { ResultsSheet } from "./components/ResultsSheet";
import { geocodePostcode, parsePostcode } from "./geocode";
import { buildWindow, fmtDT, roundQuarter, toHM, toISODate, type StayWindow } from "./time";

const LONDON_BBOX = { latMin: 51.28, latMax: 51.7, lngMin: -0.51, lngMax: 0.33 };
const ANGEL: Place = { n: "Angel, Islington", a: "N1", lat: 51.5322, lng: -0.1057 };

export function App() {
  const now = new Date();
  const [query, setQuery] = useState("");
  const [dest, setDest] = useState<LatLng | null>(null);
  const [destName, setDestName] = useState("");
  const [dateVal, setDateVal] = useState(toISODate(now));
  const [fromTime, setFromTime] = useState(toHM(roundQuarter(now)));
  const [toTime, setToTime] = useState("");
  const [overlayOpen, setOverlayOpen] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<EvaluatedOption[] | null>(null);
  const [window_, setWindow] = useState<StayWindow | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const setDestination = useCallback((lat: number, lng: number, name: string) => {
    setDest({ lat, lng });
    setDestName(name);
  }, []);

  const runSearch = useCallback(
    (overrideDest?: LatLng) => {
      const d = overrideDest ?? dest;
      if (!d) {
        showToast("Type an address first");
        return;
      }
      const win = buildWindow(dateVal, fromTime, toTime);
      if (!win) {
        showToast("Set a date and a “from” time");
        return;
      }
      if (win.end.getTime() - win.start.getTime() > MAX_WINDOW_HOURS * 36e5) {
        showToast("Keep it under 48 hours for this demo");
        return;
      }

      const res = evaluate(d, win.start, win.end);
      setWindow(win);
      setResults(res);
      setHasSearched(true);
      setOverlayOpen(false);

      const firstValid = res.findIndex((r) => r.valid);
      setSelection(firstValid >= 0 ? { idx: firstValid, pan: false } : null);
      const best = firstValid >= 0 ? res[firstValid] : null;
      if (best) {
        showToast(
          best.costPence === 0
            ? "Best pick: " + best.spot.n + " — free, " + best.walkMin + " min walk"
            : "Best pick: " + best.spot.n + " — " + fmtCost(best.costPence),
        );
      }
    },
    [dest, dateVal, fromTime, toTime, showToast],
  );

  const onPickPlace = useCallback(
    (p: Place) => {
      setQuery(p.n);
      setDestination(p.lat, p.lng, p.n);
    },
    [setDestination],
  );

  const onPostcode = useCallback(
    async (q: string, run: boolean): Promise<boolean> => {
      const pc = parsePostcode(q);
      if (!pc) return false;
      showToast("Looking up " + (pc.full || pc.outward) + "…");
      const g = await geocodePostcode(pc);
      if (!g) {
        showToast(pc.outward + " isn't in the demo area yet — try a central district");
        return true;
      }
      setQuery(g.name);
      setDestination(g.lat, g.lng, g.name);
      if (!g.exact && pc.full)
        showToast("Live lookup unavailable — using " + pc.outward + " district centre");
      if (run) runSearch({ lat: g.lat, lng: g.lng });
      return true;
    },
    [setDestination, runSearch, showToast],
  );

  const parkHereNow = useCallback(() => {
    if (!navigator.geolocation) {
      showToast("Location isn't available here — type an address instead");
      return;
    }
    showToast("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        // keep the demo inside Greater London
        if (
          lat < LONDON_BBOX.latMin || lat > LONDON_BBOX.latMax ||
          lng < LONDON_BBOX.lngMin || lng > LONDON_BBOX.lngMax
        ) {
          showToast("You're outside the demo area — showing Angel");
          setQuery(ANGEL.n);
          setDestination(ANGEL.lat, ANGEL.lng, ANGEL.n);
          runSearch({ lat: ANGEL.lat, lng: ANGEL.lng });
          return;
        }
        setQuery("My location");
        setDestination(lat, lng, "your location");
        runSearch({ lat, lng });
      },
      () => showToast("Couldn't get a fix — type an address instead"),
      { timeout: 8000 },
    );
  }, [setDestination, runSearch, showToast]);

  const onCta = useCallback(() => {
    if (dest) {
      runSearch();
    } else if (query.trim()) {
      void (async () => {
        if (await onPostcode(query.trim(), true)) return;
        const q = query.trim().toLowerCase();
        const p = PLACES.find((p) => (p.n + " " + p.a).toLowerCase().includes(q));
        if (p) {
          onPickPlace(p);
          runSearch({ lat: p.lat, lng: p.lng });
        } else {
          showToast("Try a postcode (e.g. N1 8DU) or an area name");
        }
      })();
    } else {
      parkHereNow();
    }
  }, [dest, query, runSearch, onPostcode, onPickPlace, parkHereNow, showToast]);

  const onSelect = useCallback((idx: number, pan: boolean) => {
    setSelection({ idx, pan });
  }, []);

  const ctaLabel = dest || query.trim() ? "Find parking" : "Park here and now";

  return (
    <div className="app">
      <MapView
        dest={dest}
        window={window_}
        results={results}
        selection={selection}
        onSelect={(i) => onSelect(i, false)}
        toast={toast}
      />

      {results && (
        <ResultsSheet
          results={results}
          window={window_}
          destName={destName}
          selectedIdx={selection?.idx ?? null}
          onSelectCard={(i) => onSelect(i, true)}
        />
      )}

      {!overlayOpen && (
        <div className="summary-pill">
          <div className="sum-txt">
            <b>{destName}</b>
            <span>{window_ ? fmtDT(window_.start) + " → " + fmtDT(window_.end) : ""}</span>
          </div>
          <button className="edit-btn" onClick={() => setOverlayOpen(true)}>
            Edit
          </button>
        </div>
      )}

      {overlayOpen && (
        <Landing
          query={query}
          onQueryChange={(q) => {
            setQuery(q);
            setDest(null);
          }}
          onPickPlace={onPickPlace}
          onPostcode={onPostcode}
          dateVal={dateVal}
          fromTime={fromTime}
          toTime={toTime}
          onDateChange={setDateVal}
          onFromChange={setFromTime}
          onToChange={setToTime}
          ctaLabel={ctaLabel}
          onCta={onCta}
          onFind={() => runSearch()}
          onEnterNoMatch={() => showToast("Try a postcode (e.g. N1 8DU) or an area name")}
          startExpanded={hasSearched}
          destChosen={dest !== null}
        />
      )}
    </div>
  );
}
