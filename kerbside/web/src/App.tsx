import {
  evaluate,
  fmtCost,
  MAX_WINDOW_HOURS,
  type EvaluatedOption,
  type LatLng,
  type Place,
} from "@kerbside/engine";
import { useCallback, useRef, useState } from "react";
import { Header } from "./components/Header";
import { MapView, type Selection } from "./components/MapView";
import { ResultsSheet } from "./components/ResultsSheet";
import { SearchPanel } from "./components/SearchPanel";
import { geocodePostcode, parsePostcode } from "./geocode";
import { fmtDT, presetWindow, toLocalISO, type PresetKey } from "./time";

const LONDON_BBOX = { latMin: 51.28, latMax: 51.7, lngMin: -0.51, lngMax: 0.33 };
const ANGEL: Place = { n: "Angel, Islington", a: "N1", lat: 51.5322, lng: -0.1057 };

export function App() {
  const initial = presetWindow("now2");
  const [query, setQuery] = useState("");
  const [dest, setDest] = useState<LatLng | null>(null);
  const [destName, setDestName] = useState("");
  const [fromVal, setFromVal] = useState(toLocalISO(initial.start));
  const [toVal, setToVal] = useState(toLocalISO(initial.end));
  const [activeChip, setActiveChip] = useState<PresetKey | null>("now2");
  const [collapsed, setCollapsed] = useState(false);
  const [summaryTime, setSummaryTime] = useState("");
  const [results, setResults] = useState<EvaluatedOption[] | null>(null);
  const [window_, setWindow] = useState<{ start: Date; end: Date } | null>(null);
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
        showToast("Pick a destination first");
        return;
      }
      const start = new Date(fromVal);
      const end = new Date(toVal);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        showToast("Set your arrive & leave times");
        return;
      }
      if (end <= start) {
        showToast("Leave time must be after arrival");
        return;
      }
      if (end.getTime() - start.getTime() > MAX_WINDOW_HOURS * 36e5) {
        showToast("Keep it under 48 hours for this demo");
        return;
      }

      const res = evaluate(d, start, end);
      setWindow({ start, end });
      setResults(res);
      setSummaryTime(fmtDT(start) + " → " + fmtDT(end));
      setCollapsed(true);

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
    [dest, fromVal, toVal, showToast],
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
      if (!g.exact && pc.full) showToast("Live lookup unavailable — using " + pc.outward + " district centre");
      if (run) runSearch({ lat: g.lat, lng: g.lng });
      return true;
    },
    [setDestination, runSearch, showToast],
  );

  const onGps = useCallback(() => {
    if (!navigator.geolocation) {
      showToast("Location isn't available here — try searching instead");
      return;
    }
    showToast("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        // keep the demo inside Greater London
        if (lat < LONDON_BBOX.latMin || lat > LONDON_BBOX.latMax || lng < LONDON_BBOX.lngMin || lng > LONDON_BBOX.lngMax) {
          showToast("You're outside the demo area — dropping you at Angel");
          setQuery(ANGEL.n);
          setDestination(ANGEL.lat, ANGEL.lng, ANGEL.n);
          return;
        }
        setQuery("My location");
        setDestination(lat, lng, "your location");
      },
      () => showToast("Couldn't get a fix — search an address instead"),
      { timeout: 8000 },
    );
  }, [setDestination, showToast]);

  const onChip = useCallback((key: PresetKey) => {
    setActiveChip(key);
    const w = presetWindow(key);
    setFromVal(toLocalISO(w.start));
    setToVal(toLocalISO(w.end));
  }, []);

  const onSelect = useCallback((idx: number, pan: boolean) => {
    setSelection({ idx, pan });
  }, []);

  return (
    <>
      <div className="left-col">
        <Header mini={collapsed} />
        <SearchPanel
          collapsed={collapsed}
          summaryDest={destName}
          summaryTime={summaryTime}
          onEdit={() => setCollapsed(false)}
          query={query}
          onQueryChange={setQuery}
          onPickPlace={onPickPlace}
          onPostcode={onPostcode}
          onGps={onGps}
          fromVal={fromVal}
          toVal={toVal}
          onFromChange={(v) => {
            setFromVal(v);
            setActiveChip(null);
          }}
          onToChange={(v) => {
            setToVal(v);
            setActiveChip(null);
          }}
          activeChip={activeChip}
          onChip={onChip}
          onFind={() => runSearch()}
          onEnterNoMatch={() => showToast("Try a postcode (e.g. N1 8DU) or an area name")}
        />
      </div>

      <MapView
        dest={dest}
        window={window_}
        results={results}
        selection={selection}
        onSelect={(i) => onSelect(i, false)}
        toast={toast}
      />

      <ResultsSheet
        results={results}
        window={window_}
        destName={destName}
        selectedIdx={selection?.idx ?? null}
        onSelectCard={(i) => onSelect(i, true)}
      />
    </>
  );
}
