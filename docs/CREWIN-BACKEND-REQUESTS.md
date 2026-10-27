# Crewin backend istekleri (22 Ekim 2026)

> **27 Ekim 2026 durumu:** backend 1, 2 ve 4. maddeleri `api.crewin.org`'da yayına aldı (GetIlanForEdit, `email_complained`,
> SuppressContact, GetResearchStatus ve araştırma düzeltmeleri). Panel ve ajan tarafı buna göre güncellendi (aşağıda her maddenin
> "Yapıldı" notu). Araştırma ayarları `api.crewin.org`'da baştan beri açık (ResearchEnabled: true, sağlayıcı gemini,
> model gemini-2.5-flash, Google araması açık); 12 numaralı iş bu ayarlarla 25 şirket bulup 24'ünü kaydetti.
> Kalan tek adım: ilan süresi uzatmayı açmak için `CREWINJOB_ILAN_EDIT_GETTER=Ilan/GetIlanForEdit`.

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

**Yapıldı (27 Ekim):** panel durumu yalnız `GET MarketingProspect/GetResearchStatus?jobId=` ile okuyor ve `queued`/`running` dışında bir değer gelince sorgulamayı bırakıyor. Sonucu `totalSaved` belirliyor: `totalFound > 0` ve `totalSaved = 0` ise "bulunanların hepsi zaten listede" diye bilgi verir, hata göstermez. 0 sonucun sebebi backend'in `errorMessage` alanından gösteriliyor. Panelin bağlandığı `api.crewin.org`'da araştırma ayarları açık; 27 Ekim'deki iş 12 sorunsuz tamamlandı.

## 5. Araştırma sonuçlarında var olmayan alan adları ve e-posta doğrulaması (27 Ekim 2026)

27 Ekim'deki araştırmadan (işlem 12) sonra havuzdaki 58 lead'in alan adları DNS ile kontrol edildi:

- **22 lead'in alan adı e-posta almıyor:** 18'inin alan adı hiç yok (ENOTFOUND), 4'ünün e-posta sunucusu (MX) yok. Bu adreslere giden her e-posta geri döner ve gönderici itibarını düşürür.
- **3 alan adı başka bir şirkete ait:** `eps.com.sg` bir insan kaynakları firması, `molgroup.com` MOL Group (enerji), `eship.com` Executive Ship Management değil.
- Tüm adresler `info@alanadı` kalıbında üretilmiş; `deliverabilityStatus` hepsinde `unknown`.

**Arka uçtan beklenen:**
- `StartResearch` bir lead'i kaydetmeden önce alan adının MX kaydını kontrol etsin; e-posta sunucusu olmayan sonuçları kaydetmesin ya da `deliverabilityStatus` alanına işaretlesin.
- `VerifyEmails` rol adreslerinde (`info@`, `crew@` …) alan adına bakmadan `isDomainValid:false` döndürüyor; `altintasdenizcilik.com` gibi e-posta sunucusu olan bir alan adı da "geçersiz" görünüyor. Alan adı kontrolü rol adresi tespitinden bağımsız yapılmalı.

**Bu repoda yapıldı:**
- Panel, lead'leri yüklerken her adresin alan adını kendi sunucusunda DNS (MX) ile kontrol ediyor (`lib/email-domain-check.ts`, `POST /api/prospects/domain-check`). E-posta almayan alan adlarında "E-posta alan adı yok" notu görünüyor; böyle bir lead onaylanamıyor ve e-posta taslağı açılamıyor.
- `UpdateStatus` artık Swagger'daki gibi `PUT { id, status, reason }` ile çağrılıyor (önceden POST gönderiliyordu ve HTTP 405 dönüyordu; panelden lead durumu değiştirilemiyordu).
- `VerifyEmails` Swagger'daki `{ emails, prospectIds, updateProspects }` gövdesiyle çağrılıyor ve `EmailVerificationResultDto` alanları okunuyor.

**Backend yaptı (27 Ekim 2026, yayında):**
- `StartResearch` e-posta alamayan alan adlarını artık kaydetmiyor; `GetResearchStatus.errorMessage` bulunan ile kaydedilen arasındaki farkın sebebini yazıyor (panel bunu bilgi notu olarak gösteriyor).
- `VerifyEmails.isDomainValid` her adreste gerçek MX sonucunu gösteriyor. `status`: `valid` · `role_based` · `unverifiable` · `invalid` · `disposable`; lead kaydında `valid` sonucu `verified` olarak saklanıyor.
- Alan adı arama kaynaklarında geçmeyen lead'lerde `fitScore` 30 puan düşük ve `scoreReason` sonunda "Alan adı arama kaynaklarında doğrulanmadı." notu var.

**Panelde (aynı gün):** `isDomainValid` yeniden kullanılıyor; doğrulama nedeni (`reason`) lead detayında görünüyor; kaynaklarda doğrulanmayan alan adlarına "elle kontrol et" rozeti eklendi; "Havuzdaki e-postaları doğrula" düğmesi 50'şerli gruplarla `updateProspects: true` gönderiyor. Panelin kendi DNS/MX kontrolü yedek olarak duruyor. Havuzdaki 58 lead doğrulandı: 33 `role_based`, 23 `unverifiable` (22'si zaten reddedilmişti; kalan Unix Line incelemede), 2 `verified`; onaylı 10 lead'in hepsi e-posta alıyor.

