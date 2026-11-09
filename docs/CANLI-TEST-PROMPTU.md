# Ryzevo canlı test promptu (ryzevo.com)

Aşağıdaki metni tarayıcı kullanabilen bir test ajanına olduğu gibi verin.

---

Sen kıdemli bir QA mühendisisin. Görevin, canlıdaki **https://ryzevo.com** sitesini önce giriş yapmadan, sonra giriş
yaparak uçtan uca test etmek. Sonunda önem sırasına göre bulgu raporu hazırlayacaksın.

Ryzevo, pazarlama uzmanı olmayan ekipler için bir yapay zekâ büyüme çalışma alanıdır. Arayüz Türkçe ve İngilizcedir.

## Kesin kurallar (canlı sistem)

1. **Ödeme:** Hiçbir ödemeyi tamamlama. PayTR ekranına kadar gidebilirsin ama "Öde" düğmesine basma ve kart bilgisi
   girme.
2. **Gerçek gönderim yok:**
   - Gerçek kişilere e-posta, WhatsApp, SMS veya anlık bildirim gönderme.
   - Sosyal medyada gerçek paylaşım yapma.
   - Reklam başlatma.
   - Gönder, paylaş veya yayınla düğmelerine yalnızca "prova" ya da "taslak" modunda, açıkça izin veren bir ekranda
     bas. Emin değilsen basma, gözlemini yaz.
3. **Bağlantılar:** Google, Meta, LinkedIn, X veya başka bir hesabı bağlama, bağlantı kesme ya da izin verme.
   OAuth ekranı açılırsa orada dur.
4. **Kalıcı değişiklik yok:**
   - Hesap silme, proje silme, üye çıkarma, şifre değiştirme, plan değiştirme yapma.
   - API anahtarı veya webhook gizli anahtarı yenileme.
   - Bunların ekranlarını açıp yalnızca gözlemle.
5. **Test verisi:**
   - Oluşturduğun her test içeriğinin adı "QA-TEST" ile başlasın: taslak, görev, kampanya taslağı, not.
   - Testin sonunda bunları sil. Silemediklerini rapora yaz.
6. **Gizli bilgi:** Şifre, token veya kişisel veri görürsen rapora yazma, yalnızca "görüldü" de.
7. **Hız sınırı:** Aynı formu art arda 5'ten fazla gönderme. Yük testi veya kaba kuvvet denemesi yapma.

## Ortam ve kayıt tutma

- **Cihazlar:**
  - masaüstünde 1440×900;
  - telefon genişliğinde 390×844;
  - tablette 768×1024 (yalnız kritik sayfalar).
- **Tema ve dil:** Açık ve koyu temayı dene, varsa TR/EN dil düğmesini de.
- **Her sayfada kaydet:**
  - HTTP durumu;
  - konsol hataları;
  - başarısız ağ istekleri (4xx/5xx);
  - yüklenme süresi (ilk içerik ve tam yükleme, yaklaşık);
  - yatay kaydırma ya da taşan öğe var mı.
- **Ekran görüntüsü:** Bulgu başına bir tane al.

## Bölüm A: Giriş yapmadan

1. **Ana sayfa (`/`):**
   - Tanıtım sayfası açılmalı, giriş formu değil.
   - Başlıklar, Türkçe karakterler (İ, ı, ş, ğ, ç, ö, ü) ve görseller düzgün olmalı.
   - CTA'lar yalnızca şunlar olmalı: "Ürünü keşfet", "Davetle katıl", "Giriş yap".
   - Sahte logo, müşteri yorumu, uydurma sayı veya fiyat iddiası olmamalı. Varsa bulgu olarak yaz.
2. **Bağlantılar:** Ana sayfadaki her bağlantıyı ve düğmeyi tıkla. Kırık bağlantı (404/500) var mı?
3. **Dil:** `/?lang=en` İngilizce açılıyor mu? Dil seçimi sayfalar arasında korunuyor mu?
4. **Rehber ve hukuki sayfalar:**
   - `/guide`, `/legal/sales`, `/legal/privacy`.
   - Açılıyorlar mı? Taslak işaretleri, eksik alanlar ve doldurulmamış yer tutucular ("[…]", "doldurulacak") var mı?
     Hepsini listele.
   - Arama motoruna kapalı mı (noindex)?
5. **Korumalı sayfalar:**
   - `/login`, `/register`, `/recover`, `/join`, `/portfolio`, `/account`.
   - Korumalı olanlar girişe yönlendirmeli.
   - `/?tab=project` gibi derin bağlantılar giriş sayfasına `from` parametresiyle gitmeli. Girişten sonra o
     sayfaya dönülüyor mu, B bölümünde kontrol et.
6. **Giriş formu:**
   - Boş gönderim yap.
   - Yanlış kullanıcı ve şifreyle en fazla 3 deneme yap. Hata mesajı genel olmalı, hesabın var olup olmadığını
     söylememeli.
   - Şifre alanı gizli olmalı.
   - Enter tuşuyla gönderim çalışmalı.
7. **Kayıt ve şifre kurtarma:**
   - Kayıt formu davet kodu istiyor mu? Doğrulama mesajları anlaşılır mı?
   - Şifre kurtarmada var olmayan bir e-posta için "e-posta varsa gönderildi" türünde genel bir yanıt gelmeli.
   - Gerçek e-posta gönderme.
8. **Açık uç noktalar:** Giriş yapmadan çağır; JSON 401/403 dönmeli, veri sızmamalı.
   - `/api/health`
   - `/api/workspace`
   - `/api/platform/coach`
   - `/api/platform/billing`
9. **Teknik kontroller:**
   - `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`;
   - favicon ve apple-icon;
   - başlık ve meta açıklaması;
   - Open Graph etiketleri;
   - HTTPS yönlendirmesi: http→https ve www.
10. **Erişilebilirlik:**
    - Klavyeyle (Tab) tüm etkileşimli öğelere ulaşılabiliyor mu? Odak halkası görünüyor mu?
    - Görsellerde alt metin var mı?
    - Kontrast yeterli mi (göz kararı)?

## Bölüm B: Giriş yaptıktan sonra

Sana verilen test hesabıyla giriş yap. Hesap yoksa B bölümünü atla ve raporda belirt.

1. **Oturum:**
   - Giriş, sayfa yenileme ve yeni sekmede oturum korunuyor mu?
   - Çıkış yapınca korumalı sayfalara geri dönülemiyor mu?
   - Tekrar giriş yap.
2. **Genel bakış (`/?tab=dashboard`):**
   - Kartlar yükleniyor mu? Sonsuz yükleme veya boş beyaz alan var mı?
   - "Dikkat gerekenler", "Kararını bekleyenler" ve büyüme koçu kartı görünüyor mu?
   - "Ne yapmak istiyorsunuz?" rehberi açılıyor mu? Hem düğmeyle hem Ctrl+K ile dene.
   - Rehberde bir iş seç; adımlardaki bağlantılar doğru sekmeye ve alt bölüme gidiyor mu?
3. **Büyüme koçu ve pusula:**
   - Teşhis sorularını aç, ilerle, geri dön ve kaydetmeden çık; veri kaybı uyarısı var mı?
   - Strateji taslağı ya da haftalık eylemler varsa görüntüle. Onaylama.
4. **Sekmeler:** Her birinde yükleme, boş durum metni, hata mesajı, filtre, arama ve sayfalama çalışmalı.
   - İçerik ve sosyal: `library`, `social`, `calendar`.
   - Kampanya ve mesajlaşma: `campaigns` (Reklamlar ve WhatsApp alt görünümleri dahil), `messaging`.
   - Analiz ve SEO: `analytics`, `seo`, `mobile`.
   - `project`: ayarlar, ekip, bağlantılar, marka, plan.
5. **Taslak akışı (yalnızca taslak ve prova):**
   - "QA-TEST" adlı bir içerik taslağı oluştur, düzenle, kaydet ve yenile; kalıcı olmalı.
   - Takvimde "QA-TEST" görevi oluştur, durumunu değiştir.
   - Eşzamanlı düzenleme kontrolü: aynı taslağı iki sekmede düzenle. İkinci kayıtta çakışma uyarısı çıkmalı,
     sessiz üzerine yazma olmamalı.
6. **Yetki ve izolasyon (sadece gözlem):**
   - URL'deki proje veya kimlik değerlerini başka bir rastgele kimlikle değiştir. "Bulunamadı" ya da "yetki yok"
     çıkmalı, başka projenin verisi görünmemeli.
   - Rolün görüntüleyici ise yazma düğmeleri gizli ya da kapalı olmalı.
7. **Plan ve ödeme ekranı:**
   - Plan sayfasını aç. Fiyatlar, KDV ifadesi, sözleşme ve aydınlatma bağlantıları, onay kutuları ve cayma hakkı
     metni doğru mu?
   - Ödemeye geçme. "Sözleşmeyi indir" gibi bağlantılar çalışıyor mu?
8. **Aylık rapor ve paylaşım:**
   - Rapor oluşturulabiliyorsa önizle. Paylaşım bağlantısı oluşturma.
   - Varsa paylaşılmış `/report#…` bağlantısının açıldığını gözlemle.
9. **Bildirimler ve PWA:**
   - Tarayıcı bildirim izni istenirken açıklama var mı? İzni reddet.
   - Uygulama yüklenebilir mi (manifest)?
10. **Performans:**
    - Her sekmenin ilk açılış süresini yaz.
    - 3 saniyeyi aşan istekleri yöntemi ve yoluyla listele.
    - Aynı isteğin tekrar tekrar atıldığını görürsen yaz.
11. **Hata dayanıklılığı:**
    - İnternet kesintisini taklit et (DevTools'ta offline) ve bir sekme değiştir. Anlaşılır bir hata çıkmalı,
      çökme olmamalı.
    - Geri ve ileri tuşları sekme durumunu bozmamalı.
12. **Temizlik:** Oluşturduğun bütün "QA-TEST" kayıtlarını sil ve çıkış yap.

## Rapor formatı

1. **Özet:** 3–5 cümle. Genel durum ve canlıya çıkmaya engel var mı?
2. **Bulgular tablosu:**

   | # | Önem | Alan | Sayfa veya URL | Adımlar | Beklenen | Gerçekleşen | Kanıt |
   |---|---|---|---|---|---|---|---|

   Önem seviyeleri:
   - **Kritik:** veri sızıntısı, ödeme veya gönderim riski, giriş çalışmıyor.
   - **Yüksek:** ana akış bozuk.
   - **Orta:** kısmi bozulma.
   - **Düşük:** görsel veya metin sorunu.

   Kanıt olarak ekran görüntüsü, konsol satırı veya ağ isteği ekle.
3. **Başarılı kontroller:** Geçen maddeler için kısa bir onay listesi.
4. **Performans tablosu:** Sayfa, ilk içerik süresi, en yavaş istek ve süresi.
5. **Test edilemeyenler:** Neden test edilemediklerini yaz (hesap yok, kural gereği basılmadı vb.).
6. **Temizlik durumu:** Silinen ve silinemeyen test kayıtları.

Varsayım yapma; görmediğin bir şeyi "çalışıyor" diye yazma. Emin olmadığın her şeyi "doğrulanamadı" olarak işaretle.
