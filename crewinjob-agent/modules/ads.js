// ─── Reklam Kampanyası Generator (Facebook + Google Ads) ─────────────────────
// Dijital pazarlama personeli yokken AI ile profesyonel kampanya üretir.
const client = require('../ai-client');

// ─── Hedef kitle preset'leri (denizcilik sektörü) ─────────────────────────────
const AUDIENCE_PRESETS = {
  seafarer_tr: {
    name: 'Türk Gemi Adamları',
    locations: ['Türkiye', 'KKTC'],
    age: '21-55',
    interests: ['Maritime jobs', 'Seafarer', 'Merchant Navy', 'Gemi adamı', 'Denizcilik', 'STCW'],
    languages: ['Turkish'],
    behaviors: ['İş arayanlar', 'Mobil cihaz kullanıcıları'],
    notes: 'Yüksek conversion potansiyeli — yerel kitle, Türkçe içerik',
  },
  seafarer_global: {
    name: 'Global Seafarers',
    locations: ['Philippines', 'India', 'Indonesia', 'Pakistan', 'Ukraine', 'Romania', 'Turkey'],
    age: '21-55',
    interests: ['Maritime jobs', 'Seafarer', 'Merchant Navy', 'STCW certificate', 'Bulk Carrier', 'Tanker'],
    languages: ['English', 'Filipino', 'Russian'],
    behaviors: ['Job seekers', 'Travelers', 'Mobile users'],
    notes: 'En geniş kitle — top 5 seafarer ülkeleri (Crewin verisi)',
  },
  shipowner: {
    name: 'Armatörler & Crew Manager',
    locations: ['Turkey', 'Greece', 'Cyprus', 'UAE', 'Singapore', 'UK'],
    age: '30-60',
    interests: ['Ship owner', 'Crew management', 'Maritime recruitment', 'Vessel operation'],
    job_titles: ['Crew Manager', 'Operations Manager', 'HR Manager', 'Ship Owner', 'Fleet Manager'],
    behaviors: ['B2B decision makers', 'LinkedIn active'],
    notes: 'B2B kitle — LinkedIn Ads ile birlikte kullan',
  },
  retention: {
    name: 'Retention — Yarım Profil Kullanıcıları',
    audience_type: 'Custom Audience',
    source: 'Site ziyaretçileri (yarım profil bırakmış)',
    notes: 'Crewin\'e kayıt olup profilini bitirmemiş 10.836 kullanıcıya yönelik. Lookalike de oluşturulabilir.',
  },
};

// ─── Facebook Ads Kampanyası ──────────────────────────────────────────────────
async function generateFacebookCampaign(params, stats, model) {
  const {
    objective = 'lead_generation',  // awareness | traffic | engagement | leads | conversions
    audience  = 'seafarer_global',
    budget    = 500,                // USD/ay
    language  = 'en',
    customGoal = '',
  } = params;

  const audienceData = AUDIENCE_PRESETS[audience] || AUDIENCE_PRESETS.seafarer_global;

  const realStats = {
    totalSeafarers:  stats.seafarers?.total || 0,
    totalCompanies:  stats.jobs?.companies || 0,
    totalJobs:       stats.jobs?.total || 0,
    incompleteUsers: stats.seafarers?.incompleteProfiles || 0,
    topCountries:    Object.keys(stats.seafarers?.byNationality || {}).slice(0, 5),
  };

  const prompt = `
Sen crewinjob.com'un dijital pazarlama uzmanısın. Profesyonel bir Facebook Ads kampanyası tasarlayacaksın.

📊 GERÇEK PLATFORM VERİSİ (Crewin API):
- Toplam gemi adamı: ${realStats.totalSeafarers.toLocaleString()}
- Toplam firma: ${realStats.totalCompanies.toLocaleString()}
- Aktif ilan: ${realStats.totalJobs.toLocaleString()}
- Yarım profil kullanıcı: ${realStats.incompleteUsers.toLocaleString()}
- En çok kullanıcı olan ülkeler: ${realStats.topCountries.join(', ')}

🎯 KAMPANYA PARAMETRELERİ:
- Amaç: ${objective}
- Hedef kitle preset: ${audienceData.name}
- Aylık bütçe: $${budget}
- Dil: ${language === 'tr' ? 'Türkçe' : 'English'}
${customGoal ? `- Özel hedef: ${customGoal}` : ''}

🎯 HEDEF KİTLE DETAYI:
${JSON.stringify(audienceData, null, 2)}

GÖREV: Aşağıdaki kapsamda Facebook Ads kampanya planı oluştur (markdown formatında):

# 📘 Facebook Ads Kampanya Planı

## 🎯 1. Kampanya Stratejisi
- Kampanya amacı (Meta'daki tam adı)
- Beklenen sonuç (CPL, CPC, CTR tahminleri — denizcilik sektörü ortalamaları)
- Funnel pozisyonu (TOFU/MOFU/BOFU)

## 👥 2. Detaylı Hedef Kitle
- Coğrafya (ülke listesi + öncelik sırası)
- Demografi (yaş, cinsiyet)
- İlgi alanları (Meta'da arama yaparken kullanılacak EXACT terimler)
- Davranış filtreleri
- Hariç tutulacaklar (mevcut müşteriler, çalışanlar)
- Tahmini erişim büyüklüğü

## 💰 3. Bütçe & Dağılım
- Günlük bütçe önerisi
- A/B test bütçesi (toplam %20)
- Kampanya türleri arası dağılım

## ✍️ 4. Reklam Metinleri (3 VARYANT)
Her varyant için:
- **Primary Text** (125 karakter ideal)
- **Headline** (40 karakter)
- **Description** (30 karakter)
- **CTA Buton:** Apply Now / Sign Up / Learn More
- Kullanılan psikolojik tetikleyici (FOMO, social proof, scarcity, vs.)

## 🎨 5. Görsel/Video Brief
- Görsel format önerisi (single image / carousel / video)
- Görselde olması gerekenler (kompozisyon, renk, metin overlay)
- Video varsa: 15s storyboard

## 📊 6. Ad Set Yapısı
- Kaç ad set, hangi kitleye?
- Optimization event seçimi
- Placement önerisi (Feed, Stories, Reels)

## 🔬 7. A/B Test Planı
- Test edilecek 2-3 varyant
- Başarı metriği
- Test süresi & bütçe

## 📈 8. Pixel & Tracking
- Hangi event'ler tetiklenmeli (PageView, Lead, CompleteRegistration)
- Custom Audience önerileri (lookalike, retargeting)
- Conversion API kurulumu

## ⚠️ 9. Riskler & İyileştirmeler
- Reddedilebilecek metin/görsel uyarıları
- Crewin verisine göre 2 hafta sonra optimizasyon önerileri

KRITIK KURALLAR:
- ${language === 'tr' ? 'Tüm metinleri TÜRKÇE yaz' : 'All ad copy in ENGLISH'}
- Sayıları gerçek Crewin verisinden kullan
- Meta Ads Library'de görülebilecek profesyonel bir kalite
- Maritime sektör jargonunu doğru kullan
- Belirsiz değil, NET ve SAYISAL öneriler ver
`;

  return await client.generateWithRetry(prompt, model);
}

// ─── Google Ads Kampanyası (Search) ───────────────────────────────────────────
async function generateGoogleCampaign(params, stats, model) {
  const {
    campaignType = 'search',  // search | display | youtube | performance_max
    keywords     = '',
    budget       = 500,
    language     = 'en',
    targetCountry = 'all',
  } = params;

  const realStats = {
    totalSeafarers: stats.seafarers?.total || 0,
    totalJobs:      stats.jobs?.total || 0,
    topCountries:   Object.keys(stats.seafarers?.byNationality || {}).slice(0, 5),
  };

  const prompt = `
Sen crewinjob.com'un Google Ads uzmanısın. Search-first kampanya tasarlayacaksın.

📊 GERÇEK PLATFORM VERİSİ:
- ${realStats.totalSeafarers.toLocaleString()} gemi adamı, ${realStats.totalJobs} aktif ilan
- En çok kullanıcı: ${realStats.topCountries.join(', ')}

🎯 PARAMETRELER:
- Kampanya tipi: ${campaignType}
- Aylık bütçe: $${budget}
- Hedef ülke: ${targetCountry === 'all' ? 'Global (Top seafarer ülkeleri)' : targetCountry}
- Dil: ${language === 'tr' ? 'Türkçe' : 'English'}
${keywords ? `- Tohum keyword'ler: ${keywords}` : ''}

GÖREV: Aşağıdaki Google Ads kampanya planını markdown formatında üret:

# 🔍 Google Ads Kampanya Planı

## 1. 📋 Kampanya Yapısı
- Hesap → Kampanya → Ad Group hiyerarşisi
- Tahmini CPC aralığı (denizcilik sektörü)
- Conversion goal (web form, sign-up, application)

## 2. 🎯 Keyword Strategy
**High Intent (Exact Match):** 10 adet
**Mid Intent (Phrase Match):** 10 adet
**Discovery (Broad Match Modifier):** 5 adet
Her birinin yanında: tahmini aylık arama hacmi, CPC, rekabet seviyesi (Low/Med/High)

## 3. 🚫 Negative Keywords
Bütçeyi koruyacak 20+ negatif kelime (örn: "free", "definition", "wikipedia", öğrenci, oyun, vs.)

## 4. ✍️ Responsive Search Ads (RSA)
Her Ad Group için:
**15 Headline** (max 30 karakter)
- 3 tanesi keyword-rich
- 3 tanesi value proposition (ücretsiz, hızlı, profesyonel vs.)
- 3 tanesi CTA odaklı (Apply Now, Get Hired)
- 3 tanesi sosyal proof (10K+ seafarers)
- 3 tanesi acil/scarcity

**4 Description** (max 90 karakter)
- 1 ana teklif
- 1 fayda listesi
- 1 sosyal proof
- 1 CTA

## 5. 🎯 Ad Extensions
- **Sitelink** (en az 4): hangi URL'lere?
- **Callout** (en az 6): kısa fayda noktaları
- **Structured Snippet**: Vessel Types / Ranks / Services
- **Lead Form Extension**: gerekirse
- **Location Extension**: ofis adresi varsa

## 6. 📍 Coğrafi & Demografi
- Bid adjustment (öncelikli ülkelere +%X)
- Mobil/desktop bid ayarı (denizciler mobilde araştırır)
- Saatlik teklif optimizasyonu (denizci vardiya saatleri)

## 7. 💰 Bütçe Dağılımı
- Search Network bütçesi
- Display retargeting (mevcut ziyaretçiler)
- YouTube (varsa)

## 8. 📊 Conversion Tracking
- GA4 + Google Tag Manager event'leri
- Enhanced Conversions (ülkeye göre)
- Phone call tracking gerekli mi?

## 9. 🎨 Landing Page Önerileri
- Hangi keyword grubuna hangi landing page?
- A/B test edilecek elementler
- Page speed & mobile optimization checklist

## 10. 📈 İlk 30 Gün Optimizasyon Plan
- Hafta 1: hangi metrikler izlenmeli?
- Hafta 2: bid optimizasyonu
- Hafta 3-4: keyword genişletme + negative ekleme

KRITIK KURALLAR:
- ${language === 'tr' ? 'Headlines + descriptions TÜRKÇE' : 'Headlines + descriptions in ENGLISH'}
- Karakter sınırlarına UY (Headlines ≤30, Description ≤90)
- Maritime sektör keyword'lerini doğru kullan
- Gerçek arama hacmi tahminleri (Türkiye + global)
- Sayısal, uygulanabilir öneriler
`;

  return await client.generateWithRetry(prompt, model);
}

// ─── Keyword Research (Google SEO + Ads için ortak) ──────────────────────────
async function generateKeywordResearch(params, stats, model) {
  const {
    seedKeyword = 'seafarer jobs',
    language    = 'en',
    intent      = 'all',  // commercial | informational | transactional | all
  } = params;

  const prompt = `
Sen crewinjob.com'un SEO uzmanısın. Maritime/denizcilik sektörü için derin keyword research yap.

🌱 Seed keyword: "${seedKeyword}"
🎯 Intent filtresi: ${intent}
🌍 Dil: ${language === 'tr' ? 'Türkçe' : 'English'}

📊 Crewin platform verisi:
- ${stats.seafarers?.total || 0} gemi adamı (${Object.keys(stats.seafarers?.byNationality || {}).slice(0, 3).join(', ')} ağırlıklı)
- ${stats.jobs?.total || 0} aktif ilan, ${stats.jobs?.companies || 0} firma

GÖREV: Maritime sektöründe 30+ keyword öner, her biri için:

| Keyword | Search Intent | Tahmini Aylık Arama | Rekabet | Önerilen Sayfa | Notlar |

Tablo formatında ver. Sonra şu bölümleri ekle:

## 🎯 Topic Cluster Önerileri
3-5 ana cluster (örn: "STCW Certificates", "Cadet Programs", "Crew Recruitment")
Her cluster için: pillar page + 5-7 cluster page önerisi

## 📍 Yerel SEO Fırsatları
Türkiye, İstanbul, İzmir, Tuzla gibi denizcilik merkezleri için keyword'ler

## 🆚 Quick-Win Keywords
Düşük rekabet + yüksek dönüşüm potansiyeli olan 10 keyword

## ❓ People Also Ask Soruları
20+ uzun kuyruklu soru tabanlı keyword (FAQ sayfaları için)

## 🌐 Internationalization
Filipince, Rusça, Hintçe seafarer arama davranışı (ana terimler)

KRITIK:
- ${language === 'tr' ? 'Türkçe keyword\'lere ağırlık ver' : 'English-first, but include Filipino/Russian alternatives'}
- Sayısal tahminlerde gerçekçi ol (denizcilik niche)
- Crewin'in zayıf olabileceği alanları işaretle
`;

  return await client.generateWithRetry(prompt, model);
}

// ─── Rakip Analizi ────────────────────────────────────────────────────────────
async function generateCompetitorAnalysis(params, stats, model) {
  const { language = 'en', focus = 'all' } = params;

  const prompt = `
Sen crewinjob.com'un dijital pazarlama stratejistisin. Maritime sektöründeki rakipleri analiz et.

📊 Crewin verisi:
- ${stats.seafarers?.total || 0} kayıtlı gemi adamı (${stats.seafarers?.profileCompletion || 0}% ortalama profil doluluğu)
- ${stats.jobs?.companies || 0} firma, ${stats.jobs?.total || 0} aktif ilan
- Ana ülkeler: ${Object.keys(stats.seafarers?.byNationality || {}).slice(0, 5).join(', ')}

🎯 RAKİPLER:
1. **Martide** (martide.com) — recruitment + crew management
2. **Maritime Connector** (maritime-connector.com) — pure jobs board
3. **MarineLink** (marinelink.com) — news + jobs
4. **SeafarerJobs** (seafarerjobs.com) — niche jobs
5. **Crew24** (crew24.com) — crew management software
6. **Jobfish** (jobfish.com) — international maritime jobs
7. **Bureau Maritime** (bureau-maritime.com) — agency

GÖREV: Her rakip için derinlemesine analiz (markdown tablo + bölümler):

## 1. 📊 Genel Karşılaştırma Tablosu
| Şirket | Ana Odak | Tahmini Trafik | SEO Gücü | UX Kalitesi | Fiyatlandırma | Pazar Payı |

## 2. 🔍 SEO Analizi
- Her rakibin tahmini #1 olduğu keyword'ler
- Backlink stratejisi (kim hangi domainlerden link alıyor?)
- Content gap analizi (Crewin'de eksik, rakipte var)
- Technical SEO durumu (mobile, page speed tahmini)

## 3. 💰 Reklam Stratejisi
- Hangi rakip Google Ads çalıştırıyor? (Ads Library izlenimi)
- Facebook Ads aktif mi?
- LinkedIn'de B2B ads var mı?
- Tahmini reklam bütçeleri

## 4. 🎨 İçerik & Marka
- Sosyal medya aktiflik (frequency + engagement)
- Blog yayın hızı
- Email marketing varlığı
- Influencer/affiliate stratejisi

## 5. ⚙️ Ürün & Özellik Karşılaştırma
- Crewin'in BENZERSIZ avantajları (ne yapıyoruz, kimse yapmıyor?)
- Crewin'in ZAYIF YANLARI (rakipte var, bizde yok)
- Hızlı kazanılabilecek 5 özellik

## 6. 🎯 Crewin için Stratejik Öneriler
- 90 günlük rekabet stratejisi
- Hangi keyword savaşlarına girmeli, hangilerine girmemeli?
- Pazarlama bütçesi nasıl dağıtılmalı?
- Ortaklık fırsatları (rakip değil, tamamlayıcı oyuncular)

## 7. 🚨 Tehditler
- Hangi rakip büyüyor? Neden?
- Pazar değişimleri (regülasyon, AI, trendler)
- Crewin için kısa vadeli risk alarmı

KRITIK:
- ${language === 'tr' ? 'Türkçe' : 'English'} yaz
- Belirsiz değil, NET öneri ver
- Sayısal tahminlerde gerçekçi ol
- Crewin'in mevcut güçlerini abartma — dürüst değerlendirme
`;

  return await client.generateWithRetry(prompt, model);
}

// ─── Instagram Ads Kampanyası ─────────────────────────────────────────────────
async function generateInstagramCampaign(params, stats, model) {
  const {
    objective = 'lead_generation',
    format    = 'reels',   // feed | stories | reels | carousel
    audience  = 'seafarer_global',
    budget    = 500,
    language  = 'en',
    customGoal = '',
  } = params;

  const audienceData = AUDIENCE_PRESETS[audience] || AUDIENCE_PRESETS.seafarer_global;

  const realStats = {
    totalSeafarers:  stats.seafarers?.total || 0,
    totalCompanies:  stats.jobs?.companies || 0,
    totalJobs:       stats.jobs?.total || 0,
    incompleteUsers: stats.seafarers?.incompleteProfiles || 0,
    topCountries:    Object.keys(stats.seafarers?.byNationality || {}).slice(0, 5),
  };

  const formatLabels = {
    feed:     'Feed (Kare / Dikey Görsel)',
    stories:  'Stories (9:16 tam ekran)',
    reels:    'Reels (15-30 sn video)',
    carousel: 'Carousel (4-10 kart)',
  };

  const prompt = `
Sen crewinjob.com'un Instagram Ads uzmanısın. Maritime/denizcilik sektörü için görsel odaklı kampanya tasarlayacaksın.

📊 GERÇEK PLATFORM VERİSİ (Crewin API):
- Toplam gemi adamı: ${realStats.totalSeafarers.toLocaleString()}
- Toplam firma: ${realStats.totalCompanies.toLocaleString()}
- Aktif ilan: ${realStats.totalJobs.toLocaleString()}
- Yarım profil kullanıcı: ${realStats.incompleteUsers.toLocaleString()}
- En çok kullanıcı: ${realStats.topCountries.join(', ')}

🎯 KAMPANYA PARAMETRELERİ:
- Amaç: ${objective}
- Format: ${formatLabels[format] || format}
- Hedef kitle: ${audienceData.name}
- Aylık bütçe: $${budget}
- Dil: ${language === 'tr' ? 'Türkçe' : 'English'}
${customGoal ? `- Özel hedef: ${customGoal}` : ''}

GÖREV: Aşağıdaki kapsamda Instagram Ads kampanya planı oluştur (markdown formatında):

# 📸 Instagram Ads Kampanya Planı

## 1. 🎯 Kampanya Stratejisi
- Meta Ads Manager'da seçilecek amaç
- Beklenen CPR/CPL tahminleri (denizcilik sektörü)
- Funnel pozisyonu ve Instagram'ın rolü (awareness → consideration → conversion)

## 2. 👥 Hedef Kitle Yapısı
- Coğrafya (ülke öncelik sırası)
- Demografik detay (yaş, cinsiyet dağılımı)
- Interest targeting (Meta'da arama edilecek EXACT terimler)
- Behavior signals (iş arayanlar, seyahat, mobil kullanım)
- Instagram'a özel: profile activity & engagement signals
- Lookalike audience önerileri (mevcut kayıtlı seafarers'dan)

## 3. 🎬 Format Stratejisi: ${formatLabels[format] || format}
${format === 'reels' ? `
- Video uzunluğu ve temposu (hook → value → CTA ritmi)
- İlk 3 saniye hook önerileri (durdurma metriği)
- Ses kullanımı (voiceover, müzik, ses efektleri)
- Kapak karesi (thumbnail) tasarım önerileri
- Reels özel metrikleri (watch rate, share rate)` : ''}
${format === 'stories' ? `
- 3-5 kart serisi akışı (swipe-up journey)
- Interaktif elementler (poll, slider, quiz, countdown)
- Stories'e özel CTA: Swipe Up / Tap Link
- Tam ekran görsel kompozisyon kuralları
- 24 saatlik frequency kap` : ''}
${format === 'carousel' ? `
- 4-10 kart senaryosu (ilk kart hook, son kart CTA)
- Her kart için görsel + metin brief
- Carousel'e özel metrikleri (swipe rate, card reach)
- Ürün showcase vs. storytelling formatı seçimi` : ''}
${format === 'feed' ? `
- Kare (1:1) vs. dikey (4:5) format seçimi
- Single image vs. video karar ağacı
- Feed grid estetiği (marka renk tutarlılığı)
- Alt metin (caption) yapısı` : ''}

## 4. ✍️ Reklam Metinleri (3 VARYANT)
Her varyant için:
- **Caption** (ilk satır hook + detay + hashtag)
- **Overlay Text** (görselin üzerinde — kısa, güçlü)
- **CTA Butonu**: Apply Now / Sign Up / Learn More / Get Quote
- Psikolojik tetikleyici (FOMO, aspiration, social proof, scarcity)

## 5. 🎨 Görsel/Video Yaratıcı Brief
- Renk paleti ve kompozisyon önerileri
- Maritime estetik: gemi görselleri, deniz, üniforma vs. lifestyle?
- Metin overlay kuralları (kontrast, font büyüklüğü)
- UGC (user generated content) entegrasyonu fırsatı
- A/B test edilen iki farklı yaratıcı yaklaşım

## 6. 💰 Bütçe & Placement
- Stories vs. Feed vs. Reels bütçe dağılımı
- Günlük bütçe ve frequency kap
- Advantage+ Placements kullanımı
- Retargeting bütçe payı (video izleyenler, profil ziyaretçileri)

## 7. 📊 İçerik Takvimi (Haftalık)
- Organik + ücretli içerik dengesi (60/40 kural)
- En iyi yayın saatleri (denizci mesai saatlerine göre)
- Sezonsal içerik fırsatları (STCW yenileme dönemleri, vb.)

## 8. 📈 KPI & Optimizasyon
- Takip edilecek Instagram-özel metrikler (CPR, story completion rate, swipe-up rate)
- İlk 72 saatte bakılacak sinyaller
- Düşük performanslı kreatifin değiştirilme eşiği

## 9. ♾️ Instagram Organic + Paid Sinerji
- Güçlendirilen organik post stratejisi (boost)
- Story highlight'lara yönlendirme
- Bio linki optimizasyonu (Linktree vs. tek landing)
- Influencer/seafarer ambassador fırsatları

KRITIK KURALLAR:
- ${language === 'tr' ? 'Caption ve overlay metinleri TÜRKÇE' : 'Caption and overlay text in ENGLISH'}
- Instagram karakter limitleri: Caption 2200, overlay ≤8 kelime
- Maritime sektör estetiğini doğru yakala
- Gerçek Crewin rakamlarını kullan
- Mobil-first tasarım odağı
`;

  return await client.generateWithRetry(prompt, model);
}

// ─── LinkedIn Ads Kampanyası ──────────────────────────────────────────────────
async function generateLinkedInCampaign(params, stats, model) {
  const {
    objective     = 'lead_gen',   // brand_awareness | website_visits | engagement | lead_gen | website_conversions | job_applicants
    adFormat      = 'single_image', // single_image | carousel | video | text | spotlight | message | conversation | document
    targeting     = 'shipowner',  // shipowner | seafarer_senior | seafarer_cadet | hr_maritime
    budget        = 500,
    language      = 'en',
    customGoal    = '',
  } = params;

  const realStats = {
    totalSeafarers:  stats.seafarers?.total || 0,
    totalCompanies:  stats.jobs?.companies || 0,
    totalJobs:       stats.jobs?.total || 0,
    topCountries:    Object.keys(stats.seafarers?.byNationality || {}).slice(0, 5),
  };

  const targetingProfiles = {
    shipowner: {
      label: 'Armatörler & Crew Managers (B2B)',
      jobTitles: ['Crew Manager', 'Fleet Manager', 'Ship Owner', 'Operations Manager', 'Marine HR Manager', 'Technical Superintendent'],
      industries: ['Maritime', 'Shipping', 'Oil & Gas', 'Logistics'],
      seniority: ['Director', 'VP', 'C-Suite', 'Owner', 'Manager'],
      companySize: '11-500',
    },
    seafarer_senior: {
      label: 'Kıdemli Deniz Subayları',
      jobTitles: ['Master Mariner', 'Chief Officer', 'Chief Engineer', '2nd Engineer', 'Captain'],
      industries: ['Maritime', 'Shipping', 'Oil & Gas', 'Offshore'],
      seniority: ['Senior', 'Manager', 'Director'],
      companySize: '51-10,000',
    },
    seafarer_cadet: {
      label: 'Genç Denizci & Cadetler',
      jobTitles: ['Deck Cadet', 'Engine Cadet', 'Junior Officer', 'AB Seaman', 'Marine Trainee'],
      industries: ['Maritime', 'Education'],
      seniority: ['Entry', 'Training'],
      companySize: 'Any',
    },
    hr_maritime: {
      label: 'Denizcilik İK & Crewing Ajansları',
      jobTitles: ['Recruitment Manager', 'Crewing Agent', 'HR Manager', 'Manning Agent', 'Talent Acquisition'],
      industries: ['Maritime', 'Staffing & Recruiting', 'Shipping'],
      seniority: ['Manager', 'Senior', 'Director'],
      companySize: '11-200',
    },
  };

  const profile = targetingProfiles[targeting] || targetingProfiles.shipowner;

  const adFormatLabels = {
    single_image:  'Single Image Ad',
    carousel:      'Carousel Ad',
    video:         'Video Ad',
    text:          'Text Ad',
    spotlight:     'Spotlight Ad (Dynamic)',
    message:       'Message Ad (InMail)',
    conversation:  'Conversation Ad',
    document:      'Document Ad (PDF/PPT)',
  };

  const prompt = `
Sen crewinjob.com'un LinkedIn Ads uzmanısın. Maritime sektöründe B2B ve profesyonel hedef kitleye yönelik kampanya tasarlayacaksın.

📊 GERÇEK PLATFORM VERİSİ (Crewin API):
- Toplam gemi adamı: ${realStats.totalSeafarers.toLocaleString()}
- Toplam firma: ${realStats.totalCompanies.toLocaleString()}
- Aktif ilan: ${realStats.totalJobs.toLocaleString()}
- Ana ülkeler: ${realStats.topCountries.join(', ')}

🎯 KAMPANYA PARAMETRELERİ:
- Objective: ${objective}
- Ad Format: ${adFormatLabels[adFormat] || adFormat}
- Hedef profil: ${profile.label}
- Aylık bütçe: $${budget}
- Dil: ${language === 'tr' ? 'Türkçe' : 'English'}
${customGoal ? `- Özel hedef: ${customGoal}` : ''}

🎯 HEDEF KİTLE PROFİLİ:
${JSON.stringify(profile, null, 2)}

GÖREV: Aşağıdaki kapsamda profesyonel bir LinkedIn Ads kampanya planı oluştur (markdown formatında):

# 💼 LinkedIn Ads Kampanya Planı

## 1. 🎯 Kampanya Stratejisi
- LinkedIn Campaign Manager'da seçilecek objective
- LinkedIn'in B2B maritime pazarındaki değer önerisi
- Beklenen CPM/CPC/CPL tahminleri (LinkedIn maritime sektörü ortalamaları)
- Funnel: Awareness → Consideration → Conversion aşamaları

## 2. 🎯 LinkedIn Targeting Katmanları
- **Job Title Targeting**: Tam liste (Campaign Manager'da aranacak)
- **Job Function**: Hangi fonksiyonlar seçilmeli?
- **Seniority Level**: Tam liste
- **Industry**: Primary + secondary industries
- **Company Size**: Hangi aralıklar?
- **Skills Targeting**: Maritime-spesifik beceriler (STCW, ISM, DP Operator vb.)
- **LinkedIn Groups**: Katılınabilecek maritime grupları
- **Matched Audiences**: CRM listesi (Crewin B2B müşterileri) + lookalike
- **Audience Expansion**: Açık mı kapalı mı?
- Tahmini kitle büyüklüğü (min-max)

## 3. 📝 Ad Format Stratejisi: ${adFormatLabels[adFormat] || adFormat}
${adFormat === 'single_image' ? `
- Görsel boyut: 1200×627 (landscape) veya 1080×1080 (kare)
- Intro text yapısı (hook → value → CTA, 150 karakter)
- Headline (max 70 karakter)
- Description (max 100 karakter)
- Görselde metin %20 kuralı
- Landing page önerisi` : ''}
${adFormat === 'message' ? `
- InMail subject line önerileri (A/B test)
- Mesaj gövdesi (300-400 kelime, personalisation tokens)
- CTA butonu metni
- Sender profili (person vs. company page)
- Gönderim zamanlaması
- Open rate & CTR hedefleri` : ''}
${adFormat === 'conversation' ? `
- Konuşma akışı (branching: 2-3 seçenek)
- Her branch için önerilen yanıt metni
- Lead form entegrasyonu
- Fallback mesajı
- Conversion event seçimi` : ''}
${adFormat === 'document' ? `
- Doküman içerik önerisi (whitepaper, industry report, checklist)
- 5-8 sayfa yapısı (cover + içerik + CTA sayfası)
- Lead gen form tetikleyicisi
- Doküman başlığı önerileri (3 varyant)` : ''}
${adFormat === 'carousel' ? `
- 2-10 kart senaryosu
- Her kart: görsel + headline + description + link
- Son kart CTA
- Carousel için KPI: swipe rate, per-card CTR` : ''}
${adFormat === 'video' ? `
- Video uzunluğu (5-30 saniye) ve tempo
- Hook-value-CTA yapısı
- Sessiz izlenme için alt yazı zorunluluğu
- Thumbnail seçimi
- Video view completion metriği` : ''}
${adFormat === 'spotlight' ? `
- Dynamic personalization alanları (First Name, Company, Job Title)
- Background görsel önerisi
- CTA destination: profile, website, landing page
- LinkedIn Insight Tag zorunluluğu` : ''}

## 4. ✍️ Reklam Metinleri (3 VARYANT)
Her varyant için:
- **Intro Text / Subject Line**
- **Headline**
- **Description**
- **CTA**
- Psikolojik çerçeve (authority, scarcity, ROI calculator, social proof)
- B2B tone of voice notları

## 5. 💰 Bütçe & Teklif Stratejisi
- LinkedIn'de minimum günlük bütçe ($10/gün önerisi)
- Manuel CPC vs. otomatik teklif
- Maximum CPL hedefi (maritime B2B için)
- CPM hedefleme ne zaman mantıklı?
- Frekans kap (brand fatigue önleme)

## 6. 📋 LinkedIn Lead Gen Form
- Form alanları (isim, şirket, unvan, email, ülke)
- Maritime-spesifik ek sorular (fleet size, vessel type, crew count)
- Teşekkür mesajı ve hızlı takip SLA
- CRM entegrasyonu (HubSpot, Salesforce uyumluluğu)

## 7. 🔄 Retargeting & Nurture Sequencing
- Site ziyaretçisi segmentleri (LinkedIn Insight Tag ile)
- Video izleyenler → next step
- Form bırakanlar → nurture sequence
- 3-aşamalı ad sequencing planı (Awareness → Consideration → Conversion)

## 8. 📊 LinkedIn Analytics & Optimizasyon
- Campaign Manager'da takip edilecek metrikler
- Click-to-open rate (CTOR) hedefleri
- İlk 2 haftada A/B test raporu
- Budget pacing kontrolü (daily spend anomalies)

## 9. 🤝 Organik LinkedIn Sinerji
- Company Page optimizasyonu (crewinjob.com sayfası için öneriler)
- Employee advocacy (takım üyeleri paylaşım programı)
- LinkedIn newsletter fırsatı (maritime insights)
- Showcase Page (B2B firma sayfası ayrımı)

KRITIK KURALLAR:
- ${language === 'tr' ? 'Intro text ve Headline TÜRKÇE' : 'Intro text and headline in ENGLISH'}
- LinkedIn karakter limitleri: Intro 600, Headline 70, Description 100
- B2B tone — net ROI çerçevesi, jargon değil değer
- Maritime profesyonellere saygılı, satışa odaklı değil ilişkiye odaklı
- LinkedIn Advertising Policies uyumu
`;

  return await client.generateWithRetry(prompt, model);
}

module.exports = {
  AUDIENCE_PRESETS,
  generateFacebookCampaign,
  generateGoogleCampaign,
  generateInstagramCampaign,
  generateLinkedInCampaign,
  generateKeywordResearch,
  generateCompetitorAnalysis,
};
