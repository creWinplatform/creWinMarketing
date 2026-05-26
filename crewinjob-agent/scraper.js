// ─── crewinjob.com İlan Çekici ────────────────────────────────────────────────
const fetch  = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const config = require('./config');

// Gerçek API endpoint'leri — geliştirici ekibinden alınacak
// Şimdilik public sayfa parse + fallback sample data kullanıyoruz
const API_ENDPOINTS = {
  jobs:  `${config.site.url}/api/jobs`,
  stats: `${config.site.url}/api/stats`,
};

// ─── Public sayfadan ilan başlıklarını çek ────────────────────────────────────
async function scrapePublicJobs() {
  try {
    const res  = await fetch(config.site.url, { timeout: 10000 });
    const html = await res.text();

    // Sayısal istatistikleri çek
    const seafarerMatch = html.match(/(\d[\d,]+)\+?\s*<\/?\w*>\s*Seafarers/i);
    const jobsMatch     = html.match(/(\d[\d,]+)\+?\s*<\/?\w*>\s*Jobs/i);
    const mbMatch       = html.match(/(\d[\d,]+)\+?\s*<\/?\w*>\s*Maritime\s*Business/i);

    return {
      stats: {
        seafarers: seafarerMatch ? seafarerMatch[1] : '15,000+',
        jobs:      jobsMatch     ? jobsMatch[1]     : '250+',
        businesses: mbMatch      ? mbMatch[1]       : '50+',
      }
    };
  } catch (err) {
    return { stats: { seafarers: '15,000+', jobs: '250+', businesses: '50+' } };
  }
}

// ─── API'den ilanları çek (gerçek entegrasyon için) ───────────────────────────
async function fetchJobsFromAPI() {
  try {
    const res  = await fetch(API_ENDPOINTS.jobs, { timeout: 8000 });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    return data.jobs || data.data || [];
  } catch {
    return null; // API yoksa sample data kullan
  }
}

// ─── Sample ilanlar (API hazır olmadan önce) ──────────────────────────────────
function getSampleJobs() {
  return [
    {
      id: 1,
      title: 'Chief Officer',
      vesselType: 'Bulk Carrier',
      company: 'Gizli Şirket',
      location: 'Worldwide',
      salary: '$6,500 - $7,200/mo',
      contractDuration: '4+1 ay',
      joinDate: '2026-05-01',
      requirements: ['COC II/2', '3 yıl Chief Officer deneyimi', 'English B2'],
      isNew: true,
    },
    {
      id: 2,
      title: '2nd Engineer',
      vesselType: 'Chemical Tanker',
      company: 'Avrupa Armatörü',
      location: 'Europe/Far East',
      salary: '$5,800 - $6,400/mo',
      contractDuration: '5+2 ay',
      joinDate: '2026-04-15',
      requirements: ['COC III/2', 'Chemical tanker deneyimi', 'STCW 2010'],
      isNew: true,
    },
    {
      id: 3,
      title: 'Master',
      vesselType: 'Container Ship',
      company: 'Büyük Konteyner Hattı',
      location: 'Asia-Europe',
      salary: '$9,000 - $11,000/mo',
      contractDuration: '3+1 ay',
      joinDate: '2026-06-01',
      requirements: ['COC II/2 Master', '5 yıl Master deneyimi', 'ECDIS'],
      isNew: false,
    },
    {
      id: 4,
      title: 'Bosun (Başçavuş)',
      vesselType: 'Offshore Supply Vessel',
      company: 'Offshore Operatörü',
      location: 'North Sea',
      salary: '$3,200 - $3,800/mo',
      contractDuration: '6+3 ay',
      joinDate: '2026-05-15',
      requirements: ['BOSIET', 'Offshore deneyimi', 'Fiziksel uygunluk'],
      isNew: true,
    },
    {
      id: 5,
      title: 'Electrical Officer',
      vesselType: 'Cruise Ship',
      company: 'Kruvaziyer Şirketi',
      location: 'Caribbean / Mediterranean',
      salary: '$4,500 - $5,200/mo',
      contractDuration: '7+2 ay',
      joinDate: '2026-05-20',
      requirements: ['Elektrik mühendisi', 'PMS deneyimi', 'Cruise deneyimi tercih'],
      isNew: false,
    },
  ];
}

// ─── Ana fonksiyon ────────────────────────────────────────────────────────────
async function getJobData() {
  console.log('  📡 crewinjob.com\'dan veri çekiliyor...');

  const [apiJobs, publicData] = await Promise.all([
    fetchJobsFromAPI(),
    scrapePublicJobs(),
  ]);

  const jobs = apiJobs || getSampleJobs();

  console.log(`  ✅ ${jobs.length} ilan, ${publicData.stats.seafarers} seafarer verisi hazır`);

  return {
    jobs,
    stats:   publicData.stats,
    newJobs: jobs.filter(j => j.isNew),
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { getJobData, getSampleJobs };
