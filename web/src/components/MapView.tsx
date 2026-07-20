import {
  ALL_ZONES,
  fmtCost,
  zoneActiveDuring,
  zoneHoursText,
  zoneRings,
  type EvaluatedOption,
  type LatLng,
  type Spot,
} from "@kerbside/engine";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { fmtWalk, gmapsLink } from "../time";

type BaseLayer = "map" | "sat";

/** Clean, Google-Maps-like street tiles (CARTO Voyager). */
function streetTiles(): L.TileLayer {
  return L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 20,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  );
}

/** Satellite imagery (Esri World Imagery). */
function satTiles(): L.TileLayer {
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Imagery &copy; Esri &amp; contributors",
    },
  );
}

export interface Selection {
  idx: number;
  pan: boolean;
}

interface Props {
  dest: LatLng | null;
  window: { start: Date; end: Date } | null;
  results: EvaluatedOption[] | null;
  selection: Selection | null;
  onSelect: (idx: number) => void;
  toast: string | null;
}

const ICONS: Record<Spot["type"], [string, string]> = {
  cp: ["P", "cp"],
  paid: ["£", "paid"],
  res: ["R", "res"],
  yellow: ["F", "free"],
  freeSt: ["F", "free"],
  cpzStreet: ["Z", "res"],
  noStop: ["⊘", "nostop"],
  noLoad: ["L", "noload"],
};

/**
 * Icon glyph + class for an evaluated option. A paid bay that is FREE during the
 * searched window drops the "£" for a tick on the free (green) badge, so it
 * never looks like it will cost money — and a CPZ street whose zone is off for
 * the window is free parking, so it gets the green badge too.
 */
function iconFor(r: EvaluatedOption): [string, string] {
  if (r.spot.type === "paid" && r.valid && r.costPence === 0) return ["✓", "free"];
  if (r.spot.type === "cpzStreet" && r.valid) return ["F", "free"];
  return ICONS[r.spot.type];
}

/** Destination marker: the Park Up mark — a blue location flag with a white "P". */
const DEST_PIN_SVG =
  '<svg viewBox="0 0 48 64" width="40" height="53" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M24 2C13 2 4 11 4 22c0 14.5 20 39 20 39s20-24.5 20-39C44 11 35 2 24 2Z" fill="#1D6FEB" stroke="#fff" stroke-width="2.5"/>' +
  '<circle cx="24" cy="22" r="12.5" fill="#fff"/>' +
  '<text x="24" y="23" text-anchor="middle" dominant-baseline="central" font-size="19" font-weight="900" font-family="Alegreya,Georgia,serif" fill="#1D6FEB">P</text>' +
  "</svg>";

function pinIcon(r: EvaluatedOption, win: boolean): L.DivIcon {
  const [ch, cls] = iconFor(r);
  const dim = !r.valid;
  return L.divIcon({
    className: "",
    html: '<div class="pin ' + cls + (dim ? " dim" : "") + (win ? " win" : "") + '">' + ch + "</div>",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/** Open tight (~200 m radius). */
const INITIAL_RADIUS_KM = 0.2;
/** Keep the tight view only if it holds at least this many options. */
const MIN_OPTIONS_TIGHT = 3;
/** Otherwise zoom out to reveal up to this many of the nearest options. */
const OPTIONS_WHEN_ZOOMING_OUT = 5;

/**
 * Padding (in px) so fitBounds frames content into the map area the results
 * sheet doesn't cover: below it in portrait, right of it on desktop. Keeps the
 * car centred in the *visible* region rather than the whole page.
 */
function visiblePadding(map: L.Map): { tl: L.PointTuple; br: L.PointTuple } {
  const gut = 40;
  const sheet = document.querySelector<HTMLElement>(".results");
  if (!sheet) return { tl: [gut, gut], br: [gut, gut] };
  const m = map.getContainer().getBoundingClientRect();
  const r = sheet.getBoundingClientRect();
  if (window.innerWidth >= 760) {
    // left-hand panel — pad the left by how far it reaches across the map
    const left = Math.max(0, r.right - m.left);
    return { tl: [left + gut, gut], br: [gut, gut] };
  }
  // bottom sheet — pad the bottom by how much of the map it hides
  const bottom = Math.max(0, m.bottom - r.top);
  return { tl: [gut, gut], br: [gut, bottom + gut] };
}

/**
 * Frame the destination on first load: start at ~200 m; if fewer than 3 options
 * fall inside that, widen just enough to show up to 5 of the closest options.
 * Framing is offset for the results sheet so the car sits in the visible area.
 */
function fitToInitialOptions(map: L.Map, dest: LatLng | null, results: EvaluatedOption[]): void {
  const valid = results.filter((r) => r.valid).sort((a, b) => a.km - b.km);
  if (!dest && !valid.length) return;

  let radiusKm = INITIAL_RADIUS_KM;
  const within = valid.filter((r) => r.km <= INITIAL_RADIUS_KM).length;
  if (within < MIN_OPTIONS_TIGHT && valid.length) {
    const n = Math.min(OPTIONS_WHEN_ZOOMING_OUT, valid.length);
    radiusKm = Math.max(INITIAL_RADIUS_KM, valid[n - 1].km);
  }

  const { tl, br } = visiblePadding(map);
  const fitOpts: L.FitBoundsOptions = {
    paddingTopLeft: tl,
    paddingBottomRight: br,
    maxZoom: 17,
    animate: true,
  };

  if (!dest) {
    const pts = valid
      .filter((r) => r.km <= radiusKm)
      .map((r) => [r.spot.lat, r.spot.lng] as [number, number]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts), fitOpts);
    return;
  }

  // A box of radiusKm around the destination keeps the car central and
  // guarantees every option within that radius is visible.
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((dest.lat * Math.PI) / 180));
  map.fitBounds(
    L.latLngBounds(
      [dest.lat - latDelta, dest.lng - lngDelta],
      [dest.lat + latDelta, dest.lng + lngDelta],
    ),
    fitOpts,
  );
}

export function MapView({ dest, window: win, results, selection, onSelect, toast }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const zoneLayerRef = useRef<L.LayerGroup | null>(null);
  const spotLayerRef = useRef<L.LayerGroup | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const walkLineRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const tileRef = useRef<L.TileLayer | null>(null);
  const fittedRef = useRef<EvaluatedOption[] | null>(null);
  const [base, setBase] = useState<BaseLayer>("map");
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: false }).setView([51.5155, -0.11], 12);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    tileRef.current = streetTiles().addTo(map);
    zoneLayerRef.current = L.layerGroup().addTo(map);
    spotLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
    };
  }, []);

  // base layer switch (Map / Satellite)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    tileRef.current = (base === "sat" ? satTiles() : streetTiles()).addTo(map);
    tileRef.current.bringToBack();
  }, [base]);

  // zone polygons, amber when active during the searched window
  useEffect(() => {
    const layer = zoneLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    // borough fallbacks first so specific zones draw on top of them
    const ordered = [...ALL_ZONES].sort((a) => (a.kind === "borough" ? -1 : 1));
    for (const z of ordered) {
      const active = win ? zoneActiveDuring(z, win.start, win.end) : true;
      const borough = z.kind === "borough";
      const popup =
        "<b>" + z.name + "</b><br>Controlled: " + zoneHoursText(z) +
        (active
          ? "<br><b style='color:#B54708'>Active during your stay</b>"
          : "<br>Not active for your times") +
        (borough ? "<br><i>Borough-level estimate — hours vary by zone</i>" : "") +
        "<br><a href='" + z.src + "' target='_blank' rel='noopener'>" +
        (z.verified ? "Hours from borough website ↗" : "Indicative — check borough website ↗") +
        "</a>";
      for (const ring of zoneRings(z)) {
        L.polygon(ring, {
          color: active ? (borough ? "#C98A1B" : "#D97706") : "#94A3B8",
          weight: borough ? 2 : 2.5,
          dashArray: borough ? "6 8" : undefined,
          fillColor: active ? "#FFC533" : "#C9D1E0",
          fillOpacity: borough ? (active ? 0.08 : 0.03) : active ? 0.22 : 0.08,
        })
          .bindPopup(popup)
          .addTo(layer);
      }
    }
  }, [win]);

  // destination pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    destMarkerRef.current?.remove();
    destMarkerRef.current = null;
    if (!dest) return;
    destMarkerRef.current = L.marker([dest.lat, dest.lng], {
      icon: L.divIcon({
        className: "",
        html: '<div class="dest-flag">' + DEST_PIN_SVG + "</div>",
        iconSize: [40, 53],
        iconAnchor: [20, 52],
      }),
      zIndexOffset: 1000,
    }).addTo(map);
    map.setView([dest.lat, dest.lng], 15, { animate: true });
  }, [dest]);

  // result markers
  useEffect(() => {
    const layer = spotLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersRef.current = [];
    walkLineRef.current?.remove();
    walkLineRef.current = null;
    if (!results) return;
    results.forEach((r, i) => {
      const m = L.marker([r.spot.lat, r.spot.lng], { icon: pinIcon(r, false) })
        .bindPopup(
          '<div class="pp-name">' + r.spot.n + "</div>" +
            '<span class="' + (r.costPence === 0 && r.valid ? "pp-cost pp-free" : "pp-cost") + '">' +
            (r.valid ? fmtCost(r.costPence) : "Not available") + "</span>" +
            " · " + fmtWalk(r.km, r.walkMin, false) + '<br><span style="color:#43506E">' + r.note + "</span><br>" +
            '<a href="' + gmapsLink(r.spot.lat, r.spot.lng) +
            '" target="_blank" rel="noopener" style="font-weight:700;color:#1D6FEB">Navigate in Google Maps ↗</a>',
        )
        .on("click", () => onSelectRef.current(i));
      m.addTo(layer);
      markersRef.current.push(m);
    });
    // recentre on the searched destination (also after "Edit"), but only when a
    // new search produced these results — not on a mere dest change.
    // Open tight (~200 m radius); if fewer than 3 options fall inside that, zoom
    // out just enough to reveal up to 5 of the nearest options.
    const map = mapRef.current;
    if (map && results !== fittedRef.current) {
      fittedRef.current = results;
      fitToInitialOptions(map, dest, results);
    }
    setTimeout(() => mapRef.current?.invalidateSize(), 300);
  }, [results, dest]);

  // selection: highlight pin, draw the dashed walk line, optionally pan
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !results || !selection) return;
    const r = results[selection.idx];
    if (!r) return;
    markersRef.current.forEach((m, j) => {
      const rr = results[j];
      m.setIcon(pinIcon(rr, j === selection.idx));
    });
    walkLineRef.current?.remove();
    walkLineRef.current = null;
    if (dest) {
      walkLineRef.current = L.polyline(
        [
          [dest.lat, dest.lng],
          [r.spot.lat, r.spot.lng],
        ],
        { color: "#101A33", weight: 2.5, dashArray: "4 7", opacity: 0.75 },
      ).addTo(map);
    }
    if (selection.pan) {
      map.panTo([r.spot.lat, r.spot.lng]);
      markersRef.current[selection.idx]?.openPopup();
    }
  }, [selection, results, dest]);

  // recenter button (in the results sheet) asks the map to reframe the options
  useEffect(() => {
    const onRecenter = () => {
      const map = mapRef.current;
      if (!map) return;
      if (results && results.length) fitToInitialOptions(map, dest, results);
      else if (dest) map.setView([dest.lat, dest.lng], 15, { animate: true });
    };
    window.addEventListener("parkup:recenter", onRecenter);
    return () => window.removeEventListener("parkup:recenter", onRecenter);
  }, [dest, results]);

  return (
    <div className="map-shell">
      <div className="map" ref={divRef} />
      <div className="layer-toggle" role="group" aria-label="Map style">
        <button
          className={base === "map" ? "on" : ""}
          onClick={() => setBase("map")}
        >
          Map
        </button>
        <button
          className={base === "sat" ? "on" : ""}
          onClick={() => setBase("sat")}
        >
          Satellite
        </button>
      </div>
      <div className="legend">
        <span><i className="dotk" style={{ background: "var(--p-blue)" }} />Car park</span>
        <span><i className="dotk" style={{ background: "var(--zone-amber)" }} />Paid bay</span>
        <span><i className="dotk" style={{ background: "var(--go-green)" }} />Free option</span>
        <span><i className="dotk" style={{ background: "var(--coral)" }} />No stopping / loading</span>
        <span><i className="dotk" style={{ background: "#FFCF33", opacity: 0.5, borderRadius: 3 }} />CPZ (active)</span>
      </div>
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </div>
  );
}
