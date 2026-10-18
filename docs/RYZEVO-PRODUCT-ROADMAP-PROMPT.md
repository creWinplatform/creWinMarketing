# Ryzevo: Veri Odaklı Büyüme SaaS'ına Geçiş İçin Uygulama Promptu

## Görev ve Ürün Hedefi

Mevcut Ryzevo / Crewin Marketing Panel kod tabanında çalış. Sıfırdan ürün kurma ve çalışan yapıları yeniden geliştirme. Hedef, kendi kullanıcı tabanı olan girişimlerin kendi ürün verilerini bağlayıp pazarlama ve aktivasyon operasyonlarını yönetebildiği, çok müşterili bir büyüme platformudur.

Ürünün temel döngüsü:

**Ürün verisine bağlan → fırsatı ve kitleyi belirle → markaya uygun içerik hazırla → insan onayı al → kontrollü dağıt → gerçek dönüşümü ölç → sonraki aksiyonu öner.**

Ryzevo genel bir içerik üreticisi veya yalnızca güzel bir dashboard olarak kalmamalı. Rekabet avantajı, müşterinin gerçek ürün verisini kendi hedefleriyle ve uygulanabilir pazarlama aksiyonlarıyla birleştirmesidir. Buna rağmen bağlantısı veya verisi olmayan müşteride sahte sonuç üretme.

Hedef müşteriler iş platformları, B2B pazaryerleri, eğitim ürünleri, emlak/araç pazaryerleri ve benzer dikey girişimler olabilir. Bu sektörleri ayrı ayrı hard-code etme. Yeni müşteri; ürününü, hedef kitlesini, marka dilini, veri alanlarını, olaylarını ve başarı ölçütlerini yapılandırabilmeli. AI kurulum önerisi sunabilir; müşterinin haberi olmadan araç/kod üretip çalıştırmamalı veya veri kaynağına erişim kazanmamalı.

## Değişmez Kurallar

1. Frontend ve backend mevcut Next.js **modüler monolitinde** kalacak. Worker aynı kod tabanının bir süreç rolü olabilir; yeni mikroservis mimarisi, ikinci kimlik sistemi veya paralel kampanya servisi kurma.
2. CrewinJob ilk özel müşteri olarak korunacak. Denizci aktivasyonu, Bullseye, ücretsiz ilan, CV unlock, kredi/ödeme, mevcut botlar, içerikler, gönderim kimlikleri ve entegrasyonları bozulmayacak. Crewin'in iş modeli korunacak: ücretsiz ilan; ilgili CV'nin ücretli unlock edilmesi.
3. `crewinjob.com`, `api.crewin.org`, mevcut ABP DTO/route sözleşmeleri, müşteri env anahtarları ve geçmiş kayıtlar topluca değiştirilmemeli. SaaS kimliği Ryzevo; CrewinJob müşteri/proje kimliğidir.
4. SaaS organizasyon/proje kimliği, Crewin bağlayıcısındaki `Abp.TenantId` ile aynı kavram değildir. Yeni müşteriyi hiçbir koşulda Crewin tenant'ına, dosyalarına, API anahtarına veya önbelleğine düşürme.
5. Kirli çalışma ağacındaki mevcut değişiklikleri koru. Destructive migration, reset, toplu veri taşıma, DNS değişikliği veya deploy yapma. Veri taşıma gerekiyorsa önce yedek, dry-run, uyumluluk ve geri dönüş planı sun.
6. Mevcut Ryzevo logosunu, tasarım sistemini, mobil uyumu ve çalışan kullanıcı akışlarını koru. Bu görev yeni bir landing tasarlama görevi değildir.
7. Gerçek e-posta/sosyal yayın, reklam harcaması, provider yazma yetkisi/OAuth kapsamı genişletme ve canlı müşteri verisine etkili işlemler açık kullanıcı onayı olmadan yapılmayacak. Geliştirme testleri izole fixture veritabanıyla çalışacak.
8. Sahte trafik, indeks, PageSpeed, gelir, teslimat, açılma, dönüşüm veya provider başarı durumu gösterme. Veri yok, gerçek sıfır, hata ve henüz doğrulanmadı birbirinden ayrılmalı.

## Önce Mevcut Durumu Doğrula

İlk olarak şu belgeleri ve ilgili çalışan kodu incele; tarihsel notları güncel durum sanma:

- `docs/SAAS-PILOT-READINESS.md`
- `docs/SAAS-MIGRATION.md`
- `docs/SAAS-GOOGLE-OAUTH.md`
- `docs/SAAS-SOCIAL-CONNECTIONS.md`
- `docs/SAAS-META-CONNECTIONS.md`
- `docs/RYZEVO-BRAND.md`
- `docs/RYZEVO-INTEGRATION-QA.md`
- `crewinjob-web/lib/platform/`, mevcut API route'ları ve platform testleri.

Başlangıç varsayımı: organizasyon/proje ayrımı, roller, scoped oturumlar, davetler, şifreli bağlantı deposu, bazı OAuth akışları, taslak CRUD, marka/hedef ayarları, iş planları, manuel ölçümler, bağlantı doğrulama kuyruğu, pilot kotaları ve yedekleme zaten var. Bunları koddan doğrula; yeniden yazma.

Standart müşteri hesabındaki bir modülün katalogda `shared` görünmesi, o modülün veri akışının ve gönderiminin müşteri bazında tamamlandığı anlamına gelmez. UI görünürlüğünü yetkilendirme yerine kullanma. OAuth bağlantısı da yayın yetkisi, gerçek rapor aktarımı veya gönderim başarısı değildir.

Her ihtiyaç için kısa bir matris çıkar: **mevcut kod → yeniden kullanılacak bölüm → gerçek eksik → veri sahibi → kabul testi**. Özellikle Crewin ve standart müşteri yollarını ayrı incele. Mevcut karşılık bulunduğunda yeni servis yerine eksik davranışı mevcut yapıya ekle.

## Mimari Sınırlar

- Modül sınırları: kimlik/erişim, proje yapılandırması, ürün verisi, segmentler, içerik/kampanya, dağıtım, ölçüm ve ticari operasyonlar. Bunlar mantıksal sınırlar; her biri için ayrı servis veya veritabanı zorunlu değil.
- Standart müşteri kayıtları için mevcut scoped depoları esas al. Aynı varlık için iki bağımsız doğruluk kaynağı oluşturma. Crewin'in mevcut adapter'ını kontrollü biçimde koru.
- Organizasyon/proje scope'u doğrulanmış oturumdan, üyelikten veya ilgili sunucu kimlik bilgisinden çözülsün. Client'ın gönderdiği kimlikler tek başına otorite olmasın.
- Scope; sorgu, foreign key, benzersizlik, dosya, cache, job, webhook, OAuth state, rate limit, kota ve idempotency anahtarlarında korunmalı.
- Hazır olmayan yetenekler capability durumuyla kapalı kalmalı. Backend doğrulamadan bir UI toggle'ıyla gönderimi açma.
- SQLite'ın mevcut tek-host pilot sınırını açık tut. Her müşteri için fiziksel ayrı DB kurmak zorunlu değil. Çok-host/yük ihtiyacı kanıtlandığında ortak veri erişim sınırı üzerinden PostgreSQL gibi bir hedefe testli geçiş değerlendir; veritabanı değişimini ürün değerinden önce gereksiz yere başlatma.

## Faz 0: Envanter ve Regresyon Tabanı

Mevcut servis, tablo, route, izin, sağlayıcı, job ve ekranları envanterle. Standart projede gerçekten çalışan yeteneklerle Crewin'e özgü yetenekleri ayır. Belgede yazan ile çalışan kod farklıysa bunu belirt. Yalnız yapılandırma isteyen maddeler ile gerçek geliştirme isteyenleri ayrı listele.

Kabul: mevcut testler, TypeScript ve ayrı çıktı dizinli production build başlangıç sonucu kaydedilmiş; scope ve Crewin davranışı için korunacak regresyon senaryoları tanımlanmış olmalı. Birden fazla kilit dosyası veya dependency uyarısı varsa görünür kaydet; kontrolsüz major upgrade yapma.

## Faz 1: Genel Ürün Verisi ve Bağlayıcı Katmanı

Önce iki sınırlı giriş yolu ekle: müşterinin izin verdiği **read-only REST kaynağı** ve **imzalı server-to-server webhook**. Mevcut bağlantı deposu, şifreleme, doğrulama kuyruğu ve hata kalıplarını genişlet. İlk fazda doğrudan müşteri veritabanı erişimi, keyfi SQL, eval veya kod çalıştırma ekleme.

Müşterinin alanlarını ortak kavramlara eşleştirebilmesini sağla: kullanıcı/hesap, şirket, sektör varlığı, özellikler, ürün olayı, olay zamanı ve iletişim izni kanıtı. Şema müşteri/proje/kaynak bazında versiyonlu olsun. E-posta adresini zorunlu veya tek kimlik kabul etme; dış sistem kimliklerini scope'lu tut.

Bağlantı akışı: kaynak tanımı → erişim testi → sınırlı örnek önizleme → alan eşleştirme → dry-run → açık etkinleştirme. Hatalı alan ve tarihleri açıklayıcı göster. İlk yükleme ve sonraki senkronizasyonun cursor/checkpoint, boyut sınırı, tekrar deneme ve kısmi hata davranışını belirle. Şema değişikliği sessizce yanlış segment üretmesin.

Webhook'larda sunucu tarafında kaynak/scope çözümü, imza/zaman damgası, replay koruması, rate limit ve payload sınırı uygula. Kaynak + olay kimliğiyle tekrarlı teslimatı idempotent işle. Olay zamanı ile alınma zamanını ayrı sakla; geç gelen olayın davranışını tanımla.

REST kaynaklarında mevcut SSRF korumalarını yeniden kullan: private/metadata/loopback engeli, DNS rebinding önlemi, redirect kontrolü, timeout ve yanıt boyutu sınırı. Token/PII loglama. Kaynak kimlik bilgileri client'a dönmesin.

Kabul: aynı bağlayıcı altyapısıyla birbirinden izole iki farklı sektör fixture'ı bağlanabilmeli; tekrar gönderilen olay sayacı artırmamalı; bağlantı iptali sonraki job'ları durdurmalı. Yeni müşteriden Crewin'e hiçbir fallback gerçekleşmemeli.

## Faz 2: Hedef, Metrik ve Dinamik Segment Motoru

Mevcut proje hedeflerini genişlet; ikinci hedef sistemi oluşturma. Proje hedefi, dönüşüm aşaması, olay/özellik eşleştirmesi ve metrik tanımı birbirine bağlansın. Sektör başına yeni sabit hedef enum'ları eklemek yerine mevcut `goalId` ve geriye uyumlu yapılandırmayı kullan.

Sınırlı, tipli ve sunucuda doğrulanan kural yapısı kur: AND/OR, eşitlik, karşılaştırma, listede olma, boşluk, son aktivite ve belirli zaman aralığında olayın varlığı/yokluğu. Desteklenmeyen filtreyi sessizce yok sayma. Kuralları keyfi JS/SQL olarak çalıştırma.

Segment önizlemesi gerçek sayıyı, hesaplama zamanını, kullanılan kaynağı ve yetki sınırları içinde gerekçeyi göstersin. Önizleme ile gönderim aynı değerlendirme motorunu kullansın. Kampanyanın kullandığı segment/kural versiyonunu sakla; gönderim öncesi izin ve suppression tekrar değerlendirilsin.

Örnekler yalnız yapılandırma olsun: Crewin'de eksik profil; eğitim ürününde başlamamış eğitim; pazaryerinde ilk ilanını oluşturmamış işletme. Mevcut müşterilerle dış prospect/lead kayıtlarını karıştırma. Profil kaydı veya dışarıda bulunmuş e-posta, tek başına pazarlama izni sayılmasın.

Kabul: üç örnek aynı motorla, sektör için kod dalı açmadan çalışmalı; tarih/saat dilimi, boş değer, yanlış tip, geç gelen olay ve çapraz proje senaryoları test edilmeli.

## Faz 3: İlk Tam Operasyonel Akış: Onaylı E-posta Pilotu

Önce tek bir dikey akışı tamamla: **segment → kampanya/taslak → şablon önizleme → onay → sınırlı e-posta gönderimi → durum/sonuç**. Aynı anda tüm kanalları yarım açma.

Mevcut kampanya, içerik, şablon, rol, bağlantı ve job altyapılarını genişlet. Ayrı kampanya modeli/ikinci kuyruk kurma. Standart müşterilerin genel kampanya akışı ile Crewin'in özel kampanya adapter'ı arasında geriye uyumlu sınır kur. Onay yetkisi gerekiyorsa mevcut RBAC'yi genişlet; ikinci rol sistemi oluşturma.

Gönderim öncesi içerik/CTA/şablon değişkeni, kaynak veri tazeliği, kitle, güncel iletişim izni, suppression, gönderen ve bağlantı uygunluğu kontrol edilsin. Test allowlist'i backend'de yönetilsin. Mevcut SMTP altyapısını kullan; Crewin'in global transporter veya kimlik bilgilerini devralma. SMTP erişim testi ile domain doğrulaması ve teslimat yetkisini aynı sayma.

Gönderimler kalıcı ve scoped job'larla yürüsün: idempotency, lease, hız sınırı, kontrollü retry, provider hata ayrımı ve recipient bazında sonuç. İstek/worker yeniden başlarsa aynı alıcıya ikinci mail üretme; provider'a gönderildiği belirsiz kalan denemeyi körlemesine tekrarlama. Worker çalışırken yetki, bağlantı iptali, kota, izin ve suppression tekrar doğrulansın.

Takvimde iş planı ile gerçek gönderim zamanlamasını ayır. Saat dilimi, queued/running/partial/failed/completed/cancelled durumları ve iptal davranışı açık olsun. İptal edilen işin henüz gönderilmemiş kısmı durmalı; önceden gönderilmiş mesaj geri alınmış gibi gösterilmemeli.

Abonelikten çıkma ve teslimat callback'leri projeye bağlı, doğrulanmış ve idempotent olsun. Token'larda açık PII taşıma; unsubscribe işlemi login gerektirmesin. Suppression, önceden hazırlanmış kitlelerde de etkili olsun.

Kabul: önce fixture/fake transport testleri geçsin. Ardından yalnız açıkça onaylanan adreslerde, küçük `maxRecipients` limitiyle gerçek pilot yapılabilsin. Provider isteğini kabul etti diye teslim edildi deme; teslimat ile ürün dönüşümünü ayrı tut.

## Faz 4: Gerçek Ölçüm ve İkinci Ürünle Değer Doğrulaması

Faz 1 olaylarını mevcut proje hedefleri ve raporlarıyla birleştir. Mevcut manuel ölçümleri koru; otomatik olaylarla kaynağını karıştırma. Gerekli GA4/Search Console rapor aktarımını mevcut proje OAuth/bağlantı altyapısından besle; ayrı kimlik veya global Crewin property kullanma.

Gösterimler, gönderim/teslimat, tıklama ve ürün aktivasyonunu kaynağı/tarihiyle ayrı raporla. Otomatik tarayıcı/proxy açılışlarını gerçek insan okuması diye sunma. Dönüşüm penceresi ve attribution kuralını açık tanımla; aynı dönüşümü tekrar sayma. Korelasyonu nedensellik veya gelir garantisi olarak anlatma.

Proje ve kampanya başına gerçek iş sonuçlarını izleyebil: profil tamamlama, ilk değer, başvuru, demo talebi, ilk ilan, satın alma vb. Bunlar yapılandırılmış tanımlar olsun. Gelir veya maliyet kaynağı yoksa ROAS/CAC gibi sonuçlar uydurma. AI önerileri kullanılan kaynağı, tarihi, gerekçeyi ve belirsizliği göstersin.

Kabul: Crewin dışında bir sektör fixture'ıyla uçtan uca akış geçmeli. Sonra gerekli izinler ve güvenlik kapıları sağlandığında ikinci gerçek müşteriyle kontrollü pilot doğrulanmalı: veri bağlandı → segment hesaplandı → taslak onaylandı → izinli pilot gönderildi → gerçek ürün olayı rapora yansıdı. Fixture başarısını canlı müşteri başarısı diye raporlama.

## Faz 5: Ortak Modülleri Sırayla Operasyonel Hale Getir

İlk kapalı döngü kabulünden sonra aşağıdaki yetenekleri tek tek uçtan uca tamamla. Mevcut modül/adapter/env/servis karşılığı varsa onu genişlet; yalnız etiketi `shared` yaparak tamamlandı sayma.

1. Sosyal yayın ve gerçek yayın takvimi: hesap/asset seçimi, gerekli provider izinleri, önizleme/onay, planlama, iptal, sonuç ve metrik aktarımı. Mevcut Google/LinkedIn/Meta kurulumlarını koru. X/TikTok vb. yalnız gerçek API erişimi ve desteklenen sözleşmelerle açılmalı; her platform otomatik olarak hazır varsayılmamalı.
2. SEO: mevcut public HTML denetimi, tarama, bulgu/öneri ve iş kartı akışını incele. Crewin SiteSeo/SiteSeoAction adapter'ını koruyarak standart müşteriye scoped karşılığını bağla; aynı audit motoru ve iş altyapısından yararlan. Bulgular tekrar taramada mükerrer oluşmasın; düzelenler geçmişiyle izlenebilsin. GSC fırsatlarını gerçek verilere bağla. Onay/tamamlandı durumları hedef siteye otomatik deploy anlamına gelmesin.
3. B2B prospect/lead: mevcut araştırma ve kampanya akışını proje/ürün bağlamına uyarla. Firma seçilme gerekçesi, kaynak URL, kontrol tarihi, uygunluk kanıtı ve önerilen kurumsal temas rolü görünmeli. AI e-posta/kişi bilgisi uydurmasın; araştırma, onay, izin ve gönderim ayrı kararlar kalsın. Müşterinin mevcut kullanıcı tabanından ayrı audience türü olsun.
4. Yaşam döngüsü otomasyonu: Faz 2 kuralları üzerinde tetikleyici → koşul → bekleme → onay/aksiyon → çıkış düzeni kur. İzin iptali, aktivasyon veya hedefin gerçekleşmesi tekrar gönderimi durdurmalı. Frequency cap ve döngü engeli olmalı. Mevcut iş kuyruğunu kullan; her otomasyon için ayrı cron yazma.
5. Mesajlaşma ve topluluk: WhatsApp/Telegram bağlantıları, kaynaklar ve yayın hedefleri proje bazında olsun. Mevcut bot ayrıştırma ve onay altyapısından yararlan; sektör sözlükleri yapılandırılsın. Kaynak okuma, içerik önerisi ve yayın ayrı yetkiler olsun. Özel gruplara izinsiz erişim veya kişisel iletişim bilgisi üretimi ekleme.
6. Reklam yönetimi: mevcut Meta/Google/LinkedIn adapter'larını incele. Seçilen reklam hesabı, para birimi, bütçe sınırı, onay, oluştur/durdur ve provider sonucu proje bazında doğrulansın. Onaysız bütçe/harcama artışı ve gerçek reklam testi yapma.

Kabul: her alt modül için yeni müşteride gerçek veri/kimlik sınırı, UI durumları ve worker/provider hata senaryoları test edilmeli. Bir kanalın başarısı başka kanalların hazır olduğu şeklinde sunulmamalı.

## Faz 6: Ticari SaaS ve Self-Service

Önce mevcut davet, ekip, oturum ve kota sistemlerini genişlet. Public signup, doğrulanmış e-posta, davet teslimi ve hesap kurtarma davranışlarını güvenlik/abuse kontrolleriyle tamamla. SSO ve ayrı onaylayıcı rolünü gerçek ihtiyaç ve mevcut RBAC üzerinden değerlendir; başlamadan hepsini zorunlu entegrasyon yapma.

Plan/entitlement, koltuk, AI, gönderim ve kaynak kullanımını sunucuda denetle. Mevcut pilot sayaçlarını koru; gerçek kullanım verisi olmayan maliyet veya tamamlanmış ödeme üretme. Sağlayıcı kullanım miktarı dönüyorsa sakla; tahmini AI maliyetini gerçek faturadan ayır.

Ödeme sağlayıcısı seçimi ve fiyatlar ayrı ticari karar olsun. Seçildikten sonra checkout/portal, imzalı/idempotent webhook, abonelik durumları, iptal, gecikmiş ödeme ve kota haklarını reconcile et. Frontend'den gelen plan/fiyat/paid durumuna güvenme. Ödeme sorunu müşterinin veri dışa aktarımını veya hesap erişim politikasını sessizce değiştirmesin; davranış açık tanımlansın.

Paketler doğrulanmış capability'lerden oluşsun. Starter/Growth/Scale isimleri örnek olabilir; hazır olmayan özelliği ücretli paket vaadi olarak gösterme. Sabit fiyatı veya ödeme sağlayıcısını kod incelemesi yapmadan dayatma.

Kabul: test ödeme ortamında tekrarlı ve sırasız webhook, yetki yükseltme girişimi, plan düşürme, kota yarışı ve üyelik değişimi test edilmeli. Canlı ödeme onaysız açılmamalı.

## Sürekli Güvenlik ve Yayına Kabul Kapısı

Bu kontroller son faza ertelenmez; ilgili özellik geliştirilirken uygulanır. Gerçek müşteri verisi/pilotu ve genel satış öncesinde tekrar değerlendirilir:

- Çapraz organizasyon/proje erişimi, ID tahmini, iptal edilmiş üyelik ve kuyrukta beklerken kaldırılmış yetki testleri.
- Sırlar, OAuth kodları, iletişim bilgileri ve içeriklerin log/AI sağlayıcılarına gereksiz taşınmaması; veri minimizasyonu ve tenant bazlı erişim.
- İletişim izni, suppression, veri dışa aktarma, silme/retention davranışı ve hukuki metinler için açık politika ve gerektiğinde uzman onayı; teknik kontrolü mevzuata uygunluk garantisi diye sunmama.
- Tenant/source/job/campaign korelasyon kimlikleriyle redakte loglar; hata izleme, job gecikmesi, provider hata oranı ve kota/maliyet görünürlüğü. Yeni bir gözlem aracı kurmadan mevcut olanı envanterle.
- Migration/rollback, şifreleme anahtarıyla eşleşen yedek, geri yükleme testi, HTTPS, process supervision ve worker yeniden başlatma.
- Build/runtime bağımlılık uyarıları, burst trafik, job çakışması ve tek-host kapasite sınırları. Veri/kilit gereksinimi oluşursa dağıtık çalışma ve depolama geçişini ayrıca test et.

## UX ve Doğrulama Standartları

Her yeni akış mevcut Ryzevo kabuğuna yerleşsin. Mobil/tablet/desktop, klavye erişimi, odak yönetimi ve uzun alan değerleri kontrol edilsin. Loading/boş/hata/yetkisiz/bağlantısı eksik durumları ayrı olsun. Kaydetmede sonsuz bekleme olmasın; timeout sonrası sonucu belirsiz yazmayı körlemesine tekrarlama.

Müşteriyi şu sırayla yönlendir: ürün profili → veri kaynağı → alan eşleştirme → hedef → segment → içerik/onay → kontrollü pilot → sonuç. Tüm uzmanlık ayarlarını ilk ekrana yığma. İleri ayarlar erişilebilir olsun; kritik güvenlik kapıları gizlenmesin. Mevcut kullanıcıya aynı kurulumu yeniden yaptırma.

Her fazın riskine göre test ekle ve mevcut testleri koru. En azından `npx tsc --noEmit`, ilgili unit/SQLite testleri, `npm run test:platform`, ayrı `NEXT_DIST_DIR` ile production build ve uygun HTTP entegrasyon testleri çalışmalı. Çalışan 3033 dev sunucusunun build dizinini bozma. Tarayıcı testlerini izole fixture ortamında yap; mevcut Crewin akışlarına regresyon kontrolü ekle.

## Çalışma ve Raporlama Biçimi

Önce Faz 0 envanterini ve bağımlılıkları çıkar; ardından uygulanabilir ilk eksik dikey akışı tamamla. Yalnız plan üretip işi yapılmış gösterme. Fazlar arasında altyapıyı tekrar kurma; tamamlanmış kabul kapısını kanıtla. Açık kullanıcı onayı isteyen işlemleri ayrı tut, bağımsız güvenli işlere devam et.

Her teslimde kısa rapor ver: ne yeniden kullanıldı, ne değişti, hangi test geçti, hangi dış yapılandırma/onay gerekiyor, neler gerçekten eksik. Bir yeteneği **kodlandı / fixture test edildi / gerçek sağlayıcıda doğrulandı / müşteri kullanımına açıldı** durumlarından hangisindeyse öyle belirt.

İlk teslim hedefi: ikinci bir girişimin kendi ürün verisini bağlayıp anlamlı bir segmentle kontrollü e-posta pilotu yapması ve gerçek aktivasyon olayını görmesi. Diğer kanalları, faturalamayı ve ölçeklendirmeyi bu doğrulanmış temelin üzerine sırayla ekle. Tüm modüller listeleniyor diye ürünü tamamlanmış SaaS ilan etme.
