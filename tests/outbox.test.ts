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

describe("offline queue and sync", () => {
  it("offline queues 2 entries, online sends both in order", async () => {
    const calls: { url: string; body: unknown }[] = [];
    // Offline: fetch always throws.
    const offlineFetch = async () => {
      throw new TypeError("fetch failed");
    };
    const outbox = createOutbox({
      store: createMemoryStore(),
      fetchFn: offlineFetch as unknown as typeof fetch,
    });

    await outbox.queue({
      url: "/api/cases/abc/entries",
      body: { type: "note", note: "first" },
    });
    await outbox.queue({
      url: "/api/cases/abc/entries",
      body: { type: "note", note: "second" },
    });
    expect(await outbox.pending()).toBe(2);

    // Online: fetch succeeds.
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
    // Order preserved: bodies go in queue insertion order.
    expect(calls.map((c) => (c.body as { note: string }).note)).toEqual([
      "first",
      "second",
    ]);
    expect(await outbox.pending()).toBe(0);
  });

  it("strict FIFO: if the first send fails, later ones are not attempted", async () => {
    const calls: string[] = [];
    let mode: "fail-first" | "ok" = "fail-first";
    const outbox = createOutbox({
      store: createMemoryStore(),
      fetchFn: (async (_input: unknown, init?: RequestInit) => {
        const note = (JSON.parse(init?.body as string) as { note: string })
          .note;
        calls.push(note);
        if (mode === "fail-first" && note === "first") {
          return new Response("hata", { status: 500 });
        }
        return okJson({ ok: true });
      }) as unknown as typeof fetch,
    });
    await outbox.queue({
      url: "/api/cases/abc/entries",
      body: { type: "note", note: "first" },
    });
    await outbox.queue({
      url: "/api/cases/abc/entries",
      body: { type: "note", note: "second" },
    });
    const first = await outbox.sync();
    expect(first.failed).toBe(1);
    // Second record not attempted: arrival order follows queue order.
    expect(calls).toEqual(["first"]);
    expect(await outbox.pending()).toBe(2);
    mode = "ok";
    const second = await outbox.sync();
    expect(second.sent).toBe(2);
    expect(calls).toEqual(["first", "first", "second"]);
    expect(await outbox.pending()).toBe(0);
  });

  it("on conflict the server record wins (409 drops from queue)", async () => {
    const outbox = createOutbox({
      store: createMemoryStore(),
      fetchFn: (async () =>
        new Response(JSON.stringify({ error: "conflict" }), {
          status: 409,
        })) as unknown as typeof fetch,
    });
    await outbox.queue({
      url: "/api/cases/abc/entries",
      body: { type: "note", note: "conflicting" },
    });
    const report = await outbox.sync();
    expect(report.conflicts).toBe(1);
    expect(report.sent).toBe(0);
    expect(await outbox.pending()).toBe(0);
  });

  it("failed sends stay queued, then retried", async () => {
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
      body: { summary: "retry" },
    });
    const first = await outbox.sync();
    expect(first.failed).toBe(1);
    expect(await outbox.pending()).toBe(1);
    fail = false;
    const second = await outbox.sync();
    expect(second.sent).toBe(1);
    expect(await outbox.pending()).toBe(0);
  });

  it("offline-taken photo is stored as Blob, sent with its file when online", async () => {
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
      blobName: "evidence.jpg",
      meta: { hint: "casing" },
    });
    expect(await outbox.pending()).toBe(1);
    const report = await outbox.sync();
    expect(report.sent).toBe(1);
    expect(receivedHint).toBe("casing");
    expect(receivedBytes).toEqual([1, 2, 3, 4]);
    expect(await outbox.pending()).toBe(0);
  });
});

describe("public/sw.js", () => {
  it("captures POST /api/* requests and includes queue machinery", () => {
    const sw = readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8");
    expect(sw).toMatch(/POST/);
    expect(sw).toMatch(/PATCH/);
    expect(sw).toMatch(/DELETE/);
    expect(sw).toMatch(/locations/);
    expect(sw).toMatch(/\/api\//);
    expect(sw).toMatch(/fetch/);
    // Queue signal: 202 accept response + sync/flush logic.
    expect(sw).toMatch(/202/);
    expect(sw).toMatch(/sync/i);
    // Returns retryable 503 when the queue is unwritable or the body unreadable.
    expect(sw).toMatch(/503/);
    expect(sw).not.toMatch(/507/);
  });
});
