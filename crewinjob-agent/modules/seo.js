// ─── SEO Meta Üretici ────────────────────────────────────────────────────────
const client = require('../ai-client');
const fs     = require('fs-extra');
const path   = require('path');

// ─── Tek ilan için SEO meta üret ─────────────────────────────────────────────
async function generateJobSEO(job, language) {
  const lang = language === 'en' ? 'en' : 'tr';
  const langLine = lang === 'tr'
    ? 'DİL: Tüm metin alanlarını Türkçe yaz (slug hariç).'
    : 'LANGUAGE: Write all text fields in English (except slug).';

  const prompt = `
Denizcilik iş ilanı için SEO meta verileri üret.
${langLine}

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

module.exports = { generateJobSEO, generateBulkJobSEO };
