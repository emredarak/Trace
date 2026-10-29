import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb } from "../lib/db";
import {
  estimateRemaining,
  loadSearchRuns,
  recordSearchRun,
  type SearchRunRecord,
} from "../lib/search-estimate";

function makeRun(overrides: Partial<SearchRunRecord> = {}): SearchRunRecord {
  return {
    enrichmentMs: 1000,
    dossiersMs: 1000,
    candidatesMs: 1000,
    scoringMs: 1000,
    verificationMs: 1000,
    enrichmentJobs: 0,
    transcribeJobs: 0,
    samJobs: 0,
    dossierTotal: 3,
    candidateCount: 2,
    cachedCount: 0,
    sparkPendingCount: 2,
    imageCount: 0,
    outcome: "result",
    ...overrides,
  };
}

function runs(n: number, overrides: Partial<SearchRunRecord> = {}): SearchRunRecord[] {
  return Array.from({ length: n }, () => makeRun(overrides));
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("estimateRemaining", () => {
  it("returns null with fewer than 20 completed runs", () => {
    expect(
      estimateRemaining(runs(19), {
        stage: "candidates",
        stageElapsedMs: 0,
        remainingStages: ["scoring"],
        workloads: {},
      }),
    ).toBeNull();
  });

  it("returns null when a remaining stage has fewer than 5 clean samples", () => {
    const history = [
      ...runs(16, { verificationMs: null }),
      ...runs(4, { verificationMs: 2000 }),
    ];
    expect(
      estimateRemaining(history, {
        stage: "scoring",
        stageElapsedMs: 0,
        remainingStages: ["verification"],
        workloads: {},
      }),
    ).toBeNull();
  });

  it("excludes skipped/degraded (null) durations from stage samples", () => {
    const history = [
      ...runs(15, { scoringMs: null }),
      ...runs(5, { scoringMs: 10_000 }),
    ];
    const estimate = estimateRemaining(history, {
      stage: "candidates",
      stageElapsedMs: 1000,
      remainingStages: ["scoring"],
      workloads: { sparkPendingCount: 2 },
    });
    expect(estimate).not.toBeNull();
    expect(estimate!.lowMs).toBe(10_000);
    expect(estimate!.highMs).toBe(10_000);
  });

  it("uses the spark pending-count bucket once the workload is known", () => {
    const history = [
      ...runs(15, { sparkPendingCount: 1, scoringMs: 1000 }),
      ...runs(5, { sparkPendingCount: 6, scoringMs: 60_000 }),
    ];
    const estimate = estimateRemaining(history, {
      stage: "scoring",
      stageElapsedMs: 10_000,
      remainingStages: [],
      workloads: { sparkPendingCount: 6 },
    });
    expect(estimate).not.toBeNull();
    expect(estimate!.lowMs).toBe(50_000);
    expect(estimate!.highMs).toBe(50_000);
  });

  it("floors the running stage residual at zero instead of going negative", () => {
    const estimate = estimateRemaining(runs(20, { scoringMs: 1000 }), {
      stage: "scoring",
      stageElapsedMs: 999_999,
      remainingStages: [],
      workloads: { sparkPendingCount: 2 },
    });
    expect(estimate).not.toBeNull();
    expect(estimate!.lowMs).toBe(0);
    expect(estimate!.highMs).toBe(0);
  });

  it("sums median and p90 across the running and remaining stages", () => {
    const history = runs(20, { dossiersMs: 2000, candidatesMs: 500, scoringMs: 4000 });
    const estimate = estimateRemaining(history, {
      stage: "dossiers",
      stageElapsedMs: 500,
      remainingStages: ["candidates", "scoring"],
      workloads: { dossierTotal: 3, sparkPendingCount: 2 },
    });
    expect(estimate).not.toBeNull();
    // dossiers residual 1500 + candidates 500 + scoring 4000
    expect(estimate!.lowMs).toBe(6000);
    expect(estimate!.sampleCount).toBe(20);
  });
});

describe("search run storage", () => {
  it("round-trips a recorded run and prunes to the newest 500", () => {
    const db = getDb();
    recordSearchRun(db, makeRun({ scoringMs: 1234 }));
    const loaded = loadSearchRuns(db);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].scoringMs).toBe(1234);
    expect(loaded[0].outcome).toBe("result");

    for (let i = 0; i < 505; i++) recordSearchRun(db, makeRun({ scoringMs: i }));
    expect(loadSearchRuns(db, 600)).toHaveLength(500);
  });

  it("never throws when the runs table is unavailable", () => {
    const db = getDb();
    db.exec("DROP TABLE IF EXISTS similar_search_runs");
    expect(() => recordSearchRun(db, makeRun())).not.toThrow();
    expect(loadSearchRuns(db)).toEqual([]);
  });
});
