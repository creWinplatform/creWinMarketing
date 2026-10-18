# CrewinJob — Frontend Ekibine İletişim

**Tarih:** 14 Ağustos 2026
**Hazırlayan:** Pazarlama / Growth
**Alıcı:** Frontend ekibi (crewinjob.com)

> **Not:** Tüm API çağrıları `API_BASE` environment değişkeni üzerinden yapılmalı.
> `/jobs/detail/.../api/...` gibi frontend path'i içine gömülü URL oluşturulmamalı.

---

## Neden Acele? (Canlı Veri — 14 Ağustos 2026)

| Segment | Kişi | Oran |
|---|---:|---:|
| %0 — Profile hiç dokunmamış | 6.413 | 57,6% |
| %0–30 — Yarım bırakmış | 3.799 | 34,1% |
| %30–60 — İlerlemiş | 655 | 5,9% |
| %60+ — İşe hazır (şirketlere görünür) | 263 | 2,4% |
| **Toplam** | **11.130** | Ort. doluluk **%10** |

---

## 🔴 B1. CV Yükle + Onboarding Ekranı — Hemen Başlanabilir

Endpoint'ler backend tarafından hazır.

### Akış

```
Kayıt tamamlanır
  ↓
GET GetOnboardingState  (daha önce gösterilmediyse devam et)
  ↓
POST MarkOnboardingShown
  ↓
Kullanıcı seçer:
  ├── "CV Yükle"       → Belge İçe Aktarma akışı (aşağıya bak) → önizleme → ConfirmParsedCV → CompleteOnboarding
  ├── "Manuel Doldur"  → profil formu
  └── "Şimdi Değil"    → SkipOnboarding → dashboard + kalıcı hatırlatma banner'ı
```

### Belge İçe Aktarma — Doğru Akış ve Endpoint'ler

> ⚠️ **Kritik düzeltme (16 Ağustos 2026):** `BelgeGetir` POST çağrılıyordu → backend 405 dönüyordu. Tüm GET endpoint'leri aşağıdaki gibi doğru metotla çağrılmalı.

```
1. POST /GemiAdamiBelgeIceAktarma/BelgeYukle
        body: multipart/form-data, alan adı "dosya"
        → response: { belgeId }

2. POST /GemiAdamiBelgeIceAktarma/IslemBaslat?id={belgeId}

3. GET  /GemiAdamiBelgeIceAktarma/IslemDurumu?id={belgeId}
        (belirli aralıklarla poll et — BelgeGetir değil bu endpoint kullanılmalı)
        → durum "KullaniciOnayiBekliyor" gelene kadar bekle

4. GET  /GemiAdamiBelgeIceAktarma/TaslakVeriGetir?belgeIceAktarmaId={belgeId}
        → önizleme için taslak veriyi al

5. POST /GemiAdamiGenel/ConfirmParsedCV   { mevcutVerileriTemizle: true }
6. POST /GemiAdamiGenel/CompleteOnboarding
```

**Onboarding dışında CV güncellemesi için aynı akış, son iki adım olmadan kullanılır.**

### Önemli Detaylar

- `Content-Type: multipart/form-data` **manuel set edilmemeli** — browser boundary'yi kendisi üretmeli.
- Dosya alanının adı: **`dosya`**
- Tüm isteklerde `Authorization: Bearer <token>` header'ı korunmalı.
- **Local API adresi:** Backend `http://localhost:44312` üzerinde çalışıyor. Frontend'in `API_BASE` (veya eşdeğer env değişkeni) bu adrese işaret etmeli.
- **CORS (local test):** Backend CORS listesine `http://localhost:3083` eklenmeli; yoksa tarayıcı isteği bloklar. Alternatif: frontend env'ini `http://localhost:44312` olarak ayarla, doğrudan backend'e git.
- CV önizleme ekranında tüm alanlar düzenlenebilir olmalı.
- Parse başarısız olursa dead-end değil, manuel forma yönlendirme.
- `ConfirmParsedCV` çağrısında **`mevcutVerileriTemizle: true`** gönderilmeli — eski hatalı profil verisi temizlenip yeni CV verisi daha tutarlı uygulanır.
- Partial import dönerse (`uygulananKalemSayisi`, `basarisizKalemSayisi`, `temizlenenKayitSayisi`, `uygulanamayanKalemler`) kullanıcıya anlaşılır mesajla gösterilmeli.
- **Test notu:** Eski draft değil, her test için CV yeniden yüklenmeli — eski taslaklar eski OCR çıktısını taşır.

### Certificate of Competency — Frontend Beklentisi

Endorsement tablosunda belge adı ayrı alan olarak yok; değer `Explanation` alanında tutulur. Liste ekranında açıklama alanı gösteriliyorsa burada `Certificate of Competency` görülebilir — ayrı endorsement tipi kolonu beklenmemeli.

---

---

## 💳 Havale / EFT Self-Servis Satın Alma Akışı (YENİ — 30 Ağustos 2026)

Mevcut Stripe/kredi kartı satın alma sayfasına **"Havale / EFT ile öde"** seçeneği ekleniyor.
Admin onayına kadar kredi tanımlanmaz — hiçbir zaman otomatik onay yapılmaz.

### Akış

```
Paket seçim ekranı
  ↓
Ödeme yöntemi seçimi:
  ├── [💳 Kredi Kartı]  → mevcut Stripe akışı (değişiklik yok)
  └── [🏦 Havale / EFT] → HavaleSiparisiOlustur çağrısı
                              ↓
                         Referans kodu + banka bilgileri ekranı
                              ↓
                         "Siparişlerim" / takip ekranı (polling)
```

### Endpoint'ler

```
POST /FirmaSiparis/HavaleSiparisiOlustur
  Body: { paket, talepEdilenHaklar, tutar, paraBirimi }
  → { siparisId, referansKodu, bankaHesapBilgileri, tutar, paraBirimi, sonGecerlilikTarihi }

GET  /FirmaSiparis/SiparisDurumu?siparisId={id}
  → { siparisId, referansKodu, durum, olusturmaTarihi, sonGecerlilikTarihi }
  durum: "BeklemeyeAlindi" | "Onaylandi" | "IptalEdildi"

GET  /FirmaSiparis/MyOrders?sayfa=1&boyut=20
  → ABP wrapper: { result: { items, totalCount } }
  Tercih edilen "Siparişlerim" liste endpoint'i. Giriş yapan firma kullanıcısının kendi firmasına ait havale/EFT siparişlerini döndürür.

GET  /FirmaSiparis/GetAll?companyId={companyUserId}&sayfa=1&boyut=20
  → ABP wrapper: { result: { items, totalCount } }
  Alternatif liste endpoint'i. Backend yine sadece giriş yapan firma kullanıcısının kendi firmasına ait siparişleri döndürür; başka companyId gönderilirse veri dönmez veya yetki hatası alınır.
```

### Siparişlerim Listesi

Liste ekranında tercihen `MyOrders` kullanılmalı; frontend'in client tarafında farklı firma id'leriyle veri çekmeye çalışmasına gerek yok.

Kayıt alanları:
- `id`
- `siparisId`
- `referansKodu`
- `durum`
- `status`
- `paket`
- `tutar`
- `paraBirimi`
- `sonGecerlilikTarihi`
- `creationTime`
- `createdAt`
- `talepEdilenHaklar`

`talepEdilenHaklar` artık JSON string değil, doğrudan dizi olarak gelir. Her eleman `{ hakTipi, miktar }` formatındadır.

Liste `creationTime` descending sıralı gelir; yani en yeni sipariş en üsttedir.

### Referans Kodu Ekranı (onaylama bekleniyor)

Kullanıcıya gösterilecekler:
- **Referans kodu** — büyük, okunabilir font. Yanında 📋 kopyala butonu (clipboard API).
- **Banka bilgileri** — Banka adı, hesap adı, IBAN, "Açıklamaya referans kodunu yazın" notu.
- **Tutar** — net, para birimi ile birlikte.
- **Son geçerlilik tarihi** — "Bu sipariş {tarih} tarihine kadar geçerlidir."
- **Durum göstergesi** — `SiparisDurumu` endpoint'ine her 30 saniyede bir polling, `Onaylandi` gelince otomatik "Tebrikler" ekranına geç.

```
┌─────────────────────────────────────────────────┐
│  🏦 Havale Bilgileri                            │
│                                                 │
│  Banka: Garanti BBVA                            │
│  Hesap: CrewinJob Teknoloji A.Ş.                │
│  IBAN:  TR12 0006 2000 1234 0006 2998 38        │
│                                                 │
│  Tutar: $499,00 USD                             │
│                                                 │
│  Açıklamaya mutlaka yazın:                      │
│  ┌────────────────────────────┐                 │
│  │  CRW-84-20260830-7312   📋 │                 │
│  └────────────────────────────┘                 │
│                                                 │
│  ⏳ Ödemeniz bekleniyor...                       │
│  Son geçerlilik: 6 Eylül 2026                   │
│                                                 │
│  [Siparişlerimi Gör]   [Ana Sayfaya Dön]        │
└─────────────────────────────────────────────────┘
```

### Önemli Detaylar

- Referans kodu kopyalanınca "Kopyalandı ✓" feedback'i gösterilmeli (2 sn).
- Banka bilgileri `HavaleSiparisiOlustur` response'undan gelmeli — sabit kodlanmamalı.
- Sipariş onaylandığında (`Onaylandi`) kullanıcıya e-posta bildirimi gidecek (backend halleder), ama UI'da da "Krediniz tanımlandı!" ekranı gösterilmeli.
- Süresi dolmuş bekleyen siparişleri (`IptalEdildi`) kullanıcı "Siparişlerim" ekranında görebilmeli ama yeni sipariş oluşturmak için yeni bir seçim yapması gerekiyor.
- Polling için `setInterval` kullan, component unmount'ta temizle. Sekme arka plana alınınca polling durabilir — `visibilitychange` event'inde yeniden başlat.
- `Onaylandi` durumu gelince 3 saniyelik bir success animasyonu göster, sonra pakete uygun Dashboard'a yönlendir.

### Hata Durumları

| Durum | Kullanıcıya gösterilecek |
|---|---|
| `409` — zaten 3 bekleyen sipariş var | "En fazla 3 bekleyen sipariş açabilirsiniz. Önce mevcut bir siparişi iptal edin." |
| Network hatası | "Bağlantı kurulamadı, lütfen tekrar deneyin." — retry butonu |
| Sipariş süresi dolmuş | "Bu sipariş süresi doldu. Yeni bir havale siparişi oluşturabilirsiniz." |

---

## 📧 Email Aktivasyon Linki Formatı

```
https://www.crewinjob.com/account/register/verify-code/{confirmationCode}?userId={numericUserId}
```

- `confirmationCode` → path parametresi
- `userId` → query parametresi
- Frontend bu route'ta ikisini okuyup `POST /Account/ActivateEmail` çağırmalı.

**Email şablonları:** Kullanıcının dili Türkçe ise mail tamamen Türkçe, İngilizce ise tamamen İngilizce görünmeli. Karışık dil olmamalı.

---

## 👤 Büyüme / KPI Sayaçları

Backend `newToday`, `newThisWeek`, `newThisMonth` alanlarını döndürüyor. Frontend bu alanları kullanmalı, sıfır/null gelen değerlerde kendi tahminiyle doldurmamalı — backend response'u esas alınmalı.

---

## 🔔 Görünürlük İpuçları (B2)

```
GET /GemiAdamiGenel/GetProfileVisibilityGain?userId={id}
```

Her profil alanı için "bunu doldurursan kaç ilana daha görünürsün" bilgisini döndürüyor. Profil alanlarının yanına yerleştirme:

```
[ Sea Service ]  — [Doldur]
  ℹ️ "Bu alanı ekleyerek 34 ilanda daha görünürsün"

[ Sertifikalar ] — [Yükle]
  ℹ️ "STCW sertifikan eksik — 89 ilan sertifika gerektiriyor"
```

---

## 📊 Doluluk İlerleme Çubuğu (B3) — Hemen Başlanabilir

`fillRate` alanı mevcut endpoint'lerden geliyor. Profil sayfasında:

```
Profilin %45 dolu  ▓▓▓▓▓░░░░░
→ %60'a ulaş, şirketlere görün!
```

%60 eşiği geçince "Tebrikler, artık görünürsün" mesajı/rozeti gösterilebilir.

---

## 📋 Seafarer Segment Export / Unsubscribe

```
GET /GemiAdamiGenel/GetSeafarersByFillBucket?bucket={zero|low|mid|high}&page={n}&size={n}
```

Response alanları: `userId, email, fullName, fillRate, lastActiveAt, emailOptOut, unsubscribeUrl, nationality`

- Bucket eşikleri: `zero=0, low=1-49, mid=50-79, high=80+`
- `emailOptOut=true` kullanıcılar gönderim listesine alınmamalı.
- **Unsubscribe akışı:** Frontend doğrudan `userId` ile işlem yapmamalı. Backend'in döndürdüğü `unsubscribeUrl` (opak/imzalı token) linki pazarlama mailinde "abonelikten çık" olarak verilmeli.

---

## 🔗 LinkedIn OAuth

**Hatalı format (kullanılmamalı):**
```
/jobs/detail/undefined/api/auth/linkedin/start?...
```

**Doğru format:** API base üzerinden başlamalı:
```
{API_BASE}/auth/linkedin/start?noticeId={noticeId}
```

Callback/success/error sayfaları frontend domaininde karşılanmalı.

---

## 📂 Başvuru Yönetimi

**Endpoint'ler:**

```
GET  /IlanBasvuru/GetAll                              → status, basvuruTarihi, fitScore desc sıralı
PUT  /IlanBasvuru/UpdateStatus                        → durum güncelleme
GET  /IlanBasvuru/GetStatusSummary?noticeId={id}      → özet
```

**Status enum:**

| Değer | Anlam |
|---|---|
| 0 | New / Yeni |
| 1 | Reviewing / İnceleniyor |
| 2 | Shortlisted / Kısa Liste |
| 3 | Interview / Mülakat |
| 4 | Rejected / Reddedildi |

**Summary response alanları:** `total, yeni, inceleniyor, kisaListe, mulakat, reddedildi, fitScoreOver80`

Ekstra sıralama gerekiyorsa `sorting` query parametresi gönderilmeli.

---

## 🤖 AI / Recruiter Asistan Endpoint'leri

```
POST /GemiAsistan/Chat
GET  /RecruiterAsistani/BasvuruOzeti
GET  /GemiAdamiTutarlilik/Bulgular
GET  /OnEleme/SoruOner
GET  /OnEleme/Sorular
GET  /OnEleme/Ozeti
```

**Sertifika provider listesi — POST çalışıyor (GET değil):**
```
POST /api/services/app/GemiAdamiTutarlilik/SertifikaDogrulamaProviderlariniGetir
```

**Sertifika doğrulama:**
```
POST /api/services/app/GemiAdamiTutarlilik/SertifikaDogrula
Payload: { id, ulkeKodu, belgeNo, kimlikNo, dogumTarihi }
```

Hata durumunda `err.response.data.error.message` kullanıcıya gösterilmeli.

---

## ❓ Ön Eleme Soruları — Normalize Edilmeli

Backend string array veya `{ metin, cevapTipi }` formatında dönebilir — frontend normalize etmeye devam etmeli.

Beklenen `cevapTipi` değerleri: `text`, `numeric`, `yes_no`

`Accept-Language` header gönderilmeye devam etmeli; AI cevapları frontend diline göre beklenir.

---

## 🔔 Bildirimler / Toplantı Akışı

- `null` tarihler `Invalid Date` göstermemeli → `-` fallback kullanılmalı.
- Açıklama alanında: `descriptionTr` boşsa `description`, `description` boşsa `descriptionTr` fallback.
- İptal/kabul/red/tarih değişikliği ana işlem çağrıları, bildirim çağrısından **önce** yapılmalı. Bildirim çağrısı hata verirse ana işlem bloklanmamalı.

---

## 🔍 SEO / Sitemap

- `/bullseye` değil → `/bullseye/seafarers` kullanılmalı.
- `/homepage` → canonical olarak `/` sayfasına bağlanmalı, duplicate içerik `noindex`/`canonical` ile yönetilmeli.
- `robots.txt` içindeki `/account/` engeli doğru davranış, değiştirilmemeli.

---

## 📚 Akademik Referans / Eğitmen

`/api/services/app/AkademikReferans/CreateOrEdit` 404 dönüyorsa servis adı/route deploy kontrolü gerekiyor. Bu modülde endpoint netleşmeden frontend generic hata göstermeli.

---

## Öncelik Özeti

| # | İş | Öncelik | Backend Bağımlılığı |
|---|---|---|---|
| B1 | CV Yükle + Onboarding ekranı | 🔴 Yüksek | Yok (hazır) |
| B3 | İlerleme çubuğu / %60 eşiği | 🟠 Orta | Yok (fillRate geliyor) |
| B2 | Görünürlük ipuçları | 🟠 Orta | Yok (hazır) |
| Başvuru Yönetimi | Status/summary endpoint entegrasyonu | 🟠 Orta | Yok (hazır) |
| OAuth fixes | LinkedIn path düzeltmesi | 🟠 Orta | A5 ile birlikte |
| B4 | Sosyal kayıt butonları | 🟡 Düşük | A5 ile birlikte |

---

## Hedefler

| Metrik | Bugün | 4 Hafta | 12 Hafta |
|--------|-------|---------|----------|
| İşe hazır (%60+) | 263 (%2,4) | ~1.000 (%9) | ~2.500 (%22) |
| %0'da bekleyen | 6.413 (%57,6) | %45 altı | %30 altı |
| CV parse kullanımı | — | Yeni kayıtların %40'ı | %60'ı |
| Kayıt → profil başlama | ölçülmüyor | %50 | %70 |
