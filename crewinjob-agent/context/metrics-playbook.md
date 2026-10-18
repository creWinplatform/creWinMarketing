# CrewinJob — Metrik İyileştirme Playbook'u
> "Ölçtük, düşük çıktı. Şimdi ne yapacağız?" sorusunun cevabı.
> Her metrik için: **neden düşer → hangi kaldıraç → ilk 7 günde ne yapılır → nasıl doğrulanır**

---

## Nasıl Kullanılır

Bir metrik hedefin **%80'inin altındaysa** kırmızı, **%80-100 arası** sarı, **üstü** yeşil sayılır.
Kırmızı metrikler için aşağıdaki playbook'tan **en fazla 2 kaldıraç** seç. Aynı anda 5 şey denemek ölçümü bozar.

**Öncelik kuralı:** Marketplace'te önce **darboğaz tarafını** düzelt. Aday bol / şirket az ise şirket tarafına, ilan bol / nitelikli aday az ise aday kalitesine yüklen. İki tarafa aynı anda yüklenme.

---

## 1. Seafarer Acquisition düşük (yeni kayıt hedefin altında)

**Neden düşer**
- Kanal çeşitliliği yok (tek kanala bağımlılık)
- Kayıt sayfası mobilde ağır veya çok alan istiyor
- Değer önerisi net değil ("neden buraya kaydolayım?")

**Kaldıraçlar (etki sırasına göre)**
1. **Referral döngüsü** — Denizciler kapalı topluluklar (gemi, mezun grupları, WhatsApp). Bir denizciyi getiren denizciye görünürlük avantajı ver. Maritime'da en ucuz kanal budur.
2. **Rütbe bazlı landing page** — "Chief Officer iş ilanları", "2nd Engineer pozisyonları" gibi ayrı sayfalar. SEO + reklam kalite skoru birlikte yükselir.
3. **Facebook/Telegram grup varlığı** — Isınma → değer → soft CTA sırasıyla (bkz. `seafarer-growth.js` 4 haftalık plan).
4. **Ülke odaklı kampanya** — Filipinler, Hindistan, Türkiye, Ukrayna. Her birine ayrı dil ve mesaj.

**İlk 7 gün**
- UTM'siz hiçbir link paylaşma. Kanal başına kaydı ayrıştıramıyorsan optimize edemezsin.
- Kayıt formunda zorunlu alan sayısını say. 6'dan fazlaysa fazlasını profil aşamasına ertele.

**Doğrulama:** Kanal başına kayıt + kanal başına *aktive olmuş* kayıt. Ucuz kanal çok kayıt getirip hiç aktive etmiyorsa kanal kötüdür, kayıt sayısı yanıltır.

---

## 2. Seafarer Activation düşük (kayıt var, profil tamamlanmıyor)

> Bu, CrewinJob'un en kritik darboğazıdır. 15.000 kayıt varken profil tamamlama %42 ise gerçek envanter 6.300'dür.

**Neden düşer**
- Profil formu tek seferde çok şey istiyor (sertifika + sea service + belge + fotoğraf)
- Kullanıcı tamamlamanın **karşılığını** görmüyor
- Sertifika/belge yükleme mobilde zor

**Kaldıraçlar**
1. **Aşamalı profil (progressive profiling)** — Kayıtta sadece rütbe + müsaitlik iste. Sertifikaları ilk başvuru anında iste. Tamamlama isteği, değerin görüldüğü ana yakın olmalı.
2. **Görünürlük geri bildirimi** — "Profilin %60. Sea service eklersen **12 ilanda daha** görüneceksin." Soyut yüzde değil, somut ilan sayısı göster.
3. **Eksik alan bazlı re-engagement** — Segment bazlı mesaj (bkz. `retention.js`): 3. gün sıcak, 7. gün fırsat odaklı, 14. gün son çağrı.
4. **CV parse ile otomatik doldurma** — Denizci CV'si yükler, sistem sea service ve sertifikaları otomatik çıkarır. Manuel giriş yükünü kaldıran en büyük kaldıraç budur.

**İlk 7 gün**
- Profil tamamlama ekranının **hangi adımında** düşüldüğünü ölç (`profile_completed_50` → `profile_completed_80` arası drop). Genelde tek bir alan suçludur.
- O alanı opsiyonel yap veya sonraya ertele, 1 hafta sonra farkı ölç.

**Doğrulama:** Ready-to-Hire Profile Rate. Ham profil tamamlama yüzdesi değil — belgesi süresi dolmuş profil "tamamlanmış" görünür ama işe yaramaz.

---

## 3. Company Activation düşük (şirket kaydoluyor, ilan vermiyor)

**Neden düşer**
- Şirket kaydolur, arama yapar, **yeterli nitelikli aday göremez** ve döner (bu aslında likidite sorunudur)
- İlan verme akışı uzun
- Şirket "ilan versem başvuru gelir mi?" güvenini taşımıyor

**Kaldıraçlar**
1. **Kayıt anında aday önizlemesi** — Şirket kaydolur olmaz "Aradığın rütbede **X ready-to-hire aday** var" göster. Boş marketplace hissi, aktivasyonu en çok öldüren şeydir.
2. **Concierge onboarding** — İlk 20-30 şirket için ilanı senin ekibin oluştursun. Ölçeklenmez ama bu aşamada doğru olan budur.
3. **İlan şablonları** — Rütbe + gemi tipi seç, ilan taslağı otomatik gelsin. Sıfırdan yazma yükünü kaldır.
4. **İlk shortlist garantisi** — "72 saat içinde en az 5 uygun aday sunmazsak ilanı ücretsiz uzatıyoruz."

**İlk 7 gün**
- Kaydolup ilan vermeyen şirketlerin **arama loglarına** bak. Ne aradılar, kaç sonuç gördüler? Sıfır sonuçlu aramalar arz açığının haritasıdır.
- Bu şirketlere doğrudan telefon/e-posta ile ulaş. 75 şirketlik ölçekte bu yapılabilir ve en değerli veriyi verir.

**Doğrulama:** Company Activation Rate (14 gün) + ikinci ilan oranı.

---

## 4. 7-Day Liquidity Rate düşük (ilanlar nitelikli aday almıyor)

**Neden düşer**
- Aday havuzunda o rütbe/gemi tipi yok (**arz açığı**)
- Adaylar var ama profilleri eksik olduğu için "nitelikli" sayılmıyor (**kalite açığı**)
- Adaylar ilanı görmüyor (**dağıtım açığı**)
- İlan koşulları piyasa dışı (**talep açığı**)

> Önce hangisi olduğunu tespit et. Dördünün çözümü farklıdır.

**Teşhis**
```
İlan hiç görüntülenmemiş        → dağıtım sorunu
Görüntülenmiş, başvuru yok      → ilan cazibesi / maaş / koşul sorunu
Başvuru var, nitelikli yok      → profil kalitesi sorunu
Havuzda o rütbe hiç yok         → arz açığı
```

**Kaldıraçlar**
1. **Dağıtım:** Eşleşen adaylara push/e-posta bildirimi. Yeni ilan → uygun aday havuzuna aynı gün ulaşmalı. Telegram kanalı bu iş için zaten var.
2. **Arz açığı:** O rütbeye özel hedefli kayıt kampanyası. Genel "denizci kaydol" değil, "2nd Engineer aranıyor" kampanyası.
3. **Kalite açığı:** Bkz. Bölüm 2 (Activation).
4. **Talep açığı:** Şirkete piyasa verisi göster — "Bu rütbede ortalama teklif X, siz Y veriyorsunuz."

**İlk 7 gün**
- Sıfır başvurulu ilanların listesini çıkar. Rütbe/gemi tipi/bayrak kırılımına bak. Pattern hemen görünür.

**Doğrulama:** İlan başına nitelikli aday + ilk nitelikli adaya kadar geçen süre.

---

## 5. Başvuru → Shortlist oranı düşük

**Neden düşer**
- Adaylar ilgisiz ilanlara başvuruyor (spray-and-pray)
- Şirket adayı değerlendirecek bilgiyi profilde bulamıyor
- Fit Score şirketin gerçek tercihleriyle uyuşmuyor

**Kaldıraçlar**
1. **Başvuru öncesi uygunluk uyarısı** — "Bu ilan Chief Officer arıyor, senin rütben AB Seaman. Yine de başvur?" Aday tarafında sürtünme yaratmak burada iyidir.
2. **Şirkete karar bilgisini öne çıkar** — Sea service süresi, sertifika geçerlilik tarihi, müsaitlik tarihi kartın üstünde olsun. Şirket CV açmadan eleyebilmeli.
3. **Fit Score açıklaması** — "Bu aday neden %87?" gerekçesi göster. Açıklanamayan skor güvenilmez.

**Doğrulama:** Fit Score Acceptance Rate. Yüksek skorlu adaylar reddediliyorsa sorun modeldedir, adaylarda değil.

---

## 6. AI Fit Score güvenilirliği düşük

**Sinyal:** Yüksek skorlu adayların shortlist oranı düşük **veya** şirketler düşük skorlu adayları seçiyor.

**Kaldıraçlar**
1. **Recruiter kararlarını etiket olarak topla** — Her shortlist/red kararı modelin eğitim verisidir. Bunu kaydetmiyorsan model asla düzelmez.
2. **Ağırlıkları sektör gerçeğine göre kalibre et** — Denizcilikte gemi tipi deneyimi ve sertifika geçerliliği, genel iş süresinden daha belirleyicidir.
3. **Skoru gerekçesiyle göster** — Şeffaflık hem güveni hem geri bildirim kalitesini artırır.
4. **Çeyreklik doğruluk denetimi** — Skor aralığı bazında gerçekleşen shortlist oranını raporla.

---

## 7. Şirket Retention düşük (tekrar ilan vermiyorlar)

> Marketplace'te en pahalı hata budur. Yeni şirket bulmak, mevcut şirketi tutmaktan kat kat pahalıdır.

**Neden düşer**
- İlk ilandan sonuç alamadılar (likidite sorunu — bkz. Bölüm 4)
- İşe aldılar ama süreç platform dışında tamamlandı, geri gelme sebebi kalmadı
- Ürün onların iş akışına oturmuyor

**Kaldıraçlar**
1. **İlan kapanış anketi** — "Pozisyonu doldurdunuz mu? Nereden?" Hem Confirmed Placement verisi hem churn nedeni tek soruyla gelir.
2. **Sezonluk hatırlatma** — Crew change döngüleri öngörülebilirdir. "6 ay önce Chief Officer aramıştınız, kontrat bitiyor olabilir."
3. **Kayıtlı aday havuzu** — Şirket beğendiği adayları listeler, sonraki ilanda hazır bulur. Geri gelme sebebi yaratır.
4. **Placement sonrası değer** — Belge süre takibi, crew change planlama gibi işe alım sonrası özellikler şirketi platformda tutar.

**Doğrulama:** Repeat Job Posting Rate + 90 günlük şirket retention.

---

## 8. Organik trafik / SEO düşük

**Kaldıraçlar**
1. **Rütbe × ülke × gemi tipi sayfaları** — "Chief Officer jobs Philippines", "Tanker 2nd Engineer vacancies". Uzun kuyruk aramalar bu sektörde çok net.
2. **İlan sayfalarının indekslenmesi** — Structured data (JobPosting schema) ekle. Google for Jobs'a girmek en yüksek getirili SEO işidir.
3. **Sertifika/kariyer rehberleri** — "STCW nasıl yenilenir", "COC başvuru süreci". Arama hacmi yüksek, rekabet düşük.
4. **Süresi dolmuş ilanları temizle** — Ölü ilan sayfaları hem kullanıcıyı hem indeksi bozar.

**Doğrulama:** GSC'de sorgu bazlı tıklama + o sayfalardan gelen kayıt (UTM ile).

---

## 9. Gelir metrikleri düşük (monetizasyon öncesi/sonrası)

**Monetizasyon öncesi**
- **Paid Intent Rate**'i ölç. Fiyat sayfasını gören şirketlerin kaçı bir sonraki adıma geçiyor? Bu, gelir gelmeden ödeme isteğini ölçer.
- Fiyat sayfasına gelip ayrılan şirketlere doğrudan sor: "Neyi görseniz ödeme yapardınız?"

**Monetizasyon sonrası**
1. **CV unlock dönüşümü düşükse** — Önizlemede yeterli bilgi yok ya da fazla bilgi var. Az bilgi güven vermez, çok bilgi unlock'ı gereksiz kılar. Dengeyi test et.
2. **Free → Paid düşükse** — Ücretsiz katmanda ilk gerçek değeri yaşatıyor musun? Şirket bir kez iyi bir shortlist görmeden ödeme yapmaz.
3. **CAC yüksekse** — Kanal bazında CAC ayır. Genelde tek bir kanal ortalamayı bozar.
4. **LTV düşükse** — Retention sorunudur, fiyat sorunu değil. Bkz. Bölüm 7.

---

## 10. Veri kalitesi düşük (belgeler eski, profiller güncel değil)

**Kaldıraçlar**
1. **Belge son kullanma uyarısı** — Sertifika bitmeden 60/30/7 gün önce hatırlat. Hem kullanıcıya değer, hem veri tazeliği.
2. **Müsaitlik dürtmesi** — Aylık tek soru: "Hâlâ müsait misin?" Tek tık cevap. Bu, ready-to-hire havuzunu canlı tutan en ucuz mekanizmadır.
3. **Doğrulama rozeti** — Belgesi doğrulanmış profile görünür rozet ver. Doğrulama isteğini kullanıcı tarafından yarat.
4. **Mükerrer profil birleştirme** — Aynı kişi birden fazla kayıt açmışsa havuz sayısı şişer, kalite düşer.

**Doğrulama:** Ready-to-Hire Profile Rate. Toplam kayıt sayısı bu metrik yanında anlamsızdır.

---

## Analiz Yazarken Uyulacak Kurallar

1. **Her düşük metrik için mutlaka kaldıraç öner.** "Profil tamamlama düşük" demek yetmez; hangi kaldıraç, neden o, nasıl ölçülecek — üçü birlikte yazılır.
2. **En fazla 3 aksiyon öner.** Fazlası uygulanmaz.
3. **Aksiyonu ölçülebilir hedefle bağla.** "Profil tamamlamayı artır" değil, "CV parse ile 4 hafta içinde %42 → %55".
4. **Ölçülemeyen metriği tahmin etme.** "Bu veri henüz izlenmiyor — `job_applied` event'i eklenmeli" de.
5. **Darboğaz tarafını belirt.** Her analizde "bu dönem darboğaz aday tarafında mı şirket tarafında mı?" sorusuna cevap ver.
6. **Sayı yoksa iddia yok.** Rakamla desteklenmeyen cümle rapora girmez.
