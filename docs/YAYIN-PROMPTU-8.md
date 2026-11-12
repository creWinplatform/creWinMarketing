# Yayın promptu 8 (ryzevo.com, 12 Kasım 2026)

`docs/YAYIN-PROMPTU-7.md`'ye ek. İkisini birlikte uygula. Bu metni ryzevo.com'u yayınlayan kişiye (veya kod ajanına)
olduğu gibi iletin.

---

Sen ryzevo.com'u yayınlayan ve sunucusunu yöneten geliştiricisin. Depo: `creWinplatform/creWinMarketing`, dal `main`,
uygulama `crewinjob-web`.

## Kurallar

- **Sırlar:** Ayar değerlerini (anahtar, şifre, token) hiçbir çıktıya, commit'e veya rapora yazma.
- **Canlı veri:** Yazma testlerini yalnızca QA-TEST projesinde yap. Gerçek gönderim ve ödeme yapma.
- **Yedek:** Ayar değişikliğinden önce yedek al.

## 1. Yayınlanacak kod

`main`'in son hâlini yayınla. 7. prompttaki `476e6fe`'ye ek olarak yeni commit **`fix(library,coach)`**:
- **Crewin içerik kütüphanesi:** Aynı içerik iki sekmede düzenlenince ikinci kayıt ilkini silmiyor; çakışma uyarısı
  gösteriyor. Ayrıca kaydetme hatası artık ekranda görünüyor (önceden sessizce yutuluyordu).
- **Marka dili:** AI önerisi başarısız olunca "Başlangıç şablonuyla hazırla" düğmesi çıkıyor. Rakip karşılaştırmasında
  da aynı şekilde.
- **Sunucu kaydı:** AI çağrısı başarısız olunca nedeni sunucu kaydına
  `platform_coach_ai_failed {"name":…,"message":…}` olarak yazılıyor. Anahtar ve token biçimindeki değerler
  maskeleniyor.
- Veritabanında şema değişikliği yok.

## 2. AI anahtarı geçersiz: marka dili 502'sinin büyük ihtimalle nedeni

**Geliştirme bilgisayarındaki bulgu:**
- `PLATFORM_GEMINI_API_KEY` 15 karakterlik bir yer tutucu; Google "API key not valid" diyor.
- Ajanın kullandığı `GEMINI_API_KEY` ise geçerli ve çalışıyor.
- Kurulum rehberindeki "AI modeli" kartı yalnızca anahtarın var olup olmadığına baktığı için "Hazır" görünüyor.

**Yapılacaklar:**
1. Sunucudaki `PLATFORM_GEMINI_API_KEY`'in geçerli bir Gemini API anahtarı olduğunu kontrol et (genellikle `AIza` ile
   başlar ve 39 karakterdir). Değilse geçerli bir anahtar koy ve paneli yeniden başlat.
   - `PLATFORM_GEMINI_MODEL` `gemini-2.5-flash` olabilir; bu model çalışıyor.
2. Proje ayarları → Operasyon → "AI modeli" kartında **"Dene"**ye bas; anahtarın tanındığını doğrula.
3. QA-TEST projesinde Proje ayarları → Marka dili & rakipler:
   - iki zorunlu alanı doldur ve "AI ile marka dili öner"e bas;
   - bir taslak gelmeli;
   - test bitince taslağı ürün profiline uygulama.
4. Hâlâ hata verirse sunucu kaydında `platform_coach_ai_failed` satırını bul ve değer içermeyecek şekilde raporla.

## 3. Doğrulama: Crewin içerik kütüphanesi

Crewin çalışma alanında **gerçek içerik var**:
- Yalnızca kendi oluşturduğun bir test içeriğiyle dene, gerçek içeriklere dokunma.
- Test içeriği oluşturamıyorsan bu adımı atla ve raporda belirt.

Adımlar:
1. İçerik kütüphanesinde test içeriğini iki sekmede "Düzenle" ile aç.
2. A sekmesinde kaydet.
3. B sekmesinde kaydetmeyi dene.
   - Beklenen: B'de çakışma uyarısı çıkar, düzenleme kutusu açık kalır ve A'nın metni korunur.
4. Test içeriğini sil.

## Rapor

1. Yayınlanan commit'ler.
2. AI anahtarı: geçerli miydi, ne değişti, "Dene" sonucu, marka dili önerisi çalıştı mı.
3. Kütüphane çakışma doğrulaması (yaptıysan).
4. 7. prompttaki maddelerin raporu.
