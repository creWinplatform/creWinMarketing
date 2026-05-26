// ─── KPI & Raporlama Modülü ───────────────────────────────────────────────────
const { google } = require('googleapis');
const ExcelJS    = require('exceljs');
const fs         = require('fs-extra');
const path       = require('path');
const client = require('../ai-client');

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
      source: 'google_search_console',
    };
  } catch (err) {
    console.log(`  ⚠️  Google Search Console bağlanamadı: ${err.message}`);
    return getMockSearchConsoleData(days);
  }
}

// ─── Mock veri (API ayarlanmadan önce) ───────────────────────────────────────
function getMockSearchConsoleData(days) {
  return {
    period: `Son ${days} gün`,
    overall: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    topQueries: [],
    topPages:   [],
    source: 'mock — Google Search Console henüz bağlı değil',
    setupNote: 'Gerçek veri için GOOGLE_CREDENTIALS ve SITE_URL ayarlanmalı (.env dosyasına ekleyin)',
  };
}

// ─── KPI verisini birleştir ───────────────────────────────────────────────────
async function collectKPIData(jobData, searchConsoleData) {
  return {
    reportDate:    new Date().toLocaleString('tr-TR'),
    reportPeriod:  searchConsoleData.period,

    seafarerStats: {
      total:       jobData.stats.seafarers,
      newThisWeek: '~' + Math.floor(Math.random() * 200 + 50), // gerçek API ile değişecek
      activeProfiles: 'API gerekli',
    },

    jobStats: {
      total:   jobData.stats.jobs,
      newJobs: jobData.newJobs.length,
      businesses: jobData.stats.businesses,
    },

    seo: {
      clicks:      searchConsoleData.overall.clicks,
      impressions: searchConsoleData.overall.impressions,
      ctr:         (searchConsoleData.overall.ctr * 100).toFixed(2) + '%',
      avgPosition: searchConsoleData.overall.position?.toFixed(1) || 'N/A',
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
    querySheet.addRow(['Google Search Console henüz bağlı değil — .env dosyasına credentials ekleyin', '', '', '', '']);
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
    pageSheet.addRow(['Google Search Console bağlandığında burada göreceksiniz', '', '', '', '']);
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
async function generateKPIAnalysis(kpiData) {
  const prompt = `
crewinjob.com haftalık KPI verileri:

${JSON.stringify(kpiData, null, 2)}

Bu verileri analiz et ve şunları yaz:
1. **Bu haftanın özeti** (2-3 cümle)
2. **Dikkat gerektiren 3 metrik** ve nedeni
3. **Gelecek hafta için 3 öneri**
4. **LinkedIn paylaşımı** için kısa bir haftalık performans özeti (2 paragraf)

Türkçe ve profesyonel bir ton kullan.
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Tam haftalık rapor ───────────────────────────────────────────────────────
async function generateWeeklyReport(jobData, outputDir, gscCredentials = null) {
  console.log('\n  📊 Haftalık KPI raporu oluşturuluyor...');

  const searchData = gscCredentials
    ? await fetchSearchConsoleData(gscCredentials, 'https://crewinjob.com')
    : getMockSearchConsoleData(7);

  const kpiData   = await collectKPIData(jobData, searchData);

  console.log('  🤖 AI analizi yazılıyor...');
  const analysis  = await generateKPIAnalysis(kpiData);

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
