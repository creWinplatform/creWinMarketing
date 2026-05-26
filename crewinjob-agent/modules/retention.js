// ─── Seafarer Retention Modülü ────────────────────────────────────────────────
// Profili yarım kalanları tespit eder, geri kazanma içerikleri üretir
const client = require('../ai-client');
const fs     = require('fs-extra');
const path   = require('path');

// ─── Eksik profil segmentleri için içerik ────────────────────────────────────
const RETENTION_MESSAGES = {
  seaService: {
    label:   'Deniz hizmetleri eksik',
    urgency: 'YÜKSEK',
    why:     'Şirketler en çok buna bakıyor. Bu olmadan BullsEye\'da görünmüyorsun.',
    cta:     'Sea service ekle →',
  },
  certificates: {
    label:   'Sertifikalar eklenmemiş',
    urgency: 'YÜKSEK',
    why:     'STCW, COC olmadan başvuru kabul edilmiyor. Şirketler seni atlıyor.',
    cta:     'Sertifikalarını yükle →',
  },
  photo: {
    label:   'Profil fotoğrafı yok',
    urgency: 'ORTA',
    why:     'Fotoğrafsız profiller %60 daha az inceleniyor.',
    cta:     'Fotoğraf ekle →',
  },
  documents: {
    label:   'Belgeler yüklenmemiş',
    urgency: 'ORTA',
    why:     'Belgeleri olan seafarerlar 3x daha fazla görüşmeye davet ediliyor.',
    cta:     'Belgelerini yükle →',
  },
  references: {
    label:   'Referans eklenmemiş',
    urgency: 'DÜŞÜK',
    why:     'Referanslar güven oluşturur. Şirketler önce referanslı seafarerlara yazıyor.',
    cta:     'Referans ekle →',
  },
};

// ─── Segment bazlı retention içeriği ─────────────────────────────────────────
async function generateRetentionContent(segment, stats, language) {
  const msg  = RETENTION_MESSAGES[segment.missingField] || RETENTION_MESSAGES.seaService;
  const lang = language === 'en' ? 'en' : 'tr';
  const langLine = lang === 'tr'
    ? 'LANGUAGE: Write ONLY in Turkish. Do NOT include English versions.'
    : 'LANGUAGE: Write ONLY in English. Do NOT include Turkish versions.';

  const prompt = `
Sen crewinjob.com'un seafarer başarı uzmanısın. Samimi, yardımsever ve motive edici bir tonsun.
${langLine}

DURUM: ${segment.count} seafarer "${msg.label}" eksikliği nedeniyle şirketlere görünmüyor.
Bu kullanıcılar platforma kayıt olmuş ama profillerini tamamlamamış.
Son aktif: ortalama ${segment.lastActiveDays} gün önce.
NEDEN ÖNEMLİ: ${msg.why}
PLATFORM STATS: ${stats.seafarers} toplam seafarer, ${stats.jobs} aktif ilan

GÖREV: Bu segment için re-engagement içerikleri yaz:

## 📱 SOSYAL MEDYA İÇERİKLERİ (herkese açık — utanç değil, motivasyon)

### Instagram (görsel + caption)
**GÖRSEL BRIEF:** [Tasarımcıya yönelik açıklama]
**CAPTION (TR):** [Acı noktasını göster → çözüm → CTA]
**CAPTION (EN):** [Aynısı İngilizce]

### TikTok Script (30 saniye)
**HOOK:** [0-3 sn]
**BODY:** [3-25 sn — neden önemli, nasıl yapılır]  
**CTA:** [25-30 sn — "Profilini tamamla, link bio'da"]

### LinkedIn Post
[Profesyonel ton, sektör perspektifi]

## 💬 DİREKT MESAJ ŞABLONLARl (platforma entegre edilecek — kullanıcıya gönderilecek)

### Sıcak Hatırlatma (kayıt sonrası 3. gün)
Kısa, samimi, baskı yapmayan. Max 3 cümle.

### Acil Hatırlatma (kayıt sonrası 7. gün)  
Daha güçlü, fırsat odaklı. "X ilan senin profiline uygun ama göremiyoruz."

### Son Şans (kayıt sonrası 14. gün)
"Profilini tamamlamazsan seni eşleşmelerden çıkarmak zorundayız" — nazik ama net.

Tüm mesajlar samimi olsun. Kullanıcıyı suçlama, motive et.
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Tüm segmentler için retention paketi ─────────────────────────────────────
async function generateRetentionPack(incompleteData, stats, outputDir) {
  console.log(`\n  🔄 ${incompleteData.total.toLocaleString()} eksik profil için retention içerikleri...`);

  await fs.ensureDir(outputDir);
  const results = [];

  // Önce yüksek urgency segmentlerini işle
  const sorted = [...incompleteData.segments].sort((a,b) => {
    const urgencyScore = { YÜKSEK: 3, ORTA: 2, DÜŞÜK: 1 };
    const aScore = urgencyScore[RETENTION_MESSAGES[a.missingField]?.urgency] || 0;
    const bScore = urgencyScore[RETENTION_MESSAGES[b.missingField]?.urgency] || 0;
    return bScore - aScore;
  });

  for (const segment of sorted.slice(0, 4)) { // İlk 4 segment
    const msg = RETENTION_MESSAGES[segment.missingField];
    if (!msg) continue;

    process.stdout.write(`  🎯 ${msg.label} (${segment.count.toLocaleString()} kişi)... `);

    try {
      const content  = await generateRetentionContent(segment, stats);
      const filename = `retention_${segment.missingField}.md`;
      const filepath = path.join(outputDir, filename);

      const full = `# 🔄 Retention — ${msg.label}
> Etkilenen kullanıcı: **${segment.count.toLocaleString()}**  
> Aciliyet: **${msg.urgency}**  
> Son aktivite: **${segment.lastActiveDays} gün önce**  
> Oluşturulma: ${new Date().toLocaleString('tr-TR')}

## Neden Önemli?
${msg.why}

---

${content}

---

## Aksiyon Adımları

1. **Sosyal medya** — Instagram ve TikTok içeriklerini bu hafta paylaş (genel kitle)
2. **Platform içi** — Direkt mesaj şablonlarını geliştirici ekibine ver (otomatik gönderim için)
3. **A/B test** — 3. gün vs 7. gün mesajlarından hangisi daha iyi çalışıyor?
4. **Ölç** — Kaç kullanıcı mesaj sonrası profili tamamladı?

---
*crewinjob Marketing Agent — Retention Modülü*
`;

      await fs.writeFile(filepath, full);
      results.push({ segment: segment.missingField, count: segment.count, filepath });
      console.log('✅');
    } catch (err) {
      console.log('❌ ' + err.message);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // Özet dashboard
  const summaryPath = path.join(outputDir, '00_RETENTION_OZET.md');
  await fs.writeFile(summaryPath, generateRetentionSummary(incompleteData, results));

  console.log(`\n  ✅ Retention paketi: ${outputDir}`);
  return results;
}

// ─── Retention özet raporu ────────────────────────────────────────────────────
function generateRetentionSummary(incompleteData, results) {
  const totalLost = incompleteData.total;

  const rows = incompleteData.segments.map(s => {
    const msg = RETENTION_MESSAGES[s.missingField] || {};
    return `| ${msg.label || s.missingField} | ${s.count.toLocaleString()} | ${msg.urgency || '—'} | ${s.lastActiveDays} gün | ${msg.why?.slice(0,60) || '—'} |`;
  }).join('\n');

  return `# 🔄 Retention Özet Raporu
> ${new Date().toLocaleString('tr-TR')}

## Kritik Durum

**${totalLost.toLocaleString()} seafarer** profili yarım bıraktı.
Bu kullanıcılar platforma kayıtlı ama şirketlere **görünmüyor**.

## Segment Analizi

| Eksik Alan | Etkilenen | Aciliyet | Son Aktif | Neden Önemli |
|-----------|-----------|----------|-----------|--------------|
${rows}

## Öncelik Sırası

${incompleteData.segments
  .filter(s => RETENTION_MESSAGES[s.missingField])
  .sort((a,b) => {
    const score = { YÜKSEK:3, ORTA:2, DÜŞÜK:1 };
    return (score[RETENTION_MESSAGES[b.missingField]?.urgency]||0) - (score[RETENTION_MESSAGES[a.missingField]?.urgency]||0);
  })
  .map((s,i) => {
    const msg = RETENTION_MESSAGES[s.missingField];
    return `${i+1}. **${msg.label}** — ${s.count.toLocaleString()} kişi → ${msg.cta}`;
  }).join('\n')}

## Hedef: Bu Ay

Eğer eksik profillerin sadece **%10'u** tamamlansa:
- Yeni aktif profil: **+${Math.round(totalLost * 0.1).toLocaleString()}**
- Platformun toplam değeri: **${Math.round(totalLost * 0.1 / 100)}x artış**

## Üretilen İçerikler

${results.map(r => `- ${r.segment}: ${r.count.toLocaleString()} kişi → \`${path.basename(r.filepath)}\``).join('\n')}

---
*crewinjob Marketing Agent — Retention Modülü*
`;
}

// ─── Hızlı retention mesajı (tek segment) ────────────────────────────────────
async function quickRetentionMessage(missingField, stats) {
  const segment = {
    missingField,
    count:          1000,
    lastActiveDays: 7,
  };
  return await generateRetentionContent(segment, stats);
}

module.exports = {
  generateRetentionPack,
  generateRetentionContent,
  quickRetentionMessage,
  RETENTION_MESSAGES,
};
