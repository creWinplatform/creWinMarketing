# Backend Geliştirme Brief'i — Seafarer Activation

**Tarih:** 30 Temmuz 2026  
**Hedef:** crewinjob.com backend & frontend ekibi  
**Durum:** P0–P3 endpoint'leri backend tarafından teslim edildi ✅

---

## Neden Bu Geliştirmeler?

Platformda 11.130 kayıtlı gemi insanı var. Bunların yalnızca **263'ü (%2,4)** şirketlere
sunulabilir durumda. Geri kalan 10.867 kişi sisteme kayıtlı ama şirket aramalarında görünmüyor.

6.413 kullanıcı (%57,6) kayıt sonrası profil bölümüne hiç girmemiş. Sorun kayıt formunda
değil — kayıt *sonrasında* devreye girecek akışta.

---

## API Base URL

```
{API_BASE} = https://api.crewin.org/api/services/app
```

Tüm endpoint'ler `Authorization: Bearer {token}` ister.  
Token: `POST https://api.crewin.org/api/TokenAuth/Authenticate`

---

## P0 — CV Parse ile Otomatik Profil Doldurma ✅ Backend Teslim Edildi

### Upload Endpoint

```
POST {API_BASE}/GemiAdamiGenel/UploadAndParseCV
Content-Type: multipart/form-data  ← browser/FormData kendisi üretir, manuel set etme
```

**Form alanı:** `dosya` veya `file` (backend her ikisini kabul eder)

**Query parametreleri (opsiyonel):**

| Parametre | Tip | Açıklama |
|-----------|-----|----------|
| `belgeKaynakTipi` | int | Varsayılan: `1` |
| `forceOcr` | bool | Taranmış PDF için OCR zorla |
| `islemBaslat` | bool | Parse işlemini hemen başlat |

**Response:**
```json
{
  "result": {
    "success":    true,
    "parseId":    "uuid",
    "belgeId":    42,
    "taslakId":   17,
    "status":     "success",
    "confidence": 0.87,
    "extractedFields": {
      "fullName":    "Ali Yıldız",
      "rank":        "Chief Officer",
      "nationality": "Turkish",
      "seaService":  [{ "vesselName": "...", "vesselType": "...", "rank": "...", "company": "...", "dateFrom": "2022-03", "dateTo": "2023-09", "durationMonths": 18, "flag": "..." }],
      "certificates": [{ "type": "STCW II/2", "number": "TR-2019-123456", "issuedBy": "Türk Loydu", "issueDate": "2019-06-15", "expiryDate": "2024-06-14", "isExpired": false }],
      "documents":   [],
      "email":       "ali@example.com",
      "phone":       "+90 532 123 45 67"
    },
    "warnings":      ["Sertifika TC-2018-789 geçerlilik tarihi geçmiş — profile eklenmedi"],
    "failedFields":  ["photo", "references"]
  }
}
```

**Önemli:** `isExpired: true` olan sertifikalar `warnings` listesine eklenmeli, profile yazılmamalı.

### Onay Endpoint

```
POST {API_BASE}/GemiAdamiGenel/ConfirmParsedCV
Content-Type: application/json
```

**Body (iki format kabul ediliyor):**
```json
{ "belgeId": 42, "onaylananKalemIds": [1, 2, 3] }
```
veya
```json
{ "belgeId": 42, "onaylananKalemler": [{ "taslakKalemId": 1, "onaylandi": true }] }
```

**Response:**
```json
{
  "result": {
    "success":          true,
    "parseId":          "uuid",
    "taslakId":         17,
    "appliedFieldCount": 8
  }
}
```

### Kullanıcı akışı
```
1. Kullanıcı "CV Yükle" butonuna tıklar
2. POST UploadAndParseCV → parse sonucu döner (15 sn timeout önerisi)
3. Önizleme ekranı açılır — tüm alanlar düzenlenebilir
4. Kullanıcı "Onayla" → POST ConfirmParsedCV
5. Profil dolar, doluluk oranı güncellenir
6. Hata: parse başarısız → kullanıcı manuel forma yönlendirilir

Content-Type: multipart/form-data header'ını ASLA manuel set etme.
Browser veya FormData paketi boundary'yi otomatik ekler.
```

### Frontend entegrasyon (web dashboard proxy)
```
POST /api/cv/upload   → UploadAndParseCV proxy
POST /api/cv/confirm  → ConfirmParsedCV proxy
```

---

## P1 — Kayıt Sonrası Onboarding Akışı ✅ Backend Teslim Edildi

### Onboarding Durum Endpoint'leri

```
GET  {API_BASE}/GemiAdamiGenel/GetOnboardingState[?userId={id}]
POST {API_BASE}/GemiAdamiGenel/MarkOnboardingShown    body: {}
POST {API_BASE}/GemiAdamiGenel/SkipOnboarding         body: {}
POST {API_BASE}/GemiAdamiGenel/CompleteOnboarding     body: {}
```

`userId` verilmezse login olan kullanıcı baz alınır.

**Akış:**
```
Kayıt tamamlanır
  ↓
GET GetOnboardingState → gösterilmedi ise:
  ↓
POST MarkOnboardingShown çağrılır (gösterildi flag'ini işaretler)
  ↓
Kullanıcı seçim yapar:
  • "CV Yükle"     → P0 akışı başlar, sonunda POST CompleteOnboarding
  • "Manuel Doldur"→ profile form açılır
  • "Şimdi Değil"  → POST SkipOnboarding → dashboard'a geçer, kalıcı banner koyulur
```

### Frontend entegrasyon (web dashboard proxy)
```
GET  /api/activation/onboarding?userId={id}     → GetOnboardingState
POST /api/activation/onboarding  body: { action: "MarkOnboardingShown" }
POST /api/activation/onboarding  body: { action: "SkipOnboarding" }
POST /api/activation/onboarding  body: { action: "CompleteOnboarding" }
```

---

## P2 — Eksik Alan Segment Endpoint'i ✅ Backend Teslim Edildi

```
GET {API_BASE}/GemiAdamiGenel/GetIncompleteProfileSegments
```

**Response:**
```json
{
  "result": {
    "segments": [
      { "missingField": "seaService",   "count": 412, "lastActiveDaysAvg": 14 },
      { "missingField": "certificates", "count": 198, "lastActiveDaysAvg": 21 },
      { "missingField": "documents",    "count": 89,  "lastActiveDaysAvg": 30 },
      { "missingField": "photo",        "count": 267, "lastActiveDaysAvg": 7  },
      { "missingField": "references",   "count": 145, "lastActiveDaysAvg": 45 }
    ]
  }
}
```

**`missingField` değerleri sabit ve bu anahtarlarla birebir eşleşmeli:**
`seaService` · `certificates` · `documents` · `photo` · `references`

Backend bu listeyi öncelik sırasıyla döner. Pazarlama tarafındaki `retention.js` bu anahtarlara
göre içerik seçtiğinden farklı anahtar gelmesi içerik eşleşmesini bozar.

### Marketing agent entegrasyonu
`api.js`'deki `fetchAllData()` artık bu endpoint'i batch çağrısına dahil ediyor:
```js
incomplete: { total: ..., segments: [/* gerçek veri */], source: 'api' }
```
Retention modülü artık gerçek segment verisini alır — `segmentIndex` ile doğru alanı hedefler.

### Frontend entegrasyon (web dashboard proxy)
```
GET /api/activation/segments  → GetIncompleteProfileSegments
```

---

## P3 — Görünürlük Geri Bildirimi ✅ Backend Teslim Edildi

```
GET {API_BASE}/GemiAdamiGenel/GetProfileVisibilityGain[?userId={id}]
```

`userId` verilmezse login olan kullanıcı baz alınır.

**Response:**
```json
{
  "result": {
    "currentVisibleJobs": 12,
    "gains": [
      { "field": "seaService",   "additionalJobs": 34, "description": "Deniz hizmeti ekle" },
      { "field": "certificates", "additionalJobs": 89, "description": "STCW sertifikası ekle" },
      { "field": "availability", "additionalJobs": 12, "description": "Müsaitlik güncelle" }
    ]
  }
}
```

### Frontend entegrasyon (web dashboard proxy)
```
GET /api/activation/visibility-gain?userId={id}  → GetProfileVisibilityGain
```

**Profil ekranı gösterimi (crewinjob.com):**
```
[ Sea Service ] — [Doldur]
  ℹ️ "Bu alanı ekleyerek 34 ilanda daha görünürsün"

[ Sertifikalar ] — [Yükle]
  ℹ️ "STCW sertifikan eksik — 89 ilan sertifika gerektiriyor"
```

---

## P4 — Sosyal Kayıt (LinkedIn / Google)

**Durum:** Henüz implement edilmedi — bağımsız sprint.

**Gereksinim özeti:**
- LinkedIn OAuth: `openid + profile + email` scope minimum
- LinkedIn `positions` verisi → sea service önizleme ekranına eşlenir (P0 mantığıyla aynı)
- Mevcut e-posta ile çakışma yönetimi
- Kayıt formunda "LinkedIn ile Kayıt Ol" + "Google ile Kayıt Ol" butonları

---

## Event Listesi

```
seafarer_registered          userId, device, utmCampaign
onboarding_shown             userId
onboarding_cv_selected       userId
onboarding_manual_selected   userId
onboarding_skipped           userId
cv_uploaded                  userId, fileName, fileSize
cv_parse_succeeded           userId, parseId, extractedFieldCount, confidence
cv_parse_partial             userId, parseId, extractedFieldCount, failedFields
cv_parse_failed              userId, reason
cv_parse_confirmed           userId, parseId, appliedFieldCount
cv_parse_abandoned           userId, parseId
profile_completed_50         userId
profile_completed_80         userId
certificate_uploaded         userId, certType
availability_updated         userId
social_signup_initiated      userId, provider (linkedin|google)
social_signup_completed      userId, provider
```

---

## Öncelik ve Bağımlılık Haritası

```
P0 + P1 ── Birlikte (backend ✅, frontend crewinjob.com'da implement edilecek)
P2      ── Tamamlandı ✅ — marketing agent zaten bu veriyi kullanıyor
P3      ── Tamamlandı ✅ — crewinjob.com profil ekranına entegre edilecek
P4      ── Bağımsız sprint
```

---

## Başarı Hedefleri

| Metrik | Bugün | 4 hafta (P0+P1 sonrası) | 12 hafta |
|--------|-------|--------------------------|----------|
| İşe hazır profil (%60+) | 263 (%2,4) | ~1.000 (%9) | ~2.500 (%22) |
| %0'da bekleyen kullanıcı | 6.413 (%57,6) | %45 altı | %30 altı |
| CV parse kullanım oranı | — | Yeni kayıtların %40'ı | %60'ı |
| Kayıt → profil başlama | ölçülmüyor | ölçülüyor + %50 | %70 |

---

## Kapsam Dışı

- Şirket tarafı aktivasyonu
- Başvuru / shortlist / CV unlock mekanizması
- Haftalık ilan sayacı (endpoint yok)
- Matching algoritması değişikliği
- Push notification altyapısı
