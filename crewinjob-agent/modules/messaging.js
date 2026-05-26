// ─── WhatsApp & Telegram Mesajlaşma Stratejisi Generator ────────────────────
// Yeni kullanıcı kazanımı için Click-to-WA reklamları, Telegram kanal içerikleri
// ve Telegram Bot kayıt akışı üretir.
const client = require('../ai-client');

// ─── A) Click-to-WhatsApp Reklam + Bot Karşılama Akışı ───────────────────────
async function generateClickToWhatsApp(params, data, model) {
  const {
    language      = 'en',
    audience      = 'seafarer_global',
    objective     = 'registration',   // registration | job_apply | company_signup
    adPlatform    = 'facebook',       // facebook | instagram | both
    whatsappNumber = '',
    customGoal    = '',
  } = params;

  const stats = data.stats || data;

  const audienceLabels = {
    seafarer_global: 'Global Seafarers (Filipinler, Hindistan, Endonezya, Pakistan)',
    seafarer_tr:     'Türk Gemi Adamları',
    shipowner:       'Armatörler & Crew Managers (B2B)',
    cadet:           'Deniz Fakültesi Öğrencileri & Cadetler',
  };

  const objectiveLabels = {
    registration: 'Yeni seafarer kaydı (crewinjob.com)',
    job_apply:    'Açık ilanlara başvuru',
    company_signup: 'Firma/armatör kaydı (crewing hizmeti)',
  };

  const realStats = {
    totalSeafarers: stats.seafarers?.total || 0,
    totalJobs:      stats.jobs?.total || 0,
    totalCompanies: stats.jobs?.companies || 0,
    topCountries:   Object.keys(stats.seafarers?.byNationality || {}).slice(0, 5),
  };

  const prompt = `
Sen crewinjob.com'un dijital pazarlama uzmanısın. WhatsApp Business üzerinden yeni kullanıcı kazanımı için
Click-to-WhatsApp reklam kampanyası ve otomatik bot karşılama akışı tasarlayacaksın.

📊 GERÇEK PLATFORM VERİSİ:
- ${realStats.totalSeafarers.toLocaleString()} kayıtlı gemi adamı
- ${realStats.totalJobs} aktif ilan, ${realStats.totalCompanies} firma
- En çok kullanıcı: ${realStats.topCountries.join(', ')}

🎯 KAMPANYA PARAMETRELERİ:
- Hedef kitle: ${audienceLabels[audience] || audience}
- Amaç: ${objectiveLabels[objective] || objective}
- Reklam platformu: ${adPlatform === 'both' ? 'Facebook + Instagram' : adPlatform}
- WhatsApp numarası: ${whatsappNumber || '+90 XXX XXX XX XX (ekleyin)'}
- Dil: ${language === 'tr' ? 'Türkçe' : 'English'}
${customGoal ? `- Özel hedef: ${customGoal}` : ''}

GÖREV: Aşağıdaki kapsamda eksiksiz bir Click-to-WhatsApp kampanya paketi üret (markdown):

# 📲 Click-to-WhatsApp Kampanya Paketi

## 1. 🎯 Strateji Özeti
- Click-to-WhatsApp neden bu kitle için doğru kanal?
- Beklenen CPL aralığı (normal reklama göre karşılaştırma)
- Kullanıcı yolculuğu: Reklam görür → WhatsApp'a yazar → kayıt olur (adım adım)

## 2. 📘 ${adPlatform === 'instagram' ? 'Instagram' : adPlatform === 'both' ? 'Facebook + Instagram' : 'Facebook'} Reklam Metinleri (3 VARYANT)
Her varyant için:
- **Primary Text** (125 karakter — hook ile başla)
- **Headline** (40 karakter — net değer önerisi)
- **Description** (30 karakter)
- **CTA Butonu:** "Send Message" / "WhatsApp'ta Yaz"
- Kullanılan psikolojik tetikleyici
- Görsel önerisi (ne gösterilmeli?)

## 3. 🤖 WhatsApp Bot Karşılama Akışı (Tam Diyalog Scripti)

### Adım 1 — Anında Otomatik Karşılama (kullanıcı ilk mesaj atar atmaz)
> Mesaj metni (kopyala-yapıştır hazır, ${language === 'tr' ? 'Türkçe' : 'English'})

### Adım 2 — Hızlı Seçim Butonları
Kullanıcıya sunulacak 3 seçenek (WhatsApp quick reply buttons):
- Seçenek 1: ...
- Seçenek 2: ...
- Seçenek 3: ...

### Adım 3 — Rütbe/Pozisyon Sorusu
> Mesaj metni + quick reply seçenekler (Master, Chief Officer, Engineer, AB, Cadet, Diğer)

### Adım 4 — Gemi Tipi Sorusu
> Mesaj metni + quick reply seçenekler (Bulk Carrier, Tanker, Container, Offshore, Diğer)

### Adım 5 — Kayıt Linki Gönderimi
> Kişiselleştirilmiş mesaj + crewinjob.com kayıt linki
> Örn: "Chief Officer olarak Bulk Carrier'da iş arıyorsunuz — tam size göre 8 ilan var 👇"

### Adım 6 — Follow-up (24 saat sonra, kayıt olmadıysa)
> Tek mesaj hatırlatma (FOMO odaklı)

### Adım 7 — Opt-out & KVKK
> "Mesaj almak istemiyorum" senaryosu + yasal metin

## 4. 🔄 Senaryo Dallanması
Kullanıcı farklı yanıtlar verirse ne olur?
- "İş arıyorum" → seafarer akışı
- "Personel arıyorum" → firma/armatör akışı
- "Bilgi almak istiyorum" → genel tanıtım akışı

## 5. 🎨 Görsel/Kreatif Brief
- ${adPlatform === 'instagram' ? 'Stories + Feed' : 'Feed + Stories'} formatları için görsel önerisi
- Üzerinde olması gereken overlay metin
- WhatsApp yeşili rengi reklam görseline nasıl entegre edilmeli?

## 6. 📊 Tracking & Optimizasyon
- UTM parametresi önerisi (wa_source, wa_medium, wa_campaign)
- Conversion eventi: WhatsApp konuşma başlatma → kayıt tamamlama
- İlk 2 haftada bakılacak metrikler (CPM, CTR, conversation rate, registration rate)

## 7. ⚖️ Uyumluluk
- Meta Ads politikası uyumu (iş ilanı kategorisi kuralları)
- KVKK / GDPR: onay metni önerisi
- WhatsApp Business API şablon mesaj onay ipuçları

KRITIK:
- ${language === 'tr' ? 'Tüm bot mesajları TÜRKÇE' : 'All bot messages in ENGLISH'}
- Gerçek Crewin rakamlarını kullan
- Bot mesajları samimi, robot gibi değil — denizci diline uygun
- Quick reply butonlar max 3 seçenek, max 20 karakter
`;

  return await client.generateWithRetry(prompt, model);
}

// ─── B) Telegram Kanal İçerik Stratejisi ─────────────────────────────────────
async function generateTelegramChannel(params, data, model) {
  const {
    language      = 'en',
    contentType   = 'weekly_plan',   // weekly_plan | daily_post | sponsored_post | channel_strategy | growth_plan
    channelLang   = 'multi',         // tr | en | ph | multi
    niche         = 'all',           // all | officers | engineers | cadets | offshore
    telegramHandle = '',
  } = params;

  const stats = data.stats || data;
  const jobs   = data.jobs   || [];

  const realStats = {
    totalSeafarers: stats.seafarers?.total || 0,
    totalJobs:      stats.jobs?.total || 0,
    totalCompanies: stats.jobs?.companies || 0,
    newThisWeek:    stats.seafarers?.newThisWeek || 0,
    topCountries:   Object.keys(stats.seafarers?.byNationality || {}).slice(0, 6),
  };

  const contentLabels = {
    weekly_plan:      'Haftalık İçerik Takvimi (7 günlük tam plan)',
    daily_post:       'Günlük İlan Post Şablonları',
    sponsored_post:   'Sponsorlu Post & Kanal İşbirliği Şablonları',
    channel_strategy: 'Kanal Büyütme Stratejisi (0→10K abone)',
    growth_plan:      '90 Günlük Kanal Büyüme Planı',
  };

  const nicheLabels = {
    all:       'Tüm Seafarerlar',
    officers:  'Deck Officers (Master, CO, 2/O, 3/O)',
    engineers: 'Engine Officers (CE, 2E, 3E, 4E)',
    cadets:    'Cadetler & Genç Denizciler',
    offshore:  'Offshore (DP Operator, OSV, AHTS)',
  };

  const prompt = `
Sen crewinjob.com'un Telegram kanal stratejistisin. Yeni seafarer kullanıcıları kazanmak için
Telegram kanalını büyütecek ve etkili içerikler üreteceksin.

📊 GERÇEK PLATFORM VERİSİ:
- ${realStats.totalSeafarers.toLocaleString()} kayıtlı gemi adamı
- ${realStats.totalJobs} aktif ilan, ${realStats.totalCompanies} firma
- Son 7 gün yeni kayıt: +${realStats.newThisWeek}
- En çok kullanıcı: ${realStats.topCountries.join(', ')}

🎯 PARAMETRELER:
- İçerik tipi: ${contentLabels[contentType] || contentType}
- Kanal dili: ${channelLang === 'multi' ? 'Çok dilli (EN ana, TR + Tagalog ek)' : channelLang.toUpperCase()}
- Niche: ${nicheLabels[niche] || niche}
- Kanal adresi: ${telegramHandle || '@crewinjob (ekleyin)'}
- Üretim dili: ${language === 'tr' ? 'Türkçe' : 'English'}

GÖREV: ${contentLabels[contentType]} üret (markdown):

${contentType === 'weekly_plan' ? `
# 📅 Telegram Haftalık İçerik Takvimi

Her gün için:
- ⏰ Yayın saati (seafarer mesai saatleri göz önüne alınarak)
- 📌 İçerik kategorisi
- ✍️ Tam post metni (kopyala-yapıştır hazır)
- 🖼️ Görsel önerisi
- 🔗 Link/CTA

## Pazartesi — İlan Günü
## Salı — Sektör Haberi / Maaş Trendi
## Çarşamba — Kariyer Tavsiyesi (CV, Mülakat)
## Perşembe — İlan Günü (Acil/Featured)
## Cuma — Hafta Özeti + Motivasyon
## Cumartesi — Eğitim & Sertifika (STCW, DP, vb.)
## Pazar — Topluluk (Soru-Cevap, Poll)

Ayrıca:
## 📌 Pinned Post Şablonu (Kanal açıklaması + kurallar)
## 🔗 Bio Linki Önerisi
## #️⃣ Hashtag Stratejisi
` : ''}

${contentType === 'daily_post' ? `
# 📢 Günlük İlan Post Şablonları

Aşağıdaki formatlarda 5 farklı şablon üret:

## Şablon 1 — Tek İlan (Acil)
[POZISYON] arıyoruz 🚢
[GEMİ TİPİ] | [ÜLKE/BAYRAK]
💰 [MAAŞ]
📅 Başlangıç: [TARİH]
✅ [GEREKSİNİM 1]
✅ [GEREKSİNİM 2]
🔗 Başvur: crewinjob.com/jobs/[ID]
📲 Detay için: [WHATSAPP]

## Şablon 2 — Çoklu İlan Özeti
## Şablon 3 — Öne Çıkan İlan (Premium)
## Şablon 4 — Ülkeye Özel (örn: Filipino Seafarers)
## Şablon 5 — Acil Alım (48 saat)

Her şablon için:
- Telegram karakter limitlerine uygun (4096 max)
- Emoji kullanımı stratejisi
- Inline keyboard buton önerisi (Başvur / Detaylar / Benzer İlanlar)
` : ''}

${contentType === 'sponsored_post' ? `
# 🤝 Sponsorlu Post & Kanal İşbirliği

## 1. Büyük Maritime Kanallarına Gönderilecek Sponsorlu Post Şablonları
(Kanal sahibiyle anlaşıldığında kullanılacak)

### Versiyon A — Kısa (50-80 kelime)
### Versiyon B — Standart (100-150 kelime)
### Versiyon C — Uzun Form (250+ kelime, whitelist post)

## 2. Kanal İşbirliği Teklif Mesajı
(Kanal adminlerine gönderilecek DM şablonu)

## 3. Hedef Telegram Kanalları Listesi
Maritime sektöründe abone edilmesi/reklam verilmesi gereken kanal kategorileri:
- Seafarer job kanalları
- Ülke bazlı (Filipino, Indian, Turkish seafarers)
- Sertifika/eğitim kanalları
- Maritime news kanalları

## 4. Cross-Promotion Stratejisi
Crewin kanalını büyütmek için diğer kanallarla nasıl iş birliği yapılmalı?

## 5. Ücretli Telegram Reklamı (promote.telegram.org)
- Kampanya kurulum adımları
- Hedefleme önerileri (maritime kanalları)
- Reklam metni (160 karakter limiti)
` : ''}

${contentType === 'channel_strategy' ? `
# 🚀 Telegram Kanal Büyütme Stratejisi (0 → 10.000 Abone)

## 1. Kanal Kurulum Checklist
- Kanal adı, açıklama, fotoğraf, bağlantılı bot
- Pin mesajı
- Kanal dili ve niche seçimi

## 2. İlk 500 Aboneye Ulaşma (Hız Kritik)
- Mevcut kullanıcılara duyuru stratejisi (email, push, uygulama içi)
- WhatsApp gruplarından organik yönlendirme
- Sosyal medya cross-promotion

## 3. 500 → 5.000 Büyüme Motoru
- İçerik kalitesi vs. frekansı dengesi
- Viral içerik formülleri (seafarer sektörü için)
- Kanal işbirliği (sponsorlu post takası)
- Telegram paid ads stratejisi

## 4. 5.000 → 10.000 Ölçekleme
- Niche alt kanallar açma (ülke/rütbe bazlı)
- Bot entegrasyonu (abone artışı için)
- Influencer/ambassador programı

## 5. Engagement Artırma Taktikleri
- Poll, quiz, soru-cevap formatları
- Haftalık maaş anketi
- Sertifika yenileme hatırlatıcısı (STCW)

## 6. Ölçüm & KPI
- Kanal metriklerini takip etme (Tgstat.com)
- Abone başına maliyet hesabı
- İlan tıklama → kayıt conversion hunisi
` : ''}

${contentType === 'growth_plan' ? `
# 📈 90 Günlük Telegram Kanal Büyüme Planı

## Ay 1 (Gün 1-30): Temel Kurulum & İlk 1.000 Abone
### Hafta 1: Kanal kurulum + içerik altyapısı
### Hafta 2: İlk içerik yayını + mevcut kullanıcılara duyuru
### Hafta 3: İlk kanal işbirliği denemeleri
### Hafta 4: Analiz + strateji düzeltme

## Ay 2 (Gün 31-60): Büyüme Motoru + 1.000→5.000
### Hafta 5-6: Paid Telegram ads başlangıcı
### Hafta 7-8: Sponsorlu post programı + bot lansmanı

## Ay 3 (Gün 61-90): Ölçekleme + 5.000→10.000
### Hafta 9-10: Alt kanal açılışları
### Hafta 11-12: Performans raporu + sonraki 90 gün planı

## Günlük / Haftalık Görev Listesi (Operasyonel)
Her gün: ne kadar süre, kim yapacak, ne yayınlanacak

## Bütçe Planı
- Organik içerik (0$)
- Sponsorlu post bütçesi ($X/ay)
- Telegram paid ads bütçesi ($X/ay)
- Toplam ROI hedefi (abone başına maliyet, kayıt başına maliyet)
` : ''}

KRITIK:
- ${language === 'tr' ? 'Türkçe' : 'English'} üret
- Telegram'ın 4096 karakter limitine dikkat et
- Emoji'yi stratejik kullan, aşırıya kaçma
- Gerçek Crewin istatistiklerini içeriklere yansıt
- Seafarer topluluğuna saygılı, değer odaklı ton
`;

  return await client.generateWithRetry(prompt, model);
}

// ─── C) Telegram Bot Kayıt Akışı ────────────────────────────────────────────
async function generateTelegramBot(params, data, model) {
  const {
    language   = 'en',
    botType    = 'registration',   // registration | job_search | company | full
    botHandle  = '',
    features   = [],               // ['job_search', 'cv_tips', 'salary_info', 'alerts']
  } = params;

  const stats = data.stats || data;

  const realStats = {
    totalSeafarers: stats.seafarers?.total || 0,
    totalJobs:      stats.jobs?.total || 0,
    totalCompanies: stats.jobs?.companies || 0,
    topCountries:   Object.keys(stats.seafarers?.byNationality || {}).slice(0, 5),
  };

  const botTypeLabels = {
    registration: 'Seafarer Kayıt Botu (yeni kullanıcı kazanımı)',
    job_search:   'İş Arama Botu (ilan filtreleme)',
    company:      'Firma/Armatör Botu (B2B lead)',
    full:         'Tam Özellikli Bot (tüm akışlar)',
  };

  const prompt = `
Sen crewinjob.com'un Telegram Bot mimarısın. Yeni seafarer kullanıcıları kazanmak ve
crewinjob.com'a yönlendirmek için profesyonel bir Telegram botu tasarlayacaksın.

📊 GERÇEK PLATFORM VERİSİ:
- ${realStats.totalSeafarers.toLocaleString()} kayıtlı gemi adamı
- ${realStats.totalJobs} aktif ilan, ${realStats.totalCompanies} firma
- En çok kullanıcı: ${realStats.topCountries.join(', ')}

🎯 PARAMETRELER:
- Bot tipi: ${botTypeLabels[botType] || botType}
- Bot adresi: ${botHandle || '@CrewinBot (ekleyin)'}
- Dil: ${language === 'tr' ? 'Türkçe' : 'English'}
${features.length > 0 ? `- Ek özellikler: ${features.join(', ')}` : ''}

GÖREV: Eksiksiz Telegram Bot tasarımı + tam diyalog scripti üret (markdown):

# 🤖 Telegram Bot Tasarım Dokümanı

## 1. 📋 Bot Genel Mimarisi
- Bot'un temel amacı ve değer önerisi
- Komut listesi (/start, /jobs, /help, /register, /salary, vb.)
- Inline keyboard vs. reply keyboard stratejisi
- Konuşma durumları (FSM — Finite State Machine) özeti

## 2. 🚀 /start Akışı — Yeni Kullanıcı (TAM DİYALOG)

### Mesaj 1 — Hoş Geldin (anında)
\`\`\`
[Bot mesajının tam metni — emoji + satır sonu dahil]
\`\`\`
[Inline keyboard butonlar]

### Mesaj 2 — Kim olduğunu anla
\`\`\`
[Mesaj metni]
\`\`\`
Butonlar:
- 🚢 Gemi Adamıyım → seafarer_flow
- 🏢 Firma/Armatörüm → company_flow
- 🎓 Öğrenciyim/Cadetim → cadet_flow

## 3. ⚓ Seafarer Kayıt Akışı (Adım Adım Tam Diyalog)

### Adım 1: Rütbe Seçimi
\`\`\`
[Mesaj metni]
\`\`\`
Butonlar (satır 1): Master | Chief Officer | 2nd Officer | 3rd Officer
Butonlar (satır 2): Chief Eng | 2nd Eng | 3rd Eng | 4th Eng
Butonlar (satır 3): AB/OS | Bosun | Cook | Electrician
Butonlar (satır 4): 🎓 Cadet/Trainee | ❓ Diğer

### Adım 2: Gemi Tipi Tercihi
\`\`\`
[Mesaj metni]
\`\`\`
Butonlar (satır 1): 🚢 Bulk Carrier | 🛢️ Tanker | 📦 Container
Butonlar (satır 2): ⚓ Offshore | 🛳️ Passenger | 🧪 Chemical
Butonlar (satır 3): 🏭 LNG/LPG | 🚛 General Cargo | ❓ Fark etmez

### Adım 3: Deneyim & Belge
\`\`\`
[Mesaj metni]
\`\`\`
Butonlar: < 1 yıl | 1–3 yıl | 3–5 yıl | 5–10 yıl | 10+ yıl

### Adım 4: Ülke / Bayrak Tercihi (opsiyonel)
\`\`\`
[Mesaj metni]
\`\`\`

### Adım 5: Kişiselleştirilmiş İlan Özeti + Kayıt CTA
\`\`\`
[Mesaj metni — rütbe ve gemi tipine göre dinamik, gerçek sayıları kullan]
Örn: "Chief Officer olarak Bulk Carrier'da çalışmak istiyorsunuz.
Crewinjob'da şu an [X] böyle ilan var.
Ücretsiz kayıt ol, hemen başvur 👇"
\`\`\`
Butonlar:
- 🔗 Hemen Kayıt Ol → crewinjob.com/register?utm_source=telegram&utm_medium=bot
- 📋 İlanları Listele → /jobs komutunu tetikle
- ❓ Sorularım Var → /help

### Adım 6: Follow-up (24 saat sonra kayıt olmadıysa)
\`\`\`
[Tek hatırlatma mesajı — FOMO odaklı, kısa]
\`\`\`

## 4. 🏢 Firma Akışı (Armatör / Crew Manager)

### Adım 1: Firma Tanıma
### Adım 2: İhtiyaç Belirleme (pozisyon sayısı, gemi tipi)
### Adım 3: Lead bilgisi + CTA (demo talebi / ücretsiz ilan)

## 5. 🔍 /jobs Komutu — İlan Arama

\`\`\`
/jobs → Pozisyon seçimi → Gemi tipi → Sonuçlar listesi
\`\`\`

Sonuç formatı (her ilan için):
\`\`\`
[Şablon — ilan başlığı, gemi, ülke, maaş, link]
\`\`\`

Pagination: "⬅️ Önceki | 1/5 | Sonraki ➡️"

## 6. ⚡ Hızlı Komutlar
| Komut | Açıklama | Yanıt özeti |
|---|---|---|
| /start | Başlat | Hoş geldin akışı |
| /jobs | İlan ara | Filtreleme akışı |
| /register | Kayıt ol | Direkt link |
| /salary | Maaş rehberi | Rütbeye göre tablo |
| /stcw | Sertifika bilgisi | Bilgi kartları |
| /help | Yardım | Komut listesi |
| /language | Dil değiştir | TR / EN / Filipino |
| /stop | Bildirimleri durdur | Opt-out |

## 7. 🔔 Proaktif Bildirim Sistemi
Kullanıcı kayıt olduktan sonra:
- Yeni ilan bildirimi (rütbeye göre filtreli) — şablon mesaj
- Haftalık özet — şablon mesaj
- STCW yenileme hatırlatıcısı — şablon mesaj

## 8. 🌍 Çok Dilli Destek
- /language komutuyla TR / EN / Filipino seçimi
- Her kritik mesajın 3 dil versiyonu (İngilizce, Türkçe, Tagalog)

## 9. 🛠️ Teknik Uygulama Notları
- Önerilen kütüphane: python-telegram-bot (Python) veya telegraf.js (Node.js)
- State yönetimi: Redis veya in-memory (conversation context)
- Webhook vs. polling kararı
- Crewin API entegrasyon noktaları (gerçek ilan verisi çekme)
- Rate limiting (Telegram: 30 msg/sn grup, 1 msg/sn kullanıcı)
- Deployment önerisi (Railway, Fly.io, VPS)

## 10. 📊 Bot Analytics
- Kullanıcı başına dönüşüm hunisi
- Hangi adımda kullanıcı düşüyor? (drop-off)
- Kayıt tamamlama oranı hedefi
- Ölçüm araçları (Tgstat, özel analytics)

KRITIK:
- ${language === 'tr' ? 'TÜM bot mesajları TÜRKÇE (İngilizce karşılıkları da ver)' : 'ALL bot messages in ENGLISH (Turkish optional)'}
- Buton metinleri max 64 karakter, net ve net CTA
- Seafarer jargonunu doğru kullan (gemi adamına saygılı ton)
- Her mesaj max 4096 karakter (Telegram limiti)
- Gerçek Crewin verisini mesajlara yansıt (${realStats.totalJobs} ilan, ${realStats.totalSeafarers.toLocaleString()} üye)
- Markdown formatting kullan (bold, code blocks)
`;

  return await client.generateWithRetry(prompt, model);
}

module.exports = {
  generateClickToWhatsApp,
  generateTelegramChannel,
  generateTelegramBot,
};
