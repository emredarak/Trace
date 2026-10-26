import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../lib/db";
import { POST as createCase } from "../app/api/cases/route";
import {
  GET as listLocations,
  POST as addLocation,
} from "../app/api/cases/[id]/locations/route";
import { DELETE as deleteLocation } from "../app/api/cases/[id]/locations/[locId]/route";
import { PATCH as patchCase } from "../app/api/cases/[id]/route";

function createBody(summary: string): Request {
  return new Request("http://localhost/api/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary }),
  });
}

async function makeCase(summary = "konumlu vaka"): Promise<string> {
  const body = (await (await createCase(createBody(summary))).json()) as {
    id: string;
  };
  return body.id;
}

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });
const locParamsOf = (id: string, locId: string) => ({
  params: Promise.resolve({ id, locId }),
});

function jsonReq(method: string, body: unknown): Request {
  return new Request("http://localhost/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("PATCH /api/cases/[id] alan düzenleme", () => {
  it("özet ve silah güncellenir, benzerlik bayrağı kalkar", async () => {
    const id = await makeCase();
    const res = await patchCase(
      jsonReq("PATCH", { summary: "yeni özet", weapon: "levye" }),
      paramsOf(id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: string;
      weapon: string;
      needsRerank: number | boolean;
    };
    expect(body.summary).toBe("yeni özet");
    expect(body.weapon).toBe("levye");
    expect(body.needsRerank ? true : false).toBe(true);
  });

  it("boş özet 400 döner", async () => {
    const id = await makeCase();
    const res = await patchCase(jsonReq("PATCH", { summary: "  " }), paramsOf(id));
    expect(res.status).toBe(400);
  });

  it("alan yoksa 400 döner", async () => {
    const id = await makeCase();
    const res = await patchCase(jsonReq("PATCH", {}), paramsOf(id));
    expect(res.status).toBe(400);
  });
});

describe("konum uçları", () => {
  it("notlu + koordinatlı konum eklenir ve listelenir", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", {
        note: "makbulün bulunduğu nokta",
        latitude: 41.01,
        longitude: 28.97,
      }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const list = (await (
      await listLocations(
        new Request("http://localhost/x"),
        paramsOf(id),
      )
    ).json()) as Array<{ note: string; latitude: number }>;
    expect(list).toHaveLength(1);
    expect(list[0].note).toBe("makbulün bulunduğu nokta");
  });

  it("konumsuz istek 400 döner", async () => {
    const id = await makeCase();
    const res = await addLocation(jsonReq("POST", { note: "boş" }), paramsOf(id));
    expect(res.status).toBe(400);
  });

  it("konum silinir", async () => {
    const id = await makeCase();
    const created = (await (
      await addLocation(
        jsonReq("POST", { locationText: "köprü altı" }),
        paramsOf(id),
      )
    ).json()) as { id: string };
    const del = await deleteLocation(
      new Request("http://localhost/x", { method: "DELETE" }),
      locParamsOf(id, created.id),
    );
    expect(del.status).toBe(200);
    const list = (await (
      await listLocations(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  it("bilinmeyen vakaya konum eklenemez", async () => {
    const res = await addLocation(
      jsonReq("POST", { locationText: "x" }),
      paramsOf("yok"),
    );
    expect(res.status).toBe(404);
  });
});
