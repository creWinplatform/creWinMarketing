# Crewin WhatsApp izin ve çıkış kontrolü (30 Ekim 2026)

Eski Crewin panelinin WhatsApp gönderimi (`/api/messaging/whatsapp/send`) önceden hiçbir izin veya çıkış kontrolü yapmıyordu. Artık her numara için kayıtlı bir izin ister ve çıkış yapan numaraya göndermez. Sahibin onayıyla yapıldı; İYS bu adımda yok (aşağıdaki nota bakın).

## Nasıl çalışır
- **Kayıt** (`lib/legacy-whatsapp-consent.ts`, `data/whatsapp-consents.json`):
  - Numara E.164'e çevrilir (ülke kodu `+` veya `00` ile zorunlu).
  - Dosyada tam numara yok: tek yönlü HMAC anahtarı (TRACKING_SECRET, yoksa AUTH_SECRET) ve `+90•••34` gibi bir ipucu.
  - İzin kaydında: izin tarihi (Türkiye günü; gelecek olamaz), kanıt (form, kayıt veya belge referansı), kaydeden ve kayıt anı.
  - Çıkış kaydında: ilk çıkış anı ve kaynağı. Kaynak `team` (panel), `reply` (STOP yanıtı veya WhatsApp'ın "pazarlama mesajlarını durdur" seçimi) ya da `meta` (Meta'nın 131050 hatası) olur.
- **Kural:**
  - Çıkış her zaman kazanır.
  - Çıkan numara ancak çıkış gününden sonraki tarihli yeni bir izinle geri döner (Ryzevo ile aynı).
  - Sır değişirse kayıtlar eşleşmez ve gönderim kapanır (güvenli taraf).
- **Gönderim kapısı** (`sendLegacyWhatsApp`):
  - Tekli, toplu ve şablon modlarının hepsinde çalışır. Numaralar tekilleştirilir.
  - Tekli ya da şablonda izin yoksa veya numara çıkmışsa hiçbir şey gönderilmeden 409 döner.
  - Toplu gönderim yalnız izinli numaralara gider. Sonuçta `skipped` (no_consent, opted_out, invalid) ve maskeli `skippedNumbers` yer alır. Hiçbiri izinli değilse 409 döner.
  - Kampanya yürütücüsü atlanan numaraları başarısız sayar ve not düşer. Kampanya düzeyindeki "izin doğrulandı" kutusu yerinde kalır.
- **Panel:** WA & Telegram → WA Bildirim Gönder → "WhatsApp izinleri".
  - Düğmeler: İzni kaydet, Çıkış kaydet, Durumu sorgula.
  - Sayaçlar ve son 10 kayıt gösterilir.
  - API: `/api/messaging/whatsapp/consents` (oturumlu; Ryzevo hesapları middleware'de zaten engelli).
- **131050:** gönderim yanıtında gelirse kayıt edilir; ajan modülü hata kodunu ve numara başına sonucu döndürür. Meta bu hatayı çoğunlukla teslim durumu bildirimiyle sonradan gönderir, o da webhook'tan kaydedilir.

## STOP webhook'u (isteğe bağlı)
- **Adres:** `<NEXT_PUBLIC_APP_URL>/api/messaging/whatsapp/hook`. Middleware'de yalnız bu tam yol oturumsuz geçer.
- **Meta tarafı:** WhatsApp → Configuration → Webhook.
  - Adres ve `WHATSAPP_WEBHOOK_VERIFY_TOKEN` girilir.
  - `messages` ve `user_preferences` alanlarına abone olunur.
  - App secret, `WHATSAPP_APP_SECRET` olarak eklenir.
- **Ayar yoksa:** uç kapalı başlar ve her istek reddedilir.
- **İşlenen olaylar:**
  - Yalnız `WHATSAPP_PHONE_NUMBER_ID` numarasına gelenler.
  - STOP sözcükleri Ryzevo'daki `WHATSAPP_STOP_WORDS` listesinden gelir. Türkçe ve düz küçük harf ikisi de denenir; "İPTAL" de "STOP PROMOTIONS" da tanınır.
  - Mesaj metni, gönderen ve mesaj kimliği saklanmaz.
- **Tek webhook sınırı:** bir Meta uygulamasının tek webhook adresi olur. Crewin numarasının uygulamasında başka bir webhook (ör. backend botu) kullanılıyorsa bunu kurmayın; çıkışları panelden kaydedin.
- **Doğrulanacaklar:**
  - `user_preferences` olayının alan adları Meta'nın güncel belgesine göre yazıldı (`wa_id`, `category: marketing_messages`, `value: stop`); canlıya çıkmadan bir test olayıyla doğrulayın.
  - `wa_id` her zaman telefon numarası olmayabilir; numara olmayan kimlik yok sayılır.

## İYS (1. aşama: WhatsApp)
Crewin, Ryzevo projeleriyle aynı İYS beyanını ve bağlantısını kendi projesinde (`crewin/crewinjob`) kullanır: Proje ayarları → Gönderim izinleri (İYS). Kod: `lib/crewin-iys.ts`; şema değişikliği yok.
- **Beyan yoksa** WhatsApp gönderimi hiç başlamaz (409). "Hayır" beyanında İYS denetimi yapılmaz.
- **"Türkiye" beyanında:**
  - Kapı yalnız +90 numaralara uygulanır (sahibin kararı). Diğer numaralar yalnız yerel izin ve çıkış listesine tabidir.
  - +90 numara İYS onayı ister (`iysGate`): onay yoksa, ret varsa, durum 24 saatten eskiyse ya da İYS bağlı değilse atlanır. Sonuçta `skipped.iys` ve nedeni yer alır.
  - İzin kaydında +90 numaralar için "İzin nasıl alındı?" (HS_* kaynağı) zorunludur. Yeni izinler ONAY olarak kuyruğa girer; 3 iş gününden eskiler giremez, onları "İYS'de sorgula" ile sorgulayın.
  - Çıkışlar (panel, STOP yanıtı, Meta 131050) RET olarak kuyruğa girer ve göndermeyi hemen durdurur.
  - Worker kuyruğu yükler ve İYS'nin değişiklik akışını okur; Crewin için ayrıca bir şey gerekmez.
- **Sorgu:** WhatsApp izinleri bölümündeki "İYS'de sorgula" yazılan +90 numaraları sorar. Proje ayarlarındaki sorgu, İYS'nin daha önce bilgi verdiği numaraları yeniden sorar (en çok 50).
- **Hukuki teyit:** WhatsApp'ın MESAJ sayılması, 3 iş günü kuralı ve "+90 dışı numaralara İYS uygulanmaz" kararı. Ryzevo projeleri bugün bütün numaralara İYS uyguluyor.

## İYS (2. aşama: e-posta)
Kod: `lib/crewin-iys-email.ts`; şema değişikliği yok.
- **Kapsam:**
  - Re-aktivasyon, iş eşleşme ve kampanya e-postaları (`/api/messaging/email/send`, `/send-job-match`) ticari ileti sayılır.
  - İYS onayı, uyruğu TR olan ya da uyruğu bilinmeyen alıcılardan aranır.
  - Şirket ve prospect kitleleri (`maritime_businesses`, `company_prospects`) tacir muafiyetiyle dışarıda kalır. Abonelikten çıkış listesi ve çıkış bağlantısı onlar için de zorunlu.
- **Ölçüm modu (varsayılan):**
  - E-postalar gider.
  - Her gönderim sonucu "İYS zorunlu olsaydı kaç alıcı atlanacaktı" bilgisini nedenleriyle verir.
- **Zorunlu mod:**
  - İYS onayı olmayan, reddetmiş ya da durumu eski alıcı atlanır.
  - Beyan yoksa e-posta gönderimi hiç başlamaz.
- **Mod değişikliği:** Proje ayarları → Gönderim izinleri (İYS) → Crewin e-postası. Yalnız `connections.manage` yetkisi olanlar değiştirebilir; kim ve ne zaman kaydedilir (`data/crewin-iys-email.json`).
- **Bekleyen sorgular:**
  - Durumu bilinmeyen alıcılar şifreli olarak `data/crewin-iys-email-pending.json` dosyasına girer (en çok 50 bin).
  - Worker, "Türkiye" beyanı yapılmış ve İYS bağlıysa her çalışmada en çok 50 adres sorgular.
  - Durumu bilinen alıcıları değişiklik akışı güncel tutar.
- **Kampanyalar:** atlanan alıcılar ve ölçüm sonucu teslimat notuna yazılır.
- **ONAY ve RET bildirimi:**
  - Kayıttaki e-posta izinleri ve backend çıkışları İYS'ye panelin kuyruğuyla bildirilecek. Bunun için backend izin değişikliklerini bir uçtan verecek (`docs/CREWIN-BACKEND-IYS.md`); o uç hazır olana kadar bu izinler bildirilemiyor.
  - Panelin kendi çıkış bağlantısı (prospect, şirket, elle girilen adres) adresi değil yalnız tek yönlü anahtarı taşıdığı için İYS'ye bildirilemez; yerel olarak her zaman uygulanır.
- **Backend Dispatch:** e-posta tek kanallı ve backend şablonu olan kampanyalar normalde backend'in Dispatch'iyle gider (`lib/campaign-dispatch.ts`). Bu gönderimler İYS kapısından geçmez.
  - **Ölçüm modu:** Dispatch aynen çalışır; bu gönderimler ölçüme girmez (kampanya ekranında not var).
  - **Zorunlu mod:** bireysel kitlelerin kampanyaları Dispatch yerine panelin İYS kontrollü gönderimine düşer (`crewinDispatchAllowed`). Doğrudan Dispatch ve yeniden deneme `iys_enforce` hatasıyla reddedilir. Panel tek seferde en çok 500 alıcıya gönderir; fazlası teslimat notunda yazar.
  - Şirket ve prospect kitleleri tacir muafiyetinde olduğu için Dispatch'le gitmeye devam eder.
  - Backend aynı kuralı uygulayınca (`docs/CREWIN-BACKEND-IYS.md` madde 6) bu yönlendirme kaldırılabilir.
- **Zorunlu moda geçmeden önce:** ölçüm çoğunlukla "İYS onayı yok" gösteriyorsa önce mevcut kullanıcılardan izin yenilemesi gerekir (backend, uygulama içinde). 3 iş gününden eski izinler API ile yüklenemiyor.
- **Hukuki teyit:** tacir muafiyeti, uyruğun "Türkiye'deki alıcı" ölçütü olarak kullanılması, iş eşleşme e-postalarının ticari ileti sayılması.

## Testler
İYS kısmı: `test/crewin-iys.test.cjs` (sahte İYS taşıyıcısı). `test/legacy-whatsapp-consent.test.cjs`, `npm run test:platform` ile birlikte çalışır (tek başına: `npm run test:legacy:whatsapp`). Geçici dosya ve sahte gönderici kullanır; ağa çıkmaz. Kapsadıkları:
- numara biçimleri;
- kanıt ve tarih kuralları;
- kapının üç modu;
- çıkıştan sonra yeniden izin kuralı;
- 131050;
- webhook imzası ve doğrulama jetonu;
- STOP sözcükleri, `user_preferences` ve durum olayları;
- kurulum rehberi kartı;
- kaynak kontrolleri (rota, yürütücü, middleware).
