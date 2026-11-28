# Görev: Sesli özellikler için uyum altyapısı (bayrak kapalı)

Bu projeye ileride ElevenLabs ile sesli özellikler eklenecek: konuşmayı yazıya çevirme, sesli okuma ve sesli asistan/telefon ajanı. Bu görevde ElevenLabs'i ENTEGRE ETMİYORUZ. Sadece yasal uyum altyapısını, varsayılan olarak KAPALI bir özellik bayrağının arkasına kuruyoruz. Bayrak kapalıyken kullanıcı hiçbir fark görmemeli. ElevenLabs entegrasyonu ayrı bir görevde gelecek ve bu altyapıyı kullanacak.

## Başlamadan
- Önce CLAUDE.md, AGENTS.md, README ve docs klasörünü oku. Projenin kurallarına, klasör yapısına, i18n, migration ve test düzenine uy.
- Projede mevcut onay, çerez veya gizlilik kodu varsa önce onu bul ve aynı deseni kullan. Paralel ikinci bir sistem kurma.
- Yeni bir dal aç: feature/voice-consent-foundation. İş bitince commit et, push etme.
- Bir şey bu promptla çelişiyorsa (dosya taşınmış, yapı farklı) projeye uyan çözümü seç ve özette belirt.

## Kesin kurallar
- ElevenLabs SDK'sı, API anahtarı veya ElevenLabs'e giden herhangi bir ağ isteği EKLEME.
- Hiçbir gizli değeri (.env içeriği, anahtar, şifre) okuma, yazdırma veya commit'leme.
- Bayrak kapalıyken: yeni UI görünmez, yeni ağ isteği atılmaz, güvenlik başlıkları (Permissions-Policy, CSP) bugünküyle birebir aynı kalır, gizlilik ve aydınlatma sayfaları bugünkü metni gösterir.
- Veritabanı değişikliği gerekiyorsa projenin migration düzenine uy. Hiçbir veritabanına (özellikle canlıya) migration UYGULAMA.
- Ses asla kimlik tespiti, sesle doğrulama, ses klonlama veya duygu/kişilik analizi için kullanılmayacak. Bunu kapı fonksiyonunun yorumunda ve dokümanda yaz.
- Yasal metinleri aşağıda verildiği gibi kullan, kendin yeniden yazma. Eksik dil için İngilizce metni koy ve "TODO: hukuk onaylı çeviri" işareti bırak. Makine çevirisi yapma.

## Ortak yapı taşları (projenin stack'ine uyarla)
1. Özellik bayrağı: VOICE_FEATURES_ENABLED, varsayılan false. Sunucuda ve istemcide tek bir yardımcıdan okunur (ör. isVoiceEnabled()).
2. Sağlayıcı bölgesi: VOICE_PROVIDER_REGION yapılandırması, varsayılan "US". Metinlerdeki [ülke] / [region] yer tutucusu buradan doldurulur ("ABD" / "the United States"; ileride AB seçilirse "AB" / "the European Union").
3. Onay kaydı (append-only): her onay verme ve geri çekme yeni bir satırdır, eski satır güncellenmez. Alanlar: kişi kimliği (kullanıcı, lead veya kişi), onay türü, metin sürümü (ör. "voice-tr-1.0"), dil, verildi mi, zaman (UTC), kaynak (web, mobil, form, ajan) ve arama onaylarında telefon (E.164). IP veya cihaz parmak izi tutma.
4. Onay metinleri: sürüm numaralı sabitler veya i18n kaynakları. Metin değişirse sürüm artar, eski sürüm silinmez.
5. Kapı fonksiyonu: canUseVoice(kişi, onayTürü). Bayrak kapalıysa veya geri çekilmemiş geçerli onay yoksa false döner. İleride her ElevenLabs çağrısından önce sunucu tarafında bu çağrılacak.
6. Geri çekme: kullanıcının onayı ayarlardan geri alabileceği bir yol (bayrak açıkken görünür).
7. Ajan açılış cümleleri: aşağıdaki metinler, dil anahtarlı sabitler olarak. İleride ajan ayarına verilecek.
8. Testler: (a) bayrak kapalı → UI, başlıklar ve gizlilik metni değişmemiş, kapı false; (b) bayrak açık → onay kaydedilir, kapı true; (c) geri çekmeden sonra kapı false.
9. docs/voice/ENABLE-CHECKLIST.md: bayrağı açmadan önce yapılacaklar. Şu ön koşulları da yaz: ElevenLabs sözleşmesi netleşti (Enterprise, Zero Retention Mode, veri bölgesi); KVKK standart sözleşmesi imzalandı ve 5 iş günü içinde Kurum'a bildirildi; avukat metinleri onayladı; VERBİS güncellendi; mikrofon izinleri ve CSP güncellendi; ElevenLabs anahtarı yalnızca sunucuda.

## Ortak metinler
Ses işleme onayı (voice-tr-1.0):
"Sesli [özellik] için ses kaydınız, yazıya çevrilmek üzere hizmet sağlayıcımız ElevenLabs'e ([ülke]) gönderilir. Kayıt yazıya çevrildikten sonra silinir; yalnızca metin saklanır. Bu özelliği kullanmak zorunda değilsiniz, yazarak da devam edebilirsiniz. Onayınızı Ayarlar'dan istediğiniz zaman geri alabilirsiniz."
Onay kutusu: "Ses kaydımın yazıya çevrilmek amacıyla işlenmesine açık rıza veriyorum."

Voice processing consent (voice-en-1.0):
"To use voice [feature], your recording is sent to our service provider ElevenLabs ([region]) to be transcribed. The recording is deleted after transcription; only the text is kept. Voice is optional, and you can always type instead. You can withdraw consent at any time in Settings."
Checkbox: "I consent to my voice recording being processed for transcription."

Aydınlatma metni eki (privacy-voice-tr-1.0):
"Sesli özellikler. [Ürün] üzerinde sesli özellikleri kullanırsanız ses kaydınız ve yazıya dökülmüş hali işlenir. Bu veriler [amaç] amacıyla, açık rızanıza dayanılarak işlenir. Ses kayıtları, veri işleyenimiz ElevenLabs ([ülke]) tarafından yazıya çevrilir ve işlemden sonra silinir. Metinler [süre] boyunca saklanır. Sesli asistan cevapları için [LLM sağlayıcı], telefon görüşmeleri için [Twilio] kullanılır. Bu aktarımlar KVKK m.9 kapsamında imzalanıp Kurum'a bildirilmiş standart sözleşmelere dayanır. Sesiniz kimlik tespiti veya duygu analizi için kullanılmaz. KVKK m.11'deki haklarınız için: [iletişim]."
Köşeli parantezli yerlerden ürün adı ve amacı doldur; dolduramadıklarını TODO olarak bırak, uydurma.

## Bitince
Kısa bir özet ver: değişen dosyalar, bayrağın nereden açıldığı, test sonuçları ve projede gördüğün ama bu görevin dışında kalan uyum sorunları (düzeltmeden listele).

## Bu projeye özel: Ryzevo (crewinjob-web)
Yapı: Next.js 15, MSSQL/SQLite, Gemini. Ryzevo, müşterileri (küçük işletmeler) adına veri işleyen konumunda; son kullanıcı verisinin veri sorumlusu Ryzevo müşterisidir.
İlgili dosyalar: lib/platform/plan-catalog.ts, lib/platform/iys.ts, lib/platform/legacy-whatsapp-consent.ts, lib/platform/brand-kit.ts, components/platform/design/video.ts, app/api/booking, BookingPage.tsx, app/randevu, docs/CREWIN-WHATSAPP-CONSENT.md.

Yapılacaklar:
1. Bayrak: VOICE_FEATURES_ENABLED ve NEXT_PUBLIC_VOICE_FEATURES_ENABLED, varsayılan false.
2. Plan hakları: plan-catalog.ts'e sesli özellikler için mevcut AI birimlerinden AYRI haklar (voiceoverMinutes, agentMinutes, outboundCalls). Tüm planlarda 0; bayrak kapalıyken hiçbir plan ekranında görünmez.
3. Giden arama kapısı: assertOutboundCallAllowed(tenantId, phoneE164, purpose), purpose = "informational" | "commercial". commercial için iys.ts üzerinden İYS onayı yoksa reddeder; informational için kişinin arama onayı yoksa reddeder; bayrak kapalıyken her zaman reddeder. Testleriyle birlikte.
4. Onay kaydı: legacy-whatsapp-consent.ts desenini izleyerek son kullanıcı için voice_assistant ve call_informational onay türleri (append-only).
5. Booking/randevu sayfası: bayrak açıkken görünen asistan bildirimi ve ilk kullanımda ses işleme onayı.
6. Marka sesi: brand-kit.ts'e voiceProfile alanı; yalnızca "designed" türü desteklenir. Ses klonlama desteklenmez; tip tanımı bunu engellesin ve yorumla belirtsin (klonlama için rıza kanıtı ve ayrı hukuki onay gerekir).
7. Yapay zekâ seslendirmeli videolar: dışa aktarım meta verisine aiVoiceover: true. Bayrak açıkken dışa aktarım ekranında "Paylaşırken platformun yapay zekâ içeriği etiketini açın" uyarısı.
8. Kullanım koşulları / DPA sayfasında alt işleyen listesine ElevenLabs paragrafı (bayrak açıkken).

Metinler:
- Ses işleme onayı: ortak metin, [özellik] = "asistan" / [feature] = "assistant".
- Asistan açılış (TR): "Merhaba, ben [İşletme adı]'nın yapay zekâ asistanıyım. Konuşmamız yazıya dökülür. İsterseniz sizi bir çalışana yönlendirebilirim."
- Arama onayı (call-tr-1.0, booking formu): "Randevumla ilgili olarak [İşletme adı] tarafından bir çalışan veya yapay zekâ asistanı aracılığıyla telefonla aranmayı kabul ediyorum."
- Ticari arama onayı (iys-call-tr-1.0, isteğe bağlı): "Kampanya ve fırsatlarla ilgili ticari arama almak istiyorum. (İYS'ye kaydedilir.)"
