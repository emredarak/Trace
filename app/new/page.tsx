"use client";

import { useEffect, useState } from "react";

const CRIME_SUGGESTIONS = [
  "hırsızlık",
  "gasp",
  "cinayet",
  "yaralama",
  "dolandırıcılık",
  "kundaklama",
  "trafik kazası",
  "kayıp şahıs",
];

const LOCATION_TYPES = ["ev", "iş yeri", "sokak", "araç", "kırsal", "diğer"];

const wrap: React.CSSProperties = {
  maxWidth: "28rem",
  margin: "0 auto",
  padding: "1rem",
  fontSize: "1rem",
  lineHeight: 1.5,
};

const field: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "1rem",
  padding: "0.75rem",
  margin: "0.25rem 0 1rem",
};

const button: React.CSSProperties = {
  display: "block",
  width: "100%",
  fontSize: "1.1rem",
  padding: "0.9rem",
  cursor: "pointer",
};

export default function NewCasePage() {
  const [summary, setSummary] = useState("");
  const [crimeType, setCrimeType] = useState("");
  const [locationType, setLocationType] = useState("");
  const [locationText, setLocationText] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [gpsStatus, setGpsStatus] = useState("Konum bekleniyor.");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ id: string; caseNo: string } | null>(
    null,
  );
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus("GPS yok; konum metni yeterli.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsStatus("Konum alındı.");
      },
      () => setGpsStatus("GPS alınamadı; konum metni yeterli."),
      { timeout: 8000 },
    );
  }, []);

  // Servis çalışanı çevrimdışı kaydı kuyruğa alırsa 202 {queued:true} döner.
  // Gerçek fetch'te 202'nin ok'u true'dur; bu yüzden kuyruk bayrağı res.ok
  // dallanmasından ÖNCE, ayrıştırılmış gövdeden okunur.
  interface CreatedBody {
    queued?: boolean;
    id?: unknown;
    caseNo?: unknown;
  }

  async function readBody(res: Response): Promise<CreatedBody | null> {
    try {
      return (await res.json()) as CreatedBody;
    } catch {
      return null;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (summary.trim().length === 0) {
      setError("Özet zorunludur.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: summary.trim(),
          ...(crimeType.trim() ? { crimeType: crimeType.trim() } : {}),
          ...(locationType ? { locationType } : {}),
          ...(locationText.trim() ? { locationText: locationText.trim() } : {}),
          ...(coords
            ? { latitude: coords.lat, longitude: coords.lng }
            : {}),
        }),
      });
      const body = await readBody(res);
      if (body?.queued === true) {
        setQueued(true);
        return;
      }
      if (!res.ok) {
        setError("Kayıt açılamadı, tekrar deneyin.");
        return;
      }
      if (
        body &&
        typeof body.id === "string" &&
        typeof body.caseNo === "string"
      ) {
        setCreated({ id: body.id, caseNo: body.caseNo });
      } else {
        setError("Kayıt açılamadı, tekrar deneyin.");
      }
    } catch {
      setError("Bağlantı hatası, tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  }

  if (queued) {
    return (
      <main style={wrap}>
        <h1>Vaka kuyruğa alındı</h1>
        <p>Bağlantı gelince açılacak.</p>
      </main>
    );
  }

  if (created) {
    return (
      <main style={wrap}>
        <h1>Vaka açıldı: {created.caseNo}</h1>
        <a href={`/cases/${created.id}/add`}>Delil ekle</a>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1>Yeni Vaka</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="ozet">Özet *</label>
        <textarea
          id="ozet"
          aria-label="Özet"
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          style={field}
        />

        <label htmlFor="suc-tipi">Suç tipi</label>
        <input
          id="suc-tipi"
          type="text"
          list="suc-tipleri"
          value={crimeType}
          onChange={(e) => setCrimeType(e.target.value)}
          style={field}
        />
        <datalist id="suc-tipleri">
          {CRIME_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <label htmlFor="konum-tipi">Konum tipi</label>
        <select
          id="konum-tipi"
          value={locationType}
          onChange={(e) => setLocationType(e.target.value)}
          style={field}
        >
          <option value="">Seçin</option>
          {LOCATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label htmlFor="konum-metin">Konum (metin)</label>
        <input
          id="konum-metin"
          type="text"
          value={locationText}
          onChange={(e) => setLocationText(e.target.value)}
          placeholder="GPS yoksa buraya yazın"
          style={field}
        />
        <p aria-live="polite">{gpsStatus}</p>

        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={saving} style={button}>
          {saving ? "Açılıyor…" : "Vakayı Aç"}
        </button>
      </form>
    </main>
  );
}
