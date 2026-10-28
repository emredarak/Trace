import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../lib/db";
import { POST as createCase } from "../app/api/cases/route";
import { GET as getCase } from "../app/api/cases/[id]/route";
import {
  GET as listEvidences,
  POST as addEvidence,
} from "../app/api/cases/[id]/evidences/route";
import {
  DELETE as deleteEvidence,
  PATCH as patchEvidence,
} from "../app/api/cases/[id]/evidences/[evidenceId]/route";
import { POST as addPerson } from "../app/api/cases/[id]/persons/route";
import {
  DELETE as deletePersonAudio,
  POST as uploadPersonAudio,
} from "../app/api/cases/[id]/persons/[personId]/audio/route";
import { GET as getFile } from "../app/api/files/[name]/route";

let uploadDir = "";

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
const evParams = (id: string, evidenceId: string) => ({
  params: Promise.resolve({ id, evidenceId }),
});
const personAudioParams = (id: string, personId: string) => ({
  params: Promise.resolve({ id, personId }),
});
const fileParams = (name: string) => ({ params: Promise.resolve({ name }) });

async function makeCase(): Promise<string> {
  const body = (await (await createCase(jsonReq({ summary: "case with evidence" }))).json()) as {
    id: string;
  };
  return body.id;
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  uploadDir = mkdtempSync(join(tmpdir(), "trace-evidence-"));
  process.env.TRACE_UPLOAD_DIR = uploadDir;
  closeDb();
  initDb();
});

afterEach(() => {
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("evidence endpoints", () => {
  it("note-only evidence returns 201; missing title or content returns 400", async () => {
    const id = await makeCase();
    const ok = await addEvidence(formReq({ title: "Casing", note: "9mm" }), caseParams(id));
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ title: "Casing", note: "9mm", type: "evidence", imageFile: null, audioFile: null });

    const noTitle = await addEvidence(formReq({ note: "x" }), caseParams(id));
    expect(noTitle.status).toBe(400);
    const empty = await addEvidence(formReq({ title: "Empty" }), caseParams(id));
    expect(empty.status).toBe(400);
  });

  it("image+audio files are stored, returned in detail, and served by the file endpoint", async () => {
    const id = await makeCase();
    const res = await addEvidence(
      formReq({ title: "Crime scene" }, {
        image: new File(["img"], "photo.jpg", { type: "image/jpeg" }),
        audio: new File(["audio"], "interview.mp3", { type: "audio/mpeg" }),
      }),
      caseParams(id),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { imageFile: string; audioFile: string };
    expect(existsSync(join(uploadDir, body.imageFile))).toBe(true);
    expect(existsSync(join(uploadDir, body.audioFile))).toBe(true);

    const detail = (await (await getCase(new Request("http://localhost/x"), caseParams(id))).json()) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(detail.entries).toHaveLength(1);
    expect(detail.entries[0]).toMatchObject({ title: "Crime scene", imageFile: body.imageFile, audioFile: body.audioFile });

    const list = (await (await listEvidences(new Request("http://localhost/x"), caseParams(id))).json()) as unknown[];
    expect(list).toHaveLength(1);

    const imgRes = await getFile(new Request("http://localhost/x"), fileParams(body.imageFile));
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get("content-type")).toContain("image/jpeg");
    expect(await imgRes.text()).toBe("img");

    const traversal = await getFile(new Request("http://localhost/x"), fileParams("..%2Ftrace.db"));
    expect(traversal.status).toBe(404);
  });

  it("PATCH updates the note and removes the image; DELETE removes files too", async () => {
    const id = await makeCase();
    const created = (await (
      await addEvidence(
        formReq({ title: "Photo" }, { image: new File(["img"], "f.jpg", { type: "image/jpeg" }) }),
        caseParams(id),
      )
    ).json()) as { id: string; imageFile: string };

    const patchForm = new FormData();
    patchForm.append("title", "Photo (updated)");
    patchForm.append("note", "new note");
    patchForm.append("removeImage", "1");
    const patched = await patchEvidence(
      new Request("http://localhost/x", { method: "PATCH", body: patchForm }),
      evParams(id, created.id),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ title: "Photo (updated)", note: "new note", imageFile: null });
    expect(existsSync(join(uploadDir, created.imageFile))).toBe(false);

    // Content cannot be emptied entirely.
    const emptyForm = new FormData();
    emptyForm.append("title", "Photo (updated)");
    const emptied = await patchEvidence(
      new Request("http://localhost/x", { method: "PATCH", body: emptyForm }),
      evParams(id, created.id),
    );
    expect(emptied.status).toBe(400);

    const del = await deleteEvidence(new Request("http://localhost/x", { method: "DELETE" }), evParams(id, created.id));
    expect(del.status).toBe(200);
    expect(await (await listEvidences(new Request("http://localhost/x"), caseParams(id))).json()).toEqual([]);
  });

  it("unknown case/evidence returns 404", async () => {
    const res = await addEvidence(formReq({ title: "X", note: "y" }), caseParams("yok"));
    expect(res.status).toBe(404);
    const id = await makeCase();
    const del = await deleteEvidence(new Request("http://localhost/x", { method: "DELETE" }), evParams(id, "yok"));
    expect(del.status).toBe(404);
  });
});

describe("person interview audio", () => {
  async function makePerson(caseId: string, type: string): Promise<string> {
    const body = (await (
      await addPerson(jsonReq({ name: "Person", type }), caseParams(caseId))
    ).json()) as { id: string };
    return body.id;
  }

  it("audio uploads to a witness, serves a listening endpoint, and deletes", async () => {
    const id = await makeCase();
    const personId = await makePerson(id, "witness");
    const res = await uploadPersonAudio(
      formReq({}, { file: new File(["audio"], "interview.mp3", { type: "audio/mpeg" }) }),
      personAudioParams(id, personId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { audioFile: string };
    expect(body.audioFile).toBeTruthy();
    expect(existsSync(join(uploadDir, body.audioFile))).toBe(true);

    const detail = (await (await getCase(new Request("http://localhost/x"), caseParams(id))).json()) as {
      persons: Array<Record<string, unknown>>;
    };
    expect(detail.persons[0]).toMatchObject({ audioFile: body.audioFile });

    const audioRes = await getFile(new Request("http://localhost/x"), fileParams(body.audioFile));
    expect(audioRes.status).toBe(200);
    expect(audioRes.headers.get("content-type")).toContain("audio/");

    const del = await deletePersonAudio(new Request("http://localhost/x", { method: "DELETE" }), personAudioParams(id, personId));
    expect(del.status).toBe(200);
    expect(existsSync(join(uploadDir, body.audioFile))).toBe(false);
  });

  it("victims cannot receive audio; non-audio files return 400", async () => {
    const id = await makeCase();
    const victimId = await makePerson(id, "victim");
    const res = await uploadPersonAudio(
      formReq({}, { file: new File(["audio"], "s.mp3", { type: "audio/mpeg" }) }),
      personAudioParams(id, victimId),
    );
    expect(res.status).toBe(400);

    const witnessId = await makePerson(id, "suspect");
    const notAudio = await uploadPersonAudio(
      formReq({}, { file: new File(["x"], "f.jpg", { type: "image/jpeg" }) }),
      personAudioParams(id, witnessId),
    );
    expect(notAudio.status).toBe(400);
  });
});
