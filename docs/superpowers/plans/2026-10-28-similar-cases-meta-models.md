# Benzer Vakalar (Meta Modelleri) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Benzer vaka bulmayı yalnızca özet metni kelime eşleşmesinden çıkarıp; konum, kişi, sorgu transkripti, delil ve görsel bilgisini de kullanan, her benzerliği gücüyle açıklayan ve ilk 5 (ayarlanabilir) vakayı puanla sıralayan çok kaynaklı bir sisteme dönüştürmek.

**Architecture:** Veri girişte zenginleştirilir (ses→transkript: Muse Voice Transcribe; görsel→nesne işaretleri: SAM 3.1). Glimmer her vaka için sürümlü bir vaka dosyası (dossier) derler ve çok kanallı aday üretimini yürütür. Muse Spark Open (Baseten anahtarı varsa Baseten, yoksa Meta API) aday dosyalarını karşılaştırıp benzerlikleri tek tek puanlar; sonuçlar dosya hash'leriyle kalıcı saklanır.

**Tech Stack:** Next.js 15 / React 19, better-sqlite3, Vitest; mevcut istemci kalıpları (`lib/transcribe.ts`, `lib/mark-photo.ts`, `lib/meta-client.ts`).

**Spec:** `docs/superpowers/specs/2026-10-28-similar-cases-meta-models-design.md`

## Global Constraints

- Dört Meta modeli de gerçek görevde kullanılır: Voice Transcribe (ses→metin), SAM 3.1 (görsel işaretleme), Glimmer (dosya derleme + aday daraltma), Spark Open (puanlayan yargıç).
- Sabit puan tablosu yok; benzerlik güçlerine Spark karar verir. Kod yalnızca aday üretir, nesnel ipuçları (mesafe vb.) hesaplar ve Spark çıktısını doğrular.
- Kapalı vakalar aday havuzundadır.
- Varsayılan gösterim 5 sonuç; sayı ayardan değişir (`SIMILAR_RESULT_LIMIT`, varsayılan 5).
- API modunda kişi isimleri ve transkriptler modele olduğu gibi gider (kesin karar). Anahtarlar yalnızca env'dedir; anahtar yoksa puansız yedek davranış korunur, sistem çalışmaya devam eder.
- Self-host v1'de kurulmaz; yalnızca demo anlatısıdır.
- Her benzerlik maddesi dayandığı kanıtı taşır; kaynakta doğrulanamayan alıntı maddeye giremez.
- Kartta ham id yerine vaka numarası (`caseNo`) gösterilir.

## Review Focus

- Spark bilinmeyen/tekrarlı caseId, aralık dışı güç veya bozuk JSON dönerse: aday düşürülür/clamp uygulanır, liste bozulmaz — Task 6 testleri.
- Spark'ın uydurduğu alıntı kaynak dosyada yoksa: madde elenir veya kanıtsız işaretlenir, uydurma kanıt gösterilmez — Task 6 testleri.
- Delil görseli diskte yoksa veya SAM/Transcribe işi başarısızsa: kayıt kaybolmaz, iş yeniden denenebilir durumda kalır, puanlama geri kalan veriyle sürer — Task 3 testleri.
- API anahtarı yoksa / Spark zaman aşımına uğrarsa: puansız ilk 5 aday dönülür (mevcut davranış) — Task 6 testleri.
- Aynı şüpheli adı farklı yazımlarla (büyük/küçük harf, Türkçe karakter) geçerse kişi kanalı adayı kaçırmaz; kimliği belirsiz kişiler ad kanalından aday üretmez — Task 5 testleri.

---

### Task 1: Model istemcileri — Spark (Baseten→Meta) ve Glimmer ayrımı

**Files:**
- Modify: `lib/meta-client.ts` (genel chat çağrısına url/model/anahtar ve çok modlu içerik desteği)
- Create: `lib/spark-client.ts`, `lib/glimmer-client.ts`
- Modify: `lib/rerank.ts` (varsayılan istemci Spark katmanına bağlanır; test seam'i korunur)
- Test: `tests/model-clients.test.ts`

**Interfaces:**
- Produces: `sparkChat(prompt: string, images?: {caseId: string; evidenceId: string; dataUrl: string}[]): Promise<string>` — anahtar önceliği `BASETEN_API_KEY` (+`BASETEN_API_URL`, `SPARK_MODEL`), yoksa `META_API_KEY`/`LLAMA_API_KEY` (+`META_API_URL`, `META_MODEL`).
- Produces: `glimmerChat(prompt: string): Promise<string>` — `GLIMMER_API_URL`/`GLIMMER_MODEL`/`GLIMMER_API_KEY` env'lerinden; tanımsızsa chat katmanına düşer.
- `lib/field-brief.ts` özet çağrısını `glimmerChat` üzerinden yapar (davranış aynı).

- [ ] Env önceliğini ve anahtar yoksa hata fırlatıldığını sınayan başarısız testleri yaz (`BASETEN_API_KEY` varken Baseten URL/modeli seçilir; yokken Meta seçilir; ikisi de yokken hata).
- [ ] Testleri çalıştır, beklenen sebeple düştüğünü gör.
- [ ] `meta-client`'i parametrik hâle getir, `spark-client` ve `glimmer-client`'i uygula, `rerank` varsayılanını Spark'a bağla.
- [ ] Testler + mevcut `rerank`/`field-brief` testleri yeşil.
- [ ] Commit: `feat: spark/glimmer model istemcileri`

### Task 2: Şema — vaka dosyası, iş kuyruğu, sonuç tabloları

**Files:**
- Modify: `lib/db.ts` (`initDb` içine mevcut ALTER desenleriyle)
- Test: `tests/db.test.ts` (mevcut dosyaya ek)

**Interfaces:**
- Produces tablolar: `case_dossiers(caseId PK, version, hash, json, updatedAt)`, `enrichment_jobs(id PK, caseId, kind ['transcribe'|'sam'|'dossier'], refId, status ['pending'|'done'|'failed'], attempts, lastError, createdAt, updatedAt)`, `similar_results(queryId, candidateId, score, similarities, reason, queryHash, candidateHash, model, createdAt, PK(queryId, candidateId))`.
- Produces: `enqueueJob(db, {caseId, kind, refId})` — aynı (kind, refId) için açık iş varken ikincisini açmaz.

- [ ] Tabloların ve tekilleştirmenin başarısız testlerini yaz.
- [ ] Çalıştır, düştüğünü gör; şemayı ve `enqueueJob`'u uygula.
- [ ] Testler yeşil. Commit: `feat: dossier/is/sonuc semasi`

### Task 3: Zenginleştirme — kişi/delil sesinde transkript, görselde SAM

**Files:**
- Create: `lib/enrichment.ts`
- Modify: `app/api/cases/[id]/persons/[personId]/audio/route.ts`, `app/api/cases/[id]/evidences/route.ts`, `app/api/cases/[id]/evidences/[evidenceId]/route.ts` (yükleme sonrası iş kuyruğa alma)
- Test: `tests/enrichment.test.ts`

**Interfaces:**
- Consumes: `transcribe` (`lib/transcribe.ts`), `markPhoto` (`lib/mark-photo.ts`), Task 2 kuyruğu.
- Produces: `processPendingJobs(db, limit, clients?): Promise<{done: number; failed: number}>` — kişi sesini `case_persons` kaydına bağlı transkript olarak saklar (konuşmacı segmentleri korunur), delil sesini delile bağlı, görseli SAM işaretleriyle (ipucu: delil başlığı, yoksa not, yoksa "delil") saklar. Başarısız iş `failed` olur, kayıt silinmez, tekrar denenebilir.

- [ ] Sahte Transcribe/SAM istemcileriyle başarısız testler: ses yükleme işi kuyruğa girer; iş çalışınca transkript/işaret ilgili kayda yazılır; istemci hata verirse kayıt durur ve iş `failed` olur.
- [ ] Çalıştır, düştüğünü gör; `enrichment.ts` ve rota bağlantılarını uygula.
- [ ] Testler + mevcut `evidences-api`/`transcribe`/`mark-photo` testleri yeşil.
- [ ] Commit: `feat: ses/gorsel zenginlestirme isleri`

### Task 4: Vaka dosyası (dossier) üretimi — Glimmer

**Files:**
- Create: `lib/dossier.ts`
- Test: `tests/dossier.test.ts`

**Interfaces:**
- Produces: `interface CaseDossier` — spec §2'deki bölümler (olay, konumlar, kişiler + transkript öne çıkanları, deliller + SAM etiketleri/transkript özetleri), her parça kaynak kayıt id'si taşır.
- Produces: `buildDossier(db, caseId, glimmer?): Promise<CaseDossier>` — deterministik çıkarım + transkript öne çıkan seçiminde Glimmer özeti; sonucu `case_dossiers`'a hash ile yazar, içerik aynıysa yazmaz. Yetkili veri `case_persons`/`case_locations`; kişi/konum/delil yokluğu dosyayı bozmaz.
- Produces: `dossierText(d: CaseDossier): string` — Spark paketine giren düz metin biçimi.

- [ ] Başarısız testler: bilinen bir vakadan beklenen bölümler; transkript öne çıkanı kaynak id'siyle; içerik değişince hash değişir, değişmezse aynı kalır.
- [ ] Çalıştır, düştüğünü gör; uygula.
- [ ] Testler yeşil. Commit: `feat: glimmer vaka dosyasi uretimi`

### Task 5: Çok kanallı aday üretimi

**Files:**
- Create: `lib/candidates.ts`
- Modify: `lib/prefilter.ts` (metin kanalı olarak aynen kullanılır)
- Test: `tests/candidates.test.ts`

**Interfaces:**
- Consumes: `prefilter`, `haversineMeters` (`lib/locations.ts`), dossier'lar.
- Produces: `findCandidates(db, queryId, dossiers): {caseId: string; channels: string[]}[]` — kanallar: `text` (FTS), `location` (koordinatlı konumlar arası en küçük mesafe ≤ 5 km), `person` (Türkçe normalize ad + rol çakışması; kimliği belirsizler hariç), `object` (normalize SAM etiketi çakışması), `time` (olay tarihi ±90 gün). Kapalı vakalar dahil; sorgu vaka hariç; çok kanallı aday önce, toplam en fazla 20.

- [ ] Başarısız testler: FTS'nin kaçırdığı vakayı konum/kişi/nesne/zaman kanallarından her birinin yakalaması; kimliği belirsiz kişinin ad kanalından aday üretmemesi; 20 sınırı ve çok kanallı önceliği.
- [ ] Çalıştır, düştüğünü gör; uygula.
- [ ] Testler + mevcut `prefilter` testleri yeşil.
- [ ] Commit: `feat: cok kanalli aday uretimi`

### Task 6: Spark değerlendirmesi, doğrulama ve kalıcı sonuçlar

**Files:**
- Create: `lib/similarity.ts`
- Modify: `lib/rerank.ts` (eski puanlayıcı yedek davranış için korunur veya `similarity` içinden çağrılır)
- Test: `tests/similarity.test.ts`

**Interfaces:**
- Consumes: Task 1 `sparkChat`, Task 4 `dossierText`, Task 5 adayları.
- Produces: `interface SimilarityItem {kind: 'ozet'|'suc-tipi'|'yontem'|'silah'|'konum'|'kisi'|'sorgu-ifadesi'|'delil-nesne'|'delil-notu'|'zaman'; description: string; strength: number; evidence: string}` ve `interface ScoredCase {caseId: string; caseNo: string; score: number; reason: string; similarities: SimilarityItem[]}`.
- Produces: `scoreCandidates(db, queryId, candidates, spark?): Promise<ScoredCase[]>` — sorgu + aday dosyalarını tek çağrıda gönderir; Glimmer'ın seçtiği en fazla 3 görsel/kırpımı (ortak SAM etiketli delillerden) pakete ekler; çıktıda bilinmeyen/tekrarlı caseId elenir, güç ve puan 1-10'a clamp'lenir, alıntısı kaynak dosyada doğrulanamayan madde düşer; sonuçlar `similar_results`'a hash'lerle yazılır ve hash uyuşan hazır sonuç yeniden çağrılmaz. Model/anahtar hatası veya zaman aşımında adaylar puansız döner (mevcut yedek davranış; uzun zaman aşımı bütçesi kullanılır).

- [ ] Sahte Spark istemcisiyle başarısız testler: çok maddeli benzerlik çıktısının aynen taşınması; uydurma alıntının düşmesi; bozuk JSON ve anahtarsız durumda puansız yedek; ikinci çağrının önbellekten gelmesi (Spark tekrar çağrılmaz).
- [ ] Çalıştır, düştüğünü gör; uygula.
- [ ] Testler + mevcut `rerank` testleri yeşil.
- [ ] Commit: `feat: spark benzerlik puanlama`

### Task 7: `/similar` akışı ve sonuç sunumu

**Files:**
- Modify: `app/api/cases/[id]/similar/route.ts`
- Modify: `app/cases/[id]/case-detail.tsx` (Benzer vakalar bölümü)
- Test: `tests/similar-api.test.ts` (ek), `tests/case-page.test.tsx` (ek)

**Interfaces:**
- Consumes: Task 3 `processPendingJobs`, Task 4 `buildDossier`, Task 5 `findCandidates`, Task 6 `scoreCandidates`.
- API: `GET /api/cases/[id]/similar` → `{results: ScoredCase[], fresh: boolean, limit: number}`; işler bekliyorsa sınırlı sayıda işi çalıştırıp devam eder; `limit` = `SIMILAR_RESULT_LIMIT` (varsayılan 5).
- UI: kartta vaka numarası bağlantısı, genel puan, gerekçe ve benzerlik maddeleri (tür etiketi + açıklama + güç `n/10`); mevcut "alakalı" onayı korunur; bekleyen zenginleştirme varsa bilgi notu gösterilir.

- [ ] Başarısız testler: API'nin yeni şekli ve limit; kapalı vakanın aday gelebilmesi; detay sayfasında benzerlik maddelerinin ve vaka numarasının görünmesi.
- [ ] Çalıştır, düştüğünü gör; uygula.
- [ ] Tüm test paketi (`npm test`), `npx tsc --noEmit`, `npm run build` yeşil.
- [ ] Commit: `feat: benzer vakalar cok kaynakli sunum`

### Task 8: Demo ve yapılandırma dokümantasyonu

**Files:**
- Modify: `DEMO.md`, `README.md`

**Interfaces:**
- Demo akışına dört modelin rolü eklenir (Transcribe sesi, SAM görseli, Glimmer dosya derlemesi, Spark puanlaması); self-host yalnızca anlatı olarak geçer.
- Env listesi: `BASETEN_API_KEY`/`BASETEN_API_URL`/`SPARK_MODEL`, `META_API_KEY`, `GLIMMER_API_URL`/`GLIMMER_MODEL`, `SIMILAR_RESULT_LIMIT`.

- [ ] Dokümanları güncelle; anahtarların kodda değil env'de olduğunu doğrula (`grep` ile sabit anahtar/model dışı URL taraması).
- [ ] Commit: `docs: meta modelleri demo akisi`
