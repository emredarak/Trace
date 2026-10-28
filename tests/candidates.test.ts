import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb, insertCase } from "../lib/db";
import { buildDossier, type CaseDossier } from "../lib/dossier";
import { findCandidates } from "../lib/candidates";

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

const noGlimmer = { summarize: async () => "summary" };

let seq = 0;
function addLocation(caseId: string, latitude: number, longitude: number) {
  seq += 1;
  getDb()
    .prepare(
      "INSERT INTO case_locations (id, caseId, title, note, locationText, kind, priority, latitude, longitude, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(`loc-t${seq}`, caseId, "Location", null, null, "crime-scene", null, latitude, longitude, new Date().toISOString());
}
function addPerson(caseId: string, name: string | null, type: string, unidentified = false) {
  seq += 1;
  getDb()
    .prepare(
      "INSERT INTO case_persons (id, caseId, name, type, unidentified, createdAt) VALUES (?,?,?,?,?,?)",
    )
    .run(`per-t${seq}`, caseId, name, type, unidentified ? 1 : 0, new Date().toISOString());
}
function addSamEvidence(caseId: string, labels: string[]) {
  seq += 1;
  const marking = JSON.stringify({
    boxes: labels.map((label, i) => ({ x: 0.1 * i, y: 0.1, w: 0.2, h: 0.2, label })),
  });
  getDb()
    .prepare(
      "INSERT INTO evidences (id, caseId, type, title, note, transcript, marking, createdAt) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(`ev-t${seq}`, caseId, "evidence", "Evidence", null, null, marking, new Date().toISOString());
}

async function dossiersFor(ids: string[]): Promise<CaseDossier[]> {
  const out: CaseDossier[] = [];
  for (const id of ids) out.push(await buildDossier(getDb(), id, noGlimmer));
  return out;
}

describe("findCandidates", () => {
  it("catches cases FTS misses through each location/person/object/time channel", async () => {
    const query = insertCase({
      summary: "query uniqueword incident",
      occurredAt: "2026-01-15T12:00:00.000Z",
    });
    addLocation(query.id, 41.0082, 28.9784);
    addPerson(query.id, "James Miller", "suspect");
    addSamEvidence(query.id, ["White Car"]);

    const byLocation = insertCase({ summary: "completely different account one", occurredAt: "2024-01-01T12:00:00.000Z" });
    addLocation(byLocation.id, 41.01, 28.98); // ~250 m

    const byPerson = insertCase({ summary: "completely different account two", occurredAt: "2024-01-01T12:00:00.000Z" });
    addPerson(byPerson.id, "james miller", "suspect");

    const byObject = insertCase({ summary: "completely different account three", occurredAt: "2024-01-01T12:00:00.000Z" });
    addSamEvidence(byObject.id, ["white car"]);

    const byTime = insertCase({ summary: "completely different account four", occurredAt: "2026-03-01T12:00:00.000Z" });

    const far = insertCase({ summary: "completely different account five", occurredAt: "2024-06-01T12:00:00.000Z" });
    addLocation(far.id, 39.9334, 32.8597); // Ankara, >5 km
    addPerson(far.id, "Other Person", "suspect");
    addSamEvidence(far.id, ["red motorcycle"]);

    const dossiers = await dossiersFor([query.id, byLocation.id, byPerson.id, byObject.id, byTime.id, far.id]);
    const result = findCandidates(getDb(), query.id, dossiers);
    const byId = new Map(result.map((r) => [r.caseId, r.channels]));

    expect(byId.get(byLocation.id)).toEqual(["location"]);
    expect(byId.get(byPerson.id)).toEqual(["person"]);
    expect(byId.get(byObject.id)).toEqual(["object"]);
    expect(byId.get(byTime.id)).toEqual(["time"]);
    expect(byId.has(far.id)).toBe(false);
    expect(byId.has(query.id)).toBe(false);
  });

  it("also feeds the text (FTS) channel into candidates", async () => {
    const query = insertCase({ summary: "query text", crimeType: "homicide", weapon: "sharp object" });
    const hit = insertCase({ summary: "other account", crimeType: "homicide", weapon: "sharp object" });
    const dossiers = await dossiersFor([query.id, hit.id]);
    const result = findCandidates(getDb(), query.id, dossiers);
    expect(result.find((r) => r.caseId === hit.id)?.channels).toContain("text");
  });

  it("produces no candidate from an unidentified person name; same name with different role also produces none", async () => {
    const query = insertCase({ summary: "query uniqueword", occurredAt: "2026-01-15T12:00:00.000Z" });
    addPerson(query.id, "Thomas Reed", "suspect");
    addPerson(query.id, "Hidden Person", "suspect", true);

    const unidentifiedMatch = insertCase({ summary: "different account x", occurredAt: "2024-01-01T12:00:00.000Z" });
    addPerson(unidentifiedMatch.id, "hidden person", "suspect", true);

    const roleMismatch = insertCase({ summary: "different account y", occurredAt: "2024-01-01T12:00:00.000Z" });
    addPerson(roleMismatch.id, "THOMAS REED", "witness");

    const identified = insertCase({ summary: "different account z", occurredAt: "2024-01-01T12:00:00.000Z" });
    addPerson(identified.id, "Thomas Reed", "suspect", true); // produces none when the candidate side is also unidentified

    const dossiers = await dossiersFor([query.id, unidentifiedMatch.id, roleMismatch.id, identified.id]);
    const result = findCandidates(getDb(), query.id, dossiers);
    expect(result.map((r) => r.caseId)).not.toContain(unidentifiedMatch.id);
    expect(result.map((r) => r.caseId)).not.toContain(roleMismatch.id);
    expect(result.map((r) => r.caseId)).not.toContain(identified.id);
  });

  it("normalizes case/character differences (accents, case) in the person and object channels", async () => {
    const query = insertCase({ summary: "query uniqueword", occurredAt: "2026-01-15T12:00:00.000Z" });
    addPerson(query.id, "Oliver Stone", "suspect");
    addSamEvidence(query.id, ["CAFÉ"]);

    const cand = insertCase({ summary: "different account q", occurredAt: "2024-01-01T12:00:00.000Z" });
    addPerson(cand.id, "oliver stone", "suspect");
    addSamEvidence(cand.id, ["cafe"]);

    const dossiers = await dossiersFor([query.id, cand.id]);
    const result = findCandidates(getDb(), query.id, dossiers);
    expect(result.find((r) => r.caseId === cand.id)?.channels).toEqual(
      expect.arrayContaining(["person", "object"]),
    );
  });

  it("closed cases are in the candidate pool, the query case is excluded", async () => {
    const query = insertCase({ summary: "query uniqueword", occurredAt: "2026-01-15T12:00:00.000Z" });
    addLocation(query.id, 41.0082, 28.9784);
    const closed = insertCase({ summary: "different account closed", occurredAt: "2024-01-01T12:00:00.000Z", status: "closed" });
    addLocation(closed.id, 41.009, 28.979);

    const dossiers = await dossiersFor([query.id, closed.id]);
    const result = findCandidates(getDb(), query.id, dossiers);
    expect(result.map((r) => r.caseId)).toContain(closed.id);
    expect(result.map((r) => r.caseId)).not.toContain(query.id);
  });

  it("90-day time window: inside included, outside excluded; locations beyond 5 km excluded", async () => {
    const query = insertCase({ summary: "query uniqueword", occurredAt: "2026-01-15T12:00:00.000Z" });
    addLocation(query.id, 41.0, 29.0);
    const inTime = insertCase({ summary: "different account t1", occurredAt: "2026-04-10T12:00:00.000Z" }); // 85 days
    const outTime = insertCase({ summary: "different account t2", occurredAt: "2026-05-01T12:00:00.000Z" }); // 106 days
    const farLoc = insertCase({ summary: "different account t3", occurredAt: "2024-01-01T12:00:00.000Z" });
    addLocation(farLoc.id, 41.07, 29.0); // ~7.8 km

    const dossiers = await dossiersFor([query.id, inTime.id, outTime.id, farLoc.id]);
    const ids = findCandidates(getDb(), query.id, dossiers).map((r) => r.caseId);
    expect(ids).toContain(inTime.id);
    expect(ids).not.toContain(outTime.id);
    expect(ids).not.toContain(farLoc.id);
  });

  it("applies the 20-total limit with multi-channel priority", async () => {
    const query = insertCase({ summary: "query uniqueword", occurredAt: "2026-01-15T12:00:00.000Z" });
    addLocation(query.id, 41.0082, 28.9784);
    addPerson(query.id, "James Miller", "suspect");

    const ids: string[] = [query.id];
    // 24 single-channel (time-only) candidates
    for (let i = 0; i < 24; i++) {
      const c = insertCase({ summary: `unique${i} account`, occurredAt: "2026-02-01T12:00:00.000Z" });
      ids.push(c.id);
    }
    const multi = insertCase({ summary: "multichannel unique", occurredAt: "2026-02-01T12:00:00.000Z" });
    addLocation(multi.id, 41.009, 28.979);
    addPerson(multi.id, "james miller", "suspect");
    ids.push(multi.id);

    const dossiers = await dossiersFor(ids);
    const result = findCandidates(getDb(), query.id, dossiers);
    expect(result).toHaveLength(20);
    expect(result[0].caseId).toBe(multi.id);
    expect(result[0].channels.length).toBeGreaterThanOrEqual(3);
    // Ordering: non-increasing channel count
    const counts = result.map((r) => r.channels.length);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});
