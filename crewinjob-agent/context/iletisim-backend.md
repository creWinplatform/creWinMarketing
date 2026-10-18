# CrewinJob — Backend Ekibine İletişim

**Tarih:** 14 Ağustos 2026
**Hazırlayan:** Pazarlama / Growth
**Alıcı:** Backend ekibi

---

## ✅ Tamamlanan İşler (Teşekkürler)

### A1. Onboarding / Aktivasyon Endpoint'leri ✅

`GetIncompleteProfileSegments`, `GetProfileVisibilityGain` ve `GetOnboardingState` endpoint'leri hazır.

- Servis/admin bağlamında çağrılan agregat endpoint'ler gemi adamı profili varsaymıyor.
- Kullanıcı-özel ekranlarda `userId` ile çağrılabiliyor.

### A2. Yeni Kayıt / Büyüme İstatistikleri ✅

Backend tarafında kontrol edildi. `newToday`, `newThisWeek`, `newThisMonth` alanları geliyor.

### A3. E-posta Re-aktivasyon Altyapısı ✅

`GetSeafarersByFillBucket` endpoint'i çalışıyor:
- Bucket eşikleri: `zero=0, low=1-49, mid=50-79, high=80+`
- Response alanları: `userId, email, fullName, fillRate, lastActiveAt, emailOptOut, unsubscribeUrl, nationality`
- Sayfalama (`page`/`size`) çalışıyor.
- `emailOptOut=true` kullanıcılar backend tarafından zaten dışarıda bırakılıyor.
- `unsubscribeUrl` opak token'lı hazır link olarak geliyor.

### CV Parse — Bug Düzeltmeleri ✅ (14 Ağustos 2026)

- Pasaport: `GemiAdamiVize` tablosuna `VisaType="International passport"` (Id=1) kaydediliyor.
- US Visa tip adı düzeltildi ("US visa B1/OCS"), C1/D ve B1/B2 ayrı tespit ediliyor.
- Çoklu vize tarih eşleştirmesi düzeltildi.
- Schengen vizesinde `CountryName`/`CountryCode` artık null kalıyor.
- Süresiz sertifikaların expiry alanı boş/N/A/"-" olsa kayıt atlanmıyor.
- "COC & ENDORSEMENT" başlığı destekleniyor.
- `mevcutVerileriTemizle=true` rollback mekanizması eklendi.

---

## 🔴 Bekleyen — Acil

### A2.5. sitemap.xml'de İlan ve Blog URL'leri Yok

`https://www.crewinjob.com/sitemap.xml` şu an sadece 12 statik sayfa döndürüyor. 10.000+ aktif ilan ve blog yazıları yok.

**Etki:** Google ilanları sitemap üzerinden keşfedemiyor.

**İyi haber:** `/jobs/detail/{id}` sayfalarında `schema.org/JobPosting` zaten mevcut ve doğrulandı — sitemap düzelince Google Indexing API devreye alınabilir.

**Yapılması gereken:**

1. `sitemap.xml` dinamik üretilmeli: tüm aktif ilanlar (`/jobs/detail/{id}`) + yayınlanmış blog yazıları, `lastmod` gerçek güncelleme tarihi.
2. İlan kapandığında sitemap'ten otomatik çıkmalı.
3. Ölçek için sitemap index + parçalı yapı düşünülebilir (`sitemap-jobs-1.xml`, `sitemap-blog.xml`).

**Kabul kriteri:** `sitemap.xml` içinde `/jobs/detail/{id}` kalıbında en az aktif ilan sayısı kadar `<url>` girdisi, her birinin `lastmod`'u ilanın gerçek tarihine eşit.

---

## 🟡 Bekleyen — Orta Öncelik

### A4. CV Parse — Canlı Uçtan Uca Test

Bugünkü düzeltmeler sonrası gerçek bir PDF CV ile test edilmeli (**eski draft değil, yeni yükleme**):

```
POST /GemiAdamiGenel/UploadAndParseCV    (multipart/form-data)
POST /GemiAdamiGenel/ConfirmParsedCV
```

**Beklenen yeni davranışlar (test referansı):**
- Position/Employment Status satırı: pozisyon → Chief Engineer, iş durumu → Contract is on the way
- Citizenship/Residence: uyruk → Turkish, şehir → Istanbul
- Eğitim: okul → ISTANBUL TECHNICAL UNIVERSITY, GPA → 2.36, mezuniyet → 04.07.2014
- Dil: English / Lower Intermediate
- Sağlık: COVID-19 Vaccination / Pfizer-BioNTech
- Vize: US Visa B1 OSC → United States (American Samoa artık görünmemeli)
- Endorsement: Certificate of Competency ve Endorsement kayıtları görünmeli

### A5. Sosyal Kayıt — LinkedIn / Google OAuth

- LinkedIn OAuth: `openid + profile + email` minimum scope
- `positions` → sea service önizlemesine eşleme
- Mevcut e-posta çakışma yönetimi
- OAuth callback route'u frontend domaininde karşılanmalı (hatalı örnek: `/jobs/detail/undefined/api/auth/linkedin/start?...`)

### A6. Event Tracking Endpoint'leri

Whitelist'e eklenmesi istenen event'ler:

```
onboarding_shown / onboarding_cv_selected / onboarding_manual_selected / onboarding_skipped
cv_uploaded / cv_parse_succeeded / cv_parse_partial / cv_parse_failed / cv_parse_confirmed
profile_completed_50 / profile_completed_80
certificate_uploaded / availability_updated
social_signup_initiated / social_signup_completed
```

---

## AWS SES Bounce Webhook — Manuel Kurulum Gerekiyor

Kod hazır, sadece AWS konsolundan kurulum bekleniyor:

1. SES konsolu → Configuration sets → yeni set oluştur → adını `SES_CONFIGURATION_SET` env değişkenine yaz
2. Event destination → SNS → event: **Bounce**
3. SNS → HTTPS aboneliği: `https://{deploy-domain}/api/track/bounce`
4. Abonelik onayı otomatik yapılır (sadece public domain'de çalışır)

---

## Öncelik Özeti

| # | İş | Öncelik |
|---|---|---|
| A2.5 | sitemap.xml dinamik ilanlar + blog | 🔴 Acil |
| SES Bounce | AWS konsolundan SNS kurulumu | 🟠 Yüksek |
| A4 | CV parse canlı doğrulama | 🟡 Orta |
| A5 | Sosyal kayıt (LinkedIn/Google) | 🟡 Düşük |
| A6 | Event tracking genişletme | 🟢 Sürekli |
