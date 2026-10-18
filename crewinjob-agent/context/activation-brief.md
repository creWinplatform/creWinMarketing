# Geliştirici Brief'i — Seafarer Activation

**Hazırlanma:** 29 Temmuz 2026
**Hedef ekip:** crewinjob.com ürün & backend
**Veri kaynağı:** api.crewin.org canlı sorgusu (29.07.2026)

---

## Özet

Platformda 11.130 kayıtlı gemi insanı var. Bunların **263'ü** (%2,4) şirketlere sunulabilir durumda.
**6.413'ü** (%57,6) kayıt olduktan sonra profil bölümüne hiç girmemiş.

Kayıt sayısı büyümüyor (son 7 günde 2 kayıt), ama asıl kayıp burada değil — asıl kayıp
kayıt olmuş 11 bin kişinin %97,6'sının kullanılamaz durumda olmasında.

Bu brief, o %97,6'yı azaltmak için gereken ürün değişikliklerini tanımlar.

---

## Mevcut Durum — Ölçülmüş Veri

### Profil doluluk dağılımı

| Segment | Kişi | Oran | Yorum |
|---------|------|------|-------|
| %0 — hiç dolu değil | **6.413** | %57,6 | Kayıt bitmiş, profil hiç açılmamış |
| %0–30 | 3.799 | %34,1 | Başlamış, erken bırakmış |
| %30–60 | 655 | %5,9 | Çoğunu doldurmuş, takılmış |
| %60+ — işe hazır | **263** | %2,4 | Şirketlere sunulabilir |
| **Toplam** | **11.130** | | |

Kaynak: `GemiAdamiGenel/GetCountOfUsersWithAProfileFillRate*` endpoint'leri.

### Diğer metrikler

| Metrik | Değer |
|--------|-------|
| Son 7 gün yeni seafarer | 2 |
| Toplam şirket | 149 |
| Son 7 gün yeni şirket | 0 |
| Aktif ilan | 467 |
| Haftalık yeni ilan | **ölçülemiyor** (endpoint yok) |

---

## Teşhis

### Kayıt formu sorun değil

Mevcut kayıt formu (`/account/register/seafarer`) zaten kısa:
Ad · Soyad · Pozisyon · E-posta · Telefon · Şifre · Şifre tekrar + 2 onay kutusu.

Sea service, sertifika veya CV istenmiyor. Yani kayıt formunun uzunluğu terk sebebi değil.

### Asıl sorun: kayıt ile profil arasındaki boşluk

6.413 kullanıcı **tam olarak %0'da**. Bu, kayıt formundaki alanların profil doluluğuna
saymadığını ve bu kişilerin profil bölümüne hiç girmediğini gösterir.

Yani kayıt akışı çalışıyor, kayıt **sonrası** akış çalışmıyor.

Bu ayrım önemli: "profilini tamamla" hatırlatması göndermek, karşısında 30 dakikalık
manuel form olan birine işe yaramaz. Önce o formu 30 saniyeye indirmek gerekir.

---

## İstenen Geliştirmeler

Öncelik sırasına göre. 1 ve 2 birlikte yapılmalı — ayrı ayrı etkileri sınırlı.

---

### P0 — CV Parse ile Otomatik Profil Doldurma

**Kime hitap ediyor:** %0'daki 6.413 kullanıcı (en büyük segment)

**Neden bu kaldıraç:** Denizcinin elinde zaten hazır bir CV var — sea service kayıtları,
sertifika numaraları ve geçerlilik tarihleri o belgede yazılı. Bunları manuel olarak
tekrar girmesini istemek, kullanılabilir profil üretmenin en pahalı yoludur.

**İstenen davranış**
1. Kullanıcı CV dosyasını yükler (PDF / DOCX)
2. Sistem şu alanları çıkarır: pozisyon/rütbe, sea service kayıtları (gemi tipi, süre, şirket),
   sertifikalar (tip, numara, geçerlilik tarihi), iletişim bilgileri
3. Kullanıcıya **önizleme + düzenleme** ekranı gösterilir — otomatik kaydetme yapılmaz
4. Kullanıcı onaylar, profil dolar

**Kabul kriterleri**
- Yaygın denizcilik CV formatlarında sea service ve sertifika çıkarımı çalışır
- Çıkarılan her alan kullanıcı tarafından düzeltilebilir
- Parse başarısız olursa kullanıcı manuel girişe düşer, hata ekranında kalmaz
- Yükleme sonrası profil doluluk oranı anında güncellenir

**Notlar**
- Sertifika **geçerlilik tarihi** kritik — süresi dolmuş belge, profili "dolu" gösterip
  işe yaramaz hale getirir. Parse edilen tarihler doğrulanmalı.
- Mobil öncelikli düşünülmeli; denizcilerin çoğu telefondan giriyor.

**Mimari karar (kesinleşti):** CV parse tamamen **crewinjob.com projesi içinde** yapılacak.
Kullanıcı crewinjob.com'a CV yükler → backend parse eder → profil önizleme ekranı gösterir → kullanıcı onaylar → profil dolar.
Harici servis veya marketing agent üzerinden parse seçeneği reddedildi — kullanıcı deneyimi bozulur.

---

### P1 — Kayıt Sonrası Onboarding Akışı

**Kime hitap ediyor:** Aynı 6.413'lük segment — P0'ı destekler

**Mevcut durum:** Kayıt tamamlandıktan sonra kullanıcının nereye düştüğü belirsiz.
%57,6'lık sıfır oranı, bu geçişin kullanıcıyı profile yönlendirmediğini gösteriyor.

**İstenen davranış**
- Kayıt biter bitmez kullanıcı boş bir dashboard'a değil, doğrudan
  **"CV'ni yükle"** / **"Profilini oluştur"** seçimine düşsün
- Bu adım atlanabilir olsun ama varsayılan yol olmasın
- Atlayan kullanıcı için dashboard'da kalıcı ve görünür bir profil tamamlama çağrısı kalsın

**Kabul kriterleri**
- Kayıt sonrası ilk ekranda profil/CV adımı görünür
- Atlama davranışı event olarak kaydedilir (aşağıdaki event listesine bakın)

---

### P2 — Eksik Alan Segment Endpoint'i

**Neden gerekli:** Şu anda hangi alanın eksik olduğunu bilmiyoruz. Pazarlama tarafındaki
`retention.js` modülü segment bazlı geri kazanma içeriği üretmeye hazır
(sea service / sertifika / fotoğraf / belge / referans) ama besleyecek veri yok.
`api.js` içinde `incomplete.segments` sabit boş dizi dönüyor.

Bu veri gelmeden 655 kişilik "%30–60" grubuna hedefli mesaj gönderilemez —
hangi alanda takıldıklarını bilmiyoruz.

**İstenen endpoint**

```
GET /api/services/app/GemiAdamiGenel/GetIncompleteProfileSegments
```

Dönüş:
```json
{
  "segments": [
    { "missingField": "seaService",   "count": 0, "lastActiveDaysAvg": 0 },
    { "missingField": "certificates", "count": 0, "lastActiveDaysAvg": 0 },
    { "missingField": "documents",    "count": 0, "lastActiveDaysAvg": 0 },
    { "missingField": "photo",        "count": 0, "lastActiveDaysAvg": 0 },
    { "missingField": "references",   "count": 0, "lastActiveDaysAvg": 0 }
  ]
}
```

`missingField` değerleri yukarıdaki anahtarlarla birebir eşleşmeli — pazarlama tarafı
bu anahtarlara göre içerik seçiyor.

---

### P3 — Görünürlük Geri Bildirimi

**Kime hitap ediyor:** %0–30 arasındaki 3.799 kullanıcı — başlamış ama bırakmış

**Neden bu kaldıraç:** Bu grup profili açtı, biraz doldurdu, sonra durdu. Onlara eksik olan
şey bilgi değil, **karşılık**. Tamamlamanın ne kazandıracağını görmüyorlar.

**İstenen davranış**
- Soyut yüzde göstergesi ("profilin %35 dolu") tek başına yetmiyor
- Bunun yerine somut görünürlük kazancı gösterilsin:
  *"Sea service eklersen 12 ilanda daha görüneceksin"*
- Sayı gerçek olmalı — mevcut açık ilanlarla eşleştirilerek hesaplanmalı

**Kabul kriterleri**
- Profil ekranında her eksik alan için, o alan doldurulduğunda erişilecek ek ilan sayısı gösterilir
- Sayı canlı ilan verisinden hesaplanır, sabit değildir

---

### P4 — Sosyal Kayıt (LinkedIn / Google)

**Mevcut durum:** Kayıt formunda sosyal giriş seçeneği yok, her şey manuel.

Not: Pazarlama tarafındaki metrik listesinde "LinkedIn ile kayıt başarı oranı" izlenecek
metrik olarak tanımlı — ancak böyle bir akış olmadığı için bu metrik şu an üretilemiyor.

**Neden değerli:** Hem kayıt sürtünmesini düşürür (acquisition) hem de isim, pozisyon ve
deneyim bilgisini otomatik getirir (activation). P0 ile aynı yöne çalışır.

---

## Ölçüm — Event Listesi

Aşağıdaki eventler eklenmeden yapılan değişikliklerin etkisi ölçülemez.

```
seafarer_registered          → kayıt tamamlandı
onboarding_shown             → kayıt sonrası profil adımı gösterildi
onboarding_skipped           → kullanıcı adımı atladı
cv_uploaded                  → CV dosyası yüklendi
cv_parse_succeeded           → çıkarım başarılı (çıkarılan alan sayısı ile)
cv_parse_failed              → çıkarım başarısız (sebep ile)
cv_parse_confirmed           → kullanıcı önizlemeyi onayladı
profile_completed_50         → profil %50'ye ulaştı
profile_completed_80         → profil %80'e ulaştı
certificate_uploaded         → sertifika eklendi
availability_updated         → müsaitlik güncellendi
```

Her event ile birlikte tutulması gerekenler:
`user_role` · `country` · `rank` · `acquisition_source` · `utm_campaign` · `device` · `timestamp`

---

## Başarı Hedefleri

| Metrik | Bugün | 4 hafta | 12 hafta |
|--------|-------|---------|----------|
| İşe hazır profil (%60+) | 263 (%2,4) | ~1.000 (%9) | ~2.500 (%22) |
| %0'da bekleyen kullanıcı | 6.413 (%57,6) | %45 altı | %30 altı |
| CV parse kullanım oranı | — | Yeni kayıtların %40'ı | %60'ı |
| Kayıt→profil başlama oranı | ölçülmüyor | ölçülüyor + %50 | %70 |

**Not:** İlk hedef mevcut 11 bin kullanıcıyı geri kazanmak değil, yeni kayıtların
aynı akıbete uğramasını durdurmaktır. Mevcut havuzun geri kazanımı P2 ve P3 sonrası
pazarlama tarafından yürütülecek.

---

## Kapsam Dışı

- Şirket tarafı aktivasyonu — ayrı bir çalışma gerektirir (149 şirket, son hafta 0 yeni kayıt)
- Başvuru / shortlist / CV unlock ölçümü — bu brief profil kalitesine odaklanır
- İlan haftalık sayacı — `Ilan` altında haftalık kayıt endpoint'i yok, ayrıca talep edilmeli

---

## İlgili Dosyalar (pazarlama tarafı)

| Dosya | İlgi |
|-------|------|
| `crewinjob-agent/modules/api.js` | `incomplete.segments` boş dönüyor (P2 buraya bağlanacak) |
| `crewinjob-agent/modules/retention.js` | Segment bazlı geri kazanma içeriği — P2 verisini bekliyor |
| `crewinjob-agent/context/metrics-playbook.md` | Bölüm 2 — Activation kaldıraçları |
| `crewinjob-web/components/tabs/KpiTab.tsx` | Profil doluluk dağılımı paneli |
