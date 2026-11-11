# Yayın promptu 7 (ryzevo.com, 11 Kasım 2026)

QA-TEST projesindeki yazma testlerinin bulguları ve yayınlanacak düzeltme. Bu metni ryzevo.com'u yayınlayan kişiye
(veya kod ajanına) olduğu gibi iletin. Önceki promptlar: `docs/YAYIN-PROMPTU.md` … `docs/YAYIN-PROMPTU-6.md`.

---

Sen ryzevo.com'u yayınlayan ve sunucusunu yöneten geliştiricisin. Depo: `creWinplatform/creWinMarketing`, dal `main`,
uygulama `crewinjob-web`. 11 Kasım 2026'da canlı site test edildi:
- okuma testleri Crewin çalışma alanında yapıldı;
- yazma testleri yeni açılan **QA-TEST** projesinde (`qa-test` kullanıcısı) yapıldı;
- test kayıtları silindi.

## Kurallar

- **Sırlar:** Ayar değerlerini (şifre, anahtar, token) hiçbir çıktıya, commit'e veya rapora yazma.
- **Canlı veri:** Yazma testlerini yalnızca QA-TEST projesinde yap. Gerçek gönderim (e-posta, WhatsApp, Telegram, sosyal
  paylaşım, reklam) ve ödeme yapma.
- **Yedek:** Ayar veya veritabanı değişikliğinden önce yedek al.

## 1. Yayınlanacak kod: taslak çakışma uyarısı

`main`'in son hâlini yayınla. Yeni commit: **`fix(drafts)`**.

**Sorun:**
- Aynı taslak iki sekmede düzenlendiğinde ikinci kayıt ilkini uyarısız siliyordu.
- Örnek: A sekmesinde kaydedilen değişiklik, B sekmesinden kaydedilince kayboluyordu.

**Düzeltme:**
- Düzenleme ekranı açıldığı sürümü (`updatedAt`) kaydederken gönderiyor. Sunucu, taslak o arada değiştiyse kaydı 409 ile
  reddediyor ve kullanıcı uyarıyı görüyor:
  "Bu taslak siz düzenlerken başka bir yerde değiştirildi…"
- İçerik taslakları ve kampanya taslakları için geçerli.
- Veritabanında şema değişikliği yok.

**Yayından sonra doğrula (QA-TEST projesinde):**
1. İçerik kütüphanesinde "QA-TEST çakışma" adlı bir taslak oluştur.
2. Taslağı iki sekmede "Düzenle" ile aç.
3. A sekmesinde metni değiştirip kaydet.
4. B sekmesinde metni değiştirip kaydetmeyi dene.
   - Beklenen: B'de çakışma uyarısı çıkar ve A'nın değişikliği korunur.
   - Sayfayı yenile; içerik A'nın metni olmalı.
5. Aynısını bir kampanya taslağıyla dene (Kampanyalar → Yeni taslak). Gönderme.
6. Test taslaklarını sil.

## 2. Yönetici şifresi yeniden "Hatalı"

**Durum:**
- Kurulum rehberindeki "Yönetici şifresi" kartı 10 Kasım akşamı "Hazır"dı. 11 Kasım'da yeniden **Hatalı**.
  Kurulum sayısı 10/16'dan 9/16'ya düştü.
- Kartın açıklaması: "Yönetici şifresi 16 karakterden kısa."
- Sunucudaki `ADMIN_PASSWORD` daha kısa bir değere dönmüş görünüyor. Muhtemelen son yayında ortam değişkenleri eski
  hâline geri yüklendi.

**Yapılacaklar:**
1. Ortam değişkenlerinin nereden yüklendiğini kontrol et. Yayın sırasında eski bir dosya veya şablon üzerine yazıyor mu?
2. Kartın istediği koşulu sağla, paneli yeniden başlat ve kartın "Hazır" olduğunu doğrula.
3. Bir sonraki yayında ayarların korunduğunu doğrula.

## 3. AI ile marka dili önerisi 502 dönüyor

**Adımlar (QA-TEST):** Proje ayarları → Marka dili & rakipler → "Markanız nasıl konuşur?" ve "Nasıl konuşmaz?"
alanlarını doldur → "AI ile marka dili öner".

**Beklenen:** Önerilen bir marka dili metni.

**Gerçekleşen:**
- `POST /api/platform/coach/brand` **502** dönüyor. Ekranda: "AI önerisi hazırlanamadı. Başlangıç şablonunu
  kullanabilir veya tekrar deneyebilirsiniz."
- Kurulum rehberinde "AI modeli (Google aramalı Gemini)" kartı Hazır görünüyor.

**Yapılacaklar:**
1. Sunucu kayıtlarında bu isteğin hatasını bul (`lib/platform/coach-ai.ts`, `runCoachAi`). Gemini çağrısı mı
   başarısız, kota mı, model adı mı?
   - Hata metnini değer veya anahtar içermeyecek şekilde raporla.
2. Düzelt ve aynı adımlarla doğrula.
3. Hata mesajı bir "başlangıç şablonu"ndan bahsediyor ama ekranda öyle bir düğme yok. Şablonun neden görünmediğini
   kontrol et ve bildir; gerekiyorsa kodu düzelt.

## 4. Telegram userbot durdurulmuş

- "Telegram botu" sekmesinde userbot **Durduruldu** görünüyor. 62 izlenen grup var ama bu oturumda katılım, tespit
  edilen ilan ve gönderilen mesaj sayıları 0.
- "Otomasyon" sekmesinde akış sunucuda hiç çalışmamış (başlama ve bitiş zamanı yok).
- Önceki raporunda grup okumanın çalıştığı yazıyordu.

Kontrol et:
- userbot sunucuda bir süreç olarak çalışıyor mu? Yeniden başlatmada otomatik kalkıyor mu?
- Durdurulması bilinçli mi?

Gruplara mesaj gönderen bir işlemi başlatma; yalnızca durumu raporla.

## 5. Bekleyen sorular (`docs/YAYIN-PROMPTU-6.md`)

- Hesap e-postaları (SES): `emailEnabled` hâlâ `false`.
- Google, Meta ve WhatsApp kartları.
- Node kararı ve canlı PayTR'nin durumu (açık/kapalı; değeri yazma).

Telegram kanalı bilerek kapalı; `TELEGRAM_CHANNEL_ID` eklemene gerek yok.

## Rapor

1. Yayınlanan commit ve 1. bölümdeki doğrulamanın sonucu (içerik ve kampanya için ayrı ayrı).
2. Yönetici şifresi: neden geri döndü, kartın yeni durumu, kurulum sayısı.
3. AI marka dili: hatanın nedeni ve düzeltme.
4. Telegram userbot: durumu ve neden durduğu.
5. 5. bölümdeki maddeler.
