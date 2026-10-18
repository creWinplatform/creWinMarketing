// ─── SEO Meta Üretici ────────────────────────────────────────────────────────
const client = require('../ai-client');
const fs     = require('fs-extra');
const path   = require('path');

// ─── Tek ilan için SEO meta üret ─────────────────────────────────────────────
// @param targetKeyword — Keyword Araştırma sekmesinden seçilmiş, bu ilan için
// hedeflenmek istenen spesifik arama sorgusu (opsiyonel). Verilirse focusKeyword
// bu terime kilitlenir, metaTitle/metaDescription bunu doğal şekilde içerecek
// şekilde üretilir — araştırma ile üretim arasındaki döngüyü kapatır.
async function generateJobSEO(job, language, targetKeyword) {
  const lang = language === 'en' ? 'en' : 'tr';
  const langLine = lang === 'tr'
    ? 'DİL: Tüm metin alanlarını Türkçe yaz (slug hariç).'
    : 'LANGUAGE: Write all text fields in English (except slug).';
  const keywordLine = targetKeyword
    ? `\nHEDEF KEYWORD (ZORUNLU): "${targetKeyword}" — Keyword araştırmasından seçildi. focusKeyword alanı BİREBİR bu terim olmalı; metaTitle ve metaDescription bu terimi doğal bir cümle içinde geçirmeli (terim yığını gibi durmamalı).`
    : '';

  const prompt = `
Denizcilik iş ilanı için SEO meta verileri üret.
${langLine}${keywordLine}

İlan:
- Pozisyon: ${job.title}
- Gemi Tipi: ${job.vesselType}
- Şirket: ${job.company || 'Gizli Şirket'}
- Lokasyon: ${job.location}
- Maaş: ${job.salary || 'Görüşülür'}
- Sözleşme: ${job.contractDuration || 'Belirtilmemiş'}
- Gereksinimler: ${(job.requirements || []).join(', ')}

Şunları üret (JSON formatında):
{
  "metaTitle": "Max 60 karakter, keyword-rich başlık",
  "metaDescription": "Max 155 karakter, CTA içeren açıklama",
  "slug": "url-friendly-slug",
  "focusKeyword": "Ana hedef keyword",
  "secondaryKeywords": ["keyword2", "keyword3"],
  "schemaJobTitle": "Google Jobs için tam pozisyon adı",
  "openGraphTitle": "Sosyal medya paylaşım başlığı (70 karakter max)",
  "openGraphDescription": "Sosyal medya açıklaması (200 karakter max)"
}

Sadece JSON döndür, başka açıklama ekleme.
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const text = response.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    return { jobId: job.id, jobTitle: job.title, ...JSON.parse(clean) };
  } catch {
    return {
      jobId:              job.id,
      jobTitle:           job.title,
      metaTitle:          `${job.title} Jobs — ${job.vesselType} | crewinjob`,
      metaDescription:    `${job.title} vacancy on ${job.vesselType}. ${job.salary}. Apply now on crewinjob.com — The Right Job, The Right Talent.`,
      slug:               `${job.title}-${job.vesselType}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      focusKeyword:       `${job.title} ${job.vesselType} jobs`,
      secondaryKeywords:  ['maritime jobs', 'seafarer vacancy', 'crewinjob'],
      schemaJobTitle:     job.title,
      openGraphTitle:     `${job.title} — ${job.vesselType} Vacancy`,
      openGraphDescription: `${job.salary} | ${job.contractDuration} | Apply on crewinjob.com`,
    };
  }
}

// ─── Toplu ilan SEO üretimi ───────────────────────────────────────────────────
async function generateBulkJobSEO(jobs, outputDir) {
  console.log(`\n  🔍 ${jobs.length} ilan için SEO meta üretiliyor...`);

  const results = [];
  for (const job of jobs) {
    process.stdout.write(`  📄 ${job.title} (${job.vesselType})... `);
    try {
      const seo = await generateJobSEO(job);
      results.push(seo);
      console.log('✅');
    } catch (err) {
      console.log('❌ ' + err.message);
    }
    await new Promise(r => setTimeout(r, 600));
  }

  // Kaydet
  await fs.ensureDir(outputDir);
  const outPath = path.join(outputDir, `seo_meta_${Date.now()}.json`);
  await fs.writeJSON(outPath, results, { spaces: 2 });

  // Markdown raporu
  const mdPath = path.join(outputDir, `seo_meta_${Date.now()}.md`);
  const md = generateSEOMarkdown(results);
  await fs.writeFile(mdPath, md);

  console.log(`\n  ✅ ${results.length} ilan SEO meta'sı hazır`);
  console.log(`  📁 JSON: ${outPath}`);
  console.log(`  📁 MD:   ${mdPath}`);

  return results;
}

function generateSEOMarkdown(results) {
  const rows = results.map(r => `
### ${r.jobTitle}

| Alan | Değer |
|------|-------|
| **Meta Title** | ${r.metaTitle} |
| **Meta Description** | ${r.metaDescription} |
| **URL Slug** | \`/jobs/${r.slug}\` |
| **Focus Keyword** | ${r.focusKeyword} |
| **OG Title** | ${r.openGraphTitle} |
| **OG Description** | ${r.openGraphDescription} |
| **Secondary Keywords** | ${(r.secondaryKeywords || []).join(', ')} |

`).join('\n---\n');

  return `# SEO Meta Raporu — crewinjob.com
> Oluşturulma: ${new Date().toLocaleString('tr-TR')}

${rows}

---
*crewinjob Marketing Agent tarafından otomatik üretildi*
`;
}

// ─── Düşük CTR Sorguları için Meta Düzeltme Önerisi ──────────────────────────
// GSC'de gösterim (impression) alıp tıklanmayan sorgu/sayfa çiftleri için
// AI'dan alternatif title/description üretir. Tek AI çağrısında toplu işlenir
// (N sorgu için N çağrı yerine 1 çağrı — hem hızlı hem ucuz).
//
// @param rows [{ query, page, clicks, impressions, ctr, position, expectedCtr, lostClicks }]
// @param language 'tr' | 'en'
// @returns [{ page, suggestedTitle, suggestedDescription, reasoning }]
async function generateCtrFixSuggestions(rows, language) {
  if (!rows || rows.length === 0) return [];
  const lang = language === 'en' ? 'en' : 'tr';
  const langLine = lang === 'tr'
    ? 'DİL: suggestedTitle, suggestedDescription ve reasoning alanlarını Türkçe yaz.'
    : 'LANGUAGE: Write suggestedTitle, suggestedDescription and reasoning in English.';

  const rowsList = rows.map((r, i) => `
${i + 1}. Sayfa: ${r.page}
   Sorgu: "${r.query}"
   Pozisyon: ${r.position.toFixed(1)} — Gösterim: ${r.impressions} — Tıklama: ${r.clicks} — CTR: %${(r.ctr * 100).toFixed(1)} (beklenen: %${(r.expectedCtr * 100).toFixed(1)})`).join('\n');

  const prompt = `
Sen crewinjob.com'un teknik SEO uzmanısın. Aşağıdaki sayfalar Google'da gösteriliyor
(iyi pozisyonda) ama tıklanma oranı (CTR) o pozisyon için beklenenin çok altında.
Bu, meta title/description'ın arama niyetini karşılamadığı veya ilgi çekici olmadığı anlamına gelir.
${langLine}

DENİZCİLİK İŞ İLANI PLATFORMU BAĞLAMI: crewinjob.com bir denizci (seafarer) iş arama platformu.
Kullanıcılar rütbe (rank), gemi tipi (vessel type), maaş, lokasyon gibi somut bilgi arar.

SORUNLU SAYFALAR:
${rowsList}

Her sayfa için düzeltme öner:
- suggestedTitle: Max 60 karakter. Aranan sorguyu doğal şekilde içersin, somut bir fayda/sayı vurgusu olsun
  (maaş aralığı, "Hemen Başvur", güncel yıl gibi). Tıklama isteği uyandırmalı.
- suggestedDescription: Max 155 karakter. Net bir CTA içersin, sorgudaki niyeti karşıladığını göstersin.
- reasoning: Mevcut CTR'ın neden düşük olabileceğine dair 1 cümlelik somut teşhis (max 20 kelime).

SADECE şu JSON formatında bir array döndür, başka açıklama ekleme:
[
  { "page": "...", "suggestedTitle": "...", "suggestedDescription": "...", "reasoning": "..." }
]
`;

  const client   = require('../ai-client');
  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 2200,
    messages: [{ role: 'user', content: prompt }],
  });

  const text  = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed)) throw new Error('AI beklenmeyen format döndürdü');
  return parsed;
}

module.exports = { generateJobSEO, generateBulkJobSEO, generateCtrFixSuggestions };
