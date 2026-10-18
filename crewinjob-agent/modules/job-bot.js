'use strict';
const fs   = require('fs');
const path = require('path');

const { writeJsonAtomic } = require('./json-file');

// Config: process.env > .userbot-config.json > .env (dotenvx bypass) — bkz. agent-config.js
require('./agent-config').loadAgentConfig();

const BASE     = (process.env.CREWINJOB_API_URL      || 'https://api.crewin.org').replace(/\/$/, '');
const USERNAME =  process.env.CREWINJOB_API_USERNAME || '';
const PASSWORD =  process.env.CREWINJOB_API_PASSWORD || '';
const GEMINI   =  process.env.GEMINI_API_KEY         || '';

const QUEUE_FILE = path.join(__dirname, '..', 'job-queue.json');

// ── Token cache ───────────────────────────────────────────────────────────────
let _token = null, _tokenExpiry = 0, _loginPromise = null;

async function login() {
  const res = await fetch(`${BASE}/api/TokenAuth/Authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ userNameOrEmailAddress: USERNAME, password: PASSWORD }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Login HTTP ${res.status}`);
  const data   = await res.json();
  const result = data.result || data;
  if (!result?.accessToken) throw new Error('accessToken yok');
  _token       = result.accessToken;
  _tokenExpiry = Date.now() + (result.expireInSeconds || 86400) * 1000 - 60000;
  return _token;
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  if (_loginPromise) return await _loginPromise;
  _loginPromise = login().finally(() => { _loginPromise = null; });
  return await _loginPromise;
}

async function callGet(endpoint, params = {}) {
  const token = await getToken();
  const url   = new URL(`${BASE}/api/services/app/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`GET ${endpoint} → HTTP ${res.status}`);
  const json = await res.json();
  return json?.result !== undefined ? json.result : json;
}

async function callPost(endpoint, body) {
  const token = await getToken();
  const res   = await fetch(`${BASE}/api/services/app/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let txt = ''; try { txt = await res.text(); } catch {}
    // Tam hata detayını ayrıca logla
    try {
      const errObj = JSON.parse(txt);
      const details = errObj?.error?.details || errObj?.error?.message || '';
      if (details) console.error(`[API VALIDATION] ${endpoint}:`, details);
    } catch {}
    throw new Error(`POST ${endpoint} → HTTP ${res.status}${txt ? ' | ' + txt.slice(0, 800) : ''}`);
  }
  const json = await res.json();
  return json?.result !== undefined ? json.result : json;
}

// ── Lookup veriler ────────────────────────────────────────────────────────────
async function fetchPositions() {
  try {
    const raw = await callGet('Pozisyon/GetAll', { MaxResultCount: 200 });
    return (raw?.items || [])
      .map(i => ({
        id:     i.pozisyon.id,
        name:   i.pozisyon.name,
        trName: i.pozisyon.trName || i.pozisyon.name,
        order:  i.pozisyon.ordinalNumber || 99,
      }))
      .sort((a, b) => a.order - b.order);
  } catch { return []; }
}

async function fetchLanguages() {
  try {
    const raw = await callGet('Dil/GetAll', { MaxResultCount: 200 });
    return (raw?.items || []).map(i => ({ id: i.dil.id, name: i.dil.name })).sort((a,b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

async function fetchCertificates() {
  try {
    const raw = await callGet('SertifikaAd/GetAll', { MaxResultCount: 200 });
    return (raw?.items || []).map(i => ({ id: i.sertifikaAd.id, name: i.sertifikaAd.name })).sort((a,b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

async function fetchCities(countryId) {
  try {
    const raw = await callGet('UlkeSehir/GetAll', { MaxResultCount: 500, countryId });
    return (raw?.items || []).map(i => ({
      id:   i.ulkeSehir.cityId,
      name: i.ulkeSehir.cityName,
    })).sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

async function fetchCompanies() {
  try {
    const raw = await callGet('FirmaGenel/GetAll', { MaxResultCount: 300 });
    return (raw?.items || []).map(i => ({
      id:      i.firmaGenel.id,
      name:    i.firmaGenel.companyName || '—',
      country: i.firmaGenel.countryName || '',
      email:   i.firmaGenel.email || '',
    })).sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

async function fetchCountries() {
  try {
    const raw = await callGet('Ulke/GetAll', { MaxResultCount: 300 });
    return (raw?.items || []).map(i => ({
      id:   i.ulke.id,
      name: i.ulke.name,
      tr:   i.ulke.trName || i.ulke.name,
    }));
  } catch { return []; }
}

// ── AI parse ──────────────────────────────────────────────────────────────────
const POSITIONS_FOR_PROMPT = [
  'Master','Chief Mate','Second Mate','Third Mate','Deck Officer','Navigation Officer',
  'Chief Eng.','Second Eng.','Third Eng.','Fourth Eng.','Junior Eng.',
  'ETO','Electrician','Electrical Eng.','Engine Cadet','Deck Cadet',
  'Boatswain','Able Seaman','Ordinary Seaman','Fitter','Motorman','Oiler','Wiper',
  'Cook','Chef','Executive Chef','Sole Chef','Crew Chef','Pastry Chef',
  'Steward','Chief Steward','2nd Steward','Catering Officer','Purser',
  'Pumpman','Donkeyman','Crane Operator','Welder','AB/Welder','Painter','Carpenter',
  'Gas Engineer','Refrigeration Eng.','Safety Officer','OOW',
  'Guest Service','Personal Assistant','Security Officer','Deckhand','Land Based','Other',
];

async function parseJobWithAI(rawText) {
  if (!GEMINI) throw new Error('GEMINI_API_KEY tanımlı değil — .env dosyasını kontrol et');

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Maritime job parser. Extract structured data. Return ONLY valid JSON.

POSITIONS (pick closest): ${POSITIONS_FOR_PROMPT.join(' | ')}
Abbrevs: Master/Capt→Master, C/O→Chief Mate, 2/O→Second Mate, 3/O→Third Mate, C/E→Chief Eng., 2/E→Second Eng., 3/E→Third Eng., 4/E→Fourth Eng., ETO→ETO, BSN/Bosun→Boatswain, AB→Able Seaman, OS→Ordinary Seaman, OOW→OOW
VACANCY TABLES: extract EACH ROW as separate job object.

SHIP TYPES: Bulk Carrier|Container Vessel|Oil Tanker|Chemical Tanker|LNG/LPG Tanker|Product Tanker|General Cargo Vessel|Ro-Ro Vessel|Passenger/Cruise Ship|Tug|Platform|Yacht|Other
SALARY: numbers only. "3,000"→3000, "3K"→3000. Currency: USD|EUR|TL|GBP|RMB|JPY|INR|RUB (default USD).
CONTRACT: map to nearest of 2+/-1|3+/-1|4+/-1|5+/-1|6+/-1|7+/-1|8+/-1 mon. Null if not mentioned.
COUNTRY: full English name. UAE/Dubai→United Arab Emirates, KSA→Saudi Arabia, UK→United Kingdom, RF→Russia, PH→Philippines, SG→Singapore.
EXPLANATION: professional summary in original language, max 400 chars, no contacts/links.
DATES: today=${today}, format YYYY-MM-DD, past dates→null.

Not a job posting → {"isJob": false}
Job(s) → {"isJob": true, "jobs": [{"positionName":"","shipType":"","country":null,"contractType":null,"currency":"USD","minPrice":null,"maxPrice":null,"email":null,"explanation":"","startDate":null,"expirationDate":null}]}

TEXT:
${rawText.slice(0, 1200)}`;

  // Mevcut ai-client.js fallback'li wrapper'ı kullan (latest alias → 2.5-flash-lite → 2.5-flash → 2.0-flash)
  const ai = require('../ai-client');
  const resp = await ai.messages.create({
    messages: [{ role: 'user', content: prompt }],
  });
  const text  = resp?.content?.[0]?.text?.trim() || '';
  const clean = text.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    if (!parsed) throw new Error(`Gemini yanıtı JSON değil: ${clean.slice(0, 200)}`);
  }

  // İlan değil (spam / duyuru)
  if (parsed.isJob === false) return { isJob: false };

  // jobs array formatı (yeni) — ya da geriye dönük uyum için tek obje formatı (eski)
  let rawJobs;
  if (Array.isArray(parsed.jobs)) {
    rawJobs = parsed.jobs;
  } else if (parsed.positionName) {
    rawJobs = [parsed]; // eski format: doğrudan job objesi
  } else {
    rawJobs = [parsed]; // bilinmeyen format: dene
  }

  // Her job için ID resolve et
  const jobs = await Promise.all(
    rawJobs.filter(j => j && typeof j === 'object').map(j => resolveJobDataIds(j))
  );
  return { isJob: true, jobs };
}

// ── İsim → ID dönüşümü ──────────────────────────────────────────────────────
// AI metin döndürür ("Chief Eng.", "Bulk Carrier"...). Crewinjob API ID bekler.
// Frontend bunu kendi yapıyordu; pipeline için burada merkezi olarak çözüyoruz.
const SHIP_TYPES_MAP = [
  { id: 1, name: 'Bulk Carrier' }, { id: 2, name: 'General Cargo Vessel' },
  { id: 3, name: 'Container Vessel' }, { id: 5, name: 'Ro-Ro Vessel' },
  { id: 6, name: 'Oil Tanker' }, { id: 7, name: 'Product Tanker' },
  { id: 8, name: 'Chemical Tanker' }, { id: 9, name: 'LNG/LPG Tanker' },
  { id: 10, name: 'Passenger/Cruise Ship' }, { id: 11, name: 'Multi-Purpose Vessel' },
  { id: 12, name: 'Livestock Carrier' }, { id: 13, name: 'Heavy-lift/Project Cargo Vessel' },
  { id: 14, name: 'Fishing Vessel' }, { id: 15, name: 'Tug' },
  { id: 16, name: 'Platform' }, { id: 17, name: 'Yacht' }, { id: 18, name: 'Other' },
];
const CONTRACT_TYPES_MAP = [
  { id: 1, name: '2+/-1 mon.' }, { id: 2, name: '3+/-1 mon.' }, { id: 3, name: '4+/-1 mon.' },
  { id: 4, name: '5+/-1 mon.' }, { id: 5, name: '6+/-1 mon.' }, { id: 6, name: '7+/-1 mon.' },
  { id: 7, name: '8+/-1 mon.' },
];
const CURRENCIES_MAP = [
  { id: 1, name: 'USD' }, { id: 2, name: 'EUR' }, { id: 3, name: 'TL' }, { id: 4, name: 'GBP' },
  { id: 5, name: 'RMB' }, { id: 6, name: 'JPY' }, { id: 7, name: 'INR' }, { id: 8, name: 'RUB' },
];

// Noktalama/tire/slash normalize eder: "Chief Eng." → "chief eng", "2/E" → "2 e"
function normStr(s) {
  return String(s || '').toLowerCase().replace(/[.\-\/\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchByName(text, options) {
  if (!text) return undefined;
  const lo  = String(text).toLowerCase().trim();
  const nlo = normStr(text);
  return (
    options.find(o => (o.name || '').toLowerCase() === lo) ||
    options.find(o => (o.trName || o.tr || '').toLowerCase() === lo) ||
    options.find(o => normStr(o.name) === nlo) ||
    options.find(o => normStr(o.trName || o.tr || '') === nlo) ||
    options.find(o => (o.name || '').toLowerCase().includes(lo)) ||
    options.find(o => lo.includes((o.name || '').toLowerCase()) && (o.name || '').length > 3)
  );
}

// Ülke ismi normalizasyonu — yaygın kısaltma/bayrak ifadelerini tam isme çevirir
const COUNTRY_ALIASES = {
  'uae': 'United Arab Emirates', 'u.a.e': 'United Arab Emirates', 'u.a.e.': 'United Arab Emirates',
  'emirates': 'United Arab Emirates', 'adnoc': 'United Arab Emirates',
  'abu dhabi': 'United Arab Emirates', 'dubai': 'United Arab Emirates', 'sharjah': 'United Arab Emirates',
  'ksa': 'Saudi Arabia', 'k.s.a': 'Saudi Arabia', 'saudi': 'Saudi Arabia',
  'aramco': 'Saudi Arabia', 'jubail': 'Saudi Arabia', 'dammam': 'Saudi Arabia',
  'uk': 'United Kingdom', 'u.k': 'United Kingdom', 'u.k.': 'United Kingdom',
  'britain': 'United Kingdom', 'great britain': 'United Kingdom',
  'england': 'United Kingdom', 'scotland': 'United Kingdom', 'wales': 'United Kingdom',
  'usa': 'United States', 'u.s.a': 'United States', 'u.s.a.': 'United States',
  'us': 'United States', 'america': 'United States',
  'rf': 'Russia', 'russian federation': 'Russia',
  'holland': 'Netherlands', 'dutch': 'Netherlands', 'nederland': 'Netherlands',
  'hellas': 'Greece', 'hellenic': 'Greece',
  'ph': 'Philippines', 'phils': 'Philippines', 'philippines flag': 'Philippines',
  'sg': 'Singapore', 'singapore flag': 'Singapore',
  'russia flag': 'Russia', 'russian flag': 'Russia',
  'netherlands flag': 'Netherlands', 'dutch flag': 'Netherlands',
  'uk flag': 'United Kingdom', 'british flag': 'United Kingdom',
  'turkish flag': 'Turkey', 'turkey flag': 'Turkey',
  'greek flag': 'Greece', 'greece flag': 'Greece',
  'panama flag': 'Panama', 'marshall islands flag': 'Marshall Islands',
  'liberia flag': 'Liberia', 'liberian flag': 'Liberia',
  'bahamas flag': 'Bahamas', 'bahamian flag': 'Bahamas',
  'cyprus flag': 'Cyprus', 'cypriot flag': 'Cyprus',
  'indonesia flag': 'Indonesia', 'indonesian flag': 'Indonesia',
};

function normalizeCountry(raw) {
  if (!raw) return null;
  const lo = String(raw).toLowerCase().trim();
  if (COUNTRY_ALIASES[lo]) return COUNTRY_ALIASES[lo];
  // "X flag" → X (e.g. "Ukraine flag" → "Ukraine")
  const flagMatch = lo.match(/^(.+?)\s+flag$/);
  if (flagMatch) {
    const base = flagMatch[1].trim();
    return COUNTRY_ALIASES[base] || (base.charAt(0).toUpperCase() + base.slice(1));
  }
  return raw;
}

// Pozisyon ismi normalizasyonu — AI farklı varyant döndürebilir, canonical isme çevirir
const POSITION_ALIASES = {
  // Deck Officers
  'chief officer': 'Chief Mate', 'first officer': 'Chief Mate', '1st officer': 'Chief Mate',
  'c/o': 'Chief Mate', 'ch.mate': 'Chief Mate', 'ch. mate': 'Chief Mate',
  'chief mate': 'Chief Mate', 'baş zabit': 'Chief Mate',
  'second officer': 'Second Mate', '2nd officer': 'Second Mate', '2/o': 'Second Mate',
  'second mate': 'Second Mate', '2nd mate': 'Second Mate', 'ikinci zabit': 'Second Mate',
  'third officer': 'Third Mate', '3rd officer': 'Third Mate', '3/o': 'Third Mate',
  'third mate': 'Third Mate', '3rd mate': 'Third Mate', 'üçüncü zabit': 'Third Mate',
  'navigation officer': 'Navigation Officer', 'nav officer': 'Navigation Officer',
  'deck officer': 'Deck Officer', 'ooW': 'OOW', 'oow': 'OOW',
  // Engineers
  'chief engineer': 'Chief Eng.', 'c/e': 'Chief Eng.', 'ce': 'Chief Eng.',
  'chief eng': 'Chief Eng.', 'başmakinist': 'Chief Eng.',
  'second engineer': 'Second Eng.', '2nd engineer': 'Second Eng.', '2/e': 'Second Eng.',
  'second eng': 'Second Eng.', 'ikinci makinist': 'Second Eng.',
  'third engineer': 'Third Eng.', '3rd engineer': 'Third Eng.', '3/e': 'Third Eng.',
  'third eng': 'Third Eng.',
  'fourth engineer': 'Fourth Eng.', '4th engineer': 'Fourth Eng.', '4/e': 'Fourth Eng.',
  'fourth eng': 'Fourth Eng.', 'junior engineer': 'Junior Eng.',
  'electro technical officer': 'ETO', 'electrical officer': 'ETO', 'elec. officer': 'ETO',
  'electrician': 'Electrician', 'electrical engineer': 'Electrical Eng.',
  // Ratings
  'bosun': 'Boatswain', 'bsn': 'Boatswain', 'boatswain': 'Boatswain',
  'able seaman': 'Able Seaman', 'able bodied seaman': 'Able Seaman', 'ab': 'Able Seaman',
  'ordinary seaman': 'Ordinary Seaman', 'os': 'Ordinary Seaman',
  'motorman': 'Motorman', 'motorcu': 'Motorman',
  'oiler': 'Oiler', 'yağcı': 'Oiler',
  'fitter': 'Fitter', 'tamirci': 'Fitter',
  'wiper': 'Wiper',
  // Catering
  'cook': 'Cook', 'aşçı': 'Cook', 'juru masak': 'Cook',
  'chief cook': 'Chef', 'executive chef': 'Executive Chef',
  'sole chef': 'Sole Chef', 'crew chef': 'Crew Chef',
  'steward': 'Steward', 'chief steward': 'Chief Steward',
  'catering officer': 'Catering Officer', 'purser': 'Purser',
  // Other
  'captain': 'Master', 'capt': 'Master', 'kaptan': 'Master',
  'pumpman': 'Pumpman', 'donkeyman': 'Donkeyman',
  'crane operator': 'Crane Operator', 'welder': 'Welder', 'painter': 'Painter',
  'carpenter': 'Carpenter', 'deckhand': 'Deckhand',
  'gas engineer': 'Gas Engineer', 'refrigeration engineer': 'Refrigeration Eng.',
  'ref engineer': 'Refrigeration Eng.', 'refrigeration eng': 'Refrigeration Eng.',
  'safety officer': 'Safety Officer', 'security officer': 'Security Officer',
  'deck cadet': 'Deck Cadet', 'engine cadet': 'Engine Cadet',
  'cadet (deck)': 'Deck Cadet', 'cadet (engine)': 'Engine Cadet',
  'land based': 'Land Based',
};

function normalizePosition(raw) {
  if (!raw) return raw;
  const lo = String(raw).toLowerCase().trim();
  return POSITION_ALIASES[lo] || raw;
}

// Lookup cache (tek pipeline çalışmasında tekrar tekrar API çağrısını önler)
let _posCache = null, _countryCache = null, _lookupCachedAt = 0;
const LOOKUP_TTL = 10 * 60 * 1000; // 10 dakika

async function getLookups() {
  if (_posCache && _countryCache && Date.now() - _lookupCachedAt < LOOKUP_TTL) {
    return { positions: _posCache, countries: _countryCache };
  }
  _posCache       = await fetchPositions();
  _countryCache   = await fetchCountries();
  _lookupCachedAt = Date.now();
  if (!_posCache.length) console.warn('[job-bot] fetchPositions boş döndü — API erişim sorunu olabilir');
  return { positions: _posCache, countries: _countryCache };
}

async function resolveJobDataIds(jobData) {
  if (!jobData || typeof jobData !== 'object') return jobData;
  const { positions, countries } = await getLookups();

  const posOpt   = matchByName(normalizePosition(jobData.positionName), positions);
  const countOpt = matchByName(normalizeCountry(jobData.country),       countries);
  const shipOpt  = matchByName(jobData.shipType,     SHIP_TYPES_MAP);
  const ctOpt    = matchByName(jobData.contractType, CONTRACT_TYPES_MAP);
  const curOpt   = matchByName(jobData.currency,     CURRENCIES_MAP);

  // ID alanları (API DTO için)
  jobData.positionId     = posOpt?.id   ?? null;
  jobData.countryId      = countOpt?.id ?? null;
  jobData.shipTypeId     = shipOpt?.id  ?? null;
  jobData.contractTypeId = ctOpt?.id    ?? null;
  jobData.currencyId     = curOpt?.id   ?? (jobData.currency ? 1 : null); // varsayılan USD

  // Display alanları (broadcast & UI için)
  jobData._positionName = posOpt?.name   || jobData.positionName || '';
  jobData._countryName  = countOpt?.name || jobData.country      || '';
  jobData._shipTypeName = shipOpt?.name  || jobData.shipType     || '';
  jobData._contractName = ctOpt?.name    || jobData.contractType || '';
  jobData._currencyName = curOpt?.name   || jobData.currency     || '';

  return jobData;
}

// ── AI ile sıfırdan ilan üret (metin verilmeden) ──────────────────────────────
const SHIP_TYPES_FOR_PROMPT = [
  'Bulk Carrier','General Cargo Vessel','Container Vessel','Ro-Ro Vessel','Oil Tanker',
  'Product Tanker','Chemical Tanker','LNG/LPG Tanker','Passenger/Cruise Ship',
  'Multi-Purpose Vessel','Livestock Carrier','Heavy-lift/Project Cargo Vessel',
  'Fishing Vessel','Tug','Platform','Yacht','Other',
];

async function generateJobWithAI(hint = '') {
  if (!GEMINI) throw new Error('GEMINI_API_KEY tanımlı değil — .env dosyasını kontrol et');

  // Her seferinde farklı ilan üretmek için rastgele tohum
  const seedPos  = POSITIONS_FOR_PROMPT[Math.floor(Math.random() * POSITIONS_FOR_PROMPT.length)];
  const seedShip = SHIP_TYPES_FOR_PROMPT[Math.floor(Math.random() * SHIP_TYPES_FOR_PROMPT.length)];

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Sen denizcilik sektöründe gerçekçi iş ilanları üreten bir asistansın.
Bugünün tarihi: ${today}. Tüm tarihler bu tarihten SONRA olmalı.
Dünyadaki gerçek denizcilik iş ilanlarına uygun, crewinjob.com yapısına uygun YENİ bir iş ilanı oluştur.
${hint ? `Kullanıcı isteği/ipucu: "${hint}"\n` : `Öneri: pozisyon "${seedPos}", gemi tipi "${seedShip}" civarında olabilir ama serbestsin.\n`}
Pozisyon için MUTLAKA şu listeden birini seç: ${POSITIONS_FOR_PROMPT.join(', ')}

Gerçekçi maaş aralıkları kullan (rütbeye göre): Master/Chief Eng. 8000-13000 USD, Chief Mate/2nd Eng. 5000-8000 USD, junior rütbeler 1500-4000 USD gibi.
Açıklama profesyonel İngilizce olsun, sertifika gereksinimleri (STCW, COC) ve sorumlulukları içersin.

Sonucu SADECE JSON olarak döndür (markdown/code block OLMADAN):
{
  "positionName": "yukarıdaki listeden pozisyon adı",
  "shipType": "${SHIP_TYPES_FOR_PROMPT.join(' | ')}",
  "country": "ülke adı (İngilizce tam adı, örn: Turkey, Greece, Panama, Singapore)",
  "contractType": "2+/-1 mon. | 3+/-1 mon. | 4+/-1 mon. | 5+/-1 mon. | 6+/-1 mon. | 7+/-1 mon. | 8+/-1 mon.",
  "currency": "USD | EUR | TL | GBP | RMB | JPY | INR | RUB",
  "minPrice": maaş minimum sayı,
  "maxPrice": maaş maksimum sayı,
  "email": "gerçekçi bir iletişim emaili (örn: crewing@oceanicship.com)",
  "explanation": "profesyonel iş tanımı açıklaması (200-500 karakter, İngilizce)",
  "startDate": "YYYY-MM-DD (${today} sonrası, 1-4 hafta içinde)",
  "expirationDate": "YYYY-MM-DD (startDate'ten 1-2 ay sonrası)"
}`;

  const ai = require('../ai-client');
  const resp = await ai.messages.create({
    messages: [{ role: 'user', content: prompt }],
  });
  const text  = resp?.content?.[0]?.text?.trim() || '';
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw new Error(`Gemini yanıtı JSON değil: ${clean.slice(0, 200)}`);
  }
}

// ── Yayın öncesi yerel doğrulama ──────────────────────────────────────────────
// API'ye göndermeden ÖNCE veriyi denetler. Amaç: bilinmeyen/bozuk formatı
// API'nin HTTP 400'üne bırakmadan yerelde yakalamak.
// Döner: { valid, errors[], warnings[] }
//   errors   → yayını ENGELLER (inceleme kuyruğuna gitmeli)
//   warnings → yayına engel değil, sadece loglanır
function validateJobData(jobData) {
  const errors = [], warnings = [];
  const isPosInt = (v) => Number.isInteger(v) && v > 0;
  const num = (v) => (v == null ? null : Number(v));

  // Kritik: pozisyon
  if (!isPosInt(jobData.positionId)) errors.push('positionId geçersiz/eksik');

  // Sayısal ID'ler — varsa pozitif tam sayı olmalı
  for (const f of ['shipTypeId', 'countryId', 'contractTypeId', 'currencyId', 'cityId', 'companyId']) {
    const v = jobData[f];
    if (v != null && !isPosInt(Number(v))) errors.push(`${f} geçersiz (${v})`);
  }

  // Maaş — varsa sonlu sayı ve mantıklı aralık
  const minP = num(jobData.minPrice), maxP = num(jobData.maxPrice);
  if (minP != null && (!Number.isFinite(minP) || minP < 0 || minP > 1_000_000))
    errors.push(`minPrice mantıksız (${jobData.minPrice})`);
  if (maxP != null && (!Number.isFinite(maxP) || maxP < 0 || maxP > 1_000_000))
    errors.push(`maxPrice mantıksız (${jobData.maxPrice})`);
  if (minP != null && maxP != null && minP > maxP)
    warnings.push(`minPrice > maxPrice (${minP} > ${maxP}) — swap edilecek`);

  // Tarihler — varsa geçerli ISO ve mantıklı
  const parseDate = (d) => (d ? new Date(d) : null);
  const sd = parseDate(jobData.startDate), ed = parseDate(jobData.expirationDate);
  if (jobData.startDate && isNaN(sd?.getTime())) errors.push(`startDate geçersiz (${jobData.startDate})`);
  if (jobData.expirationDate && isNaN(ed?.getTime())) errors.push(`expirationDate geçersiz (${jobData.expirationDate})`);
  if (sd && ed && !isNaN(sd) && !isNaN(ed) && ed < sd)
    warnings.push('expirationDate < startDate');

  // Açıklama — boş olmamalı (API çoğu zaman ister)
  if (!String(jobData.explanation || '').trim()) warnings.push('explanation boş');

  return { valid: errors.length === 0, errors, warnings };
}

// ── İlan oluşturma ────────────────────────────────────────────────────────────
// Crewinjob API'si ID tabanlı DTO bekliyor
async function createIlan(jobData) {
  // language1-5 / languageLevel1-5 / visaType1-5 / certificateNameId1-5 / endorsement1-5
  const extraFields = {};
  [1,2,3,4,5].forEach(n => {
    if (jobData[`language${n}`]          != null) extraFields[`language${n}`]          = Number(jobData[`language${n}`]);
    if (jobData[`languageLevel${n}`]     != null) extraFields[`languageLevel${n}`]     = Number(jobData[`languageLevel${n}`]);
    if (jobData[`visaType${n}`]          != null) extraFields[`visaType${n}`]          = Number(jobData[`visaType${n}`]);
    if (jobData[`certificateNameId${n}`] != null) extraFields[`certificateNameId${n}`] = Number(jobData[`certificateNameId${n}`]);
    if (jobData[`endorsement${n}`])                extraFields[`endorsement${n}`]       = String(jobData[`endorsement${n}`]);
  });

  // Maaş sanitize: min > max ise swap et
  let minP = jobData.minPrice != null ? Number(jobData.minPrice) : undefined;
  let maxP = jobData.maxPrice != null ? Number(jobData.maxPrice) : undefined;
  if (minP != null && maxP != null && minP > maxP) { const t = minP; minP = maxP; maxP = t; }

  const dto = {
    positionId:     jobData.positionId     || null,
    shipTypeId:     jobData.shipTypeId     || null,
    countryId:      jobData.countryId      || null,
    contractTypeId: jobData.contractTypeId || 5, // 5 = "6+/-1 mon." — AI bulamazsa varsayılan
    currencyId:     jobData.currencyId     || null,
    cityId:         jobData.cityId         ? Number(jobData.cityId)    : null,
    companyId:      jobData.companyId      ? Number(jobData.companyId) : null,
    minPrice:       minP,
    maxPrice:       maxP,
    email:          jobData.email          || null,
    explanation:    jobData.explanation    || null,
    startDate:      jobData.startDate      || new Date().toISOString(),
    expirationDate: jobData.expirationDate || null,
    noticeType:     1,
    jobPostingType: 0,
    ...extraFields,
  };
  const createdAt = Date.now();
  const created = await callPost('Ilan/CreateOrEdit', dto);

  // 1) CreateOrEdit yeni ID'yi döndürüyorsa onu kullan (yarışsız)
  const directId = extractCreatedId(created);
  if (directId) return { id: directId, url: `https://crewinjob.com/jobs/detail/${directId}` };

  // 2) Yedek: son ilanlar arasında BU ilanı eşleştir (pozisyon + firma + yakın zaman).
  //    Eskiden körlemesine "en son ilan" alınıyordu — paralel oluşturmada yanlış ID dönebiliyordu.
  try {
    const latest = await callGet('Ilan/GetAll', { MaxResultCount: 10, SkipCount: 0, Sorting: 'creationTime desc' });
    const match  = (latest?.items || []).find(item => isSameCreatedIlan(item, dto, jobData, createdAt));
    const id = match ? (match.ilan || match).id : null;
    if (id) return { id, url: `https://crewinjob.com/jobs/detail/${id}` };
    console.warn('[job-bot] createIlan: oluşturulan ilan son ilanlar arasında eşleştirilemedi — ID bilinmiyor');
  } catch (e) {
    console.warn(`[job-bot] createIlan: ID doğrulama sorgusu başarısız (${e.message})`);
  }
  return { id: null, url: null };
}

// CreateOrEdit sonucu: sayı (id) | { id } | { ilan: { id } } | boş
function extractCreatedId(result) {
  if (typeof result === 'number' && result > 0) return result;
  if (typeof result === 'string' && /^\d+$/.test(result)) return Number(result);
  if (result && typeof result === 'object') {
    const id = result.id ?? result.ilan?.id ?? result.ilanId;
    if (Number.isInteger(Number(id)) && Number(id) > 0) return Number(id);
  }
  return null;
}

function _norm(s) { return normStr(s).replace(/\s+/g, ''); }

// ABP tarihleri bazen saat dilimsiz gelir ("2026-10-14T10:00:00") — hem yerel hem UTC yorumu dene
function _isRecent(ts, sinceMs) {
  if (!ts) return null; // zaman bilgisi yok → bilinmiyor
  const s = String(ts);
  const candidates = [Date.parse(s)];
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) candidates.push(Date.parse(s + 'Z'));
  const windowMs = 15 * 60 * 1000;
  return candidates.some(t => Number.isFinite(t) && t >= sinceMs - windowMs && t <= Date.now() + windowMs);
}

function isSameCreatedIlan(item, dto, jobData, sinceMs) {
  const j = item?.ilan || item;
  if (!j || !j.id) return false;
  // Başlık = pozisyon
  const posOk = j.positionId != null
    ? Number(j.positionId) === Number(dto.positionId)
    : !!(j.positionName && jobData._positionName && _norm(j.positionName) === _norm(jobData._positionName));
  if (!posOk) return false;
  // Firma
  const compName = j.firmName || j.companyName || j.companyText;
  const compOk = j.companyId != null
    ? Number(j.companyId) === Number(dto.companyId)
    : compName && jobData.companyText
      ? _norm(compName) === _norm(jobData.companyText)
      : dto.companyId == null;
  if (!compOk) return false;
  // Yakın zaman (oluşturma anından itibaren)
  const recent = _isRecent(j.creationTime || j.noticeDate, sinceMs);
  return recent !== false;
}

// ── İlan sona erme güncelleme ─────────────────────────────────────────────────
// Ilan/CreateOrEdit tam DTO bekler; sadece { id, expirationDate } göndermek HTTP 500 veriyordu
// (başarılı olsa diğer alanları silebilirdi). Doğru yöntem: tam DTO'yu çek → yalnızca
// expirationDate'i değiştir → geri gönder.
// Tam DTO getter'ı (ör. ASP.NET Zero kalıbı "Ilan/GetIlanForEdit") kod tabanında/dokümanlarda
// TANIMLI DEĞİL. Backend doğrulayana kadar uzatma DEVRE DIŞI; getter teyit edilince
// CREWINJOB_ILAN_EDIT_GETTER=Ilan/GetIlanForEdit ile açılır.
class IlanExpiryUnsupportedError extends Error {
  constructor(msg) { super(msg); this.code = 'ILAN_EDIT_GETTER_MISSING'; }
}

async function updateIlanExpiry(ilanId, newExpirationDate) {
  const getter = (process.env.CREWINJOB_ILAN_EDIT_GETTER || '').trim();
  if (!getter) {
    throw new IlanExpiryUnsupportedError(
      'İlan uzatma devre dışı: tam DTO getter endpoint\'i bilinmiyor (CREWINJOB_ILAN_EDIT_GETTER tanımlı değil). ' +
      'Kısmi DTO ile Ilan/CreateOrEdit çağrılmadı.');
  }
  if (!/^Ilan\/[A-Za-z]+$/.test(getter)) {
    throw new IlanExpiryUnsupportedError(`CREWINJOB_ILAN_EDIT_GETTER geçersiz: "${getter.slice(0, 60)}"`);
  }
  const raw = await callGet(getter, { Id: ilanId });
  // ASP.NET Zero: GetXForEdit → { ilan: CreateOrEditIlanDto }
  const full = raw && typeof raw === 'object' ? (raw.ilan || raw) : null;
  if (!full || Number(full.id) !== Number(ilanId) || full.positionId == null) {
    throw new IlanExpiryUnsupportedError(`İlan #${ilanId}: ${getter} tam DTO döndürmedi — uzatma iptal (veri kaybı riski)`);
  }
  await callPost('Ilan/CreateOrEdit', { ...full, expirationDate: newExpirationDate });
}

// ── İlana gelen başvuru sayısını çek ─────────────────────────────────────────
// Doküman (context/iletisim-frontend.md "Başvuru Yönetimi"): servis adı IlanBasvuru;
// GET /IlanBasvuru/GetStatusSummary?noticeId={id} → { total, yeni, inceleniyor, ... }.
// (Eski kod var olmayan IlanApplication/GetAll'u çağırıyordu.)
async function fetchIlanApplicationCount(ilanId) {
  const summary = await callGet('IlanBasvuru/GetStatusSummary', { noticeId: ilanId });
  return typeof summary?.total === 'number' ? summary.total : 0;
}

// ── Kuyruk yönetimi ───────────────────────────────────────────────────────────
function readQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8')); } catch { return []; }
}

function writeQueue(items) {
  writeJsonAtomic(QUEUE_FILE, items);
}

function addToQueue(jobData, source = 'manual') {
  const queue = readQueue();
  const item  = {
    id:        Date.now().toString(),
    source,
    status:    'pending',
    createdAt: new Date().toISOString(),
    data:      jobData,
  };
  queue.unshift(item);
  writeQueue(queue);
  return item;
}

function updateQueueItem(id, updates) {
  const queue = readQueue();
  const idx   = queue.findIndex(i => i.id === id);
  if (idx === -1) throw new Error(`Kuyruk öğesi bulunamadı: ${id}`);
  queue[idx]  = { ...queue[idx], ...updates };
  writeQueue(queue);
  return queue[idx];
}

function removeFromQueue(id) {
  writeQueue(readQueue().filter(i => i.id !== id));
}

async function approveAndPost(id) {
  const item = readQueue().find(i => i.id === id);
  if (!item) throw new Error('Öğe bulunamadı');
  updateQueueItem(id, { status: 'posting' });
  try {
    const result = await createIlan(item.data);
    updateQueueItem(id, { status: 'posted', postedAt: new Date().toISOString(), apiResult: result });
    return result;
  } catch (e) {
    updateQueueItem(id, { status: 'error', error: e.message });
    throw e;
  }
}

module.exports = {
  fetchPositions, fetchCountries, fetchCities, fetchCompanies, fetchLanguages, fetchCertificates,
  parseJobWithAI, generateJobWithAI, createIlan, validateJobData, updateIlanExpiry, fetchIlanApplicationCount,
  extractCreatedId, isSameCreatedIlan,
  addToQueue, readQueue, updateQueueItem, removeFromQueue, approveAndPost,
};
