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

async function makeCase(summary = "case with person"): Promise<string> {
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

describe("person endpoints", () => {
  it("(a) person POST 201 and appears in detail GET inside persons", async () => {
    const id = await makeCase();
    const { res, body } = await add(id, {
      name: "Alice Johnson",
      age: 34,
      gender: "female",
      note: "note",
      type: "victim",
      contactStatus: "reached",
    });
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      caseId: id,
      name: "Alice Johnson",
      age: 34,
      gender: "female",
      note: "note",
      type: "victim",
      relatedVictimId: null,
      relationship: null,
      unidentified: false,
      contactStatus: "reached",
    });
    expect(typeof body.id).toBe("string");
    expect(typeof body.createdAt).toBe("string");

    const detail = (await (
      await getCase(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as { persons: Array<Record<string, unknown>> };
    expect(detail.persons).toHaveLength(1);
    expect(detail.persons[0]).toMatchObject({ name: "Alice Johnson", type: "victim" });
    expect(await list(id)).toHaveLength(1);
  });

  it("(b) witness added with relation to same-case victim; other-case/non-victim relation 400", async () => {
    const id = await makeCase();
    const otherId = await makeCase("other case");
    const victim = (await add(id, { name: "Victim A", type: "victim" })).body;
    const otherVictim = (await add(otherId, { name: "Victim B", type: "victim" })).body;
    const witness0 = (await add(id, { name: "Witness Zero", type: "witness" })).body;

    const ok = await add(id, {
      name: "Witness A",
      type: "witness",
      relatedVictimId: victim.id,
      relationship: "spouse",
    });
    expect(ok.res.status).toBe(201);
    expect(ok.body.relatedVictimId).toBe(victim.id);
    expect(ok.body.relationship).toBe("spouse");

    const crossCase = await add(id, {
      name: "Witness B",
      type: "witness",
      relatedVictimId: otherVictim.id,
      relationship: "spouse",
    });
    expect(crossCase.res.status).toBe(400);

    const notVictim = await add(id, {
      name: "Witness C",
      type: "suspect",
      relatedVictimId: witness0.id,
      relationship: "friend",
    });
    expect(notVictim.res.status).toBe(400);

    const missing = await add(id, {
      name: "Witness D",
      type: "witness",
      relatedVictimId: "missing",
    });
    expect(missing.res.status).toBe(400);
  });

  it("(c) relation sent to a victim is stored as null", async () => {
    const id = await makeCase();
    const victim = (await add(id, { name: "Victim A", type: "victim" })).body;
    const second = await add(id, {
      name: "Victim B",
      type: "victim",
      relatedVictimId: victim.id,
      relationship: "sibling",
    });
    expect(second.res.status).toBe(201);
    expect(second.body.relatedVictimId).toBeNull();
    expect(second.body.relationship).toBeNull();
  });

  it("(d) client identity adopted, repeat POST returns same row, other-case identity 400", async () => {
    const id = await makeCase();
    const otherId = await makeCase("other case 2");
    const payload = { id: "client-person-1", name: "Offline Person", type: "witness" };
    const first = await add(id, payload);
    expect(first.res.status).toBe(201);
    expect(first.body.id).toBe("client-person-1");

    const dup = await add(id, payload);
    expect(dup.res.status).toBe(200);
    expect(dup.body.id).toBe("client-person-1");
    expect(await list(id)).toHaveLength(1);

    const cross = await add(otherId, payload);
    expect(cross.res.status).toBe(400);
  });

  it("(e) PATCH updates fields; changing the victim type clears the linked witness relation", async () => {
    const id = await makeCase();
    const victim = (await add(id, { name: "Victim A", type: "victim" })).body;
    const witness = (
      await add(id, {
        name: "Witness A",
        type: "witness",
        relatedVictimId: victim.id,
        relationship: "neighbor",
      })
    ).body;

    const patchRes = await patchPerson(
      jsonReq("PATCH", {
        name: "New Witness",
        age: 41,
        gender: "male",
        note: "updated note",
        type: "suspect",
        relatedVictimId: victim.id,
        relationship: "neighbor",
        unidentified: false,
        contactStatus: "unreached",
      }),
      personParamsOf(id, String(witness.id)),
    );
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toMatchObject({
      name: "New Witness",
      age: 41,
      gender: "male",
      note: "updated note",
      type: "suspect",
      relatedVictimId: victim.id,
      relationship: "neighbor",
      contactStatus: "unreached",
    });

    const typeRes = await patchPerson(
      jsonReq("PATCH", { name: "Victim A", type: "witness" }),
      personParamsOf(id, String(victim.id)),
    );
    expect(typeRes.status).toBe(200);
    expect((await typeRes.json()) as Record<string, unknown>).toMatchObject({ type: "witness" });

    const persons = await list(id);
    const updatedWitness = persons.find((p) => p.id === witness.id);
    expect(updatedWitness?.relatedVictimId).toBeNull();
    expect(updatedWitness?.relationship).toBeNull();
  });

  it("PATCH relation to another-case victim returns 400; unknown person 404", async () => {
    const id = await makeCase();
    const otherId = await makeCase("other case 3");
    const otherVictim = (await add(otherId, { name: "Victim B", type: "victim" })).body;
    const witness = (await add(id, { name: "Witness A", type: "witness" })).body;
    const res = await patchPerson(
      jsonReq("PATCH", {
        name: "Witness A",
        type: "witness",
        relatedVictimId: otherVictim.id,
      }),
      personParamsOf(id, String(witness.id)),
    );
    expect(res.status).toBe(400);
    const missing = await patchPerson(
      jsonReq("PATCH", { name: "X", type: "witness" }),
      personParamsOf(id, "missing"),
    );
    expect(missing.status).toBe(404);
  });

  it("(f) DELETE removes the victim, linked witness stays with empty relation fields", async () => {
    const id = await makeCase();
    const victim = (await add(id, { name: "Victim A", type: "victim" })).body;
    const witness = (
      await add(id, {
        name: "Witness A",
        type: "witness",
        relatedVictimId: victim.id,
        relationship: "spouse",
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
      personParamsOf(id, "missing"),
    );
    expect(missing.status).toBe(404);
  });

  it("(g) unchecked empty name 400, checked empty name 201", async () => {
    const id = await makeCase();
    const unnamed = await add(id, { name: "", type: "victim" });
    expect(unnamed.res.status).toBe(400);
    const unidentified = await add(id, { name: "", type: "victim", unidentified: true });
    expect(unidentified.res.status).toBe(201);
    expect(unidentified.body.name).toBeNull();
    expect(unidentified.body.unidentified).toBe(true);
  });

  it("cannot add a person to an unknown case and list returns 404", async () => {
    const res = await addPerson(
      jsonReq("POST", { name: "X", type: "witness" }),
      paramsOf("missing"),
    );
    expect(res.status).toBe(404);
    const listRes = await listPersons(new Request("http://localhost/x"), paramsOf("missing"));
    expect(listRes.status).toBe(404);
  });
});

describe("opening a case with persons", () => {
  it("(h) persons array (including client-id relation) is saved", async () => {
    const created = (await (
      await createCase(
        jsonReq("POST", {
          summary: "case opened with people",
          persons: [
            { id: "person-witness", name: "Early Witness", type: "witness", relatedVictimId: "person-victim", relationship: "spouse" },
            { id: "person-victim", name: "Later Victim", type: "victim" },
          ],
        }),
      )
    ).json()) as { id: string };
    expect(created.id).toBeTruthy();
    const detail = (await (
      await getCase(new Request("http://localhost/x"), paramsOf(created.id))
    ).json()) as { persons: Array<Record<string, unknown>> };
    expect(detail.persons).toHaveLength(2);
    const witness = detail.persons.find((p) => p.id === "person-witness");
    expect(witness).toMatchObject({
      relatedVictimId: "person-victim",
      relationship: "spouse",
      type: "witness",
    });
  });
});
