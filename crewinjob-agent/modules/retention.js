// ─── Seafarer Retention Modülü ────────────────────────────────────────────────
// Profili yarım kalanları tespit eder, geri kazanma içerikleri üretir
const client = require('../ai-client');
const ctx    = require('../context');
const fs     = require('fs-extra');
const path   = require('path');

// ─── Eksik profil segmentleri için içerik ────────────────────────────────────
// İki tür segment var:
//   a) DAVRANIŞSAL — profil doluluk oranından türetilir, veri BUGÜN mevcut
//   b) ALAN BAZLI  — hangi alanın eksik olduğuna göre, backend endpoint'i BEKLENİYOR
//      (bkz. context/activation-brief.md → P2)
const RETENTION_MESSAGES = {
  // ── a) Davranışsal segmentler — fillRateBuckets'tan gelir ──────────────────
  neverStarted: {
    label:   'Kayıt olmuş, profiline hiç dokunmamış',
    urgency: 'YÜKSEK',
    why:     'Kaydı bitirdi ama profil bölümüne hiç girmedi. Karşısında uzun bir form olduğunu görüp vazgeçmiş olabilir. Ona lazım olan hatırlatma değil, daha kısa bir yol.',
    cta:     'CV\'ni yükle, profilin otomatik dolsun →',
  },
  startedIncomplete: {
    label:   'Profile başlamış ama yarıda bırakmış',
    urgency: 'YÜKSEK',
    why:     'Profilini açtı, birkaç alan doldurdu, sonra durdu. Bilgi eksiği yok — tamamlamanın ne kazandıracağını görmüyor. Kaç ilanda görüneceğini bilse devam eder.',
    cta:     'Profilini tamamla, ilanlarda görün →',
  },

  // ── b) Alan bazlı segmentler — P2 endpoint'i bekliyor ─────────────────────
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
    why:     'Fotoğraflı profil şirketlere daha güven verici görünür; kimin başvurduğunu hızlıca tanırlar.',
    cta:     'Fotoğraf ekle →',
  },
  documents: {
    label:   'Belgeler yüklenmemiş',
    urgency: 'ORTA',
    why:     'Belgeleri yüklü profiller şirketlerin ön kontrolünü daha kolay geçer; eksik belge elenme sebebi olabilir.',
    cta:     'Belgelerini yükle →',
  },
  references: {
    label:   'Referans eklenmemiş',
    urgency: 'DÜŞÜK',
    why:     'Referanslar güven oluşturur ve şirketlerin karar vermesini kolaylaştırır.',
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

<arka_plan>
Aşağıdaki bölüm senin için ARKA PLAN bilgisidir — yazacağın içeriğin amacını anlaman içindir.
Bu bölümü çıktına KOPYALAMA, özetleme veya başlık olarak tekrar etme.
Çıktın doğrudan "## 📱 SOSYAL MEDYA İÇERİKLERİ" başlığıyla başlamalı.

${ctx.core()}

Bu görevin metrik karşılığı: Seafarer Activation Rate ve Ready-to-Hire Profile Rate.
Kayıt sayısı değil, işe hazır profil sayısı önemlidir. ${segment.count} kişilik bu segment
şu an envanterde görünüyor ama şirketlere sunulamıyor.
</arka_plan>

---

DURUM: ${segment.count} seafarer "${msg.label}" durumunda ve şirketlere görünmüyor.
Bu kullanıcılar platforma kayıt olmuş ama profillerini tamamlamamış.
${segment.lastActiveDays != null
  ? `Son aktif: ortalama ${segment.lastActiveDays} gün önce.`
  : 'Son aktiflik verisi henüz izlenmiyor — mesajlarda "X gündür uğramadın" gibi zaman iddiasında BULUNMA.'}
NEDEN ÖNEMLİ: ${msg.why}
PLATFORM STATS: ${stats.seafarers} toplam seafarer, ${stats.jobs} aktif ilan

## MESAJ KURALLARI (hepsi zorunlu)

**1. Somut sayı kullan, belirsiz nicelik YASAK.**
Elinde gerçek rakam var: **${stats.jobs} aktif ilan**. Bunu kullan.
YASAK kelimeler: "yüzlerce", "onlarca", "binlerce", "birçok", "sayısız", "pek çok".
Yanlış: "yüzlerce ilana ulaş" · Doğru: "şu an açık olan ${stats.jobs} ilan"

**2. "%100 tamamla" DEME.**
Platformda görünür olmak için %100 gerekmiyor. Yüzde hedefi vermek yerine
hangi ALANIN eksik olduğunu söyle: deniz hizmeti, sertifika, müsaitlik.
Yanlış: "profilini %100 tamamla" · Doğru: "deniz hizmetini ve sertifikalarını ekle"

**3. Kullanıcıyı ASLA suçlama.**
Ne tembellik, ne ihmal, ne unutkanlık ima et. Denizci gemide çalışıyor; interneti kısıtlı,
vardiyası ağır. Suçlayıcı ton bu kitlede tersine çalışır.
Yasak örnekler: "üşengeçlik basıyor", "ihmal etmişsin", "boşver demişsin", "tembellik yapma".
Doğru yaklaşım: sebebi sisteme veya koşullara bağla — "gemide internet zor, biliyoruz".

**4. Soyut yüzde değil, somut görünürlük kazancı vaat et.**
Yanlış: "profilin %60 tamam" · Doğru: "sertifikanı eklersen aramalarda çıkmaya başlarsın"

**5. Mekanizmayı açıkla.**
Kullanıcı NEDEN görünmediğini anlamalı: şirketler rütbe, gemi tipi deneyimi ve sertifika
geçerliliğine göre filtreliyor; o alanlar boşsa aday listesinde hiç çıkmıyor.
Bu açıklama, "profilini tamamla" ricasından çok daha ikna edici.

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

## 💬 DİREKT MESAJ ŞABLONLARI (platforma entegre edilecek — kullanıcıya gönderilecek)

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

## Ölçüm — Bu Kampanya İşe Yaradı mı?

| Metrik | Nasıl ölçülür | Hedef |
|--------|---------------|-------|
| Mesaj açılma oranı | Bildirim/e-posta açılma | >%40 |
| Profil tamamlama dönüşümü | \`profile_completed_80\` event · mesaj alan segment | >%15 |
| Ready-to-Hire dönüşümü | Profil + belge + müsaitlik tam olan | >%8 |
| Geri dönen kullanıcı | 14 gün içinde tekrar giriş | >%25 |

**Kalıcı çözüm not:** Re-engagement mesajı semptomu tedavi eder, sebebi değil.
Bu segment sürekli büyüyorsa asıl sorun profil akışındadır — aşamalı profil (progressive profiling)
veya CV parse ile otomatik doldurma değerlendirilmeli. Detay: \`context/metrics-playbook.md\` Bölüm 2.

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

## Üretilen İçerikler

${results.map(r => `- ${r.segment}: ${r.count.toLocaleString()} kişi → \`${path.basename(r.filepath)}\``).join('\n')}

---
*crewinjob Marketing Agent — Retention Modülü*
`;
}

// ─── E-posta re-aktivasyon içeriği (doluluk bucket'ına göre) ─────────────────
// bucket eşikleri (backend tanımı — GetSeafarersByFillBucket):
//   'zero' (%0) | 'low' (%1-49) | 'mid' (%50-79) | 'high' (%80+, kullanılmaz)
// Ürün tanımı: Activated Seafarer = profil doluluğu ≥ %80. Prompt'lar bu eşiği kullanmalı.
// ─── Uyruğa göre içerik dili ──────────────────────────────────────────────────
// Denizcilik sektöründe en yaygın uyruklar → AI'ya verilecek dil adı + footer/unsubscribe
// metinlerinin dil kodu. NOT: GetSeafarersByFillBucket şu an "nationality" alanı döndürmüyor
// (bkz. context/yapilacaklar-backend-frontend.md) — bu harita, o alan eklendiğinde devreye girer.
const LANGUAGE_BY_CODE = {
  tr: { code: 'tr', name: 'Turkish' },
  en: { code: 'en', name: 'English' },
  tl: { code: 'tl', name: 'Filipino (Tagalog)' },
  uk: { code: 'uk', name: 'Ukrainian' },
  ru: { code: 'ru', name: 'Russian' },
  ka: { code: 'ka', name: 'Georgian' },
  az: { code: 'az', name: 'Azerbaijani' },
  id: { code: 'id', name: 'Indonesian' },
  hi: { code: 'hi', name: 'Hindi' },
  ro: { code: 'ro', name: 'Romanian' },
  pl: { code: 'pl', name: 'Polish' },
};

// Uyruk adı/kodu → dil. Hem ISO 3166-1 alpha-2 ülke kodu hem de yaygın İngilizce/Türkçe
// uyruk adlarıyla eşleşir (backend'in hangi formatta döneceği henüz netleşmedi).
const NATIONALITY_TO_LANGUAGE_CODE = {
  // Türkiye
  TR: 'tr', Turkey: 'tr', Turkish: 'tr', Türk: 'tr', Türkiye: 'tr',
  // Filipinler — denizcilik sektöründe en büyük tedarikçi ülke
  PH: 'tl', Philippines: 'tl', Filipino: 'tl',
  // Hindistan — profesyonel yazışmada ağırlıklı İngilizce kullanılır
  IN: 'en', India: 'en', Indian: 'en',
  // Ukrayna / Rusya / Gürcistan / Azerbaycan — Karadeniz/Hazar havzası denizci kaynağı
  UA: 'uk', Ukraine: 'uk', Ukrainian: 'uk',
  RU: 'ru', Russia: 'ru', Russian: 'ru',
  GE: 'ka', Georgia: 'ka', Georgian: 'ka',
  AZ: 'az', Azerbaijan: 'az', Azerbaijani: 'az',
  // Endonezya, Romanya, Polonya — diğer yaygın kaynak ülkeler
  ID: 'id', Indonesia: 'id', Indonesian: 'id',
  RO: 'ro', Romania: 'ro', Romanian: 'ro',
  PL: 'pl', Poland: 'pl', Polish: 'pl',
};

/**
 * Uyruk bilgisinden e-posta içerik dilini çözer. Eşleşme yoksa İngilizce'ye düşer
 * (denizcilik sektöründe ortak iş dili).
 * @param {string} [nationality] — ISO ülke kodu veya yaygın uyruk/ülke adı
 * @returns {string} LANGUAGE_BY_CODE anahtarlarından biri
 */
function resolveLanguageFromNationality(nationality) {
  if (!nationality) return 'en';
  const key = nationality.trim();
  return NATIONALITY_TO_LANGUAGE_CODE[key] || NATIONALITY_TO_LANGUAGE_CODE[key.toUpperCase()] || 'en';
}

const BUCKET_TO_MESSAGE = {
  zero: {
    ...RETENTION_MESSAGES.neverStarted,
    // Hiç başlamamış → CV yükle akışına yönlendir
    ctaPath:    '/account/profile?onboarding=cv',
    strategy:   `Kullanıcı profiline hiç girmedi.
STRATEJI: En büyük engel "uzun form" korkusudur. Çözümü tek adım olarak sun: CV yükle → profil otomatik dolar.
ÖZEL KURAL: "Profilini tamamla" deme; bunun yerine "CV yükle" veya "tek adımda başla" gibi ifade kullan.
MEKANIZMA CÜMLESİ (mutlaka dahil et): Şu an hiç profil verisi olmadığı için arama filtrelerinde tamamen görünmezsin — rank, vessel type, sea time alanları boş olan profiller sonuçlara girmez.`,
  },
  low:  {
    ...RETENTION_MESSAGES.startedIncomplete,
    // Başlamış ama %1-49 dolulukta → profil düzenlemeye yönlendir
    ctaPath:    '/account/profile',
    strategy:   `Kullanıcı profile girmiş ama %1-49 dolulukta kalmış.
STRATEJI: Somut ilerleme yolu göster. "Biraz daha" dil, ama somut: hangi alanlar eksikse onu ima et (sea service veya STCW/COC).
MEKANIZMA CÜMLESİ (mutlaka dahil et): %80 aktivasyon eşiğinin altındaki profiller şirketlerin "işe hazır" filtrelerinde görünmüyor; şu an bu eşiğin oldukça gerisinde.`,
  },
  mid:  {
    label:   'Profili %50-79 arası, %80 aktivasyon eşiğine yakın',
    urgency: 'ORTA',
    why:     'Birkaç ekleme ile %80 aktivasyon eşiğini geçip şirketlere görünür olacak.',
    cta:     'Profilini tamamla, işe hazır ol →',
    ctaPath: '/account/profile',
    strategy: `Kullanıcı %50-79 dolulukta — %80 aktivasyon eşiğine yakın.
STRATEJI: Yakınlık hissini kullan ("neredeyse oradasın"), ama asla belirsiz bırakma — somut bir alan öner (STCW/COC sertifikası veya sea service güncellemesi).
MEKANIZMA CÜMLESİ (mutlaka dahil et): Şu an şirketlerin "hazır adaylar" filtresinin dışındasın — %80 eşiğini geçen profiller bu filtrede otomatik görünür.
TONLAMADA FARK: Diğer bucket'lardan daha acil hissettirilmeli; kullanıcı zaten yatırım yaptı, vazgeçmek anlamsız.`,
  },
};

// ─── Marka renkleri — Wjob/crewin logosundaki gerçek renklerle birebir aynı ──
const BRAND = {
  navy:      '#012030', // logodaki koyu lacivert
  navyLight: '#0A2A3B',
  blue:      '#134E70', // logodaki mavi
  blueBg:    '#E8F0F5',
  amber:     '#F5A524',
  text:      '#1F2937',
  textMuted: '#6B7280',
  border:    '#E5E7EB',
  bg:        '#F3F4F6',
};

// ─── HTML güvenliği — AI metni ve ilan verisi e-posta HTML'ine kaçışlanarak girer ──
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * href için güvenli URL. {{PLACEHOLDER}} aynen bırakılır (gönderimde doldurulur); aksi halde yalnızca
 * http(s) (allowMailto ile mailto) kabul edilir. Geçersizse fallback döner. Sonuç attribute için kaçışlanır.
 */
function safeEmailUrl(value, fallback, allowMailto) {
  const raw = String(value == null ? '' : value).trim();
  if (/^\{\{[A-Z_]+\}\}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const allowed = allowMailto ? ['https:', 'http:', 'mailto:'] : ['https:', 'http:'];
    if (allowed.includes(url.protocol)) return escapeHtml(url.toString());
  } catch (_) { /* geçersiz URL → fallback */ }
  return fallback;
}

/**
 * AI'dan gelen düz metin parçalarını sabit markalı HTML e-posta şablonuna yerleştirir.
 * Tasarım AI'ya bırakılmaz — sadece metin üretimi ona aittir.
 * Tüm metin alanları HTML-escape edilir; URL'ler yalnızca http(s) veya placeholder olabilir.
 */
function renderEmailTemplate({
  headline: rawHeadline,
  paragraphs: rawParagraphs = [],
  bullets: rawBullets = [],
  ctaText: rawCtaText,
  statLabel: rawStatLabel,
  lang = 'en',
  ctaUrl: rawCtaUrl = '{{CTA_URL}}',
  unsubscribeUrl: rawUnsubscribeUrl = '{{UNSUBSCRIBE_URL}}',
}) {
  const headline       = escapeHtml(rawHeadline);
  const paragraphs     = (rawParagraphs || []).map(escapeHtml);
  const bullets        = (rawBullets || []).map(escapeHtml);
  const ctaText        = rawCtaText ? escapeHtml(rawCtaText) : '';
  const statLabel      = rawStatLabel ? escapeHtml(rawStatLabel) : '';
  const ctaUrl         = safeEmailUrl(rawCtaUrl, '{{CTA_URL}}', false);
  const unsubscribeUrl = safeEmailUrl(rawUnsubscribeUrl, '{{UNSUBSCRIBE_URL}}', true);
  const preheader      = escapeHtml(String((rawParagraphs || [])[0] || rawHeadline || '').slice(0, 110));
  const year = new Date().getFullYear();
  const SITE = 'www.crewinjob.com';

  const T = lang === 'tr'
    ? {
        platformLabel: 'DENİZCİLİK KARİYER PLATFORMU',
        tagline:       'Doğru İş, Doğru Denizci',
        altCta:        'Veya doğrudan siteye gidin:',
        footerText:    'Bu e-postayı, CrewinJob platformuna kayıtlı olduğunuz için aldınız.',
        unsubText:     'E-posta aboneliğinden çık',
      }
    : {
        platformLabel: 'MARITIME CAREER PLATFORM',
        tagline:       'The Right Job, The Right Talent',
        altCta:        'Or go straight to:',
        footerText:    'You received this email because you are registered on CrewinJob.',
        unsubText:     'Unsubscribe from these emails',
      };

  const paragraphsHtml = paragraphs.map(p =>
    `<p class="body-text" style="margin:0 0 18px;font-size:15px;line-height:25px;color:#33475b;text-align:left;">${p}</p>`
  ).join('');

  // Madde listesi — yeşil daire içinde onay işareti. Unicode ✓ yerine tablo hücresi
  // kullanılır, böylece Outlook'ta da düzgün hizalanır.
  const bulletsHtml = bullets.length ? `
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:6px 0 30px 0;">
      ${bullets.map(b => `
      <tr>
        <td valign="top" width="26" style="width:26px;padding:7px 0;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr>
            <td bgcolor="#00a878" width="20" height="20" align="center" valign="middle" style="width:20px;height:20px;background:#00a878;border-radius:10px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;line-height:20px;text-align:center;">&#10003;</td>
          </tr></table>
        </td>
        <td class="bullet-txt" style="padding:7px 0 7px 12px;font-size:15px;line-height:23px;color:#123044;text-align:left;font-weight:600;">${b}</td>
      </tr>`).join('')}
    </table>` : '';

  // Eyebrow rozeti — başlığın ÜSTÜNDE, istatistiği vurgular.
  const statHtml = statLabel ? `
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 20px auto;">
      <tr>
        <td bgcolor="#eaf7f2" align="center" style="background:#eaf7f2;border:1px solid #b2e8d6;border-radius:100px;padding:8px 20px;font-size:13px;font-weight:700;color:#00805c;letter-spacing:0.2px;line-height:18px;">
          ${statLabel}
        </td>
      </tr>
    </table>` : '';

  // CTA — Outlook için VML roundrect, diğerleri için inline-block anchor.
  const ctaHtml = ctaText ? `
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:4px auto 0 auto;">
      <tr>
        <td align="center">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
            href="${ctaUrl}" style="height:52px;v-text-anchor:middle;width:270px;" arcsize="24%" stroke="f" fillcolor="#00a878">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${ctaText}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
          <a href="${ctaUrl}" style="display:inline-block;background:#00a878;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:16px 42px;border-radius:12px;letter-spacing:0.3px;mso-hide:all;">${ctaText}</a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
    <p style="margin:18px 0 0;font-size:13px;line-height:20px;color:#7d929d;text-align:center;">
      ${T.altCta} <a href="https://${SITE}" style="color:#0f5671;font-weight:700;text-decoration:none;">${SITE}</a>
    </p>` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${headline}</title>
  <!-- Karanlık mod kilidi: istemcinin kartı ters çevirip okunmaz hale getirmesini engeller. -->
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <style type="text/css">
    :root { color-scheme: light; supported-color-schemes: light; }
    /* Apple Mail / iOS karanlık mod */
    @media (prefers-color-scheme: dark) {
      .card       { background:#ffffff !important; }
      .page-bg    { background:#eef5f6 !important; }
      .headline   { color:#123044 !important; }
      .body-text  { color:#33475b !important; }
      .bullet-txt { color:#123044 !important; }
      .foot-box   { background:#f7fbfc !important; }
      .foot-txt   { color:#7d929d !important; }
    }
    /* Outlook.com karanlık mod */
    [data-ogsc] .card       { background:#ffffff !important; }
    [data-ogsc] .headline   { color:#123044 !important; }
    [data-ogsc] .body-text  { color:#33475b !important; }
    [data-ogsc] .bullet-txt { color:#123044 !important; }
    [data-ogsc] .foot-box   { background:#f7fbfc !important; }
    [data-ogsc] .foot-txt   { color:#7d929d !important; }
    /* Mobil */
    @media only screen and (max-width:620px) {
      .pad-lr   { padding-left:24px !important; padding-right:24px !important; }
      .headline { font-size:24px !important; line-height:31px !important; }
      .logo-img { width:180px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef5f6;font-family:Arial,Helvetica,sans-serif;color:#123044;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" class="page-bg" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#eef5f6" style="background:#eef5f6;">
    <tr>
      <td align="center" style="padding:36px 14px;">
        <table role="presentation" class="card" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #dbe8ec;">

          <!-- HEADER: koyu gradient, üzerinde BEYAZ logo (kutu yok — karanlık modda da temiz durur) -->
          <tr>
            <td align="center" bgcolor="#0f5671" style="background:#0f5671;background-image:linear-gradient(135deg,#082c3a 0%,#0f5671 55%,#0aa37a 130%);padding:38px 30px 30px 30px;text-align:center;">
              <img src="cid:crewinjob-logo" class="logo-img" width="210" alt="WJob by crewin" style="display:block;width:210px;max-width:210px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto 20px auto;">
              <div style="font-size:13px;font-weight:700;color:#ffffff;letter-spacing:0.4px;line-height:19px;">${T.tagline}</div>
              <div style="font-size:11px;font-weight:700;color:#9fd4dd;letter-spacing:1.8px;text-transform:uppercase;line-height:16px;padding-top:6px;">${T.platformLabel}</div>
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:18px auto 0 auto;">
                <tr>
                  <td align="center" style="border-top:1px solid rgba(255,255,255,0.28);padding-top:14px;">
                    <a href="https://${SITE}" style="font-size:13px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.5px;">${SITE}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td class="pad-lr" style="padding:38px 44px 12px 44px;text-align:center;">
              ${statHtml}
              <h1 class="headline" style="margin:0 0 22px 0;font-family:Arial,Helvetica,sans-serif;font-size:27px;line-height:35px;font-weight:800;color:#123044;text-align:center;">${headline}</h1>
              ${paragraphsHtml}
              ${bulletsHtml}
              ${ctaHtml}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td class="pad-lr" style="padding:30px 44px 34px 44px;">
              <table role="presentation" class="foot-box" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f7fbfc" style="background:#f7fbfc;border-radius:14px;border:1px solid #e1edf1;">
                <tr>
                  <td align="center" class="foot-txt" style="padding:20px 22px;color:#7d929d;font-size:12px;line-height:19px;text-align:center;">
                    <a href="https://${SITE}" style="color:#0f5671;font-weight:700;text-decoration:none;font-size:13px;">${SITE}</a>
                    <div style="padding-top:8px;">${year} &copy; creWin &middot; ${T.footerText}</div>
                    <div style="padding-top:8px;"><a href="${unsubscribeUrl}" class="foot-txt" style="color:#9aabb5;text-decoration:underline;">${T.unsubText}</a></div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * "Size Uygun İlanlar" kampanyası için sabit HTML e-posta üretir.
 * İçerik AI'dan gelmez — doğrudan iş ilanı verisinden render edilir.
 * @param {Array<{ jobId, title, company, vesselType, duration, salary, location, applyUrl }>} jobs
 * @param {{ lang?: string, unsubscribeUrl?: string }} [options]
 * @returns {{ subject: string, html: string }}
 */
// Tüm desteklenen diller için iş eşleşme maili çevirileri
const JOB_MATCH_TRANSLATIONS = {
  tr: {
    subject:       'Profilinize uygun ilanlar crewinjob.com\'da sizi bekliyor',
    platformLabel: 'DENİZCİLİK KARİYER PLATFORMU',
    tagline:       'Doğru İş, Doğru Denizci',
    headline:      'Size Uygun İlanlar Var!',
    intro1:        'Profilinize uygun yeni iş ilanları yayında. Şirketler sizin gibi deneyimli denizcileri arıyor.',
    intro2:        'Aşağıdaki ilanları inceleyin ve fırsatı kaçırmadan hemen başvurun.',
    applyBtn:      'Başvur',
    ctaText:       'Tüm İlanları Gör',
    altCta:        'Tüm ilanlar için:',
    footerText:    'Bu e-postayı, CrewinJob platformuna kayıtlı olduğunuz için aldınız.',
    unsubText:     'E-posta aboneliğinden çık',
  },
  en: {
    subject:       'New job listings matching your profile on crewinjob.com',
    platformLabel: 'MARITIME CAREER PLATFORM',
    tagline:       'The Right Job, The Right Talent',
    headline:      'Jobs Matching Your Profile!',
    intro1:        'New job listings matching your profile are now live. Companies are actively looking for experienced seafarers like you.',
    intro2:        'Review the listings below and apply before the opportunity is gone.',
    applyBtn:      'Apply Now',
    ctaText:       'View All Listings',
    altCta:        'Or browse all jobs at:',
    footerText:    'You received this email because you are registered on CrewinJob.',
    unsubText:     'Unsubscribe from these emails',
  },
  tl: {
    subject:       'Mga bagong trabaho sa crewinjob.com na akma sa iyong profile',
    platformLabel: 'MARITIME CAREER PLATFORM',
    tagline:       'Tamang Trabaho, Tamang Seafarer',
    headline:      'May Mga Trabaho para sa Iyo!',
    intro1:        'Mga bagong job listing na akma sa iyong profile ay live na. Aktibong naghahanap ng mga may karanasang seafarer tulad mo ang mga kumpanya.',
    intro2:        'Suriin ang mga listing sa ibaba at mag-apply bago mawala ang pagkakataon.',
    applyBtn:      'Mag-apply',
    ctaText:       'Tingnan Lahat ng Listing',
    altCta:        'O i-browse ang lahat ng trabaho sa:',
    footerText:    'Natanggap mo ang email na ito dahil registered ka sa CrewinJob.',
    unsubText:     'Mag-unsubscribe',
  },
  uk: {
    subject:       'Нові вакансії на crewinjob.com, що відповідають вашому профілю',
    platformLabel: 'МОРСЬКА КАР\'ЄРНА ПЛАТФОРМА',
    tagline:       'Правильна Робота, Правильний Моряк',
    headline:      'Вакансії, що відповідають вашому профілю!',
    intro1:        'Нові вакансії, що відповідають вашому профілю, вже на сайті. Компанії активно шукають досвідчених моряків, таких як ви.',
    intro2:        'Переглядайте вакансії нижче та подавайте заявку, поки не пізно.',
    applyBtn:      'Подати заявку',
    ctaText:       'Переглянути всі вакансії',
    altCta:        'Або переглянути всі вакансії:',
    footerText:    'Ви отримали цей лист тому, що зареєстровані на CrewinJob.',
    unsubText:     'Відписатися від розсилки',
  },
  ru: {
    subject:       'Новые вакансии на crewinjob.com, соответствующие вашему профилю',
    platformLabel: 'МОРСКАЯ КАРЬЕРНАЯ ПЛАТФОРМА',
    tagline:       'Правильная Работа, Правильный Моряк',
    headline:      'Вакансии под ваш профиль!',
    intro1:        'Новые вакансии, соответствующие вашему профилю, уже размещены. Компании активно ищут опытных моряков, таких как вы.',
    intro2:        'Просматривайте вакансии ниже и откликайтесь, пока не упустили возможность.',
    applyBtn:      'Откликнуться',
    ctaText:       'Все вакансии',
    altCta:        'Или все вакансии на:',
    footerText:    'Вы получили это письмо, потому что зарегистрированы на CrewinJob.',
    unsubText:     'Отписаться от рассылки',
  },
  ka: {
    subject:       'ახალი ვაკანსიები crewinjob.com-ზე, რომლებიც შეესაბამება თქვენს პროფილს',
    platformLabel: 'საზღვაო კარიერის პლატფორმა',
    tagline:       'სწორი სამუშაო, სწორი მეზღვაური',
    headline:      'ვაკანსიები თქვენი პროფილისთვის!',
    intro1:        'ახალი ვაკანსიები, რომლებიც შეესაბამება თქვენს პროფილს, ახლა ხელმისაწვდომია. კომპანიები აქტიურად ეძებენ გამოცდილ მეზღვაურებს, როგორიც თქვენ ხართ.',
    intro2:        'გადახედეთ ქვემოთ მოყვანილ ვაკანსიებს და შეიტანეთ განაცხადი, სანამ შესაძლებლობა არ გამოიკეტება.',
    applyBtn:      'განაცხადი',
    ctaText:       'ყველა ვაკანსია',
    altCta:        'ან ნახეთ ყველა ვაკანსია:',
    footerText:    'თქვენ მიიღეთ ეს ელ-ფოსტა, რადგან CrewinJob-ზე ხართ რეგისტრირებული.',
    unsubText:     'გამოწერის გაუქმება',
  },
  az: {
    subject:       'crewinjob.com-da profilinizə uyğun yeni iş elanları',
    platformLabel: 'DƏNİZ KARİYER PLATFORMU',
    tagline:       'Doğru İş, Doğru Dənizçi',
    headline:      'Profilinizə uyğun iş elanları!',
    intro1:        'Profilinizə uyğun yeni iş elanları indi mövcuddur. Şirkətlər sizin kimi təcrübəli dənizçilər axtarır.',
    intro2:        'Aşağıdakı elanları nəzərdən keçirin və fürsəti əldən verməzdən əvvəl müraciət edin.',
    applyBtn:      'Müraciət Et',
    ctaText:       'Bütün Elanları Gör',
    altCta:        'Bütün elanlar üçün:',
    footerText:    'Bu e-poçtu CrewinJob platformuna qeydiyyatdan keçdiyiniz üçün aldınız.',
    unsubText:     'E-poçt abunəliyindən çıxın',
  },
  id: {
    subject:       'Lowongan kerja baru di crewinjob.com yang sesuai profil Anda',
    platformLabel: 'PLATFORM KARIR MARITIM',
    tagline:       'Pekerjaan yang Tepat, Pelaut yang Tepat',
    headline:      'Lowongan yang Sesuai Profil Anda!',
    intro1:        'Lowongan kerja baru yang sesuai dengan profil Anda sudah tersedia. Perusahaan-perusahaan aktif mencari pelaut berpengalaman seperti Anda.',
    intro2:        'Lihat lowongan di bawah dan segera lamar sebelum kesempatan berlalu.',
    applyBtn:      'Lamar Sekarang',
    ctaText:       'Lihat Semua Lowongan',
    altCta:        'Atau cari semua lowongan di:',
    footerText:    'Anda menerima email ini karena terdaftar di CrewinJob.',
    unsubText:     'Berhenti berlangganan',
  },
  hi: {
    subject:       'crewinjob.com पर आपके प्रोफाइल से मेल खाती नई नौकरियां',
    platformLabel: 'समुद्री कैरियर प्लेटफॉर्म',
    tagline:       'सही काम, सही नाविक',
    headline:      'आपके प्रोफाइल से मेल खाती नौकरियां!',
    intro1:        'आपके प्रोफाइल से मेल खाती नई नौकरी की सूचियाँ अब उपलब्ध हैं। कंपनियाँ आप जैसे अनुभवी नाविकों की तलाश कर रही हैं।',
    intro2:        'नीचे दी गई नौकरियाँ देखें और मौका जाने से पहले आवेदन करें।',
    applyBtn:      'आवेदन करें',
    ctaText:       'सभी नौकरियाँ देखें',
    altCta:        'या सभी नौकरियाँ यहाँ देखें:',
    footerText:    'आपको यह ईमेल CrewinJob पर पंजीकृत होने के कारण मिला।',
    unsubText:     'अनसब्सक्राइब करें',
  },
  ro: {
    subject:       'Noi locuri de muncă pe crewinjob.com care se potrivesc profilului tău',
    platformLabel: 'PLATFORMA DE CARIERĂ MARITIMĂ',
    tagline:       'Jobul Potrivit, Marinarul Potrivit',
    headline:      'Joburi potrivite profilului tău!',
    intro1:        'Noi oferte de muncă care corespund profilului tău sunt acum disponibile. Companiile caută activ marinari experimentați ca tine.',
    intro2:        'Consultați ofertele de mai jos și aplicați înainte ca oportunitatea să dispară.',
    applyBtn:      'Aplică',
    ctaText:       'Vezi Toate Joburile',
    altCta:        'Sau caută toate joburile la:',
    footerText:    'Ai primit acest e-mail deoarece ești înregistrat pe CrewinJob.',
    unsubText:     'Dezabonați-vă de la e-mailuri',
  },
  pl: {
    subject:       'Nowe oferty pracy na crewinjob.com dopasowane do Twojego profilu',
    platformLabel: 'MORSKA PLATFORMA KARIERY',
    tagline:       'Praca dla Ciebie, Marynarz dla nas',
    headline:      'Oferty dopasowane do Twojego profilu!',
    intro1:        'Nowe oferty pracy dopasowane do Twojego profilu są już dostępne. Firmy aktywnie szukają doświadczonych marynarzy takich jak Ty.',
    intro2:        'Przejrzyj poniższe oferty i złóż wniosek, zanim okazja przepadnie.',
    applyBtn:      'Aplikuj',
    ctaText:       'Zobacz Wszystkie Oferty',
    altCta:        'Lub przeglądaj wszystkie oferty na:',
    footerText:    'Otrzymałeś ten e-mail, ponieważ jesteś zarejestrowany w CrewinJob.',
    unsubText:     'Zrezygnuj z subskrypcji',
  },
};

function renderJobMatchEmail(jobs, options) {
  const opts           = options || {};
  // nationality varsa önce nationality'den dil çöz, sonra opts.lang'a bak, varsayılan 'tr'
  const resolvedLang   = opts.nationality
    ? resolveLanguageFromNationality(opts.nationality)
    : (opts.lang || 'tr');
  // Backend'in opak linki yalnızca http(s)/mailto ise kullanılır; yoksa gönderimde doldurulacak placeholder
  const unsubscribeUrl = safeEmailUrl(opts.unsubscribeUrl || '{{UNSUBSCRIBE_URL}}', '{{UNSUBSCRIBE_URL}}', true);
  const year           = new Date().getFullYear();
  const SITE           = 'www.crewinjob.com';
  const ALL_JOBS_URL   = 'https://www.crewinjob.com/jobs';

  const T = JOB_MATCH_TRANSLATIONS[resolvedLang] || JOB_MATCH_TRANSLATIONS.en;

  // İlan verisi (başlık, firma, gemi tipi, maaş...) dış kaynaktan gelir → HTML-escape; başvuru linki yalnızca http(s)
  const jobCardsHtml = (jobs || []).slice(0, 6).map(function(j) {
    const metaParts = [];
    if (j.vesselType) metaParts.push('🚢 ' + escapeHtml(j.vesselType));
    if (j.location)   metaParts.push('📍 ' + escapeHtml(j.location));
    if (j.duration)   metaParts.push('⏱ ' + escapeHtml(j.duration));
    const metaLine    = metaParts.join(' &nbsp;•&nbsp; ');
    const salaryLine  = j.salary
      ? '<div style="font-size:13px;color:#00805c;font-weight:600;margin-top:4px;">💰 ' + escapeHtml(j.salary) + '</div>'
      : '';
    const companyLine = '';
    const applyUrl    = safeEmailUrl(j.applyUrl, ALL_JOBS_URL, false);

    return `
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="margin-bottom:12px;border-radius:12px;border:1px solid #e1edf1;overflow:hidden;">
      <tr>
        <td style="padding:16px 20px;border-left:4px solid #0aa37a;background:#ffffff;">
          <div style="font-size:17px;font-weight:800;color:#123044;line-height:22px;">${escapeHtml(j.title || '')}</div>
          ${companyLine}
          ${metaLine ? '<div style="font-size:13px;color:#6B7280;margin-top:4px;">' + metaLine + '</div>' : ''}
          ${salaryLine}
          <div style="margin-top:12px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
              href="${applyUrl}" style="height:36px;v-text-anchor:middle;width:120px;" arcsize="24%" stroke="f" fillcolor="#0aa37a">
              <w:anchorlock/><center style="color:#fff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">${T.applyBtn}</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="${applyUrl}" style="display:inline-block;background:#0aa37a;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:9px 22px;border-radius:8px;mso-hide:all;">${T.applyBtn} →</a>
            <!--<![endif]-->
          </div>
        </td>
      </tr>
    </table>`;
  }).join('');

  const ctaHtml = `
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:24px auto 0 auto;">
      <tr>
        <td align="center">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
            href="${ALL_JOBS_URL}" style="height:52px;v-text-anchor:middle;width:270px;" arcsize="24%" stroke="f" fillcolor="#00a878">
            <w:anchorlock/><center style="color:#fff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${T.ctaText}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
          <a href="${ALL_JOBS_URL}" style="display:inline-block;background:#00a878;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:16px 42px;border-radius:12px;letter-spacing:0.3px;mso-hide:all;">${T.ctaText}</a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
    <p style="margin:18px 0 0;font-size:13px;line-height:20px;color:#7d929d;text-align:center;">
      ${T.altCta} <a href="https://${SITE}" style="color:#0f5671;font-weight:700;text-decoration:none;">${SITE}</a>
    </p>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${T.headline}</title>
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <style type="text/css">
    :root { color-scheme: light; supported-color-schemes: light; }
    @media (prefers-color-scheme: dark) {
      .card { background:#ffffff !important; } .page-bg { background:#eef5f6 !important; }
      .headline { color:#123044 !important; } .body-text { color:#33475b !important; }
      .foot-box { background:#f7fbfc !important; } .foot-txt { color:#7d929d !important; }
    }
    [data-ogsc] .card { background:#ffffff !important; } [data-ogsc] .headline { color:#123044 !important; }
    [data-ogsc] .body-text { color:#33475b !important; } [data-ogsc] .foot-box { background:#f7fbfc !important; }
    [data-ogsc] .foot-txt { color:#7d929d !important; }
    @media only screen and (max-width:620px) {
      .pad-lr { padding-left:24px !important; padding-right:24px !important; }
      .headline { font-size:24px !important; line-height:31px !important; }
      .logo-img { width:180px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef5f6;font-family:Arial,Helvetica,sans-serif;color:#123044;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${T.intro1.slice(0, 110)}</div>
  <table role="presentation" class="page-bg" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#eef5f6" style="background:#eef5f6;">
    <tr><td align="center" style="padding:36px 14px;">
      <table role="presentation" class="card" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #dbe8ec;">
        <tr>
          <td align="center" bgcolor="#0f5671" style="background:#0f5671;background-image:linear-gradient(135deg,#082c3a 0%,#0f5671 55%,#0aa37a 130%);padding:18px 30px 14px 30px;text-align:center;">
            <img src="cid:crewinjob-logo" class="logo-img" width="150" alt="WJob by crewin" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto 6px auto;">
            <div style="font-size:11px;font-weight:700;color:#9fd4dd;letter-spacing:1.6px;text-transform:uppercase;line-height:15px;">${T.platformLabel}</div>
          </td>
        </tr>
        <tr>
          <td class="pad-lr" style="padding:38px 44px 12px 44px;">
            <h1 class="headline" style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:27px;line-height:35px;font-weight:800;color:#123044;text-align:center;">${T.headline}</h1>
            <p class="body-text" style="margin:0 0 8px;font-size:15px;line-height:25px;color:#33475b;text-align:left;">${T.intro1}</p>
            <p class="body-text" style="margin:0 0 24px;font-size:15px;line-height:25px;color:#33475b;text-align:left;">${T.intro2}</p>
            ${jobCardsHtml}
            ${ctaHtml}
          </td>
        </tr>
        <tr>
          <td class="pad-lr" style="padding:30px 44px 34px 44px;">
            <table role="presentation" class="foot-box" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f7fbfc" style="background:#f7fbfc;border-radius:14px;border:1px solid #e1edf1;">
              <tr><td align="center" class="foot-txt" style="padding:20px 22px;color:#7d929d;font-size:12px;line-height:19px;text-align:center;">
                <a href="https://${SITE}" style="color:#0f5671;font-weight:700;text-decoration:none;font-size:13px;">${SITE}</a>
                <div style="padding-top:8px;">${year} &copy; creWin &middot; ${T.footerText}</div>
                <div style="padding-top:8px;"><a href="${unsubscribeUrl}" class="foot-txt" style="color:#9aabb5;text-decoration:underline;">${T.unsubText}</a></div>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject: T.subject, html };
}

/**
 * Bir doluluk bucket'ı için e-posta konu + HTML gövde üretir.
 * AI sadece metni yazar (başlık, paragraflar, madde listesi, buton metni) —
 * görsel tasarım renderEmailTemplate() ile sabit, markalı bir şablona oturtulur.
 * @param {'zero'|'low'|'mid'} bucket
 * @param {{ count: number }} bucketStats — o bucket'taki kişi sayısı (bağlam için)
 * @param {object} stats — platform stats (seafarers, jobs, businesses)
 * @param {string} language — dil kodu ('tr','en',...) veya {@link resolveLanguageFromNationality} çıktısı
 * @returns {{ subject: string, html: string }}
 */
async function generateReactivationEmail(bucket, bucketStats, stats, language) {
  const msg = BUCKET_TO_MESSAGE[bucket] || BUCKET_TO_MESSAGE.zero;
  const target = LANGUAGE_BY_CODE[language] || (language === 'tr' ? LANGUAGE_BY_CODE.tr : LANGUAGE_BY_CODE.en);
  const lang = target.code;
  const langLine = `LANGUAGE: Write ONLY in ${target.name}. Do not mix in other languages.`;

  const prompt = `
Sen crewinjob.com'un seafarer aktivasyon uzmanısın — denizcilik sektörünü, işe alım filtrelerini ve
STCW/COC belge mantığını iyi bilen, teknik ama anlaşılır bir üslupla yazan bir uzman gibi davran.
${langLine}
SADECE DÜZ METİN yaz — HTML, markdown, madde imi karakteri KULLANMA. Format aşağıda verilmiştir, sadece o alanları doldur.

SEGMENT: "${msg.label}" (${bucketStats.count} kişilik grup)
NEDEN ÖNEMLİ: ${msg.why}
PLATFORM: ${stats.seafarers} toplam seafarer, ${stats.jobs} aktif ilan.

BU SEGMENT İÇİN ÖZEL STRATEJİ (bu talimatlara öncelik ver):
${msg.strategy}

TON — TEKNİK VE MEKANİZMA ODAKLI:
- Şirketlerin filtreleme mantığını somut anlat: rank, vessel type, sea time, STCW/COC gibi alanlar
  boşsa aday havuzunda görünmezsin — bunu "eksik form" değil "arama filtresi" olarak çerçevele.
- Jenerik motivasyon dilinden kaçın; spesifik denizcilik terminolojisi kullan.

DİL KALİTESİ (EN ÖNEMLİ KURAL):
- Her cümle ${target.name} dilinde DİLBİLGİSİ AÇISINDAN TAM ve DOĞAL olmalı.
- Özne–yüklem uyumu, ek ve tamlama doğruluğu şart. Uydurma terim kullanma.
- Denizcilik terimlerini doğal cümle içinde kullan; terim yığını oluşturma.

KURALLAR:
- Suçlayıcı olma ("unutmuşsun", "ihmal etmişsin" YASAK).
- Somut sayı kullan (ör. "${stats.jobs} aktif ilan"), belirsiz nicelik YASAK.
- HEADLINE: max 8 kelime, tek başına anlamlı.
- PARAGRAPH1/PARAGRAPH2: her biri 2 tam cümle, toplam 60-100 kelime. En az biri mekanizmayı açıklasın.
- BULLET1/2/3: her biri 5-9 kelime, somut eylem veya sonuç bildirsin.
- CTA: max 4 kelime, emir kipiyle (ör. "CV Yükle, Başla").
- STAT: max 8 kelime, mutlaka sayı içersin (ör. "${stats.jobs} aktif ilan yayında"). Nokta koyma.

Çıktıyı TAM OLARAK şu formatta ver, başka hiçbir şey ekleme:

SUBJECT: [konu satırı, max 60 karakter, emoji kullanma]
HEADLINE: [...]
PARAGRAPH1: [...]
PARAGRAPH2: [...]
BULLET1: [...]
BULLET2: [...]
BULLET3: [...]
CTA: [...]
STAT: [...]
`;

  const response = await client.messages.create({
    model: 'gemini-2.5-flash',
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  const field = (name, fallback) => {
    const m = raw.match(new RegExp(`${name}:\\s*(.+)`));
    return m ? m[1].trim() : fallback;
  };

  const fallbackSubject = lang === 'tr' ? 'Profilini tamamla, işe hazır ol' : 'Complete your profile, get ready to hire';
  const subject    = field('SUBJECT', fallbackSubject);
  const headline   = field('HEADLINE', fallbackSubject);
  const paragraphs = [field('PARAGRAPH1', ''), field('PARAGRAPH2', '')].filter(Boolean);
  const bullets     = [field('BULLET1', ''), field('BULLET2', ''), field('BULLET3', '')].filter(Boolean);
  const ctaText     = field('CTA', msg.cta.replace(' →', ''));
  const statLabel   = field('STAT', '');

  const html = renderEmailTemplate({ headline, paragraphs, bullets, ctaText, statLabel, lang });

  return { subject, html, ctaPath: msg.ctaPath || '/account/login' };
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
  generateReactivationEmail,
  quickRetentionMessage,
  RETENTION_MESSAGES,
  resolveLanguageFromNationality,
  LANGUAGE_BY_CODE,
  renderEmailTemplate,
  renderJobMatchEmail,
};
