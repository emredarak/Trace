# Benzer Vaka Aramasında Canlı İlerleme — Tasarım

## Amaç ve Neden

Vaka detay ekranında benzer vakalar paneli, arama bitene kadar yalnızca
`Loading…` gösteriyor (`app/cases/[id]/case-detail.tsx`). Oysa bu bekleme
saniyelerle sınırlı değildir: sunucu tek istek içinde sırayla bekleyen
zenginleştirme işlerini (en fazla 5), tüm vakaların dosyalarını, aday
toplamayı ve tek Spark çağrısını çalıştırır
(`app/api/cases/[id]/similar/route.ts`); model zaman aşımları varsayılan
120 sn'dir. Kullanıcı bu süre boyunca neyin beklendiğini, neden beklendiğini
ve ne kadar süredir beklediğini bilmiyor.

Bu tasarım, `Loading…` yerine gerçek sunucu olaylarıyla ilerleyen,
etkileşimli bir zaman çizelgesi koyar: hangi aşamadayız, kim (hangi model
veya kod) çalışıyor, niçin gerekli, ne taranıyor, her aşama ne kadar sürdü,
toplam geçen süre ne ve tahmini ne kadar kaldı.

## Hedefler

- Bekleyen kullanıcı her an şunları görebilir: aktif aşama, aşamanın sahibi
  (Muse Voice Transcribe, SAM 3.1, Muse Glimmer, Muse Spark Open veya
  yerel kod), aşamanın nedeni, o ana kadar üretilen somut sayılar (işlenen
  iş, derlenen/önbellekten gelen dosya, kanal bazında aday, önbellekten
  gelen/puanlanan aday, eklenen görsel sayısı).
- Geçen süre sağ üstte büyük ve sabit genişlikli rakamlarla sürekli görünür;
  tahmini kalan süre onun altında gösterilir.
- Her aşama açılabilir; içinde "ne taranıyor / neden bekleniyor" açıklaması
  ve o aşamaya ait sayılar yer alır. Etkileşim yalnızca bilgi açar.
- Gösterilen her bilgi gerçektir: aşama geçişleri sunucu olaylarına dayanır,
  süreler ölçülür, tahmin geçmiş ölçümlerden hesaplanır.

## Hedef Dışı (Non-goals)

- Aramayı iptal etme veya yeniden başlatma düğmesi (istemci bağlantıyı
  kesse bile sunucu işi sürebilir; yanıltıcı bir "iptal" sunulmaz).
- Yüzdelik ilerleme çubuğu: Spark tek çağrı hâlinde çalışır ve iç ilerlemesi
  bilinemez; yüzde uydurulmaz.
- Arama akışının kendisini hızlandırma veya arka plan işe çevirme; mevcut
  eşzamanlı akış ve önbellek davranışı korunur.
- Oyunlaştırma: puan, rozet, kutlama veya dikkat çekici animasyon yok.

## Başarısızlık Sayılan Durumlar (Anti-goals)

- Benzetimle ilerleyen sahte aşamalar veya sayaçlar (ör. ön yüzde zaman
  tabanlı sahte ilerleme). İstemci, sunucudan olay gelmeden aşama
  "tamamlandı" gösteremez.
- Tahminin tek ve kesin bir sayı gibi sunulması, `0`'da takılması veya
  veri yokken uydurulması.
- İlerleme olaylarına vaka içeriği sızması: kişi adı, transkript, vaka
  özeti veya alıntı ilerleme akışına girmez; yalnızca sayılar ve sabit
  etiketler gider.

## Mevcut Durum (doğrulanmış)

- Ön yüz: `CaseDetail`, `GET /api/cases/{id}/similar` isteğini tek `fetch`
  ile bekler; yanıt yoksa panelde yalnızca `Loading…` yazar.
- Sunucu akışı (tek istek, sırayla):
  1. `processPendingJobs(db, 5)` — bekleyen `transcribe` (Muse Voice
     Transcribe) ve `sam` (SAM 3.1) işleri; hatalar akışı bozmaz.
  2. Tüm vakalar için `buildDossier` — Muse Glimmer yalnızca içeriği
     değişen transkript özetleri için çağrılır; değişmeyen dosya
     önbellekten döner.
  3. `findCandidates` — yerel kod; metin (FTS), konum (≤5 km), kişi,
     nesne (SAM etiketi) ve zaman (±90 gün) kanalları, en fazla 20 aday.
  4. `scoreCandidates` — hash'i eşleşen adaylar `similar_results`
     önbelleğinden gelir; kalanlar tek Muse Spark Open çağrısıyla
     puanlanır (en fazla 3 delil görseli eklenir); çıktı kaynak metinle
     doğrulanır ve kalıcılaştırılır. Model hatasında adaylar puansız döner.
- Süre/aşama kaydı tutan bir tablo ve istemciye ilerleme taşıyan bir
  mekanizma bugün yoktur.

## Tasarım

### 1. Taşıma: aynı uçtan NDJSON akışı

- `GET /api/cases/[id]/similar` mevcut JSON davranışını korur (diğer
  tüketiciler ve testler için geriye uyumlu).
- `?stream=1` ile çağrıldığında yanıt `application/x-ndjson` olur: her
  satır bir JSON olaydır, son olay sonuçtur. Yanıt başlıklarında
  `Cache-Control: no-store` bulunur; ara katmanların tamponlamasını
  engellemek için `X-Accel-Buffering: no` eklenir.
- Ön yüz benzer vakalar için her zaman akışlı çağrıyı kullanır ve
  `fetch` + `ReadableStream` ile satır satır okur. Akış, sonuç olayı
  gelmeden kapanır veya ilk olaydan önce ağ hatası olursa panel mevcut
  hata metnini gösterir ("Could not load similar cases." /
  bağlantı hatası); sessizce ikinci bir (yinelenen) istek atılmaz.

Olay sözleşmesi (her olayda `type`, sıra numarası `seq` ve sunucunun
tekdüze saatiyle `elapsedMs` bulunur):

| Olay | Anlamı | Taşıdığı sayılar |
|---|---|---|
| `started` | Arama başladı | — |
| `stage_started` | Aşama başladı | aşama anahtarı, varsa bilinen iş yükü |
| `stage_progress` | Uzun aşamada ara sayı | işlenen/toplam (zenginleştirme işleri, dosyalar) |
| `stage_completed` | Aşama bitti | `durationMs`, `status`: `done`/`skipped`/`degraded`, aşama sayıları |
| `estimate` | Güncel tahmin (her aşama olayıyla birlikte de gönderilir) | `lowMs`, `highMs`, `sampleCount` veya `null` |
| `result` | Son olay; bugünkü JSON gövdesinin aynısı | `results`, `fresh`, `limit`, `pendingEnrichment` |
| `error` | Akış başladıktan sonra ölümcül hata | sabit hata kodu; bugünkü davranışta ölümcül olmayan hatalar `degraded` olarak aşamada belirtilir, `error` yalnızca vaka bulunamaması gibi akış öncesi/ölümcül durumlarda kullanılır |

Aşama anahtarları sabittir: `enrichment`, `dossiers`, `candidates`,
`scoring`, `verification`.

### 2. Aşamaların enstrümantasyonu

Akışın sırası ve iş mantığı değişmez; yalnızca gözlem noktaları eklenir.

- **Zenginleştirme:** Payda, kuyruğun tamamı değil, bu isteğin gerçekten
  deneyeceği iştir: `processPendingJobs`'un seçtiği (tür `transcribe`/`sam`,
  `createdAt` sırasıyla en fazla 5) işler. Seçilen iş listesi geri çağrıyla
  bildirilir; iş sayısı 0 ise aşama `skipped` olarak anında tamamlanır.
  `processPendingJobs` dönüş değeri (`done`/`failed`) artık kullanılır;
  iş başına `stage_progress` yayımlanır. İstek kapsamı dışında kalan
  bekleyen iş varsa ayrıntıda ayrıca belirtilir (sonuçtaki
  `pendingEnrichment` rozeti de bunu korur). Başarısız iş varsa aşama
  `degraded` biter ve "kalan veriyle devam ediliyor" bilgisi taşınır.
- **Vaka dosyaları:** Döngü her vakada ilerleme yayımlar (işlenen/toplam).
  Bir dosyanın "güncellendi" sayılması, çağrı öncesi/sonrası saklanan
  hash'in değişmesine (veya ilk kez oluşmasına) bakılarak belirlenir;
  değişmeyenler "önbellekten" sayılır. Dosya hatası akışı durdurmaz;
  sayı `failed` olarak verilir ve aşama `degraded` olabilir.
- **Aday toplama:** `findCandidates` dönüşünden kanal bazında aday
  sayıları ve toplam çıkarılır (adayların `channels` alanından). Yerel ve
  hızlıdır; yine de gerçek süresiyle gösterilir.
- **Puanlama:** `scoreCandidates` geriye uyumlu, isteğe bağlı bir ilerleme
  geri çağrısı alır. Sırayla şu ara olayları yayımlar: önbellek kontrolü
  bitti (`cachedCount`, `pendingCount`), Spark çağrısı başladı
  (`pendingCount`, `imageCount`), Spark yanıtı geldi. Tüm adaylar
  önbellekten geliyorsa aşama "Spark çağrılmadı" bilgisiyle `done` biter.
  Model hatası/zaman aşımında mevcut puansız yedek davranış korunur ve
  aşama `degraded` işaretlenir.
- **Doğrulama ve sıralama:** Puanlama geri çağrısı, model çıktısının
  doğrulanıp kalıcılaştırıldığı noktada bu aşamanın başlangıcını işaretler;
  aşama `scoreCandidates` dönüp sonuçlar sıralandığında tamamlanır.
  Doğrulamada elenen madde sayısı gibi bugün ölçülmeyen bir sayı
  uydurulmaz; yalnızca puanlanan/puansız aday sayıları gösterilir.

Aşama sınırları (çakışmaz; her aşama bir kez başlar ve biter):

| Durum | Puanlama | Doğrulama ve sıralama |
|---|---|---|
| Tümü önbellekten | `done` — "Spark çağrılmadı", süre önbellek okumasını kapsar | `done` — önbellek maddeleri okuma sırasında kaynak doğrulamasından zaten geçer; aşama sonuçlar sıralandığında tamamlanır |
| Spark yanıtı (tam/kısmi) | Spark ham yanıtı dönünce biter | Ayrıştırmayla başlar; doğrulama, kalıcılaştırma ve sıralamayla biter. Puansız kalan aday sayısı gösterilir |
| Model hatası/zaman aşımı | `degraded` — puansız yedek | `skipped` — doğrulanacak model çıktısı yok |
| Aday yok | `skipped` | `skipped` |

Dosya aşamasında `failed` yalnızca `buildDossier`'ın hata fırlatmasıdır.
Glimmer özet hatası bugün olduğu gibi sessizce boş özetle sonuçlanır ve
ayrıca bir bozulma sayılmaz; dosya yine üretilir.

### 3. Süre ölçümü ve tahmin

- Sunucu her aramada aşama sürelerini ve iş yükü sayılarını yeni
  `similar_search_runs` tablosuna bir satır olarak yazar: aşama süreleri,
  zenginleştirme iş sayıları (tür bazında), dosya toplam/güncellenen,
  aday sayısı, önbellekten gelen/Spark'a giden aday sayısı, görsel sayısı,
  sonuç durumu. Vaka kimliği ve içerik yazılmaz. Tablo son 500 satırla
  sınırlı tutulur (kayıtta budanır).
- Tahmin, kalan aşamaların geçmiş süre dağılımlarından hesaplanır ve her
  aşama olayıyla `estimate` olarak gönderilir:
  - Başlamamış aşama için medyan (alt sınır) ve p90 (üst sınır) kullanılır.
  - Çalışan aşamada kalan süre, aşamanın medyanından o aşamada geçen süre
    çıkarılarak bulunur (negatif olmaz).
  - Koşullandırma yalnızca aşama başlamadan bilinebilen iş yükleriyle
    yapılır: zenginleştirme bu istekte denenecek iş sayısı/türüne, dosya
    aşaması toplam dosya sayısına, puanlama önbellek kontrolünden sonra
    bilinen Spark'a giden aday sayısına (0, 1–3, 4–7, 8+) göre dilimlenir.
    Bir aşama çalışırken iş yükü netleşirse (ör. puanlamada
    `pendingCount` belli olunca) tahmin o andan itibaren dilimli
    dağılımla yeniden hesaplanır. Kesin dilim eşikleri uygulayıcıya
    aittir; dilimde yeterli örnek yoksa koşulsuz dağılıma düşülür.
  - Yeterli veri kuralı: toplamda 20 tamamlanmış aramadan az varsa veya
    kalan herhangi bir aşama için 5'ten az örnek varsa tahmin `null`'dır;
    ön yüz tahmin satırını hiç göstermez. "Tamamlanmış arama", `result`'a
    ulaşmış aramadır. Aşama dağılımlarına yalnızca `done` biten aşamalar
    girer; `skipped` ve `degraded` (ör. 120 sn zaman aşımı) süreleri
    medyan/p90'ı kirletmez. Önbellekten biten puanlama, Spark çağrısı
    dağılımına girmez (kendi anlık yoluyla gösterilir).
  - Ön yüz, gelen aralığı olay anına göre yaşlandırır (aralıktan geçen
    süre düşülür). Üst sınır da aşıldıysa tahmin yerine
    "Beklenenden uzun sürüyor — model hâlâ yanıt veriyor" gösterilir;
    sayaç çalışmaya devam eder, tahmin `0`'da takılmaz.
- Gösterim aralıklıdır: "Estimated remaining ~20–40s". Yuvarlama
  (5 sn'ye) gibi sunum ayrıntıları uygulayıcıya aittir.

### 4. Ön yüz: etkileşimli zaman çizelgesi

Mevcut panel ve uygulama dili (İngilizce) korunur; yeni metinler de
İngilizce yazılır. Bileşen, benzer vakalar panelinin yüklenme durumunu
şöyle çizer:

- Başlık satırı: solda "Similar cases" ve durum cümlesi ("Finding similar
  cases…"), sağ üstte **büyük, `tabular-nums` ile geçen süre** (`00:42`,
  bir saati aşarsa `1:02:33`) ve altında "Elapsed" etiketi ile tahmin
  rozeti ("Estimated remaining ~20–40s" veya uzun sürme uyarısı).
- Beş aşama satırı: durum işareti (tamamlandı ✓ / aktif sakin nabız /
  sırada numara / atlandı –), aşama adı, sahibi (model veya "local"),
  kısa neden cümlesi ve sağda aşama süresi (bitmişse gerçek süre,
  aktifse canlı aşama süresi).
- Her satır açılabilir (`button` + `aria-expanded` veya `details`):
  içinde aşamanın neyi taradığı ve o ana kadarki somut sayılar bulunur.
  Aktif aşama kendiliğinden açık gelir; kullanıcı kapatabilir. Birden
  çok aşama aynı anda açık kalabilir.
- Atlanan aşamalar soluk ve "Skipped — nothing pending" benzeri açık
  bir notla görünür; `degraded` aşamalar altın rengi uyarı işareti ve
  neyin eksik kaldığı cümlesiyle görünür.
- Erişilebilirlik: aşama değişimleri `aria-live="polite"` ile duyurulur;
  her saniye değişen sayaç canlı bölgeye dahil edilmez. Nabız animasyonu
  `prefers-reduced-motion` altında kapanır. Klavye ile tüm açılır
  satırlar çalışır.
- Hızlı yol: Sonuç 600 ms içinde gelirse zaman çizelgesi hiç
  gösterilmez, sonuçlar doğrudan yerleşir (yanıp sönme yok). Sonuç
  geldiğinde çizelge sonuç listesiyle değişir; mevcut
  `pendingEnrichment` bilgi rozeti sonuçtan sonra da aynen gösterilir.
- Sayaç yalnızca istemci tarafında saniyede bir güncellenir; aşama
  geçişleri ve sayılar yalnızca sunucu olaylarıyla değişir.

### 5. Hata ve sınır durumları

- Vaka yoksa akış başlamadan bugünkü 404 JSON'u döner.
- Zenginleştirme/dosya/model hataları bugünkü gibi akışı durdurmaz;
  ilgili aşama `degraded` olur ve sonuç (varsa puansız) yine gelir.
- Aday yoksa puanlama ve doğrulama `skipped` olur, sonuç boş liste ve
  bugünkü "No similar cases." metnidir.
- Akış ortasında bağlantı kopması bugünkü hata metinleriyle sonuçlanır;
  kısmi aşama bilgisi ekranda kalır ama "sonuç" gibi sunulmaz. Sunucu
  tarafı işi iptal etmez: arama sunucuda tamamlanır, sonuçlar
  kalıcılaşır ve süre satırı yazılır (model çağrıları bugün de iptal
  edilebilir değildir).
- Akış başladıktan sonra beklenmeyen bir hata (ör. aday toplamanın
  fırlatması) akışlı çağrıda `error` olayıyla kapanır; `needsRerank`
  temizlenmez ve süre satırı yazılmaz. Akışsız çağrıda bugünkü
  davranış (sunucu hatası) korunur.
- Süre satırı hem akışlı hem akışsız çağrıda, `result`'a ulaşıldığında
  yazılır; iki kip de aynı enstrümante edilmiş hattı paylaşır.

## Kısıtlar

- Model çağrıları tek parça ve uzun olabilir (varsayılan 120 sn zaman
  aşımı; zenginleştirmede istek başına en fazla 5 iş sırayla çalışır);
  tahmin bu yüzden aralıklı ve koşulludur, kesin süre vaat edilmez.
- Spark çağrısının içinden ara ilerleme alınamaz; puanlama aşamasında
  yalnızca başlangıç sayıları ve geçen süre gösterilir.
- NDJSON akışı, ara katman tamponlamasına duyarlıdır; başlıklar ve
  olayların anında `flush` edilmesi gerekir.
- İlerleme olayları içerik taşımaz (gizlilik); gösterilen sayılar
  yalnızca iş yükü sayaçlarıdır.

## Uygulayıcıya Bırakılanlar

- İlerleme bileşeninin dosya yerleşimi (yeni bileşen dosyası önerilir;
  `case-detail.tsx` zaten büyüktür) ve NDJSON satır ayrıştırma
  yardımcısının yeri.
- Tahmin dilim eşiklerinin ve yuvarlamanın kesin değerleri (yukarıdaki
  kurallar içinde kalmak şartıyla).
- `scoreCandidates` ve `processPendingJobs` geri çağrılarının kesin
  imzaları (mevcut çağrıları ve test enjeksiyonlarını bozmadan).
- Percentile hesaplama yöntemi (medyan/p90 için makul bir yöntem).

## Doğrulama Beklentisi

- Birim testler: tahmin hesaplayıcı (yetersiz veri, dilim seçimi, aşama
  içi kalan süre, üst sınır aşımı), olay üretimi (atlanan/degraded
  aşamalar, önbellekten gelen puanlama).
- Akış testi: sahte model istemcileriyle NDJSON olay sırasının ve son
  `result` olayının bugünkü JSON gövdesiyle aynı olduğu.
- Bileşen testleri: aşama geçişleri, geçen süre sayacı, tahminin
  gizlenmesi/uyarıya dönmesi, açılır satırlar ve hızlı yolda çizelgenin
  hiç görünmemesi.
- Mevcut test takımı (`npm test`) yeşil kalır; akışsız çağrının davranışı
  değişmez.
