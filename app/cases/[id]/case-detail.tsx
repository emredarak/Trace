"use client";

import { useEffect, useRef, useState } from "react";
import type { CaseRecord, Evidence } from "../../../lib/case-schema";
import type { ScoredCase } from "../../../lib/similarity";
import type { CaseLocation, CasePerson } from "../../api/cases/[id]/route";
import { LocationsSection } from "../../components/locations-section";
import { PeopleSection } from "../../components/people-section";
import { EvidenceSection } from "../../components/evidence-section";
import type { CaseLocationDraft } from "../../../lib/locations";
import type { CasePersonDraft } from "../../../lib/persons";
import {
  toEvidenceResponse,
  type CaseEvidenceDraft,
} from "../../../lib/evidences";

type CaseWithEntries = CaseRecord & {
  entries?: Evidence[];
  locations?: CaseLocation[];
  persons?: CasePerson[];
};

interface SimilarResponse {
  results: ScoredCase[];
  fresh: boolean;
  limit?: number;
  pendingEnrichment?: boolean;
}

const layoutCss = [
  ".trace-case-layout{display:flex;flex-direction:column;gap:1rem}",
  "@media(min-width:48rem){.trace-case-layout{flex-direction:row;align-items:flex-start}",
  ".trace-case-layout>section{flex:1;min-width:0}}",
].join("");

const mainStyle: React.CSSProperties = {
  maxWidth: "56rem",
  margin: "0 auto",
  padding: "1rem",
  fontSize: "1rem",
  lineHeight: 1.5,
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #ccc",
  borderRadius: "0.5rem",
  padding: "1rem",
  marginBottom: "1rem",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  background: "#fff3bf",
  border: "1px solid #e6a800",
  borderRadius: "999px",
  padding: "0.25rem 0.75rem",
  fontSize: "0.9rem",
  marginBottom: "1rem",
};

const approveButtonStyle: React.CSSProperties = {
  fontSize: "1rem",
  padding: "0.6rem 1rem",
  cursor: "pointer",
};

function toEvidenceDraft(e: Evidence): CaseEvidenceDraft {
  const view = toEvidenceResponse(e as unknown as Record<string, unknown>);
  return {
    id: view.id,
    title: view.title,
    note: view.note ?? "",
    type: view.type,
    imageFile: view.imageFile,
    audioFile: view.audioFile,
    image: null,
    audio: null,
    removeImage: false,
    removeAudio: false,
  };
}

function evidenceForm(e: CaseEvidenceDraft, includeId: boolean): FormData {
  const form = new FormData();
  if (includeId) form.append("id", e.id);
  form.append("title", e.title);
  form.append("note", e.note);
  if (e.image) form.append("image", e.image);
  if (e.audio) form.append("audio", e.audio);
  if (e.removeImage) form.append("removeImage", "1");
  if (e.removeAudio) form.append("removeAudio", "1");
  return form;
}

function sameEvidence(a: CaseEvidenceDraft, b: CaseEvidenceDraft): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.note === b.note &&
    (a.type ?? "evidence") === (b.type ?? "evidence") &&
    (a.imageFile ?? null) === (b.imageFile ?? null) &&
    (a.audioFile ?? null) === (b.audioFile ?? null) &&
    (a.image ?? null) === (b.image ?? null) &&
    (a.audio ?? null) === (b.audio ?? null) &&
    Boolean(a.removeImage) === Boolean(b.removeImage) &&
    Boolean(a.removeAudio) === Boolean(b.removeAudio)
  );
}

function sameEvidences(
  a: CaseEvidenceDraft[],
  b: CaseEvidenceDraft[],
): boolean {
  return a.length === b.length && a.every((e, i) => sameEvidence(e, b[i]));
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
    a.id === b.id &&
    a.title === b.title &&
    a.note === b.note &&
    a.kind === b.kind &&
    (a.priority ?? null) === (b.priority ?? null) &&
    (a.latitude ?? null) === (b.latitude ?? null) &&
    (a.longitude ?? null) === (b.longitude ?? null)
  );
}

function sameLocations(
  a: CaseLocationDraft[],
  b: CaseLocationDraft[],
): boolean {
  return a.length === b.length && a.every((l, i) => sameLocation(l, b[i]));
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
    audioFile: p.audioFile ?? null,
    audio: null,
    removeAudio: false,
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
    a.id === b.id &&
    a.name === b.name &&
    a.age === b.age &&
    a.gender === b.gender &&
    a.note === b.note &&
    a.type === b.type &&
    a.relatedVictimId === b.relatedVictimId &&
    a.relationship === b.relationship &&
    a.unidentified === b.unidentified &&
    a.contactStatus === b.contactStatus &&
    (a.audioFile ?? null) === (b.audioFile ?? null) &&
    (a.audio ?? null) === (b.audio ?? null) &&
    Boolean(a.removeAudio) === Boolean(b.removeAudio)
  );
}

function samePersons(
  a: CasePersonDraft[],
  b: CasePersonDraft[],
): boolean {
  return a.length === b.length && a.every((p, i) => samePerson(p, b[i]));
}

function fieldRow(label: string, value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (text.length === 0) return null;
  return (
    <p style={{ whiteSpace: "pre-line" }}>
      <strong>{label}: </strong>
      {text}
    </p>
  );
}

export function CaseDetail({ caseId: id }: { caseId: string }) {
  const [caseItem, setCaseItem] = useState<CaseWithEntries | null>(null);
  const [caseMissing, setCaseMissing] = useState(false);
  const [similar, setSimilar] = useState<SimilarResponse | null>(null);
  const [similarError, setSimilarError] = useState("");
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [approveError, setApproveError] = useState<Record<string, string>>({});
  const [approving, setApproving] = useState<Record<string, boolean>>({});
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [baselineLocations, setBaselineLocations] = useState<
    CaseLocationDraft[]
  >([]);
  const [draftLocations, setDraftLocations] = useState<CaseLocationDraft[]>(
    [],
  );
  const [locationStatus, setLocationStatus] = useState("");
  const [savingLocations, setSavingLocations] = useState(false);
  const savingLocationsRef = useRef(false);
  const [baselinePersons, setBaselinePersons] = useState<CasePersonDraft[]>(
    [],
  );
  const [draftPersons, setDraftPersons] = useState<CasePersonDraft[]>([]);
  const [personStatus, setPersonStatus] = useState("");
  const [savingPersons, setSavingPersons] = useState(false);
  const savingPersonsRef = useRef(false);
  const [baselineEvidences, setBaselineEvidences] = useState<
    CaseEvidenceDraft[]
  >([]);
  const [draftEvidences, setDraftEvidences] = useState<CaseEvidenceDraft[]>([]);
  const [evidenceStatus, setEvidenceStatus] = useState("");
  const [savingEvidences, setSavingEvidences] = useState(false);
  const savingEvidencesRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/cases/${id}`);
        if (!res.ok) {
          if (!cancelled) setCaseMissing(true);
          return;
        }
        const found = (await res.json()) as CaseWithEntries;
        if (!cancelled) {
          if (found && found.id === id) {
            setCaseItem(found);
            const drafts = (
              Array.isArray(found.locations) ? found.locations : []
            ).map(toDraft);
            setBaselineLocations(drafts);
            setDraftLocations(drafts.map((l) => ({ ...l })));
            const personDrafts = (
              Array.isArray(found.persons) ? found.persons : []
            ).map(toPersonDraft);
            setBaselinePersons(personDrafts);
            setDraftPersons(personDrafts.map((p) => ({ ...p })));
            const evidenceDrafts = (
              Array.isArray(found.entries) ? found.entries : []
            ).map(toEvidenceDraft);
            setBaselineEvidences(evidenceDrafts);
            setDraftEvidences(evidenceDrafts.map((e) => ({ ...e })));
          } else setCaseMissing(true);
        }
      } catch {
        if (!cancelled) setCaseMissing(true);
      }
      try {
        const res = await fetch(`/api/cases/${id}/similar`);
        if (!res.ok) {
          if (!cancelled) setSimilarError("Benzer vakalar alınamadı.");
          return;
        }
        const body = (await res.json()) as SimilarResponse;
        if (!cancelled) {
          const all = Array.isArray(body.results) ? body.results : [];
          setSimilar({
            results:
              typeof body.limit === "number" && body.limit > 0
                ? all.slice(0, body.limit)
                : all,
            fresh: body.fresh !== false,
            limit: body.limit,
            pendingEnrichment: body.pendingEnrichment === true,
          });
        }
      } catch {
        if (!cancelled) setSimilarError("Bağlantı hatası, tekrar deneyin.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function saveLocations() {
    // Yeniden giriş koruması: çift tık yinelenen POST yaratmaz.
    if (savingLocationsRef.current) return;
    savingLocationsRef.current = true;
    setSavingLocations(true);
    setLocationStatus("");
    // Başarılı işlemler ara tabana işlenir; kısmi hatada taslak korunur.
    let working = [...baselineLocations];
    // Kimliği sunucudan dönen kopyalarla ilerleyen etkin taslak;
    // state nesneleri doğrudan değiştirilmez.
    let effectiveDraft = draftLocations.map((l) => ({ ...l }));
    let queued = false;
    async function readQueued(res: Response): Promise<string | null> {
      try {
        const body = (await res.json()) as {
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
      const baselineById = new Map(baselineLocations.map((l) => [l.id, l]));
      const currentIds = new Set(draftLocations.map((l) => l.id));

      for (let i = 0; i < effectiveDraft.length; i++) {
        const loc = effectiveDraft[i];
        if (!baselineById.has(loc.id)) {
          const locRes = await fetch(`/api/cases/${id}/locations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...locationBody(loc), id: loc.id }),
          });
          const createdId = await readQueued(locRes);
          if (!locRes.ok) {
            setBaselineLocations(working);
            setDraftLocations(effectiveDraft.map((l) => ({ ...l })));
            setLocationStatus("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          const savedLoc = createdId ? { ...loc, id: createdId } : { ...loc };
          effectiveDraft[i] = savedLoc;
          working = [...working, { ...savedLoc }];
        }
      }

      for (const loc of effectiveDraft) {
        const original = baselineById.get(loc.id);
        if (original && !sameLocation(original, loc)) {
          const locRes = await fetch(
            `/api/cases/${id}/locations/${loc.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(locationBody(loc)),
            },
          );
          await readQueued(locRes);
          if (!locRes.ok) {
            setBaselineLocations(working);
            setDraftLocations(effectiveDraft.map((l) => ({ ...l })));
            setLocationStatus("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          working = working.map((l) => (l.id === loc.id ? { ...loc } : l));
        }
      }

      for (const original of baselineLocations) {
        if (!currentIds.has(original.id)) {
          const locRes = await fetch(
            `/api/cases/${id}/locations/${original.id}`,
            { method: "DELETE" },
          );
          await readQueued(locRes);
          if (!locRes.ok) {
            setBaselineLocations(working);
            setDraftLocations(effectiveDraft.map((l) => ({ ...l })));
            setLocationStatus("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          working = working.filter((l) => l.id !== original.id);
        }
      }

      const persisted = working.map((l) => ({ ...l }));
      setBaselineLocations(persisted);
      setDraftLocations(persisted.map((l) => ({ ...l })));
      setLocationStatus(
        queued
          ? "Kuyruğa alındı, bağlantı gelince gönderilecek."
          : "Konumlar kaydedildi.",
      );
    } catch {
      setBaselineLocations(working);
      setDraftLocations(effectiveDraft.map((l) => ({ ...l })));
      setLocationStatus("Bağlantı hatası, tekrar deneyin.");
    } finally {
      savingLocationsRef.current = false;
      setSavingLocations(false);
    }
  }

  async function saveEvidences() {
    if (savingEvidencesRef.current) return;
    savingEvidencesRef.current = true;
    setSavingEvidences(true);
    setEvidenceStatus("");
    let working = [...baselineEvidences];
    let effectiveDraft = draftEvidences.map((e) => ({ ...e }));
    let queued = false;
    async function readBody(res: Response): Promise<{
      queued?: boolean;
      id?: unknown;
      imageFile?: unknown;
      audioFile?: unknown;
    } | null> {
      try {
        const body = (await res.json()) as {
          queued?: boolean;
          id?: unknown;
          imageFile?: unknown;
          audioFile?: unknown;
        } | null;
        if (body?.queued === true) queued = true;
        return body;
      } catch {
        return null;
      }
    }
    function failSave() {
      setBaselineEvidences(working);
      setDraftEvidences(effectiveDraft.map((e) => ({ ...e })));
      setEvidenceStatus("Deliller kaydedilemedi, tekrar deneyin.");
    }
    try {
      const baselineById = new Map(baselineEvidences.map((e) => [e.id, e]));
      const currentIds = new Set(draftEvidences.map((e) => e.id));

      for (let i = 0; i < effectiveDraft.length; i++) {
        const evidence = effectiveDraft[i];
        if (baselineById.has(evidence.id)) continue;
        const res = await fetch(`/api/cases/${id}/evidences`, {
          method: "POST",
          body: evidenceForm(evidence, true),
        });
        const body = await readBody(res);
        if (!res.ok) {
          failSave();
          return;
        }
        const saved: CaseEvidenceDraft = {
          ...evidence,
          id: typeof body?.id === "string" ? body.id : evidence.id,
          imageFile:
            typeof body?.imageFile === "string"
              ? body.imageFile
              : (evidence.imageFile ?? null),
          audioFile:
            typeof body?.audioFile === "string"
              ? body.audioFile
              : (evidence.audioFile ?? null),
          image: null,
          audio: null,
          removeImage: false,
          removeAudio: false,
        };
        effectiveDraft[i] = saved;
        working = [...working, { ...saved }];
      }

      for (const evidence of effectiveDraft) {
        const original = baselineById.get(evidence.id);
        if (original && !sameEvidence(original, evidence)) {
          const res = await fetch(
            `/api/cases/${id}/evidences/${evidence.id}`,
            { method: "PATCH", body: evidenceForm(evidence, false) },
          );
          const body = await readBody(res);
          if (!res.ok) {
            failSave();
            return;
          }
          const saved: CaseEvidenceDraft = {
            ...evidence,
            imageFile:
              typeof body?.imageFile === "string"
                ? body.imageFile
                : evidence.removeImage
                  ? null
                  : (evidence.imageFile ?? null),
            audioFile:
              typeof body?.audioFile === "string"
                ? body.audioFile
                : evidence.removeAudio
                  ? null
                  : (evidence.audioFile ?? null),
            image: null,
            audio: null,
            removeImage: false,
            removeAudio: false,
          };
          const idx = effectiveDraft.findIndex((e) => e.id === evidence.id);
          if (idx >= 0) effectiveDraft[idx] = saved;
          working = working.map((e) => (e.id === evidence.id ? { ...saved } : e));
        }
      }

      for (const original of baselineEvidences) {
        if (!currentIds.has(original.id)) {
          const res = await fetch(
            `/api/cases/${id}/evidences/${original.id}`,
            { method: "DELETE" },
          );
          await readBody(res);
          if (!res.ok) {
            failSave();
            return;
          }
          working = working.filter((e) => e.id !== original.id);
        }
      }

      const persisted = working.map((e) => ({ ...e }));
      setBaselineEvidences(persisted);
      setDraftEvidences(persisted.map((e) => ({ ...e })));
      setEvidenceStatus(
        queued
          ? "Kuyruğa alındı, bağlantı gelince gönderilecek."
          : "Deliller kaydedildi.",
      );
    } catch {
      setBaselineEvidences(working);
      setDraftEvidences(effectiveDraft.map((e) => ({ ...e })));
      setEvidenceStatus("Bağlantı hatası, tekrar deneyin.");
    } finally {
      savingEvidencesRef.current = false;
      setSavingEvidences(false);
    }
  }

  async function savePersons() {
    // Yeniden giriş koruması: çift tık yinelenen POST yaratmaz.
    if (savingPersonsRef.current) return;
    savingPersonsRef.current = true;
    setSavingPersons(true);
    setPersonStatus("");
    // Başarılı işlemler ara tabana işlenir; kısmi hatada taslak korunur.
    let working = [...baselinePersons];
    let effectiveDraft = draftPersons.map((p) => ({ ...p }));
    let queued = false;
    async function readQueued(res: Response): Promise<string | null> {
      try {
        const body = (await res.json()) as {
          queued?: boolean;
          id?: unknown;
        } | null;
        if (body?.queued === true) queued = true;
        return typeof body?.id === "string" ? body.id : null;
      } catch {
        return null;
      }
    }
    function failSave() {
      setBaselinePersons(working);
      setDraftPersons(effectiveDraft.map((p) => ({ ...p })));
      setPersonStatus("Kişiler kaydedilemedi, tekrar deneyin.");
    }
    // Sorgu sesini kişi kaydından sonra ayrı uçla eşitler; güncel
    // audioFile değerini döndürür, hata durumunda throw eder.
    async function syncAudio(
      personId: string,
      person: CasePersonDraft,
    ): Promise<string | null> {
      if (person.type === "maktul") return null;
      if (person.audio) {
        const form = new FormData();
        form.append("file", person.audio);
        const res = await fetch(`/api/cases/${id}/persons/${personId}/audio`, {
          method: "POST",
          body: form,
        });
        let audioFile: string | null = person.audioFile ?? null;
        try {
          const body = (await res.json()) as {
            queued?: boolean;
            audioFile?: unknown;
          } | null;
          if (body?.queued === true) queued = true;
          if (typeof body?.audioFile === "string") audioFile = body.audioFile;
        } catch {
          // gövde okunamazsa eski değer korunur
        }
        if (!res.ok) throw new Error("audio upload failed");
        return audioFile;
      }
      if (person.removeAudio && person.audioFile) {
        const res = await fetch(`/api/cases/${id}/persons/${personId}/audio`, {
          method: "DELETE",
        });
        await readQueued(res);
        if (!res.ok) throw new Error("audio delete failed");
        return null;
      }
      return person.audioFile ?? null;
    }
    try {
      const baselineById = new Map(baselinePersons.map((p) => [p.id, p]));
      const currentIds = new Set(draftPersons.map((p) => p.id));

      // Önce yeni maktüller: yeni tanık/şüpheli onlara bağlanabilsin.
      for (const wantVictim of [true, false]) {
        for (let i = 0; i < effectiveDraft.length; i++) {
          const person = effectiveDraft[i];
          if (baselineById.has(person.id)) continue;
          if ((person.type === "maktul") !== wantVictim) continue;
          const personRes = await fetch(`/api/cases/${id}/persons`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...personBody(person), id: person.id }),
          });
          const createdId = await readQueued(personRes);
          if (!personRes.ok) {
            failSave();
            return;
          }
          let savedPerson = createdId
            ? { ...person, id: createdId }
            : { ...person };
          try {
            const audioFile = await syncAudio(savedPerson.id, savedPerson);
            savedPerson = {
              ...savedPerson,
              audioFile,
              audio: null,
              removeAudio: false,
            };
          } catch {
            effectiveDraft[i] = savedPerson;
            working = [...working, { ...savedPerson }];
            failSave();
            return;
          }
          effectiveDraft[i] = savedPerson;
          if (savedPerson.id !== person.id) {
            effectiveDraft = effectiveDraft.map((p) =>
              p.relatedVictimId === person.id
                ? { ...p, relatedVictimId: savedPerson.id }
                : p,
            );
          }
          working = [...working, { ...savedPerson }];
        }
      }

      for (const person of effectiveDraft) {
        const original = baselineById.get(person.id);
        if (original && !samePerson(original, person)) {
          const personRes = await fetch(
            `/api/cases/${id}/persons/${person.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(personBody(person)),
            },
          );
          await readQueued(personRes);
          if (!personRes.ok) {
            failSave();
            return;
          }
          let savedPerson = { ...person };
          try {
            const audioFile = await syncAudio(person.id, person);
            savedPerson = {
              ...savedPerson,
              audioFile,
              audio: null,
              removeAudio: false,
            };
          } catch {
            failSave();
            return;
          }
          const idx = effectiveDraft.findIndex((p) => p.id === person.id);
          if (idx >= 0) effectiveDraft[idx] = savedPerson;
          working = working.map((p) =>
            p.id === person.id ? { ...savedPerson } : p,
          );
        }
      }

      for (const original of baselinePersons) {
        if (!currentIds.has(original.id)) {
          const personRes = await fetch(
            `/api/cases/${id}/persons/${original.id}`,
            { method: "DELETE" },
          );
          await readQueued(personRes);
          if (!personRes.ok) {
            failSave();
            return;
          }
          working = working.filter((p) => p.id !== original.id);
        }
      }

      const persisted = working.map((p) => ({ ...p }));
      setBaselinePersons(persisted);
      setDraftPersons(persisted.map((p) => ({ ...p })));
      setPersonStatus(
        queued
          ? "Kuyruğa alındı, bağlantı gelince gönderilecek."
          : "Kişiler kaydedildi.",
      );
    } catch {
      setBaselinePersons(working);
      setDraftPersons(effectiveDraft.map((p) => ({ ...p })));
      setPersonStatus("Bağlantı hatası, tekrar deneyin.");
    } finally {
      savingPersonsRef.current = false;
      setSavingPersons(false);
    }
  }

  async function toggleStatus() {
    if (!caseItem || togglingStatus) return;
    setTogglingStatus(true);
    try {
      const next = caseItem.status === "closed" ? "open" : "closed";
      const res = await fetch(`/api/cases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === "open" || body.status === "closed") {
          if (body.status === "closed") {
            setDraftLocations(baselineLocations.map((l) => ({ ...l })));
            setLocationStatus("");
            setDraftPersons(baselinePersons.map((p) => ({ ...p })));
            setPersonStatus("");
            setDraftEvidences(baselineEvidences.map((e) => ({ ...e })));
            setEvidenceStatus("");
          }
          setCaseItem({ ...caseItem, status: body.status });
        }
      }
    } catch {
      // Sessiz geç: durum düğmesi kritik akışı engellemez.
    } finally {
      setTogglingStatus(false);
    }
  }

  async function approve(targetId: string) {    setApproving((cur) => ({ ...cur, [targetId]: true }));
    setApproveError((cur) => ({ ...cur, [targetId]: "" }));
    try {
      const res = await fetch(`/api/cases/${id}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (!res.ok) {
        setApproveError((cur) => ({
          ...cur,
          [targetId]: "Onay kaydedilemedi.",
        }));
        return;
      }
      setApproved((cur) => ({ ...cur, [targetId]: true }));
    } catch {
      setApproveError((cur) => ({
        ...cur,
        [targetId]: "Bağlantı hatası, tekrar deneyin.",
      }));
    } finally {
      setApproving((cur) => ({ ...cur, [targetId]: false }));
    }
  }

  if (caseMissing) {
    return (
      <main style={mainStyle}>
        <p>Vaka bulunamadı.</p>
      </main>
    );
  }
  if (!caseItem) {
    return (
      <main style={mainStyle}>
        <p>Yükleniyor…</p>
      </main>
    );
  }

  const showFreshBadge = similar?.fresh === false || caseItem.needsRerank === true;
  const locationsDirty = !sameLocations(baselineLocations, draftLocations);
  const personsDirty = !samePersons(baselinePersons, draftPersons);
  const evidencesDirty = !sameEvidences(baselineEvidences, draftEvidences);

  return (
    <main style={mainStyle}>
      <style>{layoutCss}</style>
      <h1>Vaka {caseItem.caseNo}</h1>
      <p>
        <button
          type="button"
          disabled={togglingStatus}
          onClick={() => void toggleStatus()}
          style={approveButtonStyle}
        >
          {caseItem.status === "closed" ? "Vakayı Aç" : "Vakayı Kapat"}
        </button>
      </p>
      {showFreshBadge ? <p style={badgeStyle}>yeni benzerler</p> : null}
      <div className="trace-case-layout">
        <section aria-label="Vaka detayı" style={cardStyle}>
          <h2>Vaka detayı</h2>
          <p>{caseItem.summary}</p>
          {fieldRow("Suç tipi", caseItem.crimeType)}
          {fieldRow("Olay tarihi", caseItem.occurredAt)}
          {fieldRow("Yöntem", caseItem.mo)}
          {fieldRow("Silah", caseItem.weapon)}
          {fieldRow("Durum", caseItem.status === "closed" ? "Kapalı" : "Açık")}
          <EvidenceSection
            evidences={draftEvidences}
            onChange={(evidences) => {
              setDraftEvidences(evidences);
              setEvidenceStatus("");
            }}
            idPrefix="detay"
            readOnly={caseItem.status === "closed" || savingEvidences}
            dirty={caseItem.status !== "closed" && evidencesDirty}
            status={evidenceStatus}
            onSave={saveEvidences}
            onReset={() => {
              setDraftEvidences(baselineEvidences.map((e) => ({ ...e })));
              setEvidenceStatus("");
            }}
          />
          <LocationsSection
            locations={draftLocations}
            onChange={(locs) => {
              setDraftLocations(locs);
              setLocationStatus("");
            }}
            idPrefix="detay"
            readOnly={caseItem.status === "closed" || savingLocations}
            dirty={caseItem.status !== "closed" && locationsDirty}
            status={locationStatus}
            onSave={saveLocations}
            onReset={() => {
              setDraftLocations(baselineLocations.map((l) => ({ ...l })));
              setLocationStatus("");
            }}
          />
          <PeopleSection
            persons={draftPersons}
            onChange={(persons) => {
              setDraftPersons(persons);
              setPersonStatus("");
            }}
            idPrefix="detay"
            readOnly={caseItem.status === "closed" || savingPersons}
            dirty={caseItem.status !== "closed" && personsDirty}
            status={personStatus}
            onSave={savePersons}
            onReset={() => {
              setDraftPersons(baselinePersons.map((p) => ({ ...p })));
              setPersonStatus("");
            }}
          />
        </section>
        <section aria-label="Benzer vakalar" style={cardStyle}>
          <h2>Benzer vakalar</h2>
          {similarError ? <p role="alert">{similarError}</p> : null}
          {similar?.pendingEnrichment ? (
            <p style={badgeStyle}>
              Bekleyen zenginleştirme işleri var; sonuçlar eksik veriyle
              hesaplanmış olabilir.
            </p>
          ) : null}
          {!similar && !similarError ? <p>Yükleniyor…</p> : null}
          {similar && similar.results.length === 0 ? (
            <p>Benzer vaka yok.</p>
          ) : null}
          {similar && similar.results.length > 0 ? (
            <ul aria-label="Benzer vaka listesi">
              {similar.results.map((r) => (
                <li key={r.caseId} style={cardStyle}>
                  <p>
                    <strong>Vaka: </strong>
                    <a href={`/cases/${r.caseId}`}>{r.caseNo || r.caseId}</a>
                  </p>
                  <p>
                    <strong>skor: </strong>
                    {r.score === 0 ? "0 (puanlanmadı)" : String(r.score)}
                  </p>
                  <p>
                    <strong>gerekçe: </strong>
                    {r.reason}
                  </p>
                  {Array.isArray(r.similarities) && r.similarities.length > 0 ? (
                    <ul>
                      {r.similarities.map((s, i) => (
                        <li key={`${s.kind}-${i}`}>
                          <strong>{s.kind}: </strong>
                          {s.description} ({s.strength}/10)
                          {s.evidence ? (
                            <>
                              {" — "}
                              <span>kanıt: {s.evidence}</span>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {approved[r.caseId] ? (
                    <p>onaylandı</p>
                  ) : (
                    <button
                      type="button"
                      disabled={approving[r.caseId] === true}
                      onClick={() => void approve(r.caseId)}
                      style={approveButtonStyle}
                    >
                      alakalı
                    </button>
                  )}
                  {approveError[r.caseId] ? (
                    <p role="alert">{approveError[r.caseId]}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </main>
  );
}
