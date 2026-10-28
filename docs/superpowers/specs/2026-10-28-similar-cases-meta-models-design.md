# Benzer Vakalar — Meta Modelleriyle Çok Kaynaklı Benzerlik Tasarımı

## Amaç ve Neden

Benzer vaka bulma, bir soruşturmacının yeni bir vakaya bakarken arşivde
işine yarayabilecek eski vakaları kaçırmamasını sağlamak içindir. Bugünkü
sistem benzerliği neredeyse yalnızca özet/suç tipi/silah/yöntem metinlerindeki
kelime ortaklığıyla ölçüyor; kişiler, konumlar, deliller, sorgu sesleri ve
görseller hesaba katılmıyor. Bu tasarım, vakanın elindeki her bilgiyi
benzerlik hesabına katmayı, bulunan her benzerliği gücüyle birlikte
açıklamayı ve vakaları genel bir benzerlik puanıyla sıralamayı hedefler.

Jüri açısından kritik nokta: Dört Meta modeli de süs olarak değil, her biri
kendi doğal işinde, zincirin ayrı halkasında gerçekten kullanılır.

## Hedefler

- Benzerlik kaynaklarını genişletmek: vaka özeti, suç tipi, yöntem/MO, silah,
  olay tarihi penceresi, konumlar (tür/öncelik + koordinat ve mesafe),
  kişiler (rol, ilişki, yaş/cinsiyet gibi alanlar), kişi sorgu kayıtlarının
  transkriptleri, deliller (başlık/not), delil görsellerindeki nesneler,
  delil seslerinin transkriptleri.
- Sabit puan tablosu kullanmamak (örn. "konum benzerliği = 2 puan" yok).
  Yakalanan her benzerliğin gücüne, o vaka çiftinin somut içeriğine bakarak
  model karar verir; nadir/spesifik eşleşme genel eşleşmeden doğal olarak
  daha ağır basar.
- Çıktıda toplam listenin yanında her aday için benzerliklerin tek tek
  listesi, her birinin gücü (1-10) ve dayandığı kanıt (alıntı/işaret) yer alır.
- Dört Meta modelinin görev dağılımı:
  - **Muse Voice Transcribe** — ses → konuşmacı ayrımlı metin.
  - **SAM 3.1** — görsel → etiketli/konumlu nesne işaretleri.
  - **Muse Glimmer** — birimin yerel güçlü bilgisayarında sürekli çalışan
    derleyici ajan: vaka dosyalarını (dossier) üretir/günceller, adayları
    daraltır, uzun ve kesintiye dayanıklı arka plan işlerini yürütür.
  - **Muse Spark Open** — yargıç: iki vaka dosyasını karşılaştırır,
    benzerlikleri ve güçlerini çıkarır, genel puanı verir.
- Gizlilik hikâyesi: Spark Open, ilgili birimin kendi güçlü sisteminde
  çalıştırıldığında vaka verisi kurum dışına çıkmaz. Bu, ürünün satış
  anlatısının parçasıdır. **Kesinleşmiş karar:** v1 yalnızca API modunda
  çalışır (Baseten öncelikli, yoksa Meta API); self-host v1 kapsamında
  kurulmaz, demoda "self-host da olabilir, güvenlik anlamında veri kurum
  dışına çıkmaz" diye anlatılır.

## Hedef Dışı (Non-goals)

- Otomatik "bu iki vaka kesin bağlantılıdır" kararı vermek. Sistem aday
  sunar; bağlantı onayını soruşturmacı verir (mevcut "alakalı" akışı).
- Kullanıcı onaylarının sıralama modelini eğitmesi/öğrenmesi (v1'de yok;
  onaylar sadece kayıt amaçlıdır).
- Gerçek zamanlı (milisaniyelik) benzerlik; değerlendirme arka planda
  hazırlanır, detay ekranı beklemez (aşağıdaki akışa bakınız).

## Başarısızlık Sayılan Durumlar (Anti-goals)

- Benzerliğin tek kaynağının yine yalnızca özet metni olması (mevcut durum).
- Modelin ürettiği puanın açıklamasız kara kutu olarak sunulması.
- Zayıf/gürültülü tek bir ortak kelimenin (örn. "gece") tek başına bir
  vakayı üst sıralara taşıması; modelin bütünsel kararı bunu elemelidir.

## Mevcut Durum (Başlangıç Noktası)

- `lib/prefilter.ts`: FTS5 üzerinden 5 alanda kelime tabanlı ön eleme
  (en fazla 20 aday).
- `lib/rerank.ts`: Llama-4-Maverick ile 1-10 puan + gerekçe + alıntı;
  hata/zaman aşımında puansız ilk 5 aday.
- `lib/transcribe.ts`: Muse Voice Transcribe istemcisi hazır
  (`/api/cases/[id]/transcribe`, konuşmacı ayrımlı segmentler).
- `lib/mark-photo.ts`: SAM 3.1 işaretleme istemcisi hazır
  (`/api/cases/[id]/mark-photo`, etiketli kutular).
- `lib/meta-client.ts`: OpenAI-uyumlu chat istemcisi, model adı env ile
  değiştirilebilir; Spark Open geçişi bu katmandan yapılır.
- `lib/field-brief.ts`: Glimmer için adlandırılmış tek cümlelik özet
  istemcisi kalıbı mevcut; Glimmer rolü buradan genelleştirilir.
- Deliller artık başlık + görsel/ses/not taşıyor; kişiler tanık/şüpheli
  için sorgu ses dosyası taşıyor. Bu dosyalar şu an benzerlikte
  kullanılmıyor.

## Tasarım

### 1. Zenginleştirme (veri girildikçe, arka planda)

Ham veri karşılaştırılabilir hâle girişte çevrilir; Spark'a ham ses veya
ham fotoğraf yığınları gitmez.

- Kişi sorgu sesi veya sesli delil yüklendiğinde Muse Voice Transcribe
  ile konuşmacı ayrımlı transkript üretilir ve kayıtla ilişkili saklanır.
- Görsel delil yüklendiğinde SAM 3.1, delil başlığı ipucu olarak
  kullanılarak nesneleri etiketler/kutular; işaretler delille saklanır.
- Bu işler başarısız olursa kayıt kaybolmaz; işlem "bekliyor/başarısız"
  durumunda kalır ve Glimmer ajanı daha sonra yeniden dener.

### 2. Vaka Dosyası (Dossier) — Glimmer'ın ürünü

Her vaka için Glimmer'ın ürettiği tek, kompakt, sürümlü bir derleme:

- Kimlik: vaka id/no, durum.
- Olay: özet, suç tipi, yöntem, silah, olay zamanı.
- Konumlar: başlık, tür/öncelik, koordinatlar; sorgu vakayla aday
  arasındaki hesaplanmış mesafeler Spark paketine ipucu olarak eklenir.
- Kişiler: rol (maktül/tanık/şüpheli), ilişki, temel alanlar ve varsa
  sorgu transkriptinden öne çıkan ifadeler (tam transkript değil;
  uzunluk sınırı içinde en bilgi verici bölümler).
- Deliller: başlık, not ve varsa SAM nesne etiketleri ile ses
  transkript özetleri.
- Kaynak gösterimi: her parça hangi kayıttan geldiğini taşır ki Spark
  alıntı yapabilsin.

Dosya, vaka/kişi/konum/delil her değiştiğinde Glimmer tarafından
yeniden üretilir (mevcut `needsRerank` bayrağı bu tetikleyiciye
genelleştirilir). Dosya DB'de vakayla ilişkili, sürüm/hash ile saklanır;
aynı içerik yeniden puanlanmaz.

### 3. Aday Üretimi (çok kanallı, ucuz)

Spark arşivin tamamını görmez. Adaylar birden çok kanalın birleşimidir
(Glimmer yürütür):

- Metin kanalı: mevcut FTS ön elemesi (özet/suç tipi/silah/yöntem).
- Konum kanalı: koordinatı olan vakalar arası mesafe eşiği içi adaylar.
- Kişi kanalı: kişi adı/rolü gibi güçlü alanlarda çakışan vakalar.
- Nesne kanalı: SAM etiketlerinde çakışan vakalar.

Birleşim, Spark'a gidecek en fazla ~20 adayla sınırlanır. Kanalların
kendisi puan vermez; amaç hiçbir güçlü adayı havuz dışında bırakmamaktır.
Skor kararı tamamen Spark'ındır.

### 4. Değerlendirme — Spark Open'a tam olarak ne gider?

Spark'a giden paket şunları içerir:

- Görev talimatı: iki vakayı karşılaştır; bulduğun her benzerliği ayrı
  madde olarak yaz; her birinin gücünü içeriğe bakarak 1-10 ver; sabit
  puan tablosu kullanma; genel puanı benzerliklerin toplam gücüne göre
  bütünsel olarak ver; her benzerliğe dayandığı kanıtı (alıntı/etiket)
  ekle.
- Sorgu vakanın vaka dosyası.
- Aday vakaların vaka dosyaları (aynı düzende, id'leriyle).
- Kod tarafından hesaplanmış nesnel ipuçları: konum mesafeleri, alan
  çakışmaları gibi. Bunlar puan değil, modelin gözden kaçırmaması için
  işaretlerdir.

Spark'a gitmeyenler: ham ses dosyaları (transkripti gider), arşivin
tamamı (sadece adaylar gider), toplu ham görseller. **Kesinleşmiş
karar (hibrit görsel kullanımı):** SAM etiketleri tek başına yeterli
sayılmaz. SAM etiketleri görsel aday kanalını besler; Spark paketine
ayrıca Glimmer'ın seçtiği az sayıda (vaka çifti başına en fazla 3)
delil görseli veya SAM kırpımı, Spark'ın çok modlu görsel doğrulaması
için eklenir. Böylece etiket düzeyindeki sahte eşleşmeler (örn. iki
görselde de "bıçak" etiketi var ama nesneler farklı) Spark tarafından
elenebilir. Görsel gönderilemezse değerlendirme etiketlerle sürer.

Çıktı şeması (JSON): her aday için `caseId`, maddeler hâlinde
`similarities: [{kind, description, strength, evidence}]`, `score`
(1-10 genel), kısa `reason`. Kod bu çıktıyı doğrular; bozuk çıktıda
adaylar puansız listelenir (mevcut yedek davranış korunur).

### 5. Sunum

Benzer vakalar kartında: genel puan, gerekçe ve benzerlik maddelerinin
listesi (her maddede tür + açıklama + güç). Kullanıcı adayı açıp
inceleyebilir ve "alakalı" onayı verebilir (mevcut `case_links`).
Kapalı/eksik verili vakalarda eksik kaynaklar puan hesabına girmez;
bu, benzerlik maddelerinin yokluğuyla doğal biçimde görünür olur.

**Kesinleşmiş kararlar:**

- Varsayılan gösterim ilk **5** benzer vakadır; sayı ayarlardan
  artırılabilir (ayar: gösterilecek benzer vaka sayısı, varsayılan 5).
- **Kapalı vakalar kesinlikle aday havuzundadır.** Sistemin asıl amacı
  birimlerin ve kişilerin hafızasında tutamayacağı geçmişi taramaktır;
  vaka kapanmış olması benzerlik değerini azaltmaz.
- API modunda kişi isimleri ve sorgu transkriptleri olduğu gibi modele
  gönderilir (kesinleşmiş karar). Self-host anlatısı, bunu istemeyen
  birimler için gizlilik alternatifidir.

### 6. Model Erişimi ve Dağıtım

- Spark Open çağrısı tek chat katmanından yapılır. Öncelik sırası
  (benim kararım): `BASETEN_API_KEY` varsa Baseten uç noktası ve
  Spark modeli; yoksa Meta API anahtarıyla aynı model. Anahtarlar
  yalnızca env değişkenlerindedir.
- Kendinden barındırma (self-host) v1'de kurulmaz; yalnızca satış/demo
  anlatısıdır ("self-host da olabilir; güvenlik anlamında veri kurum
  dışına çıkmaz"). v1 fiilen API modunda çalışır. Arayüz ve puanlama
  davranışı, ileride self-host kurulursa aynı kalacak şekilde
  tasarlanır (model erişimi tek katmandan, env ile yönlendirilir).
- Glimmer yerel ajandır: uzun görevler, araç kullanımı ve hata sonrası
  kaldığı yerden devam etme onun sorumluluğudur (dosya üretimi,
  transkript/işaret işlerinin kuyruğu, aday listelerinin tazelenmesi).

## Kısıtlar

- Modeller API anahtarıyla kullanılır; anahtar yoksa sistem puansız
  yedek davranışa düşer ama çalışmaya devam eder.
- Spark değerlendirmesi aday başına maliyet/doğru orantılı gecikme
  taşır; bu yüzden aday sayısı sınırlı ve dosyalar önceden derlenmiş
  (önbellekli) olmalıdır.
- Türkçe metinlerde kelime tabanlı ön eleme zayıftır (ekler, eşanlam);
  çok kanallı aday üretimi ve Spark'ın anlamsal kararı bunu telafi
  etmek için vardır, tamamen ortadan kaldırmaz.

## Kesinleşmiş Uygulayıcı Kararları (builder-check sonrası)

- Glimmer ayrı bir ürün değil, bu kod tabanında ayrı istemci/env ile
  çağrılan derleyici ajandır; dosya üretimi deterministik çıkarım +
  transkript özeti için Glimmer çağrısıdır, alıntılar kaynak kayıttan
  doğrulanır (uydurma alıntı maddeye giremez).
- Zenginleştirme ve dosya üretimi DB'de iş kuyruğuyla (kalıcı tablo)
  yürür; yeni tablolar: vaka dosyası, iş durumu ve puanlanmış sonuçlar
  (sorgu+aday dosya hash'i ile anahtarlanır, içerik değişmedikçe
  yeniden puanlanmaz). `GET /similar` hazır sonucu döner; hazır
  değilse mevcut eşzamanlı hesap yedeğe düşer.
- Spark tek çağrıda tüm adayları puanlar; zaman aşımı 15 sn yerine
  değerlendirme ölçeğine uygun uzun bir bütçeye çıkarılır; modelin
  atladığı adaylar puansız eklenir (mevcut davranış).
- Aday kanalları: metin (mevcut FTS), konum (koordinatlı konumlar
  arası en küçük mesafe, eşik aşımı adayı eler), kişi (normalize
  edilmiş ad + rol çakışması), nesne (normalize SAM etiketi çakışması),
  zaman (olay tarihi penceresi). Birden çok kanaldan gelen aday öne
  alınır; toplam aday ~20 ile sınırlıdır.
- Yetkili veri: kişiler için `case_persons`, konumlar için
  `case_locations`; eski vaka düz alanları yalnızca özet/suç tipi/
  silah/yöntem olarak kullanılır.
- Benzerlik türü sabit sözlüğü: özet, suç tipi, yöntem, silah, konum,
  kişi, sorgu ifadesi, delil nesnesi, delil notu, zaman.
- Sonuç kartında ham id yerine vaka numarası gösterilir.

## Uygulayıcıya Bırakılanlar

- Vaka dosyasının kesin JSON şeması ve uzunluk sınırları.
- Aday kanallarının birleşim stratejisinin ayrıntısı (kanal başına kota
  vb.), toplam aday tavanı (~20) korunarak.
- Spark isteminin (prompt) son metni ve çıktı doğrulama sertliği.
- Zenginleştirme işlerinin kuyruk/zamanlama mekanizması (mevcut
  çevrimdışı kuyruk desenleriyle uyumlu olması şartıyla).
