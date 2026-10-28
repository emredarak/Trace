// Case dossier — versioned case compilation built by Muse Glimmer.
//
// Deterministic extraction (cases / case_locations / case_persons / evidences
// rows; authoritative data is case_persons + case_locations) plus a Glimmer call
// for transcript summaries. Highlights are always verbatim quotes from the
// source transcript and carry the source record id; the Glimmer
// summary lives in a separate field, so an invented quote can never enter highlights.
//
// The result is written to case_dossiers with a hash. The hash is computed only from
// deterministic sources (raw transcript text and transcriptHash fingerprint included,
// Glimmer summaries excluded); with identical deterministic content
// Glimmer is never called and the stored dossier is returned as-is (updatedAt preserved).
// On partial change, summaries of unchanged transcripts are reused from the previous
// dossier (keyed by sourceId + transcriptHash).
// Missing persons/locations/evidence, corrupt enrichment JSON, or a Glimmer
// failure never corrupts the dossier; only a missing case throws.
// Note: the summary prompt truncates the transcript at 4000 characters (known limit).
//
// Client pattern is the same as field-brief.ts: tests inject a fake client,
// production uses glimmerChat; a network error leaves the summary empty.

import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { glimmerChat } from "./glimmer-client";
import { resolveTimeoutMs, withModelTimeout } from "./model-timeout";
import type { Transcript } from "./transcribe";
import type { Box } from "./mark-photo";

export const DOSSIER_VERSION = 1;

/** Max highlight segments per transcript. */
export const MAX_TRANSCRIPT_HIGHLIGHTS = 5;
/** Per-highlight character limit (source text prefix is preserved). */
export const MAX_HIGHLIGHT_CHARS = 400;

// Injectable client seam: tests pass a fake, production uses glimmerChat.
export interface GlimmerClient {
  summarize(prompt: string): Promise<string>;
}
export type DossierClient = GlimmerClient;

type GlimmerInput =
  | GlimmerClient
  | { chatCompletion(prompt: string): Promise<string> }
  | { glimmerChat(prompt: string): Promise<string> }
  | ((prompt: string) => Promise<string>);

let clientOverride: GlimmerClient | undefined;

/** Test seam: tests inject a fake client so no network is used. */
export function __setDossierClientForTests(
  client: GlimmerClient | undefined,
): void {
  clientOverride = client;
}
export const __setGlimmerClientForTests = __setDossierClientForTests;

const defaultGlimmerClient: GlimmerClient = {
  summarize: (prompt: string) => glimmerChat(prompt),
};

function asGlimmerClient(input: GlimmerInput | undefined): GlimmerClient {
  if (input === undefined) return clientOverride ?? defaultGlimmerClient;
  if (typeof input === "function") return { summarize: input };
  if (typeof (input as GlimmerClient).summarize === "function") {
    return input as GlimmerClient;
  }
  const alt = input as {
    chatCompletion?: (p: string) => Promise<string>;
    glimmerChat?: (p: string) => Promise<string>;
  };
  if (typeof alt.chatCompletion === "function") {
    return { summarize: (p) => alt.chatCompletion!(p) };
  }
  if (typeof alt.glimmerChat === "function") {
    return { summarize: (p) => alt.glimmerChat!(p) };
  }
  return clientOverride ?? defaultGlimmerClient;
}

export interface DossierTranscriptHighlight {
  /** Source record id (person or evidence id). */
  sourceId: string;
  speaker: string | null;
  /** Verbatim quote from the source transcript. */
  text: string;
}

export interface DossierEvent {
  sourceId: string;
  summary: string;
  crimeType: string | null;
  weapon: string | null;
  mo: string | null;
  occurredAt: string | null;
}

export interface DossierLocation {
  sourceId: string;
  title: string | null;
  kind: string | null;
  priority: string | null;
  note: string | null;
  locationText: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface DossierPerson {
  sourceId: string;
  name: string | null;
  type: string;
  age: number | null;
  gender: string | null;
  note: string | null;
  relatedVictimId: string | null;
  relationship: string | null;
  unidentified: boolean;
  contactStatus: string | null;
  transcriptHighlights: DossierTranscriptHighlight[];
  /** Deterministic transcript fingerprint; the summary cache is keyed by this. */
  transcriptHash: string | null;
  /** Glimmer summary; null when there is no transcript or Glimmer fails. */
  transcriptSummary: string | null;
}

export interface DossierEvidence {
  sourceId: string;
  type: string;
  title: string | null;
  note: string | null;
  /** SAM-derived deduplicated labels (first-seen order). */
  samLabels: string[];
  markingBoxes: Box[];
  transcriptHighlights: DossierTranscriptHighlight[];
  /** Deterministic transcript fingerprint; the summary cache is keyed by this. */
  transcriptHash: string | null;
  /** Glimmer summary; null when there is no transcript or Glimmer fails. */
  transcriptSummary: string | null;
}

export interface CaseDossier {
  caseId: string;
  caseNo: string;
  status: string;
  version: number;
  hash: string;
  event: DossierEvent;
  locations: DossierLocation[];
  persons: DossierPerson[];
  evidences: DossierEvidence[];
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseTranscript(raw: unknown): Transcript | null {
  const rawText = text(raw);
  if (!rawText) return null;
  try {
    const parsed = JSON.parse(rawText) as {
      text?: unknown;
      segments?: unknown;
    };
    if (typeof parsed !== "object" || parsed === null) return null;
    const segments: Transcript["segments"] = [];
    if (Array.isArray(parsed.segments)) {
      for (const entry of parsed.segments) {
        if (typeof entry !== "object" || entry === null) continue;
        const seg = entry as {
          speaker?: unknown;
          text?: unknown;
          start?: unknown;
          end?: unknown;
        };
        const segText = text(seg.text);
        if (!segText) continue;
        segments.push({
          ...(text(seg.speaker) ? { speaker: text(seg.speaker)! } : {}),
          text: segText,
          ...(num(seg.start) !== null ? { start: num(seg.start)! } : {}),
          ...(num(seg.end) !== null ? { end: num(seg.end)! } : {}),
        });
      }
    }
    const full = text(parsed.text);
    if (!full && segments.length === 0) return null;
    return { text: full ?? segments.map((s) => s.text).join(" "), segments };
  } catch {
    return null;
  }
}

function parseMarkingBoxes(raw: unknown): Box[] {
  const rawText = text(raw);
  if (!rawText) return [];
  try {
    const parsed = JSON.parse(rawText) as { boxes?: unknown };
    if (!Array.isArray(parsed?.boxes)) return [];
    const boxes: Box[] = [];
    for (const entry of parsed.boxes) {
      if (typeof entry !== "object" || entry === null) continue;
      const b = entry as Record<string, unknown>;
      const [x, y, w, h] = [num(b.x), num(b.y), num(b.w), num(b.h)];
      const label = text(b.label);
      if (x === null || y === null || w === null || h === null || !label) {
        continue;
      }
      boxes.push({ x, y, w, h, label });
    }
    return boxes;
  } catch {
    return [];
  }
}

function highlightsFor(
  sourceId: string,
  transcript: Transcript | null,
): DossierTranscriptHighlight[] {
  if (!transcript) return [];
  if (transcript.segments.length > 0) {
    // Pick the most informative (longest) segments, present in original order.
    const indexed = transcript.segments
      .map((seg, index) => ({ seg, index, segText: seg.text.trim() }))
      .filter((e) => e.segText.length > 0);
    const selected = [...indexed]
      .sort((a, b) => b.segText.length - a.segText.length || a.index - b.index)
      .slice(0, MAX_TRANSCRIPT_HIGHLIGHTS)
      .sort((a, b) => a.index - b.index);
    return selected.map(({ seg, segText }) => ({
      sourceId,
      speaker: seg.speaker?.trim() ? seg.speaker.trim() : null,
      text: segText.slice(0, MAX_HIGHLIGHT_CHARS),
    }));
  }
  const full = transcript.text.trim();
  if (!full) return [];
  return [
    { sourceId, speaker: null, text: full.slice(0, MAX_HIGHLIGHT_CHARS) },
  ];
}

function transcriptHashOf(transcript: Transcript | null): string | null {
  if (!transcript) return null;
  return createHash("sha256")
    .update(JSON.stringify(transcript))
    .digest("hex");
}

async function summarizeTranscript(
  client: GlimmerClient,
  transcript: Transcript | null,
): Promise<string | null> {
  if (!transcript) return null;
  const body = transcript.text.trim();
  if (!body) return null;
  const prompt = [
    "Summarize the following interrogation/evidence audio transcript in one or two sentences. Return only the summary, do not invent quotes.",
    body.slice(0, 4000),
  ].join("\n");
  try {
    // Bounded timeout (GLIMMER_TIMEOUT_MS, default 120000 ms): a hanging
    // Glimmer degrades exactly like an error — summary stays null.
    const out = await withModelTimeout(
      client.summarize(prompt),
      resolveTimeoutMs(undefined, "GLIMMER_TIMEOUT_MS"),
      "glimmer timeout",
    );
    return typeof out === "string" && out.trim() ? out.trim() : null;
  } catch {
    return null;
  }
}

type Row = Record<string, unknown>;

export async function buildDossier(
  db: Database.Database,
  caseId: string,
  glimmer?: GlimmerInput,
): Promise<CaseDossier> {
  const client = asGlimmerClient(glimmer);
  const caseRow = db
    .prepare("SELECT * FROM cases WHERE id = ?")
    .get(caseId) as Row | undefined;
  if (!caseRow) throw new Error(`case not found: ${caseId}`);

  const locationRows = db
    .prepare(
      "SELECT * FROM case_locations WHERE caseId = ? ORDER BY createdAt ASC, id ASC",
    )
    .all(caseId) as Row[];
  const personRows = db
    .prepare(
      "SELECT * FROM case_persons WHERE caseId = ? ORDER BY createdAt ASC, id ASC",
    )
    .all(caseId) as Row[];
  const evidenceRows = db
    .prepare(
      "SELECT * FROM evidences WHERE caseId = ? ORDER BY createdAt ASC, id ASC",
    )
    .all(caseId) as Row[];

  const locations: DossierLocation[] = locationRows.map((r) => ({
    sourceId: String(r.id),
    title: text(r.title),
    kind: text(r.kind),
    priority: text(r.priority),
    note: text(r.note),
    locationText: text(r.locationText),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
  }));

  // First the deterministic skeleton: all fields except summaries plus the raw transcript.
  // Only this feeds the hash; Glimmer free text never enters the hash.
  interface PersonDraft extends Omit<DossierPerson, "transcriptSummary"> {
    transcript: Transcript | null;
  }
  interface EvidenceDraft extends Omit<DossierEvidence, "transcriptSummary"> {
    transcript: Transcript | null;
  }
  const personDrafts: PersonDraft[] = personRows.map((r) => {
    const sourceId = String(r.id);
    const transcript = parseTranscript(r.transcript);
    return {
      sourceId,
      name: text(r.name),
      type: typeof r.type === "string" && r.type ? r.type : "person",
      age: num(r.age),
      gender: text(r.gender),
      note: text(r.note),
      relatedVictimId: text(r.relatedVictimId),
      relationship: text(r.relationship),
      unidentified: Boolean(r.unidentified),
      contactStatus: text(r.contactStatus),
      transcriptHighlights: highlightsFor(sourceId, transcript),
      transcriptHash: transcriptHashOf(transcript),
      transcript,
    };
  });
  const evidenceDrafts: EvidenceDraft[] = evidenceRows.map((r) => {
    const sourceId = String(r.id);
    const transcript = parseTranscript(r.transcript);
    const boxes = parseMarkingBoxes(r.marking);
    const samLabels: string[] = [];
    for (const b of boxes) {
      if (!samLabels.includes(b.label)) samLabels.push(b.label);
    }
    return {
      sourceId,
      type: typeof r.type === "string" && r.type ? r.type : "evidence",
      title: text(r.title),
      note: text(r.note),
      samLabels,
      markingBoxes: boxes,
      transcriptHighlights: highlightsFor(sourceId, transcript),
      transcriptHash: transcriptHashOf(transcript),
      transcript,
    };
  });

  const base: Omit<CaseDossier, "hash" | "persons" | "evidences"> = {
    caseId: String(caseRow.id),
    caseNo: String(caseRow.caseNo ?? ""),
    status: text(caseRow.status) ?? "open",
    version: DOSSIER_VERSION,
    event: {
      sourceId: String(caseRow.id),
      summary: typeof caseRow.summary === "string" ? caseRow.summary : "",
      crimeType: text(caseRow.crimeType),
      weapon: text(caseRow.weapon),
      mo: text(caseRow.mo),
      occurredAt: text(caseRow.occurredAt),
    },
    locations,
  };
  const stripTranscript = <T extends { transcript: Transcript | null }>(
    draft: T,
  ) => {
    const { transcript, ...rest } = draft;
    // Raw transcript text participates in change detection (summaries do not).
    return { ...rest, transcriptText: transcript?.text ?? null };
  };
  const deterministic = {
    ...base,
    persons: personDrafts.map(stripTranscript),
    evidences: evidenceDrafts.map(stripTranscript),
  };
  const hash = createHash("sha256")
    .update(JSON.stringify(deterministic))
    .digest("hex");

  const existing = db
    .prepare("SELECT hash, json FROM case_dossiers WHERE caseId = ?")
    .get(caseId) as { hash: string; json: string } | undefined;

  // Identical deterministic content: Glimmer is never called, the stored dossier is returned.
  let previous: CaseDossier | null = null;
  if (existing) {
    try {
      previous = JSON.parse(existing.json) as CaseDossier;
    } catch {
      previous = null;
    }
    if (existing.hash === hash && previous && previous.hash === hash) {
      return previous;
    }
  }

  // Summaries of unchanged transcripts are reused from the previous dossier.
  const summaryCache = new Map<string, string>();
  if (previous) {
    for (const entry of [...previous.persons, ...previous.evidences]) {
      if (entry.transcriptHash && entry.transcriptSummary) {
        summaryCache.set(
          `${entry.sourceId}:${entry.transcriptHash}`,
          entry.transcriptSummary,
        );
      }
    }
  }
  const resolveSummary = async (
    sourceId: string,
    transcriptHash: string | null,
    transcript: Transcript | null,
  ): Promise<string | null> => {
    if (!transcript || !transcriptHash) return null;
    const cached = summaryCache.get(`${sourceId}:${transcriptHash}`);
    if (cached !== undefined) return cached;
    return summarizeTranscript(client, transcript);
  };

  const persons: DossierPerson[] = [];
  for (const { transcript, ...rest } of personDrafts) {
    persons.push({
      ...rest,
      transcriptSummary: await resolveSummary(
        rest.sourceId,
        rest.transcriptHash,
        transcript,
      ),
    });
  }
  const evidences: DossierEvidence[] = [];
  for (const { transcript, ...rest } of evidenceDrafts) {
    evidences.push({
      ...rest,
      transcriptSummary: await resolveSummary(
        rest.sourceId,
        rest.transcriptHash,
        transcript,
      ),
    });
  }

  const dossier: CaseDossier = { ...base, persons, evidences, hash };

  if (!existing || existing.hash !== hash) {
    db.prepare(
      `INSERT INTO case_dossiers (caseId, version, hash, json, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(caseId) DO UPDATE SET
         version = excluded.version,
         hash = excluded.hash,
         json = excluded.json,
         updatedAt = excluded.updatedAt`,
    ).run(
      dossier.caseId,
      dossier.version,
      hash,
      JSON.stringify(dossier),
      new Date().toISOString(),
    );
  }
  return dossier;
}

/** Reads the stored dossier; null when absent. Helper for Task 5/6. */
export function getDossier(
  db: Database.Database,
  caseId: string,
): CaseDossier | null {
  const row = db
    .prepare("SELECT json FROM case_dossiers WHERE caseId = ?")
    .get(caseId) as { json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.json) as CaseDossier;
  } catch {
    return null;
  }
}

/**
 * Source-only text for evidence verification: deterministic dossier fields
 * + verbatim transcript highlights + SAM labels, EXCLUDING Glimmer-generated
 * transcript summaries. A phrase invented by Glimmer must never verify.
 */
export function dossierSourceText(d: CaseDossier): string {
  return buildDossierText(d, false);
}

export function dossierText(d: CaseDossier): string {
  return buildDossierText(d, true);
}

function buildDossierText(d: CaseDossier, includeSummaries: boolean): string {
  const lines: string[] = [];
  lines.push(
    `Case ${d.caseNo} (id: ${d.caseId}, status: ${d.status}) [${d.event.sourceId}]`,
  );
  const e = d.event;
  const eventParts = [
    `summary: ${e.summary}`,
    e.crimeType ? `crime type: ${e.crimeType}` : "",
    e.weapon ? `weapon: ${e.weapon}` : "",
    e.mo ? `method: ${e.mo}` : "",
    e.occurredAt ? `occurred at: ${e.occurredAt}` : "",
  ].filter(Boolean);
  lines.push(`Event [${e.sourceId}]: ${eventParts.join(" | ")}`);

  for (const loc of d.locations) {
    const parts = [
      loc.title ?? "Location",
      loc.kind ? `type: ${loc.kind}` : "",
      loc.priority ? `priority: ${loc.priority}` : "",
      loc.latitude !== null && loc.longitude !== null
        ? `coordinates: ${loc.latitude},${loc.longitude}`
        : "",
      loc.note ? `note: ${loc.note}` : "",
      loc.locationText && loc.locationText !== loc.note
        ? `location text: ${loc.locationText}`
        : "",
    ].filter(Boolean);
    lines.push(`Location [${loc.sourceId}]: ${parts.join(" | ")}`);
  }

  for (const p of d.persons) {
    const parts = [
      p.name ?? (p.unidentified ? "Unidentified" : "Unnamed"),
      `role: ${p.type}`,
      p.age !== null ? `age: ${p.age}` : "",
      p.gender ? `gender: ${p.gender}` : "",
      p.relationship ? `relationship: ${p.relationship}` : "",
      p.note ? `note: ${p.note}` : "",
    ].filter(Boolean);
    lines.push(`Person [${p.sourceId}]: ${parts.join(" | ")}`);
    for (const h of p.transcriptHighlights) {
      lines.push(
        `  Interview highlight [${h.sourceId}]: ${h.speaker ? `${h.speaker}: ` : ""}${h.text}`,
      );
    }
    if (includeSummaries && p.transcriptSummary) {
      lines.push(`  Interview summary [${p.sourceId}]: ${p.transcriptSummary}`);
    }
  }

  for (const ev of d.evidences) {
    const parts = [
      ev.title ?? "Evidence",
      `type: ${ev.type}`,
      ev.note ? `note: ${ev.note}` : "",
      ev.samLabels.length > 0
        ? `SAM labels: ${ev.samLabels.join(", ")}`
        : "",
    ].filter(Boolean);
    lines.push(`Evidence [${ev.sourceId}]: ${parts.join(" | ")}`);
    for (const h of ev.transcriptHighlights) {
      lines.push(
        `  Evidence transcript highlight [${h.sourceId}]: ${h.speaker ? `${h.speaker}: ` : ""}${h.text}`,
      );
    }
    if (includeSummaries && ev.transcriptSummary) {
      lines.push(
        `  Evidence transcript summary [${ev.sourceId}]: ${ev.transcriptSummary}`,
      );
    }
  }
  return lines.join("\n");
}
