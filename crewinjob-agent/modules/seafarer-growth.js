// ─── Seafarer Büyüme Modülü ──────────────────────────────────────────────────
// Kayıt odaklı içerik, FB grup mesajları, TikTok CTA scriptleri
const client = require('../ai-client');
const fs     = require('fs-extra');
const path   = require('path');

// ─── Hedef Facebook Grupları ──────────────────────────────────────────────────
const FB_GROUPS = [
  { name: 'Merchant Navy Jobs Worldwide',    members: '85K+',  lang: 'en', focus: 'jobs' },
  { name: 'Seafarers Worldwide Community',   members: '120K+', lang: 'en', focus: 'community' },
  { name: 'Gemi Adamları (Türkiye)',         members: '~15K',  lang: 'tr', focus: 'community' },
  { name: 'Officers Merchant Navy',          members: '~40K',  lang: 'en', focus: 'officers' },
  { name: 'Seafarers Job Board',             members: '~30K',  lang: 'en', focus: 'jobs' },
  { name: 'Chief Officers & Masters',        members: '~20K',  lang: 'en', focus: 'senior' },
  { name: 'Marine Engineers Worldwide',      members: '~25K',  lang: 'en', focus: 'engineers' },
  { name: 'Gemi Mühendisleri Derneği',       members: '~8K',   lang: 'tr', focus: 'engineers' },
  { name: 'Tanker Seafarers Network',        members: '~18K',  lang: 'en', focus: 'tanker' },
  { name: 'Bulk Carrier Officers',           members: '~12K',  lang: 'en', focus: 'bulk' },
];

// ─── Kayıt odaklı içerik şablonları ──────────────────────────────────────────
const REGISTRATION_TEMPLATES = {
  // Seafarer'ın acı noktaları
  painPoint: {
    desc: 'Seafarer\'ın yaşadığı sorunu göster, çözüm olarak platformu sun',
    hooks: [
      'İş ararken kaç şirketin kapısını çaldın?',
      'CV\'ni kaç kez e-mail ile gönderdin, hiç dönüş olmadı mı?',
      'Deneyimin var ama doğru şirkete ulaşamıyor musun?',
      'Sertifikalarının değeri var ama kimse göremiyorsa ne anlamı?',
    ]
  },
  // Fayda odaklı
  benefit: {
    desc: 'Platformun seafarer\'a sağladığı somut faydayı anlat',
    hooks: [
      'Şirketler artık seni arıyor, sen onları değil',
      'Bir profil, yüzlerce şirkete ulaş',
      'AI algoritması seni en uygun ilanla eşleştiriyor',
      'Sertifikalarını yükle, görünür ol, işe başla',
    ]
  },
  // Sosyal kanıt
  socialProof: {
    desc: 'Platform büyüklüğünü ve başarıyı vurgula',
    hooks: [
      '15.000+ denizci zaten sistemde — sen neden yoksun?',
      '50+ şirket aktif olarak denizci arıyor',
      'Her gün yeni ilanlar, her gün yeni eşleşmeler',
    ]
  },
  // Ücretsizlik vurgusu
  free: {
    desc: 'Ücretsiz kayıt ve değerin altını çiz',
    hooks: [
      '0 ₺ — Kayıt ücretsiz, her zaman ücretsiz',
      'Denizcilik platformlarında komisyon ödemek zorunda değilsin',
      'Bedava kayıt, gerçek fırsatlar',
    ]
  }
};

// ─── Facebook Grup Mesaj Üretici ─────────────────────────────────────────────
async function generateFBGroupMessage(group, weekNumber, stats) {
  const isWeek1or2 = weekNumber <= 2;
  const isTurkish  = group.lang === 'tr';

  const prompt = `
Sen crewinjob.com'un topluluk yöneticisisin.
Denizcilik sektörünü iyi biliyorsun. Samimi, yardımsever ve spam değil değer odaklısın.

HEDEF GRUP: ${group.name} (${group.members} üye, odak: ${group.focus})
DİL: ${isTurkish ? 'Türkçe' : 'İngilizce'}
HAFTA: ${weekNumber} (${isWeek1or2 ? 'ISINMA DÖNEMİ — platform tanıtımı YAPMA' : 'AKTİF DÖNEM — kayıt CTA ekle'})
PLATFORM: crewinjob.com — ücretsiz denizcilik iş platformu
STATS: ${stats.seafarers} seafarer, ${stats.jobs} aktif ilan, ${stats.businesses} şirket

${isWeek1or2 ? `
KURAL: Bu hafta sadece DEĞER KAT. Platform tanıtımı YASAK.
Gruba faydalı bir şey paylaş:
- Sektör ipucu, CV tavsiyesi, sertifika bilgisi
- Güncel denizcilik haberi yorumu
- "Bu hafta hangi pozisyonlar çok aranıyor?" sorusu
- Deneyim paylaşımı veya soru

İmzana sadece "crewinjob.com ekibi" yaz, link verme.
` : `
KURAL: Değer ver + soft CTA. Spam değil, samimi davet.
Format:
1. Hook (sorunu/fırsatı göster — 1-2 cümle)
2. Değer (faydalı bilgi, ipucu)  
3. Platform bağlantısı (doğal geçiş)
4. CTA: "crewinjob.com'da ücretsiz profil oluştur"
5. Soru ile bitir (engagement)

YASAK:
- "REKLAM", "TANITIM", "DUYURU" kelimeleri
- Ünlem yağmuru (!!!!!)
- "En iyi platform" gibi süperlativ iddialar
- 3'ten fazla emoji
`}

Grubun odağına (${group.focus}) uygun içerik yaz.
Max 300 kelime.
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Tüm FB grupları için haftalık mesaj paketi ───────────────────────────────
async function generateFBGroupPack(stats, weekNumber, outputDir) {
  console.log(`\n  👥 ${FB_GROUPS.length} Facebook grubu için hafta ${weekNumber} mesajları üretiliyor...`);

  await fs.ensureDir(outputDir);
  const results = [];

  for (const group of FB_GROUPS) {
    process.stdout.write(`  📱 ${group.name}... `);
    try {
      const message = await generateFBGroupMessage(group, weekNumber, stats);
      results.push({ group: group.name, members: group.members, lang: group.lang, message });
      console.log('✅');
    } catch (err) {
      console.log('❌ ' + err.message);
    }
    await new Promise(r => setTimeout(r, 700));
  }

  // Markdown dosyası
  const phase = weekNumber <= 2 ? 'isinma' : weekNumber <= 4 ? 'icerik' : 'aktif_tanitim';
  const filename = `FB_grup_mesajlari_hafta${weekNumber}_${phase}.md`;
  const filepath = path.join(outputDir, filename);

  const md = generateFBMarkdown(results, weekNumber, phase);
  await fs.writeFile(filepath, md);

  console.log(`\n  ✅ ${results.length} grup mesajı hazır → ${filepath}`);
  return results;
}

function generateFBMarkdown(results, weekNumber, phase) {
  const phaseLabels = {
    isinma:        '🟡 Isınma Dönemi — Platform tanıtımı YOK, sadece değer',
    icerik:        '🟠 İçerik Dönemi — Değer + soft CTA',
    aktif_tanitim: '🟢 Aktif Tanıtım — Kayıt daveti'
  };

  const sections = results.map(r => `
## ${r.group}
> 👥 ${r.members} üye · 🌐 ${r.lang === 'tr' ? 'Türkçe' : 'İngilizce'}

${r.message}

---
- [ ] Paylaşıldı — Tarih: ___________
- [ ] Engagement notu: ___________
`).join('\n');

  return `# 👥 Facebook Grup Mesajları — Hafta ${weekNumber}
> ${phaseLabels[phase] || phase}  
> Oluşturulma: ${new Date().toLocaleString('tr-TR')}

## ⚠️ Önemli Kurallar
- Her gruba aynı mesajı kopyala-yapıştır YAPMA — her biri özelleştirilmiş
- Mesajı göndermeden önce grubun kurallarını oku
- Hafta ${weekNumber <= 2 ? '1-2\'de platform linki verme' : '3\'ten itibaren link ekleyebilirsin'}
- Yanıtlara mutlaka cevap ver

---

${sections}

---
*crewinjob Marketing Agent — Seafarer Büyüme Modülü*
`;
}

// ─── Kayıt odaklı TikTok scriptleri ──────────────────────────────────────────
async function generateRegistrationTikTok(scriptType, stats, language) {
  const scripts = {
    problem_solution: {
      title: 'Problem → Çözüm',
      brief: 'Seafarer\'ın acı noktasını göster, crewinjob\'u çözüm olarak sun'
    },
    day_in_life: {
      title: 'Denizci Günlüğü',
      brief: 'Gemi hayatından bir sahne — "Bu hayatı seviyorsan seni bekleyen fırsatlar var"'
    },
    reveal: {
      title: 'Ortaya Çıkar',
      brief: '"Bunu bilmiyorsan kayıp ediyorsun" formatı — platform özelliği reveal'
    },
    stats_shock: {
      title: 'İstatistik Şok',
      brief: 'Şaşırtıcı bir denizcilik istatistiğiyle başla, platforma bağla'
    },
    testimonial: {
      title: 'Başarı Hikayesi',
      brief: 'Platformdan iş bulan denizci formatı (role play)'
    },
  };

  const s    = scripts[scriptType] || scripts.problem_solution;
  const lang = language === 'en' ? 'en' : 'tr';
  const langLine = lang === 'en'
    ? 'LANGUAGE: Write ONLY in English. No Turkish version. (Add Turkish subtitle note where needed)'
    : 'LANGUAGE: Write ONLY in Turkish. No English version.';

  const prompt = `
Sen crewinjob.com'un TikTok içerik uzmanısın. Denizcilik sektörünü biliyorsun.
${langLine}

GÖREV: "${s.title}" formatında viral TikTok scripti yaz.
BRIEF: ${s.brief}
AMAÇ: Seafarerleri crewinjob.com'a ÜCRETSİZ KAYIT olmaya yönlendirmek.
STATS: ${stats.seafarers} denizci kayıtlı, ${stats.businesses} şirket, ${stats.jobs} ilan

SCRIPT YAPISI:

### 🎬 60 SANİYE VERSİYONU

**HOOK (0-3 sn)** ← İzleyiciyi durduracak ilk cümle
[Sahne: ...]
Metin: "..."

**BODY (3-50 sn)** ← Ana mesaj
[Sahne 1: ...]
Metin: "..."
[Sahne 2: ...]
Metin: "..."
[Sahne 3: ...]
Metin: "..."

**CTA (50-60 sn)** ← Kayıt daveti
[Sahne: ...]
Metin: "crewinjob.com'a ücretsiz kayıt ol — Bio'daki link"
Alt yazı: "${stats.seafarers} denizci zaten sistemde"

---

### ⚡ 15 SANİYE VERSİYONU
[Sadece Hook + CTA]

---

### 📝 CAPTION (max 150 karakter)
[Platform linki + CTA vurgusu]

### 🎵 MÜZİK ÖNERİSİ
[Trend veya uygun müzik tipi]

### #️⃣ HASHTAG'LER (8 adet)
#crewinjob #seafarer #merchantnavy #maritimejobs #shiplife #seafarerlife #marinelife #fyp

### 💬 İLK YORUM (engagement trick)
[İzleyicileri yorum yapmaya teşvik eden ilk yorum]

Tone: yukarıdaki dil kuralına uy.
Tone: Enerjik, samimi, motivasyonel — ama reklam gibi değil.
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Kayıt odaklı tüm platform içerikleri ────────────────────────────────────
async function generateRegistrationContent(platform, stats, language) {
  const hooks = REGISTRATION_TEMPLATES;
  const lang  = language === 'en' ? 'en' : 'tr';
  const langLine = lang === 'tr'
    ? 'LANGUAGE: Write ONLY in Turkish. Do NOT write an English version.'
    : 'LANGUAGE: Write ONLY in English. Do NOT write a Turkish version.';

  const prompt = `
Sen crewinjob.com'un dijital pazarlama uzmanısın.
AMAÇ: Seafarerleri platforma ÜCRETSİZ KAYIT olmaya teşvik etmek.
PLATFORM: ${platform.toUpperCase()}
STATS: ${stats.seafarers} kayıtlı seafarer, ${stats.businesses} şirket, ${stats.jobs} ilan
${langLine}

Kullanılabilecek hook'lar:
Acı noktası: ${hooks.painPoint.hooks.slice(0,2).join(' / ')}
Fayda: ${hooks.benefit.hooks.slice(0,2).join(' / ')}
Sosyal kanıt: ${hooks.socialProof.hooks[0]}
Ücretsizlik: ${hooks.free.hooks[0]}

GÖREV: ${platform} için 3 FARKLI kayıt odaklı içerik yaz:
1. Acı noktası odaklı
2. Fayda odaklı
3. Sosyal kanıt odaklı

Her birinde:
- Platform'a özgü format ve karakter sınırı
- Güçlü CTA: "crewinjob.com'da ücretsiz profil oluştur"
- Tek dil (yukarıdaki LANGUAGE kuralına göre)

Spam gibi görünmesin. Samimi, yardımsever ton.
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Aylık FB kampanya planı ──────────────────────────────────────────────────
async function generateFBCampaignPlan(stats, outputDir) {
  const md = `# 📅 Facebook Grup Kampanya Planı — Seafarer Büyüme
> Oluşturulma: ${new Date().toLocaleString('tr-TR')}

## Strateji: 4 Haftalık Isınma → Tanıtım

| Hafta | Ton | Ne Paylaş | CTA |
|-------|-----|-----------|-----|
| Hafta 1 | Sadece değer | Sektör ipucu, soru, bilgi | ❌ Yok |
| Hafta 2 | Değer + tanışma | Platform'u merak uyandırıcı tanıt | Çok hafif |
| Hafta 3 | Değer + davet | Özellik tanıtımı + kayıt daveti | ✅ Var |
| Hafta 4 | Aktif tanıtım | Başarı hikayesi + kayıt daveti | ✅ Güçlü |

## Hedef Gruplar (${FB_GROUPS.length} grup)

| Grup | Üye | Dil | Odak |
|------|-----|-----|------|
${FB_GROUPS.map(g => `| ${g.name} | ${g.members} | ${g.lang === 'tr' ? '🇹🇷' : '🇬🇧'} | ${g.focus} |`).join('\n')}

## Haftalık Mesaj Üretimi

\`\`\`
node index.js → Menü 5 → Facebook Grup Mesajları
\`\`\`

Her hafta yeni mesajlar üretilir, önceki haftanın tonu baz alınır.

## Başarı Kriterleri

| Metrik | Hedef (4 hafta sonunda) |
|--------|------------------------|
| Gruplara katılım | 10 grubun tamamı |
| Haftalık paylaşım | Her gruptan min. 1 |
| Yorum/engage oranı | >5% |
| Buradan gelen kayıt | İzlenebilir link ile ölç |

---
*crewinjob Marketing Agent — Seafarer Büyüme Modülü*
`;

  await fs.ensureDir(outputDir);
  const filepath = path.join(outputDir, 'FB_kampanya_plani.md');
  await fs.writeFile(filepath, md);
  return filepath;
}

module.exports = {
  generateFBGroupPack,
  generateFBGroupMessage,
  generateRegistrationTikTok,
  generateRegistrationContent,
  generateFBCampaignPlan,
  FB_GROUPS,
  REGISTRATION_TEMPLATES,
};
