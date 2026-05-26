// ─── Keyword Araştırma + Rakip Analizi + Sıralama Takibi ─────────────────────
const { google } = require('googleapis');
const fetch  = (...a) => import('node-fetch').then(({ default: f }) => f(...a));
const client = require('../ai-client');
const fs     = require('fs-extra');
const path   = require('path');
const SITE_URL = process.env.GOOGLE_SITE_URL || 'https://crewinjob.com';

// ─── Hedef keyword listesi — denizcilik sektörü ───────────────────────────────
const MARITIME_KEYWORDS = {
  highPriority: [
    'seafarer jobs',
    'merchant navy jobs',
    'maritime jobs',
    'chief officer jobs',
    'second engineer jobs',
    'bulk carrier jobs',
    'tanker seafarer vacancy',
    'seafarer recruitment platform',
    'gemi adamı iş ilanları',
    'denizci iş ilanları',
    'gemi adamı işe alım',
  ],
  medium: [
    'seafarer cv template',
    'stcw certificates',
    'maritime recruitment',
    'crew management software',
    'ship crew hiring',
    'offshore jobs seafarer',
    'maritime career platform',
    'seafarer profile',
  ],
  longTail: [
    'chief officer bulk carrier jobs 2026',
    'second engineer chemical tanker vacancy',
    'master container ship recruitment',
    'bosun offshore vessel job',
    'cadet sea service training',
    'free seafarer recruitment platform',
    'maritime jobs turkey',
  ],
};

// ─── Rakipler ─────────────────────────────────────────────────────────────────
const COMPETITORS = [
  { name: 'MarineLink',            url: 'marinelink.com',             focus: 'news + jobs' },
  { name: 'Maritime Connector',    url: 'maritime-connector.com',     focus: 'jobs' },
  { name: 'Martide',               url: 'martide.com',                focus: 'recruitment' },
  { name: 'SeafarerJobs',          url: 'seafarerjobs.com',           focus: 'jobs' },
  { name: 'Crew24',                url: 'crew24.com',                 focus: 'crew management' },
  { name: 'Jobfish',               url: 'jobfish.com',                focus: 'maritime jobs' },
  { name: 'Bureau Maritime',       url: 'bureau-maritime.com',        focus: 'agency' },
];

// ─── Google Search Console — Keyword sıralama verisi ─────────────────────────
async function getKeywordRankings(credentials, days = 28) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    const sc = google.searchconsole({ version: 'v1', auth });

    const endDate   = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const response = await sc.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate, endDate,
        dimensions: ['query'],
        rowLimit: 100,
        orderBys: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
      },
    });

    const rows = response.data.rows || [];
    return {
      period: `${startDate} — ${endDate}`,
      rankings: rows.map(r => ({
        keyword:     r.keys?.[0],
        position:    Math.round(r.position * 10) / 10,
        clicks:      r.clicks,
        impressions: r.impressions,
        ctr:         (r.ctr * 100).toFixed(1) + '%',
        status:      r.position <= 3 ? '🟢 Top 3' :
                     r.position <= 10 ? '🟡 İlk Sayfa' :
                     r.position <= 20 ? '🟠 2. Sayfa' : '🔴 3+ Sayfa',
      })),
      source: 'search_console',
    };
  } catch (err) {
    return {
      period: `Son ${days} gün`,
      rankings: getMockRankings(),
      source: 'mock',
      error: err.message,
    };
  }
}

function getMockRankings() {
  return [
    { keyword: 'crewinjob',               position: 1.0,  clicks: 45,  impressions: 52,   ctr: '86.5%', status: '🟢 Top 3' },
    { keyword: 'seafarer jobs turkey',     position: 8.3,  clicks: 12,  impressions: 234,  ctr: '5.1%',  status: '🟡 İlk Sayfa' },
    { keyword: 'gemi adamı iş ilanları',  position: 14.7, clicks: 5,   impressions: 189,  ctr: '2.6%',  status: '🟠 2. Sayfa' },
    { keyword: 'maritime jobs platform',   position: 23.4, clicks: 2,   impressions: 145,  ctr: '1.4%',  status: '🔴 3+ Sayfa' },
    { keyword: 'chief officer jobs',       position: 31.2, clicks: 0,   impressions: 890,  ctr: '0.0%',  status: '🔴 3+ Sayfa' },
    { keyword: 'seafarer recruitment',     position: 28.6, clicks: 1,   impressions: 567,  ctr: '0.2%',  status: '🔴 3+ Sayfa' },
  ];
}

// ─── Rakip analizi — web fetch ile ───────────────────────────────────────────
async function analyzeCompetitor(competitor) {
  try {
    const res  = await fetch(`https://${competitor.url}`, { timeout: 8000 });
    const html = await res.text();

    // Basit meta tag analizi
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch  = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
    const h1Match    = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);

    return {
      name:        competitor.name,
      url:         competitor.url,
      title:       titleMatch?.[1]?.trim().slice(0,80) || 'N/A',
      description: descMatch?.[1]?.trim().slice(0,150) || 'N/A',
      h1:          h1Match?.[1]?.trim().slice(0,100) || 'N/A',
      accessible:  true,
      focus:        competitor.focus,
    };
  } catch {
    return { name: competitor.name, url: competitor.url, accessible: false, focus: competitor.focus };
  }
}

// ─── AI Keyword Araştırması ───────────────────────────────────────────────────
async function generateKeywordStrategy(currentRankings, competitorData, jobStats) {
  const topKeywords    = currentRankings.rankings.filter(r => r.impressions > 100).slice(0, 15);
  const page2Keywords  = currentRankings.rankings.filter(r => r.position > 10 && r.position <= 25);

  const prompt = `
Sen crewinjob.com için SEO stratejisti olarak çalışıyorsun.
Platform: AI destekli denizcilik iş platformu
Mevcut durum: ${jobStats.jobs} ilan, ${jobStats.seafarers} seafarer

Mevcut sıralamalar (GSC verisi):
${JSON.stringify(topKeywords.slice(0, 10), null, 2)}

2. Sayfada bekleyenler (quick win fırsatları):
${JSON.stringify(page2Keywords.slice(0, 8), null, 2)}

Rakip URL'leri: ${COMPETITORS.map(c => c.url).join(', ')}

Hedef keyword listesi:
- Yüksek öncelik: ${MARITIME_KEYWORDS.highPriority.slice(0,5).join(', ')}
- Long tail: ${MARITIME_KEYWORDS.longTail.slice(0,5).join(', ')}

Şunları yaz:

## 1. Quick Win Keyword'ler (30 günde sonuç)
2. sayfadaki keyword'lerden hangisi en düşük çabayla 1. sayfaya çıkabilir?
Her biri için: neden, nasıl, hangi içerik.

## 2. Bu Ay Hedef 3 Keyword
Hangi 3 keyword'e odaklanmalı? Neden?

## 3. Kaçırılan Fırsatlar
Çok aranan ama hiç sıralamada olmadığımız keyword'ler.

## 4. Blog Makale Önerileri (Keyword Bazlı)
Her biri belirli bir keyword'ü hedefleyen 3 makale başlığı.

## 5. İç Link Stratejisi
Hangi sayfalar birbirine bağlanmalı? Keyword juice'u nasıl aktarmalı?

Türkçe, somut ve aksiyon odaklı yaz.
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Backlink takibi — web araması ile ───────────────────────────────────────
async function trackBacklinks() {
  // Gerçek backlink verisi için Ahrefs/SEMrush API'si ücretli
  // Ücretsiz alternatif: Google'da "site:crewinjob.com -site:crewinjob.com" araması
  // veya Google Search Console inbound links
  return {
    note: 'Backlink verisi için Ahrefs ($99/ay) veya SEMrush ($99/ay) entegrasyonu gerekiyor.',
    freeAlternative: 'Google Search Console → Links bölümünden ücretsiz backlink listesi alınabilir.',
    manualCheck: [
      `https://ahrefs.com/site-explorer/overview?target=${SITE_URL}`,
      `https://www.semrush.com/analytics/backlinks/?q=${SITE_URL}`,
      `https://search.google.com/search-console (Links bölümü)`,
    ],
    earningOpportunities: [
      'MarineLink.com — forum gönderileri + profil',
      'Maritime Connector — ücretsiz listelenme',
      'Denizcilik blogları — misafir yazı',
      'Seafarers forum imzası — crewinjob.com linki',
      'LinkedIn makaleleri — platform linki',
    ],
  };
}

// ─── Tam SEO analiz raporu ────────────────────────────────────────────────────
async function generateFullSEOReport(credentials, jobStats, outputDir) {
  console.log('\n  🔍 Tam SEO analizi başlıyor...\n');
  await fs.ensureDir(outputDir);

  // 1. Keyword sıralamaları
  process.stdout.write('  📊 Keyword sıralamaları çekiliyor... ');
  const rankings = await getKeywordRankings(credentials);
  console.log(rankings.source === 'search_console' ? green('✅ Gerçek veri') : yellow('⚠️ Mock'));

  // 2. Rakip analizi (ilk 3 rakip — hızlı)
  console.log('  🏁 Rakip analizi...');
  const competitorResults = [];
  for (const comp of COMPETITORS.slice(0, 3)) {
    process.stdout.write(`     ${comp.name}... `);
    const result = await analyzeCompetitor(comp);
    competitorResults.push(result);
    console.log(result.accessible ? '✅' : '❌');
    await new Promise(r => setTimeout(r, 1000));
  }

  // 3. Backlink fırsatları
  const backlinks = await trackBacklinks();

  // 4. AI strateji
  process.stdout.write('  🤖 AI keyword stratejisi yazılıyor... ');
  const strategy = await generateKeywordStrategy(rankings, competitorResults, jobStats);
  console.log('✅');

  // Rapor
  const md = generateSEOReportMarkdown(rankings, competitorResults, backlinks, strategy);
  const filepath = path.join(outputDir, `seo_analiz_${new Date().toISOString().slice(0,10)}.md`);
  await fs.writeFile(filepath, md);

  console.log(green(`\n  ✅ SEO Raporu: ${filepath}`));
  return { rankings, competitorResults, backlinks, strategy, filepath };
}

function generateSEOReportMarkdown(rankings, competitors, backlinks, strategy) {
  // Sıralama tablosu
  const rankRows = rankings.rankings.slice(0, 20).map(r =>
    `| ${r.keyword} | ${r.position} | ${r.clicks} | ${r.impressions} | ${r.ctr} | ${r.status} |`
  ).join('\n');

  // Rakip tablosu
  const compRows = competitors.map(c =>
    c.accessible
      ? `| ${c.name} | ${c.url} | ${c.title?.slice(0,50)} | ${c.focus} |`
      : `| ${c.name} | ${c.url} | ❌ Erişilemiyor | ${c.focus} |`
  ).join('\n');

  return `# 🔍 SEO Analiz Raporu — crewinjob.com
> ${new Date().toLocaleString('tr-TR')}
> Veri kaynağı: ${rankings.source === 'search_console' ? '✅ Google Search Console' : '⚠️ Mock (GSC bağlantısı gerekli)'}

---

## 📊 Keyword Sıralamaları (Son 28 Gün)

| Keyword | Pozisyon | Tıklama | Görüntülenme | CTR | Durum |
|---------|----------|---------|--------------|-----|-------|
${rankRows}

**Özet:**
- 🟢 Top 3: ${rankings.rankings.filter(r => r.position <= 3).length} keyword
- 🟡 İlk sayfa: ${rankings.rankings.filter(r => r.position <= 10 && r.position > 3).length} keyword
- 🟠 2. Sayfa: ${rankings.rankings.filter(r => r.position > 10 && r.position <= 20).length} keyword (quick win fırsatları!)
- 🔴 3+ Sayfa: ${rankings.rankings.filter(r => r.position > 20).length} keyword

---

## 🏁 Rakip Analizi

| Rakip | URL | Title | Odak |
|-------|-----|-------|------|
${compRows}

---

## 🔗 Backlink Durumu

${backlinks.note}

**Ücretsiz Kontrol:**
${backlinks.manualCheck.map(u => `- ${u}`).join('\n')}

**Hızlı Backlink Kazanım Fırsatları:**
${backlinks.earningOpportunities.map(o => `- ${o}`).join('\n')}

---

## 🤖 AI Keyword Stratejisi

${strategy}

---

## ✅ Bu Hafta Yapılacaklar

1. 2. sayfadaki keyword'lerden en az birine odaklanacak içerik yaz
2. MarineLink ve Maritime Connector'a platform tanıtımı gönder (backlink)
3. /jobs sayfasına SSR ekle — bu tek başına en büyük SEO etkisi
4. Google Search Console bağlıysa → Sitemaps bölümünden sitemap.xml doğrula

---
*crewinjob Marketing Agent — SEO Modülü*
`;
}

const green  = t => `\x1b[32m${t}\x1b[0m`;
const yellow = t => `\x1b[33m${t}\x1b[0m`;

module.exports = {
  getKeywordRankings,
  analyzeCompetitor,
  generateFullSEOReport,
  generateKeywordStrategy,
  trackBacklinks,
  MARITIME_KEYWORDS,
  COMPETITORS,
};
