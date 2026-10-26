# Trace MVP — 3 Dakikalık Demo Akış Metni

Kurgu veriyle çekilir. Tüm vaka ve kişiler hayal ürünüdür (`seed/cases.json`,
`TR-SEED-*`, özetlerde `[Kurgu]` öneki). Gerçek vaka ve kişisel veri kullanmayın.

## 0:00–0:30 — Kurulum

1. Bağımlılıkları kurun: `npm install`.
2. Geliştirme sunucusunu başlatın: `npm run dev` (`http://localhost:3000`).
3. 32 kurgu vakayı yükleyin: `TRACE_BASE_URL=http://localhost:3000 node seed/seed.ts`
   (`seed/seed.ts` gerçek `POST /api/cases` zincirini kullanır; `TR-SEED-01…05`
   su kenarı | bıçak | gece arkadan yaklaşma seri kümesidir).
   PowerShell: `$env:TRACE_BASE_URL="http://localhost:3000"; node seed/seed.ts`
   (ya da kısaca `npm run seed` — aynı adrese yükler; Node 22.6+ gerekir).
4. Telefonu hazırlayın: mobil görünüm, konum izni sorulursa "bir kez izin ver".

## 0:30–1:10 — Telefonla vaka girişi (`/new`)

1. "Yeni Vaka"yı açın; üstte "Konum bekleniyor." yazar, GPS gelince "Konum alındı."
   olur (GPS yoksa "konum metni yeterli" — metinle devam edilir).
2. Özet yazın (zorunlu): "Gece göl kıyısında olta takımları çalındı; şüpheli
   arkadan yaklaşıp bıçak gösterdi."
3. Suç tipi: `hırsızlık` (öneri listesinden), konum metni: "kuzey gölü kıyısı,
   4 No'lu iskele". "Vakayı Aç"a basın → "Vaka açıldı: TR-00XX" ekranı ve
   "Delil ekle" bağlantısı.

## 1:10–2:00 — Benzer vaka listesi (`/cases/[id]`)

1. Vaka detayını açın: özet, suç tipi, konum, yöntem, silah kartları.
2. "Benzer vakalar" paneli `GET /api/cases/[id]/similar` sonucudur
   (ön filtre → yeniden sıralama): 5'li seri kümesinden en az 2 vaka,
   her birinde skor, kısa gerekçe, alıntı ve eşleşen alanlar
   (`crimeType, locationType, weapon, mo`) görünür.
3. "alakalı" düğmesine basıp bir eşleşmeyi onaylayın → "onaylandı" olur
   (`POST /api/cases/[id]/links`).
4. Not: anahtarsız / çevrimdışı ortamda skor "0 (puanlanmadı)" görünür —
   liste yine de ön filtre sırasıyla gelir, kayıp olmaz.

## 2:00–2:40 — Ses ve fotoğraf modülleri (`/cases/[id]/add`)

1. "Delil Ekle"de "Ses Kaydet"e basıp kısa bir ifade yükleyin:
   `POST …/transcribe` metni döndürür → "Ses çözüldü: …" durumu,
   detayda "İfade:" satırı olarak görünür.
2. "Fotoğraf Çek" ile olay yeri fotoğrafı yükleyin (ipucu: delil tipi ya da not):
   `POST …/mark-photo` kutuları döndürür → "Fotoğraf kaydedildi (N kutu)." durumu,
   detayda "Fotoğraf: … (N kutu)" ve etiket listesi görünür.
3. Canlı servis `META_API_KEY` ister; anahtar yoksa bu iki uç
   hata verir (demo provası bu yüzden yalnızca Meta istemcisini taklit eder).

## 2:40–3:00 — Çevrimdışı not

1. Bağlantıyı kesin (uçak modu) ve "Delil Ekle"den bir not kaydedin:
   servis çalışanı isteği kuyruğa alır → "Not kuyruğa alındı, bağlantı gelince
   gönderilecek." (ses/fotoğrafta da aynı kuyruk mesajları).
2. Bağlantı gelince kuyruk kendiliğinden gönderilir; yeni delil
   `needsRerank` bayrağını kaldırır ve detayda "yeni benzerler" rozeti çıkar.
3. Kapanış cümlesi: "Kayıt, benzerlik, delil ve çevrimdışı kuyruk — tamamı
   kurgu veriyle, üç dakikada."
