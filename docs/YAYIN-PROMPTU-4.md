# Yayın promptu 4 (ryzevo.com, 10 Kasım 2026)

İlan botu dosyalarının ve Telegram ayarlarının sunucuya aktarılması. Bu metni ryzevo.com'u yayınlayan kişiye (veya kod
ajanına) olduğu gibi iletin. Paket (`ryzevo-transfer.zip`) ayrıca gönderilecek.
Önceki promptlar: `docs/YAYIN-PROMPTU.md`, `docs/YAYIN-PROMPTU-2.md`, `docs/YAYIN-PROMPTU-3.md`.

---

Sen ryzevo.com'u yayınlayan ve sunucusunu yöneten geliştiricisin. Depo: `creWinplatform/creWinMarketing`, dal `main`.
Sana `ryzevo-transfer.zip` adlı bir paket gönderildi. İçinde geliştirme bilgisayarındaki ilan botu (`crewinjob-agent`)
dosyaları ve Telegram ayarları var. Bunları sunucuya aktar ve sonucu raporla.

## Kurallar

- **Sırlar:** Paketteki ayar değerlerini (token, anahtar, oturum) hiçbir çıktıya, commit'e veya rapora yazma. Paketi ve
  içindeki dosyaları depoya ekleme. Raporda yalnızca ayar adlarını ve durumlarını yaz.
- **Yedek:** Sunucudaki dosyaların ve ayarların yedeğini almadan hiçbir şeyin üzerine yazma.
- **Canlı veri:** Gerçek gönderim (Telegram, WhatsApp, e-posta, sosyal paylaşım) yapma. Gerekirse yalnızca "QA-TEST"
  projesinde, prova modunda dene.

## Paketin içeriği

```
ryzevo-transfer/
  new-settings.env               4 satır, ADI=değer
  crewinjob-agent/
    .env                         ajanın kendi ayar dosyası
    .userbot-config.json         Telegram kullanıcı botu ayarları
    .userbot-groups.json         grup listesi
    job-queue.json               ilan kuyruğu (boş dizi)
    data/                        10 dosya (grup istatistikleri, yayın kaydı, ardışık iş durumu vb.)
    output/                      23 dosya
    logs/                        35 dosya
```

`new-settings.env` içindeki ayar adları:
- `TELEGRAM_BOT_TOKEN`
- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION`

## 1. Ajan dosyalarını aktar

1. Zip'i sunucuda geçici bir klasöre aç.
2. Panelin okuduğu `crewinjob-agent` klasörünü bul ve yedeğini al.
3. Paketteki `crewinjob-agent/` içeriğini oraya kopyala:
   - `data/`, `output/`, `logs/`, `job-queue.json`, `.userbot-groups.json`: sunucuda yoksa kopyala. Varsa sunucudakini
     koru; paketteki dosyalar daha yeniyse ve sunucudakiler boşsa paketinkini kullan.
   - `.env` ve `.userbot-config.json`: sunucuda zaten varsa **üzerine yazma**. Alanları karşılaştır; yalnızca sunucuda
     eksik veya boş olanları paketten ekle.
4. Dosya sahibi ve izinleri, panelin ve ajanın çalıştığı kullanıcıyla aynı olsun.

## 2. Ayarları ekle

1. `new-settings.env` içindeki 4 satırı panelin ve ajanın okuduğu ayar kaynağına ekle (ayar dosyası veya servis ortam
   değişkenleri; hangisini kullanıyorsan).
2. Aynı ad sunucuda zaten tanımlıysa üzerine yazmadan önce karşılaştır. Farklıysa hangisinin doğru olduğunu bildir,
   değeri yazma.
3. Paneli ve ajanı yeniden başlat.

## 3. Doğrula

- **Kurulum rehberi** (Proje ayarları → Operasyon): Telegram kartının yeni durumu ne? Hâlâ eksikse kartın istediği
  ayarların adlarını yaz.
  - `TELEGRAM_CHANNEL_ID` geliştirme bilgisayarında da boştu; pakette yok. Kart bunu istiyorsa raporda belirt.
- **İlan botu sekmesi:** Ajan çalışıyor mu, son çalışma zamanı ne?
  - Kuyruğun boş görünmesi beklenen durum: geliştirme bilgisayarındaki `job-queue.json` da boş bir dizi.
- **Kayıtlar:** Ajan ve panel kayıtlarında Telegram oturumu veya bot ile ilgili hata var mı? Hata metnini, içinde
  değer geçmeyecek şekilde aktar.

## 4. Pakette olmayan ayarlar

Aşağıdakiler geliştirme bilgisayarında da tanımlı değil, bu yüzden pakette yok. İlgili hesaplarda oluşturulmaları
gerekiyor:

| Kurulum kartı | Ayar adları |
|---|---|
| Hesap e-postaları | `PLATFORM_AUTH_FROM_EMAIL`, `PLATFORM_AUTH_SES_REGION`, `PLATFORM_AUTH_SES_ACCESS_KEY_ID`, `PLATFORM_AUTH_SES_SECRET_ACCESS_KEY`, ardından `PLATFORM_AUTH_EMAIL_ENABLED=1` |
| Geri dönen e-posta ve şikâyet | `SES_CONFIGURATION_SET`, `SES_SNS_TOPIC_ARN` |
| Google | `PLATFORM_GOOGLE_CLIENT_ID`, `PLATFORM_GOOGLE_CLIENT_SECRET` |
| Meta | `PLATFORM_META_APP_ID`, `PLATFORM_META_APP_SECRET` |
| WhatsApp | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_FROM_NUMBER` |
| Telegram kanalı | `TELEGRAM_CHANNEL_ID` |

Hangilerini kendin oluşturabileceğini, hangileri için kimden ne beklediğini yaz.

## Rapor

1. Aktarılan dosyalar: hangileri kopyalandı, hangileri sunucuda zaten vardı ve korundu.
2. Eklenen ayarlar: ad listesi; çakışma olduysa hangi adda.
3. Kurulum rehberindeki yeni "x/16 hazır" sayısı ve Telegram kartının durumu.
4. İlan botu: ajan çalışıyor mu, kayıtlarda hata var mı.
5. 4. bölümdeki ayarlar için plan.
6. `docs/YAYIN-PROMPTU-3.md`'de istenen ve henüz gelmeyen rapor (sunucu ayarları, veritabanı, Node, canlı ödeme,
   testler).
