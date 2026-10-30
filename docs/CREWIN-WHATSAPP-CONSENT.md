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

## İYS notu (öneri)
Crewin de ileride Ryzevo'daki İYS beyanını ve kapısını (`docs/SAAS-IYS.md`) almalı. Bu, ayrı ve ayrıca onaylanacak bir adım olur.
- **Neden:**
  - Crewin, Türkiye'deki alıcılara e-posta ve WhatsApp ile ticari ileti gönderiyor.
  - Canlıya çıkış listesinde "İYS kaydı ve ticari ileti izinleri" maddesi zaten var.
- **Bu değişikliğin hazırladığı zemin:**
  - Tüm WhatsApp gönderimi tek kapıdan geçer; İYS kontrolü oraya eklenir.
  - Çıkışlar RET olarak bildirilebilir.
  - İzinlerin tarihi ve kanıtı tutulur.
- **O adımda ayrıca gerekecekler:**
  - "izin nasıl alındı" sorusu (HS_* kaynağı);
  - ONAY yüklemek için numaranın şifreli saklanması;
  - e-posta tarafına da aynı kapı;
  - hukuki teyit (WhatsApp'ın MESAJ sayılması, 3 iş günü kuralı).

## Testler
`test/legacy-whatsapp-consent.test.cjs`, `npm run test:platform` ile birlikte çalışır (tek başına: `npm run test:legacy:whatsapp`). Geçici dosya ve sahte gönderici kullanır; ağa çıkmaz. Kapsadıkları:
- numara biçimleri;
- kanıt ve tarih kuralları;
- kapının üç modu;
- çıkıştan sonra yeniden izin kuralı;
- 131050;
- webhook imzası ve doğrulama jetonu;
- STOP sözcükleri, `user_preferences` ve durum olayları;
- kurulum rehberi kartı;
- kaynak kontrolleri (rota, yürütücü, middleware).
