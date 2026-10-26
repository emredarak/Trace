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

// Sahte çözüm: iki konuşmacı, 3 bölüm.
const FAKE_TRANSCRIPT = {
  text: "konusmaci 1: gece gordum. konusmaci 2: plakayi aldim. konusmaci 1: sonra kacti.",
  segments: [
    { speaker: "konusmaci 1", text: "gece gordum" },
    { speaker: "konusmaci 2", text: "plakayi aldim" },
    { speaker: "konusmaci 1", text: "sonra kacti" },
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
  name = "ifade.wav",
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
  it("sahte istemci iki konuşmacılı 3 bölümlük çözümü döndürür", async () => {
    const out = await transcribe(
      Buffer.from("sahte-ses"),
      "ifade.wav",
      fakeClient,
    );
    expect(out.text).toBe(FAKE_TRANSCRIPT.text);
    expect(out.segments).toHaveLength(3);
    expect(new Set(out.segments.map((s) => s.speaker)).size).toBe(2);
  });

  it("boş ses verisi hata verir", async () => {
    await expect(transcribe(Buffer.alloc(0), "bos.wav", fakeClient)).rejects.toThrow();
  });

  it("istemci hatası aynen iletilir", async () => {
    const failing = {
      transcribeAudio: async () => {
        throw new Error("servis çöktü");
      },
    };
    await expect(
      transcribe(Buffer.from("ses"), "a.wav", failing),
    ).rejects.toThrow("servis çöktü");
  });
});

describe("POST /api/cases/[id]/transcribe", () => {
  it("sahte çözüm metni girişe transcript olarak yazılır", async () => {
    __setTranscribeClientForTests(fakeClient);
    const id = await create("sesli vaka");

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

    // Giriş vaka listesine yansır.
    const list = await (await listCases()).json();
    const record = list.find((c: { id: string }) => c.id === id) as {
      entries: { type: string; note: string }[];
    };
    expect(record.entries).toHaveLength(1);
    expect(record.entries[0]).toMatchObject({
      type: "transcript",
      note: FAKE_TRANSCRIPT.text,
    });

    // Yüklenen dosya diskte saklanır.
    expect(readdirSync(uploadDir)).toHaveLength(1);
  });

  it("servis hatasında 502 döner, dosya yine saklanır, giriş yazılmaz", async () => {
    __setTranscribeClientForTests({
      transcribeAudio: async () => {
        throw new Error("servis çöktü");
      },
    });
    const id = await create("bozuk sesli vaka");

    const res = await transcribeAudio(audioRequest(id), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);

    // Dosya saklanmıştır.
    expect(readdirSync(uploadDir)).toHaveLength(1);
    expect(existsSync(join(uploadDir, readdirSync(uploadDir)[0]))).toBe(true);

    // Giriş yazılmamıştır.
    const count = (
      getDb().prepare("SELECT COUNT(*) AS n FROM evidences").get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(0);
  });

  it("dosyasız istek 400 döner", async () => {
    __setTranscribeClientForTests(fakeClient);
    const id = await create("dosyasız vaka");
    const res = await transcribeAudio(
      new Request(`http://localhost/api/cases/${id}/transcribe`, {
        method: "POST",
        body: new FormData(),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("olmayan kayda 404 döner", async () => {
    __setTranscribeClientForTests(fakeClient);
    const res = await transcribeAudio(audioRequest("yok"), {
      params: Promise.resolve({ id: "yok" }),
    });
    expect(res.status).toBe(404);
  });
});
