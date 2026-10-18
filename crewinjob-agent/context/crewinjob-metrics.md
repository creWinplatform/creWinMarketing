# CrewinJob — Marketplace Metrics Framework
> Bu dosya tüm AI analizleri, KPI raporları ve içerik üretimi için referans alınır.
> Son güncelleme: 2026-07-28
>
> **Bu dosya "neyi ölçeceğiz"i tanımlar.** Ölçtükten sonra "düşükse ne yapacağız" sorusunun
> cevabı için: [`metrics-playbook.md`](./metrics-playbook.md)
>
> Kod tarafında kullanım: `const ctx = require('../context')` — bkz. [`index.js`](./index.js)

---

## North Star Metric

**Monthly Qualified Matches** — Bir ay içinde oluşan nitelikli aday–ilan eşleşmesi sayısı.

Bir eşleşmeyi "qualified" sayma kriterleri:
- Gemi insanı profili en az %80 tamamlanmış
- Zorunlu belgeler ve deniz hizmeti bilgileri girilmiş
- Aday müsaitlik durumu uygun
- AI Fit Score belirlenen eşiğin üzerinde
- Aday başvuru yapmış VEYA şirket adayı shortlist/CV unlock yapmış

Uzun vadeli hedef: **Confirmed Placements per Month** (platform üzerinden işe yerleştiği doğrulanan kişi sayısı)

**Crewin'in gerçek büyümesini gösteren üçlü:**
> Ready-to-Hire Seafarers + Active Hiring Companies + Monthly Qualified Matches

---

## İlk Etapta Takip Edilecek 15 Ana Metrik

| # | Metrik | Açıklama |
|---|--------|----------|
| 1 | Yeni gemi insanı kaydı | Dönem bazında yeni kayıt |
| 2 | %80 tamamlanmış profil oranı | Aktif kayıtlar içinde |
| 3 | Ready-to-Hire profil sayısı | Profil + belge + müsaitlik tam |
| 4 | Aylık aktif gemi insanı | Son 30 günde login/başvuru |
| 5 | Yeni şirket kaydı | Dönem bazında |
| 6 | Company Activation Rate | İlk 14 günde ilan/shortlist yapan şirket / yeni şirket |
| 7 | Aylık aktif şirket | Son 30 günde işlem yapan |
| 8 | Aktif ilan sayısı | Yayında ve aktif |
| 9 | İlan başına nitelikli aday | Fit Score eşiği üzeri |
| 10 | 7-Day Liquidity Rate | İlk 7 günde ≥5 nitelikli aday alan ilan / toplam yeni ilan |
| 11 | Başvuru → shortlist oranı | Conversion kalite göstergesi |
| 12 | İlk nitelikli adaya kadar geçen süre | Hız ölçümü |
| 13 | CV unlock sayısı ve dönüşüm oranı | Önizleme → unlock |
| 14 | Repeat Job Posting Rate | Birden fazla ilan veren şirket / en az 1 ilan veren şirket |
| 15 | Confirmed Placement sayısı | Gerçek işe alım |

Monetizasyon sonrası eklenenler: MRR, ödeme yapan şirket sayısı, şirket başına ortalama gelir, Free→Paid conversion, CAC, Runway

---

## Gemi İnsanı (Seafarer) Metrikleri

### Acquisition
- Yeni gemi insanı kaydı (günlük/haftalık/aylık)
- Kayıt kanalı dağılımı: Organik, Reklam, LinkedIn, Üniversite, Referral
- Kanal başına edinme maliyeti (CAC)
- Ülke ve rütbe bazında kayıtlar

### Activation
```
Seafarer Activation Rate = (En az %80 tamamlanmış profili olan VE en az 1 başvurusu olan kullanıcı) / Yeni kayıtlı gemi insanı
```
Ara adımlar:
- Profil %50 tamamlama oranı
- Profil %80 tamamlama oranı
- CV yükleme oranı
- Sertifika yükleme oranı
- Deniz hizmeti bilgisi girme oranı
- İlk başvuruyu yapanların oranı
- Kayıttan ilk başvuruya geçen süre (ortalama gün)

### Engagement
- DAU / WAU / MAU (Günlük/Haftalık/Aylık aktif)
- Kullanıcı başına görüntülenen ilan
- Kullanıcı başına başvuru
- Kaydedilen ilan sayısı
- Profil güncelleme sıklığı
- Müsaitlik bilgisini güncel tutan kullanıcı oranı
- Bildirim açma ve tıklama oranı

### Conversion (Funnel)
- İlan görüntüleme → başvuru oranı
- Başvuru → shortlist oranı
- Shortlist → görüşme oranı
- Görüşme → işe alım oranı
- Başvuru başına ortalama şirket yanıt süresi
- Başvurusu cevapsız kalan aday oranı (kötü sinyal)

---

## Şirket (Company) Metrikleri

### Acquisition
- Yeni şirket kaydı (günlük/haftalık/aylık)
- Doğrulanan şirket sayısı
- Kayıt kanalı dağılımı
- Şirket tipi: Shipowner / Ship Manager / Crewing Agency
- Şirket başına edinme maliyeti

### Activation
```
Company Activation Rate = (İlk 14 gün içinde ilan yayınlayan VEYA aday shortlist eden şirket) / Yeni şirket kaydı
```
Ara adımlar:
- Kayıt → ilk ilan yayınlama oranı
- Kayıt → ilk aday arama oranı
- Kayıt → ilk shortlist oranı
- Kayıt → ilk CV unlock oranı
- İlk ilana kadar geçen süre
- İlk uygun adayı bulana kadar geçen süre

### Retention
- 30 / 60 / 90 günlük şirket retention
- İkinci kez ilan veren şirket oranı (**Repeat Job Posting Rate**)
- Tekrar CV kredisi satın alan şirket oranı
- Churn eden şirket sayısı ve nedeni

---

## Marketplace & Eşleşme Metrikleri

### Likidite
- Aktif ilan sayısı
- Aktif ve uygun aday sayısı
- İlan başına başvuru (ortalama)
- İlan başına nitelikli aday
- Hiç başvuru almayan ilan oranı (kötü sinyal)
- Rütbe ve gemi tipine göre arz–talep dengesi

```
7-Day Liquidity Rate = (İlk 7 günde ≥5 nitelikli aday alan ilan) / Toplam yeni ilan
```

### Hız (Time-to-Match)
- İlan yayından ilk başvuruya kadar geçen süre
- İlk nitelikli adaya kadar geçen süre
- İlk shortlist'e kadar geçen süre
- Pozisyonun kapanmasına kadar geçen süre

### Eşleşme Kalitesi (AI Fit Score)
```
Fit Score Acceptance Rate = (Şirket tarafından shortlist edilen yüksek skorlu aday) / (Görüntülenen yüksek skorlu aday)
```
- Fit Score aralıklarına göre recruiter acceptance
- Şirket tarafından reddedilen yüksek skorlu aday oranı (model kalitesi sinyali)
- İlan başına uygun aday sayısı

---

## Gelir Metrikleri

### CV Credit
- Satılan / Kullanılan CV kredisi
- CV unlock yapan şirket sayısı
- Önizleme → CV unlock dönüşümü
- Paket bazında satış dağılımı

### Bullseye
- Aktif Bullseye müşterisi
- Trial → paid dönüşümü
- Yenileme oranı
- Bullseye kullanan vs kullanmayan şirketlerin shortlist karşılaştırması

### Finansal
- MRR (Monthly Recurring Revenue)
- Şirket başına ortalama gelir (ARPU)
- Free → Paid conversion
- CAC (Customer Acquisition Cost)
- LTV (Lifetime Value)
- Burn rate / Runway

Pre-revenue öncü metrik:
```
Paid Intent Rate = (Fiyatı gören ve satın alma/demo/ödeme adımı başlatan şirket) / Fiyat sayfasını gören şirket
```

---

## Veri Kalitesi & Güven Metrikleri

```
Ready-to-Hire Profile Rate = (Profili + belgeleri + deniz hizmeti + müsaitliği güncel olan aday) / Aktif gemi insanı
```

Diğer metrikler:
- Doğrulanmış profil oranı
- Doğrulanmış sertifika oranı
- Süresi dolmuş belge oranı (kötü sinyal)
- Eksik zorunlu belge oranı
- Mükerrer profil oranı
- Profil güncellik oranı

---

## Takip Edilecek Eventler (Analytics)

```
seafarer_registered         | profile_completed_50       | profile_completed_80
cv_uploaded                 | certificate_uploaded       | certificate_verified
availability_updated        | job_viewed                 | job_saved
job_applied                 | company_registered         | company_verified
job_created                 | job_published              | candidate_viewed
candidate_shortlisted       | cv_unlocked                | interview_requested
application_rejected        | placement_confirmed        | bullseye_started
credit_package_purchased    | subscription_renewed
```

Her event için tutulacak boyutlar:
- user_role, country, rank, vessel_type
- acquisition_source, campaign, device
- company_type, job_id, fit_score_range, date

---

## Ölçüm Sıklığı

| Sıklık | Metrikler |
|--------|-----------|
| **Günlük** | Yeni kayıtlar, yeni ilanlar, başvurular, CV unlock, ödeme hataları, sistem hataları |
| **Haftalık** | Activation funnel, şirket funnel, Qualified Match, marketplace liquidity, kanal performansı, profil tamamlama |
| **Aylık** | Retention cohort, Revenue/MRR, CAC/kanal verimliliği, Repeat Job Posting, Confirmed Placement, burn rate |
| **3 Aylık** | AI Fit Score doğruluğu, NPS, ülke/rütbe/gemi tipi arz-talep dengesi, ürün stratejisi |

---

## Büyüme Hedefleri (İlk 6 Ay)

| Ay | Toplam Seafarer | Aylık Yeni | Profil Tamamlama | Aktif Profil |
|----|-----------------|------------|------------------|--------------|
| 1 | 16.500 | 1.500 | %55 | %40 |
| 2 | 18.500 | 2.000 | %60 | %45 |
| 3 | 22.000 | 3.500 | %65 | %50 |
| 4 | 26.000 | 4.000 | %68 | %55 |
| 5 | 31.000 | 5.000 | %70 | %58 |
| 6 | 40.000 | 9.000 | %75 | %62 |

**MB (Monetization) Geçiş Kriterleri:**
- Toplam Seafarer: 25.000+
- Aylık büyüme: 1.500+
- Profil tamamlama: %65+
- Organik trafik: 2.000+ aylık ziyaret

---

## Kritik Yatırımcı/Ortak Soruları

> "15.000 kayıtlı gemi insanı var" → Doğru soru: **Kaçı aktif, profili tamamlanmış, belgeleri güncel, işe hazır?**
>
> "75 şirket var" → Doğru soru: **Kaçı aktif ilan veriyor, aday shortlist ediyor, CV açıyor, tekrar geliyor?**

Bu sorulara her zaman **Ready-to-Hire Seafarers + Active Hiring Companies + Monthly Qualified Matches** üçlüsüyle cevap ver.
