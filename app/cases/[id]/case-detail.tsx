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

export const SIMILARITY_KIND_LABELS: Record<string, string> = {
  summary: "Summary",
  "crime-type": "Crime Type",
  method: "Method",
  weapon: "Weapon",
  location: "Location",
  person: "Person",
  "interview-quote": "Interview Quote",
  "evidence-object": "Evidence Object",
  "evidence-note": "Evidence Note",
  time: "Time",
};

const layoutCss = [
  ".trace-case-layout{display:grid;grid-template-columns:1fr;gap:1.25rem;align-items:start}",
  "@media(min-width:64rem){.trace-case-layout{grid-template-columns:minmax(0,1.35fr) minmax(20rem,1fr)}",
  ".trace-case-layout>section{min-width:0}}",
  ".trace-similar{position:sticky;top:5.4rem;max-height:calc(100vh - 6.8rem);overflow-y:auto}",
  "@media(max-width:63.9rem){.trace-similar{position:static;max-height:none;overflow:visible}}",
  ".case-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;margin:1rem 0 1.25rem}",
  ".case-fields p{margin:0;background:var(--panel-2);border:1px solid var(--line-soft);border-radius:10px;padding:.65rem .8rem;font-size:.92rem;overflow-wrap:anywhere}",
  "@media(max-width:44rem){.case-fields{grid-template-columns:1fr}}",
].join("");

const mainStyle: React.CSSProperties = {
  maxWidth: "92rem",
  margin: "0 auto",
  padding: "1.75rem clamp(1rem,3vw,2.5rem) 4rem",
  fontSize: "1rem",
  lineHeight: 1.55,
};

const cardStyle: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line-soft)",
  borderRadius: "var(--radius)",
  padding: "1.25rem 1.35rem",
  marginBottom: "1rem",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  background: "var(--gold)",
  color: "var(--gold-ink)",
  border: "1px solid var(--gold)",
  borderRadius: "999px",
  padding: "0.25rem 0.75rem",
  fontSize: "0.85rem",
  fontWeight: 750,
  marginBottom: "1rem",
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
    title: l.title ?? "Location",
    note: l.note ?? "",
    kind: l.kind ?? "related",
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
    priority: l.kind === "crime-scene" ? null : l.priority,
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
    p.type === "victim" ? null : p.relatedVictimId || null;
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
  const [expandedSimilar, setExpandedSimilar] = useState<
    Record<string, boolean>
  >({});
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
          if (!cancelled) setSimilarError("Could not load similar cases.");
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
        if (!cancelled) setSimilarError("Connection error, please try again.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function saveLocations() {
    // Re-entry guard: double-clicks never create duplicate POSTs.
    if (savingLocationsRef.current) return;
    savingLocationsRef.current = true;
    setSavingLocations(true);
    setLocationStatus("");
    // Successful operations are applied to the working baseline; drafts are preserved on partial failure.
    let working = [...baselineLocations];
    // Active draft advanced with copies returned from the server;
    // state objects are never mutated directly.
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
            setLocationStatus("Could not save locations, please try again.");
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
            setLocationStatus("Could not save locations, please try again.");
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
            setLocationStatus("Could not save locations, please try again.");
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
          ? "Queued, will be sent once you're back online."
          : "Locations saved.",
      );
    } catch {
      setBaselineLocations(working);
      setDraftLocations(effectiveDraft.map((l) => ({ ...l })));
      setLocationStatus("Connection error, please try again.");
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
      setEvidenceStatus("Could not save evidence, please try again.");
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
          ? "Queued, will be sent once you're back online."
          : "Evidence saved.",
      );
    } catch {
      setBaselineEvidences(working);
      setDraftEvidences(effectiveDraft.map((e) => ({ ...e })));
      setEvidenceStatus("Connection error, please try again.");
    } finally {
      savingEvidencesRef.current = false;
      setSavingEvidences(false);
    }
  }

  async function savePersons() {
    // Re-entry guard: double-clicks never create duplicate POSTs.
    if (savingPersonsRef.current) return;
    savingPersonsRef.current = true;
    setSavingPersons(true);
    setPersonStatus("");
    // Successful operations are applied to the working baseline; drafts are preserved on partial failure.
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
      setPersonStatus("Could not save people, please try again.");
    }
    // Syncs the interview audio after the person record via a separate endpoint; returns the updated
    // audioFile value, throws on error.
    async function syncAudio(
      personId: string,
      person: CasePersonDraft,
    ): Promise<string | null> {
      if (person.type === "victim") return null;
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
          // keep the old value when the body is unreadable
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

      // New victims first: so new witnesses/suspects can link to them.
      for (const wantVictim of [true, false]) {
        for (let i = 0; i < effectiveDraft.length; i++) {
          const person = effectiveDraft[i];
          if (baselineById.has(person.id)) continue;
          if ((person.type === "victim") !== wantVictim) continue;
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
          ? "Queued, will be sent once you're back online."
          : "People saved.",
      );
    } catch {
      setBaselinePersons(working);
      setDraftPersons(effectiveDraft.map((p) => ({ ...p })));
      setPersonStatus("Connection error, please try again.");
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
      // Fail silently: the status button must not block the critical flow.
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
          [targetId]: "Could not save approval.",
        }));
        return;
      }
      setApproved((cur) => ({ ...cur, [targetId]: true }));
    } catch {
      setApproveError((cur) => ({
        ...cur,
        [targetId]: "Connection error, please try again.",
      }));
    } finally {
      setApproving((cur) => ({ ...cur, [targetId]: false }));
    }
  }

  if (caseMissing) {
    return (
      <main style={mainStyle}>
        <p>Case not found.</p>
      </main>
    );
  }
  if (!caseItem) {
    return (
      <main style={mainStyle}>
        <p>Loading…</p>
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
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <h1 style={{ borderBottom: "none", paddingBottom: 0 }}>
          Case {caseItem.caseNo}
        </h1>
        <button
          type="button"
          className="btn-ghost"
          disabled={togglingStatus}
          onClick={() => void toggleStatus()}
          style={{ marginTop: "0.6rem" }}
        >
          {caseItem.status === "closed" ? "Reopen Case" : "Close Case"}
        </button>
      </div>
      <p
        style={{
          color: "var(--muted)",
          borderBottom: "1px solid var(--line)",
          paddingBottom: "1rem",
          marginTop: "0.2rem",
        }}
      >
        {caseItem.status === "closed" ? "Closed case" : "Active case"}
        {caseItem.crimeType ? ` · ${caseItem.crimeType}` : ""}
        {caseItem.occurredAt ? ` · ${caseItem.occurredAt}` : ""}
      </p>
      {showFreshBadge ? <p style={badgeStyle}>new similar cases</p> : null}
      <div className="trace-case-layout">
        <section aria-label="Case detail" style={cardStyle}>
          <h2 style={{ marginTop: "0.2rem" }}>Case detail</h2>
          <p
            style={{
              fontSize: "1.06rem",
              lineHeight: 1.65,
              maxWidth: "68ch",
              margin: "0.4rem 0 0",
            }}
          >
            {caseItem.summary}
          </p>
          <div className="case-fields">
            {fieldRow("Crime type", caseItem.crimeType)}
            {fieldRow("Incident date", caseItem.occurredAt)}
            {fieldRow("Method", caseItem.mo)}
            {fieldRow("Weapon", caseItem.weapon)}
            {fieldRow("Status", caseItem.status === "closed" ? "Closed" : "Open")}
          </div>
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
        <section
          aria-label="Similar cases"
          className="trace-similar similar-scroll"
          style={cardStyle}
        >
          <div className="record-head">
            <h2 style={{ margin: 0 }}>Similar cases</h2>
            {similar && similar.results.length > 0 ? (
              <span className="record-count">
                {similar.results.length}{" "}
                {similar.results.length === 1 ? "match" : "matches"}
              </span>
            ) : null}
          </div>
          {similar && similar.results.length > 0 ? (
            <>
              <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: 0 }}>
                Ranked by overall score. Open a row to see its evidence.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "0.45rem",
                  flexWrap: "wrap",
                  marginBottom: "0.85rem",
                }}
              >
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() =>
                    setExpandedSimilar(
                      Object.fromEntries(
                        similar.results.map((r) => [r.caseId, true]),
                      ),
                    )
                  }
                >
                  Expand all
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setExpandedSimilar({})}
                >
                  Collapse all
                </button>
              </div>
            </>
          ) : null}
          {similarError ? <p role="alert">{similarError}</p> : null}
          {similar?.pendingEnrichment ? (
            <p style={badgeStyle}>
              Background enrichment jobs are still pending; results may be
              based on incomplete data.
            </p>
          ) : null}
          {!similar && !similarError ? <p>Loading…</p> : null}
          {similar && similar.results.length === 0 ? (
            <p>No similar cases.</p>
          ) : null}
          {similar && similar.results.length > 0 ? (
            <ul aria-label="Similar case list">
              {similar.results.map((r) => {
                const scoreColor =
                  r.score >= 8
                    ? "var(--accent)"
                    : r.score >= 5
                      ? "var(--gold)"
                      : "var(--muted)";
                const sims = Array.isArray(r.similarities)
                  ? r.similarities
                  : [];
                const strongest =
                  sims.length > 0
                    ? sims.reduce((a, b) => (b.strength > a.strength ? b : a))
                    : null;
                const expanded = expandedSimilar[r.caseId] === true;
                return (
                  <li
                    key={r.caseId}
                    style={{
                      background: "var(--panel-2)",
                      border: "1px solid var(--line-soft)",
                      borderRadius: "12px",
                      padding: "0.95rem 1rem",
                      marginBottom: "0.7rem",
                    }}
                  >
                    <div
                      style={{
                        position: "sticky",
                        top: "-0.95rem",
                        zIndex: 2,
                        background: "var(--panel-2)",
                        margin: "-0.95rem -1rem 0",
                        padding: "0.95rem 1rem 0.7rem",
                        borderRadius: "12px 12px 0 0",
                        borderBottom: expanded
                          ? "1px solid var(--line-soft)"
                          : "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "0.8rem",
                        }}
                      >
                        <p style={{ margin: 0 }}>
                          <strong>Case: </strong>
                          <a href={`/cases/${r.caseId}`} style={{ fontSize: "1.02rem" }}>
                            {r.caseNo || r.caseId}
                          </a>
                        </p>
                        <span style={{ textAlign: "right", lineHeight: 1.05 }}>
                          <span
                            style={{
                              display: "block",
                              fontSize: "1.45rem",
                              fontWeight: 900,
                              color: scoreColor,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {r.score === 0 ? "0" : String(r.score)}
                          </span>
                          <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>
                            {r.score === 0 ? "not scored" : "score / 10"}
                          </span>
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "0.6rem",
                          flexWrap: "wrap",
                          marginTop: "0.55rem",
                        }}
                      >
                        {approved[r.caseId] ? (
                          <span className="chip gold">approved</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ padding: "0.32rem 0.8rem", fontSize: "0.84rem" }}
                            disabled={approving[r.caseId] === true}
                            onClick={() => void approve(r.caseId)}
                          >
                            relevant
                          </button>
                        )}
                        {sims.length > 0 ? (
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ padding: "0.32rem 0.8rem", fontSize: "0.84rem" }}
                            aria-expanded={expanded}
                            aria-controls={`similar-details-${r.caseId}`}
                            onClick={() =>
                              setExpandedSimilar((cur) => ({
                                ...cur,
                                [r.caseId]: !expanded,
                              }))
                            }
                          >
                            {expanded ? "Hide details ▴" : "Show details ▾"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <p
                      style={{
                        color: "var(--muted)",
                        fontSize: "0.9rem",
                        lineHeight: 1.55,
                        margin: "0.45rem 0 0",
                      }}
                    >
                      <strong style={{ color: "var(--text)" }}>reason: </strong>
                      {r.reason}
                    </p>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.4rem",
                        alignItems: "center",
                        marginTop: "0.6rem",
                      }}
                    >
                      {sims.length > 0 ? (
                        <span className="chip">
                          {sims.length}{" "}
                          {sims.length === 1 ? "finding" : "findings"}
                        </span>
                      ) : null}
                      {strongest ? (
                        <span className="chip gold">
                          Strongest:{" "}
                          {SIMILARITY_KIND_LABELS[strongest.kind] ??
                            strongest.kind}{" "}
                          {strongest.strength}/10
                        </span>
                      ) : null}
                    </div>
                    {expanded && sims.length > 0 ? (
                      <ul
                        id={`similar-details-${r.caseId}`}
                        style={{ marginTop: "0.5rem" }}
                      >
                        {r.similarities.map((s, i) => (
                          <li
                            key={`${s.kind}-${i}`}
                            style={{
                              background: "transparent",
                              border: "none",
                              borderTop: "1px solid var(--line-soft)",
                              borderRadius: 0,
                              padding: "0.6rem 0 0.55rem",
                              marginBottom: 0,
                            }}
                          >
                            <span
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: "0.8rem",
                                fontSize: "0.88rem",
                              }}
                            >
                              <strong>
                                {SIMILARITY_KIND_LABELS[s.kind] ?? s.kind}:
                              </strong>
                              <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
                                {s.strength}/10
                              </span>
                            </span>
                            <span style={{ display: "block", fontSize: "0.9rem", marginTop: "0.15rem" }}>
                              {s.description}
                            </span>
                            <span
                              aria-hidden="true"
                              style={{
                                display: "block",
                                height: "0.28rem",
                                background: "var(--panel-3)",
                                borderRadius: "999px",
                                overflow: "hidden",
                                margin: "0.4rem 0 0",
                              }}
                            >
                              <span
                                style={{
                                  display: "block",
                                  height: "100%",
                                  width: `${Math.max(0, Math.min(10, s.strength)) * 10}%`,
                                  background: scoreColor,
                                  borderRadius: "999px",
                                }}
                              />
                            </span>
                            {s.evidence ? (
                              <span
                                style={{
                                  display: "block",
                                  fontSize: "0.82rem",
                                  color: "var(--muted)",
                                  borderLeft: "3px solid var(--gold)",
                                  paddingLeft: "0.6rem",
                                  marginTop: "0.45rem",
                                  lineHeight: 1.5,
                                }}
                              >
                                evidence: {s.evidence}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {approveError[r.caseId] ? (
                      <p role="alert">{approveError[r.caseId]}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>
    </main>
  );
}
