// Multi-channel candidate generation — Glimmer runs it, narrows the pool for Spark.
//
// Channels do not score; the goal is that no strong candidate stays out of the pool:
// - text: existing FTS prefilter as-is, as the text channel.
// - location: smallest distance between coordinated locations <= 5 km.
// - person: normalized name + role overlap; unidentified persons excluded.
// - object: normalized SAM label overlap.
// - time: event date within +-90 days.
// Closed cases included, query case excluded. Multi-channel candidates come first,
// at most 20 candidates returned. Channel order is fixed: text, location,
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

/** English normalization: lowercase, accent folding, whitespace collapsing. */
export function normalizeTextEnglish(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * @deprecated Use normalizeTextEnglish instead. Kept for compatibility.
 */
export const normalizeTurkish = normalizeTextEnglish;

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
  // The dossier event has no locationType; use the full FTS fields when a DB row exists.
  try {
    const row = db
      .prepare("SELECT summary, crimeType, locationType, weapon, mo FROM cases WHERE id = ?")
      .get(query.caseId) as CaseFeatures | undefined;
    if (row) return row;
  } catch {
    // Fall back to the dossier event when the DB is unreachable.
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
    // When the query dossier is not in the list, fall back to the stored dossier; candidates are the given list.
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

  // text: FTS prefilter as-is; only cases in the given dossier pool can be candidates.
  const candidateIds = new Set(candidates.map((d) => d.caseId));
  for (const hit of prefilter(db, queryFeatures(db, query), MAX_CANDIDATES)) {
    if (candidateIds.has(hit.caseId)) add(hit.caseId, "text");
  }

  // Precomputed query-side sets.
  const queryLocations = query.locations.filter(hasCoordinates);
  const queryPersons = new Set<string>();
  for (const p of query.persons) {
    if (p.unidentified || !p.name) continue;
    const name = normalizeTextEnglish(p.name);
    if (name) queryPersons.add(`${name}::${normalizeTextEnglish(p.type ?? "")}`);
  }
  const queryLabels = new Set<string>();
  for (const ev of query.evidences) {
    for (const label of ev.samLabels) {
      const n = normalizeTextEnglish(label);
      if (n) queryLabels.add(n);
    }
  }
  const queryTime = query.event.occurredAt ? Date.parse(query.event.occurredAt) : NaN;

  for (const cand of candidates) {
    // location: is the smallest distance within the threshold?
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

    // person: normalized name + role; unidentified persons excluded on both sides.
    if (queryPersons.size > 0) {
      for (const p of cand.persons) {
        if (p.unidentified || !p.name) continue;
        const name = normalizeTextEnglish(p.name);
        if (name && queryPersons.has(`${name}::${normalizeTextEnglish(p.type ?? "")}`)) {
          add(cand.caseId, "person");
          break;
        }
      }
    }

    // object: normalized SAM label overlap.
    if (queryLabels.size > 0) {
      outer: for (const ev of cand.evidences) {
        for (const label of ev.samLabels) {
          if (queryLabels.has(normalizeTextEnglish(label))) {
            add(cand.caseId, "object");
            break outer;
          }
        }
      }
    }

    // time: +-90 days.
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
  // Multi-channel first; stable sort keeps original discovery order for equal channel counts.
  result.sort((a, b) => b.channels.length - a.channels.length);
  return result.slice(0, MAX_CANDIDATES);
}
