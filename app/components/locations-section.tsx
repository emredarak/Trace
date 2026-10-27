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
  color: "#f1f5f9",
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
  // undefined: panel kapalı, null: yeni konum, draft: düzenlenen konum.
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
  const hasCrimeScene = locations.some((l) => l.kind === "olay-yeri");

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
      style={{
        ...textStyle,
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: "0.6rem",
        padding: "1rem",
        margin: "0 0 1rem",
      }}
    >
      <h2
        id={`${idPrefix}-konumlar-baslik`}
        style={{ ...textStyle, fontSize: "1.25rem", margin: "0 0 1rem" }}
      >
        Konumlar
      </h2>

      {!hasCrimeScene ? (
        <p
          role="note"
          style={{
            ...textStyle,
            color: "#111111",
            background: "#fff3cd",
            border: "1px solid #111111",
            borderRadius: "0.4rem",
            padding: "0.75rem",
            margin: "0 0 1rem",
          }}
        >
          Bu vakada Olay Yeri olarak işaretlenmiş konum yok.
        </p>
      ) : null}

      <MapPicker points={points} readOnly height={260} />

      {sorted.length === 0 ? <p style={textStyle}>Ekli konum yok.</p> : null}
      <ul style={{ paddingLeft: "1.25rem" }}>
        {sorted.map((loc) => {
          const color = locationColor(loc);
          return (
            <li
              key={loc.id}
              style={{
                ...textStyle,
                marginBottom: "0.75rem",
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "0.6rem",
                padding: "0.9rem 1rem",
              }}
            >
              <strong>{loc.title} </strong>
              <span
                style={{
                  background: color.badgeBg,
                  color: color.badgeFg,
                  padding: "0.25rem 0.6rem",
                  borderRadius: "0.4rem",
                  fontSize: "1rem",
                  lineHeight: 1.5,
                }}
              >
                {locationLabel(loc)}
              </span>{" "}
              {loc.note ? <span>{loc.note} </span> : null}
              {typeof loc.latitude === "number" &&
              typeof loc.longitude === "number" ? (
                <span>
                  ({loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}){" "}
                </span>
              ) : null}
              {!readOnly ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPicker(loc)}
                    style={buttonStyle}
                  >
                    Düzenle
                  </button>{" "}
                  <button
                    type="button"
                    onClick={() => removeLocation(loc)}
                    style={buttonStyle}
                  >
                    Sil
                  </button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!readOnly ? (
        <button
          type="button"
          onClick={() => setPicker(null)}
          style={buttonStyle}
        >
          + Konum Ekle
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
          <button
            type="button"
            onClick={() => void onSave?.()}
            style={buttonStyle}
          >
            Kaydet
          </button>
          <button type="button" onClick={() => onReset?.()} style={buttonStyle}>
            Vazgeç
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
