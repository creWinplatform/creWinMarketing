// ─── crewinjob Marketing Agent — Konfigürasyon ───────────────────────────────
module.exports = {
  site: {
    url: 'https://crewinjob.com',
    name: 'crewinjob',
    slogan: 'The Right Job, The Right Talent',
    description: 'AI-powered maritime recruitment platform connecting seafarers with the right opportunities worldwide.',
  },

  brand: {
    tone: 'Profesyonel ama sıcak. Denizcilik sektörünü derinden bilen bir rehber gibi konuş. Jargon kullan ama açıkla. Seafarer\'lara saygılı ve motive edici ol.',
    hashtags: {
      core:      ['#crewinjob', '#maritime', '#seafarer', '#merchantnavy'],
      jobs:      ['#maritimejobs', '#seafarerjobs', '#shippingjobs', '#nautical'],
      career:    ['#maritimecareer', '#seamanlife', '#shiplife', '#oceanlife'],
      turkish:   ['#denizciilanları', '#gemiadamı', '#denizcilik', '#denizcikariyer'],
      tiktok:    ['#maritimetok', '#seafarerlife', '#shiplife', '#fyp', '#maritime'],
    },
    emojis: {
      anchor: '⚓', ship: '🚢', globe: '🌍', star: '⭐', fire: '🔥',
      chart: '📈', check: '✅', wave: '🌊', compass: '🧭', bell: '🔔',
    }
  },

  platforms: {
    instagram: {
      enabled: true,
      maxChars: 2200,
      hashtagCount: 20,
      contentTypes: ['ilan_ozeti', 'kariyer_ipucu', 'platform_tanitim', 'istatistik', 'motivasyon'],
      imageRatio: '1:1 veya 4:5',
      notes: 'Görsel açıklama ekle. Stories için ayrı kısa versiyon.',
    },
    facebook: {
      enabled: true,
      maxChars: 63206,
      hashtagCount: 5,
      contentTypes: ['ilan_ozeti', 'blog_paylasim', 'topluluk_sorusu', 'istatistik'],
      notes: 'Uzun form içerik iyi performans gösterir. Soru sorarak engagement artır.',
    },
    twitter: {
      enabled: true,
      maxChars: 280,
      hashtagCount: 2,
      contentTypes: ['ilan_ozeti', 'hizli_ipucu', 'istatistik', 'duyuru'],
      notes: 'Thread formatı kullan uzun içerikler için. CTA zorunlu.',
    },
    linkedin: {
      enabled: true,
      maxChars: 3000,
      hashtagCount: 5,
      contentTypes: ['ilan_ozeti', 'sektor_analizi', 'kariyer_ipucu', 'platform_tanitim', 'basari_hikayesi'],
      notes: 'Kişisel ve samimi ton. İlk 2 satır click-worthy olmalı.',
    },
    tiktok: {
      enabled: true,
      maxChars: 2200,
      hashtagCount: 8,
      contentTypes: ['video_script', 'ilan_tanitim', 'kariyer_ipucu', 'gemi_hayati'],
      notes: 'Video script yaz. Hook ilk 3 saniyede olmalı. Trend ses öner.',
      videoFormats: ['15 saniye', '30 saniye', '60 saniye'],
    }
  },

  contentCalendar: {
    weeklySchedule: {
      monday:    { platform: 'linkedin',  type: 'ilan_ozeti',      note: 'Haftanın ilanları' },
      tuesday:   { platform: 'instagram', type: 'kariyer_ipucu',   note: 'Kariyer ipucu' },
      wednesday: { platform: 'twitter',   type: 'istatistik',       note: 'Sektör istatistiği' },
      thursday:  { platform: 'tiktok',    type: 'video_script',    note: 'Video script' },
      friday:    { platform: 'facebook',  type: 'topluluk_sorusu', note: 'Hafta sonu sorusu' },
      saturday:  { platform: 'instagram', type: 'motivasyon',      note: 'Denizci motivasyon' },
      sunday:    { platform: 'linkedin',  type: 'sektor_analizi',  note: 'Pazar analizi' },
    }
  },

  output: {
    dir: './output',
    formats: ['markdown', 'json'],
  }
};
