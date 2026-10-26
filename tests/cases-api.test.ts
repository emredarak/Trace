import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../lib/db";
import { GET as listCases, POST as createCase } from "../app/api/cases/route";
import { POST as addEntry } from "../app/api/cases/[id]/entries/route";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("POST /api/cases", () => {
  it("kayıt özetle 201 ve { id, caseNo } döner", async () => {
    const res = await createCase(postRequest({ summary: "gece hırsızlık" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.caseNo).toMatch(/^TR-\d{4}$/);
  });

  it("özetsiz kayıt 400 döner", async () => {
    for (const bad of [{}, { summary: "" }, { summary: "   " }]) {
      const res = await createCase(postRequest(bad));
      expect(res.status).toBe(400);
    }
  });

  it("caseNo otomatik artar (TR-0001, TR-0002)", async () => {
    const first = await (
      await createCase(postRequest({ summary: "a" }))
    ).json();
    const second = await (
      await createCase(postRequest({ summary: "b" }))
    ).json();
    expect(first.caseNo).toBe("TR-0001");
    expect(second.caseNo).toBe("TR-0002");
  });

  it("GPS olmadan konum metni yeterlidir", async () => {
    const res = await createCase(
      postRequest({ summary: "olay", locationText: "çarşı meydanı" }),
    );
    expect(res.status).toBe(201);
  });
});

describe("GET /api/cases", () => {
  it("kayıtları CaseRecord[] olarak döner", async () => {
    await createCase(postRequest({ summary: "kayıtlı vaka" }));
    const res = await listCases();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].summary).toBe("kayıtlı vaka");
    expect(body[0].caseNo).toBe("TR-0001");
  });
});

describe("POST /api/cases/[id]/entries", () => {
  it("delil ekleme 201 döner ve kayda yansır", async () => {
    const created = await (
      await createCase(postRequest({ summary: "delilli vaka" }))
    ).json();

    const res = await addEntry(
      postRequest({ type: "note", note: "kısa not" }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(201);
    const entry = await res.json();
    expect(entry.caseId).toBe(created.id);
    expect(entry.type).toBe("note");

    const list = await (await listCases()).json();
    const record = list.find(
      (c: { id: string }) => c.id === created.id,
    ) as { entries: { type: string; note: string }[] };
    expect(record.entries).toHaveLength(1);
    expect(record.entries[0]).toMatchObject({
      type: "note",
      note: "kısa not",
    });
  });

  it("olmayan kayda ekleme 404 döner", async () => {
    const res = await addEntry(postRequest({ type: "note" }), {
      params: Promise.resolve({ id: "yok" }),
    });
    expect(res.status).toBe(404);
  });

  it("türsüz ekleme 400 döner", async () => {
    const created = await (
      await createCase(postRequest({ summary: "vaka" }))
    ).json();
    const res = await addEntry(postRequest({ note: "türsüz" }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(400);
  });
});
