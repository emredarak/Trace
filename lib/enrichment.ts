import type Database from "better-sqlite3";
import {
  transcribe,
  type Transcript,
  type TranscriptionClient,
} from "./transcribe";
import { markPhoto, type Marking, type MarkingClient } from "./mark-photo";
import { readUpload } from "./uploads";

// Enrichment job processing (Task 3).
//
// Upload routes only enqueue jobs (see lib/db enqueueJob); this module is
// invoked lazily (e.g. by the similar flow) or directly in tests, so uploads
// never block on model calls.
//
// Storage: person transcripts on case_persons.transcript, evidence
// transcripts on evidences.transcript, SAM markings on evidences.marking —
// all JSON text (Transcript / Marking shapes, speaker segments preserved).
//
// Clients are injectable for tests. Accepted shapes (all optional):
//   { transcribe } / { transcribeClient } / { transcriptionClient }: TranscriptionClient | fn
//   { markPhoto } / { mark } / { marking } / { markingClient } / { sam }: MarkingClient | fn
// When omitted, transcribe()/markPhoto() fall back to their test overrides
// (__set...ForTests) or the real Meta API clients.

type TranscribeFn = (audio: Buffer, filename: string) => Promise<Transcript>;
type MarkFn = (image: Buffer, hint: string) => Promise<Marking>;

export interface EnrichmentClients {
  transcribe?: TranscriptionClient | TranscribeFn;
  transcribeClient?: TranscriptionClient | TranscribeFn;
  transcription?: TranscriptionClient | TranscribeFn;
  transcriptionClient?: TranscriptionClient | TranscribeFn;
  markPhoto?: MarkingClient | MarkFn;
  markPhotoClient?: MarkingClient | MarkFn;
  mark?: MarkingClient | MarkFn;
  marking?: MarkingClient | MarkFn;
  markingClient?: MarkingClient | MarkFn;
  sam?: MarkingClient | MarkFn;
}

function asTranscriptionClient(
  value: EnrichmentClients[keyof EnrichmentClients],
): TranscriptionClient | undefined {
  if (!value) return undefined;
  if (typeof value === "function") {
    const fn = value as TranscribeFn;
    return { transcribeAudio: (audio, filename) => fn(audio, filename) };
  }
  const obj = value as TranscriptionClient & { transcribe?: TranscribeFn };
  if (typeof obj.transcribeAudio === "function") return obj;
  if (typeof obj.transcribe === "function") {
    return { transcribeAudio: (audio, filename) => obj.transcribe!(audio, filename) };
  }
  return undefined;
}

function asMarkingClient(
  value: EnrichmentClients[keyof EnrichmentClients],
): MarkingClient | undefined {
  if (!value) return undefined;
  if (typeof value === "function") {
    const fn = value as MarkFn;
    return { markImage: (image, hint) => fn(image, hint) };
  }
  const obj = value as MarkingClient & { mark?: MarkFn; markPhoto?: MarkFn };
  if (typeof obj.markImage === "function") return obj;
  const fn = obj.mark ?? obj.markPhoto;
  if (typeof fn === "function") {
    return { markImage: (image, hint) => fn(image, hint) };
  }
  return undefined;
}

function ensureEnrichmentColumns(db: Database.Database): void {
  const cols = (table: string) =>
    new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
  const person = cols("case_persons");
  if (!person.has("transcript")) {
    db.exec("ALTER TABLE case_persons ADD COLUMN transcript TEXT");
  }
  const evidence = cols("evidences");
  if (!evidence.has("transcript")) {
    db.exec("ALTER TABLE evidences ADD COLUMN transcript TEXT");
  }
  if (!evidence.has("marking")) {
    db.exec("ALTER TABLE evidences ADD COLUMN marking TEXT");
  }
}

interface JobRow {
  id: string;
  caseId: string;
  kind: string;
  refId: string | null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function runJob(
  db: Database.Database,
  job: JobRow,
  transcribeClient: TranscriptionClient | undefined,
  markingClient: MarkingClient | undefined,
): Promise<void> {
  if (!job.refId) throw new Error("is referansi (refId) yok");
  if (job.kind === "transcribe") {
    const person = db
      .prepare("SELECT audioFile FROM case_persons WHERE id = ? AND caseId = ?")
      .get(job.refId, job.caseId) as { audioFile: unknown } | undefined;
    if (person) {
      const file = text(person.audioFile);
      if (!file) throw new Error("kisi ses dosyasi yok");
      const audio = readUpload(file);
      if (!audio) throw new Error(`ses dosyasi diskte yok: ${file}`);
      const transcript = await transcribe(audio, file, transcribeClient);
      db.prepare("UPDATE case_persons SET transcript = ? WHERE id = ? AND caseId = ?").run(
        JSON.stringify(transcript),
        job.refId,
        job.caseId,
      );
      return;
    }
    const evidence = db
      .prepare("SELECT audioFile FROM evidences WHERE id = ? AND caseId = ?")
      .get(job.refId, job.caseId) as { audioFile: unknown } | undefined;
    if (evidence) {
      const file = text(evidence.audioFile);
      if (!file) throw new Error("delil ses dosyasi yok");
      const audio = readUpload(file);
      if (!audio) throw new Error(`ses dosyasi diskte yok: ${file}`);
      const transcript = await transcribe(audio, file, transcribeClient);
      db.prepare("UPDATE evidences SET transcript = ? WHERE id = ? AND caseId = ?").run(
        JSON.stringify(transcript),
        job.refId,
        job.caseId,
      );
      return;
    }
    throw new Error("transcribe hedefi bulunamadi (kisi/delil kaydi yok)");
  }
  if (job.kind === "sam") {
    const evidence = db
      .prepare("SELECT title, note, imageFile FROM evidences WHERE id = ? AND caseId = ?")
      .get(job.refId, job.caseId) as
      | { title: unknown; note: unknown; imageFile: unknown }
      | undefined;
    if (!evidence) throw new Error("sam hedefi bulunamadi (delil kaydi yok)");
    const file = text(evidence.imageFile);
    if (!file) throw new Error("delil gorsel dosyasi yok");
    const image = readUpload(file);
    if (!image) throw new Error(`gorsel dosyasi diskte yok: ${file}`);
    const hint = text(evidence.title) ?? text(evidence.note) ?? "delil";
    const marking = await markPhoto(image, hint, markingClient);
    db.prepare("UPDATE evidences SET marking = ? WHERE id = ? AND caseId = ?").run(
      JSON.stringify(marking),
      job.refId,
      job.caseId,
    );
    return;
  }
  throw new Error(`desteklenmeyen is turu: ${job.kind}`);
}

export async function processPendingJobs(
  db: Database.Database,
  limit = 10,
  clients: EnrichmentClients = {},
): Promise<{ done: number; failed: number }> {
  ensureEnrichmentColumns(db);
  const safeLimit =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : 10;
  if (safeLimit === 0) return { done: 0, failed: 0 };
  const transcribeClient = asTranscriptionClient(
    clients.transcribe ?? clients.transcribeClient ?? clients.transcription ?? clients.transcriptionClient,
  );
  const markingClient = asMarkingClient(
    clients.markPhoto ?? clients.markPhotoClient ?? clients.mark ?? clients.marking ?? clients.markingClient ?? clients.sam,
  );
  // 'dossier' jobs belong to Task 4; leave them pending here.
  const jobs = db
    .prepare(
      `SELECT id, caseId, kind, refId FROM enrichment_jobs
       WHERE status = 'pending' AND kind IN ('transcribe', 'sam')
       ORDER BY createdAt ASC LIMIT ?`,
    )
    .all(safeLimit) as JobRow[];
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    const now = new Date().toISOString();
    try {
      await runJob(db, job, transcribeClient, markingClient);
      db.prepare(
        "UPDATE enrichment_jobs SET status = 'done', attempts = attempts + 1, lastError = NULL, updatedAt = ? WHERE id = ?",
      ).run(now, job.id);
      done++;
    } catch (err) {
      // Record (person/evidence) is never deleted; job stays retryable by
      // re-enqueueing (enqueueJob opens a new job once this one is failed).
      db.prepare(
        "UPDATE enrichment_jobs SET status = 'failed', attempts = attempts + 1, lastError = ?, updatedAt = ? WHERE id = ?",
      ).run(err instanceof Error ? err.message : String(err), now, job.id);
      failed++;
    }
  }
  return { done, failed };
}
