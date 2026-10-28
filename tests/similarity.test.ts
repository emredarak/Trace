import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, initDb, insertCase } from "../lib/db";
import { buildDossier } from "../lib/dossier";
import { scoreCandidates, SPARK_TIMEOUT_MS } from "../lib/similarity";
import type { CandidateMatch } from "../lib/candidates";

const noGlimmer = { summarize: async () => "ozet" };
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
    .run(id, caseId, "evidence", opts.title ?? "Delil", null, opts.imageFile, marking, new Date().toISOString());
  return id;
}

async function seedQueryAndCandidates() {
  const query = insertCase({
    summary: "gece market onunde bicakli saldiri beyaz arac kacti",
    crimeType: "yaralama",
    weapon: "bicak",
    mo: "gece yaklasma",
    occurredAt: "2026-01-15T22:30:00.000Z",
  });
  const a = insertCase({
    summary: "gece market onunde bicakli saldiri olayi",
    crimeType: "yaralama",
    weapon: "bicak",
    mo: "gece yaklasma",
    occurredAt: "2026-01-20T22:30:00.000Z",
  });
  const b = insertCase({
    summary: "gunduz parkta tabancali kavga",
    crimeType: "kavga",
    weapon: "tabanca",
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
  it("tek cagrida cok maddeli benzerlikleri aynen tasir; bilinmeyen/tekrarli elenir, puan ve guc 1-10 clamp'lenir, gecersiz tur duser", async () => {
    const { query, a, b, candidates } = await seedQueryAndCandidates();
    const spark = vi.fn(async (prompt: string, _images?: unknown) => {
      expect(prompt).toContain(query.summary);
      expect(prompt).toContain(a.summary);
      return JSON.stringify([
        {
          caseId: b.id,
          score: 4,
          reason: "zayif benzerlik",
          similarities: [
            { kind: "silah", description: "silah turu farkli ama alet var", strength: 3, evidence: "tabancali kavga" },
          ],
        },
        {
          caseId: a.id,
          score: 99,
          reason: "cok benzer",
          similarities: [
            { kind: "ozet", description: "ozetler neredeyse ayni", strength: 15, evidence: "bicakli saldiri" },
            { kind: "silah", description: "ikisi de bicak", strength: 0, evidence: "bicak" },
            { kind: "bilinmeyen-tur", description: "dusmali", strength: 5, evidence: "bicak" },
          ],
        },
        { caseId: "olmayan-vaka", score: 10, reason: "uydurma", similarities: [] },
        { caseId: a.id, score: 1, reason: "tekrar dusmeli", similarities: [] },
      ]);
    });

    const scored = await scoreCandidates(getDb(), query.id, candidates, spark);

    expect(spark).toHaveBeenCalledTimes(1);
    expect(scored.map((s) => s.caseId)).toEqual([a.id, b.id]);
    expect(scored[0]).toMatchObject({ caseId: a.id, caseNo: a.caseNo, score: 10, reason: "cok benzer" });
    expect(scored[0].similarities).toEqual([
      { kind: "ozet", description: "ozetler neredeyse ayni", strength: 10, evidence: "bicakli saldiri" },
      { kind: "silah", description: "ikisi de bicak", strength: 1, evidence: "bicak" },
    ]);
    expect(scored[1].score).toBe(4);
    expect(scored[1].caseNo).toBe(b.caseNo);
  });

  it("kaynak dosyada dogrulanamayan uydurma alintili maddeyi dusurur, dogrulanani korur", async () => {
    const { query, a, candidates } = await seedQueryAndCandidates();
    const spark = vi.fn(async () =>
      JSON.stringify([
        {
          caseId: a.id,
          score: 8,
          reason: "benzer",
          similarities: [
            { kind: "ozet", description: "gercek", strength: 8, evidence: "bicakli saldiri olayi" },
            { kind: "sorgu-ifadesi", description: "uydurma", strength: 9, evidence: "supheli mor ucakla kactigini soyledi" },
          ],
        },
      ]),
    );

    const scored = await scoreCandidates(getDb(), query.id, [candidates[0]], spark);

    expect(scored).toHaveLength(1);
    expect(scored[0].similarities).toEqual([
      { kind: "ozet", description: "gercek", strength: 8, evidence: "bicakli saldiri olayi" },
    ]);
  });

  it("bozuk JSON ve istemci hatasinda adaylar puansiz doner, kayip olmaz", async () => {
    const { query, a, b, candidates } = await seedQueryAndCandidates();

    const broken = vi.fn(async () => "bozuk yanit {{{");
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

  it("sonuclari hash'lerle similar_results'a yazar; ikinci cagri onbellekten gelir, Spark tekrar cagrilmaz; hash degisince yeniden cagrilir", async () => {
    const { query, a, candidates } = await seedQueryAndCandidates();
    const payload = JSON.stringify([
      {
        caseId: a.id,
        score: 7,
        reason: "benzer",
        similarities: [{ kind: "ozet", description: "ozet benzer", strength: 7, evidence: "bicakli saldiri" }],
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
    expect(row.reason).toBe("benzer");

    const second = await scoreCandidates(getDb(), query.id, [candidates[0]], spark);
    expect(spark).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    // Aday icerigi degisince hash degisir -> yeniden puanlanir.
    getDb().prepare("UPDATE cases SET summary = 'tamamen yeni ozet metni bicakli' WHERE id = ?").run(a.id);
    await buildDossier(getDb(), a.id, noGlimmer);
    const third = await scoreCandidates(getDb(), query.id, [candidates[0]], spark);
    expect(spark).toHaveBeenCalledTimes(2);
    expect(third[0].score).toBe(7);
  });

  it("modelin atladigi aday puansiz eklenir, listeden dusmez", async () => {
    const { query, a, b, candidates } = await seedQueryAndCandidates();
    const spark = vi.fn(async () =>
      JSON.stringify([{ caseId: a.id, score: 6, reason: "benzer", similarities: [] }]),
    );
    const scored = await scoreCandidates(getDb(), query.id, candidates, spark);
    expect(scored.map((s) => s.caseId)).toEqual([a.id, b.id]);
    expect(scored[1].score).toBe(0);
  });

  it("zaman asiminda puansiz doner; SPARK_TIMEOUT_MS varsayilani 120000", async () => {
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

  it("bos aday listesinde Spark cagrilmaz ve [] doner", async () => {
    const { query } = await seedQueryAndCandidates();
    const spark = vi.fn(async () => "[]");
    await expect(scoreCandidates(getDb(), query.id, [], spark)).resolves.toEqual([]);
    expect(spark).not.toHaveBeenCalled();
  });

  it("ortak SAM etiketli delillerden en fazla 3 gorsel ekler; diskte olmayan dosya atlanir, hata olmaz", async () => {
    uploadDirPath = join(tmpdir(), `similarity-uploads-${Date.now()}`);
    mkdirSync(uploadDirPath, { recursive: true });
    process.env.TRACE_UPLOAD_DIR = uploadDirPath;

    const query = insertCase({ summary: "sorgu essiz ozet alpha", crimeType: "yaralama" });
    const cand = insertCase({ summary: "aday essiz ozet beta", crimeType: "yaralama" });

    // Sorgu tarafi: ortak etiketli bir delil (gorseli var)
    writeFileSync(join(uploadDirPath, "q1.jpg"), Buffer.from([0xff, 0xd8, 0xff, 1]));
    addEvidenceWithImage(query.id, { labels: ["bicak"], imageFile: "q1.jpg" });
    // Aday tarafi: 4 ortak etiketli delil; ilki diskte yok, digerleri var
    addEvidenceWithImage(cand.id, { labels: ["bicak"], imageFile: "missing.jpg" });
    for (const name of ["c1.jpg", "c2.jpg", "c3.jpg"]) {
      writeFileSync(join(uploadDirPath, name), Buffer.from([0xff, 0xd8, 0xff, 2]));
      addEvidenceWithImage(cand.id, { labels: ["bicak"], imageFile: name });
    }

    await buildDossier(getDb(), query.id, noGlimmer);
    await buildDossier(getDb(), cand.id, noGlimmer);

    let seenImages: unknown;
    let seenPrompt = "";
    const spark = vi.fn(async (prompt: string, images?: unknown) => {
      seenPrompt = prompt;
      seenImages = images;
      return JSON.stringify([{ caseId: cand.id, score: 5, reason: "orta", similarities: [] }]);
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
    // Diskte olmayan missing.jpg eklenmemis (dataUrl'ler gercek dosyalardan)
    expect(seenPrompt).toContain("aday essiz ozet beta");
  });

  it("{chatCompletion} bicimindeki sahte istemciyi de kabul eder", async () => {
    const { query, a, candidates } = await seedQueryAndCandidates();
    const fake = {
      chatCompletion: vi.fn(async () =>
        JSON.stringify([{ caseId: a.id, score: 9, reason: "cok benzer", similarities: [] }]),
      ),
    };
    const scored = await scoreCandidates(getDb(), query.id, [candidates[0]], fake as never);
    expect(scored[0].score).toBe(9);
    expect(fake.chatCompletion).toHaveBeenCalledTimes(1);
  });
});
