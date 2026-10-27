import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../lib/db";
import { POST as createCase } from "../app/api/cases/route";
import { GET as getCase } from "../app/api/cases/[id]/route";
import {
  GET as listPersons,
  POST as addPerson,
} from "../app/api/cases/[id]/persons/route";
import {
  DELETE as deletePerson,
  PATCH as patchPerson,
} from "../app/api/cases/[id]/persons/[personId]/route";

function jsonReq(method: string, body: unknown): Request {
  return new Request("http://localhost/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });
const personParamsOf = (id: string, personId: string) => ({
  params: Promise.resolve({ id, personId }),
});

async function makeCase(summary = "kişili vaka"): Promise<string> {
  const body = (await (
    await createCase(
      jsonReq("POST", { summary }),
    )
  ).json()) as { id: string };
  return body.id;
}

async function add(caseId: string, person: Record<string, unknown>) {
  const res = await addPerson(jsonReq("POST", person), paramsOf(caseId));
  return { res, body: (await res.json()) as Record<string, unknown> };
}

async function list(caseId: string) {
  const res = await listPersons(new Request("http://localhost/x"), paramsOf(caseId));
  expect(res.status).toBe(200);
  return (await res.json()) as Array<Record<string, unknown>>;
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("kişi uçları", () => {
  it("(a) kişi POST 201 ve detay GET'te persons içinde döner", async () => {
    const id = await makeCase();
    const { res, body } = await add(id, {
      name: "Ayşe Yılmaz",
      age: 34,
      gender: "kadın",
      note: "not",
      type: "maktul",
      contactStatus: "ulasildi",
    });
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      caseId: id,
      name: "Ayşe Yılmaz",
      age: 34,
      gender: "kadın",
      note: "not",
      type: "maktul",
      relatedVictimId: null,
      relationship: null,
      unidentified: false,
      contactStatus: "ulasildi",
    });
    expect(typeof body.id).toBe("string");
    expect(typeof body.createdAt).toBe("string");

    const detail = (await (
      await getCase(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as { persons: Array<Record<string, unknown>> };
    expect(detail.persons).toHaveLength(1);
    expect(detail.persons[0]).toMatchObject({ name: "Ayşe Yılmaz", type: "maktul" });
    expect(await list(id)).toHaveLength(1);
  });

  it("(b) tanık aynı vakadaki maktüle ilişkiyle eklenir; başka vakaya/maktül olmayana ilişki 400", async () => {
    const id = await makeCase();
    const otherId = await makeCase("başka vaka");
    const victim = (await add(id, { name: "Maktul A", type: "maktul" })).body;
    const otherVictim = (await add(otherId, { name: "Maktul B", type: "maktul" })).body;
    const witness0 = (await add(id, { name: "Tanık Sıfır", type: "tanik" })).body;

    const ok = await add(id, {
      name: "Tanık A",
      type: "tanik",
      relatedVictimId: victim.id,
      relationship: "eşi",
    });
    expect(ok.res.status).toBe(201);
    expect(ok.body.relatedVictimId).toBe(victim.id);
    expect(ok.body.relationship).toBe("eşi");

    const crossCase = await add(id, {
      name: "Tanık B",
      type: "tanik",
      relatedVictimId: otherVictim.id,
      relationship: "eşi",
    });
    expect(crossCase.res.status).toBe(400);

    const notVictim = await add(id, {
      name: "Tanık C",
      type: "supheli",
      relatedVictimId: witness0.id,
      relationship: "arkadaşı",
    });
    expect(notVictim.res.status).toBe(400);

    const missing = await add(id, {
      name: "Tanık D",
      type: "tanik",
      relatedVictimId: "yok",
    });
    expect(missing.res.status).toBe(400);
  });

  it("(c) maktüle ilişki gönderilirse null saklanır", async () => {
    const id = await makeCase();
    const victim = (await add(id, { name: "Maktul A", type: "maktul" })).body;
    const second = await add(id, {
      name: "Maktul B",
      type: "maktul",
      relatedVictimId: victim.id,
      relationship: "kardeşi",
    });
    expect(second.res.status).toBe(201);
    expect(second.body.relatedVictimId).toBeNull();
    expect(second.body.relationship).toBeNull();
  });

  it("(d) istemci kimliği benimsenir, tekrar POST aynı satırı döner, başka vaka kimliği 400", async () => {
    const id = await makeCase();
    const otherId = await makeCase("başka vaka 2");
    const payload = { id: "istemci-kisi-1", name: "Çevrimdışı Kişi", type: "tanik" };
    const first = await add(id, payload);
    expect(first.res.status).toBe(201);
    expect(first.body.id).toBe("istemci-kisi-1");

    const dup = await add(id, payload);
    expect(dup.res.status).toBe(200);
    expect(dup.body.id).toBe("istemci-kisi-1");
    expect(await list(id)).toHaveLength(1);

    const cross = await add(otherId, payload);
    expect(cross.res.status).toBe(400);
  });

  it("(e) PATCH alanları günceller; maktülün tipi değişince bağlı tanığın ilişkisi temizlenir", async () => {
    const id = await makeCase();
    const victim = (await add(id, { name: "Maktul A", type: "maktul" })).body;
    const witness = (
      await add(id, {
        name: "Tanık A",
        type: "tanik",
        relatedVictimId: victim.id,
        relationship: "komşusu",
      })
    ).body;

    const patchRes = await patchPerson(
      jsonReq("PATCH", {
        name: "Tanık Yeni",
        age: 41,
        gender: "erkek",
        note: "güncel not",
        type: "supheli",
        relatedVictimId: victim.id,
        relationship: "komşusu",
        unidentified: false,
        contactStatus: "ulasilamadi",
      }),
      personParamsOf(id, String(witness.id)),
    );
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toMatchObject({
      name: "Tanık Yeni",
      age: 41,
      gender: "erkek",
      note: "güncel not",
      type: "supheli",
      relatedVictimId: victim.id,
      relationship: "komşusu",
      contactStatus: "ulasilamadi",
    });

    const typeRes = await patchPerson(
      jsonReq("PATCH", { name: "Maktul A", type: "tanik" }),
      personParamsOf(id, String(victim.id)),
    );
    expect(typeRes.status).toBe(200);
    expect((await typeRes.json()) as Record<string, unknown>).toMatchObject({ type: "tanik" });

    const persons = await list(id);
    const updatedWitness = persons.find((p) => p.id === witness.id);
    expect(updatedWitness?.relatedVictimId).toBeNull();
    expect(updatedWitness?.relationship).toBeNull();
  });

  it("PATCH başka vakadaki maktüle ilişki 400 döner; bilinmeyen kişi 404", async () => {
    const id = await makeCase();
    const otherId = await makeCase("başka vaka 3");
    const otherVictim = (await add(otherId, { name: "Maktul B", type: "maktul" })).body;
    const witness = (await add(id, { name: "Tanık A", type: "tanik" })).body;
    const res = await patchPerson(
      jsonReq("PATCH", {
        name: "Tanık A",
        type: "tanik",
        relatedVictimId: otherVictim.id,
      }),
      personParamsOf(id, String(witness.id)),
    );
    expect(res.status).toBe(400);
    const missing = await patchPerson(
      jsonReq("PATCH", { name: "X", type: "tanik" }),
      personParamsOf(id, "yok"),
    );
    expect(missing.status).toBe(404);
  });

  it("(f) DELETE maktülü siler, bağlı tanık durur ve ilişki alanları boştur", async () => {
    const id = await makeCase();
    const victim = (await add(id, { name: "Maktul A", type: "maktul" })).body;
    const witness = (
      await add(id, {
        name: "Tanık A",
        type: "tanik",
        relatedVictimId: victim.id,
        relationship: "eşi",
      })
    ).body;
    const del = await deletePerson(
      new Request("http://localhost/x", { method: "DELETE" }),
      personParamsOf(id, String(victim.id)),
    );
    expect(del.status).toBe(200);
    const persons = await list(id);
    expect(persons).toHaveLength(1);
    expect(persons[0].id).toBe(witness.id);
    expect(persons[0].relatedVictimId).toBeNull();
    expect(persons[0].relationship).toBeNull();

    const missing = await deletePerson(
      new Request("http://localhost/x", { method: "DELETE" }),
      personParamsOf(id, "yok"),
    );
    expect(missing.status).toBe(404);
  });

  it("(g) işaretsiz boş ad 400, işaretli boş ad 201", async () => {
    const id = await makeCase();
    const unnamed = await add(id, { name: "", type: "maktul" });
    expect(unnamed.res.status).toBe(400);
    const unidentified = await add(id, { name: "", type: "maktul", unidentified: true });
    expect(unidentified.res.status).toBe(201);
    expect(unidentified.body.name).toBeNull();
    expect(unidentified.body.unidentified).toBe(true);
  });

  it("bilinmeyen vakaya kişi eklenemez ve liste 404 döner", async () => {
    const res = await addPerson(
      jsonReq("POST", { name: "X", type: "tanik" }),
      paramsOf("yok"),
    );
    expect(res.status).toBe(404);
    const listRes = await listPersons(new Request("http://localhost/x"), paramsOf("yok"));
    expect(listRes.status).toBe(404);
  });
});

describe("vaka açarken kişiler", () => {
  it("(h) persons dizisi (istemci kimlikli ilişki dahil) kaydedilir", async () => {
    const created = (await (
      await createCase(
        jsonReq("POST", {
          summary: "kişilerle açılan vaka",
          persons: [
            { id: "kisi-tanik", name: "Tanık Önce", type: "tanik", relatedVictimId: "kisi-maktul", relationship: "eşi" },
            { id: "kisi-maktul", name: "Maktul Sonra", type: "maktul" },
          ],
        }),
      )
    ).json()) as { id: string };
    expect(created.id).toBeTruthy();
    const detail = (await (
      await getCase(new Request("http://localhost/x"), paramsOf(created.id))
    ).json()) as { persons: Array<Record<string, unknown>> };
    expect(detail.persons).toHaveLength(2);
    const witness = detail.persons.find((p) => p.id === "kisi-tanik");
    expect(witness).toMatchObject({
      relatedVictimId: "kisi-maktul",
      relationship: "eşi",
      type: "tanik",
    });
  });
});
