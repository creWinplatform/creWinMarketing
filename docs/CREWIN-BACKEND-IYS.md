# Crewin backend'i için İYS isteği (30 Ekim 2026)

Bu belge Crewin ABP backend ekibi içindir (`api.crewin.org`). Pazarlama panelinin İYS tarafı hazır; eksik olan, kullanıcıların pazarlama izinlerinin backend'den panele gelmesi. Ekibe ya da kod asistanına doğrudan verilecek kısa metin: `docs/CREWIN-BACKEND-IYS-PROMPT.md`.

## Bugünkü durum (panel)
- **Beyan ve bağlantı:** Crewin, İYS beyanını ve İYS bağlantısını panelde yapar (Proje ayarları → Gönderim izinleri).
- **WhatsApp:** +90 numaralar için İYS onayı aranır (`docs/CREWIN-WHATSAPP-CONSENT.md`).
- **E-posta:**
  - Re-aktivasyon, iş eşleşme ve panelin gönderdiği kampanyalar İYS kapısından geçer.
  - Kapı uyruğu TR olan ya da bilinmeyen alıcılara uygulanır; şirket ve prospect kitleleri tacir muafiyetiyle dışarıda.
  - Kapı şimdilik ölçüm modunda: e-postalar gider, yalnız "İYS zorunlu olsaydı kaç alıcı atlanacaktı" sayılır.
- **İYS'ye bildirim:** panelin kuyruğu yapar (3 iş günü süresi, yeniden deneme, ekip uyarıları). Backend'in İYS'ye doğrudan bağlanması **gerekmez** (karar: 30 Ekim 2026).
- **Eksik:** kayıt ve profil ekranında verilen izinler ile backend'deki çıkışlar panele gelmiyor. Bu yüzden İYS'ye bildirilemiyorlar ve e-posta kapısı zorunlu moda geçemiyor.

## Backend'den beklenenler

### 1. İzin kaydı (veri modeli)
Her kullanıcı ve kanal için izin geçmişi tutulur. Her değişiklik ayrı bir satırdır; geçmiş silinmez.

| Alan | Açıklama |
|---|---|
| `changeId` | Artan, benzersiz kimlik (imleç bunun üzerinden ilerler) |
| `userId` | Kullanıcı |
| `channel` | `EPOSTA`; telefonla pazarlama izni alınıyorsa `MESAJ` |
| `address` | E-posta adresi ya da E.164 telefon (`+905321234567`) |
| `status` | `ONAY` ya da `RET` |
| `occurredAt` | UTC zaman, ISO 8601 (`2026-10-30T12:34:56Z`) |
| `source` | İYS kaynak kodu (aşağıda) |
| `origin` | `signup`, `profile`, `renewal`, `unsubscribe`, `complaint`, `admin` |
| `textVersion` | Kullanıcıya gösterilen onay metninin sürümü |

**İYS kaynak kodları:** panel şu değerleri kabul eder:
- `HS_WEB` (web sitesi formu);
- `HS_MOBIL` (mobil uygulama);
- `HS_EPOSTA`;
- `HS_MESAJ`;
- `HS_SOSYAL_MEDYA`;
- `HS_FIZIKSEL_ORTAM`;
- `HS_ISLAK_IMZA`;
- `HS_CAGRI_MERKEZI`;
- `HS_ETKINLIK`.

Kayıt ve profil için çoğunlukla `HS_WEB` ya da `HS_MOBIL` kullanılır.

### 2. Kayıt ve profil ekranı
- **İzin kutusu:**
  - Kayıtta ayrı, işaretsiz ve zorunlu olmayan bir kutu olur: "İlan ve fırsat e-postaları almak istiyorum".
  - Metin açık olmalı ve sürümü tutulmalı.
  - İşaretlenince `ONAY` yazılır; işaretlenmezse izin kaydı yazılmaz.
- **Profil:** aynı izin açılıp kapatılabilir. Açmak `ONAY`, kapatmak `RET` yazar.
- **Çıkış yolları `RET` yazar:**
  - `GrowthAnalytics/ProcessUnsubscribe` (e-postadaki çıkış bağlantısı);
  - şikâyetler (`email_complained`, `GrowthAnalytics/SuppressContact`).
- **Mevcut `emailOptOut` bayrağı:** bu kayıtla tutarlı kalır; son `RET` onu `true` yapar.

### 3. Eski kullanıcılar için izin yenileme
- Tarihli izin kaydı olmayan mevcut kullanıcılara girişte ve profilde **bir kez** sorulur.
- Yanıt yeni tarihli bir `ONAY` ya da `RET` olur (`origin: renewal`). 3 iş günü içinde bildirildiği için İYS'ye yüklenebilir.
- **İzin istemek için e-posta, SMS ya da WhatsApp gönderilmez.** İzin talebi de ticari ileti kurallarına takılabilir; soru yalnız uygulamanın içinde sorulur.
- Yanıt vermeyen kullanıcıya, panel zorunlu moda geçtikten sonra pazarlama e-postası gitmez.
- Gerekçe: İYS, 3 iş gününden eski izinlerin API ile yüklenmesini kabul etmiyor. Eski izinleri yeniden almak hukuken en temiz yol (karar: 30 Ekim 2026).

### 4. Yeni uç: izin değişiklikleri
`GET /api/services/app/GrowthAnalytics/GetMarketingConsentChanges?after=<imleç>&take=500`
- **Kimlik doğrulama:** panelin bugünkü servis hesabı girişi (`crewinjob-agent/modules/api.js`).
- **Sayfalama:**
  - `after` boş ya da `0` olursa en baştan başlar;
  - `take` en çok 500;
  - `next`, son dönen `changeId` değeridir.
- **Yanıt** (ABP `{ result }` zarfı içinde):
  ```json
  { "items": [ { "changeId": 1201, "userId": 4512, "channel": "EPOSTA", "address": "ornek@example.com",
                 "status": "ONAY", "occurredAt": "2026-10-30T09:15:02Z", "source": "HS_WEB",
                 "origin": "signup", "textVersion": "2026-10" } ],
    "next": 1201 }
  ```
- **Kurallar:**
  - İmleç yalnız ileri gider. Aynı değişiklik iki kez gelirse panel tarafında zararsızdır.
  - Aynı kullanıcı için `RET`, kendisinden önceki `ONAY`'ı geçersiz kılar. Sıralama `changeId` ile yapılır.
  - Silinen kullanıcılar için son durum `RET` olarak yayımlanır, adres yine dahil.
  - Hata durumunda 5xx dönülür; panel bir sonraki çalışmada aynı imleçle yeniden dener.

### 5. Alıcı listeleri
`GetCampaignRecipients` ve `GetSeafarersByFillBucket` her alıcı için şu alanları da döndürsün:
- `nationality`: ISO 3166-1 alfa-2 (`TR`, `PH` …). Panel, uyruğu TR olan ya da bilinmeyen alıcılara İYS uygular.
- `marketingConsent: { status: 'ONAY' | 'RET' | null, at }`: bu kanalın son izin durumu.

### 6. Backend'in kendi gönderimi (Dispatch)
- E-posta tek kanallı ve backend şablonu olan kampanyalar, panel yerine backend'in Dispatch mekanizmasıyla gidiyor (`crewinjob-web/lib/campaign-dispatch.ts`, `canUseBackendDispatch`). Bu gönderimler panelin İYS kapısından **geçmiyor**.
- **Backend'den beklenen:**
  - Bireysel kitlelerde Dispatch, uyruğu TR olan ya da bilinmeyen ve `marketingConsent` durumu `ONAY` olmayan alıcıyı göndermeden atlasın.
  - Atlananlar Dispatch sayaçlarında (`skipped`) görünsün.
  - Prospect kitlesi tacir muafiyetiyle bu kuralın dışında kalır.
- İYS'deki güncel durum (İYS tarafında verilen retler) panelde tutuluyor. Backend bu kuralı uygulayana kadar panel, zorunlu modda bireysel kitlelerin kampanyalarını Dispatch yerine kendi İYS kontrollü gönderimine yönlendiriyor (yapıldı, 30 Ekim 2026). Bu gönderim tek seferde en çok 500 alıcıyla sınırlı; büyük kampanyalar için backend'in bu kuralı uygulaması gerekiyor.
- **Soru:** Dispatch dışında backend'in kendiliğinden gönderdiği ticari e-posta var mı (otomatik hatırlatma, bülten …)? Varsa listesi ve aynı kural.

### 7. Hukuk için tek seferlik rapor
- Kaynak (`source`) ve yıl kırılımında izinli, izinsiz ve çıkmış kullanıcı sayıları.
- Uyruğu TR olan ya da bilinmeyen kullanıcılar ayrıca sayılır.
- Adres ve kimlik içermez.

## Kabul ölçütleri
- Kayıtta kutu işaretlenince 1 dakika içinde uçta `ONAY` görünür; profilde kapatınca `RET` görünür.
- `ProcessUnsubscribe` ve `SuppressContact` çağrısından sonra uçta `RET` görünür.
- `after=<son next>` çağrısı yeni değişiklik yoksa boş `items` ve aynı `next` döner.
- 1000 değişiklik `take=500` ile iki sayfada, kayıpsız ve sıralı gelir.
- Saat dilimi her alanda UTC'dir (`Z`).
- Alıcı listelerinde `nationality` ve `marketingConsent` dolu gelir.
- Dispatch, bireysel kitlede izinsiz alıcıyı atlar ve `skipped` sayısını artırır.

## Hazır olunca panelde yapılacaklar
Bunlar ayrı bir onayla yapılır; uç kesinleşmeden kod yazılmaz.
- **`crewinjob-agent/modules/api.js`:** `getMarketingConsentChanges(after)` sarmalayıcısı.
- **Yeni worker adımı `crewinjob-web/lib/crewin-iys-backend.ts`:**
  - imleci `data/crewin-iys-backend-cursor.json` dosyasında tutar;
  - her değişikliği `queueIysConsent(db, LEGACY_SCOPE, key, { channel, recipient: address, status, source, consentDate: occurredAt, actor: 'crewin-backend' })` ile kuyruğa koyar: `EPOSTA` her adres için, `MESAJ` yalnız +90 numaralar için;
  - 3 iş gününden eski `ONAY` (`too_old`) ayrıca sayılır.
- **E-posta kapısı:** `marketingConsent` `RET` ya da boşsa, zorunlu modda alıcı İYS'ye sorulmadan atlanır; ölçüm modunda ayrı sayılır.
- **Dispatch:** backend 6. maddeyi uyguladığında, zorunlu moddaki panel yönlendirmesi (`crewinDispatchAllowed`) kaldırılır ve büyük kampanyalar yeniden Dispatch'le gider.
- **İYS paneli (Crewin):** backend izin akışının son okuma zamanı, kuyruğa alınanlar ve "çok eski" sayısı.
- **Testler:** sahte backend ve sahte İYS ile imleç, tekrar, `ONAY`/`RET` sırası, +90 kuralı, "çok eski", Dispatch yönlendirmesi.
