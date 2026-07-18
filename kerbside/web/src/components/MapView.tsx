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
import { useEffect, useRef } from "react";
import { gmapsLink } from "../time";

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
};

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
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: false }).setView([51.5155, -0.11], 12);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    zoneLayerRef.current = L.layerGroup().addTo(map);
    spotLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
          color: active ? (borough ? "#D9A93E" : "#E8A200") : "#AEB7C9",
          weight: borough ? 1 : 1.6,
          dashArray: borough ? "2 6" : "5 5",
          fillColor: active ? "#FFCF33" : "#C9D1E0",
          fillOpacity: borough ? (active ? 0.06 : 0.03) : active ? 0.16 : 0.07,
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
        html: '<div class="dest-pin"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
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
    setTimeout(() => mapRef.current?.invalidateSize(), 300);
  }, [results]);

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
      <div className="legend">
        <span><i className="dotk" style={{ background: "var(--p-blue)" }} />Car park</span>
        <span><i className="dotk" style={{ background: "var(--zone-amber)" }} />Paid bay</span>
        <span><i className="dotk" style={{ background: "var(--go-green)" }} />Free option</span>
        <span><i className="dotk" style={{ background: "#FFCF33", opacity: 0.5, borderRadius: 3 }} />CPZ (active)</span>
      </div>
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </div>
  );
}
