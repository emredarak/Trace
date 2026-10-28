# Trace MVP

Kurgu veriyle çalışan vaka kayıt ve benzer vaka bulma demosu. Benzerlik yalnızca
özet metnindeki kelime ortaklığıyla ölçülmez: konum, kişi, sorgu transkripti,
delil notu, görseldeki nesneler ve olay zamanı da hesaba katılır; bulunan her
benzerlik gücü ve dayandığı kanıtla birlikte gösterilir.

Demo akış metni için bkz. `DEMO.md`. Tasarım belgesi:
`docs/superpowers/specs/2026-10-28-similar-cases-meta-models-design.md`.

## Dört Meta modelinin rolü

| Model | Görev | Kod |
|---|---|---|
| Muse Voice Transcribe | Sesli delil ve kişi sorgu sesini konuşmacı ayrımlı metne çevirir | `lib/transcribe.ts`, zenginleştirme işleri `lib/enrichment.ts` |
| SAM 3.1 | Görsel delildeki nesneleri etiketler/kutular | `lib/mark-photo.ts`, `lib/enrichment.ts` |
| Muse Glimmer | Her vaka için sürümlü vaka dosyası (dossier) derler; transkriptten öne çıkan ifadeleri seçer | `lib/glimmer-client.ts`, `lib/dossier.ts` |
| Muse Spark Open | Aday vaka dosyalarını karşılaştırır; benzerlikleri madde madde, güçleriyle (1–10) ve genel puanla çıkarır | `lib/spark-client.ts`, `lib/similarity.ts` |

## Benzerlik akışı

1. **Zenginleştirme** (`lib/enrichment.ts`): ses/görsel yüklendiğinde iş kuyruğa
   girer; Transcribe transkript, SAM nesne işaretleri üretir. İş başarısız
   olursa kayıt kaybolmaz, iş yeniden denenebilir durumda kalır ve puanlama
   kalan veriyle sürer.
2. **Vaka dosyası** (`lib/dossier.ts`): Glimmer her vaka için olay, konum,
   kişi (sorgu transkriptinden öne çıkanlar) ve delilleri içeren, kaynak
   işaretli ve hash'li bir derleme üretir.
3. **Aday üretimi** (`lib/candidates.ts`): çok kanallı ve puansızdır — metin
   (FTS), konum (≤5 km), kişi (Türkçe normalize ad + rol), nesne (SAM etiketi)
   ve zaman (±90 gün) kanallarının birleşimi, en fazla 20 aday. Kapalı vakalar
   da aday havuzundadır.
4. **Puanlama** (`lib/similarity.ts`): Spark adayları tek çağrıda puanlar.
   Sabit puan tablosu yoktur; kod yalnızca aday üretir, nesnel ipuçları
   (mesafe vb.) hesaplar ve çıktıyı doğrular: bilinmeyen/tekrarlı `caseId`
   elenir, puan ve güç 1–10'a clamp'lenir, kaynak dosyada doğrulanamayan
   alıntı maddeye giremez. Ortak SAM etiketli delillerden en fazla 3 görsel
   doğrulama için pakete eklenir. Sonuçlar dosya hash'leriyle
   `similar_results` tablosunda saklanır; içerik değişmedikçe yeniden
   puanlanmaz.
5. **Sunum** (`GET /api/cases/[id]/similar`): varsayılan ilk 5 sonuç
   (`SIMILAR_RESULT_LIMIT`), kartta ham id yerine vaka numarası (`caseNo`),
   her maddede tür + açıklama + güç + kanıt.

## Kurulum

```bash
npm install
npm run dev          # http://localhost:3000
npm run seed         # 32 kurgu vaka (ayrı terminalde, sunucu açıkken)
npm test             # test paketi
```

## Yapılandırma (env)

Anahtarlar yalnızca ortam değişkenlerindedir; kodda sabit anahtar yoktur.
Anahtar yoksa sistem puansız yedek davranışla çalışmaya devam eder (benzer
liste ön filtre/aday sırasıyla, skor "0 (puanlanmadı)" olarak gelir).

| Değişken | Anlamı |
|---|---|
| `BASETEN_API_KEY` | Varsa Spark, Baseten üzerinden çağrılır (öncelikli) |
| `BASETEN_API_URL` | Baseten uç noktası (varsayılan: `https://inference.baseten.co/v1/chat/completions`) |
| `SPARK_MODEL` | Baseten yolunda Spark model adı (varsayılan: `muse-spark-open`) |
| `META_API_KEY` | Baseten yoksa Spark için Meta API anahtarı; Transcribe ve SAM de bunu kullanır |
| `LLAMA_API_KEY` | `META_API_KEY` yoksa yedek anahtar |
| `META_API_URL` / `META_MODEL` | Meta API chat uç noktası / model adı geçersiz kılma |
| `GLIMMER_API_KEY` | Glimmer için ayrı anahtar (yoksa `META_API_KEY`/`LLAMA_API_KEY`) |
| `GLIMMER_API_URL` / `GLIMMER_MODEL` | Glimmer uç noktası / model adı (yoksa `META_API_URL`/`META_MODEL`) |
| `SIMILAR_RESULT_LIMIT` | Gösterilecek benzer vaka sayısı (varsayılan 5) |
| `SPARK_TIMEOUT_MS` | Spark çağrısı zaman aşımı, ms (varsayılan 120000) |
| `META_TRANSCRIBE_URL` / `META_TRANSCRIBE_MODEL` | Voice Transcribe uç noktası / model geçersiz kılma |
| `META_SAM_URL` / `META_SAM_MODEL` | SAM 3.1 uç noktası / model geçersiz kılma |
| `TRACE_DB_PATH` / `TRACE_UPLOAD_DIR` | SQLite dosyası / yükleme dizini (varsayılan `trace.db` / `uploads`) |
| `TRACE_BASE_URL` | Seed hedefi (varsayılan `http://localhost:3000`) |
| `DEMO_PASSCODE` | Demo giriş kodu (opsiyonel) |

PowerShell örneği:

```powershell
$env:BASETEN_API_KEY="..."
$env:META_API_KEY="..."
$env:SIMILAR_RESULT_LIMIT="5"
npm run dev
```

## Dağıtım ve gizlilik notu

v1 yalnızca **API modunda** çalışır: Spark için Baseten (öncelikli) ya da Meta
API; kişi isimleri ve transkriptler API modunda modele olduğu gibi gider.
Self-host (Spark Open'ın birimin kendi sisteminde çalıştırılması, verinin
kurum dışına çıkmaması) v1'de **kurulmaz**; yalnızca satış/demo anlatısıdır.
Model erişimi tek chat katmanından ve env ile yönlendirildiği için ileride
self-host kurulursa arayüz ve puanlama davranışı aynı kalır.
