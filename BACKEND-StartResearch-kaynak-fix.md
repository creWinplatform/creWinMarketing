# Backend Görevi: MarketingProspect/StartResearch — AI araştırması 0 sonuç dönüyor

## Özet
`StartResearch` job'ı **başarıyla tamamlanıyor** (`status: completed`) ancak **hiç firma bulamıyor**
(`totalFound: 0`, `totalSaved: 0`). Frontend tarafı doğru çalışıyor: job başlatılıyor, durum
poll ediliyor, tamamlanınca `GetAll` ile lead'ler çekiliyor. Sorun AI araştırma katmanında.

## Kanıt — gözlemlenen job yanıtı
```json
{
  "jobId": 3,
  "status": "queued",           // sonra "completed" oluyor
  "provider": "gemini",
  "querySummary": "kw:active maritime hiring",
  "totalFound": 0,
  "totalSaved": 0,
  "startedAt": null,
  "completedAt": null,
  "errorMessage": null,
  "creationTime": "2026-09-13T14:40:52.63+00:00"
}
```

Ek gözlem: Panelde **"0 araştırma kaynağı"** yazıyor → `GetResearchSources` boş liste dönüyor.

## Frontend'in gönderdiği gerçek istek (POST MarketingProspect/StartResearch)
```json
{
  "companyTypes": ["ship owner", "ship operator", "crew management"],
  "countries": ["TR", "GR", "NL", "SG"],
  "signals": ["active maritime hiring"],
  "keywords": "active maritime hiring",
  "maxResults": 25,
  "language": "tr"
}
```

## Sorunlar ve yapılması gerekenler

### 1) `GetResearchSources` boş — araştırma kaynakları seed edilmemiş (ÖNCELİKLİ)
AI'ın tarayacağı kaynak listesi boş olduğu için sonuç üretilemiyor.
- [ ] Varsayılan araştırma kaynaklarını (maritime directory'ler, açık firma rehberleri,
      sektör siteleri vb.) veritabanına seed edin.
- [ ] `GetResearchSources` en az birkaç aktif kaynak dönmeli.
- [ ] Bir kampanya/tenant için kaynak yoksa, job'ın `errorMessage` alanına
      "Araştırma kaynağı tanımlı değil" gibi anlamlı bir mesaj yazılmalı (sessizce 0 dönmemeli).

### 2) `querySummary` yalnızca `kw:` içeriyor — companyTypes ve countries sorguya girmiyor
Yanıttaki `querySummary: "kw:active maritime hiring"` gösteriyor ki AI sorgusu sadece
`keywords`'ten kuruluyor; `companyTypes` ve `countries` dahil edilmiyor.
- [ ] AI sorgusu `companyTypes` + `countries` + `keywords`/`signals` birleşiminden kurulmalı.
- [ ] Örn. hedef sorgu: "ship owner OR ship operator OR crew management companies in
      TR, GR, NL, SG with active maritime hiring".
- [ ] Bu alanları filtre olarak da kullanacaksanız, çok dar filtre sonucu her şeyi elemesin
      (0 sonucun bir sebebi bu olabilir).

### 3) Gemini provider web-grounding / search tool kontrolü
Grounding kapalıysa model gerçek firma ve iletişim verisi döndüremez.
- [ ] Gemini çağrısında Google Search grounding / tool kullanımı aktif mi doğrulayın.
- [ ] Aktif değilse etkinleştirin; API anahtarı ve kota kontrol edin.
- [ ] Model gerçekten aday firma döndürüyor mu, ham AI yanıtını loglayıp doğrulayın.

### 4) Durum (status) endpoint'i netleştirilmeli
Frontend job durumunu poll ediyor ama endpoint adı kesin değil; şu adaylar deneniyor:
`GetResearchStatus?jobId=`, `GetResearchJob?jobId=`, `GetResearchStatus?id=`,
`GetResearchJob?id=`, `GetResearch?id=`.
- [ ] Resmi durum endpoint'inin adını ve parametresini bildirin (ör. `GetResearchStatus?jobId=`).
- [ ] Yanıt en az şunları içermeli: `status`, `totalFound`, `totalSaved`, `errorMessage`.
- [ ] Bitince `status` şu değerlerden biri olmalı: `completed` / `failed` / `cancelled`.

### 5) Sonuçların okunma yolu
- [ ] Bulunan firmalar job tamamlanınca prospect deposuna yazılıyor mu (`totalSaved`)?
      Frontend tamamlanınca `GetAll` ile çekiyor.
- [ ] Alternatif olarak durum yanıtında `items`/`prospects`/`companies` dizisi inline
      dönerse frontend onu da işler.

## Kabul kriterleri
- `GetResearchSources` en az 1 aktif kaynak döndürür.
- Geçerli parametrelerle `StartResearch` çalıştırıldığında job `completed` olur ve
  `totalFound > 0` üretir (kaynak/provider uygunsa).
- `querySummary` companyTypes ve countries bilgisini de yansıtır.
- Bulunan firmalar `GetAll` ile listelenebilir.
- Kaynak/kota/grounding eksikse job `failed` + açıklayıcı `errorMessage` döner (sessiz 0 değil).
