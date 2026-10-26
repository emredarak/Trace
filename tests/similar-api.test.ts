import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb } from "../lib/db";
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
    for (const r of body.results) {
      expect(typeof r.caseId).toBe("string");
      expect(r.caseId).not.toBe(id);
      expect(typeof r.score).toBe("number");
      expect(typeof r.reason).toBe("string");
      expect(typeof r.quote).toBe("string");
      expect(Array.isArray(r.matchedFields)).toBe(true);
    }
    expect(typeof body.fresh).toBe("boolean");
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
