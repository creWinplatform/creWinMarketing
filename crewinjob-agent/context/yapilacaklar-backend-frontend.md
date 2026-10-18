# Seafarer Activation — Yapılacaklar Listesi (Backend + Frontend)

**Tarih:** 8 Ağustos 2026
**Hazırlayan:** Pazarlama / Growth
**Alıcı:** crewinjob.com backend & frontend ekibi
**Amaç:** Aktivasyon akışını canlıya almak için kalan tüm işlerin tek listesi

---

## Neden? (Canlı veri — 8 Ağustos 2026)

| Segment | Kişi | Oran |
|---|---:|---:|
| %0 — Profile hiç dokunmamış | 6.413 | 57,6% |
| %0–30 — Yarım bırakmış | 3.799 | 34,1% |
| %30–60 — İlerlemiş | 655 | 5,9% |
| %60+ — İşe hazır (şirketlere görünür) | 263 | 2,4% |
| **Toplam** | **11.130** | Ort. doluluk **%10** |

Sorun kayıt değil, **aktivasyon**. 11.130 kişinin yalnızca 263'ü şirketlere görünüyor.

---

# BÖLÜM A — BACKEND YAPILACAKLAR

## 🔴 A1. ACİL — Teslim edilmiş 3 endpoint canlıda 500 veriyor

Aşağıdaki üç endpoint, servis/admin token'ıyla çağrıldığında **HTTP 500** dönüyor:

```
GET /GemiAdamiGenel/GetIncompleteProfileSegments   → 500 "Gemi adamı profili bulunamadı"
GET /GemiAdamiGenel/GetProfileVisibilityGain       → 500 "Gemi adamı profili bulunamadı"
GET /GemiAdamiGenel/GetOnboardingState             → 500 "Gemi adamı profili bulunamadı"
```

**Kök neden (tahmin):** Endpoint'ler "login olan kullanıcının gemi adamı profili" varsayıyor. Servis/admin hesabının profili olmadığı için patlıyor.

**Yapılması gereken:**

1. **`GetIncompleteProfileSegments` — kapsam hatası (bug).**
   Bu endpoint zaten **tüm kullanıcılar üzerinden agregat** dönmeli (alan bazında kaç kişi eksik). Çağıranın gemi adamı profili olmasına bağlı OLMAMALI. Şu an yanlış scope'lanmış. → Agregat sorgu olarak düzeltilmeli; herhangi bir yetkili token'la çalışmalı.

2. **`GetProfileVisibilityGain` ve `GetOnboardingState` — per-user, `userId` desteği eksik.**
   Bunlar kullanıcı-özel; sorun değil. Ama pazarlama paneli ve admin araçları için **`?userId={id}` parametresi zorunlu olmalı** ve verildiğinde login kullanıcı yerine o kullanıcı baz alınmalı. Servis token'ı `userId` ile çağırabilmeli (yetki kontrolü: admin/servis rolü).

**Kabul kriteri:** Üç endpoint de servis token'ı + (gerekiyorsa) `userId` ile 200 dönmeli.

---

## 🔴 A2. ACİL — "Yeni kayıt" verisi sıfır geliyor

`fetchAllData()` şu an şunu dönüyor:
```
seafarers.newThisWeek = 0
seafarers.newToday    = 0
jobs.newThisWeek      = null
companies.newThisWeek = 0
```

Bu ya (a) gerçekten kayıtlar durdu (kritik), ya da (b) "yeni kayıt" tarih filtresi/alanı çalışmıyor.

**Yapılması gereken:** Backend'de son 7 gün / son 24 saat kayıt sayacını doğrula. `creationTime` bazlı filtre çalışıyor mu? Bu sayı büyüme takibinin temeli — güvenilir olmalı.

---

## 🔴 A2.5. ACİL — sitemap.xml'de ilan ve blog URL'leri yok (14 Ağustos 2026, canlı doğrulama)

`https://www.crewinjob.com/sitemap.xml` şu an **sadece 12 statik sayfa** döndürüyor (ana sayfa, about, pricing,
jobs listesi vb.) — hiçbir tekil ilan detay sayfası (`/jobs/detail/{id}`) veya blog yazısı sitemap'te yok.
`lastmod` alanı tüm satırlarda aynı zaman damgasını taşıyor (2026-08-09T12:40:05) — sitemap statik üretilmiş,
içerik değiştikçe otomatik güncellenmiyor.

**Etki:** Platformda 10.000+ aktif ilan var ama Google'ın bunları sitemap üzerinden keşfetmesi için hiçbir yol
yok. İlan sayfaları ancak dahili linklerden crawl edilirse indexlenebilir — bu çok daha yavaş ve güvenilmez.
Aynı durum blog yazıları için de geçerli.

**İyi haber — ilan detay sayfaları teknik olarak indexlemeye hazır:**
`/jobs/detail/{id}` sayfalarında `application/ld+json` içinde geçerli `schema.org/JobPosting` işaretlemesi
zaten mevcut (doğrulandı: `{"@context":"https://schema.org/","@type":"JobPosting","title":"Chief Eng.",...}`).
Bu hem Google Jobs zengin sonuçları hem de Google'ın **Indexing API**'si için ön koşul (Indexing API sadece
JobPosting/BroadcastEvent schema'lı sayfalarda kullanılabilir — sitemap crawl'ından çok daha hızlı indexleme
sağlar). Sitemap sorunu çözülünce bu API'nin devreye alınması ayrıca değerlendirilmeli.

**Yapılması gereken:**
1. `sitemap.xml` dinamik üretilmeli: tüm aktif ilanlar (`/jobs/detail/{id}`) ve yayınlanmış blog yazıları
   sitemap'e eklenmeli, `lastmod` her URL için gerçek güncelleme tarihini yansıtmalı.
2. İlan kapandığında/silindiğinde sitemap'ten otomatik çıkmalı (kapalı ilan için 404/410 döndüren URL'ler
   sitemap'te kalırsa Google güven skorunu düşürür).
3. 10.000+ URL tek dosyada şişmesin diye sitemap index + parçalı sitemap yapısı (`sitemap-jobs-1.xml`,
   `sitemap-blog.xml` gibi) düşünülebilir — Google tek sitemap dosyası için 50.000 URL / 50MB sınırı koyuyor,
   şu an sorun değil ama büyüme planlanıyorsa baştan doğru kurulmalı.

**Kabul kriteri:** `sitemap.xml` içinde `/jobs/detail/{id}` kalıbında en az aktif ilan sayısı kadar `<url>`
girdisi olmalı, her birinin `lastmod`'u ilanın gerçek `creationTime`/`lastModified` alanına eşit olmalı.

**Ayrıca not (pazarlama panelinden düzeltildi, backend değişikliği gerekmez):** Pazarlama panelindeki
"İş Eşleşme Maili" kampanyası `applyUrl` üretirken yanlışlıkla `/jobs/{id}` kalıbını kullanıyordu (404
veriyordu) — doğrusu `/jobs/detail/{id}` olarak düzeltildi (`crewinjob-agent/modules/api.js`).

---

## ✅ A3. E-posta Re-aktivasyon Altyapısı — Backend Teslim Etti (8 Ağustos 2026)

```
GET /GemiAdamiGenel/GetSeafarersByFillBucket?bucket={zero|low|mid|high}&page={n}&size={n}
Response item: { userId, email, fullName, fillRate, lastActiveAt, emailOptOut, unsubscribeUrl }
```

- Bucket eşikleri standartlaştırıldı: `zero=0, low=1-49, mid=50-79, high=80+`.
- `emailOptOut=true` kullanıcılar backend tarafından zaten dışarıda bırakılıyor — pazarlama tarafı ayrıca filtrelemek zorunda değil.
- `unsubscribeUrl`: backend'in ürettiği **opak token'lı** hazır link — `GET /GemiAdamiGenel/UnsubscribeEmail?token={opaqueToken}`. Frontend kendi token üretmez, aynen kullanır.
- Event tracking: `POST /GemiAdamiGenel/TrackActivationEvent` — `email_sent`, `email_opened`, `email_clicked`, `email_bounced` dahil 20 event whitelist'te.

**Pazarlama panelinde entegre edildi:** segment tablosu (doluluk % + son güncelleme + unsubscribe linki), kişiselleştirilmiş toplu gönderim, `email_sent` event tracking otomatik tetikleniyor.

**Tracking altyapısı tamamlandı:** `email_sent` (gönderim anında), `email_opened` (görünmez piksel — `/api/track/open`), `email_clicked` (link redirect + allowlist — `/api/track/click`), `email_bounced` (AWS SNS webhook — `/api/track/bounce`, SES bounce bildirimini imza doğrulamasıyla kabul edip userId'yi mesaj etiketinden çözer) hepsi otomatik tetikleniyor.

**`email_bounced` için AWS tarafında (kod dışı) manuel kurulum gerekiyor:**
1. SES konsolu → Configuration sets → yeni set oluştur (adını `SES_CONFIGURATION_SET` env değişkenine yaz)
2. O set için Event destination → SNS → event: Bounce
3. SNS konsolu → aynı topic'e HTTPS aboneliği: `https://{deploy-domain}/api/track/bounce`
4. Abonelik onayı otomatik yapılır — localhost'ta test edilemez, sadece deploy edilmiş public domain'de çalışır.

> **NOT (güvenlik):** Mevcut AWS SES SMTP kimlik bilgileri paylaşım sırasında açığa çıkmıştı — kullanıcı yeni credential'ı `.env.local`'a ekledi ve SMTP bağlantısı doğrulandı (8 Ağustos 2026).

### ✅ BUG — `page` ve `size` parametreleri işlenmiyor (9 Ağustos 2026) → **DÜZELTILDI**

`GetSeafarersByFillBucket` **her zaman sabit 10 kayıt** dönüyor, `size` parametresi ne olursa olsun. Daha kritik olarak **`page` parametresi tamamen göz ardı ediliyor** — farklı sayfa istense bile aynı ilk 10 kayıt geri geliyor.

**Kanıt (canlı test, bucket=zero):**
```
GET ...?bucket=zero&page=1&size=50   → 10 kayıt, ilk userId: 13320
GET ...?bucket=zero&page=2&size=50   → 10 kayıt, ilk userId: 13320  (AYNI)
GET ...?bucket=zero&page=3&size=50   → 10 kayıt, ilk userId: 13320  (AYNI)
GET ...?bucket=zero&page=100&size=10 → 10 kayıt, aynı 10 userId    (AYNI)
```

**Etki:** 6.413 kişilik "zero" segmentinden şu an yalnızca **10 kişiye** erişilebiliyor. Pazarlama panelinde "Segmentten Yükle" hep aynı 10 kaydı getiriyor, geri kalan ~6.400 kişiye ulaşılamıyor. Bu, e-posta re-aktivasyon kampanyasının asıl amacını (büyük segmentlere ulaşmak) engelliyor.

**Beklenen davranış:** `page` arttıkça `(page-1)*size` offset'inden itibaren farklı kayıtlar dönmeli (standart sayfalama). `size` parametresi de gerçekten istenen kayıt sayısını (ör. 200) dönmeli, sabit 10'a kilitli kalmamalı.

### ✅ YENİ İSTEK — `GetSeafarersByFillBucket` response'una `nationality` eklensin (9 Ağustos 2026) → **TAMAMLANDI**

E-posta re-aktivasyon kampanyasında içerik dilinin gemi adamının uyruğuna göre otomatik seçilebilmesi isteniyor (ör. Filipinli kullanıcıya İngilizce/Filipince, Ukraynalıya Ukraynaca). Bunun için response'a bir alan eklenmesi gerekiyor:

```
Response item: { userId, email, fullName, fillRate, lastActiveAt, emailOptOut, unsubscribeUrl, nationality }
```

- `nationality`: ISO 3166-1 alpha-2 ülke kodu tercih edilir (ör. `"TR"`, `"PH"`, `"UA"`) — serbest metin ülke adı da kabul edilebilir ama kod daha güvenilir eşleştirme sağlar.
- Pazarlama panelinde bu alanın hangi formatta geleceğine göre eşleştirme tablosu (`NATIONALITY_TO_LANGUAGE_CODE`, `crewinjob-agent/modules/retention.js`) zaten hazır — alan eklenince otomatik devreye girer, ek kod değişikliği gerekmez.
- Alan gelene kadar panelde kampanya dili manuel seçiliyor (tüm segment için tek dil).

---

## 🟡 A4. P0 CV Parse — canlı doğrulama

Endpoint'ler mevcut ama gerçek CV ile uçtan uca test edilmeli:
```
POST /GemiAdamiGenel/UploadAndParseCV    (multipart/form-data)
POST /GemiAdamiGenel/ConfirmParsedCV
```
**Kontrol:** Gerçek bir PDF CV ile parse → önizleme → onay → profil doluluk oranı artıyor mu? `isExpired: true` sertifikalar `warnings`e düşüyor mu?

---

## 🟡 A5. P4 Sosyal Kayıt (LinkedIn / Google) — başlanmadı

- LinkedIn OAuth: `openid + profile + email` minimum scope
- LinkedIn `positions` → sea service önizlemesine eşle (P0 mantığı)
- Mevcut e-posta ile çakışma yönetimi
- Backend: OAuth callback + hesap eşleştirme/oluşturma

---

## 🟢 A6. Event tracking endpoint'leri

Aktivasyon hunisini ölçmek için (yoksa eklenmeli):
```
onboarding_shown / onboarding_cv_selected / onboarding_manual_selected / onboarding_skipped
cv_uploaded / cv_parse_succeeded / cv_parse_partial / cv_parse_failed / cv_parse_confirmed
profile_completed_50 / profile_completed_80
certificate_uploaded / availability_updated
social_signup_initiated / social_signup_completed
```

---

# BÖLÜM B — FRONTEND (crewinjob.com) YAPILACAKLAR

## 🔴 B1. P0 + P1 — CV Yükle + Onboarding ekranı (en yüksek kaldıraç)

Kayıt tamamlanınca gösterilecek onboarding akışı:
```
Kayıt biter
  ↓ GET GetOnboardingState (gösterilmediyse)
  ↓ POST MarkOnboardingShown
Kullanıcı seçer:
  • "CV Yükle"      → UploadAndParseCV → önizleme (düzenlenebilir) → ConfirmParsedCV → CompleteOnboarding
  • "Manuel Doldur" → profil formu
  • "Şimdi Değil"   → SkipOnboarding → dashboard + kalıcı hatırlatma banner'ı
```
- CV önizleme ekranı: tüm alanlar düzenlenebilir olmalı.
- Parse başarısız → kullanıcı manuel forma yönlendirilir (dead-end olmamalı).
- `Content-Type: multipart/form-data` header'ı **manuel set edilmemeli**.

## 🟠 B2. P3 — Profil ekranında görünürlük ipuçları

`GetProfileVisibilityGain` çıktısını profil alanlarının yanına yerleştir:
```
[ Sea Service ]  — [Doldur]
  ℹ️ "Bu alanı ekleyerek 34 ilanda daha görünürsün"
[ Sertifikalar ] — [Yükle]
  ℹ️ "STCW sertifikan eksik — 89 ilan sertifika gerektiriyor"
```

## 🟠 B3. Doluluk ilerleme çubuğu + "%60 = işe hazır" eşiği

263 kişi eşiği bilmiyor. Profilde ilerleme çubuğu:
```
Profilin %45 dolu ▓▓▓▓▓░░░░░  →  %60'a ulaş, şirketlere görün!
```
%30–60 arasındaki 655 kişiyi ittirir — düşük efor, hızlı kazanç.

## 🟡 B4. Kayıt formuna sosyal kayıt butonları (P4 ile birlikte)

"LinkedIn ile Kayıt Ol" + "Google ile Kayıt Ol" butonları.

---

# BÖLÜM C — PAZARLAMA PANELİ (crewinjob-web) — ÇOĞU HAZIR ✅

Bunlar bizde tamamlandı, backend'den sadece A1/A2/A3'ün düzelmesini bekliyor:

- ✅ Proxy route'lar: `/api/cv/upload`, `/api/cv/confirm`, `/api/activation/segments`, `/api/activation/visibility-gain`, `/api/activation/onboarding`
- ✅ KPI raporu + geçmiş + iki rapor arası metrik karşılaştırma + AI trend değerlendirmesi
- ✅ Retention içerik üretimi (segment endpoint'i düzelince gerçek veriyle çalışacak)
- ⏳ A3 (segment export) gelince: e-posta re-aktivasyon kampanyası kurgusu

---

# ÖNCELİK ÖZETİ

| # | İş | Taraf | Öncelik |
|---|---|---|---|
| A1 | 3 endpoint 500 fix + `userId` desteği | Backend | 🔴 Acil |
| A2 | "Yeni kayıt" sayacı doğrulama | Backend | 🔴 Acil |
| A2.5 | sitemap.xml'e ilan + blog URL'leri ekleme | Backend/Frontend | 🔴 Acil |
| B1 | CV Yükle + Onboarding ekranı | Frontend | 🔴 Yüksek |
| A3 | E-posta segment export + opt-out | Backend | 🟠 Yüksek |
| B2 | Görünürlük ipuçları | Frontend | 🟠 Orta |
| B3 | İlerleme çubuğu / %60 eşiği | Frontend | 🟠 Orta |
| A4 | CV parse canlı doğrulama | Backend | 🟡 Orta |
| A5 / B4 | Sosyal kayıt (LinkedIn/Google) | Her ikisi | 🟡 Düşük |
| A6 | Event tracking | Backend | 🟢 Sürekli |

---

# BAŞARI HEDEFLERİ

| Metrik | Bugün | 4 hafta | 12 hafta |
|--------|-------|---------|----------|
| İşe hazır (%60+) | 263 (%2,4) | ~1.000 (%9) | ~2.500 (%22) |
| %0'da bekleyen | 6.413 (%57,6) | %45 altı | %30 altı |
| CV parse kullanımı | — | Yeni kayıtların %40'ı | %60'ı |
| Kayıt → profil başlama | ölçülmüyor | %50 | %70 |
