import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, enqueueJob, getDb, initDb } from "../lib/db";
import { POST as createCase, GET as listCases } from "../app/api/cases/route";
import { POST as addEntry } from "../app/api/cases/[id]/entries/route";
import { GET as getSimilar } from "../app/api/cases/[id]/similar/route";

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function similarParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function create(body: Record<string, unknown>): Promise<{ id: string; caseNo: string }> {
  const res = await createCase(postRequest("http://localhost/api/cases", body));
  expect(res.status).toBe(201);
  return res.json();
}

const QUERY = {
  summary: "su kenarında gece hırsızlık olayı",
  crimeType: "hırsızlık",
  locationType: "su kenarı",
  weapon: "bıçak",
  mo: "gece yaklaşma",
};

async function seedQueryPlusSix(): Promise<string> {
  const query = await create({ ...QUERY });
  for (let n = 1; n <= 6; n++) {
    await create({
      summary: `su kenarında gece vaka ${n}`,
      crimeType: "hırsızlık",
      locationType: "su kenarı",
      weapon: "bıçak",
      mo: "gece yaklaşma",
    });
  }
  return query.id;
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  delete process.env.META_API_KEY;
  delete process.env.LLAMA_API_KEY;
  delete process.env.BASETEN_API_KEY;
  delete process.env.SIMILAR_RESULT_LIMIT;
  closeDb();
  initDb();
});

describe("GET /api/cases/[id]/similar", () => {
  it("benzerlik isteği 5 sonuç döndürür", async () => {
    const id = await seedQueryPlusSix();
    const res = await getSimilar(new Request(`http://localhost/api/cases/${id}/similar`), similarParams(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(5);
    expect(body.limit).toBe(5);
    for (const r of body.results) {
      expect(typeof r.caseId).toBe("string");
      expect(r.caseId).not.toBe(id);
      expect(typeof r.caseNo).toBe("string");
      expect(r.caseNo).toMatch(/^TR-\d+$/);
      expect(r.caseNo).not.toBe(r.caseId);
      expect(typeof r.score).toBe("number");
      expect(typeof r.reason).toBe("string");
      expect(Array.isArray(r.similarities)).toBe(true);
      for (const s of r.similarities) {
        expect(typeof s.kind).toBe("string");
        expect(typeof s.description).toBe("string");
        expect(typeof s.strength).toBe("number");
        expect(typeof s.evidence).toBe("string");
      }
    }
    expect(typeof body.fresh).toBe("boolean");
  });

  it("SIMILAR_RESULT_LIMIT sonucu ve limit alanını sınırlar", async () => {
    const id = await seedQueryPlusSix();
    process.env.SIMILAR_RESULT_LIMIT = "2";
    const res = await getSimilar(new Request(`http://localhost/api/cases/${id}/similar`), similarParams(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(2);
    expect(body.results).toHaveLength(2);
  });

  it("kapalı vaka aday havuzundadır", async () => {
    const query = await create({ ...QUERY });
    const candidate = await create({
      summary: "su kenarında gece hırsızlık kapalı vaka",
      crimeType: "hırsızlık",
      locationType: "su kenarı",
      weapon: "bıçak",
      mo: "gece yaklaşma",
    });
    getDb().prepare("UPDATE cases SET status = 'closed' WHERE id = ?").run(candidate.id);
    const res = await getSimilar(new Request(`http://localhost/api/cases/${query.id}/similar`), similarParams(query.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.results.find((r: { caseId: string }) => r.caseId === candidate.id);
    expect(found).toBeTruthy();
    expect(found.caseNo).toBe(candidate.caseNo);
  });

  it("önceden dosyası (dossier) olmayan vaka metin (FTS) kanalıyla aday olur", async () => {
    const query = await create({ ...QUERY });
    const candidate = await create({
      summary: "su kenarında gece hırsızlık dosyasız vaka",
      crimeType: "hırsızlık",
      locationType: "su kenarı",
      weapon: "bıçak",
      mo: "gece yaklaşma",
    });
    // Hiçbir vaka için önceden dossier derlenmedi.
    const before = getDb().prepare("SELECT COUNT(*) AS n FROM case_dossiers").get() as { n: number };
    expect(before.n).toBe(0);
    const res = await getSimilar(new Request(`http://localhost/api/cases/${query.id}/similar`), similarParams(query.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.map((r: { caseId: string }) => r.caseId)).toContain(candidate.id);
  });

  it("bekleyen zenginleştirme işi sınırlı çalıştırılır ve pendingEnrichment bildirilir", async () => {
    const query = await create({ ...QUERY });
    const jobId = enqueueJob(getDb(), { caseId: query.id, kind: "transcribe", refId: "olmayan-kayit" });
    const res = await getSimilar(new Request(`http://localhost/api/cases/${query.id}/similar`), similarParams(query.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingEnrichment).toBe(true);
    // İş denendi (başarısız, yeniden denenebilir) — kayıt/iş kaybolmadı.
    const job = getDb().prepare("SELECT status, attempts FROM enrichment_jobs WHERE id = ?").get(jobId) as { status: string; attempts: number };
    expect(job.attempts).toBe(1);
    expect(job.status).toBe("failed");
  });

  it("yeni delil eklenince needsRerank true olur, benzerlik bakılınca temizlenir", async () => {
    const created = await create({ summary: "rozetsiz vaka" });

    let list = await (await listCases()).json();
    expect(list.find((c: { id: string }) => c.id === created.id).needsRerank).toBe(true);

    // Bayrağı sıfırla: benzerlik bakıldı say.
    getDb().prepare("UPDATE cases SET needsRerank = 0 WHERE id = ?").run(created.id);

    const entryRes = await addEntry(
      postRequest(`http://localhost/api/cases/${created.id}/entries`, { type: "note", note: "yeni delil" }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(entryRes.status).toBe(201);

    list = await (await listCases()).json();
    expect(list.find((c: { id: string }) => c.id === created.id).needsRerank).toBe(true);

    const stale = await (
      await getSimilar(
        new Request(`http://localhost/api/cases/${created.id}/similar`),
        similarParams(created.id),
      )
    ).json();
    expect(stale.fresh).toBe(false);

    const fresh = await (
      await getSimilar(
        new Request(`http://localhost/api/cases/${created.id}/similar`),
        similarParams(created.id),
      )
    ).json();
    expect(fresh.fresh).toBe(true);
  });

  it("benzer yoksa [] döner, hata değil", async () => {
    const created = await create({ summary: "zxqwv kpjbn tek vaka" });
    const res = await getSimilar(
      new Request(`http://localhost/api/cases/${created.id}/similar`),
      similarParams(created.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(typeof body.fresh).toBe("boolean");
  });

  it("olmayan kayda 404 döner", async () => {
    const res = await getSimilar(
      new Request("http://localhost/api/cases/yok/similar"),
      similarParams("yok"),
    );
    expect(res.status).toBe(404);
  });
});
