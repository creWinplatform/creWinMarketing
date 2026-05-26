// ─── Blog Makale Üretici ─────────────────────────────────────────────────────
const client = require('../ai-client');
const fs     = require('fs-extra');
const path   = require('path');

// ─── Blog konusu önerileri ────────────────────────────────────────────────────
const MONTHLY_BLOG_TOPICS = [
  { topic: 'How to Write a Seafarer CV in 2026', keyword: 'seafarer cv template', priority: 'high' },
  { topic: 'STCW Certificates: Complete Guide', keyword: 'stcw certificates explained', priority: 'high' },
  { topic: 'Highest Paying Ranks in Merchant Navy', keyword: 'merchant navy salary', priority: 'high' },
  { topic: 'Chief Officer to Captain: Career Path', keyword: 'chief officer career progression', priority: 'medium' },
  { topic: 'Bulk Carrier vs Tanker: Which to Choose', keyword: 'bulk carrier vs tanker seafarer', priority: 'medium' },
  { topic: 'Online Interview Tips for Seafarers', keyword: 'seafarer online interview', priority: 'medium' },
  { topic: 'Flag State Certificates Comparison 2026', keyword: 'flag state certificate seafarer', priority: 'medium' },
  { topic: 'Seafarer Rights Under MLC 2006', keyword: 'seafarer rights mlc 2006', priority: 'low' },
  { topic: 'Offshore vs Merchant Navy: Pros & Cons', keyword: 'offshore vs merchant navy', priority: 'low' },
];

// ─── Tam blog makalesi üret ───────────────────────────────────────────────────
async function generateBlogArticle(topicData, jobStats, language) {
  console.log(`\n  ✍️  "${topicData.topic}" makalesi üretiliyor...`);

  const lang = language === 'en' ? 'en' : 'tr';
  const articleLang = lang === 'en' ? 'English' : 'Turkish';
  const langLine = lang === 'tr'
    ? 'LANGUAGE: Write the ENTIRE article in Turkish. All sections, headings, meta, social summaries — Turkish only.'
    : 'LANGUAGE: Write the ENTIRE article in English. All sections, headings, meta, social summaries — English only.';

  const prompt = `
Sen crewinjob.com için denizcilik uzmanı bir içerik yazarısın.
Aşağıdaki konuda SEO-optimized, kapsamlı bir blog makalesi yaz.
${langLine}

KONU: ${topicData.topic}
FOCUS KEYWORD: ${topicData.keyword}
HEDEF KİTLE: Denizci, gemiadamı, maritime profesyoneller
PLATFORM: crewinjob.com — AI-powered maritime recruitment platform
STATS: ${jobStats.seafarers} seafarer kayıtlı, ${jobStats.jobs} aktif ilan

MAKALE YAPISI (her bölümü yaz):

## SEO METADATA
- Meta Title (max 60 kar):
- Meta Description (max 155 kar):
- Secondary Keywords (5 adet):

## MAKALE (min 1200 kelime, ${articleLang})

H1: [Başlık]

**Introduction (150-200 kelime)**
[İlgi çekici giriş, focus keyword ilk 100 kelimede geçmeli]

**H2: [Alt başlık 1]**
[300+ kelime]

**H2: [Alt başlık 2]**
[300+ kelime]

**H2: [Alt başlık 3]**
[200+ kelime]

**H2: ${lang === 'en' ? 'How crewinjob.com Helps' : 'crewinjob.com Nasıl Yardımcı Olur'}**
[Platform özelliklerini doğal şekilde entegre et — BullsEye, AI matching, 15,000+ seafarers]

**${lang === 'en' ? 'Conclusion' : 'Sonuç'}**
[Güçlü CTA]

## SOSYAL MEDYA ÖZETİ
- LinkedIn post (3-4 cümle):
- Twitter thread (3 tweet):
- Instagram caption:
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Aylık blog paketi üret ───────────────────────────────────────────────────
async function generateMonthlyBlogPack(jobStats, outputDir, count = 3) {
  const topics  = MONTHLY_BLOG_TOPICS.slice(0, count);
  const results = [];

  console.log(`\n  📚 ${topics.length} blog makalesi üretiliyor (bu yaklaşık 5-8 dakika sürer)...`);

  await fs.ensureDir(outputDir);
  const blogDir = path.join(outputDir, `blog_${getMonthStr()}`);
  await fs.ensureDir(blogDir);

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    console.log(`\n  [${i+1}/${topics.length}] ${topic.topic}`);

    try {
      const content  = await generateBlogArticle(topic, jobStats);
      const filename = `${String(i+1).padStart(2,'0')}_${topic.keyword.replace(/\s+/g,'-')}.md`;
      const filepath = path.join(blogDir, filename);

      const fullContent = `# Blog Makalesi ${i+1}/${topics.length}
> **Konu:** ${topic.topic}  
> **Focus Keyword:** ${topic.keyword}  
> **Öncelik:** ${topic.priority}  
> **Durum:** ⏳ Onay Bekliyor  
> **Oluşturulma:** ${new Date().toLocaleString('tr-TR')}

---

${content}

---

## ✅ Onay & Yayın Notu
- [ ] İçerik onaylandı
- [ ] Görseller hazırlandı (Featured image + infografik)
- [ ] WordPress/CMS'e yüklendi
- [ ] Sosyal medyada paylaşıldı
- [ ] Yayın tarihi: _______________
`;

      await fs.writeFile(filepath, fullContent);
      results.push({ topic: topic.topic, keyword: topic.keyword, filepath });
      console.log(`  ✅ Kaydedildi: ${filename}`);
    } catch (err) {
      console.log(`  ❌ Hata: ${err.message}`);
    }

    // Rate limit
    if (i < topics.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // İndex dosyası
  const indexPath = path.join(blogDir, '00_BLOG_INDEX.md');
  await fs.writeFile(indexPath, generateBlogIndex(results));

  console.log(`\n  ✅ Blog paketi hazır: ${blogDir}`);
  return results;
}

function generateBlogIndex(results) {
  const rows = results.map((r, i) =>
    `| ${i+1} | ${r.topic} | ${r.keyword} | ⏳ Bekliyor |`
  ).join('\n');

  return `# 📚 Aylık Blog Paketi — ${getMonthStr()}
> Oluşturulma: ${new Date().toLocaleString('tr-TR')}

## İçerik Listesi

| # | Konu | Focus Keyword | Durum |
|---|------|---------------|-------|
${rows}

## Yayın Takvimi Önerisi

| Hafta | Makale | Platform Paylaşımı |
|-------|--------|--------------------|
| Hafta 1 | 1. makale | LinkedIn + Facebook + Twitter |
| Hafta 2 | 2. makale | LinkedIn + Instagram |
| Hafta 3 | 3. makale | LinkedIn + Twitter |

---
*crewinjob Marketing Agent*
`;
}

function getMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`;
}

module.exports = { generateBlogArticle, generateMonthlyBlogPack, MONTHLY_BLOG_TOPICS };
