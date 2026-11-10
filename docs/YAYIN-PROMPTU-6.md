# Yayın promptu 6 (ryzevo.com, 10 Kasım 2026)

Worker düzeltmesinden sonra canlıda kalanlar. Bu metni ryzevo.com'u yayınlayan kişiye (veya kod ajanına) olduğu gibi
iletin. Önceki promptlar: `docs/YAYIN-PROMPTU.md` … `docs/YAYIN-PROMPTU-5.md`.

---

Sen ryzevo.com'u yayınlayan ve sunucusunu yöneten geliştiricisin. Depo: `creWinplatform/creWinMarketing`, dal `main`.
Son yayından sonra, 10 Kasım 2026 20:35'te canlı site yeniden kontrol edildi.

## Canlıda doğrulananlar (teşekkürler)

- **Worker:** "Zamanlanmış işler (worker)" kartı Hazır. Son başarılı çalışma 20:33.
- **Kurulum rehberi:** 16 kurulumdan 10'u hazır (önce 9'du).

## Kurallar

- **Sırlar:** Ayar değerlerini (anahtar, token, kanal kimliği) hiçbir çıktıya, commit'e veya rapora yazma. Yalnızca
  ayar adlarını ve kart durumlarını bildir.
- **Canlı veri:** Gerçek gönderim (Telegram, WhatsApp, e-posta, sosyal paylaşım, reklam) ve ödeme yapma. Deneme
  gerekiyorsa "QA-TEST" projesinde, prova modunda yap. E-posta denemesini yalnızca kendi adresine gönder.
- **Yedek:** Ayar değişikliğinden önce yedek al.

## 1. Telegram kanal kimliği canlıya yansımadı

**Durum:** Telegram kartı hâlâ "Eksik" ve "Eksik ayar: `TELEGRAM_CHANNEL_ID`" diyor.

**Kontrol et:**
1. **Yer:** Ayar panelin okuduğu ortam değişkenlerinde mi? Kart bu ayarı sunucu ortam değişkenlerinde arıyor;
   yalnızca `crewinjob-agent/.env` dosyasına yazılması yetmiyor. Panel bir servis yöneticisiyle (systemd, PM2,
   Docker vb.) çalışıyorsa ayarın o servisin ortamında olduğunu doğrula.
2. **Ad:** Adı tam olarak `TELEGRAM_CHANNEL_ID` mı? Başında veya sonunda boşluk, tırnak var mı?
3. **Biçim:** Değer `@kanaladı` ya da `-100…` ile başlayan sayısal kimlik olmalı.
4. **Yeniden başlatma:** Panel ayar eklendikten sonra yeniden başlatıldı mı? Ayarlar yalnızca açılışta okunuyor.
5. **Bot yetkisi:** Bot kanala yönetici olarak eklendi mi?

**Doğrula:** Kurulum rehberinde Telegram kartı "Hazır" olmalı. Deneme mesajı gönderme.

## 2. Hesap e-postaları (öncelikli)

**Durum:** "Hesap e-postaları" ve "Geri dönen e-posta ve şikâyet bildirimi" kartları Eksik. `/api/auth/identity`
`emailEnabled:false` dönüyor. Bu yüzden şifresini unutan kullanıcı kendi başına giremiyor ve giriş sayfasında
"Şifremi unuttum" bağlantısı gizli.

**Yapılacaklar** (kartlarda adım adım anlatılıyor):
1. AWS SES'te gönderici alan adını veya adresini doğrula. Hesap deneme (sandbox) modundaysa üretim erişimi iste.
2. Ayarlar:
   - `PLATFORM_AUTH_FROM_EMAIL`
   - `PLATFORM_AUTH_SES_REGION`
   - `PLATFORM_AUTH_SES_ACCESS_KEY_ID`
   - `PLATFORM_AUTH_SES_SECRET_ACCESS_KEY`
   - Dördü de tanımlandıktan sonra `PLATFORM_AUTH_EMAIL_ENABLED=1`
3. Geri dönen e-posta ve şikâyet bildirimi:
   - `SES_CONFIGURATION_SET`
   - `SES_SNS_TOPIC_ARN`
4. Paneli yeniden başlat.

**Doğrula:**
- İki kart da "Hazır" olmalı.
- `/api/auth/identity` `emailEnabled:true` dönmeli.
- Giriş sayfasında "Şifremi unuttum" görünmeli ve `/recover` form göstermeli.
- Kendi adresinle bir şifre sıfırlama e-postası iste; e-posta gelmeli.

## 3. Google, Meta ve WhatsApp

Bu kartlar ilgili hesaplarda kayıt gerektiriyor. Her kartta adım adım ne yapılacağı ve hangi dönüş adresinin
kullanılacağı yazıyor.

| Kart | Ayar adları |
|---|---|
| Google (Search Console, GA4) | `PLATFORM_GOOGLE_CLIENT_ID`, `PLATFORM_GOOGLE_CLIENT_SECRET`, `PLATFORM_GOOGLE_REDIRECT_URI` |
| Meta (Facebook Sayfası, Instagram) | `PLATFORM_META_APP_ID`, `PLATFORM_META_APP_SECRET` |
| WhatsApp gönderimi (Crewin) | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_FROM_NUMBER` |

- Hangi hesaplara erişimin olduğunu yaz.
- Erişimin olanları kur, kartın "Dene" düğmesiyle doğrula.
- Erişimin olmayanlar için kimden neye ihtiyacın olduğunu yaz: hesap, rol, onay.

## 4. Hâlâ cevap bekleyen sorular

`docs/YAYIN-PROMPTU-3.md`'de istenen ve henüz gelmeyenler:
1. **Veritabanı:**
   - Canlı SQLite mı kullanıyor, `PLATFORM_DATABASE_PROVIDER=mssql` ile RDS mi?
   - RDS ise: yedekleme ve saklama süresi, son geri yükleme denemesi, panelin çalıştığı bölge.
2. **Node:** Geliştirme bilgisayarı Node 24'e mi geçecek, `better-sqlite3` Node 20 ile çalışan bir sürüme mi
   sabitlenecek?
3. **Canlı ödeme:** `PLATFORM_PAYTR_LIVE_ENABLED` açık mı, kapalı mı? Değeri değil, yalnızca durumu yaz.
4. **Testler** ("QA-TEST" projesinde):
   - mobil görünüm (390×844 ve 768×1024);
   - çıkış ve yeniden giriş;
   - yazma işlemleri ve sonunda temizlik.

## Rapor

1. Telegram: sorun neydi, kartın yeni durumu.
2. Hesap e-postaları: kartların durumu, `emailEnabled` değeri, şifre sıfırlama e-postası geldi mi.
3. Google, Meta, WhatsApp: kurulanlar ve kimi bekleyenler.
4. Kurulum rehberindeki yeni "x/16 hazır" sayısı.
5. 4. bölümdeki sorulara cevaplar ve test sonuçları. Her bulgu için adımlar, beklenen, gerçekleşen ve ekran
   görüntüsü.
