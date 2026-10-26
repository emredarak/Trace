"use client";

import { useEffect, useState } from "react";
import MapPicker, { type MapPoint } from "../../../components/map-picker";
import type { CaseLocation } from "../../../api/cases/[id]/route";

const field: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "1rem",
  padding: "0.75rem",
  margin: "0.25rem 0 1rem",
};

interface LoadedCase {
  id: string;
  caseNo: string;
  summary: string;
  crimeType?: string | null;
  locationType?: string | null;
  locationText?: string | null;
  occurredAt?: string | null;
  officer?: string | null;
  victimAge?: number | null;
  victimGender?: string | null;
  suspects?: string | null;
  witnesses?: string | null;
  mo?: string | null;
  weapon?: string | null;
}

const TEXT_FIELDS: Array<{ key: keyof LoadedCase; label: string }> = [
  { key: "summary", label: "Özet *" },
  { key: "crimeType", label: "Suç tipi" },
  { key: "locationType", label: "Konum tipi" },
  { key: "locationText", label: "Konum (metin)" },
  { key: "occurredAt", label: "Olay tarihi" },
  { key: "officer", label: "Memur" },
  { key: "victimGender", label: "Maktul cinsiyeti" },
  { key: "suspects", label: "Şüpheliler" },
  { key: "witnesses", label: "Tanıklar" },
  { key: "mo", label: "Yöntem (MO)" },
  { key: "weapon", label: "Silah" },
];

export default function EditForm({ caseId }: { caseId: string }) {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locations, setLocations] = useState<CaseLocation[]>([]);
  const [locNote, setLocNote] = useState("");
  const [locText, setLocText] = useState("");
  const [picked, setPicked] = useState<MapPoint | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/cases/${caseId}`);
        if (!res.ok) {
          if (!cancelled) setMissing(true);
          return;
        }
        const body = (await res.json()) as LoadedCase & {
          locations?: CaseLocation[];
        };
        if (!cancelled) {
          const next: Record<string, string> = {};
          for (const f of TEXT_FIELDS) {
            const v = body[f.key];
            next[f.key] = v === null || v === undefined ? "" : String(v);
          }
          next.victimAge =
            body.victimAge === null || body.victimAge === undefined
              ? ""
              : String(body.victimAge);
          setValues(next);
          setLocations(Array.isArray(body.locations) ? body.locations : []);
        }
      } catch {
        if (!cancelled) setMissing(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (values.summary.trim().length === 0) {
      setError("Özet zorunludur.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of TEXT_FIELDS) {
        const v = (values[f.key] ?? "").trim();
        if (v) payload[f.key] = v;
      }
      if (values.victimAge.trim()) {
        const n = Number(values.victimAge);
        if (Number.isFinite(n)) payload.victimAge = n;
      }
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError("Kaydedilemedi, tekrar deneyin.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Bağlantı hatası, tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  }

  async function addLocation() {
    setError("");
    try {
      const res = await fetch(`/api/cases/${caseId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: locNote.trim() || undefined,
          locationText: locText.trim() || undefined,
          latitude: picked?.latitude,
          longitude: picked?.longitude,
        }),
      });
      if (!res.ok) {
        setError("Konum eklenemedi (metin ya da harita seçimi gerekli).");
        return;
      }
      const created = (await res.json()) as CaseLocation;
      setLocations((cur) => [...cur, created]);
      setLocNote("");
      setLocText("");
      setPicked(null);
    } catch {
      setError("Bağlantı hatası, tekrar deneyin.");
    }
  }

  async function removeLocation(locId: string) {
    try {
      const res = await fetch(`/api/cases/${caseId}/locations/${locId}`, {
        method: "DELETE",
      });
      if (res.ok) setLocations((cur) => cur.filter((l) => l.id !== locId));
    } catch {
      setError("Konum silinemedi.");
    }
  }

  if (loading) {
    return (
      <main>
        <p>Yükleniyor…</p>
      </main>
    );
  }
  if (missing) {
    return (
      <main>
        <p>Vaka bulunamadı.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Vakayı Düzenle</h1>
      {saved ? <p>Kaydedildi.</p> : null}
      <form onSubmit={onSave}>
        {TEXT_FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`duzen-${f.key}`}>{f.label}</label>
            {f.key === "summary" ? (
              <textarea
                id={`duzen-${f.key}`}
                rows={3}
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
                style={field}
              />
            ) : (
              <input
                id={`duzen-${f.key}`}
                type="text"
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
                style={field}
              />
            )}
          </div>
        ))}
        <label htmlFor="duzen-victimAge">Maktul yaşı</label>
        <input
          id="duzen-victimAge"
          type="number"
          value={values.victimAge ?? ""}
          onChange={(e) =>
            setValues((v) => ({ ...v, victimAge: e.target.value }))
          }
          style={field}
        />
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={saving}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </form>

      <h2>Konumlar ({locations.length})</h2>
      {locations.length === 0 ? <p>Konum yok.</p> : null}
      <ul>
        {locations.map((l) => (
          <li key={l.id}>
            {l.note ? <strong>{l.note} </strong> : null}
            {l.locationText ? <span>{l.locationText} </span> : null}
            {typeof l.latitude === "number" &&
            typeof l.longitude === "number" ? (
              <span>
                ({l.latitude.toFixed(4)}, {l.longitude.toFixed(4)})
              </span>
            ) : null}
            <button type="button" onClick={() => void removeLocation(l.id)}>
              Sil
            </button>
          </li>
        ))}
      </ul>

      <h3>Konum ekle</h3>
      <label htmlFor="konum-not">Bu konum ne için? (not)</label>
      <input
        id="konum-not"
        type="text"
        value={locNote}
        onChange={(e) => setLocNote(e.target.value)}
        placeholder="örn. maktulün bulunduğu nokta"
        style={field}
      />
      <label htmlFor="konum-metin">Konum (metin)</label>
      <input
        id="konum-metin"
        type="text"
        value={locText}
        onChange={(e) => setLocText(e.target.value)}
        style={field}
      />
      <p>Haritadan seç (dokun/tıkla):</p>
      <MapPicker pick={picked} onPick={setPicked} />
      {picked ? (
        <p>
          Seçili: ({picked.latitude.toFixed(4)}, {picked.longitude.toFixed(4)})
        </p>
      ) : null}
      <button type="button" onClick={() => void addLocation()}>
        Konumu Ekle
      </button>
    </main>
  );
}
