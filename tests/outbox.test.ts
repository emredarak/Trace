import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createMemoryStore,
  createOutbox,
  type SyncReport,
} from "../lib/outbox";

function okJson(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

describe("çevrimdışı kuyruk ve eşitleme", () => {
  it("çevrimdışıyken 2 giriş kuyruğa girer, çevrimiçiyken ikisi de sırayla gönderilir", async () => {
    const calls: { url: string; body: unknown }[] = [];
    // Çevrimdışı: fetch her zaman patlar.
    const offlineFetch = async () => {
      throw new TypeError("fetch failed");
    };
    const outbox = createOutbox({
      store: createMemoryStore(),
      fetchFn: offlineFetch as unknown as typeof fetch,
    });

    await outbox.queue({
      url: "/api/cases/abc/entries",
      body: { type: "note", note: "birinci" },
    });
    await outbox.queue({
      url: "/api/cases/abc/entries",
      body: { type: "note", note: "ikinci" },
    });
    expect(await outbox.pending()).toBe(2);

    // Çevrimiçi: fetch başarır.
    const onlineFetch = async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      calls.push({ url, body: JSON.parse(init?.body as string) });
      return okJson({ ok: true });
    };
    outbox.setFetch(onlineFetch as unknown as typeof fetch);

    const report: SyncReport = await outbox.sync();

    expect(report.sent).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.conflicts).toBe(0);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/cases/abc/entries",
      "/api/cases/abc/entries",
    ]);
    // Sıra korunur: gövdeler kuyruğa giriş sırasıyla gider.
    expect(calls.map((c) => (c.body as { note: string }).note)).toEqual([
      "birinci",
      "ikinci",
    ]);
    expect(await outbox.pending()).toBe(0);
  });

  it("katı FIFO: ilk gönderim başarısız olursa sonrakiler denenmez", async () => {
    const calls: string[] = [];
    let mode: "fail-first" | "ok" = "fail-first";
    const outbox = createOutbox({
      store: createMemoryStore(),
      fetchFn: (async (_input: unknown, init?: RequestInit) => {
        const note = (JSON.parse(init?.body as string) as { note: string })
          .note;
        calls.push(note);
        if (mode === "fail-first" && note === "birinci") {
          return new Response("hata", { status: 500 });
        }
        return okJson({ ok: true });
      }) as unknown as typeof fetch,
    });
    await outbox.queue({
      url: "/api/cases/abc/entries",
      body: { type: "note", note: "birinci" },
    });
    await outbox.queue({
      url: "/api/cases/abc/entries",
      body: { type: "note", note: "ikinci" },
    });
    const first = await outbox.sync();
    expect(first.failed).toBe(1);
    // İkinci kayıt denenmedi: varış sırası kuyruk sırasını izler.
    expect(calls).toEqual(["birinci"]);
    expect(await outbox.pending()).toBe(2);
    mode = "ok";
    const second = await outbox.sync();
    expect(second.sent).toBe(2);
    expect(calls).toEqual(["birinci", "birinci", "ikinci"]);
    expect(await outbox.pending()).toBe(0);
  });

  it("çakışmada sunucu kaydı esas alınır (409 kuyruktan düşer)", async () => {
    const outbox = createOutbox({
      store: createMemoryStore(),
      fetchFn: (async () =>
        new Response(JSON.stringify({ error: "conflict" }), {
          status: 409,
        })) as unknown as typeof fetch,
    });
    await outbox.queue({
      url: "/api/cases/abc/entries",
      body: { type: "note", note: "çakışan" },
    });
    const report = await outbox.sync();
    expect(report.conflicts).toBe(1);
    expect(report.sent).toBe(0);
    expect(await outbox.pending()).toBe(0);
  });

  it("başarısız gönderim kuyrukta kalır, sonra tekrar denenir", async () => {
    let fail = true;
    const outbox = createOutbox({
      store: createMemoryStore(),
      fetchFn: (async () =>
        fail
          ? new Response("hata", { status: 500 })
          : okJson({ ok: true })) as unknown as typeof fetch,
    });
    await outbox.queue({
      url: "/api/cases",
      body: { summary: "tekrar" },
    });
    const first = await outbox.sync();
    expect(first.failed).toBe(1);
    expect(await outbox.pending()).toBe(1);
    fail = false;
    const second = await outbox.sync();
    expect(second.sent).toBe(1);
    expect(await outbox.pending()).toBe(0);
  });

  it("çevrimdışı çekilen fotoğraf Blob olarak saklanır, çevrimiçiyken dosyasıyla birlikte gider", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
    let receivedBytes: number[] = [];
    let receivedHint = "";
    const outbox = createOutbox({
      store: createMemoryStore(),
      fetchFn: (async (_input: unknown, init?: RequestInit) => {
        const form = init?.body as FormData;
        receivedHint = form.get("hint") as string;
        const f = form.get("file") as Blob;
        receivedBytes = Array.from(new Uint8Array(await f.arrayBuffer()));
        return okJson({ ok: true });
      }) as unknown as typeof fetch,
    });
    await outbox.queue({
      url: "/api/cases/abc/mark-photo",
      blob: file,
      blobName: "delil.jpg",
      meta: { hint: "kovan" },
    });
    expect(await outbox.pending()).toBe(1);
    const report = await outbox.sync();
    expect(report.sent).toBe(1);
    expect(receivedHint).toBe("kovan");
    expect(receivedBytes).toEqual([1, 2, 3, 4]);
    expect(await outbox.pending()).toBe(0);
  });
});

describe("public/sw.js", () => {
  it("POST /api/* isteklerini yakalar ve kuyruk mekanizması içerir", () => {
    const sw = readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8");
    expect(sw).toMatch(/POST/);
    expect(sw).toMatch(/PATCH/);
    expect(sw).toMatch(/DELETE/);
    expect(sw).toMatch(/locations/);
    expect(sw).toMatch(/\/api\//);
    expect(sw).toMatch(/fetch/);
    // Kuyruk sinyali: 202 kabul yanıtı + sync/flush mantığı.
    expect(sw).toMatch(/202/);
    expect(sw).toMatch(/sync/i);
    // Kuyruk yazılamazsa/gövde okunamazsa yeniden denenebilir 503 dönülür.
    expect(sw).toMatch(/503/);
    expect(sw).not.toMatch(/507/);
  });
});
