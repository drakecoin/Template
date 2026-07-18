import type { LatLng, Zone } from "@kerbside/engine";
import { useCallback, useRef, useState } from "react";
import {
  deviceLocation,
  makeThumbnail,
  readExifGps,
  saveReport,
  type LocationSource,
  type ParkingReport,
} from "../report";

interface Props {
  open: boolean;
  onClose: () => void;
  destZone: Zone | null;
  dest: LatLng | null;
  onSubmitted: (msg: string) => void;
}

interface Draft {
  file: File;
  thumbnail?: string;
  lat: number | null;
  lng: number | null;
  source: LocationSource | null;
}

const SOURCE_LABEL: Record<LocationSource, string> = {
  "photo-exif": "from the photo's location tag",
  "device-gps": "from your device's location",
  manual: "entered by hand",
};

export function UpdateDialog({ open, onClose, destZone, dest, onSubmitted }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setDraft(null);
    setManualLat("");
    setManualLng("");
    setNote("");
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setBusy(true);
      const [thumbnail, exif] = await Promise.all([makeThumbnail(file), readExifGps(file)]);
      let lat = exif?.lat ?? null;
      let lng = exif?.lng ?? null;
      let source: LocationSource | null = exif ? "photo-exif" : null;
      if (!source) {
        const dev = await deviceLocation();
        if (dev) {
          lat = dev.lat;
          lng = dev.lng;
          source = "device-gps";
        }
      }
      if (source && lat != null && lng != null) {
        setManualLat(lat.toFixed(6));
        setManualLng(lng.toFixed(6));
      } else if (dest) {
        // Nothing to go on — prefill the searched destination for the user to confirm.
        setManualLat(dest.lat.toFixed(6));
        setManualLng(dest.lng.toFixed(6));
      }
      setDraft({ file, thumbnail, lat, lng, source });
      setBusy(false);
    },
    [dest],
  );

  const submit = useCallback(() => {
    if (!draft) return;
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && manualLat !== "" && manualLng !== "";
    // If the user typed/edited the coordinates, that is a manual location.
    const edited =
      draft.lat == null ||
      draft.lng == null ||
      lat.toFixed(6) !== draft.lat.toFixed(6) ||
      lng.toFixed(6) !== draft.lng.toFixed(6);
    const source: LocationSource | null = hasCoords ? (edited ? "manual" : draft.source) : null;

    const report: ParkingReport = {
      id: (crypto.randomUUID?.() ?? String(Date.now())),
      createdAt: new Date().toISOString(),
      photoName: draft.file.name || "sign-photo.jpg",
      photoSize: draft.file.size,
      thumbnail: draft.thumbnail,
      lat: hasCoords ? lat : null,
      lng: hasCoords ? lng : null,
      locationSource: source,
      zoneId: destZone?.id,
      zoneName: destZone?.name,
      note: note.trim() || undefined,
    };
    saveReport(report);
    console.info("[kerbside] sign report logged", report);
    onSubmitted(
      hasCoords
        ? "Thanks — sign photo logged for review " + (source ? SOURCE_LABEL[source] : "")
        : "Thanks — photo logged (no location; add one to help us place it)",
    );
    close();
  }, [draft, manualLat, manualLng, note, destZone, onSubmitted, close]);

  if (!open) return null;

  const locationKnown = draft?.source != null && draft.lat != null && draft.lng != null;

  return (
    <div className="dlg-scrim" onClick={close}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label="Update parking data" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <h3>Spotted a sign we got wrong?</h3>
          <button className="dlg-x" onClick={close} aria-label="Close">×</button>
        </div>
        <p className="dlg-sub">
          Take a photo of the street sign. We log the picture and where it was taken
          {destZone ? " for " + destZone.name : ""} so the data can be checked.
        </p>

        <input
          ref={fileRef}
          className="dlg-file"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
        />
        <button className="dlg-shot" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Reading photo…" : draft ? "Retake / choose another" : "📷 Take a photo of the sign"}
        </button>

        {draft && (
          <div className="dlg-preview">
            {draft.thumbnail && <img src={draft.thumbnail} alt="Sign preview" />}
            <div className="dlg-loc">
              {locationKnown ? (
                <span className="dlg-loc-ok">
                  Location found {draft.source ? SOURCE_LABEL[draft.source] : ""}
                </span>
              ) : (
                <span className="dlg-loc-warn">No location on the photo — add or confirm it below</span>
              )}
              <div className="dlg-coords">
                <label>
                  Lat
                  <input
                    inputMode="decimal"
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                    placeholder="51.5352"
                  />
                </label>
                <label>
                  Lng
                  <input
                    inputMode="decimal"
                    value={manualLng}
                    onChange={(e) => setManualLng(e.target.value)}
                    placeholder="-0.1404"
                  />
                </label>
              </div>
              <textarea
                className="dlg-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What does the sign say? e.g. Mon–Sun 08:30–18:30"
                rows={2}
              />
            </div>
          </div>
        )}

        <div className="dlg-actions">
          <button className="dlg-cancel" onClick={close}>Cancel</button>
          <button className="dlg-submit" onClick={submit} disabled={!draft || busy}>
            Submit report
          </button>
        </div>
      </div>
    </div>
  );
}
