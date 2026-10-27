"use client";

import { useEffect, useState } from "react";
import CaseForm, {
  caseToFormValues,
  type CaseFormPayload,
  type CaseFormValues,
} from "../../../components/case-form";
import type { CaseLocationDraft } from "../../../../lib/locations";
import type { CaseLocation, CasePerson } from "../../../api/cases/[id]/route";
import type { CasePersonDraft } from "../../../../lib/persons";

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
  persons?: CasePerson[];
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

function toPersonDraft(p: CasePerson): CasePersonDraft {
  return {
    id: p.id,
    name: p.name ?? "",
    age: p.age == null ? "" : String(p.age),
    gender: p.gender ?? "",
    note: p.note ?? "",
    type: p.type,
    relatedVictimId: p.relatedVictimId ?? "",
    relationship: p.relationship ?? "",
    unidentified: Boolean(p.unidentified),
    contactStatus: p.contactStatus ?? "",
  };
}

function personBody(p: CasePersonDraft) {
  const relatedVictimId =
    p.type === "maktul" ? null : p.relatedVictimId || null;
  return {
    name: p.name.trim() || null,
    age: p.age.trim() ? Number(p.age) : null,
    gender: p.gender || null,
    note: p.note.trim() || null,
    type: p.type,
    relatedVictimId,
    relationship: relatedVictimId ? p.relationship.trim() || null : null,
    unidentified: p.unidentified,
    contactStatus: p.contactStatus || null,
  };
}

function samePerson(a: CasePersonDraft, b: CasePersonDraft): boolean {
  return (
    a.name === b.name &&
    a.age === b.age &&
    a.gender === b.gender &&
    a.note === b.note &&
    a.type === b.type &&
    a.relatedVictimId === b.relatedVictimId &&
    a.relationship === b.relationship &&
    a.unidentified === b.unidentified &&
    a.contactStatus === b.contactStatus
  );
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
  const [originalPersons, setOriginalPersons] = useState<CasePersonDraft[]>(
    [],
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [queuedSaved, setQueuedSaved] = useState(false);
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
          setOriginalPersons(
            (Array.isArray(body.persons) ? body.persons : []).map(
              toPersonDraft,
            ),
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
    persons: CasePersonDraft[],
  ) {
    setError("");
    setSaved(false);
    setQueuedSaved(false);
    setSaving(true);
    let queued = false;
    // Başarılı konum işlemleri ara tabana işlenir; kısmi hatada
    // tekrar denemede tamamlanmış işlemler yinelenmez, taslak korunur.
    let working = [...originalLocations];
    let workingPersons = [...originalPersons];
    const effectiveLocations = locations.map((l) => ({ ...l }));
    const effectivePersons = persons.map((p) => ({ ...p }));
    async function noteQueued(res: Response): Promise<string | null> {
      try {
        const body = (await (typeof res.clone === "function"
          ? res.clone()
          : res
        ).json()) as {
          queued?: boolean;
          id?: unknown;
        } | null;
        if (body?.queued === true) queued = true;
        return typeof body?.id === "string" ? body.id : null;
      } catch {
        return null;
      }
    }
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

      for (let i = 0; i < effectiveLocations.length; i++) {
        const loc = effectiveLocations[i];
        if (!originalById.has(loc.id)) {
          const locRes = await fetch(`/api/cases/${caseId}/locations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...locationBody(loc), id: loc.id }),
          });
          const createdId = await noteQueued(locRes);
          if (!locRes.ok) {
            setOriginalLocations(working);
            setError("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          const savedLoc = createdId ? { ...loc, id: createdId } : { ...loc };
          effectiveLocations[i] = savedLoc;
          working = [...working, { ...savedLoc }];
        }
      }

      for (const loc of effectiveLocations) {
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
          await noteQueued(locRes);
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
          await noteQueued(locRes);
          if (!locRes.ok) {
            setOriginalLocations(working);
            setError("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          working = working.filter((l) => l.id !== original.id);
        }
      }

      const originalPersonById = new Map(
        originalPersons.map((p) => [p.id, p]),
      );
      const currentPersonIds = new Set(persons.map((p) => p.id));

      // Önce maktüller: yeni tanık/şüpheli onlara bağlanabilsin.
      const newPersons = [
        ...effectivePersons.filter(
          (p) => !originalPersonById.has(p.id) && p.type === "maktul",
        ),
        ...effectivePersons.filter(
          (p) => !originalPersonById.has(p.id) && p.type !== "maktul",
        ),
      ];
      for (const person of newPersons) {
        const personRes = await fetch(`/api/cases/${caseId}/persons`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...personBody(person), id: person.id }),
        });
        const createdId = await noteQueued(personRes);
        if (!personRes.ok) {
          setOriginalLocations(working);
          setOriginalPersons(workingPersons);
          setError("Kişiler kaydedilemedi, tekrar deneyin.");
          return;
        }
        const savedPerson = createdId
          ? { ...person, id: createdId }
          : { ...person };
        const idx = effectivePersons.findIndex((p) => p.id === person.id);
        if (idx >= 0) effectivePersons[idx] = savedPerson;
        // İstemci kimliği sunucuda değiştiyse bağlı ilişkileri yeni kimliğe taşı.
        if (savedPerson.id !== person.id) {
          for (let i = 0; i < effectivePersons.length; i++) {
            if (effectivePersons[i].relatedVictimId === person.id) {
              effectivePersons[i] = {
                ...effectivePersons[i],
                relatedVictimId: savedPerson.id,
              };
            }
          }
        }
        workingPersons = [...workingPersons, { ...savedPerson }];
      }

      for (const person of effectivePersons) {
        const original = originalPersonById.get(person.id);
        if (original && !samePerson(original, person)) {
          const personRes = await fetch(
            `/api/cases/${caseId}/persons/${person.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(personBody(person)),
            },
          );
          await noteQueued(personRes);
          if (!personRes.ok) {
            setOriginalLocations(working);
            setOriginalPersons(workingPersons);
            setError("Kişiler kaydedilemedi, tekrar deneyin.");
            return;
          }
          workingPersons = workingPersons.map((p) =>
            p.id === person.id ? { ...person } : p,
          );
        }
      }

      for (const original of originalPersons) {
        if (!currentPersonIds.has(original.id)) {
          const personRes = await fetch(
            `/api/cases/${caseId}/persons/${original.id}`,
            { method: "DELETE" },
          );
          await noteQueued(personRes);
          if (!personRes.ok) {
            setOriginalLocations(working);
            setOriginalPersons(workingPersons);
            setError("Kişiler kaydedilemedi, tekrar deneyin.");
            return;
          }
          workingPersons = workingPersons.filter(
            (p) => p.id !== original.id,
          );
        }
      }

      setOriginalLocations(working);
      setOriginalPersons(workingPersons);
      if (queued) setQueuedSaved(true);
      else setSaved(true);
    } catch {
      setOriginalLocations(working);
      setOriginalPersons(workingPersons);
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
      {queuedSaved ? (
        <p>Kuyruğa alındı, bağlantı gelince gönderilecek.</p>
      ) : saved ? (
        <p>Kaydedildi.</p>
      ) : null}
      <CaseForm
        idPrefix="duzen"
        initial={initial}
        initialLocations={originalLocations}
        initialPersons={originalPersons}
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
