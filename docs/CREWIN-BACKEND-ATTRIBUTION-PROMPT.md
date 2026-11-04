# Crewin backend: "Hangi iş müşteri getirdi" için olay gönderimi (istek metni)

Aşağıdaki metin olduğu gibi Crewin backend ekibine ya da kod asistanına verilebilir.

````markdown
CrewinJob pazarlama paneli (Ryzevo), hangi paylaşım veya e-postanın gerçek kayıt ve gelir getirdiğini gösteriyor. Bunun için CrewinJob backend'inin iki şey yapması gerekiyor:
1. Bir kişinin siteye ilk geldiği kaynak etiketini kayıt anında kullanıcı veya firma kaydına yazmak.
2. Belirli ürün olaylarını imzalı bir webhook ile panele göndermek.

Panel, kişiyi kimliğini saklamadan eşler ve rakamları yalnız toplam olarak gösterir.

## 1. İlk kaynak etiketini yakala
- **Etiket:** paneldeki paylaşım ve e-posta linkleri şu parametreleri taşır:
  - `utm_campaign=rz_<10 küçük hex>` (ör. `rz_1a2b3c4d5e`)
  - `utm_source` (`linkedin`, `facebook`, `x`, `telegram`, `whatsapp`, `instagram`, `tiktok`, `copy`, `email`)
  - `utm_medium` (`social`, `organic_social`, `messaging`, `channel`, `group`, `bot` veya `email`)
- **crewinjob.com'a gelişte:**
  - `utm_campaign`, `utm_source` ve `utm_medium` değerlerini oku. Yalnız `[A-Za-z0-9._:-]` karakterli değerleri al: campaign en çok 100, diğerleri en çok 64 karakter.
  - Değerleri ve geliş zamanını birinci taraf bir çerezde 90 gün tut.
  - **Yalnız ilk gelişi sakla.** Çerez zaten varsa üzerine yazma.
  - **Çerez onayı:** KVKK gereği yalnız ziyaretçi çerez onayı verdikten sonra yaz. Paneldeki hazır kod parçası (Proje ayarları → Ürün verisi → İmzalı webhook → "Kaynak etiketi") bunu yapıyor; aynısını kullanabilir veya kendi yönteminizle yazabilirsiniz. Çerez adı `ryz_touch`, içeriği `{campaign, source, medium, touchedAt}`.
- **Kayıt anında:** denizci veya firma kaydı oluşurken çerezi oku ve ilk dokunuşu kayda yaz: `first_touch_campaign`, `first_touch_source`, `first_touch_medium`, `first_touch_at`. Daha sonraki olaylarda gerekmez; panel ilk teması kendisi hatırlar.

## 2. Gönderilecek olaylar
İki kaynak açılacak; her kaynağın kendi kayıt türü ve özellikleri var. Panel yöneticisi kaynakları açınca size kaynak kimliğini (`sourceId`), güncel `sourceVersion` değerini ve imza anahtarını iletecek.

**Kaynak A: Denizci olayları** (kayıt türü `user`). Her olayda zorunlu özellik: `platform` (metin: `web`, `android` veya `ios`).

| Olay adı | Ne zaman | Paneldeki aşama |
|---|---|---|
| `seafarer.registered` | Hesap oluşturuldu | Denizci aktivasyonu → Kayıt |
| `seafarer.profile_completed` | Profil ilk kez tamamlandı | → Profil tamamlama |
| `seafarer.applied` | İlana ilk kez başvurdu | → İlana başvuru |

**Kaynak B: Firma olayları** (kayıt türü `company`). Her olayda zorunlu özellik: `amount` (sayı). Ödeme dışı olaylarda `0` gönderin.

| Olay adı | Ne zaman | Paneldeki aşama |
|---|---|---|
| `company.registered` | Firma hesabı oluşturuldu | CV unlock geliri → Şirket kaydı |
| `company.job_posted` | İlk ilan (ücretsiz veya Bullseye) yayımlandı | → Ücretsiz ilan / Bullseye |
| `company.candidate_reviewed` | Firma bir adayı ilk kez inceledi | → Aday inceleme |
| `company.cv_unlocked` | CV kilidi açıldı | → CV unlock |
| `company.credits_purchased` | Kredi satın alındı | Gelir (tutar) |

Kurallar:
- **`amount`:** ödenen tutar, ana para biriminde ve ondalıklı (ör. `1490.00`). Tek bir para birimi kullanın; hangisi olduğunu panele bildirin.
- **`entityId`:** kişinin veya firmanın iç kimliği (ör. `48213`). E-posta, telefon veya ad kullanmayın. Aynı kişi için her olayda aynı kimlik ve aynı kayıt türü olmalı.
- **Kişisel veri:** özelliklerde kişisel veri yok. `password`, `token`, `secret`, `consent` gibi anahtar adları reddedilir.
- **İlk temas:** kayıt olayına (`seafarer.registered`, `company.registered`) kayıttaki ilk dokunuşu `attribution` alanıyla ekleyin. İlk dokunuş yoksa alanı hiç göndermeyin. Biçimi bozuk bir `attribution` olayı reddettirmez, yalnız yok sayılır.

## 3. Uç nokta ve imza
```
POST <PANEL_ADRESI>/api/platform/product-events/<sourceId>
Content-Type: application/json
x-ryzevo-timestamp: <Unix saniye, 10 hane>
x-ryzevo-signature: v1=<64 küçük hex>
```
- **İmza:** `HMAC-SHA256(anahtar, "<timestamp>.<sourceId>." + gövdenin ham baytları)`, küçük harfli hex.
  - Anahtar 64 karakterlik hex olarak verilir; HMAC'ta hex'ten çözülmüş 32 bayt kullanılır.
  - İmzayı gönderdiğiniz baytların aynısıyla hesaplayın: gövdeyi imzadan sonra yeniden serileştirmeyin.
- **Zaman:** sunucu saatiyle en çok ±300 saniye fark kabul edilir.
- **`Origin` header'ı** göndermeyin; gönderen istek reddedilir.
- **Gövde:** en çok 64 KiB, istek başına 1–20 olay.

```json
{
  "sourceVersion": 1,
  "events": [
    {
      "id": "seafarer-registered-48213",
      "entityId": "48213",
      "eventName": "seafarer.registered",
      "occurredAt": "2026-11-02T10:15:00+03:00",
      "attributes": { "platform": "web" },
      "attribution": { "campaign": "rz_1a2b3c4d5e", "source": "linkedin", "medium": "social", "touchedAt": "2026-11-01T21:40:00+03:00" }
    }
  ]
}
```

Alan kuralları:

| Alan | Kural |
|---|---|
| `id` | Olayın kalıcı kimliği: `[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}`. Aynı olay yeniden gönderilirse aynı `id` ve aynı içerik kullanılır. |
| `occurredAt` | Saat dilimli ISO tarih. En çok 5 dakika ileride, en çok 30 gün geçmişte. |
| `attributes` | Kaynakta tanımlı anahtarların hepsi, tam türüyle: metin en çok 500 karakter, sayı veya evet/hayır. |
| `sourceVersion` | Paneldeki güncel sürüm. Sürüm değişirse 409 `schema_version` döner; yeni sürüm numarasını panelden alın. |

C# (ASP.NET Core / ABP) imza örneği:
```csharp
var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
using var hmac = new HMACSHA256(Convert.FromHexString(signingKeyHex));
var signed = Encoding.UTF8.GetBytes($"{timestamp}.{sourceId}.").Concat(bytes).ToArray();
var signature = "v1=" + Convert.ToHexString(hmac.ComputeHash(signed)).ToLowerInvariant();
var request = new HttpRequestMessage(HttpMethod.Post, $"{panelUrl}/api/platform/product-events/{sourceId}") { Content = new ByteArrayContent(bytes) };
request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
request.Headers.Add("x-ryzevo-timestamp", timestamp);
request.Headers.Add("x-ryzevo-signature", signature);
```

## 4. Yanıtlar, yeniden deneme ve sınırlar
- **Başarılı yanıt (200):** `{accepted, duplicates, recordsUpdated, receivedAt, attribution: {recorded, ignored}}`. Aynı olayı tekrar göndermek güvenlidir; yinelenen olay sayılır.
- **Yanıta göre ne yapılır:**

| Yanıt | Anlamı | Ne yapılmalı |
|---|---|---|
| 401 | İmza, zaman veya anahtar geçersiz | Sunucu saatini ve anahtarı kontrol edin |
| 409 `event_conflict` | Aynı `id` farklı içerikle gönderildi | `id` üretimini düzeltin |
| 409 `schema_version` | Kaynak sürümü değişti | Panelden yeni sürümü alın |
| 422 | Alan biçimi hatalı | Gövdeyi düzeltin |
| 429 | Hız veya kota sınırı | Bekleyip yeniden deneyin |
| 5xx | Geçici hata | Artan beklemeyle yeniden deneyin |

- **Gönderim yöntemi:** olayları bir kuyruktan, kullanıcı isteğinden bağımsız gönderin. Panel ulaşılamazsa kayıt veya ödeme akışı etkilenmemeli.
- **Sınırlar** (kaynak başına):
  - dakikada 120 istek;
  - proje başına günde 20.000 olay;
  - 30 günde saklanan en çok 200.000 olay.
  - Bu hacim aşılacaksa önceden panel ekibine bildirin.
- **Geçmiş olaylar:** 30 günden eski olaylar kabul edilmez; geçmişe dönük doldurma yapılamaz.

## 5. Test ve bitti tanımı
- **Kurulum sırası:**
  1. Panel yöneticisi iki kaynağı açar ve size `sourceId`, `sourceVersion` ve anahtarı verir. Anahtarı yalnız sunucu ortam değişkeninde tutun; koda veya sohbete koymayın.
  2. Paneldeki "Şemayı önizle" ile örnek gövdeyi deneyin. Önizleme kayıt oluşturmaz ve kaç olayda geçerli etiket olduğunu söyler.
  3. Panel kaynağı etkinleştirir; sonra test ortamından birkaç gerçek olay gönderin.
- **Bitti:**
  - Paneldeki Analitik → "Hangi iş müşteri getirdi" bölümünde, etiketli bir linkle gelip kaydolan test kullanıcısı ilgili paylaşımın altında görünüyor.
  - Aynı kişinin sonraki olayları etiket taşımadan doğru aşamada sayılıyor.
````

## Panel tarafında gereken iş
Bu metin backend'in payını anlatıyor. Panel tarafının durumu:
1. **Crewin için açmak (yapıldı, 2 Kasım 2026):** imzalı ürün olayları (Proje ayarları → Ürün verisi, yalnız imzalı webhook) ve "Hangi iş müşteri getirdi" raporu (Analitik) Crewin çalışma alanında açık.
2. **Crewin'in kendi linklerini etiketlemek (yapıldı):** crewinjob.com linklerine `utm_campaign=rz_…` ekleyen araçlar:
   - kampanya yürütücüsü;
   - paylaşım paneli (kopyala-aç paylaşımlar ve Instagram/TikTok profil linki dahil);
   - zamanlanmış gönderiler;
   - Telegram, e-posta ve iş eşleştirme e-postası gönderimi;
   - ajanın Telegram kanal, grup ve bot paylaşımları (her ilan kendi etiketini taşır). Ayrıntı ve kapsam dışı kalanlar: `docs/SAAS-ATTRIBUTION.md` → "The Crewin workspace".
3. **Hedef aşamalarını bağlamak (kaynaklar açılınca yapılacak):** Crewin'in hedef aşamaları (Denizci aktivasyonu, CV unlock geliri) yukarıdaki olay adlarına Analitik → Otomatik ölçümler'den bağlanmalı. Tutar ayarında `company.credits_purchased` olayı, `amount` alanı ve para birimi seçilmeli.
