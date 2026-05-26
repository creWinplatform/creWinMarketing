// ─── Performans Takibi — UTM + Analytics + Geri Bildirim Döngüsü ─────────────
const client     = require('../ai-client');
const { google } = require('googleapis');
const fs         = require('fs-extra');
const path       = require('path');

const SITE_URL = process.env.GOOGLE_SITE_URL || 'https://crewinjob.com';

// ─── UTM Link Üretici ─────────────────────────────────────────────────────────
function generateUTMLink(params) {
  const {
    page    = '/account/register',
    source,   // facebook, linkedin, tiktok, instagram, twitter
    medium,   // social, cpc, email, organic
    campaign, // seafarer_growth, weekly_jobs, tiktok_cta
    content,  // hangi post / içerik türü
    term,     // keyword (opsiyonel)
  } = params;

  const base   = `${SITE_URL}${page}`;
  const utmParams = new URLSearchParams({
    utm_source:   source,
    utm_medium:   medium,
    utm_campaign: campaign,
    ...(content && { utm_content: content }),
    ...(term    && { utm_term:    term }),
  });

  return `${base}?${utmParams.toString()}`;
}

// ─── Kampanya için UTM link paketi ────────────────────────────────────────────
function generateCampaignUTMs(campaignName) {
  const platforms = [
    { source: 'facebook',  medium: 'social',    page: '/account/register' },
    { source: 'instagram', medium: 'social',    page: '/account/register' },
    { source: 'linkedin',  medium: 'social',    page: '/account/register' },
    { source: 'twitter',   medium: 'social',    page: '/account/register' },
    { source: 'tiktok',    medium: 'social',    page: '/account/register' },
    { source: 'facebook',  medium: 'social',    page: '/'                 },
    { source: 'linkedin',  medium: 'social',    page: '/jobs'             },
  ];

  return platforms.map(p => ({
    platform: p.source,
    page:     p.page,
    link:     generateUTMLink({ ...p, campaign: campaignName, content: `${p.source}_${campaignName}` }),
    shortLabel: `${p.source} → ${p.page}`,
  }));
}

// ─── Google Analytics 4 veri çekici ──────────────────────────────────────────
async function fetchGA4Data(credentials, propertyId, days = 7) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });

    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });

    const [overview, channels, pages, conversions] = await Promise.all([
      // Genel metrikler
      analyticsData.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
          metrics: [
            { name: 'sessions' },
            { name: 'totalUsers' },
            { name: 'newUsers' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' },
          ],
        },
      }),
      // Kanal bazlı
      analyticsData.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'conversions' }],
        },
      }),
      // Sayfa bazlı
      analyticsData.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [{ name: 'screenPageViews' }, { name: 'averageSessionDuration' }],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 20,
        },
      }),
      // UTM kaynaklı dönüşümler
      analyticsData.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
          dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'sessionCampaignName' }],
          metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'conversions' }],
          orderBys: [{ metric: { metricName: 'newUsers' }, desc: true }],
          limit: 20,
        },
      }),
    ]);

    return {
      period:     `Son ${days} gün`,
      overview:   parseGA4Overview(overview.data),
      channels:   parseGA4Rows(channels.data),
      topPages:   parseGA4Rows(pages.data),
      utmSources: parseGA4Rows(conversions.data),
      source:     'google_analytics_4',
    };
  } catch (err) {
    console.log(`  ⚠️  GA4 bağlanamadı: ${err.message}`);
    return getMockGA4Data(days);
  }
}

function parseGA4Overview(data) {
  const row = data.rows?.[0]?.metricValues || [];
  return {
    sessions:        parseInt(row[0]?.value || 0),
    totalUsers:      parseInt(row[1]?.value || 0),
    newUsers:        parseInt(row[2]?.value || 0),
    bounceRate:      parseFloat(row[3]?.value || 0).toFixed(1) + '%',
    avgSessionDur:   formatDuration(parseInt(row[4]?.value || 0)),
  };
}

function parseGA4Rows(data) {
  return (data.rows || []).map(row => {
    const dims = row.dimensionValues?.map(d => d.value) || [];
    const mets = row.metricValues?.map(m => m.value)    || [];
    return { dimensions: dims, metrics: mets };
  });
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ─── İçerik performans geçmişi (yerel kayıt) ─────────────────────────────────
const PERF_FILE = path.join(__dirname, '..', 'output', '.performance_history.json');

async function saveContentPerformance(entry) {
  // entry: { platform, type, date, reach, clicks, signups, notes }
  await fs.ensureDir(path.dirname(PERF_FILE));
  let history = [];
  if (await fs.pathExists(PERF_FILE)) {
    history = await fs.readJSON(PERF_FILE).catch(() => []);
  }
  history.push({ ...entry, savedAt: new Date().toISOString() });
  await fs.writeJSON(PERF_FILE, history, { spaces: 2 });
}

async function getContentPerformance() {
  if (!(await fs.pathExists(PERF_FILE))) return [];
  return await fs.readJSON(PERF_FILE).catch(() => []);
}

// ─── Performans bazlı içerik önerisi ─────────────────────────────────────────
async function generatePerformanceInsights(performanceHistory, currentData) {
  if (performanceHistory.length === 0) {
    return 'Henüz performans verisi yok. İçerik paylaştıkça veriler birikecek.';
  }

  // En iyi ve en kötü performans gösteren içerikleri bul
  const sorted = [...performanceHistory].sort((a,b) => (b.signups||0) - (a.signups||0));
  const best   = sorted.slice(0, 3);
  const worst  = sorted.slice(-3);

  const prompt = `
crewinjob.com içerik performans geçmişi:

En iyi 3 içerik (kayıt başına):
${JSON.stringify(best, null, 2)}

En düşük 3 içerik:
${JSON.stringify(worst, null, 2)}

Mevcut hafta verileri:
${JSON.stringify(currentData, null, 2)}

Şunları yaz:
1. **Hangi içerik tipi en iyi çalışıyor?** (platform + tip + neden)
2. **Bu hafta ne üretmeli?** (geçmiş veriye göre 3 öneri)
3. **Neyi bırakmalı?** (düşük performanslı içerik tipi)
4. **Bir sonraki hafta için tahmin** (mevcut trend devam ederse)

Kısa ve net yaz. Türkçe.
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Haftalık performans raporu ───────────────────────────────────────────────
async function generatePerformanceReport(apiData, ga4Data, outputDir) {
  console.log('\n  📈 Performans raporu oluşturuluyor...');

  await fs.ensureDir(outputDir);

  const history  = await getContentPerformance();
  const insights = await generatePerformanceInsights(history, { apiData, ga4Data });

  // UTM link paketi üret
  const utmLinks = generateCampaignUTMs('seafarer_growth_' + new Date().toISOString().slice(0,7));

  const md = `# 📈 Performans Raporu — crewinjob.com
> ${new Date().toLocaleString('tr-TR')}

## AI İçerik Önerileri (Geçmiş Veriye Göre)

${insights}

---

## Bu Hafta UTM Linkleri

Aşağıdaki linkleri sosyal medya paylaşımlarında kullanın.
Her platform için farklı link — nereden kaç kayıt geldiğini görürsünüz.

| Platform | Hedef Sayfa | UTM Link |
|----------|-------------|----------|
${utmLinks.map(u => `| ${u.platform} | ${u.page} | \`${u.link}\` |`).join('\n')}

---

## Trafik Özeti (Google Analytics)

| Metrik | Değer |
|--------|-------|
| Toplam Oturum | ${ga4Data.overview?.sessions || 'API gerekli'} |
| Yeni Kullanıcı | ${ga4Data.overview?.newUsers || 'API gerekli'} |
| Bounce Rate | ${ga4Data.overview?.bounceRate || 'API gerekli'} |
| Ort. Oturum Süresi | ${ga4Data.overview?.avgSessionDur || 'API gerekli'} |

### UTM Kaynakları (Gerçek Kayıt Kaynakları)
${ga4Data.utmSources?.length > 0
  ? ga4Data.utmSources.map(r =>
      `- ${r.dimensions.join(' / ')}: ${r.metrics[1]} yeni kullanıcı`
    ).join('\n')
  : 'Google Analytics bağlandığında burada göreceksiniz'}

---

## Performans Geçmişi

${history.length > 0
  ? `${history.length} içerik kaydı mevcut. Son 5:\n` +
    history.slice(-5).map(h =>
      `- ${h.date} | ${h.platform} | ${h.type} | ${h.signups || 0} kayıt | ${h.notes || ''}`
    ).join('\n')
  : 'Henüz kayıt yok. İçerik paylaştıkça performans verileri girin.'}

---

## Performans Girişi

Paylaşım yaptıktan sonra sonuçları kaydetmek için:
\`node index.js → Menü 14 → Performans Gir\`

---
*crewinjob Marketing Agent — Performans Takip Modülü*
`;

  const filepath = path.join(outputDir, `performans_${new Date().toISOString().slice(0,10)}.md`);
  await fs.writeFile(filepath, md);

  return { filepath, insights, utmLinks };
}

// ─── Mock GA4 verisi ──────────────────────────────────────────────────────────
function getMockGA4Data(days) {
  return {
    period:   `Son ${days} gün`,
    overview: { sessions: 0, totalUsers: 0, newUsers: 0, bounceRate: '0%', avgSessionDur: '0:00' },
    channels: [], topPages: [], utmSources: [],
    source:   'mock — Google Analytics 4 henüz bağlı değil',
    setupNote: 'GA4_PROPERTY_ID ve google-credentials.json gerekli',
  };
}

module.exports = {
  generateUTMLink,
  generateCampaignUTMs,
  fetchGA4Data,
  saveContentPerformance,
  getContentPerformance,
  generatePerformanceReport,
  generatePerformanceInsights,
};
