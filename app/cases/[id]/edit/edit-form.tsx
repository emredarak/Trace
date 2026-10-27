"use client";

import { useEffect, useState } from "react";
import CaseForm, {
  caseToFormValues,
  type CaseFormPayload,
  type CaseFormValues,
  type CaseLocationDraft,
} from "../../../components/case-form";
import type { CaseLocation } from "../../../api/cases/[id]/route";

interface LoadedCase {
  id: string;
  caseNo: string;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locations?: CaseLocation[];
  [key: string]: unknown;
}

function statusLabel(status?: string | null): string {
  return status === "closed" ? "Kapalı" : "Açık";
}

export default function EditForm({ caseId }: { caseId: string }) {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState<LoadedCase | null>(null);
  const [initial, setInitial] = useState<CaseFormValues | null>(null);
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

  async function onSubmit(payload: CaseFormPayload) {
    setError("");
    setSaving(true);
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
      setSaved(true);
    } catch {
      setError("Bağlantı hatası, tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  }

  async function addLocation(loc: CaseLocationDraft): Promise<boolean> {
    try {
      const res = await fetch(`/api/cases/${caseId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: loc.note || null,
          locationText: loc.locationText || null,
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
        }),
      });
      if (!res.ok) {
        setError("Konum eklenemedi (metin ya da harita seçimi gerekli).");
        return false;
      }
      const created = (await res.json()) as CaseLocation;
      loc.id = created.id;
      return true;
    } catch {
      setError("Bağlantı hatası, tekrar deneyin.");
      return false;
    }
  }

  async function removeLocation(loc: CaseLocationDraft) {
    try {
      await fetch(`/api/cases/${caseId}/locations/${loc.id}`, {
        method: "DELETE",
      });
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
  if (missing || !loaded || !initial) {
    return (
      <main>
        <p>Vaka bulunamadı.</p>
      </main>
    );
  }

  const initialLocations: CaseLocationDraft[] = (
    Array.isArray(loaded.locations) ? loaded.locations : []
  ).map((l) => ({
    id: l.id,
    note: l.note ?? "",
    locationText: l.locationText ?? "",
    latitude: l.latitude ?? undefined,
    longitude: l.longitude ?? undefined,
  }));

  return (
    <main>
      <h1>Vakayı Düzenle</h1>
      {saved ? <p>Kaydedildi.</p> : null}
      <CaseForm
        idPrefix="duzen"
        initial={initial}
        initialPrimary={
          typeof loaded.latitude === "number" &&
          typeof loaded.longitude === "number"
            ? { latitude: loaded.latitude, longitude: loaded.longitude }
            : null
        }
        initialLocations={initialLocations}
        submitLabel="Kaydet"
        saving={saving}
        error={error}
        onSubmit={onSubmit}
        onAddLocation={addLocation}
        onRemoveLocation={removeLocation}
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
    </main>
  );
}
