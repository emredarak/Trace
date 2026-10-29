import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, enqueueJob, getDb, initDb, insertCase } from "../lib/db";

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("case database", () => {
  it("creates cases, evidences and case_fts tables", () => {
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('cases', 'evidences', 'case_fts') ORDER BY name",
      )
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual([
      "case_fts",
      "cases",
      "evidences",
    ]);
  });

  it("saves a minimal CaseInput with only summary and auto-generates caseNo/createdAt", () => {
    const rec = insertCase({ summary: "x" });
    expect(rec.summary).toBe("x");
    expect(rec.id).toBeTruthy();
    expect(rec.caseNo).toMatch(/^TR-\d{4}$/);
    expect(rec.createdAt).toBeTruthy();
  });

  it("increments caseNo sequentially", () => {
    const a = insertCase({ summary: "a" });
    const b = insertCase({ summary: "b" });
    expect(a.caseNo).toBe("TR-0001");
    expect(b.caseNo).toBe("TR-0002");
  });

  it("rejects input without a non-empty summary", () => {
    expect(() => insertCase({} as never)).toThrow();
    expect(() => insertCase({ summary: "" })).toThrow();
    expect(() => insertCase({ summary: "   " })).toThrow();
  });

  it("stores optional schema fields", () => {
    const rec = insertCase({
      summary: "waterfront incident",
      crimeType: "homicide",
      locationType: "waterfront",
      weapon: "knife",
      mo: "night approach",
    });
    expect(rec.crimeType).toBe("homicide");
    expect(rec.locationType).toBe("waterfront");
    expect(rec.weapon).toBe("knife");
    expect(rec.mo).toBe("night approach");
  });

  it("indexes searchable fields in case_fts", () => {
    insertCase({
      summary: "waterfront sharp-object incident",
      crimeType: "homicide",
      locationType: "waterfront",
      weapon: "knife",
      mo: "night approach",
    });
    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM case_fts WHERE case_fts MATCH 'knife'")
      .get() as { n: number };
    expect(row.n).toBe(1);
  });

  it("writes location title/kind/priority and mirrors note into locationText", () => {
    const rec = insertCase({
      summary: "case with location",
      locations: [
        {
          title: "Incident house",
          note: "door forced",
          kind: "crime-scene",
          priority: "critical",
          latitude: 41.01,
          longitude: 28.97,
        },
        { locationText: "under the bridge" },
      ],
    });
    initDb();
    const rows = getDb()
      .prepare(
        "SELECT title, note, locationText, kind, priority FROM case_locations WHERE caseId = ? ORDER BY rowid ASC",
      )
      .all(rec.id) as Record<string, unknown>[];
    expect(rows).toEqual([
      {
        title: "Incident house",
        note: "door forced",
        locationText: "door forced",
        kind: "crime-scene",
        priority: null,
      },
      {
        title: "under the bridge",
        note: null,
        locationText: null,
        kind: "related",
        priority: null,
      },
    ]);
  });

  it("creates case_dossiers, enrichment_jobs and similar_results tables with expected columns", () => {
    const db = getDb();
    const columns = (table: string) =>
      (
        db.prepare(`PRAGMA table_info(${table})`).all() as {
          name: string;
          pk: number;
        }[]
      ).map((c) => [c.name, c.pk]);
    expect(columns("case_dossiers")).toEqual([
      ["caseId", 1],
      ["version", 0],
      ["hash", 0],
      ["json", 0],
      ["updatedAt", 0],
    ]);
    expect(columns("enrichment_jobs")).toEqual([
      ["id", 1],
      ["caseId", 0],
      ["kind", 0],
      ["refId", 0],
      ["status", 0],
      ["attempts", 0],
      ["lastError", 0],
      ["createdAt", 0],
      ["updatedAt", 0],
    ]);
    expect(columns("similar_results")).toEqual([
      ["queryId", 1],
      ["candidateId", 2],
      ["score", 0],
      ["similarities", 0],
      ["reason", 0],
      ["queryHash", 0],
      ["candidateHash", 0],
      ["model", 0],
      ["createdAt", 0],
    ]);
    expect(columns("similar_search_runs")).toEqual([
      ["id", 1],
      ["enrichmentMs", 0],
      ["dossiersMs", 0],
      ["candidatesMs", 0],
      ["scoringMs", 0],
      ["verificationMs", 0],
      ["enrichmentJobs", 0],
      ["transcribeJobs", 0],
      ["samJobs", 0],
      ["dossierTotal", 0],
      ["candidateCount", 0],
      ["cachedCount", 0],
      ["sparkPendingCount", 0],
      ["imageCount", 0],
      ["outcome", 0],
      ["createdAt", 0],
    ]);
  });

  it("stores dossier and similar result rows keyed by case", () => {
    const db = getDb();
    const a = insertCase({ summary: "query case" });
    const b = insertCase({ summary: "candidate case" });
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO case_dossiers (caseId, version, hash, json, updatedAt) VALUES (?, ?, ?, ?, ?)",
    ).run(a.id, 1, "hash-a", "{}", now);
    expect(() =>
      db
        .prepare(
          "INSERT INTO case_dossiers (caseId, version, hash, json, updatedAt) VALUES (?, ?, ?, ?, ?)",
        )
        .run(a.id, 2, "hash-a2", "{}", now),
    ).toThrow();
    db.prepare(
      "INSERT INTO similar_results (queryId, candidateId, score, similarities, reason, queryHash, candidateHash, model, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(a.id, b.id, 8, "[]", "similar", "qh", "ch", "spark", now);
    const row = db
      .prepare(
        "SELECT queryId, candidateId, score FROM similar_results WHERE queryId = ?",
      )
      .get(a.id);
    expect(row).toEqual({ queryId: a.id, candidateId: b.id, score: 8 });
    expect(() =>
      db
        .prepare(
          "INSERT INTO similar_results (queryId, candidateId, score, similarities, reason, queryHash, candidateHash, model, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(a.id, b.id, 5, "[]", "duplicate", "qh", "ch", "spark", now),
    ).toThrow();
  });

  it("rejects invalid enrichment job kind and status", () => {
    const db = getDb();
    const rec = insertCase({ summary: "job case" });
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          "INSERT INTO enrichment_jobs (id, caseId, kind, refId, status, attempts, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run("j1", rec.id, "bogus", "r1", "pending", 0, now, now),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO enrichment_jobs (id, caseId, kind, refId, status, attempts, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run("j2", rec.id, "transcribe", "r1", "bogus", 0, now, now),
    ).toThrow();
  });

  it("enqueueJob creates a pending job with defaults and returns its id", () => {
    const db = getDb();
    const rec = insertCase({ summary: "queue case" });
    const id = enqueueJob(db, {
      caseId: rec.id,
      kind: "transcribe",
      refId: "person-1",
    });
    expect(id).toBeTruthy();
    const row = db
      .prepare("SELECT * FROM enrichment_jobs WHERE id = ?")
      .get(id);
    expect(row).toMatchObject({
      id,
      caseId: rec.id,
      kind: "transcribe",
      refId: "person-1",
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    expect((row as { createdAt: string }).createdAt).toBeTruthy();
    expect((row as { updatedAt: string }).updatedAt).toBeTruthy();
  });

  it("enqueueJob does not open a second pending job for same kind and refId", () => {
    const db = getDb();
    const rec = insertCase({ summary: "single job case" });
    const first = enqueueJob(db, {
      caseId: rec.id,
      kind: "sam",
      refId: "evidence-1",
    });
    const second = enqueueJob(db, {
      caseId: rec.id,
      kind: "sam",
      refId: "evidence-1",
    });
    expect(second).toBe(first);
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM enrichment_jobs")
      .get() as { n: number };
    expect(row.n).toBe(1);
    expect(
      enqueueJob(db, { caseId: rec.id, kind: "sam", refId: "evidence-2" }),
    ).not.toBe(first);
    expect(
      enqueueJob(db, {
        caseId: rec.id,
        kind: "transcribe",
        refId: "evidence-1",
      }),
    ).not.toBe(first);
  });

  it("enqueueJob dedupes refId-less dossier jobs while pending", () => {
    const db = getDb();
    const rec = insertCase({ summary: "dossier case" });
    const first = enqueueJob(db, { caseId: rec.id, kind: "dossier" });
    expect(enqueueJob(db, { caseId: rec.id, kind: "dossier" })).toBe(first);
  });

  it("enqueueJob opens a new job after previous one is done or failed", () => {
    const db = getDb();
    const rec = insertCase({ summary: "retry case" });
    const first = enqueueJob(db, {
      caseId: rec.id,
      kind: "transcribe",
      refId: "person-9",
    });
    db.prepare("UPDATE enrichment_jobs SET status = 'done' WHERE id = ?").run(
      first,
    );
    const second = enqueueJob(db, {
      caseId: rec.id,
      kind: "transcribe",
      refId: "person-9",
    });
    expect(second).not.toBe(first);
    db.prepare(
      "UPDATE enrichment_jobs SET status = 'failed' WHERE id = ?",
    ).run(second);
    const third = enqueueJob(db, {
      caseId: rec.id,
      kind: "transcribe",
      refId: "person-9",
    });
    expect(third).not.toBe(second);
  });

  it("links evidence rows to their case", () => {
    const db = getDb();
    const rec = insertCase({ summary: "case with evidence" });
    db.prepare(
      "INSERT INTO evidences (id, caseId, type, note, createdAt) VALUES (?, ?, ?, ?, ?)",
    ).run("ev-1", rec.id, "note", "short note", rec.createdAt);
    const row = db
      .prepare("SELECT caseId, type FROM evidences WHERE id = 'ev-1'")
      .get() as { caseId: string; type: string };
    expect(row).toEqual({ caseId: rec.id, type: "note" });
  });
});
