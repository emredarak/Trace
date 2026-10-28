// Vaka dosyasi (dossier) — Muse Glimmer'in derledigi, surumlu vaka derlemesi.
//
// Deterministik cikarim (cases / case_locations / case_persons / evidences
// satirlari, yetkili veri case_persons + case_locations) + transkript
// ozetleri icin Glimmer cagrisi. One cikanlar (highlights) her zaman kaynak
// transkriptten birebir alintidir ve kaynak kayit id'sini tasir; Glimmer
// ozeti ayri alanda durur, uydurma alinti one cikana giremez.
//
// Sonuc case_dossiers'a hash ile yazilir; icerik ayniysa satir yeniden
// yazilmaz (updatedAt korunur). Kisi/konum/delil yoklugu, bozuk
// zenginlestirme JSON'u veya Glimmer hatasi dosyayi bozmaz; yalnizca
// olmayan vaka hata firlatir.
//
// Musteri kalibi field-brief.ts ile ayni: testler sahte istemci enjekte
// eder, uretim glimmerChat kullanir; ag hatasi ozeti bos birakir.

import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { glimmerChat } from "./glimmer-client";
import type { Transcript } from "./transcribe";
import type { Box } from "./mark-photo";

export const DOSSIER_VERSION = 1;

/** Transkript basina en fazla one cikan segment sayisi. */
export const MAX_TRANSCRIPT_HIGHLIGHTS = 5;
/** One cikan basina karakter siniri (kaynak metnin on eki korunur). */
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
  /** Kaynak kayit id'si (kisi veya delil id'si). */
  sourceId: string;
  speaker: string | null;
  /** Kaynak transkriptten birebir alinti. */
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
  /** Glimmer ozeti; transkript yoksa veya Glimmer basarisizsa null. */
  transcriptSummary: string | null;
}

export interface DossierEvidence {
  sourceId: string;
  type: string;
  title: string | null;
  note: string | null;
  /** SAM kutularindan turetilmis, tekrarsiz etiketler (ilk gorunum sirasi). */
  samLabels: string[];
  markingBoxes: Box[];
  transcriptHighlights: DossierTranscriptHighlight[];
  /** Glimmer ozeti; transkript yoksa veya Glimmer basarisizsa null. */
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
  const out: DossierTranscriptHighlight[] = [];
  if (transcript.segments.length > 0) {
    for (const seg of transcript.segments) {
      if (out.length >= MAX_TRANSCRIPT_HIGHLIGHTS) break;
      const segText = seg.text.trim();
      if (!segText) continue;
      out.push({
        sourceId,
        speaker: seg.speaker?.trim() ? seg.speaker.trim() : null,
        text: segText.slice(0, MAX_HIGHLIGHT_CHARS),
      });
    }
    return out;
  }
  const full = transcript.text.trim();
  if (!full) return [];
  return [
    { sourceId, speaker: null, text: full.slice(0, MAX_HIGHLIGHT_CHARS) },
  ];
}

async function summarizeTranscript(
  client: GlimmerClient,
  transcript: Transcript | null,
): Promise<string | null> {
  if (!transcript) return null;
  const body = transcript.text.trim();
  if (!body) return null;
  const prompt = [
    "Asagidaki sorgu/delil ses transkriptini tek veya iki cumleyle ozetle. Sadece ozeti dondur, alinti uydurma.",
    body.slice(0, 4000),
  ].join("\n");
  try {
    const out = await client.summarize(prompt);
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
  if (!caseRow) throw new Error(`vaka bulunamadi: ${caseId}`);

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

  const persons: DossierPerson[] = [];
  for (const r of personRows) {
    const sourceId = String(r.id);
    const transcript = parseTranscript(r.transcript);
    persons.push({
      sourceId,
      name: text(r.name),
      type: typeof r.type === "string" && r.type ? r.type : "kisi",
      age: num(r.age),
      gender: text(r.gender),
      note: text(r.note),
      relatedVictimId: text(r.relatedVictimId),
      relationship: text(r.relationship),
      unidentified: Boolean(r.unidentified),
      contactStatus: text(r.contactStatus),
      transcriptHighlights: highlightsFor(sourceId, transcript),
      transcriptSummary: await summarizeTranscript(client, transcript),
    });
  }

  const evidences: DossierEvidence[] = [];
  for (const r of evidenceRows) {
    const sourceId = String(r.id);
    const transcript = parseTranscript(r.transcript);
    const boxes = parseMarkingBoxes(r.marking);
    const samLabels: string[] = [];
    for (const b of boxes) {
      if (!samLabels.includes(b.label)) samLabels.push(b.label);
    }
    evidences.push({
      sourceId,
      type: typeof r.type === "string" && r.type ? r.type : "evidence",
      title: text(r.title),
      note: text(r.note),
      samLabels,
      markingBoxes: boxes,
      transcriptHighlights: highlightsFor(sourceId, transcript),
      transcriptSummary: await summarizeTranscript(client, transcript),
    });
  }

  const content: Omit<CaseDossier, "hash"> = {
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
    persons,
    evidences,
  };
  const hash = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
  const dossier: CaseDossier = { ...content, hash };

  const existing = db
    .prepare("SELECT hash FROM case_dossiers WHERE caseId = ?")
    .get(caseId) as { hash: string } | undefined;
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

/** Kayitli dosyayi okur; yoksa null. Task 5/6 icin yardimci. */
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

export function dossierText(d: CaseDossier): string {
  const lines: string[] = [];
  lines.push(
    `Vaka ${d.caseNo} (id: ${d.caseId}, durum: ${d.status}) [${d.event.sourceId}]`,
  );
  const e = d.event;
  const eventParts = [
    `ozet: ${e.summary}`,
    e.crimeType ? `suc tipi: ${e.crimeType}` : "",
    e.weapon ? `silah: ${e.weapon}` : "",
    e.mo ? `yontem: ${e.mo}` : "",
    e.occurredAt ? `olay zamani: ${e.occurredAt}` : "",
  ].filter(Boolean);
  lines.push(`Olay [${e.sourceId}]: ${eventParts.join(" | ")}`);

  for (const loc of d.locations) {
    const parts = [
      loc.title ?? "Konum",
      loc.kind ? `tur: ${loc.kind}` : "",
      loc.priority ? `oncelik: ${loc.priority}` : "",
      loc.latitude !== null && loc.longitude !== null
        ? `koordinat: ${loc.latitude},${loc.longitude}`
        : "",
      loc.note ? `not: ${loc.note}` : "",
      loc.locationText && loc.locationText !== loc.note
        ? `konum metni: ${loc.locationText}`
        : "",
    ].filter(Boolean);
    lines.push(`Konum [${loc.sourceId}]: ${parts.join(" | ")}`);
  }

  for (const p of d.persons) {
    const parts = [
      p.name ?? (p.unidentified ? "Kimligi belirsiz" : "Isimsiz"),
      `rol: ${p.type}`,
      p.age !== null ? `yas: ${p.age}` : "",
      p.gender ? `cinsiyet: ${p.gender}` : "",
      p.relationship ? `iliski: ${p.relationship}` : "",
      p.note ? `not: ${p.note}` : "",
    ].filter(Boolean);
    lines.push(`Kisi [${p.sourceId}]: ${parts.join(" | ")}`);
    for (const h of p.transcriptHighlights) {
      lines.push(
        `  Sorgu one cikani [${h.sourceId}]: ${h.speaker ? `${h.speaker}: ` : ""}${h.text}`,
      );
    }
    if (p.transcriptSummary) {
      lines.push(`  Sorgu ozeti [${p.sourceId}]: ${p.transcriptSummary}`);
    }
  }

  for (const ev of d.evidences) {
    const parts = [
      ev.title ?? "Delil",
      `tur: ${ev.type}`,
      ev.note ? `not: ${ev.note}` : "",
      ev.samLabels.length > 0
        ? `SAM etiketleri: ${ev.samLabels.join(", ")}`
        : "",
    ].filter(Boolean);
    lines.push(`Delil [${ev.sourceId}]: ${parts.join(" | ")}`);
    for (const h of ev.transcriptHighlights) {
      lines.push(
        `  Delil transkript one cikani [${h.sourceId}]: ${h.speaker ? `${h.speaker}: ` : ""}${h.text}`,
      );
    }
    if (ev.transcriptSummary) {
      lines.push(
        `  Delil transkript ozeti [${ev.sourceId}]: ${ev.transcriptSummary}`,
      );
    }
  }
  return lines.join("\n");
}
