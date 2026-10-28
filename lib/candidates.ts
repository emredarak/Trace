// Cok kanalli aday uretimi — Glimmer yurutur, Spark'a gidecek havuzu daraltir.
//
// Kanallar puan vermez; amac guclu adayin havuz disinda kalmamasi:
// - text: mevcut FTS on elemesi (lib/prefilter) aynen metin kanali olarak.
// - location: koordinatli konumlar arasi en kucuk mesafe <= 5 km.
// - person: Turkce normalize ad + rol cakismasi; kimligi belirsizler haric.
// - object: normalize SAM etiketi cakismasi.
// - time: olay tarihi +-90 gun.
// Kapali vakalar dahil, sorgu vaka haric. Cok kanalli aday once gelir,
// toplam en fazla 20 aday doner. Kanal sirasi sabittir: text, location,
// person, object, time.

import type Database from "better-sqlite3";
import type { CaseDossier } from "./dossier";
import { getDossier } from "./dossier";
import { haversineMeters } from "./locations";
import { prefilter, type CaseFeatures } from "./prefilter";

export type CandidateChannel = "text" | "location" | "person" | "object" | "time";

export interface CandidateMatch {
  caseId: string;
  channels: CandidateChannel[];
}

export const MAX_CANDIDATES = 20;
export const LOCATION_THRESHOLD_METERS = 5_000;
export const TIME_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

const CHANNEL_ORDER: CandidateChannel[] = ["text", "location", "person", "object", "time"];

/** Turkce normalize: kucuk harf (tr), aksan/karakter katlama, bosluk sikistirma. */
export function normalizeTurkish(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

type DossiersInput =
  | readonly CaseDossier[]
  | ReadonlyMap<string, CaseDossier>
  | Readonly<Record<string, CaseDossier>>;

function toDossierList(dossiers: DossiersInput): CaseDossier[] {
  if (Array.isArray(dossiers)) return [...dossiers];
  if (dossiers instanceof Map) return [...dossiers.values()];
  return Object.values(dossiers as Record<string, CaseDossier>);
}

function queryFeatures(db: Database.Database, query: CaseDossier): CaseFeatures {
  // Dossier olayinda locationType yok; DB satiri varsa FTS alanlarini tam kullan.
  try {
    const row = db
      .prepare("SELECT summary, crimeType, locationType, weapon, mo FROM cases WHERE id = ?")
      .get(query.caseId) as CaseFeatures | undefined;
    if (row) return row;
  } catch {
    // DB erisilemezse dosya olayina dus.
  }
  return {
    summary: query.event.summary,
    crimeType: query.event.crimeType,
    weapon: query.event.weapon,
    mo: query.event.mo,
  };
}

function hasCoordinates(loc: { latitude: number | null; longitude: number | null }): boolean {
  return typeof loc.latitude === "number" && typeof loc.longitude === "number";
}

export function findCandidates(
  db: Database.Database,
  queryId: string,
  dossiers: DossiersInput,
): CandidateMatch[] {
  const all = toDossierList(dossiers);
  let query = all.find((d) => d.caseId === queryId);
  if (!query) {
    // Sorgu dosyasi listede yoksa kayitli dosyaya dus; adaylar verilen listedir.
    query = getDossier(db, queryId) ?? undefined;
    if (!query) return [];
  }
  const candidates = all.filter((d) => d.caseId !== queryId);

  const hits = new Map<string, Set<CandidateChannel>>();
  const add = (caseId: string, channel: CandidateChannel) => {
    if (caseId === queryId) return;
    let set = hits.get(caseId);
    if (!set) {
      set = new Set();
      hits.set(caseId, set);
    }
    set.add(channel);
  };

  // text: FTS on elemesi aynen; yalniz verilen dosya havuzundaki vakalar aday olur.
  const candidateIds = new Set(candidates.map((d) => d.caseId));
  for (const hit of prefilter(db, queryFeatures(db, query), MAX_CANDIDATES)) {
    if (candidateIds.has(hit.caseId)) add(hit.caseId, "text");
  }

  // Sorgu tarafi kume on hesaplamalari.
  const queryLocations = query.locations.filter(hasCoordinates);
  const queryPersons = new Set<string>();
  for (const p of query.persons) {
    if (p.unidentified || !p.name) continue;
    const name = normalizeTurkish(p.name);
    if (name) queryPersons.add(`${name}::${normalizeTurkish(p.type ?? "")}`);
  }
  const queryLabels = new Set<string>();
  for (const ev of query.evidences) {
    for (const label of ev.samLabels) {
      const n = normalizeTurkish(label);
      if (n) queryLabels.add(n);
    }
  }
  const queryTime = query.event.occurredAt ? Date.parse(query.event.occurredAt) : NaN;

  for (const cand of candidates) {
    // location: en kucuk mesafe esik icinde mi?
    if (queryLocations.length > 0) {
      let min = Infinity;
      for (const a of queryLocations) {
        for (const b of cand.locations) {
          if (!hasCoordinates(b)) continue;
          const m = haversineMeters(
            { latitude: a.latitude!, longitude: a.longitude! },
            { latitude: b.latitude!, longitude: b.longitude! },
          );
          if (m < min) min = m;
        }
      }
      if (min <= LOCATION_THRESHOLD_METERS) add(cand.caseId, "location");
    }

    // person: normalize ad + rol; kimligi belirsizler her iki tarafta haric.
    if (queryPersons.size > 0) {
      for (const p of cand.persons) {
        if (p.unidentified || !p.name) continue;
        const name = normalizeTurkish(p.name);
        if (name && queryPersons.has(`${name}::${normalizeTurkish(p.type ?? "")}`)) {
          add(cand.caseId, "person");
          break;
        }
      }
    }

    // object: normalize SAM etiketi cakismasi.
    if (queryLabels.size > 0) {
      outer: for (const ev of cand.evidences) {
        for (const label of ev.samLabels) {
          if (queryLabels.has(normalizeTurkish(label))) {
            add(cand.caseId, "object");
            break outer;
          }
        }
      }
    }

    // time: +-90 gun.
    if (Number.isFinite(queryTime) && cand.event.occurredAt) {
      const t = Date.parse(cand.event.occurredAt);
      if (Number.isFinite(t) && Math.abs(t - queryTime) <= TIME_WINDOW_MS) {
        add(cand.caseId, "time");
      }
    }
  }

  const result: CandidateMatch[] = [...hits.entries()].map(([caseId, set]) => ({
    caseId,
    channels: CHANNEL_ORDER.filter((c) => set.has(c)),
  }));
  // Cok kanalli once; ayni kanal sayisinda ilk kesif sirasi korunur (stable sort).
  result.sort((a, b) => b.channels.length - a.channels.length);
  return result.slice(0, MAX_CANDIDATES);
}
