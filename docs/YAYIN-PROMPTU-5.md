# Yayın promptu 5 (ryzevo.com, 10 Kasım 2026)

İlan botu aktarımından sonra canlıda kalanlar. Bu metni ryzevo.com'u yayınlayan kişiye (veya kod ajanına) olduğu gibi
iletin. Önceki promptlar: `docs/YAYIN-PROMPTU.md` … `docs/YAYIN-PROMPTU-4.md`.

---

Sen ryzevo.com'u yayınlayan ve sunucusunu yöneten geliştiricisin. Depo: `creWinplatform/creWinMarketing`, dal `main`.
Paket aktarımından sonra canlı site 10 Kasım 2026'da yeniden kontrol edildi.

## Canlıda doğrulananlar (teşekkürler)

- Kurulum rehberi: **16 kurulumdan 9'u hazır** (önce 7'ydi).
  - Yönetici şifresi: Hatalı → Hazır.
  - Tarayıcı ve telefon bildirimleri: Eksik → Hazır.
- Telegram kartı paketteki 4 ayarı kabul ediyor. Artık yalnızca `TELEGRAM_CHANNEL_ID` eksik.
- İlan botu: 68 keşfedilmiş grup görünüyor. Kuyruğun boş olması beklenen durum.

## Kurallar

- **Sırlar:** Ayar değerlerini (anahtar, token, kanal kimliği) hiçbir çıktıya, commit'e veya rapora yazma.
- **Canlı veri:** Gerçek gönderim (Telegram, WhatsApp, e-posta, sosyal paylaşım, reklam) ve ödeme yapma. Deneme
  gerekiyorsa "QA-TEST" projesinde, prova modunda yap.
- **Yedek:** Ayar değişikliğinden önce yedek al.

## 1. Worker çalışmıyor (öncelikli)

**Durum:** Proje ayarları → Operasyon → "Zamanlanmış işler (worker)" kartı **Çalışmıyor** diyor.
- Son başarılı çalışma: **8 Kasım 2026 01:03** (kontrol anında yaklaşık 67 saat önce). Birkaç dakikada bir çalışması
  gerekiyor.
- "Zamanlanmış işler anahtarı" (`CRON_SECRET`) Hazır görünüyor, yani eksik olan sunucudaki zamanlayıcı.
- Worker çalışmadığı için zamanlanmış paylaşımlar, kampanya adımları ve otomatik kontroller yürümüyor.

**Yapılacaklar:**
1. 8 Kasım'dan sonra neden durduğunu bul: crontab satırı silindi mi, sunucu veya kullanıcı değişti mi, istek hata mı
   dönüyor?
2. Kartta "Crontab satırı" olarak verilen satırı panelin çalıştığı sunucuda `crontab -e` ile ekle. Biçimi:
   ```
   */5 * * * * curl -fsS -m 55 -X POST -H "x-cron-secret: <CRON_SECRET>" https://ryzevo.com/api/platform/worker > /dev/null
   ```
   `<CRON_SECRET>` yerine sunucudaki değeri koy. Satırı kartın "Kopyala" düğmesinden almak en güvenlisi.
3. Satırı bir kez elle çalıştır; HTTP durumunu kontrol et (değeri yazdırma).
4. Kartta "Yeniden kontrol et"e bas. "Son başarılı çalışma" birkaç dakika öncesini göstermeli ve kart "Hazır"
   olmalı.
5. 15 dakika sonra tekrar bak: zaman ilerlemiş olmalı.

## 2. Telegram kanal kimliği

- Telegram kartı "Eksik ayar: `TELEGRAM_CHANNEL_ID`" diyor. Kanal ve grup duyuruları bu olmadan açılmıyor.
- Hangi kanala duyuru gideceğini proje sahibine sor; kimliği o verecek. Geliştirme bilgisayarında da bu ayar boştu.
- Ekledikten sonra paneli yeniden başlat ve kartın "Hazır" olduğunu doğrula. Deneme mesajı gönderme.

## 3. Hesap gerektiren ayarlar

Aşağıdaki kartlar için ilgili hesaplarda kayıt oluşturulması gerekiyor. Her kartta adım adım ne yapılacağı yazıyor.

| Kart | Ayar adları |
|---|---|
| Hesap e-postaları | `PLATFORM_AUTH_FROM_EMAIL`, `PLATFORM_AUTH_SES_REGION`, `PLATFORM_AUTH_SES_ACCESS_KEY_ID`, `PLATFORM_AUTH_SES_SECRET_ACCESS_KEY`, ardından `PLATFORM_AUTH_EMAIL_ENABLED=1` |
| Geri dönen e-posta ve şikâyet | `SES_CONFIGURATION_SET`, `SES_SNS_TOPIC_ARN` |
| Google (Search Console, GA4) | `PLATFORM_GOOGLE_CLIENT_ID`, `PLATFORM_GOOGLE_CLIENT_SECRET`, `PLATFORM_GOOGLE_REDIRECT_URI` |
| Meta (Facebook Sayfası, Instagram) | `PLATFORM_META_APP_ID`, `PLATFORM_META_APP_SECRET` |
| WhatsApp gönderimi (Crewin) | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_FROM_NUMBER` |

- **Öncelik:** Hesap e-postaları. Bu açılmadan şifre kurtarma çalışmıyor ve `/api/auth/identity` hâlâ
  `emailEnabled:false` dönüyor.
- AWS (SES) hesabına erişimin varsa e-posta kartlarını sen kur. Google, Meta ve WhatsApp için hangi hesaba erişim
  gerektiğini ve kimden ne beklediğini yaz.

## Rapor

1. Worker: neden durmuştu, ne yaptın, kartın yeni durumu ve son başarılı çalışma zamanı (15 dakika arayla iki
   okuma).
2. Telegram: `TELEGRAM_CHANNEL_ID` eklendi mi, kartın durumu.
3. Hesap gerektiren ayarlar: hangileri kuruldu, hangileri kimi bekliyor.
4. Kurulum rehberindeki yeni "x/16 hazır" sayısı.
5. `docs/YAYIN-PROMPTU-3.md`'de istenen ve henüz gelmeyen cevaplar: veritabanı (SQLite mı RDS mi, yedek, konum),
   Node kararı, canlı PayTR'nin durumu (açık/kapalı), mobil, çıkış ve yazma testleri.
