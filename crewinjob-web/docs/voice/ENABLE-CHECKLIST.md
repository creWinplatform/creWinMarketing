# Sesli özellikler — bayrağı açmadan önce kontrol listesi (Ryzevo)

Sesli özellikler (ElevenLabs ile konuşmayı yazıya çevirme, sesli okuma, sesli asistan / telefon ajanı) için uyum
altyapısı kodda hazır, ama **varsayılan olarak kapalı**. Bu görevde ElevenLabs entegre edilmedi: SDK, API anahtarı
veya ElevenLabs'e giden hiçbir istek yok. Entegrasyon ayrı bir görevde gelecek ve buradaki kapıları kullanacak.

## Bayrak

| Değişken | Nerede | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `VOICE_FEATURES_ENABLED` | sunucu | kapalı | Sunucu kapıları (onay kaydı, `canUseVoice`, arama kapısı) |
| `NEXT_PUBLIC_VOICE_FEATURES_ENABLED` | tarayıcı + sunucu (build sırasında gömülür) | kapalı | Ekranlar |
| `VOICE_PROVIDER_REGION` | sunucu | `US` | Metinlerdeki [ülke] / [region]: `US` → "ABD" / "the United States", `EU` → "AB" / "the European Union" |

Açmak için ikisini birden `1` (veya `true`) yapın, **yeniden build alın** ve yeniden başlatın. Tek okuma noktası
`lib/platform/voice-features.ts` → `isVoiceEnabled()`: sunucuda iki değişken de açık olmalı, tarayıcı yalnız
`NEXT_PUBLIC_…` değerini görür. Biri açık biri kapalıysa sunucu kapıları kapalı kalır.

Bayrak kapalıyken: yeni bir ekran görünmez, yeni bir istek atılmaz, `next.config.mjs` başlıkları (CSP, Permissions-Policy
yok) değişmez, gizlilik sayfası bugünkü metni gösterir, plan ekranları aynı kalır, randevu formu aynı alanları gönderir.
Bunu `test/platform-voice-consent.test.cjs` denetler.

## Ses neye kullanılmaz

Ses **asla** kimlik tespiti, sesle kimlik doğrulama, ses klonlama veya duygu / kişilik analizi için kullanılmaz.
`canUseVoice()` yalnızca "bu kişinin kaydı asistan için yazıya çevrilebilir mi" sorusunu yanıtlar. Marka sesi
(`brand-kit.ts` → `voiceProfile`) yalnızca `kind: 'designed'` olabilir; klonlanmış ses tip düzeyinde ifade edilemez ve
sunucu reddeder (klonlama için sesin sahibinin rıza kanıtı ve ayrı hukuki onay gerekir).

## Bayrağı açmadan önce (ön koşullar)

- [ ] **ElevenLabs sözleşmesi netleşti:** Enterprise plan, Zero Retention Mode açık, veri bölgesi seçildi ve
      `VOICE_PROVIDER_REGION` buna göre ayarlandı.
- [ ] **KVKK standart sözleşmesi** (yurt dışı aktarım, KVKK m.9) ElevenLabs ile imzalandı ve imzadan sonra **5 iş günü
      içinde Kurum'a bildirildi.** Sesli asistan cevapları için kullanılacak LLM sağlayıcısı ve telefon altyapısı (ör.
      Twilio) için de aynısı.
- [ ] **Avukat metinleri onayladı:** `lib/platform/voice-consent-texts.ts` içindeki tüm metinler, ve gizlilik
      sayfasındaki ElevenLabs alt işleyen satırı (`lib/platform/voice-legal.ts` → `voiceSubprocessor`, hukukça
      verilmedi, onay bekliyor).
- [ ] **VERBİS güncellendi** (yeni veri kategorisi: ses kaydı ve dökümü; yeni alıcı grubu ve yurt dışı aktarım).
- [ ] **Mikrofon izinleri ve CSP güncellendi:** bugün `Permissions-Policy` başlığı yok ve CSP yalnız
      `frame-ancestors`, `object-src`, `base-uri` içeriyor. Entegrasyonla birlikte `microphone=(self)` ve ElevenLabs'in
      kullanılacak adresleri için `connect-src` (gerekiyorsa `media-src`) eklenmeli. Testteki başlık beklentisi o zaman
      bilerek güncellenir.
- [ ] **ElevenLabs anahtarı yalnızca sunucuda:** `NEXT_PUBLIC_` ile başlayan bir değişkende veya istemci kodunda asla
      olmamalı; tarayıcı yalnız sunucunun ürettiği kısa ömürlü oturum belirteçlerini (signed URL / token) görmeli.

## Ryzevo'ya özel açık işler

- [ ] **İYS ARAMA kanalı.** Ticari arama onayı (`iys-call-tr-1.0`, randevu formunda isteğe bağlı) metinde "İYS'ye
      kaydedilir" diyor, ama İYS tabloları bugün yalnız `EPOSTA` ve `MESAJ` kabul ediyor (`platform_iys_recipients`,
      `platform_iys_outbox`, `platform_iys_merchants` CHECK kısıtları). Bayrağı açmadan önce: ARAMA kanalı için şema
      değişikliği (proje migration düzeniyle, `db:upgrade`), onayın 3 iş günü içinde İYS'ye bildirilmesi
      (`voice-booking.ts` içindeki TODO) ve İYS'den ARAMA durumunun çekilmesi. O zamana kadar
      `assertOutboundCallAllowed(…, 'commercial')` her ticari aramayı reddeder; ya bu kutu gizlenmeli ya da bildirim
      tamamlanmalı.
- [ ] **İngilizce metinler.** `call-tr-1.0`, `iys-call-tr-1.0`, `privacy-voice-tr-1.0` ve asistan açılış cümlesinin
      İngilizcesi yok; İngilizce sayfalar Türkçe onaylı metni gösteriyor (`TODO: hukuk onaylı çeviri`). Hukuk onaylı
      çeviri gelince yeni sürüm olarak eklenmeli (ör. `call-en-1.0`), eskisi silinmez.
- [ ] **Aydınlatma eki boşlukları:** `[süre]` (metinlerin saklama süresi), `[LLM sağlayıcı]`, `[Twilio]` (telefon
      altyapısı) henüz belli değil; gizlilik sayfasında işaretli yer tutucu olarak görünüyorlar. `[iletişim]`,
      `lib/platform/sales-terms.ts` → `SALES_SELLER.email` doldurulunca dolar.
- [ ] **"Ayarlar'dan geri alabilirsiniz" ifadesi.** Randevu sayfası ziyaretçilerinin bir Ayarlar ekranı yok; geri alma
      düğmesi ("Onayımı geri al") asistan kutusunun içinde. Avukat metni buna göre onaylamalı veya metin değişmeli.
- [ ] **DPA / kullanım koşulları sayfası yok.** ElevenLabs alt işleyen satırı şimdilik gizlilik sayfasının "Aktarım"
      listesine (bayrak açıkken) eklendi. Ayrı bir DPA sayfası yazılırsa oraya da taşınmalı.
- [ ] **Telefon numarası saklama biçimi.** Arama onayları numarayı WhatsApp onay deseninde olduğu gibi tek yönlü anahtar
      (HMAC) ve kısa ipucu (+90•••34) olarak tutar, numaranın kendisini değil. Bir onayın kanıtı, numara bilindiğinde
      anahtarla eşleşerek gösterilir. Avukat açık E.164 saklanmasını şart koşarsa şifreli alan eklenmeli.
- [ ] **Saklama süresi:** `data/voice-consents.jsonl` yalnızca büyür (append-only). Onay kayıtlarının ne kadar
      saklanacağı (ör. ilişki bitiminden sonra zamanaşımı süresi) hukukça belirlenmeli.
- [ ] **Canlıda depo:** `PLATFORM_LEGACY_STORE=mssql` ile kayıtlar `legacy_records` içinde `web:voice-consents` deposuna
      yazılır (`lib/db/legacy-records.cjs` → `WEB_STORES`). Dosya modunda sunucunun `data/` klasöründedir; yedeklemeye
      dahil olduğu doğrulanmalı.
- [ ] **Plan hakları:** `VOICE_PLAN_RIGHTS` (`plan-catalog.ts`) tüm planlarda 0. Fiyatlandırma kararı verilince
      değerler girilmeli; plan ekranında yalnız bayrak açık ve değer > 0 iken görünür. Kullanım sayacı (dakika / arama)
      entegrasyonla birlikte eklenmeli.

## Kod haritası

| Ne | Dosya |
| --- | --- |
| Bayrak ve bölge | `lib/platform/voice-features.ts` |
| Sürümlü metinler, ajan açılış cümleleri | `lib/platform/voice-consent-texts.ts` |
| Onay kaydı (append-only), `canUseVoice`, `hasCallConsent` | `lib/platform/voice-consent.ts` |
| Giden arama kapısı `assertOutboundCallAllowed` | `lib/platform/voice-calls.ts` (+ `iysCallGate` in `lib/platform/iys.ts`) |
| Randevu sayfası onayları | `lib/platform/voice-booking.ts`, `app/api/booking/route.ts`, `components/platform/BookingPage.tsx`, `components/platform/VoiceAssistantConsent.tsx`, `app/randevu/page.tsx` |
| Gizlilik eki ve alt işleyen satırı | `lib/platform/voice-legal.ts`, `app/legal/privacy/page.tsx` |
| Plan hakları | `lib/platform/plan-catalog.ts`, `components/platform/PlanCatalog.tsx` |
| Marka sesi | `lib/platform/brand-kit-types.ts`, `lib/platform/brand-kit.ts` |
| AI seslendirme etiketi | `components/platform/design/video.ts`, `components/platform/design/VideoClips.tsx` |
| Testler | `test/platform-voice-consent.test.cjs` |

Entegrasyon görevi için kural: ElevenLabs'e giden **her** çağrıdan önce sunucuda `canUseVoice(tenant, subject,
'voice_assistant')`, her giden aramadan önce `assertOutboundCallAllowed(tenant, phoneE164, purpose, deps)` çağrılır.
