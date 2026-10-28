import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb } from "../lib/db";
import { POST as createCase } from "../app/api/cases/route";
import {
  POST as approveLink,
  DELETE as removeLink,
} from "../app/api/cases/[id]/links/route";

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function linkParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function create(summary: string): Promise<{ id: string; caseNo: string }> {
  const res = await createCase(postRequest("http://localhost/api/cases", { summary }));
  expect(res.status).toBe(201);
  return res.json();
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("POST /api/cases/[id]/links", () => {
  it("approval returns 201", async () => {
    const a = await create("first case");
    const b = await create("second case");
    const res = await approveLink(
      postRequest(`http://localhost/api/cases/${a.id}/links`, { targetId: b.id }),
      linkParams(a.id),
    );
    expect(res.status).toBe(201);
    const rows = getDb()
      .prepare("SELECT * FROM case_links WHERE sourceId = ? AND targetId = ?")
      .all(a.id, b.id);
    expect(rows).toHaveLength(1);
  });

  it("repeat approval leaves a single record", async () => {
    const a = await create("first case");
    const b = await create("second case");
    const url = `http://localhost/api/cases/${a.id}/links`;
    const first = await approveLink(postRequest(url, { targetId: b.id }), linkParams(a.id));
    const second = await approveLink(postRequest(url, { targetId: b.id }), linkParams(a.id));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const rows = getDb()
      .prepare("SELECT * FROM case_links WHERE sourceId = ? AND targetId = ?")
      .all(a.id, b.id);
    expect(rows).toHaveLength(1);
  });

  it("approval without a target returns 400", async () => {
    const a = await create("first case");
    const res = await approveLink(
      postRequest(`http://localhost/api/cases/${a.id}/links`, {}),
      linkParams(a.id),
    );
    expect(res.status).toBe(400);
  });

  it("approval for a missing record returns 404", async () => {
    const b = await create("second case");
    const res = await approveLink(
      postRequest("http://localhost/api/cases/yok/links", { targetId: b.id }),
      linkParams("yok"),
    );
    expect(res.status).toBe(404);
    const missingTarget = await approveLink(
      postRequest(`http://localhost/api/cases/${b.id}/links`, { targetId: "yok" }),
      linkParams(b.id),
    );
    expect(missingTarget.status).toBe(404);
  });
});

describe("DELETE /api/cases/[id]/links", () => {
  it("removal drops the approval", async () => {
    const a = await create("first case");
    const b = await create("second case");
    const url = `http://localhost/api/cases/${a.id}/links`;
    await approveLink(postRequest(url, { targetId: b.id }), linkParams(a.id));
    const res = await removeLink(
      deleteRequest(url, { targetId: b.id }),
      linkParams(a.id),
    );
    expect(res.status).toBe(200);
    const rows = getDb()
      .prepare("SELECT * FROM case_links WHERE sourceId = ? AND targetId = ?")
      .all(a.id, b.id);
    expect(rows).toHaveLength(0);
  });
});
