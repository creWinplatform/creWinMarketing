# Backend Geliştirme İsteği — Manuel Ödeme & Firma Hak Tanımlama Modülü

**Tarih:** 30 Ağustos 2026
**İsteyen:** Pazarlama / Growth (marketing panel)
**Alıcı:** Backend ekibi
**Frontend:** Marketing panel tarafında bizde — sizden sadece API bekliyoruz.

---

## 1. Neden?

crewinjob.com'da hâlihazırda **kredi kartı ile satın alma** modülü çalışıyor. Ancak
maritime business tarafındaki firmaların önemli bir kısmı (özellikle kurumsal crewing
ajansları ve armatörler) kredi kartı yerine **havale / EFT / SWIFT** ile ödeme yapmak
istiyor. Şu an bu firmalara satış yapıldığında:

- Para banka hesabına geliyor,
- Ama sistemde firmanın hakkını tanımlayacak bir arayüz yok,
- Ödeme kaydı Excel'de veya hiç tutulmuyor.

**İhtiyaç:** Panel üzerinden yetkili bir kullanıcının

1. Gelen havale/EFT ödemesini **kayıt altına alması**,
2. O ödeme karşılığında firmaya **CV kredisi**, **ilan hakkı** ve/veya **Bullseye erişimi**
   tanımlaması,
3. Firmanın güncel bakiyesini ve geçmiş hareketlerini görebilmesi,
4. Yanlış girilen bir kaydı **geri alabilmesi**.

---

## 2. En Kritik Mimari Kural — Önce Bunu Okuyun

### 2.1. Bakiye bir kolon DEĞİL, bir toplamdır (ledger / muhasebe defteri)

`Firma.CvKredisi = 50` gibi mutable bir kolon **kullanmayın**. Bunun yerine her değişiklik
**değiştirilemez (immutable) bir hareket kaydı** olsun, bakiye bu kayıtların toplamı olarak
hesaplansın:

```
Bakiye = SUM(Miktar) WHERE FirmaId = X AND HakTipi = Y AND İptalEdilmemiş
```

**Neden bu kadar önemli:**
- Para karşılığı bir değerden bahsediyoruz; "firmanın kredisi neden eksildi?" sorusunun
  cevabı her zaman kayıtta olmalı.
- Firma "ben 100 kredi almıştım" derse, hangi ödemeyle, kim tarafından, ne zaman
  tanımlandığı tek sorguyla çıkmalı.
- Mutable kolonda eşzamanlı iki işlem (biri kredi tanımlıyor, biri CV unlock ediyor)
  birbirini ezer — klasik lost update. Ledger'da bu sorun yapısal olarak yok.

### 2.2. Mevcut kredi kartı akışı da aynı ledger'a yazmalı

Bu modül **paralel bir sistem olmamalı**. Kredi kartıyla yapılan satın almalar ve CV unlock
gibi tüketimler de aynı `FirmaHakHareketi` tablosuna yazmalı. Aksi halde iki ayrı bakiye
kaynağı oluşur ve tutarsızlık kaçınılmaz olur.

Eğer mevcut satın alma modülü şu an mutable bir bakiye kolonu kullanıyorsa:
**migration planı da bu işin parçasıdır** — mevcut bakiyeler `KaynakTipi = AcilisBakiyesi`
tipinde tek bir hareket olarak ledger'a taşınmalı.

### 2.3. Kayıt silinmez, ters kayıt atılır

Yanlış giriş `DELETE` edilmez. `HareketIptal` çağrısı, aynı tutarın negatifini içeren yeni
bir hareket oluşturur ve iki kaydı birbirine bağlar. Denetim izi hiçbir zaman bozulmaz.

---

## 3. Veri Modeli

### 3.1. `FirmaOdemeKaydi` — Manuel ödeme kaydı

| Alan | Tip | Zorunlu | Açıklama |
|---|---|:---:|---|
| `Id` | long | ✔ | PK |
| `FirmaId` | long | ✔ | Ödemeyi yapan firma |
| `Tutar` | decimal(18,2) | ✔ | Gelen tutar |
| `ParaBirimi` | string(3) | ✔ | `USD` / `EUR` / `TRY` |
| `OdemeTarihi` | date | ✔ | **Bankaya giriş (valör) tarihi** — kaydın girildiği tarih değil |
| `OdemeYontemi` | enum | ✔ | `Havale=1, EFT=2, Swift=3, Diger=99` |
| `BankaReferansNo` | string(64) | ✔ | Banka dekontundaki referans — mutabakat için kritik |
| `GonderenUnvan` | string(200) | — | Gönderen hesap adı. **Çoğu zaman firma adından farklı** olur, bu yüzden ayrı alan gerekli |
| `FaturaNo` | string(64) | — | Fatura kesildiyse |
| `DekontDosyaId` | long? | — | Yüklenen dekont görseli/PDF'i |
| `Aciklama` | string(1000) | — | Serbest not |
| `IptalEdildiMi` | bool | ✔ | Soft-cancel |
| `IptalNedeni` | string(500) | — | |
| `OlusturanKullaniciId` | long | ✔ | Kaydı giren panel kullanıcısı |
| `OlusturmaTarihi` | datetime | ✔ | Sistem zamanı (UTC) |

**Kısıt:** `(BankaReferansNo, FirmaId)` üzerinde **unique index**. Aynı dekont iki kez
girilemesin — bu, manuel giriş yapılan sistemlerde en sık görülen hatadır.

### 3.2. `FirmaHakHareketi` — Hak ledger'ı (immutable)

| Alan | Tip | Zorunlu | Açıklama |
|---|---|:---:|---|
| `Id` | long | ✔ | PK |
| `FirmaId` | long | ✔ | |
| `HakTipi` | enum | ✔ | `CvKredisi=1, IlanHakki=2, BullseyeGun=3` |
| `Miktar` | int | ✔ | **Pozitif = tanımlama, negatif = tüketim/iptal** |
| `KaynakTipi` | enum | ✔ | `ManuelOdeme=1, KrediKarti=2, Promosyon=3, Duzeltme=4, Kullanim=5, AcilisBakiyesi=6` |
| `KaynakId` | long? | — | `ManuelOdeme` ise `FirmaOdemeKaydi.Id`; `Kullanim` ise ilgili unlock/ilan kaydının Id'si |
| `GecerlilikBitis` | date? | — | Kredinin son kullanma tarihi (null = süresiz) |
| `TersKayitId` | long? | — | Bu kayıt bir iptalse, iptal ettiği kaydın Id'si |
| `Aciklama` | string(500) | — | |
| `OlusturanKullaniciId` | long | ✔ | |
| `OlusturmaTarihi` | datetime | ✔ | UTC |

**Index:** `(FirmaId, HakTipi, OlusturmaTarihi)` — bakiye sorgusu ve geçmiş listesi için.

### 3.3. Bullseye — süre bazlı, adet bazlı değil

CV kredisi ve ilan hakkı sayılabilir birimler; Bullseye ise bir **abonelik**. İki seçenek var:

- **A)** Ledger'da `BullseyeGun` tipinde gün cinsinden tut, bitiş tarihi
  `bugün + SUM(gün)` olarak hesaplansın.
- **B)** Mevcut bir `FirmaAbonelik` tablosu varsa onu kullan, bu modül sadece
  `BitisTarihi`'ni uzatsın ve ledger'a referans kaydı yazsın.

**Mevcut Bullseye implementasyonunuz neyse ona uyun** — yeni paralel yapı kurmayın.
Hangisini seçtiğinizi bize bildirin, frontend'i ona göre yazacağız.

---

## 4. Endpoint'ler

Base: `https://api.crewin.org/api/services/app`
Tümü `Authorization: Bearer {token}` ister.

### 4.1. Yetkilendirme

Bu endpoint'lerin tamamı **finans/admin yetkisi** ister — normal recruiter veya gemi adamı
kullanıcısı erişememeli. Öneri: `Pages.Firma.KrediYonetimi` gibi ayrı bir ABP permission
tanımlanması. Yetkisiz erişimde `403` dönmeli.

---

### 4.2. `GET /FirmaKrediYonetimi/FirmaAra`

Panelde firma seçtirmek için arama.

**Query:** `arama` (unvan/e-posta/vergi no, min 2 karakter), `sayfa`, `boyut`

**Response:**
```json
{
  "result": {
    "toplamKayit": 12,
    "kayitlar": [
      {
        "firmaId": 84,
        "unvan": "Deniz Crewing Ltd.",
        "email": "info@denizcrewing.com",
        "ulke": "Turkiye",
        "cvKredisi": 45,
        "ilanHakki": 3,
        "bullseyeBitisTarihi": "2026-12-31"
      }
    ]
  }
}
```

---

### 4.3. `GET /FirmaKrediYonetimi/FirmaDurum?firmaId={id}`

Tek firmanın güncel durumu — panelde detay ekranının üst kartı.

**Response:**
```json
{
  "result": {
    "firmaId": 84,
    "unvan": "Deniz Crewing Ltd.",
    "bakiyeler": {
      "cvKredisi": 45,
      "ilanHakki": 3,
      "bullseyeAktifMi": true,
      "bullseyeBitisTarihi": "2026-12-31"
    },
    "yakindaSonaErecek": [
      { "hakTipi": "CvKredisi", "miktar": 10, "gecerlilikBitis": "2026-09-15" }
    ],
    "toplamOdenenTutar": [
      { "paraBirimi": "USD", "tutar": 4500.00 }
    ]
  }
}
```

> `toplamOdenenTutar` para birimi bazında dizi olmalı — farklı para birimlerini
> toplamayın, kur çevirisi bu modülün işi değil.

---

### 4.4. `POST /FirmaKrediYonetimi/OdemeKaydet` ⭐ Ana endpoint

Ödemeyi kaydeder **ve** aynı transaction içinde hakları tanımlar.

**Neden tek çağrı:** İki ayrı çağrı olursa "ödeme kaydedildi ama hak tanımlanmadı" ara
durumu oluşur ve bunu kimse fark etmez. Atomik olmalı.

**Request:**
```json
{
  "firmaId": 84,
  "tutar": 1500.00,
  "paraBirimi": "USD",
  "odemeTarihi": "2026-08-28",
  "odemeYontemi": 1,
  "bankaReferansNo": "TR2026082800184523",
  "gonderenUnvan": "DENIZ DENIZCILIK VE TIC. A.S.",
  "faturaNo": "CRW2026-000412",
  "dekontDosyaId": 991,
  "aciklama": "Ağustos dönemi CV kredi paketi",
  "tanimlanacakHaklar": [
    { "hakTipi": 1, "miktar": 100, "gecerlilikBitis": "2027-08-28" },
    { "hakTipi": 2, "miktar": 5,   "gecerlilikBitis": null }
  ]
}
```

**Kurallar:**
- Tüm işlem **tek DB transaction**'ında olmalı; hak tanımlama hata verirse ödeme kaydı da
  geri alınmalı.
- `tanimlanacakHaklar` boş dizi olabilir (ödeme geldi, tahsis sonra yapılacak).
- Aynı `(firmaId, bankaReferansNo)` ikinci kez gelirse **`409 Conflict`** dönün, sessizce
  ikinci kayıt oluşturmayın.
- `tutar > 0` ve `miktar > 0` doğrulaması yapılmalı.
- `odemeTarihi` gelecek bir tarih olamaz.

**Response:**
```json
{
  "result": {
    "odemeId": 217,
    "olusturulanHareketler": [
      { "hareketId": 1043, "hakTipi": 1, "miktar": 100 },
      { "hareketId": 1044, "hakTipi": 2, "miktar": 5 }
    ],
    "guncelBakiyeler": { "cvKredisi": 145, "ilanHakki": 8 }
  }
}
```

---

### 4.5. `POST /FirmaKrediYonetimi/HakTanimla`

**Ödemesiz** hak tanımlama — promosyon, deneme paketi, şikâyet telafisi, bayi anlaşması.

**Request:**
```json
{
  "firmaId": 84,
  "hakTipi": 1,
  "miktar": 10,
  "kaynakTipi": 3,
  "gecerlilikBitis": "2026-10-01",
  "aciklama": "Fuar sonrası deneme kredisi"
}
```

`aciklama` bu endpoint'te **zorunlu** olsun — bedelsiz tanımlamanın gerekçesi her zaman
yazılı kalmalı.

---

### 4.6. `POST /FirmaKrediYonetimi/HareketIptal`

Yanlış girilen kaydı ters kayıtla geri alır.

**Request:**
```json
{ "hareketId": 1043, "iptalNedeni": "Yanlış firmaya tanımlandı" }
```

**Kurallar:**
- `DELETE` yok — negatif tutarlı yeni bir hareket oluşturulur, `TersKayitId` doldurulur.
- Aynı hareket iki kez iptal edilemez → `409`.
- **Firma o krediyi kısmen harcamışsa ne olacak?** Bizim beklentimiz: iptale izin verilsin,
  bakiye negatife düşebilsin ve panel bunu kırmızı uyarıyla göstersin. Negatif bakiyeyi
  yasaklamak, hatalı kaydı düzeltmeyi imkânsız hale getirir. Farklı düşünüyorsanız konuşalım.
- Bir ödemeye bağlı hareket iptal edilirse ödeme kaydı otomatik iptal **olmasın** — para
  gerçekten geldi. Ödemeyi iptal etmek ayrı bir işlem (`OdemeIptal`).

---

### 4.7. `GET /FirmaKrediYonetimi/HareketGecmisi?firmaId={id}`

**Query:** `firmaId`, `hakTipi` (ops.), `baslangicTarihi`, `bitisTarihi`, `sayfa`, `boyut`

**Response:** Hareket listesi + her satırda `kaynakTipi`, `kaynakId`, `olusturanKullaniciAdi`,
`olusturmaTarihi`, `iptalEdildiMi`. Panelde firma detayında tablo olarak göstereceğiz.

---

### 4.8. `GET /FirmaKrediYonetimi/OdemeListesi`

Finans görünümü — tüm manuel ödemeler.

**Query:** `firmaId` (ops.), `paraBirimi` (ops.), `baslangicTarihi`, `bitisTarihi`,
`odemeYontemi` (ops.), `sayfa`, `boyut`

**Response:** Ödeme listesi + sayfa toplamı ve **para birimi bazında genel toplam**.

---

### 4.9. `POST /FirmaKrediYonetimi/DekontYukle`

`multipart/form-data`, dosya alan adı **`dosya`**. Response'ta `dosyaId` döner, bu Id
`OdemeKaydet` içinde `dekontDosyaId` olarak gönderilir.

- Kabul edilen tipler: `pdf`, `jpg`, `png`
- Maksimum boyut: 10 MB
- Dosya erişimi yetki kontrollü olmalı — dekontlar finansal belge, public URL olmasın.

---

### 4.10. `GET /FirmaKrediYonetimi/Ozet`

Panel dashboard kartı için.

**Query:** `baslangicTarihi`, `bitisTarihi`

**Response:**
```json
{
  "result": {
    "toplamOdeme": [ { "paraBirimi": "USD", "tutar": 12400.00, "adet": 9 } ],
    "tanimlananHaklar": { "cvKredisi": 850, "ilanHakki": 34, "bullseyeGun": 730 },
    "odemeYapanFirmaSayisi": 7
  }
}
```

---

## 5. Havale Self-Servis Akışı — crewinjob.com Satın Alma Ekranı

> **Ek geliştirme isteği (30 Ağustos 2026):** Mevcut kredi kartı satın alma sayfasına
> "Havale / EFT ile öde" seçeneği ekleniyor. Kullanıcı bu seçeneği tercih ederse bir
> **bekleyen sipariş** oluşturulur; admin panelinden ödeme geldiği teyit edilince sipariş
> onaylanır ve kredi/hak tanımlanır. Hiçbir zaman otomatik onay yapılmaz.

### 5.1. `FirmaBekliyenSiparis` — Yeni Tablo

| Alan | Tip | Zorunlu | Açıklama |
|---|---|:---:|---|
| `Id` | long | ✔ | PK |
| `FirmaId` | long | ✔ | Siparişi veren firma |
| `ReferansKodu` | string(32) | ✔ | **Unique.** Banka dekontuna yazılacak referans. Format: `CRW-{FirmaId}-{YYYYMMDD}-{4 rastgele rakam}`. Örn: `CRW-84-20260830-7312` |
| `Paket` | string | ✔ | Seçilen paketin adı/kodu (örn. `cv_100`, `ilan_5`) |
| `TalepEdilenHaklar` | json | ✔ | `[{ "hakTipi": 1, "miktar": 100 }]` — onay gelince bunlar tanımlanacak |
| `Tutar` | decimal(18,2) | ✔ | Satın alma fiyatı |
| `ParaBirimi` | string(3) | ✔ | |
| `Durum` | enum | ✔ | `BeklemeyeAlindi=1, Onaylandi=2, IptalEdildi=3` |
| `OdemeKaydiId` | long? | — | Onaylanınca `FirmaOdemeKaydi.Id` buraya yazılır |
| `OlusturmaTarihi` | datetime | ✔ | UTC |
| `SonGecerlilikTarihi` | datetime | ✔ | Varsayılan: `OlusturmaTarihi + 7 gün`. Süresi dolan bekleyen siparişler cron ile `IptalEdildi` yapılabilir |
| `OlusturanKullaniciId` | long | ✔ | Siparişi veren firma kullanıcısı |
| `OnaylayanKullaniciId` | long? | — | Admin panelinden onaylayan kullanıcı |

**Kısıt:** Aynı `FirmaId` için `Durum = BeklemeyeAlindi` durumunda **en fazla 3** bekleyen sipariş olabilsin — sonsuz açık sipariş birikmesini önler.

---

### 5.2. Yeni Endpoint'ler

#### `POST /FirmaSiparis/HavaleSiparisiOlustur`

crewinjob.com satın alma sayfası bu endpoint'i çağırır. Firmanın oturumu açık olmalı; firma kullanıcısı çağırır (recruiter admin değil).

**Request:**
```json
{
  "paket": "cv_100",
  "talepEdilenHaklar": [
    { "hakTipi": 1, "miktar": 100 }
  ],
  "tutar": 499.00,
  "paraBirimi": "USD"
}
```

**Response:**
```json
{
  "result": {
    "siparisId": 412,
    "referansKodu": "CRW-84-20260830-7312",
    "bankaHesapBilgileri": {
      "bankaAdi": "Garanti BBVA",
      "hesapAdi": "CrewinJob Teknoloji A.Ş.",
      "iban": "TR12 0006 2000 1234 0006 2998 38",
      "aciklama": "Havale açıklamasına referans kodunuzu yazın: CRW-84-20260830-7312"
    },
    "tutar": 499.00,
    "paraBirimi": "USD",
    "sonGecerlilikTarihi": "2026-09-06T23:59:59Z"
  }
}
```

> **Not:** Banka hesap bilgileri sabit olduğu için response'a gömmek yerine `appsettings`'ten
> okunması daha esnek olur. Tercih sizin.

---

#### `GET /FirmaSiparis/SiparisDurumu?siparisId={id}`

Kullanıcı "Siparişim onaylandı mı?" diye kontrol eder. crewinjob.com'daki "Siparişlerim" sayfası veya teşekkür ekranından polling ile çağrılabilir.

**Response:**
```json
{
  "result": {
    "siparisId": 412,
    "referansKodu": "CRW-84-20260830-7312",
    "durum": "BeklemeyeAlindi",
    "olusturmaTarihi": "2026-08-30T10:05:00Z",
    "sonGecerlilikTarihi": "2026-09-06T23:59:59Z"
  }
}
```

---

#### `GET /FirmaKrediYonetimi/BekleyenSiparisler`

Admin paneli (FirmaKrediTab) bu endpoint'i çağırarak onay bekleyen siparişleri listeler.

**Query:** `firmaId` (ops.), `sayfa`, `boyut`

**Response:**
```json
{
  "result": {
    "toplamKayit": 3,
    "kayitlar": [
      {
        "siparisId": 412,
        "firmaId": 84,
        "firmaUnvan": "Deniz Crewing Ltd.",
        "referansKodu": "CRW-84-20260830-7312",
        "paket": "cv_100",
        "talepEdilenHaklar": [{ "hakTipi": 1, "miktar": 100 }],
        "tutar": 499.00,
        "paraBirimi": "USD",
        "olusturmaTarihi": "2026-08-30T10:05:00Z",
        "sonGecerlilikTarihi": "2026-09-06T23:59:59Z"
      }
    ]
  }
}
```

---

#### `POST /FirmaKrediYonetimi/HavaleSiparisiOnayla` ⭐

Ödeme banka hesabında teyit edilince admin bu endpoint'i çağırır. `OdemeKaydet` ile aynı mantık — **tek transaction**, atomik.

**Request:**
```json
{
  "siparisId": 412,
  "bankaReferansNo": "TR2026083000184523",
  "odemeTarihi": "2026-08-30",
  "odemeYontemi": 1,
  "gonderenUnvan": "DENIZ DENIZCILIK VE TIC. A.S.",
  "faturaNo": "CRW2026-000413",
  "dekontDosyaId": 992,
  "aciklama": "Referans kodu dekontla eşleşti"
}
```

**İşlem sırası (tek transaction):**
1. `FirmaBekliyenSiparis.Durum` → `Onaylandi`
2. `FirmaOdemeKaydi` oluştur (siparişin tutarı + banka bilgileriyle)
3. Siparişin `TalepEdilenHaklar` listesindeki her hak için `FirmaHakHareketi` yaz
4. `FirmaBekliyenSiparis.OdemeKaydiId` = yeni ödeme kaydının Id'si

**Response:** `OdemeKaydet` ile aynı format.

**Hata durumları:**
- Sipariş `Onaylandi` veya `IptalEdildi` ise → `409`
- `bankaReferansNo` aynı `firmaId` için daha önce kullanılmışsa → `409`

---

#### `POST /FirmaKrediYonetimi/HavaleSiparisiIptal`

Sipariş süresi geçmişse veya yanlış sipariş oluşturulduysa admin iptal eder.

**Request:** `{ "siparisId": 412, "iptalNedeni": "Müşteri geri döndü" }`

---

### 5.3. crewinjob.com Satın Alma Ekranında Beklenen Akış

```
Paket seçimi
  ↓
Ödeme yöntemi:  [💳 Kredi Kartı]   [🏦 Havale / EFT]
                     ↓                      ↓
               Mevcut stripe akışı    HavaleSiparisiOlustur
                                            ↓
                                   Banka bilgileri + referans kodu ekranı
                                   "CRW-84-20260830-7312 referans kodunu
                                    havale açıklamasına yazmayı unutmayın."
                                            ↓
                                   [Siparişlerimi Gör] butonu
                                    (SiparisDurumu polling)
```

**Kullanıcı deneyimi notları (frontend ekibine iletilecek):**
- Referans kodu **kopyalanabilir** (clipboard API) olmalı ve ekranda büyük, belirgin gösterilmeli.
- Banka bilgileri (IBAN, hesap adı) sayfa yenilense de görünmeli — bir e-posta bildirimi de gönderilebilir.
- Sipariş onaylandığında kullanıcıya bildirim/e-posta gönderilmeli (`Durum = Onaylandi` → tetikle).
- Onay bekleme ekranında "Hâlâ bekleniyor" mesajı + son geçerlilik tarihi gösterilmeli.

---

## 6. Cevaplamanızı İstediğimiz Sorular

1. **Mevcut kredi kartı satın alma modülü bakiyeyi nerede tutuyor?** Mutable kolon mu,
   hareket tablosu mu? Migration gerekip gerekmediğini buna göre planlayacağız.
2. **Bullseye şu an nasıl modellenmiş?** Abonelik tablosu var mı, yoksa firma üzerinde
   bir flag + tarih mi?
3. **CV kredisinin son kullanma tarihi olacak mı?** Ticari karar sizde değil ama şemada
   `GecerlilikBitis` alanını tutmanızı öneriyoruz — sonradan eklemek zor olur.
4. **Farklı para birimi:** USD fiyat listesinden satış yapıp TRY tahsilat olursa kur
   bilgisini saklamalı mıyız? Şimdilik ihtiyacımız yok ama `Kur` ve `TutarBazParaBirimi`
   alanlarını baştan eklemek maliyetsiz.
5. **Fatura entegrasyonu** bu modülün kapsamında mı, yoksa `FaturaNo` alanını manuel
   doldurmamız yeterli mi?

---

## 6. Kabul Kriterleri

- [ ] Aynı `BankaReferansNo` ile ikinci kayıt denemesi `409` döner, veri çiftlenmez.
- [ ] `OdemeKaydet` içinde hak tanımlama hatası olursa ödeme kaydı da oluşmaz (rollback).
- [ ] `HareketIptal` sonrası orijinal kayıt tabloda durur, bakiye doğru hesaplanır.
- [ ] Yetkisiz kullanıcı tüm endpoint'lerden `403` alır.
- [ ] Bir firmaya 100 CV kredisi tanımlandıktan sonra 3 CV unlock edilirse
      `FirmaDurum` bakiyesi 97 döner — yani tüketim de aynı ledger'a yazılıyor.
- [ ] `HareketGecmisi` her satırda işlemi yapan kullanıcıyı gösterir.

---

## 7. Not

Frontend'i marketing panel tarafında biz yazacağız. Sizden beklediğimiz sadece yukarıdaki
API'ler. Endpoint isimlerinde veya alan adlarında değişiklik yaparsanız **implementasyona
başlamadan önce** haber verin, panel tarafını ona göre kuralım.
