# Crewin backend istekleri (22 Ekim 2026)

> **27 Ekim 2026 durumu:** backend 1, 2 ve 4. maddeleri intern branch'ine ekledi; canlıya çıkınca haber verecek. Panel ve ajan
> tarafı backend'in yanıtına göre güncellendi (aşağıda her maddenin "Yapıldı" notu). Canlıya çıkınca yapılacaklar:
> `.env.local` içinde `CREWINJOB_ILAN_EDIT_GETTER=Ilan/GetIlanForEdit`; araştırma için `api.crewin.org`'da araştırma
> ayarlarının tanımlanması (backend notu: bu ayarlar tanımlanana kadar araştırma orada çalışmaz).

Crewin ABP arka ucunun kaynak kodu bu repoda yok. Pazarlama paneli ve ajan, arka uca yalnız HTTP ile bağlanır (`CREWINJOB_API_URL`). Bu belgedeki işler arka uç ekibinindir.

Her maddede iki şey var: arka ucun ne sağlaması gerektiği ve o hazır olunca bu repoda neyin değişeceği.

## 1. İlanın tam verisi (son tarih uzatma)

- **Bugün:** `crewinjob-agent/modules/job-bot.js` `updateIlanExpiry`, `CREWINJOB_ILAN_EDIT_GETTER` boşken `ILAN_EDIT_GETTER_MISSING` verir ve uzatmayı atlar. `modules/expiry-manager.js` bu hatayı yakalar.
  - Sebep: `Ilan/CreateOrEdit` tam DTO ister. Eksik alanla gönderilirse ilanın diğer alanları silinebilir.
- **Arka uçtan beklenen:**
  - ilanı düzenleme için tam DTO ile döndüren bir GET (ör. `Ilan/GetIlanForEdit?Id=`);
  - yanıtın `ilan` alanında (veya kökte) `id` ve `positionId` dahil `CreateOrEdit`'in kabul ettiği tüm alanlar;
  - getter'ın adı ve yanıt örneği.
- **Hazır olunca burada:** `.env.local` içinde `CREWINJOB_ILAN_EDIT_GETTER=Ilan/GetIlanForEdit` (veya gerçek adı). Kod hazır, testi `crewinjob-agent/test/pipeline-fixes.test.js` içinde.
- **Yapıldı (27 Ekim):** backend `Ilan/GetIlanForEdit`'i onayladı. `result.ilan` hiçbir alanı silinmeden alınıp yalnız `expirationDate` değiştirilerek gönderiliyor. `positionId` veya `shipTypeId` 0 olan ilanlar ve "İlan bulunamadı." dönenler tek tek atlanıyor, diğerleri uzatılıyor. Servis `Pages.Ilan` yetkisi ister.

## 2. `email_complained` olayı (SES şikâyetleri)

- **Bugün:** `crewinjob-web/app/api/track/bounce/route.ts` SES şikâyetini işler:
  - List-Unsubscribe başlığındaki token ile `ProcessUnsubscribe` çağrılır (`reason:'complaint'`, 400 dönerse `user_request`);
  - kampanyası olan alıcı için `TrackCampaignDeliveryEvent eventType:'complained'` gönderilir.
  - Ama `TrackActivationEvent` için `email_complained` adı tanımlı değil (`crewinjob-agent/modules/api.js` `TRACKED_EVENT_NAMES`).
- **Arka uçtan beklenen:**
  - `GemiAdamiGenel/TrackActivationEvent` için `email_complained` olay adının kabul edilmesi;
  - `ProcessUnsubscribe` için `reason:'complaint'` değerinin kabulü;
  - token'ı olmayan şikâyetler için kullanıcı kimliğine ya da e-postaya göre bastırma ucu.
- **Hazır olunca burada:** olay adı `TRACKED_EVENT_NAMES` listesine eklenir ve bounce rotası `trackActivationEvent('email_complained', …)` çağırır. Küçük bir değişiklik.
- **Yapıldı (27 Ekim):** `email_complained` gönderiliyor. Token'lı şikâyet `ProcessUnsubscribe` (`reason:'complaint'`), token'sız şikâyet yeni `GrowthAnalytics/SuppressContact` servisine gidiyor (`providerEventId` ile tekrar sayılmaz). `ok`, `not_found` ve `invalid` sonuçları etkinlik günlüğüne ayrı satırlar olarak yazılıyor (`lib/ses-complaint.ts`). Servis `Pages.Marketing.CampaignDelivery`, `Pages.MarketingManagement.Dispatch` veya `Pages.Marketing` izinlerinden birini ister.

## 3. Aday (prospect) abonelikten çıkma token'ları

**Bu repoda çözüldü** (22 Ekim 2026), arka uca bağlı değil:

- arka uç bağlantısı olmayan alıcılara (adaylar, şirketler, elle girilen adresler) panel kendi tek tıkla çıkma bağlantısını koyar (`crewinjob-web/lib/legacy-unsubscribe.ts`);
- bağlantıda adres yoktur; yalnız adresin tek yönlü anahtarı, imza ve bir yıllık son tarih vardır;
- çıkanlar `crewinjob-web/data/email-suppressions.json` dosyasına yazılır;
- `email/send` ve `email/send-job-match` bu listedeki adreslere pazarlama e-postası göndermez;
- bağlantı yalnız `NEXT_PUBLIC_APP_URL` ayarlıysa (canlıda https) üretilir.

**Arka uç ileride aday token'ı üretirse** o bağlantı önceliklidir. Yerel liste yine kontrol edilir. Bu listeyi arka uca aktarmak isterseniz bir toplu bastırma ucu gerekir.

## 4. `StartResearch` 0 sonuç

Ayrıntı repo kökündeki `BACKEND-StartResearch-kaynak-fix.md` dosyasında. Özetle:

- `GetResearchSources` boş dönüyor; araştırma kaynakları tanımlanmalı.
- `querySummary` yalnız anahtar kelimeleri kullanıyor; ülke, şirket türü ve sinyaller de sorguya girmeli.
- Gemini grounding (Google arama) açık mı kontrol edilmeli.
- İş durumunu okuyan resmi uç adı belgelenmeli.

**Bu repoda:** panel doğru isteği gönderiyor ve sonucu bekliyor. Arka uç düzelince değişiklik gerekmez.

**Yapıldı (27 Ekim):** panel durumu yalnız `GET MarketingProspect/GetResearchStatus?jobId=` ile okuyor ve `queued`/`running` dışında bir değer gelince sorgulamayı bırakıyor. Sonucu `totalSaved` belirliyor: `totalFound > 0` ve `totalSaved = 0` ise "bulunanların hepsi zaten listede" diye bilgi verir, hata göstermez. 0 sonucun sebebi backend'in `errorMessage` alanından gösteriliyor. Panelin bağlandığı adres `api.crewin.org`; backend'e göre orada araştırma ayarları henüz tanımlı değil.
