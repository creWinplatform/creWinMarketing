// ─── Çıktı Formatı & Kayıt ───────────────────────────────────────────────────
const fs     = require('fs-extra');
const path   = require('path');
const config = require('./config');

const PLATFORM_EMOJIS = {
  instagram: '📸',
  facebook:  '👥',
  twitter:   '🐦',
  linkedin:  '💼',
  tiktok:    '🎵',
};

// ─── Haftalık takvimi markdown olarak kaydet ──────────────────────────────────
async function saveWeeklyCalendar(weeklyContent, outputDir) {
  await fs.ensureDir(outputDir);

  const week     = getWeekString();
  const weekDir  = path.join(outputDir, `hafta_${week}`);
  await fs.ensureDir(weekDir);

  // Her gün için ayrı dosya
  for (const [day, data] of Object.entries(weeklyContent)) {
    if (!data.content) continue;

    const emoji    = PLATFORM_EMOJIS[data.platform] || '📱';
    const filename = `${getDayNumber(day)}_${day}_${data.platform}.md`;
    const filepath = path.join(weekDir, filename);

    const markdown = `# ${emoji} ${day.toUpperCase()} — ${data.platform.toUpperCase()}
> **Tür:** ${data.note}  
> **Oluşturulma:** ${new Date(data.generatedAt).toLocaleString('tr-TR')}  
> **Durum:** ⏳ Onay Bekliyor

---

${data.content}

---

## ✅ Onay Notu
- [ ] İçerik onaylandı
- [ ] Görsel hazırlandı
- [ ] Yayınlandı — Tarih: _______________
- [ ] Notlar: _______________
`;

    await fs.writeFile(filepath, markdown, 'utf-8');
  }

  // Haftalık özet dosyası
  const summaryPath = path.join(weekDir, '00_HAFTALIK_OZET.md');
  const summary     = generateSummaryMarkdown(weeklyContent, week);
  await fs.writeFile(summaryPath, summary, 'utf-8');

  return weekDir;
}

// ─── Tek post kaydet ──────────────────────────────────────────────────────────
async function saveSinglePost(platform, type, content, outputDir) {
  await fs.ensureDir(outputDir);

  const emoji    = PLATFORM_EMOJIS[platform] || '📱';
  const ts       = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const filename = `${ts}_${platform}_${type}.md`;
  const filepath = path.join(outputDir, filename);

  const markdown = `# ${emoji} ${platform.toUpperCase()} — ${type}
> **Oluşturulma:** ${new Date().toLocaleString('tr-TR')}  
> **Durum:** ⏳ Onay Bekliyor

---

${content}

---

## ✅ Onay Notu
- [ ] Onaylandı
- [ ] Görsel hazır
- [ ] Yayınlandı: _______________
`;

  await fs.writeFile(filepath, markdown, 'utf-8');
  return filepath;
}

// ─── Haftalık özet markdown ───────────────────────────────────────────────────
function generateSummaryMarkdown(weeklyContent, week) {
  const days = Object.entries(weeklyContent);
  const ok   = days.filter(([, d]) => d.content).length;
  const fail = days.filter(([, d]) => !d.content).length;

  const rows = days.map(([day, data]) => {
    const emoji  = PLATFORM_EMOJIS[data.platform] || '📱';
    const status = data.content ? '⏳ Onay Bekliyor' : '❌ Hata';
    return `| ${day.toUpperCase()} | ${emoji} ${data.platform} | ${data.note} | ${status} |`;
  }).join('\n');

  return `# 📅 Haftalık İçerik Takvimi — Hafta ${week}
> Oluşturulma: ${new Date().toLocaleString('tr-TR')}

## Özet
- ✅ Üretilen içerik: **${ok}**
- ❌ Hata: **${fail}**
- 📊 Toplam: **${days.length}**

## Takvim

| Gün | Platform | İçerik Türü | Durum |
|-----|----------|-------------|-------|
${rows}

## Nasıl Kullanılır?

1. Her günün klasörünü aç (örn: \`2_tuesday_instagram.md\`)
2. Türkçe veya İngilizce versiyonu seç
3. Onay kutucuğunu işaretle
4. Görseli hazırla (brief'e göre)
5. İlgili platformda yayınla
6. Yayın tarihini dosyaya not et

---
*crewinjob Marketing Agent tarafından otomatik oluşturuldu*
`;
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────────
function getWeekString() {
  const now  = new Date();
  const year = now.getFullYear();
  const week = Math.ceil((now - new Date(year, 0, 1)) / (7 * 86400000));
  return `${year}_W${String(week).padStart(2, '0')}`;
}

function getDayNumber(day) {
  const order = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  return String(order.indexOf(day) + 1).padStart(2, '0');
}

module.exports = { saveWeeklyCalendar, saveSinglePost };
