import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb, initDb } from "../lib/db";
import { markPhoto, __setMarkPhotoClientForTests } from "../lib/mark-photo";
import {
  POST as createCase,
  GET as listCases,
} from "../app/api/cases/route";
import { POST as markPhotoRoute } from "../app/api/cases/[id]/mark-photo/route";

// Fake marking: 2 boxes for the knife hint.
const FAKE_BOXES = [
  { x: 0.1, y: 0.2, w: 0.3, h: 0.25, label: "knife" },
  { x: 0.55, y: 0.4, w: 0.2, h: 0.15, label: "knife" },
];

const fakeClient = {
  markImage: async () => ({ boxes: FAKE_BOXES.map((b) => ({ ...b })) }),
};

function photoRequest(
  id: string,
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3, 4]),
  name = "evidence.jpg",
  hint = "knife",
): Request {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: "image/jpeg" }));
  form.append("hint", hint);
  return new Request(`http://localhost/api/cases/${id}/mark-photo`, {
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
  __setMarkPhotoClientForTests(undefined);
  delete process.env.TRACE_UPLOAD_DIR;
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("markPhoto (lib)", () => {
  it("fake response for the knife hint returns 2 boxes", async () => {
    const out = await markPhoto(
      Buffer.from("fake-photo"),
      "knife",
      fakeClient,
    );
    expect(out.boxes).toHaveLength(2);
    expect(out.boxes[0]).toMatchObject({ label: "knife" });
  });

  it("empty image data throws", async () => {
    await expect(markPhoto(Buffer.alloc(0), "knife", fakeClient)).rejects.toThrow();
  });

  it("client errors are passed through", async () => {
    const failing = {
      markImage: async () => {
        throw new Error("sam crashed");
      },
    };
    await expect(
      markPhoto(Buffer.from("photo"), "knife", failing),
    ).rejects.toThrow("sam crashed");
  });

  it("unresponsive client rejects with a short timeout", async () => {
    const hanging = {
      markImage: () => new Promise<never>(() => {}),
    };
    await expect(
      markPhoto(Buffer.from("photo"), "knife", hanging, 20),
    ).rejects.toThrow(/timeout/i);
  });
});

describe("POST /api/cases/[id]/mark-photo", () => {
  it("2 boxes for the knife hint are written to the entry", async () => {
    __setMarkPhotoClientForTests(fakeClient);
    const id = await create("photo case");

    const res = await markPhotoRoute(photoRequest(id), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.boxes).toHaveLength(2);
    expect(body.entry).toMatchObject({ caseId: id });

    // Entry is reflected in the case list.
    const list = await (await listCases()).json();
    const record = list.find((c: { id: string }) => c.id === id) as {
      entries: { type: string; note: string }[];
    };
    expect(record.entries).toHaveLength(1);

    // Uploaded file is stored on disk.
    expect(readdirSync(uploadDir)).toHaveLength(1);
  });

  it("on service error returns 502, file still stored, no entry written", async () => {
    __setMarkPhotoClientForTests({
      markImage: async () => {
        throw new Error("sam crashed");
      },
    });
    const id = await create("corrupt photo case");

    const res = await markPhotoRoute(photoRequest(id), {
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
    __setMarkPhotoClientForTests(fakeClient);
    const id = await create("fileless case");
    const form = new FormData();
    form.append("hint", "knife");
    const res = await markPhotoRoute(
      new Request(`http://localhost/api/cases/${id}/mark-photo`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for a missing record", async () => {
    __setMarkPhotoClientForTests(fakeClient);
    const res = await markPhotoRoute(photoRequest("yok"), {
      params: Promise.resolve({ id: "yok" }),
    });
    expect(res.status).toBe(404);
  });
});
