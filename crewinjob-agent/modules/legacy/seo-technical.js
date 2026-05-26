// ─── Teknik SEO Modülü ────────────────────────────────────────────────────────
// Core Web Vitals, indexleme, crawl hataları, sayfa hızı
const { google } = require('googleapis');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));
const fs    = require('fs-extra');
const path  = require('path');

const SITE_URL     = process.env.GOOGLE_SITE_URL || 'https://crewinjob.com';
const PSI_API_KEY  = process.env.PAGESPEED_API_KEY || null; // Google Cloud Console'dan alınır

// ─── PageSpeed Insights — Core Web Vitals ─────────────────────────────────────
async function getCoreWebVitals(url = SITE_URL) {
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile${PSI_API_KEY ? '&key=' + PSI_API_KEY : ''}`;
    const res  = await fetch(apiUrl, { timeout: 20000 });
    const data = await res.json();

    const lcp = data.lighthouseResult?.audits?.['largest-contentful-paint'];
    const fid = data.lighthouseResult?.audits?.['total-blocking-time'];
    const cls = data.lighthouseResult?.audits?.['cumulative-layout-shift'];
    const fcp = data.lighthouseResult?.audits?.['first-contentful-paint'];
    const ttfb= data.lighthouseResult?.audits?.['server-response-time'];
    const score = data.lighthouseResult?.categories?.performance?.score;

    return {
      url,
      performanceScore:    score ? Math.round(score * 100) : null,
      lcp:  { value: lcp?.displayValue,  score: lcp?.score,  status: getStatus(lcp?.score) },
      tbt:  { value: fid?.displayValue,  score: fid?.score,  status: getStatus(fid?.score) },
      cls:  { value: cls?.displayValue,  score: cls?.score,  status: getStatus(cls?.score) },
      fcp:  { value: fcp?.displayValue,  score: fcp?.score,  status: getStatus(fcp?.score) },
      ttfb: { value: ttfb?.displayValue, score: ttfb?.score, status: getStatus(ttfb?.score) },
      opportunities: extractOpportunities(data.lighthouseResult?.audits),
      source: 'pagespeed_insights',
    };
  } catch (err) {
    return { url, error: err.message, source: 'error' };
  }
}

function getStatus(score) {
  if (score === null || score === undefined) return 'unknown';
  if (score >= 0.9) return '✅ İyi';
  if (score >= 0.5) return '⚠️ Geliştirilmeli';
  return '❌ Kötü';
}

function extractOpportunities(audits = {}) {
  const opportunities = [];
  const keys = [
    'render-blocking-resources', 'unused-javascript', 'unused-css-rules',
    'uses-optimized-images', 'uses-webp-images', 'efficient-animated-content',
    'uses-text-compression', 'uses-long-cache-ttl',
  ];
  for (const key of keys) {
    const audit = audits[key];
    if (audit && audit.score !== null && audit.score < 0.9) {
      opportunities.push({
        title:      audit.title,
        description: audit.description?.slice(0, 150),
        impact:     audit.details?.overallSavingsMs
          ? `${Math.round(audit.details.overallSavingsMs)}ms tasarruf`
          : audit.displayValue || '',
      });
    }
  }
  return opportunities.slice(0, 5);
}

// ─── Google Search Console — İndexleme ve crawl ────────────────────────────────
async function getIndexingStatus(credentials) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    const sc = google.searchconsole({ version: 'v1', auth });

    // Sitemaps
    const sitemaps = await sc.sitemaps.list({ siteUrl: SITE_URL }).catch(() => ({ data: {} }));

    // Son 7 günde indexlenen sayfalar
    const indexed = await sc.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
        endDate:   new Date().toISOString().slice(0, 10),
        dimensions: ['page'],
        rowLimit: 50,
      },
    }).catch(() => ({ data: { rows: [] } }));

    return {
      sitemaps:      sitemaps.data.sitemap || [],
      indexedPages:  indexed.data.rows?.length || 0,
      topIndexedPages: (indexed.data.rows || []).slice(0, 10).map(r => ({
        page:        r.keys?.[0],
        clicks:      r.clicks,
        impressions: r.impressions,
      })),
      source: 'search_console',
    };
  } catch (err) {
    return { error: err.message, source: 'error' };
  }
}

// ─── Çoklu sayfa analizi ──────────────────────────────────────────────────────
async function analyzeMultiplePages(pages = null) {
  const defaultPages = [
    SITE_URL,
    `${SITE_URL}/seafarer`,
    `${SITE_URL}/maritime-business`,
    `${SITE_URL}/jobs`,
  ];
  const targets = pages || defaultPages;

  console.log(`\n  ⚡ ${targets.length} sayfa Core Web Vitals analizi...`);
  const results = [];

  for (const url of targets) {
    process.stdout.write(`  ${url.replace(SITE_URL, '')||'/'} ... `);
    const vitals = await getCoreWebVitals(url);
    results.push(vitals);
    console.log(vitals.performanceScore ? `${vitals.performanceScore}/100` : vitals.error ? '❌' : '?');
    await new Promise(r => setTimeout(r, 2000)); // PSI rate limit
  }

  return results;
}

// ─── Teknik SEO raporu ────────────────────────────────────────────────────────
async function generateTechnicalSEOReport(credentials, outputDir) {
  console.log('\n  🔧 Teknik SEO raporu oluşturuluyor...');
  await fs.ensureDir(outputDir);

  const [vitalsResults, indexing] = await Promise.all([
    analyzeMultiplePages(),
    credentials ? getIndexingStatus(credentials) : Promise.resolve({ source: 'skipped' }),
  ]);

  const md = generateTechSEOMarkdown(vitalsResults, indexing);
  const filepath = path.join(outputDir, `teknik_seo_${new Date().toISOString().slice(0,10)}.md`);
  await fs.writeFile(filepath, md);

  console.log(green(`  ✅ Teknik SEO raporu: ${filepath}`));
  return { vitalsResults, indexing, filepath };
}

function generateTechSEOMarkdown(vitals, indexing) {
  const pagesSection = vitals.map(v => {
    if (v.error) return `\n### ❌ ${v.url}\nHata: ${v.error}\n`;
    return `
### ${v.url.replace(SITE_URL, '') || '/'}
**Performans Skoru: ${v.performanceScore || 'N/A'}/100**

| Metrik | Değer | Durum |
|--------|-------|-------|
| LCP (En büyük içerik) | ${v.lcp?.value || 'N/A'} | ${v.lcp?.status || '?'} |
| TBT (Bloklanma süresi) | ${v.tbt?.value || 'N/A'} | ${v.tbt?.status || '?'} |
| CLS (Layout kayması)  | ${v.cls?.value || 'N/A'} | ${v.cls?.status || '?'} |
| FCP (İlk içerik)      | ${v.fcp?.value || 'N/A'} | ${v.fcp?.status || '?'} |
| TTFB (Sunucu yanıtı)  | ${v.ttfb?.value || 'N/A'} | ${v.ttfb?.status || '?'} |

${v.opportunities?.length ? '**İyileştirme Fırsatları:**\n' + v.opportunities.map(o => `- ${o.title}: ${o.impact}`).join('\n') : ''}
`;
  }).join('\n---\n');

  const indexSection = indexing.source === 'search_console'
    ? `
## 📋 İndexleme Durumu (Google Search Console)

- İndexlenen sayfa (son 7 gün): **${indexing.indexedPages}**
- Sitemap sayısı: **${indexing.sitemaps?.length || 0}**

### En Çok Görüntülenen Sayfalar
${(indexing.topIndexedPages || []).map(p => `- ${p.page}: ${p.clicks} tıklama, ${p.impressions} görüntülenme`).join('\n')}
`
    : '\n## 📋 İndexleme\nGoogle Search Console credentials gerekli.\n';

  return `# 🔧 Teknik SEO Raporu — crewinjob.com
> ${new Date().toLocaleString('tr-TR')}

## Core Web Vitals

${pagesSection}

${indexSection}

## Öncelikli Aksiyonlar

1. **LCP < 2.5s** olmalı — hero görselleri WebP yapın, lazy load ekleyin
2. **/jobs sayfası SSR** — CSR-only sayfa Google'a boş görünüyor (daha önce tespit edildi)
3. **Sitemap.xml** — Tüm iş ilanı URL'leri sitemap'te olmalı
4. **robots.txt** — /account/ ve /api/ yolları Disallow olmalı

---
*crewinjob Marketing Agent — Teknik SEO Modülü*
`;
}

const green = t => `\x1b[32m${t}\x1b[0m`;

module.exports = {
  getCoreWebVitals,
  analyzeMultiplePages,
  getIndexingStatus,
  generateTechnicalSEOReport,
};
