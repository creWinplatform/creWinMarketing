# Crewin backend istekleri (22 Ekim 2026)

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
