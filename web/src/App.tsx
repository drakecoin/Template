import {
  ALL_ZONES,
  DEFAULT_DATASET,
  evaluate,
  fmtCost,
  MAX_WINDOW_HOURS,
  PLACES,
  zoneAt,
  type EvaluatedOption,
  type LatLng,
  type Place,
  type Zone,
} from "@kerbside/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { Landing } from "./components/Landing";
import { MapView, type Selection } from "./components/MapView";
import { ResultsSheet } from "./components/ResultsSheet";
import { geocodePostcode, parsePostcode, searchAddress, type AddressHit } from "./geocode";
import { buildWindow, fmtDT, roundQuarter, toHM, toISODate, type StayWindow } from "./time";

const LONDON_BBOX = { latMin: 51.28, latMax: 51.7, lngMin: -0.51, lngMax: 0.33 };
const ANGEL: Place = { n: "Angel, Islington", a: "N1", lat: 51.5322, lng: -0.1057 };

/** Chromium's non-standard install-prompt event. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

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
  const [destZone, setDestZone] = useState<Zone | null>(null);
  const [window_, setWindow] = useState<StayWindow | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const onInstall = useCallback(() => {
    if (!installEvt) return;
    void installEvt.prompt();
    void installEvt.userChoice.then((c) => {
      if (c.outcome === "accepted") setInstallEvt(null);
    });
  }, [installEvt]);

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

      const res = evaluate(d, win.start, win.end, DEFAULT_DATASET, {
        destinationStreets: true,
      });
      setWindow(win);
      setResults(res);
      setDestZone(zoneAt(d, ALL_ZONES) ?? null);
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

  const onPickAddress = useCallback(
    (h: AddressHit) => {
      setQuery(h.name);
      setDestination(h.lat, h.lng, h.name);
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
      showToast("Location isn't available in this browser — type an address instead");
      return;
    }
    if (!window.isSecureContext) {
      showToast("Location needs HTTPS — open the app over https:// or type an address");
      return;
    }
    const onFix = (pos: GeolocationPosition) => {
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
    };
    const onFail = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) {
        showToast("Location is blocked — allow it in your browser's site settings");
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        showToast("Your device couldn't work out where it is — type an address instead");
      } else {
        showToast("Location timed out — type an address instead");
      }
    };
    showToast("Finding you…");
    // First try: quick, high accuracy, accept a fix from the last 30 s.
    navigator.geolocation.getCurrentPosition(onFix, (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onFail(err);
        return;
      }
      // Second try: low accuracy (wifi/IP), longer timeout, accept a
      // cached fix up to 10 min old — much more reliable on laptops.
      showToast("Still looking — trying a coarser fix…");
      navigator.geolocation.getCurrentPosition(onFix, onFail, {
        enableHighAccuracy: false,
        timeout: 20000,
        maximumAge: 600000,
      });
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
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
          return;
        }
        showToast("Looking up address…");
        const hits = await searchAddress(q);
        if (hits.length) {
          onPickAddress(hits[0]);
          runSearch({ lat: hits[0].lat, lng: hits[0].lng });
        } else {
          showToast("No match — try a street address, postcode or area name");
        }
      })();
    } else {
      parkHereNow();
    }
  }, [dest, query, runSearch, onPostcode, onPickPlace, onPickAddress, parkHereNow, showToast]);

  const onSelect = useCallback((idx: number, pan: boolean) => {
    setSelection({ idx, pan });
  }, []);

  const ctaLabel = dest || query.trim() ? "Find parking" : "Park here and now";

  return (
    <div className={"app" + (overlayOpen ? " landing-open" : "")}>
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
          destZone={destZone}
          dest={dest}
          selectedIdx={selection?.idx ?? null}
          autoScroll={selection ? !selection.pan : false}
          onSelectCard={(i) => onSelect(i, true)}
          onToast={showToast}
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
          onPickAddress={onPickAddress}
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
          onEnterNoMatch={() => showToast("No match — try a street address, postcode or area name")}
          startExpanded={hasSearched}
          destChosen={dest !== null}
          onInstall={installEvt ? onInstall : null}
        />
      )}
    </div>
  );
}
