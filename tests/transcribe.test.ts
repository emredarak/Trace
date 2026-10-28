import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb, initDb } from "../lib/db";
import { transcribe, __setTranscribeClientForTests } from "../lib/transcribe";
import {
  POST as createCase,
  GET as listCases,
} from "../app/api/cases/route";
import { POST as transcribeAudio } from "../app/api/cases/[id]/transcribe/route";

// Fake resolution: two speakers, 3 segments.
const FAKE_TRANSCRIPT = {
  text: "speaker 1: I saw it at night. speaker 2: I took the plate. speaker 1: then fled.",
  segments: [
    { speaker: "speaker 1", text: "I saw it at night" },
    { speaker: "speaker 2", text: "I took the plate" },
    { speaker: "speaker 1", text: "then fled" },
  ],
};

const fakeClient = {
  transcribeAudio: async () => ({
    text: FAKE_TRANSCRIPT.text,
    segments: [...FAKE_TRANSCRIPT.segments],
  }),
};

function audioRequest(
  id: string,
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3, 4]),
  name = "statement.wav",
): Request {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: "audio/wav" }));
  return new Request(`http://localhost/api/cases/${id}/transcribe`, {
    method: "POST",
    body: form,
  });
}

async function create(title: string): Promise<string> {
  const res = await createCase(
    new Request("http://localhost/api/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: title }),
    }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

let uploadDir: string;

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
  uploadDir = mkdtempSync(join(tmpdir(), "trace-uploads-"));
  process.env.TRACE_UPLOAD_DIR = uploadDir;
});

afterEach(() => {
  __setTranscribeClientForTests(undefined);
  delete process.env.TRACE_UPLOAD_DIR;
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("transcribe (lib)", () => {
  it("fake client returns a 2-speaker 3-segment resolution", async () => {
    const out = await transcribe(
      Buffer.from("fake-audio"),
      "statement.wav",
      fakeClient,
    );
    expect(out.text).toBe(FAKE_TRANSCRIPT.text);
    expect(out.segments).toHaveLength(3);
    expect(new Set(out.segments.map((s) => s.speaker)).size).toBe(2);
  });

  it("empty audio data throws", async () => {
    await expect(transcribe(Buffer.alloc(0), "empty.wav", fakeClient)).rejects.toThrow();
  });

  it("client errors are passed through", async () => {
    const failing = {
      transcribeAudio: async () => {
        throw new Error("service crashed");
      },
    };
    await expect(
      transcribe(Buffer.from("audio"), "a.wav", failing),
    ).rejects.toThrow("service crashed");
  });

  it("unresponsive client rejects with a short timeout", async () => {
    const hanging = {
      transcribeAudio: () => new Promise<never>(() => {}),
    };
    await expect(
      transcribe(Buffer.from("audio"), "a.wav", hanging, 20),
    ).rejects.toThrow(/timeout/i);
  });
});

describe("POST /api/cases/[id]/transcribe", () => {
  it("fake resolution text is written to the entry as a transcript", async () => {
    __setTranscribeClientForTests(fakeClient);
    const id = await create("audio case");

    const res = await transcribeAudio(audioRequest(id), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.entry).toMatchObject({
      caseId: id,
      type: "transcript",
      note: FAKE_TRANSCRIPT.text,
    });
    expect(body.transcript.segments).toHaveLength(3);

    // Entry is reflected in the case list.
    const list = await (await listCases()).json();
    const record = list.find((c: { id: string }) => c.id === id) as {
      entries: { type: string; note: string }[];
    };
    expect(record.entries).toHaveLength(1);
    expect(record.entries[0]).toMatchObject({
      type: "transcript",
      note: FAKE_TRANSCRIPT.text,
    });

    // Uploaded file is stored on disk.
    expect(readdirSync(uploadDir)).toHaveLength(1);
  });

  it("on service error returns 502, file still stored, no entry written", async () => {
    __setTranscribeClientForTests({
      transcribeAudio: async () => {
        throw new Error("service crashed");
      },
    });
    const id = await create("corrupt audio case");

    const res = await transcribeAudio(audioRequest(id), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);

    // File was stored.
    expect(readdirSync(uploadDir)).toHaveLength(1);
    expect(existsSync(join(uploadDir, readdirSync(uploadDir)[0]))).toBe(true);

    // No entry was written.
    const count = (
      getDb().prepare("SELECT COUNT(*) AS n FROM evidences").get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(0);
  });

  it("request without a file returns 400", async () => {
    __setTranscribeClientForTests(fakeClient);
    const id = await create("fileless case");
    const res = await transcribeAudio(
      new Request(`http://localhost/api/cases/${id}/transcribe`, {
        method: "POST",
        body: new FormData(),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for a missing record", async () => {
    __setTranscribeClientForTests(fakeClient);
    const res = await transcribeAudio(audioRequest("yok"), {
      params: Promise.resolve({ id: "yok" }),
    });
    expect(res.status).toBe(404);
  });
});
