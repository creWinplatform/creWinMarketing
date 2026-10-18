// ─── KPI & Raporlama Modülü ───────────────────────────────────────────────────
const { google } = require('googleapis');
const ExcelJS    = require('exceljs');
const fs         = require('fs-extra');
const path       = require('path');
const client = require('../ai-client');

const ctx = require('../context');

// ─── Google Search Console verisi çek ────────────────────────────────────────
async function fetchSearchConsoleData(credentials, siteUrl, days = 7) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });

    const sc      = google.searchconsole({ version: 'v1', auth });
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    // Genel metrikler
    const [overallRes, queryRes, pageRes] = await Promise.all([
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate, endDate,
          dimensions: [],
          rowLimit: 1,
        },
      }),
      // En iyi sorgular
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate, endDate,
          dimensions: ['query'],
          rowLimit: 20,
        },
      }),
      // En iyi sayfalar
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate, endDate,
          dimensions: ['page'],
          rowLimit: 20,
        },
      }),
    ]);

    return {
      period: `${startDate} — ${endDate}`,
      overall: overallRes.data.rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      topQueries: queryRes.data.rows || [],
      topPages:   pageRes.data.rows  || [],
      available: true,
      source: 'google_search_console',
    };
  } catch (err) {
    console.log(`  ⚠️  Google Search Console bağlanamadı: ${err.message}`);
    return getUnavailableSearchConsoleData(days, err.message);
  }
}

// ─── Web istemcisiyle GSC verisi (crewinjob-web/lib/gsc.ts createGscClient) ──
// gscClient: { siteUrl, query(body) → { rows?, error? } }
async function fetchSearchConsoleDataWithClient(gscClient, days = 7) {
  try {
    const endDate   = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const [overall, queries, pages] = await Promise.all([
      gscClient.query({ startDate, endDate, dimensions: [], rowLimit: 1 }),
      gscClient.query({ startDate, endDate, dimensions: ['query'], rowLimit: 20 }),
      gscClient.query({ startDate, endDate, dimensions: ['page'], rowLimit: 20 }),
    ]);
    const failed = [overall, queries, pages].find(r => !r || r.error);
    if (failed) throw new Error(failed?.error?.message || 'GSC yanıtı geçersiz');
    return {
      period: `${startDate} — ${endDate}`,
      overall: overall.rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      topQueries: queries.rows || [],
      topPages:   pages.rows   || [],
      available: true,
      source: 'google_search_console',
    };
  } catch (err) {
    console.log(`  ⚠️  Google Search Console verisi alınamadı: ${err.message}`);
    return getUnavailableSearchConsoleData(days, err.message);
  }
}

// ─── GSC verisi YOK (bağlı değil / hata) — uydurma sayı üretilmez ────────────
function getUnavailableSearchConsoleData(days, reason) {
  return {
    period: `Son ${days} gün`,
    overall: { clicks: null, impressions: null, ctr: null, position: null },
    topQueries: [],
    topPages:   [],
    available: false,
    source: 'Google Search Console verisi yok' + (reason ? ` (hata: ${String(reason).slice(0, 120)})` : ' (bağlı değil)'),
    setupNote: 'Gerçek veri için web .env.local içinde GOOGLE_SERVICE_ACCOUNT_JSON ve GSC_SITE_URL tanımlanmalı',
  };
}

// ─── KPI verisini birleştir ───────────────────────────────────────────────────
// jobData: api.fetchAllData() çıktısı (AllData) — seafarers/jobs alanları gerçek veridir.
const NO_DATA = 'veri yok';

async function collectKPIData(jobData, searchConsoleData) {
  const stats     = jobData.stats || {};
  const seafarers = jobData.seafarers || {};
  const jobs      = jobData.jobs && !Array.isArray(jobData.jobs) ? jobData.jobs : {};
  const gscOk     = searchConsoleData.available !== false;
  const o         = searchConsoleData.overall || {};

  return {
    reportDate:    new Date().toLocaleString('tr-TR'),
    reportPeriod:  searchConsoleData.period,

    seafarerStats: {
      total:       stats.seafarers ?? NO_DATA,
      newThisWeek: typeof seafarers.newThisWeek === 'number' ? seafarers.newThisWeek : NO_DATA,
      activatedProfiles80: typeof seafarers.activatedSeafarers === 'number' ? seafarers.activatedSeafarers : NO_DATA,
    },

    jobStats: {
      total:   stats.jobs ?? NO_DATA,
      // Ilan/GetIlanWhoRegisteredInLastSevenDays yoksa null gelir → "veri yok"
      newJobs: typeof jobs.newThisWeek === 'number' ? jobs.newThisWeek : NO_DATA,
      businesses: stats.businesses ?? NO_DATA,
      newCompaniesThisWeek: typeof jobs.newCompaniesThisWeek === 'number' ? jobs.newCompaniesThisWeek : NO_DATA,
    },

    seo: {
      available:   gscOk,
      clicks:      gscOk ? o.clicks : NO_DATA,
      impressions: gscOk ? o.impressions : NO_DATA,
      ctr:         gscOk && typeof o.ctr === 'number' ? (o.ctr * 100).toFixed(2) + '%' : NO_DATA,
      avgPosition: gscOk && typeof o.position === 'number' ? o.position.toFixed(1) : NO_DATA,
      topQueries:  searchConsoleData.topQueries.slice(0, 10),
      topPages:    searchConsoleData.topPages.slice(0, 10),
    },

    source: searchConsoleData.source,
  };
}

// ─── Excel KPI raporu oluştur ─────────────────────────────────────────────────
async function generateExcelReport(kpiData, outputDir) {
  await fs.ensureDir(outputDir);

  const workbook  = new ExcelJS.Workbook();
  workbook.creator = 'crewinjob Marketing Agent';

  // ── Sayfa 1: Özet ──────────────────────────────────────────────────────────
  const summary = workbook.addWorksheet('Haftalık Özet');
  summary.properties.defaultRowHeight = 22;

  // Başlık
  summary.mergeCells('A1:F1');
  const titleCell = summary.getCell('A1');
  titleCell.value     = 'crewinjob.com — Haftalık KPI Raporu';
  titleCell.font      = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5276' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  summary.getRow(1).height = 40;

  // Tarih satırı
  summary.mergeCells('A2:F2');
  const dateCell = summary.getCell('A2');
  dateCell.value     = `Rapor Tarihi: ${kpiData.reportDate}  |  Dönem: ${kpiData.reportPeriod}`;
  dateCell.font      = { size: 11, color: { argb: 'FF666666' } };
  dateCell.alignment = { horizontal: 'center' };
  summary.getRow(2).height = 20;

  summary.addRow([]);

  // KPI kartları
  const kpiRows = [
    ['📊 PLATFORM METRİKLERİ', '', '', '🔍 SEO METRİKLERİ', '', ''],
    ['Toplam Seafarer',   kpiData.seafarerStats.total,       '', 'Organik Tıklama',    kpiData.seo.clicks,      ''],
    ['Bu Hafta Yeni',     kpiData.seafarerStats.newThisWeek, '', 'Görüntülenme',        kpiData.seo.impressions, ''],
    ['Toplam İlan',       kpiData.jobStats.total,            '', 'Tıklama Oranı (CTR)', kpiData.seo.ctr,         ''],
    ['Yeni İlan',         kpiData.jobStats.newJobs,          '', 'Ort. Pozisyon',       kpiData.seo.avgPosition, ''],
    ['İş Ortağı Sayısı', kpiData.jobStats.businesses,       '', 'Veri Kaynağı',        kpiData.source,          ''],
  ];

  kpiRows.forEach((row, i) => {
    const r = summary.addRow(row);
    if (i === 0) {
      // Bölüm başlıkları
      ['A','B','D','E'].forEach(col => {
        const cell = summary.getCell(`${col}${r.number}`);
        if (cell.value) {
          cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86C1' } };
        }
      });
      r.height = 28;
    } else {
      ['A','D'].forEach(col => {
        const cell = summary.getCell(`${col}${r.number}`);
        cell.font = { bold: true, color: { argb: 'FF2C3E50' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } };
      });
      ['B','E'].forEach(col => {
        const cell = summary.getCell(`${col}${r.number}`);
        cell.font      = { bold: true, size: 13, color: { argb: 'FF1A5276' } };
        cell.alignment = { horizontal: 'center' };
      });
    }
  });

  // Kolon genişlikleri
  [['A',30],['B',20],['C',5],['D',30],['E',20],['F',5]].forEach(([col, w]) => {
    summary.getColumn(col).width = w;
  });

  // ── Sayfa 2: En İyi Sorgular ───────────────────────────────────────────────
  const querySheet = workbook.addWorksheet('Top Sorgular (GSC)');
  querySheet.addRow(['Sorgu', 'Tıklama', 'Görüntülenme', 'CTR', 'Ort. Pozisyon']).font = { bold: true };

  if (kpiData.seo.topQueries.length > 0) {
    kpiData.seo.topQueries.forEach(q => {
      querySheet.addRow([
        q.keys?.[0] || '',
        q.clicks, q.impressions,
        (q.ctr * 100).toFixed(2) + '%',
        q.position?.toFixed(1),
      ]);
    });
  } else {
    querySheet.addRow([kpiData.seo.available === false
      ? 'Google Search Console verisi yok — ' + kpiData.source
      : 'Bu dönemde sorgu verisi yok', '', '', '', '']);
  }

  ['A','B','C','D','E'].forEach((col, i) => {
    querySheet.getColumn(col).width = [50, 12, 16, 10, 16][i];
  });

  // ── Sayfa 3: En İyi Sayfalar ───────────────────────────────────────────────
  const pageSheet = workbook.addWorksheet('Top Sayfalar (GSC)');
  pageSheet.addRow(['Sayfa URL', 'Tıklama', 'Görüntülenme', 'CTR', 'Ort. Pozisyon']).font = { bold: true };

  if (kpiData.seo.topPages.length > 0) {
    kpiData.seo.topPages.forEach(p => {
      pageSheet.addRow([
        p.keys?.[0] || '',
        p.clicks, p.impressions,
        (p.ctr * 100).toFixed(2) + '%',
        p.position?.toFixed(1),
      ]);
    });
  } else {
    pageSheet.addRow([kpiData.seo.available === false
      ? 'Google Search Console verisi yok — ' + kpiData.source
      : 'Bu dönemde sayfa verisi yok', '', '', '', '']);
  }

  ['A','B','C','D','E'].forEach((col, i) => {
    pageSheet.getColumn(col).width = [60, 12, 16, 10, 16][i];
  });

  // Kaydet
  const filename = `crewinjob_KPI_${new Date().toISOString().slice(0,10)}.xlsx`;
  const filepath = path.join(outputDir, filename);
  await workbook.xlsx.writeFile(filepath);

  return filepath;
}

// ─── AI Analizi ile KPI yorumu ────────────────────────────────────────────────
async function generateKPIAnalysis(kpiData, language = 'tr', model) {
  const langRule = language === 'en'
    ? `Write the ENTIRE response in English (translate the section headings above too). For uncertain or missing data ("veri yok" in the data) write "This data is not tracked yet" — do not guess.`
    : `Tüm yanıt Türkçe olsun. Belirsiz veya eksik veri ("veri yok") için "Bu veri henüz izlenmiyor" de, tahmin yürütme.`;
  const prompt = `Sen CrewinJob'un büyüme analistsin. CrewinJob, denizcilik sektörüne özel iki taraflı bir işgücü marketplace'idir: bir tarafta gemi insanları (seafarers), diğer tarafta gemi şirketleri (shipowners, ship managers, crewing agencies) bulunur.

${ctx.analysisBlock({ full: true, playbook: true })}

---

## Bu Dönemin KPI Verileri
\`\`\`json
${JSON.stringify(kpiData, null, 2)}
\`\`\`

---

## Analiz Görevi

Yukarıdaki metrics framework ve mevcut KPI verilerini birlikte değerlendirerek aşağıdaki analizi yaz:

### 1. North Star Durumu (2-3 cümle)
- Monthly Qualified Matches ve Ready-to-Hire / Active Company / Liquidity üçlüsü açısından bu dönemin genel tablosunu değerlendir.
- Veride bu üçlüye dair bilgi yoksa hangi verilerin henüz izlenmediğini belirt ve bunu bir öncelik olarak işaretle.

### 2. Metrik Sağlık Tablosu
Ölçülebilen her metrik için tablo yaz:

| Metrik | Mevcut | Hedef | Durum | Yorum |
|--------|--------|-------|-------|-------|

Durum: 🔴 (hedefin %80 altı) · 🟡 (%80–100) · 🟢 (%100 üstü) · ⚪ (veri yok)

### 3. Darboğaz Teşhisi (2-3 cümle)
- Bu dönem darboğaz **aday tarafında mı, şirket tarafında mı, eşleşme kalitesinde mi?**
- Hangi veriye dayanarak bu sonuca vardığını belirt. Marketplace'te aynı anda iki tarafa yüklenilmez — tek bir darboğaz seç.

### 4. Yükseltme Planı — 🔴 ve 🟡 metrikler için
Her sorunlu metrik için playbook'tan uygun kaldıracı seçerek yaz:

**[Metrik adı] — mevcut X, hedef Y**
- **Neden düşük:** [teşhis, veriye dayalı]
- **Seçilen kaldıraç:** [playbook'tan 1-2 tanesi, neden bu seçildi]
- **İlk 7 gün:** [somut ilk adım]
- **4 haftalık hedef:** [X'ten Y'ye — ölçülebilir]
- **Doğrulama metriği:** [hangi sayıya bakılacak]

En fazla 3 metriği ele al. Hepsini birden düzeltmeye çalışma.

### 5. Kör Noktalar (2-3 madde)
- Framework'te tanımlı olup henüz ölçülemeyen kritik metrikler. Her biri için somut öneri: hangi event eklenmeli (\`job_applied\`, \`candidate_shortlisted\` gibi), hangi API bağlanmalı.
- Bu boşluklardan hangisi en çok karar körlüğü yaratıyor?

### 6. Yatırımcı/Ortak Özeti (1 paragraf)
- "15.000 kayıtlı gemi insanı var" değil, "Ready-to-Hire seafarers + Active hiring companies + Monthly Qualified Matches" perspektifinden bu dönemin hikayesini anlat. Rakam varsa kullan, yoksa hangi soruların hâlâ cevaplanamadığını belirt.

### 7. LinkedIn Paylaşımı
- Platform büyümesini veya önemli bir gelişmeyi öne çıkaran, profesyonel ve özgün 2 paragraflık LinkedIn gönderisi. Rakam kullan. Hashtag ekleme.

${langRule}
`;

  const response = await client.messages.create({
    model: model || 'gemini-2.5-flash',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Tam haftalık rapor ───────────────────────────────────────────────────────
// jobData:        api.fetchAllData() çıktısı (AllData)
// gscCredentials: (CLI) google-credentials.json içeriği — googleapis ile çekilir
// options:        { gscClient, siteUrl, language: 'tr'|'en', model }
//                 gscClient → web'in lib/gsc.ts createGscClient() istemcisi
async function generateWeeklyReport(jobData, outputDir, gscCredentials = null, options = {}) {
  console.log('\n  📊 Haftalık KPI raporu oluşturuluyor...');

  const searchData = options.gscClient
    ? await fetchSearchConsoleDataWithClient(options.gscClient, 7)
    : gscCredentials
      ? await fetchSearchConsoleData(gscCredentials, options.siteUrl || process.env.GSC_SITE_URL || 'https://crewinjob.com')
      : getUnavailableSearchConsoleData(7);

  const kpiData   = await collectKPIData(jobData || {}, searchData);

  console.log('  🤖 AI analizi yazılıyor...');
  const analysis  = await generateKPIAnalysis(kpiData, options.language === 'en' ? 'en' : 'tr', options.model);

  console.log('  📊 Excel raporu oluşturuluyor...');
  const excelPath = await generateExcelReport(kpiData, outputDir);

  // Markdown rapor
  const mdPath = path.join(outputDir, `KPI_raporu_${new Date().toISOString().slice(0,10)}.md`);
  const md = `# 📊 Haftalık KPI Raporu — crewinjob.com
> ${kpiData.reportDate}  |  Dönem: ${kpiData.reportPeriod}

## AI Analizi

${analysis}

---

## Ham Veriler

### Platform
- Toplam Seafarer: **${kpiData.seafarerStats.total}**
- Bu Hafta Yeni: **${kpiData.seafarerStats.newThisWeek}**
- Toplam İlan: **${kpiData.jobStats.total}**
- Yeni İlan: **${kpiData.jobStats.newJobs}**
- İş Ortakları: **${kpiData.jobStats.businesses}**

### SEO (Google Search Console)
- Tıklama: **${kpiData.seo.clicks}**
- Görüntülenme: **${kpiData.seo.impressions}**
- CTR: **${kpiData.seo.ctr}**
- Ort. Pozisyon: **${kpiData.seo.avgPosition}**

> Veri: ${kpiData.source}

---

## Excel Dosyası
📁 \`${path.basename(excelPath)}\`

---
*crewinjob Marketing Agent — Otomatik Rapor*
`;

  await fs.writeFile(mdPath, md);

  console.log(`  ✅ Excel: ${excelPath}`);
  console.log(`  ✅ Markdown: ${mdPath}`);

  return { excelPath, mdPath, kpiData, analysis };
}

module.exports = { generateWeeklyReport, fetchSearchConsoleData, generateExcelReport };
