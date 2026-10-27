import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

// public/sw.js davranış testi: sahte fetch + sahte IndexedDB ile
// yakala → kuyruğa al → boşalt döngüsü node:vm içinde çalıştırılır.

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

function createFakeIdb() {
  const stores = new Map<string, { rows: Map<number, any>; nextId: number }>();
  let failing = false;
  const getStore = (name: string) => {
    let s = stores.get(name);
    if (!s) {
      s = { rows: new Map(), nextId: 1 };
      stores.set(name, s);
    }
    return s;
  };
  function op(fn: () => unknown, tx: any): any {
    const req: any = {};
    queueMicrotask(() => {
      if (failing) {
        req.onerror?.();
        tx.onerror?.();
        return;
      }
      req.result = fn();
      req.onsuccess?.();
      tx.oncomplete?.();
    });
    return req;
  }
  return {
    open() {
      const req: any = {};
      const db = {
        close() {},
        objectStoreNames: { contains: (n: string) => stores.has(n) },
        createObjectStore(n: string) {
          getStore(n);
          return {};
        },
        transaction(storeName: string) {
          const tx: any = {};
          tx.objectStore = () => {
            const st = getStore(storeName);
            return {
              add: (e: any) =>
                op(() => {
                  const id = st.nextId++;
                  st.rows.set(id, { ...e, id });
                  return id;
                }, tx),
              getAll: () => op(() => [...st.rows.values()], tx),
              delete: (id: number) =>
                op(() => {
                  st.rows.delete(id);
                }, tx),
            };
          };
          return tx;
        },
      };
      queueMicrotask(() => {
        req.result = db;
        req.onupgradeneeded?.();
      });
      queueMicrotask(() => {
        req.onsuccess?.();
      });
      return req;
    },
    setFailing(v: boolean) {
      failing = v;
    },
    count: () =>
      [...stores.values()].reduce((n, s) => n + s.rows.size, 0),
  };
}

function fakeRequest(
  method: string,
  path: string,
  opts: {
    text?: string;
    bytes?: Uint8Array;
    contentType?: string | null;
    unreadable?: boolean;
  } = {},
) {
  const contentType =
    opts.contentType === null
      ? null
      : (opts.contentType ?? "application/json");
  const headers = new Map<string, string>();
  if (contentType) headers.set("content-type", contentType);
  return {
    method,
    url: `http://localhost${path}`,
    headers: {
      forEach: (cb: (v: string, k: string) => void) =>
        headers.forEach((v, k) => cb(v, k)),
      get: (k: string) => headers.get(k.toLowerCase()) ?? null,
    },
    clone: () => ({
      text: async () => {
        if (opts.unreadable) throw new Error("body too large");
        return opts.text ?? "";
      },
      arrayBuffer: async () => {
        if (opts.unreadable) throw new Error("body too large");
        if (opts.bytes) return opts.bytes.buffer as ArrayBuffer;
        return new TextEncoder().encode(opts.text ?? "").buffer as ArrayBuffer;
      },
    }),
  };
}

function fakePost(
  path: string,
  opts: {
    text?: string;
    bytes?: Uint8Array;
    contentType?: string;
    unreadable?: boolean;
  } = {},
) {
  return fakeRequest("POST", path, opts);
}

function loadSw(fetchMock: FetchMock) {
  const listeners = new Map<string, (...a: any[]) => void>();
  const idb = createFakeIdb();
  const sandbox: any = {
    location: { origin: "http://localhost" },
    registration: {},
    clients: { claim: () => {} },
    addEventListener: (t: string, fn: (...a: any[]) => void) => {
      listeners.set(t, fn);
    },
    skipWaiting: () => {},
    indexedDB: idb,
    fetch: fetchMock,
    Response,
    URL,
  };
  sandbox.self = sandbox;
  const code = readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8");
  runInNewContext(code, sandbox);
  return { listeners, idb, sandbox };
}

async function dispatchFetch(listeners: Map<string, Function>, request: any) {
  let p: Promise<Response> | undefined;
  (listeners.get("fetch") as Function)({
    request,
    respondWith: (x: Promise<Response>) => {
      p = x;
    },
  });
  return await p!;
}

async function dispatchSync(listeners: Map<string, Function>) {
  let p: Promise<unknown> | undefined;
  (listeners.get("sync") as Function)({
    tag: "trace-outbox-sync",
    waitUntil: (x: Promise<unknown>) => {
      p = x;
    },
  });
  await p!;
}

function offline(): FetchMock {
  return async () => {
    throw new TypeError("fetch failed");
  };
}

describe("sw.js çevrimdışı kuyruk döngüsü", () => {
  it("yakala → 202 kuyruk → bağlantıda sırayla boşalt", async () => {
    const { listeners, idb, sandbox } = loadSw(offline());

    const res = await dispatchFetch(
      listeners,
      fakePost("/api/cases/abc/entries", {
        text: JSON.stringify({ type: "note", note: "saha notu" }),
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ queued: true });
    expect(idb.count()).toBe(1);

    const calls: { url: string; body: string }[] = [];
    sandbox.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }) as FetchMock;
    await dispatchSync(listeners);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/cases/abc/entries");
    expect(JSON.parse(calls[0].body)).toMatchObject({ note: "saha notu" });
    expect(idb.count()).toBe(0);
  });

  it("multipart gövde birebir oynatılır, ilk hatada durulur (katı FIFO)", async () => {
    const { listeners, idb, sandbox } = loadSw(offline());
    const photo = new Uint8Array([9, 8, 7, 6]);
    const boundary = "multipart/form-data; boundary=----sinir123";

    await dispatchFetch(
      listeners,
      fakePost("/api/cases/abc/entries", {
        text: JSON.stringify({ type: "note", note: "önce" }),
      }),
    );
    await dispatchFetch(
      listeners,
      fakePost("/api/cases/abc/mark-photo", {
        bytes: photo,
        contentType: boundary,
      }),
    );
    expect(idb.count()).toBe(2);

    // İlk kayıt 500 verirse ikinci denenmez.
    const calls: { url: string; init?: RequestInit }[] = [];
    sandbox.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response("hata", { status: 500 });
    }) as FetchMock;
    await dispatchSync(listeners);
    expect(calls).toHaveLength(1);
    expect(idb.count()).toBe(2);

    // Bağlantı düzelince ikisi de sırayla, fotoğraf baytları aynen gider.
    sandbox.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }) as FetchMock;
    await dispatchSync(listeners);
    // 1 (önceki deneme) + 2 (not + foto) = 3 çağrı, son ikisi sırayla.
    expect(calls.map((c) => c.url).slice(1)).toEqual([
      "/api/cases/abc/entries",
      "/api/cases/abc/mark-photo",
    ]);
    const photoInit = calls[2].init!;
    const sentType = (photoInit.headers as Record<string, string>)[
      "content-type"
    ];
    expect(sentType).toBe(boundary);
    expect(Array.from(new Uint8Array(photoInit.body as ArrayBuffer))).toEqual(
      [9, 8, 7, 6],
    );
    expect(idb.count()).toBe(0);
  });

  it("çevrimdışı PATCH konum isteği kuyruğa girer ve aynı yöntem/gövdeyle oynatılır", async () => {
    const { listeners, idb, sandbox } = loadSw(offline());

    const res = await dispatchFetch(
      listeners,
      fakeRequest("PATCH", "/api/cases/abc/locations/l1", {
        text: JSON.stringify({ label: "yeni etiket" }),
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ queued: true });
    expect(idb.count()).toBe(1);

    const calls: { url: string; init?: RequestInit }[] = [];
    sandbox.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as FetchMock;
    await dispatchSync(listeners);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/cases/abc/locations/l1");
    expect(calls[0].init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init?.body as string)).toMatchObject({
      label: "yeni etiket",
    });
    expect(idb.count()).toBe(0);
  });

  it("çevrimdışı DELETE konum isteği (gövdesiz) kuyruğa girer ve DELETE olarak oynatılır", async () => {
    const { listeners, idb, sandbox } = loadSw(offline());

    const res = await dispatchFetch(
      listeners,
      fakeRequest("DELETE", "/api/cases/abc/locations/l1", {
        contentType: null,
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ queued: true });
    expect(idb.count()).toBe(1);

    const calls: { url: string; init?: RequestInit }[] = [];
    sandbox.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as FetchMock;
    await dispatchSync(listeners);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/cases/abc/locations/l1");
    expect(calls[0].init?.method).toBe("DELETE");
    expect(calls[0].init?.body ?? undefined).toBeFalsy();
    expect(idb.count()).toBe(0);
  });

  it("koleksiyon yolundaki PATCH/DELETE (locId yok) yakalanmaz", async () => {
    const { listeners, idb } = loadSw(offline());
    for (const method of ["PATCH", "DELETE"] as const) {
      const res = await dispatchFetch(
        listeners,
        fakeRequest(method, "/api/cases/abc/locations", {
          text: method === "PATCH" ? JSON.stringify({ title: "x" }) : "",
          contentType: method === "PATCH" ? undefined : null,
        }),
      );
      expect(res).toBeUndefined();
    }
    expect(idb.count()).toBe(0);
  });

  it("konum dışı PATCH yakalanmaz", async () => {
    const { listeners, idb } = loadSw(offline());
    const res = await dispatchFetch(
      listeners,
      fakeRequest("PATCH", "/api/cases/abc", {
        text: JSON.stringify({ summary: "güncelle" }),
      }),
    );
    // respondWith çağrılmadı: SW isteğe dokunmadı, tarayıcı normal gönderir.
    expect(res).toBeUndefined();
    expect(idb.count()).toBe(0);
  });

  it("gövde okunamazsa 503 {queued:false} döner, kayıt kaybolmaz", async () => {
    const { listeners, idb } = loadSw(offline());
    const res = await dispatchFetch(
      listeners,
      fakePost("/api/cases/abc/entries", { unreadable: true }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ queued: false });
    expect(idb.count()).toBe(0);
  });

  it("kuyruğa yazılamazsa 503 {queued:false} döner", async () => {
    const { listeners, idb } = loadSw(offline());
    idb.setFailing(true);
    const res = await dispatchFetch(
      listeners,
      fakePost("/api/cases/abc/entries", {
        text: JSON.stringify({ type: "note" }),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ queued: false });
  });
});
