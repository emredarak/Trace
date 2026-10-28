"use client";

import { useMemo, useState } from "react";
import MapPicker, { type MapPoint } from "./map-picker";
import { LocationPicker } from "./location-picker";
import {
  locationColor,
  locationLabel,
  sortLocations,
  type CaseLocationDraft,
} from "../../lib/locations";

export interface LocationsSectionProps {
  locations: CaseLocationDraft[];
  onChange: (locations: CaseLocationDraft[]) => void;
  idPrefix: string;
  readOnly?: boolean;
  onSave?: () => void | Promise<void>;
  onReset?: () => void;
  dirty?: boolean;
  status?: string;
}

const textStyle: React.CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.5,
  color: "var(--text)",
};

export function LocationsSection({
  locations,
  onChange,
  idPrefix,
  readOnly = false,
  onSave,
  onReset,
  dirty,
  status,
}: LocationsSectionProps) {
  // undefined: panel closed, null: new location, draft: location being edited.
  const [picker, setPicker] = useState<CaseLocationDraft | null | undefined>(
    undefined,
  );

  const sorted = useMemo(() => sortLocations(locations), [locations]);
  const points = useMemo<MapPoint[]>(
    () =>
      sorted
        .filter(
          (l) => typeof l.latitude === "number" && typeof l.longitude === "number",
        )
        .map((l) => ({
          latitude: l.latitude as number,
          longitude: l.longitude as number,
          title: l.title,
          note: l.note,
          kind: l.kind,
          priority: l.priority,
        })),
    [sorted],
  );
  const hasCrimeScene = locations.some((l) => l.kind === "crime-scene");

  function handleConfirm(draft: CaseLocationDraft) {
    if (picker) {
      onChange(locations.map((l) => (l.id === picker.id ? draft : l)));
    } else {
      onChange([...locations, draft]);
    }
    setPicker(undefined);
  }

  function removeLocation(loc: CaseLocationDraft) {
    onChange(locations.filter((l) => l.id !== loc.id));
  }

  return (
    <section
      aria-labelledby={`${idPrefix}-konumlar-baslik`}
      className="record-section"
      style={{ ...textStyle, margin: "0 0 1rem" }}
    >
      <div className="record-head">
        <h2 id={`${idPrefix}-konumlar-baslik`}>Locations</h2>
        <span className="record-count">
          {sorted.length} {sorted.length === 1 ? "place" : "places"}
        </span>
      </div>

      {!hasCrimeScene ? (
        <p
          role="note"
          style={{
            ...textStyle,
            color: "#f7d774",
            background: "rgba(242,179,61,.1)",
            border: "1px solid rgba(242,179,61,.55)",
            borderRadius: "10px",
            padding: "0.7rem 0.9rem",
            margin: "0 0 1rem",
            fontSize: "0.92rem",
          }}
        >
          No location in this case is marked as Crime Scene.
        </p>
      ) : null}

      <div className="map-clip">
        <MapPicker points={points} readOnly height={280} />
      </div>

      {sorted.length === 0 ? <p style={textStyle}>No locations added.</p> : null}
      <ul className="record-list">
        {sorted.map((loc) => {
          const color = locationColor(loc);
          return (
            <li key={loc.id} className="record-card" style={textStyle}>
              <span className="pin-dot" style={{ background: color.pin }} aria-hidden="true" />
              <div className="record-main">
                <div>
                  <strong>{loc.title}</strong>{" "}
                  <span
                    className="badge-small"
                    style={{ background: color.badgeBg, color: color.badgeFg }}
                  >
                    {locationLabel(loc)}
                  </span>
                </div>
                {loc.note ? <p className="record-note">{loc.note}</p> : null}
                {typeof loc.latitude === "number" &&
                typeof loc.longitude === "number" ? (
                  <p className="record-meta">
                    {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                  </p>
                ) : null}
              </div>
              {!readOnly ? (
                <div className="record-actions">
                  <button type="button" className="btn-ghost" onClick={() => setPicker(loc)}>
                    Edit
                  </button>
                  <button type="button" className="btn-danger" onClick={() => removeLocation(loc)}>
                    Delete
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!readOnly ? (
        <button type="button" className="btn-add" onClick={() => setPicker(null)}>
          + Add Location
        </button>
      ) : null}

      {status ? (
        <p aria-live="polite" style={textStyle}>
          {status}
        </p>
      ) : null}

      {dirty && !readOnly ? (
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginTop: "1rem",
          }}
        >
          <button type="button" className="btn-save-solid" onClick={() => void onSave?.()}>
            Save
          </button>
          <button type="button" className="btn-ghost" onClick={() => onReset?.()}>
            Cancel
          </button>
        </div>
      ) : null}

      {picker !== undefined ? (
        <LocationPicker
          initial={picker}
          onClose={() => setPicker(undefined)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </section>
  );
}

export default LocationsSection;
