// ─── Seafarer Büyüme KPI Dashboard ───────────────────────────────────────────
const ExcelJS = require('exceljs');
const client  = require('../ai-client');
const fs      = require('fs-extra');
const path    = require('path');

// ─── Hedefler (ilk 6 ay) ─────────────────────────────────────────────────────
const GROWTH_TARGETS = {
  month1: { totalSeafarers: 16500,  newMonthly: 1500,  profileCompletion: 55, activeProfiles: 40 },
  month2: { totalSeafarers: 18500,  newMonthly: 2000,  profileCompletion: 60, activeProfiles: 45 },
  month3: { totalSeafarers: 22000,  newMonthly: 3500,  profileCompletion: 65, activeProfiles: 50 },
  month4: { totalSeafarers: 26000,  newMonthly: 4000,  profileCompletion: 68, activeProfiles: 55 },
  month5: { totalSeafarers: 31000,  newMonthly: 5000,  profileCompletion: 70, activeProfiles: 58 },
  month6: { totalSeafarers: 40000,  newMonthly: 9000,  profileCompletion: 75, activeProfiles: 62 },
};

// MB'ye geçiş için kriter
const MB_TRANSITION_CRITERIA = {
  totalSeafarers:    25000,
  monthlyGrowthRate: 1500,
  profileCompletion: 65,
  organicTraffic:    2000,
};

// ─── Seafarer büyüme verisi topla ─────────────────────────────────────────────
async function collectGrowthData(jobData) {
  // Gerçek API bağlandığında buradan gelecek
  // Şimdilik mevcut stats + simüle edilmiş büyüme verisi
  const currentMonth = new Date().getMonth() + 1;

  return {
    reportDate:    new Date().toLocaleString('tr-TR'),
    reportType:    'Seafarer Büyüme Dashboard',

    current: {
      totalSeafarers:    parseInt(jobData.stats.seafarers.replace(/\D/g,'')) || 15000,
      newThisWeek:       Math.floor(Math.random() * 150 + 50),  // API ile gelecek
      newThisMonth:      Math.floor(Math.random() * 500 + 200), // API ile gelecek
      profileCompletion: 42,   // API ile gelecek (%)
      activeProfiles:    35,   // Son 30 günde aktif (%)
      referralSignups:   0,    // Referral programı başlayınca
      mobileSignups:     45,   // Mobil cihazdan kayıt (%)
      topRanks:          ['Chief Officer', '2nd Engineer', 'Master', 'Bosun', 'AB Seaman'],
      topNationalities:  ['Turkish', 'Filipino', 'Indian', 'Russian', 'Ukrainian'],
    },

    channels: {
      // Nereden geliyorlar (UTM ile izlenecek)
      organic:    35,  // %
      facebook:   28,  // %
      linkedin:   15,  // %
      direct:     14,  // %
      referral:    8,  // %
    },

    weeklyTrend: [
      // Son 4 hafta (API ile gelecek)
      { week: 'Hafta -3', newSignups: 85,  active: 32 },
      { week: 'Hafta -2', newSignups: 102, active: 38 },
      { week: 'Hafta -1', newSignups: 118, active: 41 },
      { week: 'Bu Hafta', newSignups: Math.floor(Math.random() * 50 + 100), active: 44 },
    ],

    targets: GROWTH_TARGETS,
    mbCriteria: MB_TRANSITION_CRITERIA,
  };
}

// ─── Excel dashboard ──────────────────────────────────────────────────────────
async function generateGrowthDashboard(growthData, outputDir) {
  await fs.ensureDir(outputDir);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'crewinjob Marketing Agent';

  // ── Sayfa 1: Ana Dashboard ───────────────────────────────────────────────
  const dash = wb.addWorksheet('📊 Seafarer Dashboard');
  dash.properties.defaultRowHeight = 22;

  // Başlık
  dash.mergeCells('A1:H1');
  const title = dash.getCell('A1');
  title.value     = '⚓ crewinjob.com — Seafarer Büyüme Dashboard';
  title.font      = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  title.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5276' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  dash.getRow(1).height = 45;

  // Tarih
  dash.mergeCells('A2:H2');
  dash.getCell('A2').value     = `Rapor: ${growthData.reportDate}`;
  dash.getCell('A2').font      = { size: 11, color: { argb: 'FF888888' } };
  dash.getCell('A2').alignment = { horizontal: 'center' };

  dash.addRow([]);

  // ── KPI Kartları ─────────────────────────────────────────────────────────
  const addKPICard = (row, col, label, value, target, unit = '') => {
    const cell  = dash.getCell(row, col);
    const vCell = dash.getCell(row + 1, col);
    const tCell = dash.getCell(row + 2, col);

    cell.value  = label;
    cell.font   = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86C1' } };
    cell.alignment = { horizontal: 'center' };

    const numVal = typeof value === 'number' ? value : parseInt(value) || 0;
    const numTarget = typeof target === 'number' ? target : parseInt(target) || 0;
    const isOnTrack = numVal >= numTarget * 0.8;

    vCell.value     = `${value}${unit}`;
    vCell.font      = { bold: true, size: 20, color: { argb: isOnTrack ? 'FF1E8449' : 'FFC0392B' } };
    vCell.alignment = { horizontal: 'center', vertical: 'middle' };
    vCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: isOnTrack ? 'FFD5F5E3' : 'FFFADBD8' } };

    tCell.value     = `Hedef: ${target}${unit}`;
    tCell.font      = { size: 10, color: { argb: 'FF666666' } };
    tCell.alignment = { horizontal: 'center' };
  };

  const m1 = GROWTH_TARGETS.month1;
  addKPICard(4, 1, 'Toplam Seafarer',      growthData.current.totalSeafarers, m1.totalSeafarers);
  addKPICard(4, 2, 'Bu Ay Yeni Kayıt',     growthData.current.newThisMonth,   m1.newMonthly);
  addKPICard(4, 3, 'Profil Tamamlanma',    growthData.current.profileCompletion, m1.profileCompletion, '%');
  addKPICard(4, 4, 'Aktif Profil Oranı',   growthData.current.activeProfiles,  m1.activeProfiles, '%');

  // Satır yükseklikleri
  [4, 5, 6, 7].forEach(r => { dash.getRow(r).height = 30; });
  dash.addRow([]);

  // ── Kanal dağılımı ────────────────────────────────────────────────────────
  dash.addRow(['KAYIT KANALLARI', '', '', '', '', '', '', '']);
  dash.getRow(9).font = { bold: true, size: 12 };

  const channels = growthData.channels;
  const channelRows = [
    ['🔍 Organik SEO',    channels.organic + '%',    channels.organic],
    ['👥 Facebook',       channels.facebook + '%',   channels.facebook],
    ['💼 LinkedIn',       channels.linkedin + '%',   channels.linkedin],
    ['🔗 Direkt',         channels.direct + '%',     channels.direct],
    ['👫 Referral',       channels.referral + '%',   channels.referral],
  ];

  channelRows.forEach((row, i) => {
    const r = dash.addRow([row[0], row[1], '', '', '', '', '', '']);
    // Progress bar (metin tabanlı)
    const barLen = Math.round(row[2] / 5);
    const bar    = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
    dash.getCell(r.number, 3).value = bar + ` ${row[2]}%`;
    dash.getCell(r.number, 3).font  = { color: { argb: 'FF2E86C1' }, name: 'Courier New' };
    if (i % 2 === 0) {
      r.eachCell(c => { c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF0F4F8'} }; });
    }
  });

  // ── MB Geçiş Kriteri Takibi ───────────────────────────────────────────────
  dash.addRow([]);
  dash.addRow(['MB GEÇİŞ KRİTERLERİ', '', '', '', '', '', '', '']);
  const mbRow = dash.lastRow;
  mbRow.font  = { bold: true, size: 12 };
  mbRow.eachCell(c => { c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF154360'} }; c.font = { bold:true, color:{argb:'FFFFFFFF'} }; });

  const criteria = [
    ['Toplam Seafarer',    growthData.current.totalSeafarers, MB_TRANSITION_CRITERIA.totalSeafarers],
    ['Aylık Büyüme',       growthData.current.newThisMonth,   MB_TRANSITION_CRITERIA.monthlyGrowthRate],
    ['Profil Tamamlanma',  growthData.current.profileCompletion+'%', MB_TRANSITION_CRITERIA.profileCompletion+'%'],
    ['Organik Trafik/ay',  'API gerekli',                     MB_TRANSITION_CRITERIA.organicTraffic+' ziyaret'],
  ];

  criteria.forEach((c, i) => {
    const current = typeof c[1] === 'number' ? c[1] : parseInt(c[1]) || 0;
    const target  = typeof c[2] === 'number' ? c[2] : parseInt(c[2]) || 0;
    const ok      = current >= target;
    const r = dash.addRow([c[0], c[1], '→', c[2], ok ? '✅ TAMAM' : '⏳ Devam']);
    r.getCell(5).font = { bold: true, color: { argb: ok ? 'FF1E8449' : 'FFC0392B' } };
    if (i % 2 === 0) {
      r.eachCell(c => { c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF8F9FA'} }; });
    }
  });

  // Kolon genişlikleri
  dash.columns = [
    {width:28}, {width:16}, {width:30}, {width:20}, {width:16},
    {width:5},  {width:5},  {width:5},
  ];

  // ── Sayfa 2: Haftalık Trend ───────────────────────────────────────────────
  const trend = wb.addWorksheet('📈 Haftalık Trend');
  trend.addRow(['Hafta', 'Yeni Kayıt', 'Aktif Profil %', 'Kümülatif']).font = { bold: true };
  let cumulative = (growthData.current.totalSeafarers || 15000) - 350;
  growthData.weeklyTrend.forEach(w => {
    cumulative += w.newSignups;
    trend.addRow([w.week, w.newSignups, w.active + '%', cumulative]);
  });
  trend.columns = [{width:15},{width:15},{width:18},{width:15}];

  // ── Sayfa 3: 6 Aylık Hedef ───────────────────────────────────────────────
  const targets = wb.addWorksheet('🎯 6 Aylık Hedefler');
  targets.addRow(['Ay', 'Toplam Seafarer', 'Aylık Yeni', 'Profil Tamamlanma', 'Aktif Profil']).font = { bold: true };
  Object.entries(GROWTH_TARGETS).forEach(([month, t]) => {
    targets.addRow([month.replace('month', 'Ay '), t.totalSeafarers, t.newMonthly, t.profileCompletion+'%', t.activeProfiles+'%']);
  });
  // MB geçiş kriteri satırı
  targets.addRow([]);
  targets.addRow(['MB GEÇİŞ KRİTERİ →', MB_TRANSITION_CRITERIA.totalSeafarers, MB_TRANSITION_CRITERIA.monthlyGrowthRate, MB_TRANSITION_CRITERIA.profileCompletion+'%', '—']).font = { bold: true, color: { argb: 'FF1A5276' } };
  targets.columns = [{width:12},{width:18},{width:14},{width:20},{width:14}];

  // Kaydet
  const filename = `SeafarerGrowth_Dashboard_${new Date().toISOString().slice(0,10)}.xlsx`;
  const filepath  = path.join(outputDir, filename);
  await wb.xlsx.writeFile(filepath);

  return filepath;
}

// ─── AI büyüme analizi ────────────────────────────────────────────────────────
async function generateGrowthAnalysis(growthData) {
  const current = growthData.current;
  const target  = GROWTH_TARGETS.month1;

  const prompt = `
crewinjob.com seafarer büyüme verileri:

Mevcut Durum:
- Toplam: ${current.totalSeafarers} seafarer
- Bu ay yeni: ${current.newThisMonth}
- Profil tamamlanma: %${current.profileCompletion}
- Aktif profil: %${current.activeProfiles}

Ay 1 Hedefleri:
- Toplam: ${target.totalSeafarers}
- Yeni: ${target.newMonthly}/ay
- Profil: %${target.profileCompletion}

Kanal dağılımı: ${JSON.stringify(growthData.channels)}

MB'ye geçiş kriteri: ${growthData.current.totalSeafarers} / ${MB_TRANSITION_CRITERIA.totalSeafarers} seafarer

Şunları yaz:
1. **Durum Değerlendirmesi** (2-3 cümle) — Hedeflere göre neredeyiz?
2. **En Kritik 2 Aksiyon** — Bu hafta ne yapılmalı?
3. **MB'ye Ne Zaman Geçilir?** — Mevcut büyüme hızıyla kaç ayda ulaşılır?
4. **LinkedIn Paylaşım Metni** — Bu haftaki büyüme raporu için kısa özet (ekip içi)

Türkçe, net ve aksiyon odaklı yaz.
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Tam büyüme raporu ────────────────────────────────────────────────────────
async function generateSeafarerGrowthReport(jobData, outputDir) {
  console.log('\n  📊 Seafarer Büyüme Dashboard oluşturuluyor...');

  const growthData   = await collectGrowthData(jobData);

  console.log('  🤖 AI büyüme analizi yazılıyor...');
  const analysis     = await generateGrowthAnalysis(growthData);

  console.log('  📊 Excel dashboard oluşturuluyor...');
  const excelPath    = await generateGrowthDashboard(growthData, outputDir);

  // Markdown özet
  const mdPath = path.join(outputDir, `seafarer_growth_${new Date().toISOString().slice(0,10)}.md`);
  const md = `# ⚓ Seafarer Büyüme Raporu
> ${growthData.reportDate}

## AI Analizi

${analysis}

---

## Mevcut Durum

| Metrik | Değer | Ay 1 Hedef | Durum |
|--------|-------|------------|-------|
| Toplam Seafarer | ${growthData.current.totalSeafarers} | ${GROWTH_TARGETS.month1.totalSeafarers} | ${growthData.current.totalSeafarers >= GROWTH_TARGETS.month1.totalSeafarers * 0.8 ? '✅' : '⏳'} |
| Bu Ay Yeni | ${growthData.current.newThisMonth} | ${GROWTH_TARGETS.month1.newMonthly} | ${growthData.current.newThisMonth >= GROWTH_TARGETS.month1.newMonthly * 0.8 ? '✅' : '⏳'} |
| Profil Tamamlanma | %${growthData.current.profileCompletion} | %${GROWTH_TARGETS.month1.profileCompletion} | ${growthData.current.profileCompletion >= GROWTH_TARGETS.month1.profileCompletion * 0.8 ? '✅' : '⏳'} |

## MB Geçiş Kriteri Takibi

${growthData.current.totalSeafarers >= MB_TRANSITION_CRITERIA.totalSeafarers
  ? '🟢 **HAZIR** — Maritime Business stratejisine geçilebilir!'
  : `🟡 **${MB_TRANSITION_CRITERIA.totalSeafarers - growthData.current.totalSeafarers} seafarer daha gerekiyor**`}

## Excel Dashboard
📁 \`${path.basename(excelPath)}\`

---
*crewinjob Marketing Agent — Seafarer Büyüme Modülü*
`;

  await fs.writeFile(mdPath, md);
  return { excelPath, mdPath, growthData, analysis };
}

module.exports = { generateSeafarerGrowthReport, generateGrowthDashboard, collectGrowthData };
