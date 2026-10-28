import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, initDb, insertCase } from "../lib/db";
import { buildDossier, dossierText } from "../lib/dossier";

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

const fakeGlimmer = {
  summarize: vi.fn(async (prompt: string) =>
    prompt.includes("I saw the white car")
      ? "The suspect said he fled in the white car."
      : "Transcript summary.",
  ),
};

function seedFullCase() {
  const rec = insertCase({
    summary: "Night knife attack in front of the market",
    crimeType: "assault",
    weapon: "knife",
    mo: "night approach",
    occurredAt: "2026-01-15T22:30:00.000Z",
    status: "open",
  });
  const db = getDb();
  const now = rec.createdAt;
  db.prepare(
    "INSERT INTO case_locations (id, caseId, title, note, locationText, kind, priority, latitude, longitude, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run("loc-1", rec.id, "Market front", "door forced", "door forced", "crime-scene", null, 41.01, 28.97, now);
  const personTranscript = JSON.stringify({
    text: "officer: what did you see. suspect: I saw the white car, I took the plate.",
    segments: [
      { speaker: "officer", text: "what did you see", start: 0, end: 2 },
      { speaker: "suspect", text: "I saw the white car", start: 2, end: 5 },
      { speaker: "suspect", text: "I took the plate", start: 5, end: 7 },
    ],
  });
  db.prepare(
    "INSERT INTO case_persons (id, caseId, name, age, gender, note, type, relatedVictimId, relationship, unidentified, contactStatus, transcript, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run("per-1", rec.id, "James Miller", 34, "male", "market employee", "suspect", null, null, 0, "reached", personTranscript, now);
  db.prepare(
    "INSERT INTO case_persons (id, caseId, name, age, gender, note, type, relatedVictimId, relationship, unidentified, contactStatus, transcript, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run("per-2", rec.id, "Alice Brown", 28, "female", null, "witness", null, null, 0, null, null, now);
  const evTranscript = JSON.stringify({
    text: "camera audio: engine sound heard",
    segments: [{ speaker: "recording", text: "engine sound heard", start: 0, end: 3 }],
  });
  const marking = JSON.stringify({
    boxes: [
      { x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: "knife" },
      { x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: "white car" },
      { x: 0.6, y: 0.6, w: 0.1, h: 0.1, label: "knife" },
    ],
  });
  db.prepare(
    "INSERT INTO evidences (id, caseId, type, title, note, transcript, marking, createdAt) VALUES (?,?,?,?,?,?,?,?)",
  ).run("ev-1", rec.id, "evidence", "Crime scene knife", "kitchen counter", evTranscript, marking, now);
  return rec;
}

function dossierRow(caseId: string) {
  return getDb()
    .prepare("SELECT * FROM case_dossiers WHERE caseId = ?")
    .get(caseId) as { caseId: string; version: number; hash: string; json: string; updatedAt: string };
}

describe("buildDossier", () => {
  it("compiles expected sections with source ids from a known case and writes them to the DB", async () => {
    const rec = seedFullCase();
    fakeGlimmer.summarize.mockClear();
    const d = await buildDossier(getDb(), rec.id, fakeGlimmer);

    expect(d.caseId).toBe(rec.id);
    expect(d.caseNo).toBe(rec.caseNo);
    expect(d.status).toBe("open");
    expect(d.version).toBeGreaterThanOrEqual(1);
    expect(d.hash).toBeTruthy();
    expect(d.event).toMatchObject({
      sourceId: rec.id,
      summary: "Night knife attack in front of the market",
      crimeType: "assault",
      weapon: "knife",
      mo: "night approach",
      occurredAt: "2026-01-15T22:30:00.000Z",
    });
    expect(d.locations).toEqual([
      expect.objectContaining({
        sourceId: "loc-1",
        title: "Market front",
        kind: "crime-scene",
        latitude: 41.01,
        longitude: 28.97,
      }),
    ]);
    expect(d.persons).toHaveLength(2);
    const suspect = d.persons.find((p) => p.sourceId === "per-1")!;
    expect(suspect).toMatchObject({
      name: "James Miller",
      type: "suspect",
      age: 34,
      gender: "male",
      unidentified: false,
    });
    // Transcript highlights: with source id and verbatim quote from the source text
    expect(suspect.transcriptHighlights.length).toBeGreaterThan(0);
    const sourceSegments = ["what did you see", "I saw the white car", "I took the plate"];
    for (const h of suspect.transcriptHighlights) {
      expect(h.sourceId).toBe("per-1");
      expect(sourceSegments).toContain(h.text);
    }
    expect(suspect.transcriptHighlights.map((h) => h.text)).toContain("I saw the white car");
    expect(suspect.transcriptSummary).toBe("The suspect said he fled in the white car.");
    const witness = d.persons.find((p) => p.sourceId === "per-2")!;
    expect(witness.transcriptHighlights).toEqual([]);
    expect(witness.transcriptSummary ?? null).toBeNull();

    expect(d.evidences).toHaveLength(1);
    expect(d.evidences[0]).toMatchObject({
      sourceId: "ev-1",
      title: "Crime scene knife",
      note: "kitchen counter",
    });
    expect(d.evidences[0].samLabels).toEqual(["knife", "white car"]);
    expect(d.evidences[0].transcriptHighlights.map((h) => h.text)).toContain("engine sound heard");
    expect(d.evidences[0].transcriptHighlights[0].sourceId).toBe("ev-1");

    const row = dossierRow(rec.id);
    expect(row.hash).toBe(d.hash);
    expect(row.version).toBe(d.version);
    expect(JSON.parse(row.json)).toEqual(d);
  });

  it("same content keeps the same hash without rewriting the row; hash changes when content changes", async () => {
    const rec = seedFullCase();
    const first = await buildDossier(getDb(), rec.id, fakeGlimmer);
    getDb().prepare("UPDATE case_dossiers SET updatedAt = '2000-01-01T00:00:00.000Z' WHERE caseId = ?").run(rec.id);

    const second = await buildDossier(getDb(), rec.id, fakeGlimmer);
    expect(second.hash).toBe(first.hash);
    expect(dossierRow(rec.id).updatedAt).toBe("2000-01-01T00:00:00.000Z");

    getDb().prepare("UPDATE cases SET summary = 'Changed summary text' WHERE id = ?").run(rec.id);
    const third = await buildDossier(getDb(), rec.id, fakeGlimmer);
    expect(third.hash).not.toBe(first.hash);
    expect(dossierRow(rec.id).hash).toBe(third.hash);
    expect(JSON.parse(dossierRow(rec.id).json).event.summary).toBe("Changed summary text");
  });

  it("missing persons/locations/evidence and corrupt enrichment JSON do not break the file", async () => {
    const rec = insertCase({ summary: "plain case" });
    const db = getDb();
    db.prepare(
      "INSERT INTO case_persons (id, caseId, name, type, unidentified, transcript, createdAt) VALUES (?,?,?,?,?,?,?)",
    ).run("per-x", rec.id, "Corrupt Record", "witness", 0, "{broken json", rec.createdAt);
    const summarize = vi.fn(async () => "must not be called");
    const d = await buildDossier(db, rec.id, { summarize });
    expect(d.locations).toEqual([]);
    expect(d.evidences).toEqual([]);
    expect(d.persons).toHaveLength(1);
    expect(d.persons[0].transcriptHighlights).toEqual([]);
    expect(summarize).not.toHaveBeenCalled();
    expect(dossierRow(rec.id).hash).toBe(d.hash);
  });

  it("file still compiles on Glimmer error; summary empty, highlights stay deterministic", async () => {
    const rec = seedFullCase();
    const failing = {
      summarize: async () => {
        throw new Error("glimmer crashed");
      },
    };
    const d = await buildDossier(getDb(), rec.id, failing);
    const suspect = d.persons.find((p) => p.sourceId === "per-1")!;
    expect(suspect.transcriptSummary ?? null).toBeNull();
    expect(suspect.transcriptHighlights.map((h) => h.text)).toContain("I saw the white car");
  });

  it("file compiles on client error (injected fake); network failure does not break the file", async () => {
    const rec = seedFullCase();
    const throwing = {
      summarize: vi.fn(async () => {
        throw new Error("no network");
      }),
    };
    const d = await buildDossier(getDb(), rec.id, throwing);
    expect(throwing.summarize).toHaveBeenCalled();
    expect(d.persons.find((p) => p.sourceId === "per-1")!.transcriptHighlights.length).toBeGreaterThan(0);
    expect(d.persons.find((p) => p.sourceId === "per-1")!.transcriptSummary ?? null).toBeNull();
  });

  it("non-deterministic Glimmer output does not change the hash: Glimmer is not called on rebuild, summary preserved", async () => {
    const rec = seedFullCase();
    let n = 0;
    const changing = { summarize: vi.fn(async () => `variable summary ${++n}`) };
    const first = await buildDossier(getDb(), rec.id, changing);
    const callsAfterFirst = changing.summarize.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    getDb().prepare("UPDATE case_dossiers SET updatedAt = '2000-01-01T00:00:00.000Z' WHERE caseId = ?").run(rec.id);

    const second = await buildDossier(getDb(), rec.id, changing);
    expect(changing.summarize).toHaveBeenCalledTimes(callsAfterFirst);
    expect(second.hash).toBe(first.hash);
    expect(second.persons.find((p) => p.sourceId === "per-1")!.transcriptSummary).toBe(
      first.persons.find((p) => p.sourceId === "per-1")!.transcriptSummary,
    );
    expect(dossierRow(rec.id).updatedAt).toBe("2000-01-01T00:00:00.000Z");
  });

  it("when the source partially changes, the unchanged transcript summary comes from cache, Glimmer not called", async () => {
    const rec = seedFullCase();
    const first = await buildDossier(getDb(), rec.id, fakeGlimmer);
    getDb().prepare("UPDATE cases SET summary = 'Only the incident summary changed' WHERE id = ?").run(rec.id);

    const other = { summarize: vi.fn(async () => "COMPLETELY DIFFERENT SUMMARY") };
    const second = await buildDossier(getDb(), rec.id, other);
    expect(second.hash).not.toBe(first.hash);
    expect(other.summarize).not.toHaveBeenCalled();
    expect(second.persons.find((p) => p.sourceId === "per-1")!.transcriptSummary).toBe(
      "The suspect said he fled in the white car.",
    );
    expect(dossierRow(rec.id).hash).toBe(second.hash);
  });

  it("when a transcript changes, Glimmer is re-called only for that transcript", async () => {
    const rec = seedFullCase();
    await buildDossier(getDb(), rec.id, fakeGlimmer);
    const changedTranscript = JSON.stringify({
      text: "new statement: red motorcycle seen",
      segments: [{ speaker: "suspect", text: "red motorcycle seen" }],
    });
    getDb().prepare("UPDATE case_persons SET transcript = ? WHERE id = 'per-1'").run(changedTranscript);
    const spy = { summarize: vi.fn(async () => "new summary") };
    const d = await buildDossier(getDb(), rec.id, spy);
    // per-1 changed (1 call); ev-1 transcript unchanged, summary from cache (no call)
    expect(spy.summarize).toHaveBeenCalledTimes(1);
    expect(d.persons.find((p) => p.sourceId === "per-1")!.transcriptSummary).toBe("new summary");
    expect(d.evidences[0].transcriptSummary).toBe("Transcript summary.");
  });

  it("highlights are picked from the longest segments, shown in original order (max 5)", async () => {
    const rec = insertCase({ summary: "case with long transcript" });
    const db = getDb();
    const segments = [
      { speaker: "a", text: "short" },
      { speaker: "a", text: "this is a much longer statement segment number one" },
      { speaker: "a", text: "medium-length segment" },
      { speaker: "a", text: "this is the longest segment with quite detailed information yes" },
      { speaker: "a", text: "k" },
      { speaker: "a", text: "the second long segment is right here" },
      { speaker: "a", text: "another medium-size segment right here" },
    ];
    db.prepare(
      "INSERT INTO case_persons (id, caseId, name, type, unidentified, transcript, createdAt) VALUES (?,?,?,?,?,?,?)",
    ).run("per-long", rec.id, "Lengthy Speaker", "witness", 0, JSON.stringify({ text: segments.map((s) => s.text).join(" "), segments }), rec.createdAt);
    const d = await buildDossier(db, rec.id, { summarize: async () => "summary" });
    const highlights = d.persons[0].transcriptHighlights;
    expect(highlights).toHaveLength(5);
    // The shortest two segments ("short", "k") are out; the rest in original order
    expect(highlights.map((h) => h.text)).toEqual([
      "this is a much longer statement segment number one",
      "medium-length segment",
      "this is the longest segment with quite detailed information yes",
      "the second long segment is right here",
      "another medium-size segment right here",
    ]);
  });

  it("unresponsive Glimmer compiles without a summary via short timeout; highlights remain, record written", async () => {
    const rec = seedFullCase();
    process.env.GLIMMER_TIMEOUT_MS = "20";
    try {
      const hanging = { summarize: () => new Promise<string>(() => {}) };
      const d = await buildDossier(getDb(), rec.id, hanging);
      const suspect = d.persons.find((p) => p.sourceId === "per-1")!;
      expect(suspect.transcriptSummary ?? null).toBeNull();
      expect(suspect.transcriptHighlights.map((h) => h.text)).toContain(
        "I saw the white car",
      );
      expect(dossierRow(rec.id).hash).toBe(d.hash);
    } finally {
      delete process.env.GLIMMER_TIMEOUT_MS;
    }
  });

  it("throws for a missing case", async () => {
    await expect(buildDossier(getDb(), "missing-id", fakeGlimmer)).rejects.toThrow();
  });
});

describe("dossierText", () => {
  it("plain text for the Spark package carries all sections and source ids", async () => {
    const rec = seedFullCase();
    const d = await buildDossier(getDb(), rec.id, fakeGlimmer);
    const text = dossierText(d);
    expect(text).toContain(rec.caseNo);
    expect(text).toContain("Night knife attack in front of the market");
    expect(text).toContain("Market front");
    expect(text).toContain("James Miller");
    expect(text).toContain("I saw the white car");
    expect(text).toContain("The suspect said he fled in the white car.");
    expect(text).toContain("knife");
    expect(text).toContain("engine sound heard");
    expect(text).toContain("per-1");
    expect(text).toContain("loc-1");
    expect(text).toContain("ev-1");
  });

  it("also produces text for a file with empty sections", async () => {
    const rec = insertCase({ summary: "summary only" });
    const d = await buildDossier(getDb(), rec.id, fakeGlimmer);
    const text = dossierText(d);
    expect(text).toContain(rec.caseNo);
    expect(text).toContain("summary only");
  });
});
