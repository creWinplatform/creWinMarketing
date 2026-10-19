# Ryzevo arayüz dili (TR / EN)

Ryzevo'nun arayüzü Türkçe (varsayılan) ve İngilizcedir. Bu belge terminolojiyi ve yazım kurallarını tek yerde toplar; yeni metin eklerken iki dili birlikte yazın.

## Nasıl çalışır

- **Seçim:** `ryzevo_lang` çerezi (`tr` | `en`). Sunucu ilk yüklemede bu çerezi okur, bu yüzden sayfa yanlış dilde açılıp sonra değişmez. Çerez yoksa `Accept-Language` başlığına bakılır, o da yoksa Türkçe kullanılır. Eski `crewinjob_lang` localStorage kaydı bir kez çereze taşınır.
- **Paylaşılan bağlantı:** `?lang=en` veya `?lang=tr` seçimi kalıcı yapar (ör. `/welcome?lang=en`).
- **İstemci bileşenleri:** `useLang()` (`lang`, `setLang`) ve `useT()` → `t('Türkçe', 'English')`. Mevcut bileşenlerdeki `tr ? '…' : '…'` kalıbı da geçerlidir.
- **Sunucu bileşenleri ve sayfa başlıkları:** `requestLang()` (`lib/i18n/server.ts`) ve `pick(lang, tr, en)` (`lib/i18n/shared.ts`).
- **Sunucu hata mesajları:** API'ler Türkçe mesaj döndürür; İngilizce arayüzde `translateMessage()` (`lib/i18n/messages.ts`) bunları sözlükten çevirir. Yeni bir Türkçe hata mesajı eklediğinizde İngilizcesini `lib/i18n/messages-en.ts` dosyasına ekleyin. `test/i18n-messages.test.cjs` eksik çeviriyi yakalar.
- **Tarih ve sayı:** `localeTag(lang)` → `tr-TR` / `en-GB`. Tarihleri `toLocaleDateString(localeTag(lang), …)` ile biçimlendirin; elle "Eki" veya "Oct" yazmayın.

## Yazım kuralları

1. **Marka:** Ürün adı her iki dilde **Ryzevo**, logo yazımı **ryzevo**. Slogan çevrilmez: **Grow with intent.** (İngilizce metin `lang="en"` ile işaretlenir; Türkçe büyük harf kuralı "I" harfini "İ" yapmasın.)
2. **Ton:** Net, sakin, iddiasız. İngilizcede düz cümle ve sentence case kullanılır: başlıklarda yalnız ilk harf büyük ("Project settings", "Project Settings" değil). Özel adlar ve ürün adları (LinkedIn, Search Console, Amazon SES) olduğu gibi kalır.
3. **Hitap:** Landing'deki Türkçe metin "sen" diye hitap eder ("Ürününü tanımla"), uygulama ekranları ise "siz" diye ("Projenizi seçin"). İngilizcede ikisi de "you" olur.
4. **Yasak iddialar (marka brifi):** "autonomous", "fully automated", "guaranteed", "AI does it for you" gibi ifadeler kullanılmaz. Uydurma rakam, logo, yorum veya fiyat yazılmaz. Her çıkış bir insan kararıdır; metin bunu korumalıdır.
5. **CTA'lar (landing):** yalnızca bu üçü kullanılır:
   - Ürünü keşfet → **Explore the product**
   - Davetle katıl → **Join by invite**
   - Giriş yap → **Sign in**
6. **Veri yokluğu:** "Veri yok" → **No data**. Boş durumlar tahmin veya sıfır gibi sunulmaz ("Veri yok ≠ sıfır" → "No data ≠ zero").
7. **Noktalama:** Üç nokta tek karakterdir (…). Ayraç olarak orta nokta (·) kullanılır. Ok işaretleri (→) iki dilde aynıdır.
8. **Kullanıcı verisi çevrilmez:** Proje adı, görev başlığı, kampanya adı ve müşteri içerikleri olduğu gibi gösterilir. Plan adları (Launch, Growth, Team) ve dil adları ("Türkçe", "English") da ürün adı gibi sabittir.
9. **Hata üslubu (EN):** kısa ve kısaltmalı: "Couldn't save the campaign.", "Can't connect an archived segment." ("Could not / cannot" kullanılmaz).
10. **Büyük harfli etiketler:** kaynakta büyük harfle yazılır; Türkçede İ/I doğru kullanılır ("MOBİL BÜYÜME"). Kullanıcı verisi büyütülecekse `toLocaleUpperCase(localeTag(lang))`.

## Terimler

| Türkçe | English |
|---|---|
| Çalışma alanı | Workspace |
| Çalışma merkezi | Workspace overview |
| Proje / Proje ayarları | Project / Project settings |
| Ürün profili | Product profile |
| Marka dili | Brand voice |
| Hedef kitle / Kitle | Target audience / Audience |
| Büyüme hedefi / Hedef | Growth goal / Goal |
| Dönüşüm aşamaları | Conversion stages |
| Ölçüm / Ölçüm kaydı | Measurement / Measurement record |
| Büyüme pusulası / Pusula | Growth compass / Compass |
| Büyüme rotası | Growth path |
| AI içerik stüdyosu | AI content studio |
| İçerik kütüphanesi | Content library |
| Taslak / Taslak incelemesi | Draft / Draft review |
| İnceleme / Onay | Review / Approval |
| İncelemeye gönder | Submit for review |
| Kampanya / Kampanya merkezi | Campaign / Campaign hub |
| Segment | Segment |
| Alıcı / Alıcılar ve izinler | Recipient / Recipients & consent |
| İletişim izni / İzinli | Contact consent / Consented (eligible) |
| Gönderen | Sender |
| Kontrollü gönderim | Controlled sending |
| Toplu gönderim | Bulk sending |
| Otomatik yayın | Automatic publishing |
| Sosyal yayın / Yayın | Social publication / Publication |
| Sosyal yayınlar (modül) | Social publishing |
| Kampanya merkezi (etiket) | Campaign hub |
| İşlem anahtarı (tekrar koruması) | Operation key |
| Gerçek gönderim / gerçek pilot | Live sending / live pilot |
| Öncelik: Yüksek, Orta, Düşük | Priority: High, Medium, Low |
| Roller: Yönetici, Analist, Görüntüleyici | Roles: Admin, Analyst, Viewer |
| Prova | Rehearsal |
| Önizleme | Preview |
| Bağlantılar / Bağlantı | Connections / Connection |
| Ürün verisi / Kaynak | Product data / Source |
| SEO operasyon merkezi | SEO operations hub |
| Site denetimi / Bulgu / İş kartı | Site audit / Finding / Work item |
| Takvim / İş planı | Calendar / Work plan |
| Sorumlu | Owner (of a task) |
| Mobil büyüme | Mobile growth |
| Analitik | Analytics |
| Plan ve kullanım | Plan & usage |
| Ekip / Ekip ve erişim | Team / Team & access |
| Roller: Sahip, Editör, İnceleyen | Roles: Owner, Editor, Reviewer |
| Davet / Davet bağlantısı | Invitation / Invitation link |
| Kontrollü pilot / Pilot erişimi | Controlled pilot / Pilot access |
| Örnek proje verileri | Sample project data |
| Kayıt (form ile) | Sign-up |
| Kayıt (veri) | Record |
| Hesap kurtarma | Account recovery |
| Abonelikten çık | Unsubscribe |
