"use client";

import { useEffect, useState } from "react";
import CaseForm, {
  caseToFormValues,
  type CaseFormPayload,
  type CaseFormValues,
} from "../../../components/case-form";
import type { CaseLocationDraft } from "../../../../lib/locations";
import type { CaseLocation } from "../../../api/cases/[id]/route";

interface LoadedCase {
  id: string;
  caseNo: string;
  status?: string | null;
  summary?: string | null;
  occurredAt?: string | null;
  crimeType?: string | null;
  mo?: string | null;
  weapon?: string | null;
  officer?: string | null;
  victimAge?: number | null;
  victimGender?: string | null;
  suspects?: string | null;
  witnesses?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  locations?: CaseLocation[];
  [key: string]: unknown;
}

function statusLabel(status?: string | null): string {
  return status === "closed" ? "Kapalı" : "Açık";
}

function toDraft(l: CaseLocation): CaseLocationDraft {
  return {
    id: l.id,
    title: l.title ?? "Konum",
    note: l.note ?? "",
    kind: l.kind ?? "iliskili",
    priority: l.priority ?? null,
    latitude: l.latitude ?? undefined,
    longitude: l.longitude ?? undefined,
  };
}

function locationBody(l: CaseLocationDraft) {
  return {
    title: l.title,
    note: l.note || null,
    kind: l.kind,
    priority: l.kind === "olay-yeri" ? null : l.priority,
    latitude: l.latitude ?? null,
    longitude: l.longitude ?? null,
  };
}

function sameLocation(a: CaseLocationDraft, b: CaseLocationDraft): boolean {
  return (
    a.title === b.title &&
    a.note === b.note &&
    a.kind === b.kind &&
    (a.priority ?? null) === (b.priority ?? null) &&
    (a.latitude ?? null) === (b.latitude ?? null) &&
    (a.longitude ?? null) === (b.longitude ?? null)
  );
}

export default function EditForm({ caseId }: { caseId: string }) {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState<LoadedCase | null>(null);
  const [initial, setInitial] = useState<CaseFormValues | null>(null);
  const [originalLocations, setOriginalLocations] = useState<
    CaseLocationDraft[]
  >([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/cases/${caseId}`);
        if (!res.ok) {
          if (!cancelled) setMissing(true);
          return;
        }
        const body = (await res.json()) as LoadedCase;
        if (!cancelled) {
          setLoaded(body);
          setInitial(caseToFormValues(body));
          setOriginalLocations(
            (Array.isArray(body.locations) ? body.locations : []).map(toDraft),
          );
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

  async function onSubmit(
    payload: CaseFormPayload,
    locations: CaseLocationDraft[],
  ) {
    setError("");
    setSaved(false);
    setSaving(true);
    // Başarılı konum işlemleri ara tabana işlenir; kısmi hatada
    // tekrar denemede tamamlanmış işlemler yinelenmez, taslak korunur.
    let working = [...originalLocations];
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError("Kaydedilemedi, tekrar deneyin.");
        return;
      }

      const originalById = new Map(originalLocations.map((l) => [l.id, l]));
      const currentIds = new Set(locations.map((l) => l.id));

      for (const loc of locations) {
        if (!originalById.has(loc.id)) {
          const locRes = await fetch(`/api/cases/${caseId}/locations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(locationBody(loc)),
          });
          if (!locRes.ok) {
            setOriginalLocations(working);
            setError("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          try {
            const created = (await locRes.json()) as CaseLocation;
            if (created && typeof created.id === "string") loc.id = created.id;
          } catch {
            // Kuyruk yanıtı gibi gövdesiz başarıda taslak kimliği korunur.
          }
          working = [...working, { ...loc }];
        }
      }

      for (const loc of locations) {
        const original = originalById.get(loc.id);
        if (original && !sameLocation(original, loc)) {
          const locRes = await fetch(
            `/api/cases/${caseId}/locations/${loc.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(locationBody(loc)),
            },
          );
          if (!locRes.ok) {
            setOriginalLocations(working);
            setError("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          working = working.map((l) => (l.id === loc.id ? { ...loc } : l));
        }
      }

      for (const original of originalLocations) {
        if (!currentIds.has(original.id)) {
          const locRes = await fetch(
            `/api/cases/${caseId}/locations/${original.id}`,
            { method: "DELETE" },
          );
          if (!locRes.ok) {
            setOriginalLocations(working);
            setError("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          working = working.filter((l) => l.id !== original.id);
        }
      }

      setOriginalLocations(working);
      setSaved(true);
    } catch {
      setOriginalLocations(working);
      setError("Bağlantı hatası, tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main>
        <p>Yükleniyor…</p>
      </main>
    );
  }
  if (missing || !loaded || !initial) {
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
      <CaseForm
        idPrefix="duzen"
        initial={initial}
        initialLocations={originalLocations}
        submitLabel="Kaydet"
        saving={saving}
        error={error}
        onSubmit={onSubmit}
        header={
          <fieldset>
            <legend>Sistem bilgileri (değiştirilemez)</legend>
            <p>
              <strong>Vaka No: </strong>
              {loaded.caseNo}
            </p>
            <p>
              <strong>Durum: </strong>
              {statusLabel(loaded.status)} — kapatıp açmak için vaka detay
              sayfasındaki düğmeyi kullanın.
            </p>
            {loaded.createdAt ? (
              <p>
                <strong>Kayıt tarihi: </strong>
                {String(loaded.createdAt)}
              </p>
            ) : null}
            {loaded.updatedAt ? (
              <p>
                <strong>Son güncelleme: </strong>
                {String(loaded.updatedAt)}
              </p>
            ) : null}
          </fieldset>
        }
      />
      <p>
        <a href={`/cases/${caseId}`}>Vazgeç</a>
      </p>
    </main>
  );
}
