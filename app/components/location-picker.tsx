"use client";

import { useId, useMemo, useState } from "react";
import MapPicker, { type MapPoint } from "./map-picker";
import {
  locationColor,
  locationLabel,
  type CaseLocationDraft,
  type LocationKind,
  type LocationPriority,
} from "../../lib/locations";

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface LocationPickerProps {
  initial: CaseLocationDraft | null;
  onClose: () => void;
  onConfirm: (draft: CaseLocationDraft) => void;
}

const textStyle: React.CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.5,
  color: "#111111",
};

const fieldStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "1rem",
  lineHeight: 1.5,
  padding: "0.75rem",
  margin: "0.25rem 0 1rem",
  color: "#111111",
  background: "#ffffff",
};

const buttonStyle: React.CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.5,
  padding: "0.6rem 1rem",
  color: "#111111",
  background: "#ffffff",
  border: "1px solid #111111",
  borderRadius: "0.4rem",
  cursor: "pointer",
};

const PRIORITIES: { value: string; label: string; priority: LocationPriority | null }[] = [
  { value: "", label: "Etiketsiz", priority: null },
  { value: "kritik", label: "Kritik", priority: "kritik" },
  { value: "onemli", label: "Önemli", priority: "onemli" },
  { value: "rutin", label: "Rutin", priority: "rutin" },
];

let fallbackIdCounter = 0;
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `loc-${Date.now()}-${(++fallbackIdCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function LocationPicker({ initial, onClose, onConfirm }: LocationPickerProps) {
  const isEdit = initial !== null;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `${uid}-${name}`;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [kind, setKind] = useState<LocationKind>(initial?.kind ?? "iliskili");
  const [priority, setPriority] = useState<LocationPriority | null>(
    initial?.kind === "olay-yeri" ? null : (initial?.priority ?? null),
  );
  const [pick, setPick] = useState<MapPoint | null>(
    initial && typeof initial.latitude === "number" && typeof initial.longitude === "number"
      ? { latitude: initial.latitude, longitude: initial.longitude }
      : null,
  );
  const [address, setAddress] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [error, setError] = useState("");

  const previewLoc = { kind, priority };
  const previewColor = locationColor(previewLoc);
  const previewLabel =
    kind === "olay-yeri"
      ? "Olay Yeri"
      : priority
        ? locationLabel(previewLoc)
        : "Etiketsiz";

  async function searchAddress() {
    const q = address.trim();
    if (!q) {
      setError("Aranacak adres ya da yer adı yazın.");
      setResults([]);
      return;
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&accept-language=tr&limit=5&q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) throw new Error("search failed");
      const data: unknown = await res.json();
      const list = Array.isArray(data) ? (data as NominatimResult[]).slice(0, 5) : [];
      if (list.length === 0) {
        setResults([]);
        setError("Adres bulunamadı; haritadan tıklayarak seçebilirsiniz.");
        return;
      }
      setError("");
      setResults(list);
    } catch {
      setResults([]);
      setError("Adres aranamadı; bağlantıyı kontrol edin, haritadan tıklayarak da seçebilirsiniz.");
    }
  }

  function locateMe() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Konum alınamadı; haritadan tıklayarak seçebilirsiniz.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setError("");
        setPick({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      () => {
        setError("Konum alınamadı; izin vermeniz gerekir ya da haritadan tıklayarak seçebilirsiniz.");
      },
      { timeout: 8000 },
    );
  }

  function handleConfirm() {
    if (!title.trim()) {
      setError("Konum Başlığı zorunludur.");
      return;
    }
    setError("");
    onConfirm({
      id: initial?.id ?? newId(),
      title: title.trim(),
      note: note.trim(),
      kind,
      priority: kind === "olay-yeri" ? null : priority,
      latitude: pick?.latitude,
      longitude: pick?.longitude,
    });
  }

  const mapPick = useMemo<MapPoint | null>(
    () =>
      pick
        ? { ...pick, title: title || undefined, note: note || undefined, kind, priority }
        : null,
    [pick, title, note, kind, priority],
  );

  return (
    <div
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        // Adres aramanın kendi Enter davranışı kalır.
        if (target.id === id("address")) return;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) {
          e.preventDefault();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
        boxSizing: "border-box",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Konumu Düzenle" : "Konum Seç"}
        style={{
          background: "#ffffff",
          color: "#111111",
          width: "100%",
          maxWidth: "40rem",
          maxHeight: "90vh",
          overflowY: "auto",
          borderRadius: "0.6rem",
          padding: "1.25rem",
          boxSizing: "border-box",
          ...textStyle,
        }}
      >
        <h2 style={{ ...textStyle, fontSize: "1.25rem", margin: "0 0 1rem" }}>
          {isEdit ? "Konumu Düzenle" : "Konum Seç"}
        </h2>

        <fieldset style={{ margin: "0 0 1rem", padding: "0.75rem" }}>
          <legend style={textStyle}>Tür</legend>
          <label style={{ ...textStyle, display: "block", marginBottom: "0.5rem" }}>
            <input
              type="radio"
              name={id("kind")}
              checked={kind === "olay-yeri"}
              onChange={() => setKind("olay-yeri")}
            />{" "}
            Olay Yeri
          </label>
          <label style={{ ...textStyle, display: "block" }}>
            <input
              type="radio"
              name={id("kind")}
              checked={kind === "iliskili"}
              onChange={() => setKind("iliskili")}
            />{" "}
            İlişkili Konum
          </label>
        </fieldset>

        <label htmlFor={id("title")} style={textStyle}>
          Konum Başlığı *
        </label>
        <input
          id={id("title")}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={fieldStyle}
        />

        <label htmlFor={id("note")} style={textStyle}>
          Konum Not
        </label>
        <input
          id={id("note")}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={fieldStyle}
        />

        {kind === "iliskili" ? (
          <>
            <label htmlFor={id("priority")} style={textStyle}>
              Öncelik
            </label>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              <select
                id={id("priority")}
                value={priority ?? ""}
                onChange={(e) =>
                  setPriority(
                    e.target.value === ""
                      ? null
                      : (e.target.value as LocationPriority),
                  )
                }
                style={{ ...fieldStyle, width: "auto", flex: "1 1 12rem" }}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.label} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span
                style={{
                  background: previewColor.badgeBg,
                  color: previewColor.badgeFg,
                  padding: "0.25rem 0.6rem",
                  borderRadius: "0.4rem",
                  fontSize: "1rem",
                  lineHeight: 1.5,
                  marginTop: "0.25rem",
                }}
              >
                {previewLabel}
              </span>
            </div>
          </>
        ) : (
          <p style={textStyle}>
            <span
              style={{
                background: previewColor.badgeBg,
                color: previewColor.badgeFg,
                padding: "0.25rem 0.6rem",
                borderRadius: "0.4rem",
                fontSize: "1rem",
                lineHeight: 1.5,
              }}
            >
              {previewLabel}
            </span>
          </p>
        )}

        <label htmlFor={id("address")} style={textStyle}>
          Adres / yer adı ile bul
        </label>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <input
            id={id("address")}
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void searchAddress();
              }
            }}
            style={{ ...fieldStyle, margin: 0, flex: "1 1 14rem", width: "auto" }}
          />
          <button type="button" onClick={() => void searchAddress()} style={buttonStyle}>
            Ara
          </button>
          <button type="button" onClick={locateMe} style={buttonStyle}>
            Konumuma Git
          </button>
        </div>

        {results.length > 0 ? (
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            {results.map((r, i) => (
              <li key={`${r.lat}-${r.lon}-${i}`} style={textStyle}>
                <button
                  type="button"
                  style={{ ...buttonStyle, textAlign: "left" }}
                  onClick={() => {
                    setPick({
                      latitude: Number.parseFloat(r.lat),
                      longitude: Number.parseFloat(r.lon),
                    });
                    setError("");
                    setResults([]);
                  }}
                >
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <MapPicker pick={mapPick} onPick={setPick} height={260} />

        {pick ? (
          <p style={textStyle}>
            Seçili koordinat: ({pick.latitude.toFixed(6)}, {pick.longitude.toFixed(6)}){" "}
            <button
              type="button"
              onClick={() => setPick(null)}
              style={buttonStyle}
            >
              Harita seçimini temizle
            </button>
          </p>
        ) : (
          <p style={textStyle}>
            Henüz harita seçimi yok; koordinatsız da kaydedebilirsiniz.
          </p>
        )}

        {error ? (
          <p role="alert" style={textStyle}>
            {error}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" onClick={onClose} style={buttonStyle}>
            Vazgeç
          </button>
          <button type="button" onClick={handleConfirm} style={buttonStyle}>
            {isEdit ? "Kaydet" : "Bu Konumu Kullan"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LocationPicker;
