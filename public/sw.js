/* Trace MVP service worker.
 *
 * POST /api/* isteklerini çevrimdışıyken IndexedDB kuyruğuna alır (202 ile),
 * bağlantı dönünce sırayla tekrar gönderir. Çakışmada (HTTP 409) sunucu kaydı
 * esas alınır: kuyruktaki kopya silinir.
 *
 * Not: fotoğraf/video gibi multipart gövdeler ArrayBuffer olarak aynen
 * saklanır ve orijinal Content-Type (boundary dahil) ile birebir geri
 * oynatılır. Gövde okunamaz ya da kuyruğa yazılamazsa 503 {queued:false}
 * dönülür; kayıt kaybolmaz, arayan taslağı elinde tutar.
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
  // Başlıklar ve gövde birebir korunur: multipart yüklemeler orijinal
  // Content-Type (boundary dahil) ile aynen geri oynatılır.
  const headers = Object.assign({}, entry.headers);
  const init = { method: entry.method || "POST", headers };
  if (entry.bodyBuffer) {
    init.body = entry.bodyBuffer;
  } else if (typeof entry.bodyText === "string") {
    init.body = entry.bodyText;
  }
  const res = await fetch(entry.url, init);
  if (res.ok || res.status === 409) {
    // 409: sunucu kaydı esas, yerel kopya düşer.
    await removeEntry(entry.id);
    return "done";
  }
  // Sunucu hatası: katı FIFO için patlat, flushQueue dursun; kayıt kalır.
  throw new Error("outbox replay failed: http " + res.status);
}

async function flushQueue() {
  const all = await readAll();
  for (const entry of all) {
    // İlk hatada dur (ağ ya da sunucu): varış sırası kuyruk sırasıyla aynı kalır.
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
  if (req.method !== "POST") return;
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      const headers = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const contentType = req.headers.get("content-type") || "";
      const entry = {
        url: url.pathname + url.search,
        method: "POST",
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
        // Gövde okunamadı (çok büyük dosya olabilir): kayıt kuyruğa girmedi,
        // arayan taslağı elinde tutsun diye yeniden denenebilir 503 dön.
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
          // Kuyruğa yazılamadı: 503 dön, arayan form verisini saklasın.
          return new Response(
            JSON.stringify({ queued: false, error: "kuyruk yazılamadı" }),
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

// Background Sync (destekleyen tarayıcılar).
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushQueue());
  }
});

// Desteklemeyenler için (örn. iOS Safari): sayfa "FLUSH_OUTBOX" yollar.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FLUSH_OUTBOX") {
    if (event.waitUntil) event.waitUntil(flushQueue());
    else flushQueue();
  }
});
