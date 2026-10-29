import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, initDb, insertCase } from "../lib/db";
import { buildDossier } from "../lib/dossier";
import { scoreCandidates, SPARK_TIMEOUT_MS } from "../lib/similarity";
import type { CandidateMatch } from "../lib/candidates";

const noGlimmer = { summarize: async () => "summary" };
let uploadDirPath = "";

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  delete process.env.SPARK_TIMEOUT_MS;
  closeDb();
  initDb();
});

afterEach(() => {
  delete process.env.SPARK_TIMEOUT_MS;
  delete process.env.TRACE_UPLOAD_DIR;
});

let seq = 0;
function addEvidenceWithImage(
  caseId: string,
  opts: { labels: string[]; imageFile: string | null; title?: string },
) {
  seq += 1;
  const id = `ev-s${seq}`;
  const marking = JSON.stringify({
    boxes: opts.labels.map((label, i) => ({ x: 0.1 * i, y: 0.1, w: 0.2, h: 0.2, label })),
  });
  getDb()
    .prepare(
      "INSERT INTO evidences (id, caseId, type, title, note, imageFile, marking, createdAt) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(id, caseId, "evidence", opts.title ?? "Evidence", null, opts.imageFile, marking, new Date().toISOString());
  return id;
}

async function seedQueryAndCandidates() {
  const query = insertCase({
    summary: "night market knife attack, white car fled",
    crimeType: "assault",
    weapon: "knife",
    mo: "night approach",
    occurredAt: "2026-01-15T22:30:00.000Z",
  });
  const a = insertCase({
    summary: "night market knife attack incident",
    crimeType: "assault",
    weapon: "knife",
    mo: "night approach",
    occurredAt: "2026-01-20T22:30:00.000Z",
  });
  const b = insertCase({
    summary: "daytime park gunfight",
    crimeType: "fight",
    weapon: "pistol",
    occurredAt: "2025-01-01T10:00:00.000Z",
  });
  for (const id of [query.id, a.id, b.id]) {
    await buildDossier(getDb(), id, noGlimmer);
  }
  const candidates: CandidateMatch[] = [
    { caseId: a.id, channels: ["text"] },
    { caseId: b.id, channels: ["time"] },
  ];
  return { query, a, b, candidates };
}

describe("scoreCandidates", () => {
  it("passes multi-item similarities through in one call; unknown/duplicates dropped, score and strength clamped 1-10, invalid kinds dropped", async () => {
    const { query, a, b, candidates } = await seedQueryAndCandidates();
    const spark = vi.fn(async (prompt: string, _images?: unknown) => {
      expect(prompt).toContain(query.summary);
      expect(prompt).toContain(a.summary);
      return JSON.stringify([
        {
          caseId: b.id,
          score: 4,
          reason: "weak similarity",
          similarities: [
            { kind: "weapon", description: "different weapon type but still a weapon", strength: 3, evidence: "gunfight" },
          ],
        },
        {
          caseId: a.id,
          score: 99,
          reason: "very similar",
          similarities: [
            { kind: "summary", description: "summaries almost identical", strength: 15, evidence: "knife attack" },
            { kind: "weapon", description: "knife in both", strength: 0, evidence: "knife" },
            { kind: "unknown-kind", description: "should drop", strength: 5, evidence: "knife" },
          ],
        },
        { caseId: "nonexistent-case", score: 10, reason: "fabricated", similarities: [] },
        { caseId: a.id, score: 1, reason: "should drop duplicate", similarities: [] },
      ]);
    });

    const scored = await scoreCandidates(getDb(), query.id, candidates, spark);

    expect(spark).toHaveBeenCalledTimes(1);
    expect(scored.map((s) => s.caseId)).toEqual([a.id, b.id]);
    expect(scored[0]).toMatchObject({ caseId: a.id, caseNo: a.caseNo, score: 10, reason: "very similar" });
    expect(scored[0].similarities).toEqual([
      { kind: "summary", description: "summaries almost identical", strength: 10, evidence: "knife attack" },
      { kind: "weapon", description: "knife in both", strength: 1, evidence: "knife" },
    ]);
    expect(scored[1].score).toBe(4);
    expect(scored[1].caseNo).toBe(b.caseNo);
  });

  it("drops fabricated quote items unverifiable in the source file, keeps verified ones", async () => {
    const { query, a, candidates } = await seedQueryAndCandidates();
    const spark = vi.fn(async () =>
      JSON.stringify([
        {
          caseId: a.id,
          score: 8,
          reason: "similar",
          similarities: [
            { kind: "summary", description: "genuine", strength: 8, evidence: "knife attack incident" },
            { kind: "interview-quote", description: "fabricated", strength: 9, evidence: "the suspect said he fled in a purple plane" },
          ],
        },
      ]),
    );

    const scored = await scoreCandidates(getDb(), query.id, [candidates[0]], spark);

    expect(scored).toHaveLength(1);
    expect(scored[0].similarities).toEqual([
      { kind: "summary", description: "genuine", strength: 8, evidence: "knife attack incident" },
    ]);
  });

  it("expressions only in the Glimmer summary do not count as evidence; item dropped, source quote kept", async () => {
    const query = insertCase({
      summary: "night market knife attack, white car fled",
      crimeType: "assault",
      weapon: "knife",
    });
    const cand = insertCase({
      summary: "night market knife attack incident",
      crimeType: "assault",
      weapon: "knife",
    });
    // Candidate with transcript person: highlight is the source, Glimmer summary is not a source.
    const transcript = JSON.stringify({
      text: "suspect: I saw it at night",
      segments: [{ speaker: "suspect", text: "I saw it at night" }],
    });
    getDb()
      .prepare(
        "INSERT INTO case_persons (id, caseId, name, type, unidentified, transcript, createdAt) VALUES (?,?,?,?,?,?,?)",
      )
      .run("per-glimmer", cand.id, "Suspect A", "suspect", 0, transcript, new Date().toISOString());
    const GLIMMER_ONLY = "the suspect said he fled in a purple plane";
    const glimmer = {
      summarize: async () => `Summary: ${GLIMMER_ONLY}.`,
    };
    await buildDossier(getDb(), query.id, glimmer);
    await buildDossier(getDb(), cand.id, glimmer);

    const spark = vi.fn(async () =>
      JSON.stringify([
        {
          caseId: cand.id,
          score: 8,
          reason: "similar",
          similarities: [
            { kind: "interview-quote", description: "only in summary", strength: 9, evidence: GLIMMER_ONLY },
            { kind: "summary", description: "genuine source", strength: 8, evidence: "knife attack incident" },
          ],
        },
      ]),
    );

    const scored = await scoreCandidates(
      getDb(),
      query.id,
      [{ caseId: cand.id, channels: ["text"] }],
      spark,
    );
    expect(scored).toHaveLength(1);
    expect(scored[0].similarities).toEqual([
      { kind: "summary", description: "genuine source", strength: 8, evidence: "knife attack incident" },
    ]);
  });

  it("malformed JSON and client errors return unscored candidates, no loss", async () => {
    const { query, a, b, candidates } = await seedQueryAndCandidates();

    const broken = vi.fn(async () => "broken response {{{");
    const scoredBroken = await scoreCandidates(getDb(), query.id, candidates, broken);
    expect(scoredBroken.map((s) => s.caseId)).toEqual([a.id, b.id]);
    for (const s of scoredBroken) {
      expect(s.score).toBe(0);
      expect(s.similarities).toEqual([]);
      expect(s.caseNo).toBeTruthy();
      expect(s.reason.trim().length).toBeGreaterThan(0);
    }

    const failing = vi.fn(async () => {
      throw new Error("META_API_KEY is not set");
    });
    const scoredFail = await scoreCandidates(getDb(), query.id, candidates, failing);
    expect(scoredFail.map((s) => s.caseId)).toEqual([a.id, b.id]);
    expect(scoredFail.every((s) => s.score === 0)).toBe(true);
  });

  it("writes results with hashes to similar_results; second call served from cache, Spark not called again; re-scores when hashes change", async () => {
    const { query, a, candidates } = await seedQueryAndCandidates();
    const payload = JSON.stringify([
      {
        caseId: a.id,
        score: 7,
        reason: "similar",
        similarities: [{ kind: "summary", description: "similar summary", strength: 7, evidence: "knife attack" }],
      },
    ]);
    const spark = vi.fn(async () => payload);

    const first = await scoreCandidates(getDb(), query.id, [candidates[0]], spark);
    expect(spark).toHaveBeenCalledTimes(1);
    expect(first[0].score).toBe(7);

    const row = getDb()
      .prepare("SELECT * FROM similar_results WHERE queryId = ? AND candidateId = ?")
      .get(query.id, a.id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.score).toBe(7);
    expect(typeof row.queryHash).toBe("string");
    expect((row.queryHash as string).length).toBeGreaterThan(0);
    expect(typeof row.candidateHash).toBe("string");
    expect((row.candidateHash as string).length).toBeGreaterThan(0);
    expect(JSON.parse(row.similarities as string)).toEqual(first[0].similarities);
    expect(row.reason).toBe("similar");

    const second = await scoreCandidates(getDb(), query.id, [candidates[0]], spark);
    expect(spark).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    // Candidate content changed so the hash changed -> re-scored.
    getDb().prepare("UPDATE cases SET summary = 'completely new summary text with knife' WHERE id = ?").run(a.id);
    await buildDossier(getDb(), a.id, noGlimmer);
    const third = await scoreCandidates(getDb(), query.id, [candidates[0]], spark);
    expect(spark).toHaveBeenCalledTimes(2);
    expect(third[0].score).toBe(7);
  });

  it("candidates skipped by the model are added unscored, not dropped", async () => {
    const { query, a, b, candidates } = await seedQueryAndCandidates();
    const spark = vi.fn(async () =>
      JSON.stringify([{ caseId: a.id, score: 6, reason: "similar", similarities: [] }]),
    );
    const scored = await scoreCandidates(getDb(), query.id, candidates, spark);
    expect(scored.map((s) => s.caseId)).toEqual([a.id, b.id]);
    expect(scored[1].score).toBe(0);
  });

  it("returns unscored on timeout; SPARK_TIMEOUT_MS defaults to 120000", async () => {
    expect(SPARK_TIMEOUT_MS).toBe(120000);
    process.env.SPARK_TIMEOUT_MS = "20";
    const { query, a, b, candidates } = await seedQueryAndCandidates();
    const hanging = vi.fn(
      async () => new Promise<string>(() => {}),
    );
    const scored = await scoreCandidates(getDb(), query.id, candidates, hanging);
    expect(scored.map((s) => s.caseId)).toEqual([a.id, b.id]);
    expect(scored.every((s) => s.score === 0)).toBe(true);
  });

  it("does not call Spark for an empty candidate list and returns []", async () => {
    const { query } = await seedQueryAndCandidates();
    const spark = vi.fn(async () => "[]");
    await expect(scoreCandidates(getDb(), query.id, [], spark)).resolves.toEqual([]);
    expect(spark).not.toHaveBeenCalled();
  });

  it("attaches at most 3 images from shared SAM-labeled evidence; missing files on disk skipped, no error", async () => {
    uploadDirPath = join(tmpdir(), `similarity-uploads-${Date.now()}`);
    mkdirSync(uploadDirPath, { recursive: true });
    process.env.TRACE_UPLOAD_DIR = uploadDirPath;

    const query = insertCase({ summary: "query unique summary alpha", crimeType: "assault" });
    const cand = insertCase({ summary: "candidate unique summary beta", crimeType: "assault" });

    // Query side: one shared-label evidence (with image)
    writeFileSync(join(uploadDirPath, "q1.jpg"), Buffer.from([0xff, 0xd8, 0xff, 1]));
    addEvidenceWithImage(query.id, { labels: ["knife"], imageFile: "q1.jpg" });
    // Candidate side: 4 shared-label evidences; first missing on disk, rest present
    addEvidenceWithImage(cand.id, { labels: ["knife"], imageFile: "missing.jpg" });
    for (const name of ["c1.jpg", "c2.jpg", "c3.jpg"]) {
      writeFileSync(join(uploadDirPath, name), Buffer.from([0xff, 0xd8, 0xff, 2]));
      addEvidenceWithImage(cand.id, { labels: ["knife"], imageFile: name });
    }

    await buildDossier(getDb(), query.id, noGlimmer);
    await buildDossier(getDb(), cand.id, noGlimmer);

    let seenImages: unknown;
    let seenPrompt = "";
    const spark = vi.fn(async (prompt: string, images?: unknown) => {
      seenPrompt = prompt;
      seenImages = images;
      return JSON.stringify([{ caseId: cand.id, score: 5, reason: "medium", similarities: [] }]);
    });

    const scored = await scoreCandidates(
      getDb(),
      query.id,
      [{ caseId: cand.id, channels: ["object"] }],
      spark,
    );

    expect(scored).toHaveLength(1);
    expect(scored[0].score).toBe(5);
    expect(Array.isArray(seenImages)).toBe(true);
    const imgs = seenImages as Array<{ caseId: string; evidenceId: string; dataUrl: string }>;
    expect(imgs.length).toBeGreaterThanOrEqual(1);
    expect(imgs.length).toBeLessThanOrEqual(3);
    for (const img of imgs) {
      expect(img.dataUrl.startsWith("data:image/")).toBe(true);
      expect(img.evidenceId).toBeTruthy();
    }
    // missing.jpg on disk not added (dataUrls come from real files)
    expect(seenPrompt).toContain("candidate unique summary beta");
  });

  it("also accepts fake clients shaped as {chatCompletion}", async () => {
    const { query, a, candidates } = await seedQueryAndCandidates();
    const fake = {
      chatCompletion: vi.fn(async () =>
        JSON.stringify([{ caseId: a.id, score: 9, reason: "very similar", similarities: [] }]),
      ),
    };
    const scored = await scoreCandidates(getDb(), query.id, [candidates[0]], fake as never);
    expect(scored[0].score).toBe(9);
    expect(fake.chatCompletion).toHaveBeenCalledTimes(1);
  });

  it("reports progress events in order, and cache-only runs report no Spark call", async () => {
    const { query, a, candidates } = await seedQueryAndCandidates();
    const spark = vi.fn(async () =>
      JSON.stringify([{ caseId: a.id, score: 9, reason: "very similar", similarities: [] }]),
    );
    const events: { type: string }[] = [];
    const onProgress = (e: { type: string }) => events.push(e);

    await scoreCandidates(getDb(), query.id, [candidates[0]], spark, onProgress);
    expect(events.map((e) => e.type)).toEqual([
      "cache_checked",
      "spark_started",
      "spark_returned",
      "validation_started",
      "scoring_finished",
    ]);
    expect(events[0]).toMatchObject({ cachedCount: 0, pendingCount: 1 });
    expect(events[1]).toMatchObject({ pendingCount: 1, imageCount: 0 });
    expect(events[4]).toMatchObject({ scoredCount: 1, unscoredCount: 0, sparkCalled: true, degraded: false });

    events.length = 0;
    await scoreCandidates(getDb(), query.id, [candidates[0]], spark, onProgress);
    expect(events.map((e) => e.type)).toEqual(["cache_checked", "scoring_finished"]);
    expect(events[0]).toMatchObject({ cachedCount: 1, pendingCount: 0 });
    expect(events[1]).toMatchObject({ scoredCount: 1, unscoredCount: 0, sparkCalled: false, degraded: false });
  });

  it("reports a degraded finish when the model fails, keeping the unscored fallback", async () => {
    const { query, candidates } = await seedQueryAndCandidates();
    const failing = vi.fn(async () => {
      throw new Error("model down");
    });
    const events: { type: string }[] = [];
    const scored = await scoreCandidates(getDb(), query.id, [candidates[0]], failing, (e) =>
      events.push(e),
    );
    expect(scored).toHaveLength(1);
    expect(scored[0].score).toBe(0);
    const last = events[events.length - 1] as unknown as Record<string, unknown>;
    expect(last.type).toBe("scoring_finished");
    expect(last).toMatchObject({ sparkCalled: true, degraded: true, unscoredCount: 1 });
  });
});
