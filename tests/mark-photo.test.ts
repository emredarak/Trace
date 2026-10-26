import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb, initDb } from "../lib/db";
import { markPhoto } from "../lib/mark-photo";
import {
  POST as createCase,
  GET as listCases,
} from "../app/api/cases/route";
import {
  POST as markPhotoRoute,
  __setMarkPhotoClientForTests,
} from "../app/api/cases/[id]/mark-photo/route";

// Sahte işaretleme: "bıçak" ipucuna 2 kutu.
const FAKE_BOXES = [
  { x: 0.1, y: 0.2, w: 0.3, h: 0.25, label: "bıçak" },
  { x: 0.55, y: 0.4, w: 0.2, h: 0.15, label: "bıçak" },
];

const fakeClient = {
  markImage: async () => ({ boxes: FAKE_BOXES.map((b) => ({ ...b })) }),
};

function photoRequest(
  id: string,
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3, 4]),
  name = "delil.jpg",
  hint = "bıçak",
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
  it("'bıçak' ipucuyla sahte yanıt 2 kutu döndürür", async () => {
    const out = await markPhoto(
      Buffer.from("sahte-fotograf"),
      "bıçak",
      fakeClient,
    );
    expect(out.boxes).toHaveLength(2);
    expect(out.boxes[0]).toMatchObject({ label: "bıçak" });
  });

  it("boş görüntü verisi hata verir", async () => {
    await expect(markPhoto(Buffer.alloc(0), "bıçak", fakeClient)).rejects.toThrow();
  });

  it("istemci hatası aynen iletilir", async () => {
    const failing = {
      markImage: async () => {
        throw new Error("sam çöktü");
      },
    };
    await expect(
      markPhoto(Buffer.from("foto"), "bıçak", failing),
    ).rejects.toThrow("sam çöktü");
  });
});

describe("POST /api/cases/[id]/mark-photo", () => {
  it("'bıçak' ipucuyla 2 kutu girişe yazılır", async () => {
    __setMarkPhotoClientForTests(fakeClient);
    const id = await create("fotoğraflı vaka");

    const res = await markPhotoRoute(photoRequest(id), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.boxes).toHaveLength(2);
    expect(body.entry).toMatchObject({ caseId: id });

    // Giriş vaka listesine yansır.
    const list = await (await listCases()).json();
    const record = list.find((c: { id: string }) => c.id === id) as {
      entries: { type: string; note: string }[];
    };
    expect(record.entries).toHaveLength(1);

    // Yüklenen dosya diskte saklanır.
    expect(readdirSync(uploadDir)).toHaveLength(1);
  });

  it("servis hatasında 502 döner, dosya yine saklanır, giriş yazılmaz", async () => {
    __setMarkPhotoClientForTests({
      markImage: async () => {
        throw new Error("sam çöktü");
      },
    });
    const id = await create("bozuk fotoğraflı vaka");

    const res = await markPhotoRoute(photoRequest(id), {
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
    __setMarkPhotoClientForTests(fakeClient);
    const id = await create("dosyasız vaka");
    const form = new FormData();
    form.append("hint", "bıçak");
    const res = await markPhotoRoute(
      new Request(`http://localhost/api/cases/${id}/mark-photo`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("olmayan kayda 404 döner", async () => {
    __setMarkPhotoClientForTests(fakeClient);
    const res = await markPhotoRoute(photoRequest("yok"), {
      params: Promise.resolve({ id: "yok" }),
    });
    expect(res.status).toBe(404);
  });
});
