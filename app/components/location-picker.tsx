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
  color: "var(--text)",
};

const fieldStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "1rem",
  lineHeight: 1.5,
  padding: "0.7rem 0.8rem",
  margin: "0.25rem 0 1rem",
  color: "var(--text)",
  background: "var(--panel-2)",
  border: "1px solid var(--line)",
  borderRadius: "10px",
};

const PRIORITIES: { value: string; label: string; priority: LocationPriority | null }[] = [
  { value: "", label: "Untagged", priority: null },
  { value: "critical", label: "Critical", priority: "critical" },
  { value: "important", label: "Important", priority: "important" },
  { value: "routine", label: "Routine", priority: "routine" },
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
  const [kind, setKind] = useState<LocationKind>(initial?.kind ?? "related");
  const [priority, setPriority] = useState<LocationPriority | null>(
    initial?.kind === "crime-scene" ? null : (initial?.priority ?? null),
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
    kind === "crime-scene"
      ? "Crime Scene"
      : priority
        ? locationLabel(previewLoc)
        : "Untagged";

  async function searchAddress() {
    const q = address.trim();
    if (!q) {
      setError("Type an address or place name to search.");
      setResults([]);
      return;
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&accept-language=en&limit=5&q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) throw new Error("search failed");
      const data: unknown = await res.json();
      const list = Array.isArray(data) ? (data as NominatimResult[]).slice(0, 5) : [];
      if (list.length === 0) {
        setResults([]);
        setError("Address not found; you can select by clicking the map.");
        return;
      }
      setError("");
      setResults(list);
    } catch {
      setResults([]);
      setError("Could not search the address; check your connection or select by clicking the map.");
    }
  }

  function locateMe() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Could not get your location; you can select by clicking the map.");
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
        setError("Could not get your location; please grant permission or select by clicking the map.");
      },
      { timeout: 8000 },
    );
  }

  function handleConfirm() {
    if (!title.trim()) {
      setError("Location Title is required.");
      return;
    }
    setError("");
    onConfirm({
      id: initial?.id ?? newId(),
      title: title.trim(),
      note: note.trim(),
      kind,
      priority: kind === "crime-scene" ? null : priority,
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
      className="editor-backdrop"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
          return;
        }
        if (e.key !== "Enter") return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        // Keep the address search's own Enter behavior.
        if (target.id === id("address")) return;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) {
          e.preventDefault();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit Location" : "Select Location"}
        className="editor-dialog"
        style={{ ...textStyle, maxWidth: "48rem" }}
      >
        <div className="editor-head">
          <div>
            <h2>{isEdit ? "Edit Location" : "Select Location"}</h2>
            <p className="editor-sub">
              Name the place first, then pin it by searching an address or
              clicking the map. Coordinates are optional.
            </p>
          </div>
          <button type="button" className="editor-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="editor-body">
        <p className="editor-section-title">Type</p>
        <div className="choice-row" role="radiogroup" aria-label="Type">
          <label className="choice-chip">
            <input
              type="radio"
              name={id("kind")}
              checked={kind === "crime-scene"}
              onChange={() => setKind("crime-scene")}
            />{" "}
            Crime Scene
          </label>
          <label className="choice-chip">
            <input
              type="radio"
              name={id("kind")}
              checked={kind === "related"}
              onChange={() => setKind("related")}
            />{" "}
            Related Location
          </label>
        </div>

        <label htmlFor={id("title")} style={textStyle}>
          Location Title *
        </label>
        <input
          id={id("title")}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={fieldStyle}
        />

        <label htmlFor={id("note")} style={textStyle}>
          Location Note
        </label>
        <input
          id={id("note")}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={fieldStyle}
        />

        {kind === "related" ? (
          <>
            <label htmlFor={id("priority")} style={textStyle}>
              Priority
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
          Find by address / place name
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
          <button type="button" className="btn-ghost" onClick={() => void searchAddress()}>
            Search
          </button>
          <button type="button" className="btn-ghost" onClick={locateMe}>
            Go to My Location
          </button>
        </div>

        {results.length > 0 ? (
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            {results.map((r, i) => (
              <li key={`${r.lat}-${r.lon}-${i}`} style={textStyle}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ textAlign: "left", width: "100%", whiteSpace: "normal", borderRadius: "10px" }}
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
            Selected coordinates: ({pick.latitude.toFixed(6)}, {pick.longitude.toFixed(6)}){" "}
            <button
              type="button"
              className="btn-danger"
              onClick={() => setPick(null)}
            >
              Clear map selection
            </button>
          </p>
        ) : (
          <p style={textStyle}>
            No map selection yet; you can save without coordinates.
          </p>
        )}

        {error ? (
          <p role="alert" style={textStyle}>
            {error}
          </p>
        ) : null}

        </div>

        <div className="editor-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-save-solid" onClick={handleConfirm}>
            {isEdit ? "Save" : "Use This Location"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LocationPicker;
