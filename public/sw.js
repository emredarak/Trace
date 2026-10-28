/* Trace MVP service worker.
 *
 * Queues POST /api/* requests and PATCH/DELETE requests on
 * /api/cases/<id>/locations/<locId> and /api/cases/<id>/persons/<personId>
 * paths into the IndexedDB queue while offline (202),
 * then replays them in order when connectivity returns. On conflict (HTTP 409)
 * the server record wins: the queued copy is deleted.
 *
 * Note: multipart bodies such as photos/videos are stored verbatim as ArrayBuffers
 * and replayed byte-for-byte with the original Content-Type (boundary included).
 * When the body cannot be read or queued, a retryable 503 {queued:false}
 * is returned; the record is not lost and the caller keeps its draft.
 */
"use strict";

const DB_NAME = "trace-outbox";
const STORE_NAME = "requests";
const SYNC_TAG = "trace-outbox-sync";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error || new Error("indexedDB open failed"));
  });
}

function withStore(mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        let value;
        tx.oncomplete = () => {
          db.close();
          resolve(value);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error("indexedDB transaction failed"));
        };
        const req = run(tx.objectStore(STORE_NAME));
        req.onsuccess = () => {
          value = req.result;
        };
      }),
  );
}

function enqueue(entry) {
  return withStore("readwrite", (s) => s.add(entry));
}

function readAll() {
  return withStore("readonly", (s) => s.getAll()).then((rows) =>
    (rows || []).sort((a, b) => a.id - b.id),
  );
}

function removeEntry(id) {
  return withStore("readwrite", (s) => s.delete(id));
}

function scheduleSync() {
  if (
    self.registration &&
    self.registration.sync &&
    typeof self.registration.sync.register === "function"
  ) {
    return self.registration.sync
      .register(SYNC_TAG)
      .catch(() => undefined);
  }
  return Promise.resolve();
}

async function replay(entry) {
  // Headers and body are preserved verbatim: multipart uploads are replayed
  // exactly with the original Content-Type (including boundary).
  const headers = Object.assign({}, entry.headers);
  const init = { method: entry.method || "POST", headers };
  if (entry.bodyBuffer && entry.bodyBuffer.byteLength) {
    init.body = entry.bodyBuffer;
  } else if (typeof entry.bodyText === "string" && entry.bodyText.length > 0) {
    init.body = entry.bodyText;
  }
  const res = await fetch(entry.url, init);
  if (res.ok || res.status === 409) {
    // 409: the server record wins, the local copy is dropped.
    await removeEntry(entry.id);
    return "done";
  }
  // Server error: throw for strict FIFO so flushQueue stops; the record stays.
  throw new Error("outbox replay failed: http " + res.status);
}

async function flushQueue() {
  const all = await readAll();
  for (const entry of all) {
    // Stop at the first error (network or server): arrival order stays the same as queue order.
    try {
      await replay(entry);
    } catch (err) {
      break;
    }
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/api/")) return;
  const isItemMutation =
    (req.method === "PATCH" || req.method === "DELETE") &&
    /^\/api\/cases\/[^/]+\/(?:locations|persons)\/[^/]+\/?$/.test(url.pathname);
  if (req.method !== "POST" && !isItemMutation) return;

  event.respondWith(
    (async () => {
      const headers = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const contentType = req.headers.get("content-type") || "";
      const entry = {
        url: url.pathname + url.search,
        method: req.method,
        headers,
        enqueuedAt: Date.now(),
        attempts: 0,
      };
      try {
        if (contentType.startsWith("multipart/form-data")) {
          entry.bodyBuffer = await req.clone().arrayBuffer();
        } else {
          entry.bodyText = await req.clone().text();
          if (!headers["content-type"] && contentType) {
            headers["content-type"] = contentType;
          }
        }
      } catch (err) {
        // Body unreadable (possibly a very large file): the record never entered the queue,
        // return a retryable 503 so the caller keeps its draft.
        return new Response(JSON.stringify({ queued: false }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      try {
        const res = await fetch(req);
        return res;
      } catch (err) {
        try {
          await enqueue(entry);
        } catch (dbErr) {
          // Queue write failed: return 503 so the caller keeps the form data.
          return new Response(
            JSON.stringify({ queued: false, error: "queue write failed" }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        await scheduleSync();
        return new Response(JSON.stringify({ queued: true }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
    })(),
  );
});

// Background Sync (supporting browsers).
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushQueue());
  }
});

// For non-supporters (e.g. iOS Safari): the page sends "FLUSH_OUTBOX".
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FLUSH_OUTBOX") {
    if (event.waitUntil) event.waitUntil(flushQueue());
    else flushQueue();
  }
});
