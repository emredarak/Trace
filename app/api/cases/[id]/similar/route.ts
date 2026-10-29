import { NextResponse } from "next/server";
import type Database from "better-sqlite3";
import { getDb, initDb } from "../../../../../lib/db";
import { processPendingJobs } from "../../../../../lib/enrichment";
import { buildDossier, type CaseDossier } from "../../../../../lib/dossier";
import { findCandidates } from "../../../../../lib/candidates";
import { scoreCandidates, type ScoreProgressEvent } from "../../../../../lib/similarity";
import {
  STAGE_ORDER,
  estimateRemaining,
  loadSearchRuns,
  recordSearchRun,
  type Estimate,
  type SearchProgressEvent,
  type SearchRunRecord,
  type StageKey,
} from "../../../../../lib/search-estimate";

/** Max enrichment jobs to run in a single request. */
const ENRICHMENT_JOB_LIMIT = 5;

function similarResultLimit(): number {
  const n = Number(process.env.SIMILAR_RESULT_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

function hasPendingEnrichment(db: ReturnType<typeof getDb>): boolean {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM enrichment_jobs
         WHERE status = 'pending' OR (status = 'failed' AND attempts < 3)`,
      )
      .get() as { n: number };
    return row.n > 0;
  } catch {
    return false;
  }
}

function countPendingModelJobs(db: Database.Database): number {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM enrichment_jobs
         WHERE kind IN ('transcribe', 'sam')
           AND (status = 'pending' OR (status = 'failed' AND attempts < 3))`,
      )
      .get() as { n: number };
    return row.n;
  } catch {
    return 0;
  }
}

type Details = Record<string, number | string | boolean>;
type Emit = (event: SearchProgressEvent) => void;

interface SimilarPayload {
  results: unknown[];
  fresh: boolean;
  limit: number;
  pendingEnrichment: boolean;
}

/** Tracks stage timing/status, emits progress + estimates, collects the run record. */
class SearchTracker {
  private seq = 0;
  private readonly startedAt = performance.now();
  private stageStartedAt = new Map<StageKey, number>();
  private activeStage: StageKey | null = null;
  readonly durations = new Map<StageKey, number>();
  readonly run: SearchRunRecord = {
    enrichmentMs: null,
    dossiersMs: null,
    candidatesMs: null,
    scoringMs: null,
    verificationMs: null,
    enrichmentJobs: 0,
    transcribeJobs: 0,
    samJobs: 0,
    dossierTotal: 0,
    candidateCount: 0,
    cachedCount: 0,
    sparkPendingCount: 0,
    imageCount: 0,
    outcome: "result",
  };
  readonly workloads: { enrichmentJobs?: number; dossierTotal?: number; sparkPendingCount?: number } = {};

  constructor(
    private readonly emit: Emit | undefined,
    private readonly history: SearchRunRecord[],
  ) {}

  private elapsed(): number {
    return Math.round(performance.now() - this.startedAt);
  }

  private send(event: SearchProgressEvent): void {
    this.emit?.(event);
  }

  private estimateEvent(): void {
    if (!this.emit) return;
    let estimate: Estimate | null = null;
    const active = this.activeStage;
    if (active) {
      const idx = STAGE_ORDER.indexOf(active);
      estimate = estimateRemaining(this.history, {
        stage: active,
        stageElapsedMs: Math.round(performance.now() - (this.stageStartedAt.get(active) ?? this.startedAt)),
        remainingStages: STAGE_ORDER.slice(idx + 1),
        workloads: this.workloads,
      });
    }
    this.send({ seq: ++this.seq, elapsedMs: this.elapsed(), type: "estimate", estimate });
  }

  started(): void {
    this.send({ seq: ++this.seq, elapsedMs: this.elapsed(), type: "started" });
    this.estimateEvent();
  }

  startStage(stage: StageKey, details?: Details): void {
    this.activeStage = stage;
    this.stageStartedAt.set(stage, performance.now());
    this.send({ seq: ++this.seq, elapsedMs: this.elapsed(), type: "stage_started", stage, details });
    this.estimateEvent();
  }

  progress(stage: StageKey, completed: number, total: number, details?: Details): void {
    this.send({ seq: ++this.seq, elapsedMs: this.elapsed(), type: "stage_progress", stage, completed, total, details });
    this.estimateEvent();
  }

  elapsedInStage(stage: StageKey): number {
    const startedAt = this.stageStartedAt.get(stage);
    return startedAt === undefined ? 0 : Math.max(0, Math.round(performance.now() - startedAt));
  }

  completeStage(
    stage: StageKey,
    status: "done" | "skipped" | "degraded",
    details?: Details,
    recordDuration = status === "done",
    durationOverride?: number,
  ): void {
    const durationMs = durationOverride ?? this.elapsedInStage(stage);
    this.durations.set(stage, durationMs);
    if (recordDuration) {
      this.run[`${stage}Ms` as keyof SearchRunRecord] = durationMs as never;
    }
    if (this.activeStage === stage) this.activeStage = null;
    this.send({
      seq: ++this.seq,
      elapsedMs: this.elapsed(),
      type: "stage_completed",
      stage,
      status,
      durationMs,
      details,
    });
    this.estimateEvent();
  }

  result(payload: SimilarPayload): void {
    this.send({ seq: ++this.seq, elapsedMs: this.elapsed(), type: "result", ...payload });
  }

  error(): void {
    this.send({ seq: ++this.seq, elapsedMs: this.elapsed(), type: "error", error: "similar_search_failed" });
  }
}

async function runSimilarSearch(
  db: ReturnType<typeof getDb>,
  id: string,
  fresh: boolean,
  limit: number,
  emit?: Emit,
): Promise<SimilarPayload | null> {
  const tracker = new SearchTracker(emit, loadSearchRuns(db));
  tracker.started();
  try {
    // --- Enrichment (bounded; errors never break the flow) ---
    tracker.startStage("enrichment");
    let selected = { total: 0, transcribeCount: 0, samCount: 0 };
    let enrichDone = 0;
    let enrichFailed = 0;
    let enrichThrew = false;
    try {
      const out = await processPendingJobs(db, ENRICHMENT_JOB_LIMIT, {}, {
        onJobsSelected: (info) => {
          selected = info;
          tracker.run.enrichmentJobs = info.total;
          tracker.run.transcribeJobs = info.transcribeCount;
          tracker.run.samJobs = info.samCount;
          tracker.workloads.enrichmentJobs = info.total;
          tracker.progress("enrichment", 0, info.total, { ...info });
        },
        onJobFinished: (info) => {
          tracker.progress("enrichment", info.completed, info.total, {
            done: info.done,
            failed: info.failed,
            kind: info.kind,
            total: selected.total,
            transcribeCount: selected.transcribeCount,
            samCount: selected.samCount,
          });
        },
      });
      enrichDone = out.done;
      enrichFailed = out.failed;
    } catch {
      enrichThrew = true;
    }
    tracker.completeStage(
      "enrichment",
      enrichThrew || enrichFailed > 0 ? "degraded" : selected.total === 0 ? "skipped" : "done",
      {
        total: selected.total,
        transcribeCount: selected.transcribeCount,
        samCount: selected.samCount,
        done: enrichDone,
        failed: enrichFailed,
        pendingAfter: countPendingModelJobs(db),
      },
    );
    const pendingEnrichment = hasPendingEnrichment(db);

    // --- Dossiers for ALL cases (query excluded only from the candidate pool) ---
    const caseRows = db.prepare("SELECT id FROM cases").all() as { id: string }[];
    const beforeHashes = new Map<string, string>();
    try {
      for (const row of db.prepare("SELECT caseId, hash FROM case_dossiers").all() as { caseId: string; hash: string }[]) {
        beforeHashes.set(row.caseId, row.hash);
      }
    } catch {
      // No dossier table rows yet; everything counts as newly built.
    }
    tracker.run.dossierTotal = caseRows.length;
    tracker.workloads.dossierTotal = caseRows.length;
    tracker.startStage("dossiers", { total: caseRows.length });
    const dossiers: CaseDossier[] = [];
    let updated = 0;
    let cached = 0;
    let dossierFailed = 0;
    for (let i = 0; i < caseRows.length; i++) {
      const row = caseRows[i];
      try {
        const dossier = await buildDossier(db, row.id);
        dossiers.push(dossier);
        if (beforeHashes.get(row.id) === dossier.hash) cached++;
        else updated++;
      } catch {
        dossierFailed++;
      }
      tracker.progress("dossiers", i + 1, caseRows.length, {
        updated,
        cached,
        failed: dossierFailed,
      });
    }
    tracker.completeStage("dossiers", dossierFailed > 0 ? "degraded" : "done", {
      total: caseRows.length,
      updated,
      cached,
      failed: dossierFailed,
    });

    // --- Candidates ---
    tracker.startStage("candidates");
    const candidates = findCandidates(db, id, dossiers);
    tracker.run.candidateCount = candidates.length;
    const channelCounts: Details = { total: candidates.length, text: 0, location: 0, person: 0, object: 0, time: 0 };
    for (const c of candidates) {
      for (const ch of c.channels) {
        channelCounts[ch] = (channelCounts[ch] as number) + 1;
      }
    }
    tracker.completeStage("candidates", "done", channelCounts);

    // --- Scoring + verification ---
    let scoredAll: Awaited<ReturnType<typeof scoreCandidates>> = [];
    if (candidates.length === 0) {
      tracker.startStage("scoring");
      tracker.completeStage("scoring", "skipped", { total: 0 });
      tracker.startStage("verification");
      tracker.completeStage("verification", "skipped", { total: 0 });
    } else {
      tracker.startStage("scoring", { total: candidates.length });
      let finishInfo: Extract<ScoreProgressEvent, { type: "scoring_finished" }> | null = null;
      // Scoring is only closed once scoring_finished is known: a Spark
      // response that turns out malformed (parse/validation throws inside
      // scoreCandidates) must complete as degraded, never as done.
      let sparkReturnDurationMs: number | null = null;
      const onScoreProgress = (event: ScoreProgressEvent) => {
        if (event.type === "cache_checked") {
          tracker.run.cachedCount = event.cachedCount;
          tracker.run.sparkPendingCount = event.pendingCount;
          tracker.workloads.sparkPendingCount = event.pendingCount;
          tracker.progress("scoring", event.cachedCount, candidates.length, {
            cachedCount: event.cachedCount,
            pendingCount: event.pendingCount,
          });
        } else if (event.type === "spark_started") {
          tracker.run.imageCount = event.imageCount;
          tracker.progress("scoring", tracker.run.cachedCount, candidates.length, {
            cachedCount: tracker.run.cachedCount,
            pendingCount: event.pendingCount,
            imageCount: event.imageCount,
            sparkCalled: true,
          });
        } else if (event.type === "spark_returned") {
          sparkReturnDurationMs = tracker.elapsedInStage("scoring");
        } else if (event.type === "scoring_finished") {
          finishInfo = event;
        }
      };
      scoredAll = await scoreCandidates(db, id, candidates, undefined, onScoreProgress);
      const info = finishInfo as Extract<ScoreProgressEvent, { type: "scoring_finished" }> | null;
      const scoredCount = info?.scoredCount ?? scoredAll.filter((s) => s.score > 0).length;
      const unscoredCount = info?.unscoredCount ?? scoredAll.length - scoredCount;
      if (!info || !info.sparkCalled) {
        // Cache-only (or no pending): scoring already resolved from cache.
        tracker.completeStage("scoring", "done", {
          cachedCount: tracker.run.cachedCount,
          pendingCount: 0,
          sparkCalled: false,
        }, false);
        tracker.startStage("verification", { total: candidates.length });
        tracker.completeStage("verification", "done", {
          scoredCount,
          unscoredCount,
        });
      } else if (info.degraded) {
        tracker.completeStage("scoring", "degraded", {
          cachedCount: tracker.run.cachedCount,
          pendingCount: tracker.run.sparkPendingCount,
          imageCount: tracker.run.imageCount,
          sparkCalled: true,
          scoredCount,
          unscoredCount,
        }, false, sparkReturnDurationMs ?? undefined);
        tracker.startStage("verification");
        tracker.completeStage("verification", "skipped", {
          scoredCount,
          unscoredCount,
        });
      } else {
        const totalScoringMs = tracker.elapsedInStage("scoring");
        const sparkMs = sparkReturnDurationMs ?? totalScoringMs;
        tracker.completeStage("scoring", "done", {
          cachedCount: tracker.run.cachedCount,
          pendingCount: tracker.run.sparkPendingCount,
          imageCount: tracker.run.imageCount,
          sparkCalled: true,
        }, true, sparkMs);
        tracker.startStage("verification", { pendingCount: tracker.run.sparkPendingCount });
        tracker.completeStage("verification", "done", {
          scoredCount,
          unscoredCount,
        }, true, Math.max(0, totalScoringMs - sparkMs));
      }
    }

    const results = scoredAll.slice(0, limit);
    const payload: SimilarPayload = { results, fresh, limit, pendingEnrichment };
    db.prepare("UPDATE cases SET needsRerank = 0 WHERE id = ?").run(id);
    recordSearchRun(db, tracker.run);
    tracker.result(payload);
    return payload;
  } catch (err) {
    if (emit) {
      tracker.error();
      return null;
    }
    throw err;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb();
  const { id } = await params;
  const db = getDb();
  const queryRow = db
    .prepare("SELECT needsRerank FROM cases WHERE id = ?")
    .get(id) as { needsRerank: number } | undefined;
  if (!queryRow) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const fresh = !queryRow.needsRerank;
  const limit = similarResultLimit();
  const url = new URL(_req.url);
  if (url.searchParams.get("stream") === "1") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit: Emit = (event) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // Client disconnected: keep running the search to completion.
          }
        };
        await runSimilarSearch(db, id, fresh, limit, emit);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }
  const payload = await runSimilarSearch(db, id, fresh, limit);
  return NextResponse.json(payload);
}
