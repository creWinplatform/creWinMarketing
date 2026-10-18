# Bug Raporu — GetSeafarersByFillBucket Sayfalama Çalışmıyor

**Tarih:** 9 Ağustos 2026
**Bildiren:** Pazarlama / Growth
**Alıcı:** crewinjob.com backend ekibi
**Öncelik:** 🔴 Yüksek — e-posta re-aktivasyon kampanyasını fiilen engelliyor
**Etkilenen endpoint:** `GET /GemiAdamiGenel/GetSeafarersByFillBucket`

---

## Özet

`page` parametresi hiçbir etki yapmıyor — hangi sayfa istenirse istensin **her zaman aynı ilk 10 kayıt** dönüyor. `size` parametresi de göz ardı ediliyor, her zaman sabit 10 kayıt geliyor. Sonuç: 6.413 kişilik bir segmentten yalnızca **10 kişiye** erişilebiliyor, geri kalan ~6.400 kişiye hiçbir şekilde ulaşılamıyor.

---

## Yeniden üretme adımları

```
GET /GemiAdamiGenel/GetSeafarersByFillBucket?bucket=zero&page=1&size=50
GET /GemiAdamiGenel/GetSeafarersByFillBucket?bucket=zero&page=2&size=50
GET /GemiAdamiGenel/GetSeafarersByFillBucket?bucket=zero&page=3&size=50
GET /GemiAdamiGenel/GetSeafarersByFillBucket?bucket=zero&page=100&size=10
```

## Gözlemlenen sonuç (canlı test, 9 Ağustos 2026)

| İstek | Dönen kayıt sayısı | İlk kaydın `userId`'si |
|---|---:|---:|
| `page=1&size=50` | 10 | 13320 |
| `page=2&size=50` | 10 | **13320** (aynı) |
| `page=3&size=50` | 10 | **13320** (aynı) |
| `page=100&size=10` | 10 | **13320** (aynı) |

Dört farklı `page` değeri, dört farklı `size` değeri denenmesine rağmen dönen 10 kayıt **birebir aynı** — sıralaması da dahil. `bucket=low` için de aynı davranış doğrulandı.

## Beklenen davranış

- `size` parametresi gerçekten istenen kayıt sayısını dönmeli (örn. `size=200` isteğinde 200 kayıt, kalan kayıt sayısı azsa daha az).
- `page` arttıkça `(page - 1) * size` offset'inden itibaren **farklı** kayıtlar dönmeli (standart offset/limit sayfalama).
- Segment sonuna gelindiğinde boş dizi veya eksik sayıda kayıt dönmeli (son sayfa sinyali).

## Etki

- 6.413 kişilik "zero" (profili hiç doldurmamış) segmentinden yalnızca 10 kişiye ulaşılabiliyor.
- Pazarlama panelindeki "Segmentten Yükle" özelliği her denemede aynı 10 kaydı getiriyor — farklı sayfa istemenin hiçbir etkisi yok.
- E-posta re-aktivasyon kampanyasının asıl amacı (büyük, aktive edilmemiş kullanıcı kitlesine ulaşmak) bu haliyle gerçekleştirilemiyor.

## Önerilen düzeltme

Backend tarafında `page`/`size` parametrelerinin sorgu katmanına (SQL `OFFSET`/`LIMIT` veya eşdeğeri) doğru şekilde iletildiğinden emin olunmalı. Muhtemel kök neden: parametreler action metoduna geliyor ama alttaki repository/sorgu çağrısına hiç aktarılmıyor (sabit `Take(10)` ile sınırlanmış olabilir).

## Kabul kriteri

Yukarıdaki 4 test isteği tekrar çalıştırıldığında her `page` değeri için **farklı** kayıt kümesi dönmeli; `size=50` isteğinde toplam kayıt sayısı yeterliyse 50 kayıt dönmeli.

---

## İlgili not — gönderim ölçeği

Bu bug düzelip 6.413 kişinin tamamına erişilebilir olduğunda, pazarlama panelinin SMTP üzerinden bu kadar büyük bir listeye **tek seferde** gönderim yapması da ayrı bir mühendislik konusu (mevcut sıralı gönderim mantığıyla ~30+ dakika sürer). Bu, ayrı bir iş kalemi olarak ele alınacak — bu rapor yalnızca sayfalama hatasını kapsar.
