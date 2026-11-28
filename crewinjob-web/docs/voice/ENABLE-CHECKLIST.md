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
- [ ] **Avukat metinleri onayladı:** `lib/platform/voice-consent-texts.ts` içindeki tüm metinler; gizlilik
      sayfasındaki ElevenLabs ve Twilio alt işleyen satırları (`lib/platform/voice-legal.ts` → `voiceSubprocessors`,
      ekip yazdı); İngilizce taslaklar (`call-en-1.0`, `iys-call-en-1.0`, `privacy-voice-en-1.0`,
      `VOICE_AGENT_OPENING_DRAFTS.en`, ekip yazdı, `draft: true`). Onaylanan taslaktan `draft` kaldırılır ve
      `CURRENT_VOICE_TEXTS` / `VOICE_AGENT_OPENING` ona çevrilir; o zamana kadar ekranda gösterilmez ve onay olarak
      kaydedilemez.
- [ ] **VERBİS güncellendi** (yeni veri kategorisi: ses kaydı ve dökümü; yeni alıcı grubu ve yurt dışı aktarım).
- [x] **Mikrofon izinleri ve CSP:** bayrak açıkken (build sırasında) yalnız `/randevu` sayfasına
      `Permissions-Policy: microphone=(self)` ve `connect-src 'self' https://<host> wss://<host>` eklenir (`next.config.mjs`;
      host bölgeye göre `api.elevenlabs.io` veya `api.eu.residency.elevenlabs.io`). Bayrak kapalıyken başlıklar aynen
      kalır. **Entegrasyonda doğrulanacak:** ElevenLabs'in sesli asistan için kullandığı adresler (WebSocket / WebRTC)
      bu listeyle örtüşüyor mu; panelde de ses kullanılacaksa ilgili sayfalara aynı kural eklenmeli.
- [ ] **ElevenLabs anahtarı yalnızca sunucuda:** `NEXT_PUBLIC_` ile başlayan bir değişkende veya istemci kodunda asla
      olmamalı; tarayıcı yalnız sunucunun ürettiği kısa ömürlü oturum belirteçlerini (signed URL / token) görmeli.

## Ryzevo'ya özel açık işler

- [x] **İYS ARAMA kanalı (şema 86).** İYS kayıt ve gönderim tabloları artık `ARAMA` kanalını da kabul ediyor
      (`lib/platform/database.ts` migration 86; SQL Server için `npm run db:upgrade` iki CHECK kısıtını değiştirir,
      `scripts/mssql-upgrade.cjs` → `CHECK_CHANGES`). Randevu formundaki ticari arama onayı (+90 numaralar) İYS kuyruğuna
      `ARAMA / ONAY / HS_WEB` olarak girer ve 3 iş günü içinde gönderilir; ticari arama ancak İYS'de güncel ONAY varken
      yapılabilir. İYS ekranları yine yalnız e-posta ve WhatsApp kanallarını gösterir.
      **Yayın:** şema 86 hiçbir veritabanına uygulanmadı; canlıda 82–85 ile birlikte `db:upgrade` (önce yedek) gerekir.
- [ ] **Ticari arama onayının geri çekilmesi.** Randevu sayfasında arama onaylarını geri alma ekranı yok; kişi
      İYS üzerinden (RET) veya işletmeye başvurarak geri alabilir (İYS değişiklik akışı RET'i çeker ve aramayı durdurur).
      Panelde bir "aramayı durdur" işlemi entegrasyonla eklenmeli (`withdrawVoiceConsent` + İYS RET kuyruğu).
- [ ] **İngilizce metinler.** Taslaklar hazır (`draft: true`), avukat onayı bekliyor. Onaya kadar İngilizce sayfalar
      Türkçe onaylı metni gösterir (`TODO: hukuk onaylı çeviri`).
- [ ] **Aydınlatma eki:** `[LLM sağlayıcı]` = Google (Gemini) ve `[Twilio]` = Twilio dolduruldu. `[süre]` (metinlerin
      saklama süresi) hâlâ açık; `[iletişim]`, `lib/platform/sales-terms.ts` → `SALES_SELLER.email` doldurulunca dolar
      (`SALES_SELLER`'ın diğer alanları da boş).
- [x] **"Ayarlar'dan geri alabilirsiniz" ifadesi.** Asistan kutusunda bir **Ayarlar** bölümü var; onay oradan geri
      alınır. Avukat bunun metindeki "Ayarlar" için yeterli olduğunu teyit etmeli.
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
| İYS ARAMA (şema 86) | `lib/platform/database.ts`, `lib/db/mssql-schema.sql`, `scripts/mssql-upgrade.cjs`, `lib/platform/iys-types.ts` |
| Mikrofon ve CSP | `next.config.mjs` |
| Randevu sayfası onayları | `lib/platform/voice-booking.ts`, `app/api/booking/route.ts`, `components/platform/BookingPage.tsx`, `components/platform/VoiceAssistantConsent.tsx`, `app/randevu/page.tsx` |
| Gizlilik eki ve alt işleyen satırı | `lib/platform/voice-legal.ts`, `app/legal/privacy/page.tsx` |
| Plan hakları | `lib/platform/plan-catalog.ts`, `components/platform/PlanCatalog.tsx` |
| Marka sesi | `lib/platform/brand-kit-types.ts`, `lib/platform/brand-kit.ts` |
| AI seslendirme etiketi | `components/platform/design/video.ts`, `components/platform/design/VideoClips.tsx` |
| Testler | `test/platform-voice-consent.test.cjs` |

Entegrasyon görevi için kural: ElevenLabs'e giden **her** çağrıdan önce sunucuda `canUseVoice(tenant, subject,
'voice_assistant')`, her giden aramadan önce `assertOutboundCallAllowed(tenant, phoneE164, purpose, deps)` çağrılır.
