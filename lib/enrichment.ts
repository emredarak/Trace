import type Database from "better-sqlite3";
import {
  transcribe,
  type Transcript,
  type TranscriptionClient,
} from "./transcribe";
import { markPhoto, type Marking, type MarkingClient } from "./mark-photo";
import { readUpload } from "./uploads";
import { enqueueJob } from "./db";

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

// Returns true when the result was discarded as stale (file replaced or
// removed while the model call was in flight) AND the record now points at
// a different file that still needs processing. The caller then marks this
// job done first (so enqueueJob dedupe no longer sees it as pending) and
// re-enqueues a fresh job for the new file.
async function runJob(
  db: Database.Database,
  job: JobRow,
  transcribeClient: TranscriptionClient | undefined,
  markingClient: MarkingClient | undefined,
): Promise<boolean> {
  if (!job.refId) throw new Error("job reference (refId) is missing");
  if (job.kind === "transcribe") {
    const person = db
      .prepare("SELECT audioFile FROM case_persons WHERE id = ? AND caseId = ?")
      .get(job.refId, job.caseId) as { audioFile: unknown } | undefined;
    if (person) {
      const file = text(person.audioFile);
      if (!file) throw new Error("person audio file is missing");
      const audio = readUpload(file);
      if (!audio) throw new Error(`audio file not on disk: ${file}`);
      const transcript = await transcribe(audio, file, transcribeClient);
      const res = db
        .prepare(
          "UPDATE case_persons SET transcript = ? WHERE id = ? AND caseId = ? AND audioFile = ?",
        )
        .run(JSON.stringify(transcript), job.refId, job.caseId, file);
      if (res.changes > 0) return false;
      const now = db
        .prepare("SELECT audioFile FROM case_persons WHERE id = ? AND caseId = ?")
        .get(job.refId, job.caseId) as { audioFile: unknown } | undefined;
      return Boolean(now && text(now.audioFile) && text(now.audioFile) !== file);
    }
    const evidence = db
      .prepare("SELECT audioFile FROM evidences WHERE id = ? AND caseId = ?")
      .get(job.refId, job.caseId) as { audioFile: unknown } | undefined;
    if (evidence) {
      const file = text(evidence.audioFile);
      if (!file) throw new Error("evidence audio file is missing");
      const audio = readUpload(file);
      if (!audio) throw new Error(`audio file not on disk: ${file}`);
      const transcript = await transcribe(audio, file, transcribeClient);
      const res = db
        .prepare(
          "UPDATE evidences SET transcript = ? WHERE id = ? AND caseId = ? AND audioFile = ?",
        )
        .run(JSON.stringify(transcript), job.refId, job.caseId, file);
      if (res.changes > 0) return false;
      const now = db
        .prepare("SELECT audioFile FROM evidences WHERE id = ? AND caseId = ?")
        .get(job.refId, job.caseId) as { audioFile: unknown } | undefined;
      return Boolean(now && text(now.audioFile) && text(now.audioFile) !== file);
    }
    throw new Error("transcribe target not found (no person/evidence record)");
  }
  if (job.kind === "sam") {
    const evidence = db
      .prepare("SELECT title, note, imageFile FROM evidences WHERE id = ? AND caseId = ?")
      .get(job.refId, job.caseId) as
      | { title: unknown; note: unknown; imageFile: unknown }
      | undefined;
    if (!evidence) throw new Error("sam target not found (no evidence record)");
    const file = text(evidence.imageFile);
    if (!file) throw new Error("evidence image file is missing");
    const image = readUpload(file);
    if (!image) throw new Error(`image file not on disk: ${file}`);
    const hint = text(evidence.title) ?? text(evidence.note) ?? "evidence";
    const marking = await markPhoto(image, hint, markingClient);
    const res = db
      .prepare(
        "UPDATE evidences SET marking = ? WHERE id = ? AND caseId = ? AND imageFile = ?",
      )
      .run(JSON.stringify(marking), job.refId, job.caseId, file);
    if (res.changes > 0) return false;
    const now = db
      .prepare("SELECT imageFile FROM evidences WHERE id = ? AND caseId = ?")
      .get(job.refId, job.caseId) as { imageFile: unknown } | undefined;
    return Boolean(now && text(now.imageFile) && text(now.imageFile) !== file);
  }
  throw new Error(`unsupported job type: ${job.kind}`);
}

export interface EnrichmentProgress {
  onJobsSelected?: (info: {
    total: number;
    transcribeCount: number;
    samCount: number;
  }) => void;
  onJobFinished?: (info: {
    completed: number;
    total: number;
    done: number;
    failed: number;
    kind: string;
  }) => void;
}

export async function processPendingJobs(
  db: Database.Database,
  limit = 10,
  clients: EnrichmentClients = {},
  progress: EnrichmentProgress = {},
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
  // Retry contract (controller ruling): failed jobs with attempts < 3 are
  // retried in place by later calls; at attempts >= 3 they stay failed.
  const jobs = db
    .prepare(
      `SELECT id, caseId, kind, refId FROM enrichment_jobs
       WHERE kind IN ('transcribe', 'sam')
         AND (status = 'pending' OR (status = 'failed' AND attempts < 3))
       ORDER BY createdAt ASC LIMIT ?`,
    )
    .all(safeLimit) as JobRow[];
  progress.onJobsSelected?.({
    total: jobs.length,
    transcribeCount: jobs.filter((j) => j.kind === "transcribe").length,
    samCount: jobs.filter((j) => j.kind === "sam").length,
  });
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    const now = new Date().toISOString();
    try {
      const needsRequeue = await runJob(db, job, transcribeClient, markingClient);
      db.prepare(
        "UPDATE enrichment_jobs SET status = 'done', attempts = attempts + 1, lastError = NULL, updatedAt = ? WHERE id = ?",
      ).run(now, job.id);
      done++;
      if (needsRequeue && job.refId) {
        // Stale result discarded; the record's new file still needs work.
        // Enqueued only after this job is 'done' so dedupe does not
        // collapse it into the just-finished job.
        enqueueJob(db, {
          caseId: job.caseId,
          kind: job.kind as "transcribe" | "sam",
          refId: job.refId,
        });
      }
    } catch (err) {
      // Record (person/evidence) is never deleted; the job is retried by a
      // later processPendingJobs call while attempts < 3.
      db.prepare(
        "UPDATE enrichment_jobs SET status = 'failed', attempts = attempts + 1, lastError = ?, updatedAt = ? WHERE id = ?",
      ).run(err instanceof Error ? err.message : String(err), now, job.id);
      failed++;
    }
    progress.onJobFinished?.({
      completed: done + failed,
      total: jobs.length,
      done,
      failed,
      kind: job.kind,
    });
  }
  return { done, failed };
}
