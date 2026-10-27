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

1. "Yeni Vaka"yı açın. Özet yazın (zorunlu): "Gece göl kıyısında olta
   takımları çalındı; şüpheli arkadan yaklaşıp bıçak gösterdi."
2. Suç tipi: `hırsızlık` (öneri listesinden).
3. Kişiler bölümü tek bölümdür: başta "Ekli kişi yok." görünür.
   "+ Kişi Ekle"ye basın; panel ("Kişi Ekle") açılır:
   - Tür: `Maktül`, Ad Soyad (zorunlu): "Kurgu Maktül"; "Kişiyi Kullan"a
     basın → satırda kırmızı "Maktül" rozetiyle görünür. (Ad bilinmiyorsa
     "Kimliği Tespit Edilemedi"yi işaretleyin; adsız da onaylanır ve sarı
     "Kimliği Tespit Edilemedi" rozeti çıkar.)
   - Tekrar "+ Kişi Ekle": Tür `Tanık`, Ad Soyad: "Kurgu Tanık",
     İlişkili Maktül listesinden eklediğiniz maktülü seçin, İlişki:
     "kardeşi", Ulaşılma Durumu: `Ulaşıldı`; "Kişiyi Kullan"a basın →
     satırda mavi "Tanık" rozeti, "İlişkili Maktül: Kurgu Maktül
     (kardeşi)" yazısı ve yeşil "Ulaşıldı" rozeti görünür. (Şüpheli mor
     rozetle gösterilir; maktül silinir ya da türü değişirse bağlı
     kişilerin ilişkisi boşalır.)
4. Konumlar tek bölümdedir: başta harita, konum listesi ve sarı uyarı bandı
   ("Bu vakada Olay Yeri olarak işaretlenmiş konum yok.") görünür.
   "+ Konum Ekle"ye basın; panel ("Konum Seç") açılır:
   - Tür: `Olay Yeri`, Başlık (zorunlu): "4 No'lu iskele"; "Adres / yer adı
     ile bul"a gölün adını yazıp "Ara"ya basın (Nominatim sonuçları gelir,
     birini seçin) ya da haritaya tıklayarak pini bırakın. "Bu Konumu
     Kullan"a basın → uyarı bandı kalkar, haritada kırmızı Olay Yeri pini
     belirir.
   - Tekrar "+ Konum Ekle": Tür `İlişkili Konum`, Öncelik `Kritik`,
     Başlık: "şüphelinin kaçış yönü"; bu kez "Konumuma Git" ile cihaz
     konumuna gidin (izin sorulursa "bir kez izin ver") ya da haritadan
     tıklayın, "Bu Konumu Kullan"a basın → turuncu Kritik pin belirir ve
     iki pin arasında mesafe etiketi (örn. "320 m") çizilir.
5. "Vakayı Aç"a basın → "Vaka açıldı: TR-00XX" ekranı ve "Delil ekle"
   bağlantısı. Eklenen kişiler taslak olarak formla birlikte tek seferde
   gönderilir. (Koordinatsız konum da kaydedilebilir; pin çizilmez.)

## 1:10–2:00 — Benzer vaka listesi (`/cases/[id]`)

1. Vaka detayını açın: özet, suç tipi, yöntem, silah kartları, tek
   "Kişiler" bölümü ve tek "Konumlar" bölümü — birleşik haritada kırmızı
   Olay Yeri ile turuncu Kritik pin, aralarında mesafe etiketi; rozet ve yazıların her zeminde
   okunur olduğunu gösterin.
2. Konum düzenlemeyi deneyin: bir konumda "Düzenle"ye basıp panelden
   başlığı değiştirin; bölüm altında "Kaydet / Vazgeç" belirir. Önce
   "Vazgeç" ile taslağın geri alındığını, sonra aynı değişikliği
   "Kaydet" ile kalıcı olduğunu gösterin (kapalı vakada bölüm salt
   okunurdur).
3. Kişi düzenlemeyi deneyin: "Kişiler" bölümünde satırlarda tür
   (Maktül/Tanık/Şüpheli), kimlik ve ulaşılma rozetleri ile ilişkili
   maktül yazısı görünür. Bir kişide "Düzenle"ye basıp panelden notu
   değiştirin; bölüm altında "Kaydet / Vazgeç" belirir. Önce "Vazgeç"
   ile taslağın geri alındığını, sonra aynı değişikliği "Kaydet" ile
   kalıcı olduğunu gösterin ("Kişiler kaydedildi."). Yeni kişi de aynı
   panelden taslağa eklenir; "Kaydet"e basmadan sunucuya gitmez
   (kapalı vakada bölüm salt okunurdur).
4. "Benzer vakalar" paneli `GET /api/cases/[id]/similar` sonucudur
   (ön filtre → yeniden sıralama): 5'li seri kümesinden en az 2 vaka,
   her birinde skor, kısa gerekçe, alıntı ve eşleşen alanlar
   (`crimeType, locationType, weapon, mo`) görünür.
5. "alakalı" düğmesine basıp bir eşleşmeyi onaylayın → "onaylandı" olur
   (`POST /api/cases/[id]/links`).
6. Not: anahtarsız / çevrimdışı ortamda skor "0 (puanlanmadı)" görünür —
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
   gönderilecek." (ses/fotoğrafta da aynı kuyruk mesajları; vaka
   detayındaki konum ve kişi "Kaydet"leri de çevrimdışıyken kuyruğa
   girer ve "Kuyruğa alındı, bağlantı gelince gönderilecek." gösterir;
   kişi güncelleme/silme istekleri de kuyruktan gönderilir).
2. Bağlantı gelince kuyruk kendiliğinden gönderilir; yeni delil
   `needsRerank` bayrağını kaldırır ve detayda "yeni benzerler" rozeti çıkar.
3. Kapanış cümlesi: "Kayıt, benzerlik, delil ve çevrimdışı kuyruk — tamamı
   kurgu veriyle, üç dakikada."
