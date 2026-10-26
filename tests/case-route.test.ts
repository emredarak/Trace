import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../lib/db";
import { POST as createCase } from "../app/api/cases/route";
import {
  GET as getCase,
  PATCH as patchCase,
} from "../app/api/cases/[id]/route";

function req(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/cases/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("GET /api/cases/[id]", () => {
  it("kayıtlı vakayı delilleriyle döndürür", async () => {
    const created = (await (
      await createCase(
        new Request("http://localhost/api/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary: "tek vaka" }),
        }),
      )
    ).json()) as { id: string };
    const res = await getCase(req("GET"), paramsOf(created.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.entries).toEqual([]);
  });

  it("bilinmeyen vakada 404 döner", async () => {
    const res = await getCase(req("GET"), paramsOf("yok"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/cases/[id]", () => {
  it("durumu closed yapar", async () => {
    const created = (await (
      await createCase(
        new Request("http://localhost/api/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary: "kapatılacak" }),
        }),
      )
    ).json()) as { id: string };
    const res = await patchCase(req("PATCH", { status: "closed" }), paramsOf(created.id));
    expect(res.status).toBe(200);
    const check = (await (
      await getCase(req("GET"), paramsOf(created.id))
    ).json()) as { status: string };
    expect(check.status).toBe("closed");
  });

  it("geçersiz durumda 400 döner", async () => {
    const created = (await (
      await createCase(
        new Request("http://localhost/api/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary: "v" }),
        }),
      )
    ).json()) as { id: string };
    const res = await patchCase(req("PATCH", { status: "arsiv" }), paramsOf(created.id));
    expect(res.status).toBe(400);
  });

  it("bilinmeyen vakada 404 döner", async () => {
    const res = await patchCase(req("PATCH", { status: "closed" }), paramsOf("yok"));
    expect(res.status).toBe(404);
  });
});
