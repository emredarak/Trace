"use client";

import { useEffect, useState, type ReactNode } from "react";
import MapPicker, { type MapPoint } from "./map-picker";

// Vaka açma ve vaka düzenleme ekranlarının TEK alan tanımı.
// Yeni alan eklenirse buraya eklenir; iki ekran da otomatik alır.
export const CRIME_SUGGESTIONS = [
  "hırsızlık",
  "gasp",
  "cinayet",
  "yaralama",
  "dolandırıcılık",
  "kundaklama",
  "trafik kazası",
  "kayıp şahıs",
];

export const LOCATION_TYPE_SUGGESTIONS = [
  "su kenarı",
  "orman",
  "ev içi",
  "ev",
  "iş yeri",
  "sokak",
  "araç",
  "kırsal",
  "diğer",
];

export const WEAPON_SUGGESTIONS = [
  "bıçak",
  "ateşli silah",
  "levye",
  "sopa",
  "taş",
  "tornavida",
  "yok",
  "diğer",
];

export const VICTIM_GENDERS = ["kadın", "erkek", "bilinmiyor"] as const;

export interface CaseFormValues {
  summary: string;
  occurredAt: string;
  crimeType: string;
  mo: string;
  weapon: string;
  locationType: string;
  locationText: string;
  officer: string;
  victimAge: string;
  victimGender: string;
  suspects: string;
  witnesses: string;
}

export interface CaseLocationDraft {
  id: string;
  note: string;
  locationText: string;
  latitude?: number;
  longitude?: number;
}

export type CaseFormPayload = {
  summary: string;
  occurredAt: string | null;
  crimeType: string | null;
  mo: string | null;
  weapon: string | null;
  locationType: string | null;
  locationText: string | null;
  officer: string | null;
  victimAge: number | null;
  victimGender: string | null;
  suspects: string | null;
  witnesses: string | null;
  latitude: number | null;
  longitude: number | null;
};

export function emptyCaseForm(): CaseFormValues {
  return {
    summary: "",
    occurredAt: "",
    crimeType: "",
    mo: "",
    weapon: "",
    locationType: "",
    locationText: "",
    officer: "",
    victimAge: "",
    victimGender: "",
    suspects: "",
    witnesses: "",
  };
}

interface CaseLike {
  summary?: string | null;
  occurredAt?: string | null;
  crimeType?: string | null;
  mo?: string | null;
  weapon?: string | null;
  locationType?: string | null;
  locationText?: string | null;
  officer?: string | null;
  victimAge?: number | null;
  victimGender?: string | null;
  suspects?: string | null;
  witnesses?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export function caseToFormValues(c: CaseLike): CaseFormValues {
  const str = (v: string | null | undefined) => (v == null ? "" : String(v));
  return {
    summary: str(c.summary),
    occurredAt: c.occurredAt ? String(c.occurredAt).slice(0, 16) : "",
    crimeType: str(c.crimeType),
    mo: str(c.mo),
    weapon: str(c.weapon),
    locationType: str(c.locationType),
    locationText: str(c.locationText),
    officer: str(c.officer),
    victimAge: c.victimAge == null ? "" : String(c.victimAge),
    victimGender: str(c.victimGender),
    suspects: str(c.suspects),
    witnesses: str(c.witnesses),
  };
}

const fieldStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "1rem",
  padding: "0.75rem",
  margin: "0.25rem 0 1rem",
};

const hintStyle: React.CSSProperties = {
  fontSize: "0.85rem",
  opacity: 0.75,
  margin: "-0.6rem 0 1rem",
};

interface CaseFormProps {
  idPrefix: string;
  initial: CaseFormValues;
  initialPrimary?: MapPoint | null;
  initialLocations?: CaseLocationDraft[];
  autoGps?: boolean;
  header?: ReactNode;
  submitLabel: string;
  saving?: boolean;
  error?: string;
  onAddLocation?: (loc: CaseLocationDraft) => Promise<boolean>;
  onRemoveLocation?: (loc: CaseLocationDraft) => Promise<void>;
  onSubmit: (
    payload: CaseFormPayload,
    locations: CaseLocationDraft[],
  ) => Promise<void>;
}

export default function CaseForm({
  idPrefix,
  initial,
  initialPrimary = null,
  initialLocations = [],
  autoGps = false,
  header,
  submitLabel,
  saving = false,
  error = "",
  onAddLocation,
  onRemoveLocation,
  onSubmit,
}: CaseFormProps) {
  const [values, setValues] = useState<CaseFormValues>(initial);
  const [primary, setPrimary] = useState<MapPoint | null>(initialPrimary);
  const [gpsStatus, setGpsStatus] = useState("");
  const [formError, setFormError] = useState("");
  const [locations, setLocations] =
    useState<CaseLocationDraft[]>(initialLocations);
  const [locNote, setLocNote] = useState("");
  const [locText, setLocText] = useState("");
  const [locPick, setLocPick] = useState<MapPoint | null>(null);
  const [locError, setLocError] = useState("");

  useEffect(() => {
    if (!autoGps) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus("GPS yok; konum metni ya da harita seçimi yeterli.");
      return;
    }
    setGpsStatus("Konum bekleniyor.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPrimary((cur) =>
          cur ?? {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          },
        );
        setGpsStatus("Konum alındı (haritada ana konum olarak işaretli).");
      },
      () => setGpsStatus("GPS alınamadı; konum metni ya da harita seçimi yeterli."),
      { timeout: 8000 },
    );
  }, [autoGps]);

  const set = (key: keyof CaseFormValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function addLocation() {
    if (!locText.trim() && !locPick) {
      setLocError("Konum için açıklama yazın ya da haritadan seçin.");
      return;
    }
    const draft: CaseLocationDraft = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `loc-${Date.now()}`,
      note: locNote.trim(),
      locationText: locText.trim(),
      latitude: locPick?.latitude,
      longitude: locPick?.longitude,
    };
    if (onAddLocation) {
      const ok = await onAddLocation(draft);
      if (!ok) return;
    }
    setLocations((cur) => [...cur, draft]);
    setLocNote("");
    setLocText("");
    setLocPick(null);
    setLocError("");
  }

  async function removeLocation(loc: CaseLocationDraft) {
    if (onRemoveLocation) await onRemoveLocation(loc);
    setLocations((cur) => cur.filter((l) => l.id !== loc.id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (values.summary.trim().length === 0) {
      setFormError("Özet zorunludur.");
      return;
    }
    if (values.victimAge.trim()) {
      const age = Number(values.victimAge);
      if (!Number.isInteger(age) || age < 0 || age > 120) {
        setFormError("Maktul yaşı 0-120 arasında tam sayı olmalı.");
        return;
      }
    }
    setFormError("");
    const text = (v: string) => {
      const t = v.trim();
      return t.length > 0 ? t : null;
    };
    await onSubmit(
      {
        summary: values.summary.trim(),
        occurredAt: text(values.occurredAt),
        crimeType: text(values.crimeType),
        mo: text(values.mo),
        weapon: text(values.weapon),
        locationType: text(values.locationType),
        locationText: text(values.locationText),
        officer: text(values.officer),
        victimAge: values.victimAge.trim()
          ? Number(values.victimAge)
          : null,
        victimGender: text(values.victimGender),
        suspects: text(values.suspects),
        witnesses: text(values.witnesses),
        latitude: primary?.latitude ?? null,
        longitude: primary?.longitude ?? null,
      },
      locations,
    );
  }

  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <>
      {header}
      <form onSubmit={handleSubmit}>
        <fieldset>
          <legend>Olay bilgileri</legend>
          <label htmlFor={id("ozet")}>Özet *</label>
          <textarea
            id={id("ozet")}
            aria-label="Özet"
            rows={3}
            value={values.summary}
            onChange={set("summary")}
            style={fieldStyle}
            placeholder="Olayı kısaca anlatın; benzer vaka araması bu metni kullanır."
          />
          <label htmlFor={id("occurredAt")}>Olay tarihi ve saati</label>
          <input
            id={id("occurredAt")}
            type="datetime-local"
            value={values.occurredAt}
            onChange={set("occurredAt")}
            style={fieldStyle}
          />
          <label htmlFor={id("crimeType")}>Suç tipi</label>
          <input
            id={id("crimeType")}
            type="text"
            list={id("crime-list")}
            value={values.crimeType}
            onChange={set("crimeType")}
            style={fieldStyle}
            placeholder="Seçin ya da kendiniz yazın"
          />
          <datalist id={id("crime-list")}>
            {CRIME_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <label htmlFor={id("mo")}>Yöntem / işleniş biçimi (MO)</label>
          <textarea
            id={id("mo")}
            rows={2}
            value={values.mo}
            onChange={set("mo")}
            style={fieldStyle}
            placeholder="Örn. gece arkadan yaklaşma"
          />
          <p style={hintStyle}>Aynı yöntemi kullanan eski vakaları bulmaya yarar.</p>
          <label htmlFor={id("weapon")}>Silah / alet</label>
          <input
            id={id("weapon")}
            type="text"
            list={id("weapon-list")}
            value={values.weapon}
            onChange={set("weapon")}
            style={fieldStyle}
            placeholder="Seçin ya da kendiniz yazın; yoksa boş bırakın"
          />
          <datalist id={id("weapon-list")}>
            {WEAPON_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </fieldset>

        <fieldset>
          <legend>Konum (ana olay yeri)</legend>
          <label htmlFor={id("locationType")}>Konum tipi</label>
          <input
            id={id("locationType")}
            type="text"
            list={id("location-type-list")}
            value={values.locationType}
            onChange={set("locationType")}
            style={fieldStyle}
            placeholder="Seçin ya da kendiniz yazın"
          />
          <datalist id={id("location-type-list")}>
            {LOCATION_TYPE_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <label htmlFor={id("locationText")}>Konum (metin)</label>
          <input
            id={id("locationText")}
            type="text"
            value={values.locationText}
            onChange={set("locationText")}
            style={fieldStyle}
            placeholder="Örn. kuzey gölü kıyısı, 3 No'lu iskele"
          />
          <p style={hintStyle}>
            Ana konumu haritadan da seçebilirsiniz (dokun/tıkla). GPS yalnızca
            yeni vakada otomatik denenir.
          </p>
          <MapPicker pick={primary} onPick={setPrimary} height={220} />
          {gpsStatus ? <p aria-live="polite">{gpsStatus}</p> : null}
          {primary ? (
            <p>
              Ana konum: ({primary.latitude.toFixed(4)},{" "}
              {primary.longitude.toFixed(4)}){" "}
              <button type="button" onClick={() => setPrimary(null)}>
                Temizle
              </button>
            </p>
          ) : null}
        </fieldset>

        <fieldset>
          <legend>Kişiler</legend>
          <label htmlFor={id("officer")}>Sorumlu memur</label>
          <input
            id={id("officer")}
            type="text"
            value={values.officer}
            onChange={set("officer")}
            style={fieldStyle}
          />
          <label htmlFor={id("victimAge")}>Maktul yaşı</label>
          <input
            id={id("victimAge")}
            type="number"
            min={0}
            max={120}
            value={values.victimAge}
            onChange={set("victimAge")}
            style={fieldStyle}
          />
          <label htmlFor={id("victimGender")}>Maktul cinsiyeti</label>
          <select
            id={id("victimGender")}
            value={values.victimGender}
            onChange={set("victimGender")}
            style={fieldStyle}
          >
            <option value="">Seçin</option>
            {VICTIM_GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <label htmlFor={id("suspects")}>Şüpheliler</label>
          <textarea
            id={id("suspects")}
            rows={2}
            value={values.suspects}
            onChange={set("suspects")}
            style={fieldStyle}
            placeholder="Her satıra bir kişi; kimliği yoksa tarif yazın"
          />
          <label htmlFor={id("witnesses")}>Tanıklar</label>
          <textarea
            id={id("witnesses")}
            rows={2}
            value={values.witnesses}
            onChange={set("witnesses")}
            style={fieldStyle}
            placeholder="Her satıra bir kişi"
          />
        </fieldset>

        <fieldset>
          <legend>Konumlar (birden fazla olabilir)</legend>
          <p style={hintStyle}>
            Her konumun ne için olduğunu notla belirtin: maktulün bulunduğu
            nokta, delilin bulunduğu yer, tanığın gördüğü köşe gibi.
          </p>
          {locations.length === 0 ? <p>Ekli konum yok.</p> : null}
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
                ) : null}{" "}
                <button type="button" onClick={() => void removeLocation(l)}>
                  Sil
                </button>
              </li>
            ))}
          </ul>
          <label htmlFor={id("locNote")}>Konum notu (bu konum ne için?)</label>
          <input
            id={id("locNote")}
            type="text"
            value={locNote}
            onChange={(e) => setLocNote(e.target.value)}
            style={fieldStyle}
            placeholder="Örn. maktulün bulunduğu nokta"
          />
          <label htmlFor={id("locText")}>Konum açıklaması</label>
          <input
            id={id("locText")}
            type="text"
            value={locText}
            onChange={(e) => setLocText(e.target.value)}
            style={fieldStyle}
          />
          <MapPicker pick={locPick} onPick={setLocPick} height={220} />
          {locPick ? (
            <p>
              Seçili: ({locPick.latitude.toFixed(4)},{" "}
              {locPick.longitude.toFixed(4)})
            </p>
          ) : null}
          {locError ? <p role="alert">{locError}</p> : null}
          <button type="button" onClick={() => void addLocation()}>
            Konumu Ekle
          </button>
        </fieldset>

        {formError ? <p role="alert">{formError}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={saving}>
          {saving ? "Kaydediliyor…" : submitLabel}
        </button>
      </form>
    </>
  );
}
