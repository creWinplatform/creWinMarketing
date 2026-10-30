# Crewin backend ekibine İYS geliştirme promptu (30 Ekim 2026)

> Bu metin Crewin ABP backend'inde (`api.crewin.org`) çalışacak geliştiriciye ya da kod asistanına olduğu gibi verilir.
> Ayrıntılı istek ve gerekçe: `docs/CREWIN-BACKEND-IYS.md`.

---

CrewinJob kullanıcılarının (denizciler) pazarlama izinlerini İYS (İleti Yönetim Sistemi) kurallarına uygun hâle getireceğiz. Pazarlama paneli İYS beyanını, bağlantısını, gönderim kapısını ve İYS'ye bildirimi zaten yapıyor. Backend'den beklenen, izin verisini tarihli ve kaynaklı tutmak ve panele sunmak.

**Backend İYS'ye doğrudan bağlanmayacak.** İYS'ye ONAY ve RET bildirimini panelin kuyruğu yapıyor (3 iş günü süresi, yeniden deneme, uyarılar).

## Başlamadan önce
- Mevcut yapıyı inceleyin:
  - kullanıcı ve profil entity'leri, `emailOptOut` alanı;
  - `GrowthAnalytics` servisi (`ProcessUnsubscribe`, `SuppressContact`, `GetCampaignRecipients`, `TrackActivationEvent`);
  - `GemiAdamiGenel/GetSeafarersByFillBucket`;
  - `MarketingCampaign` / `MarketingProspect` Dispatch akışı.
- Yeniden kullanım ve eksik matrisini çıkarın. Aynı işi yapan ikinci bir tablo, servis ya da bayrak oluşturmayın; mevcut olanı genişletin.
- Uç ve alan adlarını aşağıdaki sözleşmeden sapmadan uygulayın. Sapmanız gerekirse gerekçesiyle yazın ve Swagger'daki kesin hâlini teslim edin.

## Yapılacaklar
1. **İzin geçmişi (yeni tablo ya da mevcut tablonun genişletilmesi).** Her değişiklik ayrı satırdır; geçmiş silinmez. Alanlar:
   - `changeId`: artan, benzersiz;
   - `userId`;
   - `channel`: `EPOSTA`, telefonla pazarlama izni alınıyorsa `MESAJ`;
   - `address`: e-posta ya da E.164 telefon;
   - `status`: `ONAY` / `RET`;
   - `occurredAt`: UTC;
   - `source`: İYS kaynak kodu (`HS_WEB`, `HS_MOBIL`, `HS_EPOSTA`, `HS_MESAJ`, `HS_SOSYAL_MEDYA`, `HS_FIZIKSEL_ORTAM`, `HS_ISLAK_IMZA`, `HS_CAGRI_MERKEZI`, `HS_ETKINLIK`);
   - `origin`: `signup`, `profile`, `renewal`, `unsubscribe`, `complaint`, `admin`;
   - `textVersion`: gösterilen onay metninin sürümü.
2. **Kayıt ve profil:**
   - Kayıtta ayrı, işaretsiz, zorunlu olmayan izin kutusu: "İlan ve fırsat e-postaları almak istiyorum". İşaretlenince `ONAY`.
   - Profilde aç/kapa: `ONAY` / `RET`.
   - `emailOptOut` her zaman son duruma göre güncellenir.
3. **Çıkış yolları `RET` yazar:**
   - `ProcessUnsubscribe`;
   - `SuppressContact`;
   - `email_complained`;
   - hesap silme (silinen kullanıcı için son durum `RET` yayımlanır, adres dahil).
4. **İzin yenileme:**
   - Tarihli izin kaydı olmayan mevcut kullanıcılara girişte ve profilde **bir kez**, uygulama içinde sorulur.
   - Yanıt `origin: renewal` ile yeni tarihli `ONAY` ya da `RET` olur.
   - İzin istemek için e-posta, SMS ya da WhatsApp gönderilmez.
5. **Yeni uç `GET /api/services/app/GrowthAnalytics/GetMarketingConsentChanges?after=<long>&take=<int>`:**
   - Panelin mevcut servis hesabı girişiyle (`TokenAuth/Authenticate`) çalışır; anonim değildir.
   - `after` boş ya da 0 ise en baştan başlar. `take` en çok 500'dür.
   - Sıralama `changeId` artan. Yanıt ABP `{ result }` zarfında `{ items: [...], next }` döner; `next` son dönen `changeId` değeridir, yeni kayıt yoksa `after`'ın aynısı.
   - Örnek öğe: `{ "changeId": 1201, "userId": 4512, "channel": "EPOSTA", "address": "ornek@example.com", "status": "ONAY", "occurredAt": "2026-10-30T09:15:02Z", "source": "HS_WEB", "origin": "signup", "textVersion": "2026-10" }`.
6. **Alıcı listeleri:** `GetCampaignRecipients` ve `GetSeafarersByFillBucket` her alıcıda şu alanları da döndürür:
   - `nationality`: ISO 3166-1 alfa-2;
   - `marketingConsent: { status: "ONAY" | "RET" | null, at }`.
7. **Dispatch:**
   - Bireysel kitlelerde, uyruğu `TR` olan ya da bilinmeyen ve son izni `ONAY` olmayan alıcı gönderilmeden atlanır; Dispatch sayaçlarındaki `skipped` artar.
   - Prospect ve şirket kitleleri (tacir muafiyeti) bu kuralın dışındadır.
   - Dispatch dışında backend'in kendiliğinden gönderdiği ticari e-posta varsa listesini çıkarın; aynı kural ona da uygulanır.
8. **Hukuk raporu (tek seferlik):** kaynak ve yıl kırılımında izinli, izinsiz ve çıkmış kullanıcı sayıları. Uyruğu `TR` olan ya da bilinmeyenler ayrıca sayılır. Adres ve kimlik içermez.

## Kurallar
- **Zaman:** her yerde UTC, ISO 8601, `Z` ekiyle.
- **Gizlilik:**
  - Adresler yalnız 5. madde ucunda ve alıcı listelerinde döner. Loglara adres yazılmaz.
  - Uç yalnız servis hesabına açıktır.
- **Migration:**
  - Mevcut `emailOptOut=true` kullanıcılar için başlangıç `RET` kaydı yazılır (`origin: admin`, tarih = migration anı).
  - Diğer mevcut kullanıcılar için izin kaydı **uydurulmaz**; bunlar 4. maddedeki yenilemeyi bekler.
  - Migration öncesi yedek alınır, kayıt sayıları kontrol edilir ve geri alma adımı yazılır.
- **Geri uyumluluk:** mevcut uçların yanıtına yalnız alan eklenir; var olan alan değişmez.

## Teslim edilecekler
1. Swagger'daki kesin route, metot, parametreler ve yetki.
2. Her uç için örnek istek ve ABP yanıtı, hata kodları.
3. Migration notu (yedek, sayılar, geri alma).
4. Bu kabul ölçütlerini kapsayan testler ve test ortamında (staging) denenebilir bir sürüm:
   - kayıtta kutu işaretlenince bir dakika içinde uçta `ONAY` görünür; profilde kapatınca `RET`;
   - `ProcessUnsubscribe` ve `SuppressContact` sonrasında uçta `RET` görünür;
   - `after=<son next>` yeni kayıt yoksa boş `items` ve aynı `next` döner;
   - 1000 değişiklik `take=500` ile iki sayfada, kayıpsız ve sıralı gelir;
   - alıcı listelerinde `nationality` ve `marketingConsent` dolu gelir;
   - Dispatch, bireysel kitlede izinsiz alıcıyı atlar ve `skipped` artar.
5. 8. maddedeki sayı raporu.

Bu iş tamamlanınca panel tarafı imleçle bu ucu okuyup değişiklikleri İYS'ye bildirecek. E-posta kapısı ölçüm modundan zorunlu moda bu verilerle geçecek.
