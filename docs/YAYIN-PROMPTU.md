# Yayın ve düzeltme promptu (ryzevo.com)

Bu metni ryzevo.com'u yayınlayan kişiye (veya onun kullandığı kod ajanına) olduğu gibi iletin.

---

Sen ryzevo.com'u yayınlayan ve sunucusunu yöneten geliştiricisin. Depo: `creWinplatform/creWinMarketing`, dal `main`,
uygulama `crewinjob-web` (Next.js 15). 9–10 Kasım 2026'da canlı site giriş yapmadan ve giriş yaparak (Crewin çalışma
alanı) test edildi. Bulgular ve senden istenenler aşağıda. Her maddeyi bitirince doğrula; sonunda kısa bir rapor ver.

## Kurallar

- **Canlı veri:** Canlı Crewin çalışma alanında gerçek müşteri verisi var.
  - Yazma testlerini yalnızca ayrı bir test projesinde yap (bkz. 5. bölüm).
  - Gerçek gönderim (e-posta, WhatsApp, sosyal paylaşım, reklam) ve ödeme yapma.
- **Sırlar:** Sunucu ayarlarının değerlerini (şifre, anahtar) hiçbir çıktıya, commit'e veya rapora yazma.
- **Veritabanı:** Değişikliklerden önce veritabanının yedeğini al. Hangi veritabanının kullanıldığını raporda belirt:
  SQLite mı, `PLATFORM_DATABASE_PROVIDER=mssql` ile RDS mi?

## 1. Yayınlanacak kod

- `main` dalının son hali yayınlanacak. Henüz canlıda olmayan commit'ler:
  - **`48a2352` fix(landing)**, giriş yapmadan yapılan testin düzeltmeleri:
    - mobil menü bağlantıya basınca kapanıyor;
    - girişten sonra derin bağlantıya dönülüyor (`/login?from=%2F%3Ftab%3D…`);
    - `app/robots.ts` ve `app/sitemap.ts` eklendi, ikisi de oturumsuz açılıyor;
    - Open Graph ve Twitter etiketleri eklendi;
    - giriş sayfasında "Şifremi unuttum" ve "Yeni çalışma alanı" yalnızca ilgili özellik açıksa görünüyor;
    - alt bilgideki fazla bağlantı kaldırıldı.
  - **`8178488` ve `a2f1444`:** MSSQL veri katmanı (kendi commit'lerin; durumunu sen biliyorsun).
- **Node sürümü:** `package.json` artık `better-sqlite3` ^12 istiyor. Node 20 / Windows için hazır derleme yok.
  Sunucuda Node 24 olduğunu doğrula. Geliştirme bilgisayarı hâlâ Node 20'de; bu konuda bir karar ver ve bildir.
- **Yayından sonra kontrol et:**
  - `https://ryzevo.com/robots.txt` ve `/sitemap.xml` 200 dönüyor;
  - ana sayfada `og:title` var;
  - oturumsuz `/?tab=campaigns` → `/login?from=%2F%3Ftab%3Dcampaigns`;
  - telefon genişliğinde menüde bir bağlantıya basınca menü kapanıyor.

## 2. Hız sorunu (öncelikli)

**Ölçümler (canlı, giriş yapılmış, Chrome):**
- Analitik sekmesi yaklaşık 10 sn'de oturuyor. Takvim yaklaşık 2 sn ama arka planda istekler 5 sn sürüyor.
  Genel bakıştaki API'ler 4–5 sn bekliyor.
- `/api/job-bot` sayfa açılırken art arda birçok kez çağrılıyor ve her biri 5–16 sn sürüyor: Analitik sırasında 7,
  Takvim sırasında 4 istek.
- Aynı API'ler tek tek çağrılınca hızlı (0,1–0,7 sn). `/api/job-bot` tek başına 95 ms.
  Yani yavaşlık, aynı anda giden çok sayıda isteğin sunucuda sıraya girmesinden kaynaklanıyor.
- `/api/data/content-history` her çağrıda 4–8 sn sürüyor. Çağrıldığı yerler: SEO, WhatsApp ve Telegram, Genel
  bakış. İçerik geçmişi dosyası büyük, yaklaşık 22 MB.

**Bakılacak yerler:**
- `components/tabs/JobBotTab.tsx` (287–334. satırlar): açılışta `positions`, `companies`, `languages` ve
  `certificates` aramaları ile `/api/job-bot` çağrılıyor.
- `components/tabs/PipelineTab.tsx` (86, 153, 170. satırlar): `pipeline_status`, `pipeline_logs` ve
  `discovered_groups` çağrılıyor.
  - Bu sekmeler bir kez açıldıktan sonra arka planda bağlı kalıp başka sekmelerde de istek atıyor olabilir.
- `app/api/job-bot/route.ts`: Crewin backend'e giden aramalar, sırayla beklenen dosya okumaları.
- `app/api/data/content-history/route.ts` ve `lib/content-history.ts`: büyük JSON her istekte baştan okunup
  ayrıştırılıyor olabilir.
  - `lib/platform/crewin-job-guide.ts`, aynı dosyalar için dosya değişme zamanına bağlı bir önbellek kullanıyor;
    aynı yöntem burada da uygulanabilir.

**Beklenen:**
- **İstek sayısı:** Aynı anda giden aynı istekler tekilleşsin. Açık olmayan sekmeler istek atmasın. Sabit arama
  listeleri (pozisyon, şirket, dil, sertifika) önbelleğe alınsın.
- **İçerik geçmişi:** Değişmediyse yeniden ayrıştırılmasın. Gerekiyorsa sayfalı dönsün.
- **Hedef:** Her sekme 2 sn içinde otursun. Önce ve sonra süreleri sekme sekme raporla.

## 3. Diğer düzeltmeler

1. **Erişilebilirlik:** "Ne yapmak istiyorsunuz?" penceresi (`components/platform/JobGuide.tsx`) ekran okuyuculara
   pencere olarak tanıtılmıyor.
   - `role="dialog"`, `aria-modal="true"` ve başlığa bağlı `aria-labelledby` ekle.
   - Pencere açıkken odak pencerede kalsın.
   - Bugünkü davranış doğru, korunmalı: ilk Escape aramayı temizliyor, ikincisi pencereyi kapatıyor.
2. **İlan botu:** Canlıda kuyruk tamamen boş (0 toplam, 0 bekleyen, 0 yayında). Ajanın kuyruk ve ilan dosyaları
   sunucuda var mı ve doğru yolda mı (`crewinjob-agent`), kontrol et. Bilerek boşsa raporda öyle yaz.

## 4. Sunucu ayarları

Panelin kurulum kontrolü canlı için "16 kurulumdan 7'si hazır" diyor (Proje ayarları → Operasyon → Kurulum rehberi).
Her kartta ne yazılacağı adım adım anlatılıyor.

| Kart | Durum |
|---|---|
| Yönetici şifresi | Hatalı |
| Google (Search Console, GA4: `PLATFORM_GOOGLE_*`) | Eksik |
| Meta (Facebook Sayfası, Instagram) | Eksik |
| WhatsApp gönderimi (Crewin) | Eksik |
| Telegram (kanal ve grup duyuruları) | Eksik |
| Hesap e-postaları (doğrulama, şifre sıfırlama, uyarılar) | Eksik |
| Geri dönen e-posta ve şikâyet bildirimi | Eksik |
| Tarayıcı ve telefon bildirimleri | Eksik |

- **Hesap e-postaları:** Bu açılmadan şifre kurtarma çalışmaz. `/recover` bugün "Hesap e-postaları henüz etkin
  değil" diyor.
- **Rapor:** Hazır olanları, yapamadıklarını ve nedenlerini yaz. Değer yazma, yalnızca hangi kartın durumunun
  değiştiğini bildir.

## 5. Testler

Sunucuda gerçek veri olmayan ayrı bir test projesi aç: davetle yeni çalışma alanı, adı "QA-TEST". Aşağıdakileri o
projede yap.

### Mobil görünüm

- **Ekran boyutları:**
  - 390×844 (telefon);
  - 768×1024 (tablet).
- **Sayfalar:**
  - Genel bakış ve "Ne yapmak istiyorsunuz?";
  - Sosyal medya;
  - İçerik kütüphanesi;
  - Kampanyalar;
  - Takvim;
  - Analitik;
  - Proje ayarları (6 alt bölüm).
- **Kontrol et:**
  - yatay kaydırma;
  - taşan veya üst üste binen öğe;
  - dokunma hedefleri 44 px'ten küçük mü;
  - yan menü açılıp kapanıyor mu;
  - açık ve koyu tema.

### Çıkış

- **Sırası:**
  1. Çıkış yap.
  2. Geri tuşuyla ve doğrudan adresle `/?tab=project`'e git.
  3. Giriş sayfasına yönlendirilmelisin.
  4. `/api/workspace` 401 dönmeli.
- **Tekrar giriş:** Tekrar giriş yap; `from` parametresiyle istenen sekmeye dönülmeli.

### Yazma işlemleri (yalnız test projesinde)

1. **İçerik taslağı:** "QA-TEST" adlı bir taslak oluştur, düzenle, kaydet, sayfayı yenile; kalıcı olmalı.
2. **Çakışma:** Aynı taslağı iki sekmede aç, birinde kaydet, diğerinde kaydetmeyi dene. Çakışma uyarısı çıkmalı,
   sessizce üzerine yazılmamalı.
3. **Takvim:** "QA-TEST" görevi oluştur, durumunu değiştir, sil.
4. **Kampanya:** Kampanya taslağı oluştur ve "prova" moduna kadar ilerlet. Gerçek gönderim yapma.
5. **Proje ayarları:** Marka dilini değiştir, kaydet ve geri al.
6. **Temizlik:** Testin sonunda bütün "QA-TEST" kayıtlarını sil. İstersen test projesini kapat.

## Rapor

1. Yayınlanan commit ve kullanılan veritabanı (SQLite veya RDS).
2. Hız: her sekme için önce ve sonra açılış süreleri, `/api/job-bot` ve `/api/data/content-history` için istek
   sayısı ve süre.
3. Yapılan düzeltmeler ve commit'leri.
4. Sunucu ayarları: hangi kartların durumu değişti.
5. Test sonuçları: mobil, çıkış ve yazma işlemleri. Her bulgu için adımlar, beklenen, gerçekleşen ve ekran
   görüntüsü.
6. Yapılamayanlar ve nedenleri.
