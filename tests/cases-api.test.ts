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
  it("creates with summary returning 201 and { id, caseNo }", async () => {
    const res = await createCase(postRequest({ summary: "night theft" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.caseNo).toMatch(/^TR-\d{4}$/);
  });

  it("returns 400 without a summary", async () => {
    for (const bad of [{}, { summary: "" }, { summary: "   " }]) {
      const res = await createCase(postRequest(bad));
      expect(res.status).toBe(400);
    }
  });

  it("auto-increments caseNo (TR-0001, TR-0002)", async () => {
    const first = await (
      await createCase(postRequest({ summary: "a" }))
    ).json();
    const second = await (
      await createCase(postRequest({ summary: "b" }))
    ).json();
    expect(first.caseNo).toBe("TR-0001");
    expect(second.caseNo).toBe("TR-0002");
  });

  it("duplicate person ids return 400 and case count is unchanged", async () => {
    const before = await (await listCases()).json();
    const res = await createCase(
      postRequest({
        summary: "case with duplicate person",
        persons: [
          { id: "m1", name: "Victim", type: "victim" },
          { id: "m1", name: "Other", type: "witness" },
        ],
      }),
    );
    expect(res.status).toBe(400);
    const after = await (await listCases()).json();
    expect(after).toHaveLength(before.length);
  });

  it("person id from another case returns 400 and case count is unchanged (rollback)", async () => {
    const first = await createCase(
      postRequest({
        summary: "first case",
        persons: [{ id: "m1", name: "Victim", type: "victim" }],
      }),
    );
    expect(first.status).toBe(201);
    const before = await (await listCases()).json();
    const res = await createCase(
      postRequest({
        summary: "second case",
        locations: [{ title: "Location", note: "note" }],
        persons: [{ id: "m1", name: "Conflicting", type: "victim" }],
      }),
    );
    expect(res.status).toBe(400);
    const after = await (await listCases()).json();
    expect(after).toHaveLength(before.length);
    expect(after).toHaveLength(1);
  });

  it("location text suffices without GPS", async () => {
    const res = await createCase(
      postRequest({ summary: "incident", locationText: "bazaar square" }),
    );
    expect(res.status).toBe(201);
  });
});

describe("GET /api/cases", () => {
  it("returns records as CaseRecord[]", async () => {
    await createCase(postRequest({ summary: "registered case" }));
    const res = await listCases();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].summary).toBe("registered case");
    expect(body[0].caseNo).toBe("TR-0001");
  });
});

describe("POST /api/cases/[id]/entries", () => {
  it("adding evidence returns 201 and is reflected in the record", async () => {
    const created = await (
      await createCase(postRequest({ summary: "case with evidence" }))
    ).json();

    const res = await addEntry(
      postRequest({ type: "note", note: "short note" }),
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
      note: "short note",
    });
  });

  it("returns 404 when adding to a missing record", async () => {
    const res = await addEntry(postRequest({ type: "note" }), {
      params: Promise.resolve({ id: "yok" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when adding without a type", async () => {
    const created = await (
      await createCase(postRequest({ summary: "case" }))
    ).json();
    const res = await addEntry(postRequest({ note: "typeless" }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(400);
  });
});
