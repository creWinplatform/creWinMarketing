# Pilot için hesap kontrol listesi

23 Ekim 2026. HSS Digital pilotundan ve gerçek hesap testlerinden önce senin hazırlaman gerekenler. Sıra önemli: her
adım bir sonrakini açar.

**Güvenlik kuralı:** anahtar, gizli değer veya token'ı sohbete yapıştırma. Yereldeyken `crewinjob-web/.env.local`
dosyasına, canlıda sunucudaki `C:\ProgramData\Ryzevo\config\runtime.env` dosyasına kendin yaz. Bana yalnız "yazdım"
demen yeterli; ben değerleri görmeden yalnız var/yok kontrolü yaparım.

Aşağıdaki adreslerde `ORIGIN` canlıda `https://ryzevo.com`, yerel denemede `http://localhost:3033` olur.

## 1. E-posta: Amazon SES (yerelde de denenebilir)

**Hazırla**
- Ryzevo için ayrı bir AWS hesabı (Crewin'inkini kullanma), bir SES bölgesi (örn. `eu-central-1`).
- SES'te `ryzevo.com` alan adı kimliği: 3 DKIM `CNAME` kaydı, SPF, `mail.ryzevo.com` MAIL FROM ve DMARC (`p=none` ile başla). Kayıtları DNS'e ekle.
- SES'i sandbox'tan çıkarma talebi (sandbox'tayken yalnız doğrulanmış adreslere gönderilir; ilk test için kendi adresini doğrulaman yeterli).
- Yalnız `ses:SendEmail` izni olan bir IAM kullanıcısı ve erişim anahtarı.
- Geri dönen e-postalar için bir SNS konusu ve bir yapılandırma kümesi (configuration set).

**Yaz**
- `PLATFORM_AUTH_EMAIL_ENABLED=1`
- `PLATFORM_AUTH_ORIGIN`
- `PLATFORM_AUTH_SES_REGION`
- `PLATFORM_AUTH_SES_ACCESS_KEY_ID`
- `PLATFORM_AUTH_SES_SECRET_ACCESS_KEY`
- `PLATFORM_AUTH_FROM_EMAIL=no-reply@ryzevo.com`
- `SES_SNS_TOPIC_ARN`
- `SES_CONFIGURATION_SET`
- Haftalık özet için ayrıca `PLATFORM_COACH_DIGEST_ENABLED=1`.

**Birlikte deneyeceğiz**
1. Hesap ayarlarından kendi e-postanı doğrula (doğrulama e-postası).
2. Şifre kurtarma e-postası.
3. Haftalık özet e-postası (önce önizleme, sonra tek kişiye gönderim).
4. Sözleşme e-postası: ancak canlı ödeme açıldığında, ilk gerçek satın almada.

## 2. Canlı sunucu: ryzevo.com

`docs/SAAS-WINDOWS-EC2.md` içindeki "ryzevo.com go-live checklist" (7 adım).

**Bende olması gereken**
- EC2 Windows sunucusuna erişim (RDP).
- `ryzevo.com` DNS yönetimi.
- Sunucu dışı yedek için şifreli ve sürümlemeli bir S3 bucket.
- Kesinti bildirimi gidecek bir e-posta adresi.

WhatsApp mesaj bildirimleri, Meta bildirimleri ve HSS daveti bu adım bitmeden çalışmaz: Meta yalnız herkese açık
HTTPS adresine bildirim gönderir, davet bağlantısı da sunucunun adresini taşır.

## 3. Google: Analytics, Search Console, Google Ads

**Hazırla**
- Google Cloud'da bir proje ve OAuth istemcisi (Web application).
- Yetkili yönlendirme adresi: `ORIGIN/api/platform/google/callback`.
- Kullanılan izinler: `analytics.readonly`, `webmasters.readonly`, `adwords`, `openid`, `email`, `profile`. Mobil uygulama kullanılacaksa ayrıca `androidpublisher` ve `firebase.messaging`.
- OAuth onay ekranı: test aşamasında kendi Google hesabını "test user" olarak ekle.
- Google Ads için: Ads API developer token. Yönetici (MCC) hesabı kullanıyorsan onun müşteri numarası.

**Yaz**
- `PLATFORM_GOOGLE_CLIENT_ID`
- `PLATFORM_GOOGLE_CLIENT_SECRET`
- `PLATFORM_GOOGLE_REDIRECT_URI`
- `PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN`
- Gerekiyorsa `PLATFORM_GOOGLE_ADS_LOGIN_CUSTOMER_ID`

**Birlikte deneyeceğiz:** Proje ayarları → Bağlantılar → Google ile bağlan; GA4 ve Search Console'dan bir ölçüm okuma;
Kampanyalar → Reklamlar → Google Ads hesabını bağlayıp yalnız okuma. Harcama kapalı kalır (`PLATFORM_ADS_ENABLED=0`).

## 4. Meta: Facebook sayfası, Instagram, WhatsApp, Meta reklamları

**Hazırla**
- Meta Business hesabı ve bir Meta geliştirici uygulaması (Business türü).
- Facebook Login yönlendirme adresi: `ORIGIN/api/platform/meta/callback`.
- Sayfa ve Instagram için izinler: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`. Gelen kutusu için ayrıca `pages_read_user_content`, `pages_messaging`, `pages_manage_metadata`, `instagram_manage_comments`, `instagram_manage_messages`. Canlıda bunlar Meta uygulama incelemesi ister; geliştirme modunda kendi hesabınla denenebilir.
- Gelen kutusu bildirimleri için webhook adresi: `ORIGIN/api/platform/meta/hooks`. Ayrıca kendin üreteceğin bir doğrulama anahtarı (verify token): 16–200 karakter; harf, rakam, `_` ve `-`.
- **WhatsApp:**
  - Uygulamaya WhatsApp ürününü ekle ve bir işletme numarası ekleyip doğrula.
  - Telefon numarası kimliği (Phone number ID) ve WhatsApp Business hesap kimliği (WABA ID) gerekiyor.
  - `whatsapp_business_messaging` ve `whatsapp_business_management` izinli kalıcı bir sistem kullanıcısı erişim anahtarı oluştur.
  - Meta'da en az bir onaylı şablon olmalı.
- **Meta reklamları:** reklam hesabı kimliği (`act_...`) ve `ads_read` izinli bir erişim anahtarı. Reklam başlatma da denenecekse `ads_management` izni gerekir.

**Yaz**
- `PLATFORM_META_APP_ID`
- `PLATFORM_META_APP_SECRET`
- `PLATFORM_META_REDIRECT_URI`
- `PLATFORM_META_WEBHOOK_VERIFY_TOKEN`

Gönderim anahtarları (`PLATFORM_SOCIAL_PUBLISH_ENABLED`, `PLATFORM_WHATSAPP_SEND_ENABLED`) testten önce kapalı kalır.

**Birlikte deneyeceğiz**
1. Sayfayı ve Instagram hesabını bağla, gelen kutusunu yenile.
2. Kampanyalar → WhatsApp: numarayı bağla, bildirim adresini kur.
   - Ryzevo burada sana bir geri çağırma adresi ve bir doğrulama anahtarı gösterir; ikisini Meta'da numaranın webhook ayarına yazacaksın.
   - Bu ekranda uygulama gizli anahtarını da girmen gerekir.
3. Kendi telefonundan numaraya mesaj at. Mesaj gelen kutusuna düşmeli.
4. Gönderim anahtarı yalnız bu test için açılır. Tek bir yanıt gönderilir, anahtar sonra yeniden kapatılır.
5. Kendi kayıtlı numarana tek kişilik bir şablon pilotu gönderilir. Teslim ve okundu bildirimleri gelmeli, "STOP" yazınca listeden çıkmalısın.
6. Meta reklam hesabını yalnız okuma için bağla. Kampanya oluşturma denenirse kampanya duraklatılmış oluşur ve başlatılmaz.

## 5. LinkedIn: şirket sayfası ve reklamlar

**Hazırla**
- LinkedIn geliştirici uygulaması ve şirket sayfasıyla doğrulanması.
- Yönlendirme adresi: `ORIGIN/api/platform/social/callback`.
- İzinler:
  - Paylaşım için `w_member_social`.
  - Şirket sayfası için `r_organization_admin`, `r_organization_social`, `w_organization_social`. Bunlar Community Management API onayı ister.
- Reklamlar için:
  - Reklam hesabı kimliği ve Advertising API erişimi olan bir erişim anahtarı.
  - Uygulamada LinkedIn API sürümü (YYYYAA biçiminde).

**Yaz**
- `PLATFORM_LINKEDIN_CLIENT_ID`
- `PLATFORM_LINKEDIN_CLIENT_SECRET`
- `PLATFORM_LINKEDIN_REDIRECT_URI`
- `PLATFORM_LINKEDIN_API_VERSION`
- `PLATFORM_LINKEDIN_ADS_VERSION`

**Birlikte deneyeceğiz:** şirket sayfasını bağlama ve yorumları okuma; reklam hesabını yalnız okuma için bağlama.

## 6. X (isteğe bağlı)

- Geliştirici uygulaması.
- Yönlendirme adresi: `ORIGIN/api/platform/x/callback`.
- İzinler: `tweet.read`, `tweet.write`, `users.read`.
- Yanıtları okumak ücretli arama erişimi ister; bu yüzden `PLATFORM_X_INBOX_ENABLED` kapalı kalabilir.

**Yaz:** `PLATFORM_X_CLIENT_ID`, `PLATFORM_X_CLIENT_SECRET`, `PLATFORM_X_REDIRECT_URI`.

## 7. HSS Digital daveti

Canlı sunucu (adım 2) hazır olunca:
- Mevcut tek kullanımlık davet akışıyla HSS sahibine yeni organizasyon daveti oluştururuz.
- Davet bağlantısını HSS'e e-posta dışında, özel bir kanaldan iletirsin. Şifreyi HSS kendi belirler.
- Ekibe `https://ryzevo.com/guide` rehberini gönderirsin.
- İlk hafta: teşhis, brief onayı ve ilk taslaklar. Takıldıkları yerleri rehberin sonundaki biçimde not ederler.
- Pilot boyunca herkese açık kayıt ve ücretli planlar kapalı kalır.
