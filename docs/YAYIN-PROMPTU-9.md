# Yayın promptu 9 (ryzevo.com, 12 Kasım 2026): Crewin verisi SQL Server'a (Aşama 4)

`docs/YAYIN-PROMPTU-8.md`'den sonra uygula. Bu metni ryzevo.com'u yayınlayan kişiye (veya kod ajanına) olduğu gibi
iletin. Ayrıntılar `docs/SAAS-MSSQL.md` içinde, "Phase 2", "Phase 3" ve "Phase 4" bölümlerinde.

---

Sen ryzevo.com'u yayınlayan ve sunucusunu yöneten geliştiricisin. Depo: `creWinplatform/creWinMarketing`, dal `main`,
uygulama `crewinjob-web`, ajan `crewinjob-agent`. Canlı site platform verisi için SQL Server'ı (AWS RDS, veritabanı
`Ryzevo`) `PLATFORM_DATABASE_PROVIDER=mssql` ile kullanıyor. Crewin çalışma alanının verisi ise hâlâ sunucudaki JSON
dosyalarında:
- panelin `data/*.json` dosyaları: içerik geçmişi, takvim, kampanyalar, zamanlanmış gönderiler, SEO kartları…;
- ajanın dosyaları: `job-queue.json`, `.userbot-groups.json`, `data/*.json(l)`.

Bu yayınla bu veri `Ryzevo` veritabanına taşınabilir hale geliyor.

## Kurallar

- **Sırlar:** Ayar değerlerini (bağlantı dizesi, şifre, anahtar, token) hiçbir çıktıya, commit'e veya rapora yazma.
- **Sıra:** Adımları sırayla uygula. Bir adım hata verirse dur, sonraki adıma geçme ve hatayı raporla.
- **Dosyalar:** JSON dosyalarını silme, taşıma veya düzenleme. Geri dönüş yolu onlar.
- **Veritabanı:** `Ryzevo`'ya yalnızca aşağıdaki iki komut yazar: `db:upgrade -- --apply` ve
  `db:copy-legacy -- --live`. Başka yazma işlemi yapma.
- **Komutların çalıştığı yer:** Bütün komutlar sunucuda, `crewinjob-web` klasöründe (Docker'da konteynerin içinde)
  çalışır. Bağlantı dizesi orada `appsettings.json` içinde ya da `PLATFORM_MSSQL_CONNECTION` ortam değişkeninde.

## A. Kod, yedek ve şema 79 (her zaman güvenli)

### A1. Yayınlanacak kod

`main`'in son hâlini yayınla. Bu turdaki iş:

- **Crewin depoları için yeni katman:** panelde `lib/legacy-store.ts`, ajanda `crewinjob-agent/modules/store.js`.
  - Ayar kapalıyken (varsayılan) her şey eskisi gibi dosyalardan çalışır.
  - **`PLATFORM_LEGACY_STORE` ayarını bu adımda ekleme.**
- **SQL Server için yedek, doğrulama, tatbikat ve izleme:**
  - `backup:platform`, `verify:backup`, `restore:drill`, `offsite:platform` ve `monitor:platform` artık SQL Server ile
    de çalışıyor.
  - Hangisinin kullanılacağına `PLATFORM_DATABASE_PROVIDER=mssql` karar verir.
- **Yeni komutlar:** `db:upgrade` ve `db:copy-legacy -- --live`.
- **Şema:** kod şema 79'u bekliyor. Canlı veritabanı şu an 78'de; A3 adımı onu 79'a getirir.
- **Yeni paket yok;** `npm ci` yeterli.

### A2. Yedek (yalnızca okur)

```bash
PLATFORM_DATABASE_PROVIDER=mssql npm run backup:platform
```

- Çıktıda `Platform backup completed: … (SQL Server … / Ryzevo, schema 78, … tables, … rows, …)` satırını ara.
- Yedek klasörü `PLATFORM_BACKUP_PATH` altındadır (varsayılan `data/backups`).
- Şifreleme anahtarı:
  - anahtar `data/platform-credentials.key` dosyasındaysa yedeğe kopyalanır;
  - `PLATFORM_ENCRYPTION_KEY` ortam değişkenindeyse kopyalanmaz.
- Sonra yedeği doğrula:

```bash
npm run verify:backup -- <yedek klasörü>
```

`"ok":true` ve `"provider":"mssql"` görmelisin. Şifreli kayıt varsa `"credentialCheck":"authenticated"` da görmelisin.

### A3. Şema 79: Crewin depoları için iki boş tablo

```bash
npm run db:upgrade
```

Bu komut yalnızca plan gösterir; şunları beklersin:
- `Schema: database 78, code 79`
- `+ table legacy_records`
- `+ table legacy_stores`
- `+ index legacy_records_order`
- `+ record schema version(s) 79`

Planda başka bir şey varsa (özellikle "Columns missing" hatası) **dur ve raporla**. Plan buysa uygula:

```bash
npm run db:upgrade -- --apply
```

- Komut, A2'deki yedeğin bu veritabanına ait, son 24 saat içinde alınmış ve doğrulanmış olduğunu kendisi kontrol eder.
- Değişikliği tek bir transaction'da uygular.
- Beklenen çıktı: `Applied 3 change(s); schema 79.`
- Tablolar boş kalır. Ayar kapalı olduğu için sitenin davranışı değişmez.

### A4. Kontrol

1. Paneli (ve worker'ı) yeniden başlat.
2. Şu komutu çalıştır:

   ```bash
   PLATFORM_DATABASE_PROVIDER=mssql npm run monitor:platform
   ```

   Çıktıda şunları görmelisin:
   - `"provider":"mssql"`
   - `"database":{"status":"readable","schemaVersion":79}`
   - `"backup":{"status":"verified",…}`
3. Crewin çalışma alanında içerik kütüphanesini, takvimi, SEO kartlarını ve ilan kuyruğunu aç. Hepsi eskisi gibi
   dolu görünmeli, çünkü veri hâlâ dosyalardan geliyor.

## B. Crewin verisinin kopyası ve ayarın açılması (kısa bakım penceresi)

Bu bölümün süresi:
- Gerçek veri yaklaşık 31 MB; en büyükleri 22 MB'lık içerik geçmişi ve 6 MB'lık inceleme kuyruğu.
- Kopya genellikle birkaç dakika sürer.

**Kopya ile ayarın açılması arasında hiçbir şey dosyalara yazmamalı.** Bu yüzden önce her şeyi durdur.

### B1. Durdur

Şunları durdur:
- panel;
- worker;
- ajan süreçleri: pipeline zamanlayıcısı, userbot, Telegram botu ve varsa zamanlanmış ajan görevleri (cron).

### B2. Taze yedek

A2'yi tekrarla: `backup:platform` ve ardından `verify:backup`. Kopya komutu en yeni yedeğe bakar.

### B3. Kopya

```bash
npm run db:copy-legacy -- --live
```

- Panelin `data` klasörünü ve ajan klasörünü bulur (`CREWIN_WEB_DATA_DIR` / `CREWINJOB_AGENT_DIR`; Docker'da genellikle
  `/crewinjob-agent`). Farklıysa yolları açıkça ver:

  ```bash
  npm run db:copy-legacy -- --live --web-data <panel data> --agent-dir <ajan klasörü>
  ```

- Komut yalnızca dosyaları okur.
- Tablo yoksa, yedek taze değilse veya `PLATFORM_LEGACY_STORE=mssql` zaten açıksa çalışmayı reddeder.
- Çıktıdaki tabloda her satır `ok` ya da `skipped` (o dosya hiç yok) olmalı.
  - `DIFFERENT` ya da `exists` görürsen **dur ve raporla.** Ayarı açma; B1'de durdurduklarını ayar olmadan yeniden
    başlat.
- Ardından tabloyu yeniden karşılaştır:

  ```bash
  npm run db:copy-legacy -- --live --verify-only
  ```

  Her satır yine `ok` olmalı.

### B4. Ayarı aç

`PLATFORM_LEGACY_STORE=mssql` ayarını şunlara ekle:
- panelin ortamına (`.env.local` ya da konteyner ortamı);
- tek başına başlatılan ajan süreçleri varsa ajanın `.env` dosyasına. Panelin başlattığı ajan süreçleri ayarı panelden
  devralır.

`PLATFORM_DATABASE_PROVIDER=mssql` yerinde kalsın. Sonra B1'de durdurduklarını başlat.

### B5. Kontrol

1. Crewin çalışma alanında şunları aç ve verinin aynı olduğunu gör:
   - içerik kütüphanesi;
   - takvim;
   - kampanyalar;
   - zamanlanmış gönderiler;
   - SEO kartları;
   - ilan kuyruğu ve inceleme kuyruğu (Otomasyon);
   - userbot grupları;
   - aktivite günlüğü.
2. Yalnızca kendi oluşturduğun bir test kaydıyla yazmayı dene, sonra sil. Örnek: takvime test etkinliği ekle ve sil.
3. Bu testte JSON dosyalarının değişiklik tarihi değişmemeli; yazma artık veritabanına gidiyor.

### Geri dönüş

- `PLATFORM_LEGACY_STORE` ayarını kaldırıp paneli ve ajanı yeniden başlat. Her şey dosyalara döner.
- Ayar açıkken yapılan yazmalar yalnızca tablolarda kalır. Geri dönmen gerekirse bunu raporda belirt.

## C. Yedek ve tatbikat düzeni (SQL Server)

- **Zamanlanmış yedek:** `backup:platform` görevi `PLATFORM_DATABASE_PROVIDER=mssql` ile çalışmalı. Artık her gece
  SQL Server'dan alınır. RDS'in kendi otomatik anlık görüntüleri (snapshot) ayrıca devam eder.
- **Haftalık tatbikat:** `npm run restore:drill -- --latest` sunucuya dokunmadan doğrular.
  - `--server` seçeneğini yalnızca canlıdan ayrı bir tatbikat sunucusu varsa kullan. Sunucuyu
    `PLATFORM_DRILL_MSSQL_CONNECTION` ile belirt; canlı ayar dosyası bu iş için hiç kullanılmaz.
- **İzleme:** `monitor:platform` aynı ayarla SQL Server'ı izler.

## Rapor

1. Yayınlanan commit.
2. A2: yedek klasörünün adı, şema, tablo ve satır sayısı, `verify:backup` sonucu (değer içermeden).
3. A3: `db:upgrade` planı ve `--apply` çıktısı.
4. A4: `monitor:platform` özeti (provider, schemaVersion, backup durumu, varsa uyarı kodları).
5. B yapıldıysa:
   - `db:copy-legacy` tablosu (depo adı, satır sayısı, sonuç);
   - `--verify-only` sonucu;
   - ayarın açıldığı saat;
   - B5'teki kontroller.
6. B yapılmadıysa nedeni.
