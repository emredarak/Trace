import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb } from "../lib/db";
import { POST as createCase } from "../app/api/cases/route";
import {
  GET as listLocations,
  POST as addLocation,
} from "../app/api/cases/[id]/locations/route";
import {
  DELETE as deleteLocation,
  PATCH as patchLocation,
} from "../app/api/cases/[id]/locations/[locId]/route";
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

  it("boş gönderilen alan temizlenir (silme desteklenir)", async () => {
    const id = await makeCase();
    await patchCase(jsonReq("PATCH", { weapon: "levye" }), paramsOf(id));
    const res = await patchCase(jsonReq("PATCH", { weapon: "" }), paramsOf(id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { weapon: string | null };
    expect(body.weapon).toBeNull();
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
    ).json()) as Array<{ title: string; note: string | null; latitude: number }>;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("makbulün bulunduğu nokta");
  });

  it("yeni alanlarla konum eklenir; locationText not aliasıdır", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", {
        title: "Delil yeri",
        note: "kamera kaydı var",
        kind: "iliskili",
        priority: "kritik",
        latitude: 41.01,
        longitude: 28.97,
      }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.title).toBe("Delil yeri");
    expect(created.note).toBe("kamera kaydı var");
    expect(created.locationText).toBe("kamera kaydı var");
    expect(created.kind).toBe("iliskili");
    expect(created.priority).toBe("kritik");
    expect(created.latitude).toBe(41.01);
    expect(created.longitude).toBe(28.97);
    const list = (await (
      await listLocations(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      title: "Delil yeri",
      note: "kamera kaydı var",
      locationText: "kamera kaydı var",
      kind: "iliskili",
      priority: "kritik",
      latitude: 41.01,
      longitude: 28.97,
    });
  });

  it("eski gövde: note başlık, locationText not olur", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", { note: "maktulün yeri", locationText: "dere yatağı" }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.title).toBe("maktulün yeri");
    expect(created.note).toBe("dere yatağı");
    expect(created.locationText).toBe("dere yatağı");
  });

  it("yalnız başlıkla (koordinatsız) konum eklenir", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", { title: "Sadece yazılı yer" }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.title).toBe("Sadece yazılı yer");
    expect(created.kind).toBe("iliskili");
    expect(created.priority).toBeNull();
  });

  it("yalnız koordinatla konum eklenir; başlık Konum olur", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", { latitude: 41.01, longitude: 28.97 }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.title).toBe("Konum");
  });

  it("başlıksız ve koordinatsız istek 400 döner", async () => {
    const id = await makeCase();
    const res = await addLocation(jsonReq("POST", {}), paramsOf(id));
    expect(res.status).toBe(400);
  });

  it("note artık başlık sayılır (201); boş gövde 400 döner", async () => {
    const id = await makeCase();
    const res = await addLocation(jsonReq("POST", { note: "boş" }), paramsOf(id));
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.title).toBe("boş");
    const empty = await addLocation(jsonReq("POST", {}), paramsOf(id));
    expect(empty.status).toBe(400);
  });

  it("Olay Yeri'nde priority yok sayılır (null döner)", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", { title: "Olay yeri", kind: "olay-yeri", priority: "kritik" }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.kind).toBe("olay-yeri");
    expect(created.priority).toBeNull();
  });

  it("geçersiz kind/priority ve tek koordinat 400 döner", async () => {
    const id = await makeCase();
    expect(
      (await addLocation(jsonReq("POST", { title: "x", kind: "yakin" }), paramsOf(id))).status,
    ).toBe(400);
    expect(
      (await addLocation(jsonReq("POST", { title: "x", priority: "acil" }), paramsOf(id))).status,
    ).toBe(400);
    expect(
      (await addLocation(jsonReq("POST", { title: "x", latitude: 41.01 }), paramsOf(id))).status,
    ).toBe(400);
  });

  it("eski satır GET'te başlık Konum, tür iliskili döner", async () => {
    const id = await makeCase();
    getDb()
      .prepare(
        "INSERT INTO case_locations (id, caseId, note, locationText, latitude, longitude, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("eski-1", id, null, "eski metin", null, null, new Date().toISOString());
    const list = (await (
      await listLocations(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Konum");
    expect(list[0].kind).toBe("iliskili");
    // Eski veri taşınmaz: locationText note'a yükseltilmez, ikisi de null kalır.
    expect(list[0].note).toBeNull();
    expect(list[0].locationText).toBeNull();
  });

  it("PATCH konum günceller", async () => {
    const id = await makeCase();
    const created = (await (
      await addLocation(jsonReq("POST", { title: "eski başlık" }), paramsOf(id))
    ).json()) as { id: string };
    const res = await patchLocation(
      jsonReq("PATCH", {
        title: "yeni başlık",
        note: "yeni not",
        kind: "olay-yeri",
        priority: "kritik",
        latitude: 40.5,
        longitude: 29.5,
      }),
      locParamsOf(id, created.id),
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated).toMatchObject({
      id: created.id,
      caseId: id,
      title: "yeni başlık",
      note: "yeni not",
      locationText: "yeni not",
      kind: "olay-yeri",
      priority: null,
      latitude: 40.5,
      longitude: 29.5,
    });
    const list = (await (
      await listLocations(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as Array<Record<string, unknown>>;
    expect(list[0].title).toBe("yeni başlık");
  });

  it("PATCH yanlış vakaya ait konumda 404 döner", async () => {
    const id = await makeCase();
    const otherId = await makeCase("başka vaka");
    const created = (await (
      await addLocation(jsonReq("POST", { title: "yer" }), paramsOf(id))
    ).json()) as { id: string };
    const res = await patchLocation(
      jsonReq("PATCH", { title: "sızıntı" }),
      locParamsOf(otherId, created.id),
    );
    expect(res.status).toBe(404);
    const missing = await patchLocation(
      jsonReq("PATCH", { title: "x" }),
      locParamsOf(id, "yok"),
    );
    expect(missing.status).toBe(404);
  });

  it("PATCH geçersiz gövdede 400 döner", async () => {
    const id = await makeCase();
    const created = (await (
      await addLocation(jsonReq("POST", { title: "yer" }), paramsOf(id))
    ).json()) as { id: string };
    const res = await patchLocation(
      jsonReq("PATCH", { title: "x", kind: "yakin" }),
      locParamsOf(id, created.id),
    );
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

  it("POST istemci id'sini kullanır; tekrarı aynı satırı 200 döner, çoğaltmaz", async () => {
    const id = await makeCase();
    const body = { id: "istemci-1", title: "Çevrimdışı yer" };
    const first = await addLocation(jsonReq("POST", body), paramsOf(id));
    expect(first.status).toBe(201);
    expect(((await first.json()) as { id: string }).id).toBe("istemci-1");
    const dup = await addLocation(jsonReq("POST", body), paramsOf(id));
    expect(dup.status).toBe(200);
    expect(((await dup.json()) as { id: string }).id).toBe("istemci-1");
    const list = (await (
      await listLocations(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("POST başka vakaya ait istemci id'sinde 400 döner", async () => {
    const id = await makeCase();
    const otherId = await makeCase("başka vaka 2");
    await addLocation(
      jsonReq("POST", { id: "paylasilan", title: "yer" }),
      paramsOf(id),
    );
    const res = await addLocation(
      jsonReq("POST", { id: "paylasilan", title: "sızıntı" }),
      paramsOf(otherId),
    );
    expect(res.status).toBe(400);
  });

  it("bilinmeyen vakaya konum eklenemez", async () => {
    const res = await addLocation(
      jsonReq("POST", { locationText: "x" }),
      paramsOf("yok"),
    );
    expect(res.status).toBe(404);
  });
});

describe("vaka açarken konum ve tüm alanlar", () => {
  it("POST /api/cases konumları da kaydeder; GET tek vakada döner", async () => {
    const created = (await (
      await createCase(
        jsonReq("POST", {
          summary: "tam alanlı vaka",
          crimeType: "gasp",
          locationType: "su kenarı",
          mo: "gece arkadan yaklaşma",
          weapon: "bıçak",
          victimAge: 40,
          victimGender: "erkek",
          suspects: "bir kişi",
          witnesses: "bir tanık",
          locations: [
            {
              note: "maktulün bulunduğu nokta",
              locationText: "dere yatağı",
              latitude: 41.01,
              longitude: 28.97,
            },
          ],
        }),
      )
    ).json()) as { id: string };
    expect(created.id).toBeTruthy();
    const { GET: getCase } = await import("../app/api/cases/[id]/route");
    const body = (await (
      await getCase(new Request("http://localhost/x"), paramsOf(created.id))
    ).json()) as {
      crimeType: string;
      victimAge: number;
      locations: Array<{ title: string; note: string; latitude: number }>;
    };
    expect(body.crimeType).toBe("gasp");
    expect(body.victimAge).toBe(40);
    expect(body.locations).toHaveLength(1);
    expect(body.locations[0].title).toBe("maktulün bulunduğu nokta");
    expect(body.locations[0].note).toBe("dere yatağı");
  });

  it("bilinmeyen alan sessizce kaydedilmez (beyaz liste)", async () => {
    const created = (await (
      await createCase(
        jsonReq("POST", { summary: "v", gizliAlan: "sızıntı" }),
      )
    ).json()) as { id: string };
    const { GET: getCase } = await import("../app/api/cases/[id]/route");
    const body = (await (
      await getCase(new Request("http://localhost/x"), paramsOf(created.id))
    ).json()) as Record<string, unknown>;
    expect(body.gizliAlan).toBeUndefined();
  });
});
