# Yayın promptu 2 (ryzevo.com, 10 Kasım 2026)

İlk yayından sonra yapılan canlı testin bulguları. Bu metni ryzevo.com'u yayınlayan kişiye (veya kod ajanına) olduğu
gibi iletin. İlk prompt: `docs/YAYIN-PROMPTU.md`.

---

Sen ryzevo.com'u yayınlayan ve sunucusunu yöneten geliştiricisin. Depo: `creWinplatform/creWinMarketing`, dal `main`,
uygulama `crewinjob-web` (Next.js 15). 10 Kasım 2026'da, son yayından sonra canlı site yeniden test edildi.

Hız düzeltmesi ve "Ne yapmak istiyorsunuz?" penceresinin erişilebilirliği canlıda doğrulandı, teşekkürler. Aşağıdakiler
kaldı. Her maddeyi bitirince doğrula; sonunda kısa bir rapor ver.

## Kurallar

- **Canlı veri:** Canlı Crewin çalışma alanında gerçek müşteri verisi var.
  - Yazma testlerini yalnızca "QA-TEST" test projesinde yap.
  - Gerçek gönderim (e-posta, WhatsApp, sosyal paylaşım, reklam) ve ödeme yapma.
- **Sırlar:** Ayar değerlerini (şifre, anahtar) hiçbir çıktıya, commit'e veya rapora yazma.
- **Yedek:** Değişikliklerden önce veritabanının yedeğini al.

## 1. Bir sekme yüklenemeyince uygulamanın tamamı çöküyor (öncelikli)

**Sorun:**
- Giriş yapılmış Crewin çalışma alanında İlan botu sekmesi açılırken
  `/_next/static/chunks/3318.85758d31c0c1ddc9.js` bir kez indirilemedi. Konsoldaki hata:
  `ChunkLoadError: Loading chunk 3318 failed`.
- Sayfanın tamamı "Application error: a client-side exception has occurred" ekranına düştü. Yan menü kayboldu,
  tarayıcı sekmesi dondu. Kullanıcıya yeniden deneme imkânı verilmedi.
- Sayfayı yenileyince düzeldi ve dosya şu an 200 dönüyor. Neden büyük ihtimalle tek seferlik bir ağ kesintisi ya da
  o sırada yapılan bir dağıtım (eski sürümün dosyaları silinmiş olabilir).

**Mevcut durum:**
- `app/page.tsx` sekmeleri `next/dynamic` ile ayrı ayrı yüklüyor (20 `dynamic()` çağrısı).
- Projede hiç hata sınırı (error boundary) yok: `app/error.tsx`, `app/global-error.tsx` veya `componentDidCatch`
  kullanan bir bileşen bulunmuyor.

**Yapılacaklar:**
1. **Sekme hata sınırı:**
   - Her sekmeyi bir hata sınırıyla sar (ör. `components/TabErrorBoundary.tsx`).
   - Bir sekme çökerse yalnızca o sekmenin alanında bir hata kartı görünsün:
     - TR: "Bu bölüm yüklenemedi." / EN: "This section could not be loaded."
     - Bir "Tekrar dene" düğmesi; basınca sınırı sıfırlasın ve sekmeyi yeniden yüklesin.
   - Menü, üst bar ve diğer sekmeler çalışmaya devam etsin.
   - Metinleri `lib/i18n` üzerinden TR/EN ekle; düzene göre `node scripts/i18n-pairs.cjs` ve `npm run test:i18n`.
2. **Kod dosyası yükleme hatası (ChunkLoadError):**
   - `dynamic(() => import(...))` çağrılarını küçük bir yardımcıyla sar: indirme başarısız olursa kısa bir
     beklemeden sonra bir kez daha denesin.
   - Yine başarısız olursa ve hata `ChunkLoadError` ise sayfayı bir kez kendiliğinden yenile.
   - Sonsuz yenileme döngüsü olmasın: `sessionStorage`'a yenileme zamanını yaz, 60 sn içinde ikinci kez yenileme
     yapma. Bunun yerine hata kartını göster.
3. **Uygulama genelinde son çare:**
   - `app/error.tsx` ve `app/global-error.tsx` ekle. "Application error" yerine markalı, TR/EN bir ekran çıksın:
     "Bir şeyler ters gitti", "Sayfayı yenile" ve "Genel bakışa dön" düğmeleriyle.
   - Hata ayrıntısı kullanıcıya gösterilmesin; yalnızca konsola yazılsın.
4. **Dağıtım:**
   - Dağıtım sırasında eski sürümün `_next/static` dosyalarının hemen silinip silinmediğini kontrol et.
   - Mümkünse bir önceki sürümün statik dosyalarını bir süre (ör. 24 saat) sakla.

**Doğrulama:**
- **Yerelde üretim derlemesiyle** (`next build && next start`):
  - DevTools'ta bir sekmenin chunk dosyasını engelle (Network → Block request URL) ve o sekmeyi aç:
    - yalnızca o sekmede hata kartı görünmeli;
    - menü ve diğer sekmeler çalışmalı;
    - engeli kaldırıp "Tekrar dene"ye basınca sekme yüklenmeli;
    - sayfa en fazla bir kez kendiliğinden yenilenmeli.
  - Bir sekmenin içinde bilerek hata fırlat (geçici bir test). Uygulamanın geri kalanı ayakta kalmalı. Testten sonra
    geçici kodu kaldır.
- **Testler:** `npm run test:platform`, `npm run test:i18n`, `npx tsc --noEmit`.

## 2. Sunucu ayarları (yayından sonra değişmedi)

Proje ayarları → Operasyon → Kurulum rehberi hâlâ "16 kurulumdan 7'si hazır" diyor. Her kartta ne yazılacağı adım
adım anlatılıyor.

| Kart | Durum |
|---|---|
| Yönetici şifresi | Hatalı |
| Hesap e-postaları (doğrulama, şifre sıfırlama, uyarılar) | Eksik |
| Google (Search Console, GA4) | Eksik |
| Meta (Facebook Sayfası, Instagram) | Eksik |
| WhatsApp gönderimi (Crewin) | Eksik |
| Telegram (kanal ve grup duyuruları) | Eksik |
| Geri dönen e-posta ve şikâyet bildirimi | Eksik |
| Tarayıcı ve telefon bildirimleri | Eksik |

- **Hesap e-postaları:** Bu açılmadan şifre kurtarma çalışmıyor; şifresini unutan kullanıcı kendi başına giremiyor.
  Bu yüzden önceliklidir.

## 3. İlan botu kuyruğu

Canlıda kuyruk hâlâ tamamen boş (0 toplam, 0 bekleyen, 0 yayında, 0 hata). Ajanın kuyruk ve ilan dosyaları
(`crewinjob-agent`) sunucuda var mı ve panel doğru yolu mu okuyor, kontrol et. Bilerek boşsa raporda öyle yaz.

## 4. Veritabanı

1. Canlıda hangi veritabanının kullanıldığını bildir: SQLite mı, `PLATFORM_DATABASE_PROVIDER=mssql` ile RDS mi?
2. RDS kullanılıyorsa:
   - **Yedek ve kurtarma:** Mevcut yedek, geri yükleme testi ve kurtarma betikleri yalnızca SQLite dosyasını
     kapsıyor. SQL Server için de olmalı: RDS otomatik snapshot ve saklama süresi, düzenli geri yükleme denemesi,
     şifreli alanların doğrulanması (`docs/SAAS-MSSQL.md`, Aşama 3).
   - **Crewin JSON ve ajan dosyaları:** `data/*.json` ve `crewinjob-agent` dosyaları hâlâ diskte duruyor,
     tablolara taşınmadı (Aşama 2). Planını bildir.
   - **Konum:** Panel RDS ile aynı AWS bölgesinde (eu-west-1) çalışmalı; aksi halde her sorgu ekstra gecikme taşır.
     Panelin nerede çalıştığını bildir.

## 5. Geliştirme bilgisayarı: Node sürümü

`package.json`'daki `better-sqlite3` ^12 sürümü Node 20 / Windows'ta kurulamıyor (hazır derleme yok, derleyici yok).
Geliştirme bilgisayarındaki panel bu yüzden kapalı. İki seçenek var:
- geliştirme ortamı Node 24'e geçecek;
- ya da `better-sqlite3`, Node 20 ile hazır derlemesi olan bir sürüme sabitlenecek.

Kararını ve neden o seçeneği seçtiğini bildir.

## 6. Canlı ödeme

Satış sözleşmesi ve aydınlatma metni (`lib/platform/sales-terms.ts`) doldurulup hukuken onaylanana kadar canlı PayTR
(`PLATFORM_PAYTR_LIVE_ENABLED`) kapalı kalmalı. Şu anki değerini (açık veya kapalı) raporla. Değeri yazma.

## 7. Küçük SEO düzeltmesi

`/?lang=en` sayfası sunucudan ilk geldiğinde `<html lang="tr">` ile geliyor, tarayıcıda sonradan "en" oluyor.
Kök layout, `?lang` parametresine (yoksa çereze) göre `lang` değerini sunucu tarafında doğru basmalı.

**Doğrula:** `curl -s "https://ryzevo.com/?lang=en" | grep -o '<html[^>]*>'` çıktısı `lang="en"` göstermeli.

## 8. Bekleyen test raporu

Önceki istekteki testlerin sonuçları henüz gelmedi. "QA-TEST" projesinde şunları yap:
- **Mobil görünüm:** 390×844 ve 768×1024. Genel bakış, Sosyal medya, İçerik kütüphanesi, Kampanyalar, Takvim,
  Analitik ve Proje ayarları. Yatay kaydırma, taşan öğe, küçük dokunma hedefi, yan menü, açık ve koyu tema.
- **Çıkış:** Çıkış yap. Geri tuşuyla ve doğrudan adresle `/?tab=project`'e git; giriş sayfasına yönlendirilmelisin.
  `/api/workspace` 401 dönmeli. Tekrar giriş yap; istenen sekmeye dönülmeli.
- **Yazma:**
  - "QA-TEST" adlı içerik taslağı oluştur, düzenle, kaydet, yenile.
  - Aynı taslağı iki sekmede açıp çakışma uyarısını dene.
  - Takvimde görev oluştur ve sil.
  - Kampanya taslağını "prova"ya kadar ilerlet; gerçek gönderim yapma.
  - Marka dilini değiştir ve geri al.
  - Sonunda bütün "QA-TEST" kayıtlarını sil.

## Rapor

1. Yapılan değişiklikler ve commit'leri (madde numarasıyla).
2. Hata sınırının yerel doğrulaması, mümkünse ekran görüntüsüyle.
3. Sunucu ayarları: hangi kartların durumu değişti, hangileri neden kaldı.
4. İlan kuyruğu, veritabanı (hangisi, yedek, konum), Node kararı ve canlı PayTR'nin durumu.
5. Test sonuçları: mobil, çıkış ve yazma. Her bulgu için adımlar, beklenen, gerçekleşen ve ekran görüntüsü.
6. Yapılamayanlar ve nedenleri.
