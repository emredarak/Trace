import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, enqueueJob, getDb, initDb } from "../lib/db";
import { processPendingJobs } from "../lib/enrichment";
import { POST as createCase } from "../app/api/cases/route";
import { POST as addPerson } from "../app/api/cases/[id]/persons/route";
import { POST as uploadPersonAudio } from "../app/api/cases/[id]/persons/[personId]/audio/route";
import {
  POST as addEvidence,
} from "../app/api/cases/[id]/evidences/route";
import { PATCH as patchEvidence } from "../app/api/cases/[id]/evidences/[evidenceId]/route";

let uploadDir = "";

const fakeTranscribe = {
  transcribeAudio: async () => ({
    text: "interrogator: I saw it at night. officer: did you take the plate.",
    segments: [
      { speaker: "interrogator", text: "I saw it at night" },
      { speaker: "officer", text: "did you take the plate" },
    ],
  }),
};
const hints: string[] = [];
const fakeMark = {
  markImage: async (_image: Buffer, hint: string) => {
    hints.push(hint);
    return { boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: "knife" }] };
  },
};
const failingTranscribe = {
  transcribeAudio: async () => {
    throw new Error("transcribe crashed");
  },
};

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function formReq(fields: Record<string, string>, files: Record<string, File> = {}): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [k, f] of Object.entries(files)) form.append(k, f);
  return new Request("http://localhost/x", { method: "POST", body: form });
}
const caseParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function makeCase(): Promise<string> {
  const res = await createCase(jsonReq({ summary: "rich case" }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}
async function makePerson(caseId: string): Promise<string> {
  const res = await addPerson(jsonReq({ name: "Witness A", type: "witness" }), caseParams(caseId));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}
function jobs() {
  return getDb().prepare("SELECT * FROM enrichment_jobs ORDER BY createdAt ASC, kind ASC").all() as Record<string, unknown>[];
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  uploadDir = mkdtempSync(join(tmpdir(), "trace-enrich-"));
  process.env.TRACE_UPLOAD_DIR = uploadDir;
  hints.length = 0;
  closeDb();
  initDb();
});
afterEach(() => {
  rmSync(uploadDir, { recursive: true, force: true });
  delete process.env.TRACE_UPLOAD_DIR;
});

describe("processPendingJobs", () => {
  it("person audio upload enqueues a job; when the job runs, transcript segments are written to the person", async () => {
    const caseId = await makeCase();
    const personId = await makePerson(caseId);
    const res = await uploadPersonAudio(
      formReq({}, { file: new File(["audio"], "interview.mp3", { type: "audio/mpeg" }) }),
      { params: Promise.resolve({ id: caseId, personId }) },
    );
    expect(res.status).toBe(200);
    // Route must not block on model: job pending, no transcript yet
    expect(jobs()).toMatchObject([{ caseId, kind: "transcribe", refId: personId, status: "pending" }]);
    let person = getDb().prepare("SELECT transcript FROM case_persons WHERE id=?").get(personId) as { transcript: unknown };
    expect(person.transcript ?? null).toBeNull();

    const out = await processPendingJobs(getDb(), 10, { transcribe: fakeTranscribe, markPhoto: fakeMark });
    expect(out).toEqual({ done: 1, failed: 0 });
    const stored = getDb().prepare("SELECT transcript FROM case_persons WHERE id=?").get(personId) as { transcript: string };
    const parsed = JSON.parse(stored.transcript);
    expect(parsed.text).toContain("I saw it at night");
    expect(parsed.segments).toHaveLength(2);
    expect(new Set(parsed.segments.map((s: { speaker: string }) => s.speaker)).size).toBe(2);
    expect(jobs()[0]).toMatchObject({ status: "done", attempts: 1 });
  });

  it("evidence image+audio jobs are enqueued; SAM hint comes from title, transcript/marking written to evidence", async () => {
    const caseId = await makeCase();
    const res = await addEvidence(
      formReq({ title: "Crime scene knife", note: "kitchen" }, {
        image: new File(["img"], "f.jpg", { type: "image/jpeg" }),
        audio: new File(["audio"], "a.mp3", { type: "audio/mpeg" }),
      }),
      caseParams(caseId),
    );
    expect(res.status).toBe(201);
    const ev = (await res.json()) as { id: string };
    expect(jobs().map((j) => j.kind).sort()).toEqual(["sam", "transcribe"]);
    expect(jobs().every((j) => j.refId === ev.id && j.status === "pending")).toBe(true);

    const out = await processPendingJobs(getDb(), 10, { transcribe: fakeTranscribe, markPhoto: fakeMark });
    expect(out).toEqual({ done: 2, failed: 0 });
    expect(hints).toEqual(["Crime scene knife"]);
    const row = getDb().prepare("SELECT transcript, marking FROM evidences WHERE id=?").get(ev.id) as { transcript: string; marking: string };
    expect(JSON.parse(row.transcript).segments).toHaveLength(2);
    expect(JSON.parse(row.marking).boxes).toMatchObject([{ label: "knife" }]);
  });

  it("reports selected jobs and per-job progress through the callbacks", async () => {
    const caseId = await makeCase();
    const res = await addEvidence(
      formReq({ title: "Crime scene knife", note: "kitchen" }, {
        image: new File(["img"], "f.jpg", { type: "image/jpeg" }),
        audio: new File(["audio"], "a.mp3", { type: "audio/mpeg" }),
      }),
      caseParams(caseId),
    );
    expect(res.status).toBe(201);

    const selected: unknown[] = [];
    const finished: Record<string, unknown>[] = [];
    const out = await processPendingJobs(
      getDb(),
      10,
      { transcribe: fakeTranscribe, markPhoto: fakeMark },
      {
        onJobsSelected: (info) => selected.push(info),
        onJobFinished: (info) => finished.push({ ...info }),
      },
    );
    expect(out).toEqual({ done: 2, failed: 0 });
    expect(selected).toEqual([{ total: 2, transcribeCount: 1, samCount: 1 }]);
    expect(finished).toHaveLength(2);
    expect(finished[0]).toMatchObject({ completed: 1, total: 2 });
    expect(finished[1]).toMatchObject({ completed: 2, total: 2, done: 2, failed: 0 });
    expect(finished.map((f) => f.kind).sort()).toEqual(["sam", "transcribe"]);
  });

  it("SAM hint: title else note, else 'evidence'", async () => {
    const caseId = await makeCase();
    const db = getDb();
    const now = new Date().toISOString();
    writeFileSync(join(uploadDir, "a.jpg"), "img");
    writeFileSync(join(uploadDir, "b.jpg"), "img");
    db.prepare("INSERT INTO evidences (id, caseId, type, title, note, imageFile, createdAt) VALUES (?,?,?,?,?,?,?)")
      .run("ev-note", caseId, "evidence", null, "door handle", "a.jpg", now);
    db.prepare("INSERT INTO evidences (id, caseId, type, title, note, imageFile, createdAt) VALUES (?,?,?,?,?,?,?)")
      .run("ev-none", caseId, "evidence", null, null, "b.jpg", now);
    enqueueJob(db, { caseId, kind: "sam", refId: "ev-note" });
    enqueueJob(db, { caseId, kind: "sam", refId: "ev-none" });
    const out = await processPendingJobs(db, 10, { transcribe: fakeTranscribe, markPhoto: fakeMark });
    expect(out).toEqual({ done: 2, failed: 0 });
    expect(hints.sort()).toEqual(["door handle", "evidence"]);
  });

  it("on client error the upload stays, the job fails, and it can be retried from the queue", async () => {
    const caseId = await makeCase();
    const personId = await makePerson(caseId);
    await uploadPersonAudio(
      formReq({}, { file: new File(["audio"], "s.mp3", { type: "audio/mpeg" }) }),
      { params: Promise.resolve({ id: caseId, personId }) },
    );
    const out = await processPendingJobs(getDb(), 10, { transcribe: failingTranscribe, markPhoto: fakeMark });
    expect(out).toEqual({ done: 0, failed: 1 });
    const person = getDb().prepare("SELECT audioFile, transcript FROM case_persons WHERE id=?").get(personId) as { audioFile: string; transcript: unknown };
    expect(person.audioFile).toBeTruthy();
    expect(existsSync(join(uploadDir, person.audioFile))).toBe(true);
    expect(person.transcript ?? null).toBeNull();
    expect(jobs()[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(String(jobs()[0].lastError)).toContain("transcribe crashed");

    // Retry (controller ruling): processPendingJobs retries the same failed
    // job (attempts < 3) without any manual re-enqueue.
    const failedId = jobs()[0].id;
    const out2 = await processPendingJobs(getDb(), 10, { transcribe: fakeTranscribe, markPhoto: fakeMark });
    expect(out2).toEqual({ done: 1, failed: 0 });
    expect(jobs().find((j) => j.id === failedId)).toMatchObject({ status: "done", attempts: 2 });
    const after = getDb().prepare("SELECT transcript FROM case_persons WHERE id=?").get(personId) as { transcript: string };
    expect(JSON.parse(after.transcript).text).toContain("I saw it at night");
  });

  it("unresponsive Transcribe fails the job by timeout as failed+retryable, upload is not lost", async () => {
    process.env.META_TRANSCRIBE_TIMEOUT_MS = "20";
    try {
      const caseId = await makeCase();
      const personId = await makePerson(caseId);
      await uploadPersonAudio(
        formReq({}, { file: new File(["audio"], "s.mp3", { type: "audio/mpeg" }) }),
        { params: Promise.resolve({ id: caseId, personId }) },
      );
      const hanging = { transcribeAudio: () => new Promise<never>(() => {}) };
      const out = await processPendingJobs(getDb(), 10, {
        transcribe: hanging,
        markPhoto: fakeMark,
      });
      expect(out).toEqual({ done: 0, failed: 1 });
      expect(jobs()[0]).toMatchObject({ status: "failed", attempts: 1 });
      expect(String(jobs()[0].lastError)).toMatch(/timeout/i);
      const person = getDb()
        .prepare("SELECT audioFile, transcript FROM case_persons WHERE id=?")
        .get(personId) as { audioFile: string; transcript: unknown };
      expect(person.audioFile).toBeTruthy();
      expect(existsSync(join(uploadDir, person.audioFile))).toBe(true);
      expect(person.transcript ?? null).toBeNull();
      // Retryable: the next run completes the job with a working client.
      const out2 = await processPendingJobs(getDb(), 10, {
        transcribe: fakeTranscribe,
        markPhoto: fakeMark,
      });
      expect(out2).toEqual({ done: 1, failed: 0 });
    } finally {
      delete process.env.META_TRANSCRIBE_TIMEOUT_MS;
    }
  });

  it("a failed job with attempts >= 3 is not retried", async () => {
    const caseId = await makeCase();
    const personId = await makePerson(caseId);
    await uploadPersonAudio(
      formReq({}, { file: new File(["audio"], "s.mp3", { type: "audio/mpeg" }) }),
      { params: Promise.resolve({ id: caseId, personId }) },
    );
    getDb().prepare("UPDATE enrichment_jobs SET status='failed', attempts=3 WHERE refId=?").run(personId);
    const out = await processPendingJobs(getDb(), 10, { transcribe: fakeTranscribe, markPhoto: fakeMark });
    expect(out).toEqual({ done: 0, failed: 0 });
    expect(jobs()[0]).toMatchObject({ status: "failed", attempts: 3 });
    const person = getDb().prepare("SELECT transcript FROM case_persons WHERE id=?").get(personId) as { transcript: unknown };
    expect(person.transcript ?? null).toBeNull();
  });

  it("race: if audio changes while the transcript is pending, the stale result is not written and work remains for the new file", async () => {
    const caseId = await makeCase();
    const personId = await makePerson(caseId);
    await uploadPersonAudio(
      formReq({}, { file: new File(["old"], "old.mp3", { type: "audio/mpeg" }) }),
      { params: Promise.resolve({ id: caseId, personId }) },
    );
    const swapping = {
      transcribeAudio: async () => {
        writeFileSync(join(uploadDir, "new.mp3"), "new");
        getDb().prepare("UPDATE case_persons SET audioFile='new.mp3', transcript=NULL WHERE id=?").run(personId);
        return { text: "OLD result", segments: [{ speaker: "interrogator", text: "OLD result" }] };
      },
    };
    const out = await processPendingJobs(getDb(), 10, { transcribe: swapping, markPhoto: fakeMark });
    expect(out).toEqual({ done: 1, failed: 0 });
    const person = getDb().prepare("SELECT audioFile, transcript FROM case_persons WHERE id=?").get(personId) as { audioFile: string; transcript: unknown };
    expect(person.audioFile).toBe("new.mp3");
    expect(person.transcript ?? null).toBeNull();
    // New file still has work queued
    expect(jobs().filter((j) => j.status === "pending")).toMatchObject([{ kind: "transcribe", refId: personId }]);
    const out2 = await processPendingJobs(getDb(), 10, { transcribe: fakeTranscribe, markPhoto: fakeMark });
    expect(out2).toEqual({ done: 1, failed: 0 });
    const after = getDb().prepare("SELECT transcript FROM case_persons WHERE id=?").get(personId) as { transcript: string };
    expect(JSON.parse(after.transcript).text).toContain("I saw it at night");
    expect(after.transcript).not.toContain("OLD");
  });

  it("race: if the image changes while SAM is pending, the stale marking is not written and work remains for the new file", async () => {
    const caseId = await makeCase();
    const db = getDb();
    writeFileSync(join(uploadDir, "a.jpg"), "img");
    writeFileSync(join(uploadDir, "b.jpg"), "img2");
    db.prepare("INSERT INTO evidences (id, caseId, type, title, imageFile, createdAt) VALUES (?,?,?,?,?,?)")
      .run("ev-race", caseId, "evidence", "Photo", "a.jpg", new Date().toISOString());
    enqueueJob(db, { caseId, kind: "sam", refId: "ev-race" });
    const swappingMark = {
      markImage: async () => {
        db.prepare("UPDATE evidences SET imageFile='b.jpg', marking=NULL WHERE id='ev-race'").run();
        return { boxes: [{ x: 0, y: 0, w: 1, h: 1, label: "OLD" }] };
      },
    };
    const out = await processPendingJobs(db, 10, { transcribe: fakeTranscribe, markPhoto: swappingMark });
    expect(out).toEqual({ done: 1, failed: 0 });
    const row = db.prepare("SELECT imageFile, marking FROM evidences WHERE id='ev-race'").get() as { imageFile: string; marking: unknown };
    expect(row.imageFile).toBe("b.jpg");
    expect(row.marking ?? null).toBeNull();
    expect(jobs().filter((j) => j.status === "pending")).toMatchObject([{ kind: "sam", refId: "ev-race" }]);
    const out2 = await processPendingJobs(db, 10, { transcribe: fakeTranscribe, markPhoto: fakeMark });
    expect(out2).toEqual({ done: 1, failed: 0 });
    const after = db.prepare("SELECT marking FROM evidences WHERE id='ev-race'").get() as { marking: string };
    expect(JSON.parse(after.marking).boxes).toMatchObject([{ label: "knife" }]);
  });

  it("missing evidence image on disk: job fails, evidence record is kept", async () => {
    const caseId = await makeCase();
    const db = getDb();
    db.prepare("INSERT INTO evidences (id, caseId, type, title, note, imageFile, createdAt) VALUES (?,?,?,?,?,?,?)")
      .run("ev-missing", caseId, "evidence", "Missing photo", null, "no-such.jpg", new Date().toISOString());
    enqueueJob(db, { caseId, kind: "sam", refId: "ev-missing" });
    const out = await processPendingJobs(db, 10, { transcribe: fakeTranscribe, markPhoto: fakeMark });
    expect(out).toEqual({ done: 0, failed: 1 });
    expect(db.prepare("SELECT id FROM evidences WHERE id='ev-missing'").get()).toBeTruthy();
    expect(jobs()[0].status).toBe("failed");
    expect(String(jobs()[0].lastError).length).toBeGreaterThan(0);
  });

  it("processes up to the limit; dossier jobs are not handled in this module and stay pending", async () => {
    const caseId = await makeCase();
    const db = getDb();
    const now = new Date().toISOString();
    writeFileSync(join(uploadDir, "a.jpg"), "img");
    writeFileSync(join(uploadDir, "b.jpg"), "img");
    for (const [id, f] of [["ev-1", "a.jpg"], ["ev-2", "b.jpg"]] as const) {
      db.prepare("INSERT INTO evidences (id, caseId, type, title, imageFile, createdAt) VALUES (?,?,?,?,?,?)")
        .run(id, caseId, "evidence", "Photo", f, now);
      enqueueJob(db, { caseId, kind: "sam", refId: id });
    }
    enqueueJob(db, { caseId, kind: "dossier" });
    const out = await processPendingJobs(db, 1, { transcribe: fakeTranscribe, markPhoto: fakeMark });
    expect(out).toEqual({ done: 1, failed: 0 });
    expect(jobs().filter((j) => j.status === "pending")).toHaveLength(2); // 1 sam + dossier
  });

  it("uploading a new image via PATCH enqueues a SAM job", async () => {
    const caseId = await makeCase();
    const created = (await (await addEvidence(formReq({ title: "Photo", note: "note" }), caseParams(caseId))).json()) as { id: string };
    expect(jobs()).toHaveLength(0);
    const form = new FormData();
    form.append("title", "Photo");
    form.append("note", "note");
    form.append("image", new File(["img2"], "new.jpg", { type: "image/jpeg" }));
    const res = await patchEvidence(new Request("http://localhost/x", { method: "PATCH", body: form }), {
      params: Promise.resolve({ id: caseId, evidenceId: created.id }),
    });
    expect(res.status).toBe(200);
    expect(jobs()).toMatchObject([{ kind: "sam", refId: created.id, status: "pending" }]);
    const out = await processPendingJobs(getDb(), 10, { transcribe: fakeTranscribe, markPhoto: fakeMark });
    expect(out).toEqual({ done: 1, failed: 0 });
    const row = getDb().prepare("SELECT marking FROM evidences WHERE id=?").get(created.id) as { marking: string };
    expect(JSON.parse(row.marking).boxes).toHaveLength(1);
  });
});
