# Ryzevo yönetimli satış hizmeti (Seçenek 2): karar ve ön koşullar

**Karar:** Yönetimli modeli yapıyoruz. Ama ürün "Ryzevo'nun SES hesabından gönderim" değil. Ürün şu: **müşterinin hiçbir teknik kurulum yapmadığı yönetimli satış hizmeti.**

- Gönderim sağlayıcısı değiştirilebilir olmalı; müşteri deneyimi tek bir sağlayıcıya bağlanmaz.
- SES, kullanım modelimizi yazılı olarak kabul ederse seçeneklerden biridir.

**Hedef deneyim:** Müşteri web sitesini girer, hedef müşterisini ve bütçesini onaylar. Ryzevo adayları hazırlar, iletişimi yönetir ve ilgilenenleri ona getirir.

Müşteriden şunlar alınır:
- şirket yetkisi,
- gönderici kimliği (kimin adına yazıldığı),
- kampanya onayı.

DNS, AWS ve posta kutusu kurulumu istenmez.

**Başarı ölçüsü:** Gönderilen e-posta sayısı değil, şu ikisi: **olumlu yanıt başına maliyet** ve **müşteri başına kalan katkı payı**.

## 1. Rekabet: Explee

- Explee yaklaşık 0,04 $/e-posta alıyor, abonelik yok.
- Kendi hazır posta kutularından gönderiyor; aday bulma, kişiselleştirme, takip ve toplantı bağlantısı paylaşımı yapıyor.
- Hangi altyapıyı kullandığı açık değil.
- "%97 gelen kutusu" gibi rakamlar kendi pazarlama beyanları.
- Rekabet yalnız fiyatla olmaz. Belirleyici olanlar: kurulumsuz deneyim, doğru aday seçimi ve yanıt yönetimi.

## 2. Gönderim sağlayıcısı

**Asıl soru hacim değil, gönderimin niteliği.** AWS, alıcının açıkça istemediği e-postaları "unsolicited" sayıyor ve gönderimi durdurabiliyor. Günde 50 gönderim, kişiselleştirme ve çıkış bağlantısı bu kullanımın kabul edildiği anlamına gelmez.

Bu durum **bugünkü modeli de etkiler**: müşterinin kendi SES hesabından soğuk e-posta göndermesi de aynı kurala tabidir.

**AWS'ye sorulacak (destek talebi), şu cümle mutlaka geçmeli:**

> "Alıcılar göndericiden e-posta almayı önceden talep etmemiş olabilir. Adresler şirket siteleri, profesyonel kaynaklar ve e-posta bulma servislerinden elde edilmektedir. Bu kullanım modelini SES üzerinde destekliyor musunuz?"

- Bu kullanım yazılı olarak kabul edilmeden yönetimli soğuk e-posta ürünü SES'e bağlanmaz.
- Sandbox'tan çıkış izni, tüm kampanyaların uygun olduğu anlamına gelmez.
- Google Workspace otomatik bir çözüm değil: Google'ın kuralları da istenmeyen ticari e-postayı kısıtlıyor. "Workspace alırsak sorun çözülür" varsayımıyla ilerlemiyoruz.

**SES kullanılırsa:**
- **Kiracı yönetimi (SES tenant management):** Her müşteri için ayrı bir kiracı, ayrı alan adı kimliği ve ayrı yapılandırma kümesi (configuration set).
  - AWS müşteri bazında itibar takibi yapıp sorunlu müşteriyi ayrı durdurabiliyor; bu, yalnız yapılandırma kümesinden daha kapsamlı.
  - Hesap düzeyinde yaptırımlar yine de var. Müşterilere "başka müşteriler hiçbir koşulda etkilenmez" garantisi verilmez.
- **Sistem e-postaları ayrı tutulur:** Şifre sıfırlama, hesap bildirimleri ve bültenler satış gönderiminden ayrı bir hesap veya kimlikten gider.
- **Özel IP:** Pilotun ön koşulu değil. Toplam hacme ve sağlayıcının önerisine göre değerlendirilir.

## 3. Teknik model

| Konu | Karar |
|---|---|
| Gönderim altyapısı | Sağlayıcı bağdaştırıcısı (adapter) arkasında. Kullanım modelini kabul eden sağlayıcıyla başlanır. |
| Müşteri alan adı | Müşterinin onayladığı, yalnız ona tahsis edilmiş alan adı. İlk sürümde farklı müşteriler aynı gönderici alan adında karışmaz. |
| Alan adı sahipliği | Tercihen müşteri adına kayıt, Ryzevo yönetir. Yenileme ve ayrılma koşulları sözleşmede açık olur. |
| Gönderici kimliği | Her e-postada hangi şirket adına yazıldığı açık olur. |
| Yanıt yönetimi | Yanıtı Ryzevo görür; yanıt gelince takipler kendiliğinden durur. Yanıtlar olumlu, olumsuz, ret ve otomatik yanıt olarak ayrılır. |
| Kapasite | Sabit bir "ısındı" tarihi yok. Kapasite gözlenen sonuçlara göre artar. |
| Askıya alma | Askıya alınan gönderim başka bir alan adına veya sağlayıcıya kendiliğinden taşınmaz. |

**Yanıt yönetimi kritik:** Yanıtların müşterinin gerçek adresine ulaşması yetmez. Ryzevo yanıtı göremezse, yanıt vermiş kişiye otomatik takip gönderebilir.
- **Bugünkü durum:** Yanıt müşterinin kutusuna gelir; ekip onu karta işleyince takipler durur.
- **Bugünkü önlem:** 24 saat içinde takip gidecek firmalar ekip uyarılarında gösteriliyor ("yanıt geldiyse önce kartına işleyin").
- **Yönetimli modelde:** Her dizi için ayrı bir yanıt adresi, gelen yanıtı alıp takibi durduran bir giriş (inbound) ucu ve müşteriye yanıtın iletilmesi.

## 4. Müşteriye gösterilecek aşamalar (boş bekleme ekranı yok)

1. Hedef müşteriler ve mesajlar hazırlanıyor (müşteri adayları ve metinleri görür, onaylar).
2. Gönderici kurulumu tamamlanıyor.
3. Kontrollü gönderim başladı.
4. Sonuçlara göre günlük kapasite artırılıyor.

Başlangıç hızı, gerçek pilot verileri oluşmadan garanti edilmez.

## 5. Fiyat

**Model:** Mevcut planlardan ayrı bir yönetimli gönderim kredisi. İlk pilotta 0,04 $/e-posta denenir; kalıcı fiyat taahhüdü verilmez.

**Hesap:**

| Varsayım | Sonuç |
|---|---:|
| Günde 50 e-posta × 22 iş günü | 1.100 e-posta/ay |
| 0,04 $ × 1.100 | **44 $/ay müşteri geliri** |

- Bu gelirden çıkacak giderler: aday verisi, doğrulama, yapay zekâ, alan adı, posta altyapısı, destek ve ödeme masrafları.
- Isınma döneminde gelir daha düşük olur.
- Ucuz gönderim maliyeti tek başına kârlılık göstermez.

**Kredi kuralları (baştan net):**
- Takip e-postaları da kredi düşer mi? *(karar verilecek)*
- Gönderimden önce elenen adaylardan (engelli, İYS reddi, geçersiz adres, MX kaydı yok) kredi düşmez.
- Sağlayıcının reddettiği gönderimde kredi iade edilir.

## 6. Hukuk: düzeltilmiş varsayımlar ve avukata sorular

**Düzeltmeler:**
- **"İYS ret kontrolü yeterli" varsayımı kaldırıldı.**
  - İYS'nin açıklamasına göre tacir ve esnaf adresleri de gönderimden önce sisteme kaydedilmeli. Bugünkü kod yalnız ret durumunu sorguluyor; kayıt adımı avukat görüşüyle birlikte eklenecek.
  - Bir kişinin şirket e-postası olması, onu otomatik olarak tacir/esnaf istisnasına sokmaz. Hedef kişi grupları ayrı değerlendirilir.
- **"Kaynak notu + aydınlatma bağlantısı = gönderim hakkı" değildir.**
  - KVKK, internette veya sosyal medyada açık bulunan kişisel verilerin reklam amacıyla kullanılmasını otomatik olarak hukuka uygun saymıyor (alenileştirme duyurusu).
  - Veri kaynağı, işleme şartı ve aydınlatma ayrı ayrı değerlendirilir.
  - Bugünkü kaynak notu ve zorunlu aydınlatma bağlantısı gereklidir ama tek başına yeterli değildir.
- **Ryzevo'nun rolü sabitlenmez.**
  - Ryzevo kendi aday havuzunu oluşturuyor, kullanım amacını belirliyor veya veriyi müşteriler arasında yeniden kullanıyorsa rolü değişebilir.
  - Roller veri akışı bazında belirlenir.

**Avukata sorular:**
1. Her veri akışında Ryzevo ve müşterinin rolü ne? (Firma bulma, sitelerden ad-unvan, LinkedIn tanıdıkları, Hunter, gönderim, yanıt işleme.) Veri işleme sözleşmesi hangi maddeleri içermeli?
2. Kişinin iş adresine soğuk B2B e-posta için işleme şartı ne olabilir? Meşru menfaat mi? Dengeleme testi nasıl belgelenir? İlk e-postadaki aydınlatma yeterli mi?
3. İYS'ye tacir/esnaf kaydı hangi adımda, hangi alıcı tipi ve kaynakla yapılmalı? Şirket adresi olan çalışanlar hangi gruba girer?
4. 6563 kapsamında gönderen müşteri, gönderimi yapan Ryzevo: Ryzevo'nun "aracı hizmet sağlayıcı" yükümlülükleri neler?
5. Yurt dışı aktarım (AWS, Hunter, DataForSEO, IPinfo, yapay zekâ sağlayıcısı) ve alt hizmet sağlayıcılar nasıl ele alınmalı?
6. Müşteri adına benzer alan adı (ör. firma-mail.com) almak marka ve tüketici açısından sorun doğurur mu? Kimin adına kayıtlı olmalı, müşteri ayrılınca ne olur?
7. Müşterinin kötü kullanımında Ryzevo'nun sorumluluğunu sınırlayan kullanım şartları nasıl yazılmalı?

## 7. Pilot

**Kapsam:**
- 5–10 doğrulanmış şirket, dar hedef kitle, kontrollü gönderim.
- Gönderim ancak sağlayıcı uygunluğu ve hedef pazarın hukuki koşulları netleşince açılır.

**Güvenlik kuralları (bugünkü kodda da geçerli):**
- Her kalıcı geri dönüşte o adres engellenir ve firma "bir daha yazma" listesine girer.
- **İlk şikâyette tüm satış gönderimi durur**; bir bağlantı yöneticisi inceleyip devam ettirir.
- Oranlar zaman penceresi ve örneklem büyüklüğüyle birlikte gösterilir: 14 gün, kaç e-posta, kaç geri dönme, kaç şikâyet.
  - 20 e-postanın altında oran yerine adet konuşulur.
  - Örnek: 50 gönderimde tek şikâyet %2'dir. Yalnız "%0,1 şikâyet eşiği" yazmak eksik bir kuraldır.
- Yanıt veya ret gelince planlanmış takipler iptal edilir.
- **Askıya alınan veya gönderen alan adı değişen gönderim, başka bir alan adına veya sağlayıcıya kendiliğinden taşınmaz**: gönderim durur ve bir kişi onaylar.
- **Kapasite sonuçlara göre artar:**
  - 10 ile başlar.
  - Gerçekten gönderim yapılan her gün için 5 artar, en çok 50'ye kadar.
  - Son 7 günde şikâyet varsa veya geri dönme %2'yi aşarsa yarıda tutulur.

## 8. Kodda hazır olanlar

| Parça | Dosya |
|---|---|
| Satış alan adı: ayrı alan adı, yanıtlar gerçek adrese, DKIM/DMARC kontrolü, alan adına göre kapasite | `crewinjob-web/lib/platform/outreach-domain.ts` |
| Gönderim güvenlikleri: mesai saatleri, sonuca göre kapasite, ilk şikâyette durma, tek tık çıkış, "bir daha yazma" listesi, İYS ret kontrolü, kişi adreslerinde kaynak notu ve zorunlu aydınlatma bağlantısı, takip öncesi ekip uyarısı | `crewinjob-web/lib/platform/prospect-outreach.ts` |
| Karar verici bulma ve müşteri grupları (sonuçlarıyla) | `prospect-people.ts`, `prospect-segments.ts` |

## 9. Yönetimli model: kodda hazır (schema 85, anahtar kapalı)

Gönderimi açmak için hâlâ şunlar gerekiyor:
- kullanımı yazılı olarak kabul eden bir sağlayıcı,
- avukat görüşü,
- `PLATFORM_MANAGED_SENDING_ENABLED=1`.

Kod hazır:

| Parça | Ne yapıyor | Dosya |
|---|---|---|
| Sağlayıcı bağdaştırıcısı | Tek arayüz. Amazon SES: ayrı hesap, kiracı (tenant) desteği, MIME ile gönderim. Sandbox: hiç göndermez, pilot provası içindir. Sağlayıcı `PLATFORM_MANAGED_PROVIDER` ile seçilir. | `crewinjob-web/lib/platform/sending-providers.ts` |
| Yanıt girişi | Aşağıda ayrıntılı. | `outreach-inbound.ts` |
| Yönetimli alan adı | Operatör alan adını ekler, kontrol eder ve tek bir müşteriye ayırır. Bırakılan alan adı başka müşteriye verilmez. Yeni alan adı süren dizileri durdurur. Şirket adına gönderim yetkisini yalnız projenin sahibi, sürümlü bir metinle onaylar. | `managed-sending.ts` |
| Kredi defteri | Aşağıda ayrıntılı. | `managed-sending.ts` |
| Pilot listesi | En çok 10 etkin şirket. Operatör, şirketi ve yetkilisini doğruladığını işaretler. Günlük üst sınır (en çok 50). Durdurma nedeni zorunlu. Pilot şirket kendi göndericisine asla geri düşmez. | `managed-sending.ts` |
| Müşteri ekranı | Satış ayarları: 4 aşama, ayrılan alan adı, yetki onayı, kalan kredi, gönderilen e-posta, ilgilenen yanıt, ilgilenen yanıt başına maliyet, son yanıtlar. Firma kartında gelen yanıt. | `components/platform/ManagedSending.tsx` |
| Operatör ekranı | Pilotlar, kredi ekleme, durdurma, alan adı ekleme, kontrol, atama ve bırakma. | `components/platform/ManagedOperator.tsx` (Operasyon sayfası) |

**Yanıt girişi:**
- Her dizinin kendine ait yanıt adresi var (`r-<dizi>.<kontrol>@alan-adı`). Kontrol kısmı sunucu anahtarıyla üretiliyor, uydurma bir adres eşleşmez.
- Yanıt, Message-ID referansıyla da eşleşir.
- Yanıt gelince takipler hemen durur:
  - "Otomatik yanıt / izindeyim" takibi yalnız bir hafta öteler.
  - "Listeden çıkarın" adresi ve firmayı engeller.
  - Kalan yanıtları yapay zekâ sınıflandırır; yapay zekâ yoksa ekip seçer.
- Yanıt, alan adını onaylayan kişiye sistem e-postasıyla iletilir.
- Yanıt şifreli olarak 30 gün saklanır.
- Giriş yolları:
  - Amazon SES için `/api/mail/managed/ses` (SNS imzası doğrulanır).
  - Diğer sağlayıcılar için `/api/mail/inbound` (HMAC imzalı JSON, 5 dakikalık zaman penceresi).

**Kredi defteri:**
- Ön ödemeli; 1 kredi = 1 e-posta.
- Takip e-postaları `PLATFORM_MANAGED_FOLLOWUPS_CHARGED` ile ayarlanır (varsayılan: kredi kullanır).
- Kredi, sağlayıcıya gönderimden hemen önce düşülür. Gönderimden önce elenen e-posta kredi kullanmaz.
- Sağlayıcının reddettiği e-postanın kredisi iade edilir.
- Operatör kredi ekler ya da düzeltir; bakiye eksiye düşmez.

**Sunucu ayarları** (`deployment/windows/.env.example`, hepsi kapalı başlar):
- `PLATFORM_MANAGED_SENDING_ENABLED`
- `PLATFORM_MANAGED_PROVIDER`
- `PLATFORM_MANAGED_SES_REGION`, `PLATFORM_MANAGED_SES_ACCESS_KEY_ID`, `PLATFORM_MANAGED_SES_SECRET_ACCESS_KEY`
- `PLATFORM_MANAGED_SES_CONFIGURATION_SET`
- `PLATFORM_MANAGED_SES_TENANTS`
- `PLATFORM_MANAGED_SES_TOPIC_ARN`
- `PLATFORM_MANAGED_INBOUND_SECRET`
- `PLATFORM_MANAGED_PRICE_USD`
- `PLATFORM_MANAGED_FOLLOWUPS_CHARGED`

**Henüz yok** (pilot sonrası):
- Kredi satın alma ödemesi: şimdilik operatör ekliyor.
- Alan adını otomatik satın alma ve DNS kurulumu: şimdilik operatör yapıyor.
- İYS'ye tacir/esnaf kaydı adımı: avukat görüşüyle eklenecek.
