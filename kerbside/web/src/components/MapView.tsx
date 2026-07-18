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
import { gmapsLink } from "../time";

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
  noStop: ["⊘", "nostop"],
  noLoad: ["L", "noload"],
};

/** Destination marker: a car, so it reads as "leave the car here". */
const CAR_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff" aria-hidden="true">' +
  '<path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h.5a1.5 1.5 0 0 1 1.5 1.5V17a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4.5A1.5 1.5 0 0 1 4.5 11H5zm2.2-.5h9.6l-1-3a.5.5 0 0 0-.48-.35H8.68a.5.5 0 0 0-.48.35l-1 3zM7 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>' +
  "</svg>";

function pinIcon(spot: Spot, dim: boolean, win: boolean): L.DivIcon {
  const [ch, cls] = ICONS[spot.type];
  return L.divIcon({
    className: "",
    html: '<div class="pin ' + cls + (dim ? " dim" : "") + (win ? " win" : "") + '">' + ch + "</div>",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
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
        html: '<div class="dest-pin">' + CAR_SVG + "</div>",
        iconSize: [34, 34],
        iconAnchor: [17, 17],
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
      const m = L.marker([r.spot.lat, r.spot.lng], { icon: pinIcon(r.spot, !r.valid, false) })
        .bindPopup(
          '<div class="pp-name">' + r.spot.n + "</div>" +
            '<span class="' + (r.costPence === 0 && r.valid ? "pp-cost pp-free" : "pp-cost") + '">' +
            (r.valid ? fmtCost(r.costPence) : "Not available") + "</span>" +
            " · " + r.walkMin + ' min walk<br><span style="color:#43506E">' + r.note + "</span><br>" +
            '<a href="' + gmapsLink(r.spot.lat, r.spot.lng) +
            '" target="_blank" rel="noopener" style="font-weight:700;color:#1D6FEB">Navigate in Google Maps ↗</a>',
        )
        .on("click", () => onSelectRef.current(i));
      m.addTo(layer);
      markersRef.current.push(m);
    });
    // recentre on the searched destination and its options (also after "Edit"),
    // but only when a new search produced these results — not on a mere dest change
    const map = mapRef.current;
    if (map && results !== fittedRef.current) {
      fittedRef.current = results;
      const pts: [number, number][] = results
        .filter((r) => r.valid)
        .map((r) => [r.spot.lat, r.spot.lng]);
      if (dest) pts.push([dest.lat, dest.lng]);
      if (pts.length > 1) {
        map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16, animate: true });
      } else if (dest) {
        map.setView([dest.lat, dest.lng], 15, { animate: true });
      }
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
      m.setIcon(pinIcon(rr.spot, !rr.valid, j === selection.idx));
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
