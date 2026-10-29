// Recorded stage timings for similar-case searches, plus the estimator that
// turns that history into an honest remaining-time range.
//
// Privacy: a run stores only stage durations and workload counts. No case id,
// no case content, no names ever enter this table or the progress events.
//
// Estimate rules (design doc): a range (median..p90 of past clean samples),
// never a single number; hidden until at least 20 completed runs and at
// least 5 clean samples per remaining stage exist. Only stages that finished
// "done" contribute durations — skipped/degraded durations are recorded as
// null and excluded so timeouts never pollute the distribution.

import type Database from "better-sqlite3";

export type StageKey =
  | "enrichment"
  | "dossiers"
  | "candidates"
  | "scoring"
  | "verification";

export type StageStatus = "pending" | "active" | "done" | "skipped" | "degraded";

export const STAGE_ORDER: StageKey[] = [
  "enrichment",
  "dossiers",
  "candidates",
  "scoring",
  "verification",
];

/** NDJSON progress events streamed by GET /api/cases/[id]/similar?stream=1. */
export type SearchProgressEvent =
  | { seq: number; elapsedMs: number; type: "started" }
  | {
      seq: number;
      elapsedMs: number;
      type: "stage_started";
      stage: StageKey;
      details?: Record<string, number | string | boolean>;
    }
  | {
      seq: number;
      elapsedMs: number;
      type: "stage_progress";
      stage: StageKey;
      completed: number;
      total: number;
      details?: Record<string, number | string | boolean>;
    }
  | {
      seq: number;
      elapsedMs: number;
      type: "stage_completed";
      stage: StageKey;
      status: "done" | "skipped" | "degraded";
      durationMs: number;
      details?: Record<string, number | string | boolean>;
    }
  | {
      seq: number;
      elapsedMs: number;
      type: "estimate";
      estimate: { lowMs: number; highMs: number; sampleCount: number } | null;
    }
  | {
      seq: number;
      elapsedMs: number;
      type: "result";
      results: unknown[];
      fresh: boolean;
      limit: number;
      pendingEnrichment: boolean;
    }
  | { seq: number; elapsedMs: number; type: "error"; error: string };

export interface SearchRunRecord {
  enrichmentMs: number | null;
  dossiersMs: number | null;
  candidatesMs: number | null;
  scoringMs: number | null;
  verificationMs: number | null;
  enrichmentJobs: number;
  transcribeJobs: number;
  samJobs: number;
  dossierTotal: number;
  candidateCount: number;
  cachedCount: number;
  sparkPendingCount: number;
  imageCount: number;
  outcome: "result";
}

const DURATION_KEY: Record<StageKey, keyof SearchRunRecord> = {
  enrichment: "enrichmentMs",
  dossiers: "dossiersMs",
  candidates: "candidatesMs",
  scoring: "scoringMs",
  verification: "verificationMs",
};

const MAX_STORED_RUNS = 500;
export const MIN_RUNS_FOR_ESTIMATE = 20;
export const MIN_STAGE_SAMPLES = 5;

export function recordSearchRun(db: Database.Database, run: SearchRunRecord): void {
  try {
    db.prepare(
      `INSERT INTO similar_search_runs
        (enrichmentMs, dossiersMs, candidatesMs, scoringMs, verificationMs,
         enrichmentJobs, transcribeJobs, samJobs, dossierTotal, candidateCount,
         cachedCount, sparkPendingCount, imageCount, outcome, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.enrichmentMs,
      run.dossiersMs,
      run.candidatesMs,
      run.scoringMs,
      run.verificationMs,
      run.enrichmentJobs,
      run.transcribeJobs,
      run.samJobs,
      run.dossierTotal,
      run.candidateCount,
      run.cachedCount,
      run.sparkPendingCount,
      run.imageCount,
      run.outcome,
      new Date().toISOString(),
    );
    db.prepare(
      `DELETE FROM similar_search_runs
       WHERE id NOT IN (SELECT id FROM similar_search_runs ORDER BY id DESC LIMIT ?)`,
    ).run(MAX_STORED_RUNS);
  } catch {
    // A failed timing write must never break a search.
  }
}

export function loadSearchRuns(db: Database.Database, limit = MAX_STORED_RUNS): SearchRunRecord[] {
  try {
    const rows = db
      .prepare(
        `SELECT enrichmentMs, dossiersMs, candidatesMs, scoringMs, verificationMs,
                enrichmentJobs, transcribeJobs, samJobs, dossierTotal, candidateCount,
                cachedCount, sparkPendingCount, imageCount, outcome
         FROM similar_search_runs ORDER BY id DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.floor(limit))) as Record<string, unknown>[];
    return rows.map((r) => ({
      enrichmentMs: numOrNull(r.enrichmentMs),
      dossiersMs: numOrNull(r.dossiersMs),
      candidatesMs: numOrNull(r.candidatesMs),
      scoringMs: numOrNull(r.scoringMs),
      verificationMs: numOrNull(r.verificationMs),
      enrichmentJobs: numOrZero(r.enrichmentJobs),
      transcribeJobs: numOrZero(r.transcribeJobs),
      samJobs: numOrZero(r.samJobs),
      dossierTotal: numOrZero(r.dossierTotal),
      candidateCount: numOrZero(r.candidateCount),
      cachedCount: numOrZero(r.cachedCount),
      sparkPendingCount: numOrZero(r.sparkPendingCount),
      imageCount: numOrZero(r.imageCount),
      outcome: "result",
    }));
  } catch {
    return [];
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function numOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export interface EstimateState {
  stage: StageKey;
  stageElapsedMs: number;
  /** Stages after `stage` that have not started yet. */
  remainingStages: StageKey[];
  workloads: {
    enrichmentJobs?: number;
    dossierTotal?: number;
    sparkPendingCount?: number;
  };
}

export interface Estimate {
  lowMs: number;
  highMs: number;
  sampleCount: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function sparkBucket(n: number): number {
  if (n <= 0) return 0;
  if (n <= 3) return 1;
  if (n <= 7) return 2;
  return 3;
}

function stageSamples(
  runs: SearchRunRecord[],
  stage: StageKey,
  workloads: EstimateState["workloads"],
): number[] {
  const key = DURATION_KEY[stage];
  const values = (list: SearchRunRecord[]): number[] =>
    list
      .map((r) => r[key] as number | null)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);

  let conditioned: SearchRunRecord[] | null = null;
  if (stage === "enrichment" && workloads.enrichmentJobs !== undefined) {
    conditioned = runs.filter((r) => r.enrichmentJobs === workloads.enrichmentJobs);
  } else if (stage === "dossiers" && workloads.dossierTotal !== undefined) {
    conditioned = runs.filter((r) => r.dossierTotal === workloads.dossierTotal);
  } else if (stage === "scoring" && workloads.sparkPendingCount !== undefined) {
    const bucket = sparkBucket(workloads.sparkPendingCount);
    conditioned = runs.filter((r) => sparkBucket(r.sparkPendingCount) === bucket);
  }
  if (conditioned) {
    const vals = values(conditioned);
    if (vals.length >= MIN_STAGE_SAMPLES) return vals.sort((a, b) => a - b);
  }
  return values(runs).sort((a, b) => a - b);
}

export function estimateRemaining(runs: SearchRunRecord[], state: EstimateState): Estimate | null {
  if (!Array.isArray(runs) || runs.length < MIN_RUNS_FOR_ESTIMATE) return null;
  let low = 0;
  let high = 0;
  const stages: { stage: StageKey; running: boolean }[] = [
    { stage: state.stage, running: true },
    ...state.remainingStages.map((stage) => ({ stage, running: false })),
  ];
  for (const { stage, running } of stages) {
    const samples = stageSamples(runs, stage, state.workloads);
    if (samples.length < MIN_STAGE_SAMPLES) return null;
    const median = percentile(samples, 50);
    const p90 = percentile(samples, 90);
    if (running) {
      low += Math.max(0, median - state.stageElapsedMs);
      high += Math.max(0, p90 - state.stageElapsedMs);
    } else {
      low += median;
      high += p90;
    }
  }
  return { lowMs: Math.round(low), highMs: Math.round(Math.max(high, low)), sampleCount: runs.length };
}
