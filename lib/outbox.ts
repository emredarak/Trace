// Çevrimdışı giden kutusu (outbox).
//
// Tarayıcıda IndexedDB destekli FIFO kuyruk; IndexedDB yoksa (ör. test/SSR)
// bellek içi depoya düşer. Sıra korunur, çakışmada (HTTP 409) sunucu kaydı
// esas alınır: yerel kopya silinir, rapor artar.
//
// Fotoğraf/ses gibi dosyalar Blob olarak kaydın içinde saklanır; IndexedDB
// Blob'u yapısal klonla kalıcı tutar, sync() sırasında FormData ile geri
// gönderilir ("file" alanı + meta alanları).

export interface OutboxInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** JSON olarak gönderilecek gövde. */
  body?: unknown;
  /** Önceden serileştirilmiş gövde (verilirse body yerine kullanılır). */
  rawBody?: string;
  /** Çevrimdışı çekilen dosya; meta ile birlikte FormData olarak gönderilir. */
  blob?: Blob;
  blobName?: string;
  /** Blob ile birlikte gönderilecek metin alanları (örn. { hint }). */
  meta?: Record<string, unknown>;
}

export interface QueuedEntry {
  id: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText?: string;
  contentType?: string;
  blob?: Blob;
  blobName?: string;
  meta?: Record<string, unknown>;
  enqueuedAt: number;
  attempts: number;
}

export type SyncItemStatus = "sent" | "conflict" | "failed";

export interface SyncItemResult {
  id: number;
  url: string;
  status: SyncItemStatus;
  detail?: string;
}

export interface SyncReport {
  sent: number;
  conflicts: number;
  failed: number;
  items: SyncItemResult[];
}

export interface OutboxStore {
  add(entry: Omit<QueuedEntry, "id">): Promise<number>;
  all(): Promise<QueuedEntry[]>;
  update(entry: QueuedEntry): Promise<void>;
  remove(id: number): Promise<void>;
  clear(): Promise<void>;
}

export type FetchFn = typeof fetch;

export function createMemoryStore(): OutboxStore {
  const rows = new Map<number, QueuedEntry>();
  let nextId = 1;
  return {
    async add(entry) {
      const id = nextId++;
      rows.set(id, { ...entry, id });
      return id;
    },
    async all() {
      return [...rows.values()].sort((a, b) => a.id - b.id);
    },
    async update(entry) {
      rows.set(entry.id, { ...entry });
    },
    async remove(id) {
      rows.delete(id);
    },
    async clear() {
      rows.clear();
    },
  };
}

export function createIndexedDBStore(
  dbName = "trace-outbox",
  storeName = "requests",
): OutboxStore {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) {
          req.result.createObjectStore(storeName, {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    });
  }

  function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          let value: T;
          tx.oncomplete = () => {
            db.close();
            resolve(value);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error ?? new Error("indexedDB transaction failed"));
          };
          const req = run(tx.objectStore(storeName));
          req.onsuccess = () => {
            value = req.result;
          };
        }),
    );
  }

  return {
    async add(entry) {
      const key = await withStore("readwrite", (s) => s.add(entry));
      return key as number;
    },
    async all() {
      const rows = await withStore("readonly", (s) =>
        s.getAll() as IDBRequest<QueuedEntry[]>,
      );
      return (rows ?? []).sort((a, b) => a.id - b.id);
    },
    async update(entry) {
      await withStore("readwrite", (s) => s.put(entry));
    },
    async remove(id) {
      await withStore("readwrite", (s) => s.delete(id));
    },
    async clear() {
      await withStore("readwrite", (s) => s.clear());
    },
  };
}

export interface OutboxDeps {
  store?: OutboxStore;
  fetchFn?: FetchFn;
}

export interface Outbox {
  queue(req: OutboxInput): Promise<number>;
  sync(): Promise<SyncReport>;
  pending(): Promise<number>;
  clear(): Promise<void>;
  setFetch(fetchFn: FetchFn): void;
}

function contentTypeOf(headers: Record<string, string>): string | undefined {
  const hit = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === "content-type",
  );
  return hit?.[1];
}

export function createOutbox(deps: OutboxDeps = {}): Outbox {
  const store = deps.store ?? createMemoryStore();
  let fetchFn: FetchFn =
    deps.fetchFn ?? ((...args) => globalThis.fetch(...args));

  async function queue(req: OutboxInput): Promise<number> {
    if (!req || typeof req.url !== "string" || req.url.length === 0) {
      throw new Error("outbox.queue: url gerekli");
    }
    const headers = { ...(req.headers ?? {}) };
    let bodyText: string | undefined;
    let contentType = contentTypeOf(headers);
    if (req.blob) {
      // Dosya gönderiminde sınır başlığını fetch üretir; elle konmuş
      // multipart content-type bayat boundary taşır, temizle.
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === "content-type") delete headers[k];
      }
      contentType = undefined;
    } else if (req.rawBody !== undefined) {
      bodyText = req.rawBody;
      contentType ??= "text/plain";
    } else if (req.body !== undefined) {
      bodyText = JSON.stringify(req.body);
      contentType ??= "application/json";
    }
    return store.add({
      url: req.url,
      method: (req.method ?? "POST").toUpperCase(),
      headers,
      bodyText,
      contentType,
      blob: req.blob,
      blobName: req.blobName,
      meta: req.meta ? { ...req.meta } : undefined,
      enqueuedAt: Date.now(),
      attempts: 0,
    });
  }

  function buildInit(entry: QueuedEntry): RequestInit {
    if (entry.blob) {
      const form = new FormData();
      for (const [k, v] of Object.entries(entry.meta ?? {})) {
        form.append(k, typeof v === "string" ? v : JSON.stringify(v));
      }
      form.append("file", entry.blob, entry.blobName ?? "upload.bin");
      return { method: entry.method, headers: entry.headers, body: form };
    }
    const headers = { ...entry.headers };
    if (entry.bodyText !== undefined && !contentTypeOf(headers)) {
      headers["Content-Type"] = entry.contentType ?? "application/json";
    }
    return {
      method: entry.method,
      headers,
      body: entry.bodyText,
    };
  }

  async function sync(): Promise<SyncReport> {
    const report: SyncReport = { sent: 0, conflicts: 0, failed: 0, items: [] };
    const entries = await store.all();
    for (const entry of entries) {
      entry.attempts += 1;
      await store.update(entry);
      let res: Response;
      try {
        res = await fetchFn(entry.url, buildInit(entry));
      } catch (err) {
        report.failed += 1;
        report.items.push({
          id: entry.id,
          url: entry.url,
          status: "failed",
          detail: (err as Error)?.message ?? "network error",
        });
        continue;
      }
      if (res.ok) {
        await store.remove(entry.id);
        report.sent += 1;
        report.items.push({ id: entry.id, url: entry.url, status: "sent" });
      } else if (res.status === 409) {
        // Çakışma: sunucu kaydı esas alınır, yerel kopya düşer.
        await store.remove(entry.id);
        report.conflicts += 1;
        report.items.push({
          id: entry.id,
          url: entry.url,
          status: "conflict",
          detail: "server record wins",
        });
      } else {
        report.failed += 1;
        report.items.push({
          id: entry.id,
          url: entry.url,
          status: "failed",
          detail: `http ${res.status}`,
        });
      }
    }
    return report;
  }

  return {
    queue,
    sync,
    async pending() {
      return (await store.all()).length;
    },
    clear() {
      return store.clear();
    },
    setFetch(next: FetchFn) {
      fetchFn = next;
    },
  };
}

// Varsayılan tekil kutu: tarayıcıda IndexedDB, yoksa bellek.
let singleton: Outbox | null = null;

function defaultOutbox(): Outbox {
  if (!singleton) {
    const store =
      typeof indexedDB !== "undefined"
        ? createIndexedDBStore()
        : createMemoryStore();
    singleton = createOutbox({ store });
  }
  return singleton;
}

export function queue(req: OutboxInput): Promise<number> {
  return defaultOutbox().queue(req);
}

export function sync(): Promise<SyncReport> {
  return defaultOutbox().sync();
}

export function pending(): Promise<number> {
  return defaultOutbox().pending();
}

/** Bağlantı dönünce kuyruğu boşaltmayı dener; durdurma işlevi döner. */
export function startAutoSync(
  onReport?: (report: SyncReport) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let stopped = false;
  const flush = () => {
    if (stopped) return;
    sync()
      .then((report) => onReport?.(report))
      .catch(() => {});
  };
  window.addEventListener("online", flush);
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => {
          const r = reg as unknown as {
            sync?: { register(tag: string): Promise<void> };
          };
          return r.sync?.register("trace-outbox-sync");
        })
        .catch(() => {});
    }
  } catch {
    /* kayıt desteklenmiyorsa yoksay */
  }
  return () => {
    stopped = true;
    window.removeEventListener("online", flush);
  };
}
