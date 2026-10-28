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

async function makeCase(summary = "case with location"): Promise<string> {
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

describe("PATCH /api/cases/[id] field editing", () => {
  it("summary and weapon update, similarity flag is raised", async () => {
    const id = await makeCase();
    const res = await patchCase(
      jsonReq("PATCH", { summary: "new summary", weapon: "crowbar" }),
      paramsOf(id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: string;
      weapon: string;
      needsRerank: number | boolean;
    };
    expect(body.summary).toBe("new summary");
    expect(body.weapon).toBe("crowbar");
    expect(body.needsRerank ? true : false).toBe(true);
  });

  it("empty summary returns 400", async () => {
    const id = await makeCase();
    const res = await patchCase(jsonReq("PATCH", { summary: "  " }), paramsOf(id));
    expect(res.status).toBe(400);
  });

  it("returns 400 when no field is given", async () => {
    const id = await makeCase();
    const res = await patchCase(jsonReq("PATCH", {}), paramsOf(id));
    expect(res.status).toBe(400);
  });

  it("empty-sent fields are cleared (deletion supported)", async () => {
    const id = await makeCase();
    await patchCase(jsonReq("PATCH", { weapon: "crowbar" }), paramsOf(id));
    const res = await patchCase(jsonReq("PATCH", { weapon: "" }), paramsOf(id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { weapon: string | null };
    expect(body.weapon).toBeNull();
  });
});

describe("location endpoints", () => {
  it("adds a location with note + coordinates and lists it", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", {
        note: "where the victim was found",
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
    expect(list[0].title).toBe("where the victim was found");
  });

  it("adds a location with new fields; locationText is a note alias", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", {
        title: "Evidence site",
        note: "camera footage available",
        kind: "related",
        priority: "critical",
        latitude: 41.01,
        longitude: 28.97,
      }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.title).toBe("Evidence site");
    expect(created.note).toBe("camera footage available");
    expect(created.locationText).toBe("camera footage available");
    expect(created.kind).toBe("related");
    expect(created.priority).toBe("critical");
    expect(created.latitude).toBe(41.01);
    expect(created.longitude).toBe(28.97);
    const list = (await (
      await listLocations(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      title: "Evidence site",
      note: "camera footage available",
      locationText: "camera footage available",
      kind: "related",
      priority: "critical",
      latitude: 41.01,
      longitude: 28.97,
    });
  });

  it("legacy body: note becomes the title, locationText becomes the note", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", { note: "victim's location", locationText: "creek bed" }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.title).toBe("victim's location");
    expect(created.note).toBe("creek bed");
    expect(created.locationText).toBe("creek bed");
  });

  it("adds a location with title only (no coordinates)", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", { title: "Text-only place" }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.title).toBe("Text-only place");
    expect(created.kind).toBe("related");
    expect(created.priority).toBeNull();
  });

  it("adds a location with coordinates only; title becomes Location", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", { latitude: 41.01, longitude: 28.97 }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.title).toBe("Location");
  });

  it("request without title or coordinates returns 400", async () => {
    const id = await makeCase();
    const res = await addLocation(jsonReq("POST", {}), paramsOf(id));
    expect(res.status).toBe(400);
  });

  it("note now counts as a title (201); empty body returns 400", async () => {
    const id = await makeCase();
    const res = await addLocation(jsonReq("POST", { note: "empty" }), paramsOf(id));
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.title).toBe("empty");
    const empty = await addLocation(jsonReq("POST", {}), paramsOf(id));
    expect(empty.status).toBe(400);
  });

  it("priority is ignored for Crime Scene (returns null)", async () => {
    const id = await makeCase();
    const res = await addLocation(
      jsonReq("POST", { title: "Crime scene", kind: "crime-scene", priority: "critical" }),
      paramsOf(id),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.kind).toBe("crime-scene");
    expect(created.priority).toBeNull();
  });

  it("invalid kind/priority and lone coordinate return 400", async () => {
    const id = await makeCase();
    expect(
      (await addLocation(jsonReq("POST", { title: "x", kind: "near" }), paramsOf(id))).status,
    ).toBe(400);
    expect(
      (await addLocation(jsonReq("POST", { title: "x", priority: "urgent" }), paramsOf(id))).status,
    ).toBe(400);
    expect(
      (await addLocation(jsonReq("POST", { title: "x", latitude: 41.01 }), paramsOf(id))).status,
    ).toBe(400);
  });

  it("legacy rows return title Location and related kind in GET", async () => {
    const id = await makeCase();
    getDb()
      .prepare(
        "INSERT INTO case_locations (id, caseId, note, locationText, latitude, longitude, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("old-1", id, null, "old text", null, null, new Date().toISOString());
    const list = (await (
      await listLocations(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Location");
    expect(list[0].kind).toBe("related");
    // Legacy data is not migrated: locationText is not promoted to note, both stay null.
    expect(list[0].note).toBeNull();
    expect(list[0].locationText).toBeNull();
  });

  it("PATCH updates a location", async () => {
    const id = await makeCase();
    const created = (await (
      await addLocation(jsonReq("POST", { title: "old title" }), paramsOf(id))
    ).json()) as { id: string };
    const res = await patchLocation(
      jsonReq("PATCH", {
        title: "new title",
        note: "new note",
        kind: "crime-scene",
        priority: "critical",
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
      title: "new title",
      note: "new note",
      locationText: "new note",
      kind: "crime-scene",
      priority: null,
      latitude: 40.5,
      longitude: 29.5,
    });
    const list = (await (
      await listLocations(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as Array<Record<string, unknown>>;
    expect(list[0].title).toBe("new title");
  });

  it("PATCH on another case location returns 404", async () => {
    const id = await makeCase();
    const otherId = await makeCase("other case");
    const created = (await (
      await addLocation(jsonReq("POST", { title: "place" }), paramsOf(id))
    ).json()) as { id: string };
    const res = await patchLocation(
      jsonReq("PATCH", { title: "leak" }),
      locParamsOf(otherId, created.id),
    );
    expect(res.status).toBe(404);
    const missing = await patchLocation(
      jsonReq("PATCH", { title: "x" }),
      locParamsOf(id, "yok"),
    );
    expect(missing.status).toBe(404);
  });

  it("PATCH with an invalid body returns 400", async () => {
    const id = await makeCase();
    const created = (await (
      await addLocation(jsonReq("POST", { title: "place" }), paramsOf(id))
    ).json()) as { id: string };
    const res = await patchLocation(
      jsonReq("PATCH", { title: "x", kind: "near" }),
      locParamsOf(id, created.id),
    );
    expect(res.status).toBe(400);
  });

  it("deletes a location", async () => {
    const id = await makeCase();
    const created = (await (
      await addLocation(
        jsonReq("POST", { locationText: "under the bridge" }),
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

  it("POST uses the client id; a repeat returns the same row with 200, no duplicate", async () => {
    const id = await makeCase();
    const body = { id: "client-1", title: "Offline place" };
    const first = await addLocation(jsonReq("POST", body), paramsOf(id));
    expect(first.status).toBe(201);
    expect(((await first.json()) as { id: string }).id).toBe("client-1");
    const dup = await addLocation(jsonReq("POST", body), paramsOf(id));
    expect(dup.status).toBe(200);
    expect(((await dup.json()) as { id: string }).id).toBe("client-1");
    const list = (await (
      await listLocations(new Request("http://localhost/x"), paramsOf(id))
    ).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("POST with another case client id returns 400", async () => {
    const id = await makeCase();
    const otherId = await makeCase("other case 2");
    await addLocation(
      jsonReq("POST", { id: "shared", title: "place" }),
      paramsOf(id),
    );
    const res = await addLocation(
      jsonReq("POST", { id: "shared", title: "leak" }),
      paramsOf(otherId),
    );
    expect(res.status).toBe(400);
  });

  it("cannot add a location to an unknown case", async () => {
    const res = await addLocation(
      jsonReq("POST", { locationText: "x" }),
      paramsOf("yok"),
    );
    expect(res.status).toBe(404);
  });
});

describe("opening a case with locations and all fields", () => {
  it("POST /api/cases also saves locations; single-case GET returns them", async () => {
    const created = (await (
      await createCase(
        jsonReq("POST", {
          summary: "full-field case",
          crimeType: "robbery",
          locationType: "waterfront",
          mo: "approaching from behind at night",
          weapon: "knife",
          victimAge: 40,
          victimGender: "male",
          suspects: "one person",
          witnesses: "one witness",
          locations: [
            {
              note: "where the victim was found",
              locationText: "creek bed",
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
    expect(body.crimeType).toBe("robbery");
    expect(body.victimAge).toBe(40);
    expect(body.locations).toHaveLength(1);
    expect(body.locations[0].title).toBe("where the victim was found");
    expect(body.locations[0].note).toBe("creek bed");
  });

  it("unknown fields are silently dropped (allowlist)", async () => {
    const created = (await (
      await createCase(
        jsonReq("POST", { summary: "v", secretField: "leak" }),
      )
    ).json()) as { id: string };
    const { GET: getCase } = await import("../app/api/cases/[id]/route");
    const body = (await (
      await getCase(new Request("http://localhost/x"), paramsOf(created.id))
    ).json()) as Record<string, unknown>;
    expect(body.secretField).toBeUndefined();
  });
});
