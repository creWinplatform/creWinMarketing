// ─── crewinjob API Module ─────────────────────────────────────────────────────
// api.crewin.org bağlantısı — ABP Framework token auth.
// Mock data YOKTUR. Tüm veriler gerçek API'den çekilir.

const BASE     = (process.env.CREWINJOB_API_URL     || 'https://api.crewin.org').replace(/\/$/, '');
const API_KEY  =  process.env.CREWINJOB_API_KEY      || '';
const USERNAME =  process.env.CREWINJOB_API_USERNAME || '';
const PASSWORD =  process.env.CREWINJOB_API_PASSWORD || '';

// ── Token cache ───────────────────────────────────────────────────────────────
var _tokenCache  = { token: null, expiresAt: 0 };
var _loginPromise = null; // mutex — paralel login yarışını önler

// ── ABP Framework login ───────────────────────────────────────────────────────
async function login() {
  var res = await fetch(BASE + '/api/TokenAuth/Authenticate', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body:    JSON.stringify({ userNameOrEmailAddress: USERNAME, password: PASSWORD }),
    signal:  AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    var t = ''; try { t = await res.text(); } catch(_) {}
    throw new Error('Login HTTP ' + res.status + (t ? ' — ' + t.slice(0, 200) : ''));
  }
  var data   = await res.json();
  var result = data.result || data;
  if (!result || !result.accessToken) throw new Error('Login yanıtında accessToken yok');
  _tokenCache.token     = result.accessToken;
  _tokenCache.expiresAt = Date.now() + (result.expireInSeconds || 86400) * 1000 - 60000;
  return result.accessToken;
}

async function getToken() {
  if (API_KEY) return API_KEY;
  if (!USERNAME || !PASSWORD) throw new Error('API kimlik bilgisi tanımlı değil (.env CREWINJOB_API_USERNAME / PASSWORD)');
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) return _tokenCache.token;
  // Mutex: devam eden login varsa onu bekle, yeni istek açma
  if (_loginPromise) return await _loginPromise;
  _loginPromise = login().finally(function() { _loginPromise = null; });
  return await _loginPromise;
}

// ── Genel fetch yardımcısı ────────────────────────────────────────────────────
async function callApi(path, params) {
  var token   = await getToken();
  var url     = new URL(BASE + '/api/services/app/' + path);
  Object.entries(params || {}).forEach(function(e) {
    if (e[1] !== undefined && e[1] !== null && e[1] !== '') url.searchParams.set(e[0], String(e[1]));
  });
  var res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
    signal:  AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    var b = ''; try { b = await res.text(); } catch(_) {}
    throw new Error(path + ' → HTTP ' + res.status + (b ? ' | ' + b.slice(0, 300) : ''));
  }
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

// ── Normalize yardımcıları ────────────────────────────────────────────────────
function toBreakdownItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(function(item, idx) {
    return {
      id:    item.id    || item.Id    || idx,
      name:  item.countryName  || item.positionName  ||
             item.name  || item.Name  || item.country || item.Country ||
             item.position || item.Position || 'Bilinmiyor',
      code:  item.code  || item.Code  || item.countryCode || item.CountryCode || undefined,
      count: item.countOfFirmaGenelRegistrations ||
             item.seafarerCount || item.SeafarerCount ||
             item.count || item.Count ||
             item.memberCount || item.MemberCount || 0,
    };
  });
}

function toCompanyItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(function(item, idx) {
    return {
      id:           item.id           || item.Id           || idx,
      name:         item.companyName  || item.CompanyName  || item.name || item.Name || 'Bilinmiyor',
      country:      item.countryName  || item.country      || item.Country || '',
      countryCode:  item.countryCode  || item.CountryCode  || '',
      registeredAt: item.registeredAt || item.RegisteredAt ||
                    item.creationTime || item.CreationTime ||
                    item.createdAt    || item.CreatedAt    || null,
      type:         item.type         || item.Type         ||
                    item.companyType  || item.CompanyType  || '',
      crewCount:    item.crewCount    || item.CrewCount     || 0,
      logo:         item.companyLogo  || item.logo          || null,
    };
  });
}

function sumDailyRegistrations(raw) {
  if (!raw || typeof raw !== 'object') return 0;
  return ['firstDay','secondDay','thirdDay','fourthDay','fifthDay','sixthDay','seventhDay']
    .reduce(function(s, k) { return s + (raw[k] || 0); }, 0);
}

function calcProfileCompletion(zero, low, mid, high) {
  var total = zero + low + mid + high;
  if (total === 0) return 0;
  return Math.round((low * 15 + mid * 45 + high * 80) / total);
}

// =============================================================================
// TEKİL ENDPOINT FONKSİYONLARI
// =============================================================================

async function getCountryWithMostGemiAdamiGenelMembersCount(count) {
  var raw = await callApi('GemiAdamiGenel/GetCountryWithMostGemiAdamiGenelMembersCount', { count: count || 1 });
  return toBreakdownItems(Array.isArray(raw) ? raw : [raw]);
}

async function getCountriesWithMostGemiAdamiGenelMembersCount(count) {
  var raw = await callApi('GemiAdamiGenel/GetCountriesWithMostGemiAdamiGenelMembersCount', { count: count || 10 });
  return toBreakdownItems(raw);
}

async function getTheTopPositionsWithHighestCountOfSeafarers(count) {
  var raw = await callApi('Pozisyon/GetTheTopPositionsWithHighestCountOfSeafarers', { count: count || 10 });
  return toBreakdownItems(raw);
}

async function getLastRegisteredCompanies(count) {
  var raw = await callApi('FirmaGenel/GetLastRegisteredCompanies', { count: count || 10 });
  return toCompanyItems(raw);
}

// =============================================================================
// BİLEŞİK FONKSİYONLAR — route handler'lar için
// =============================================================================

/** Ülke + pozisyon — /api/breakdown */
async function getBreakdownData(countCountries, countPositions) {
  var now = new Date().toISOString();
  var results = await Promise.allSettled([
    getCountriesWithMostGemiAdamiGenelMembersCount(countCountries || 10),
    getTheTopPositionsWithHighestCountOfSeafarers(countPositions || 10),
  ]);
  return {
    countries: results[0].status === 'fulfilled' ? results[0].value : [],
    positions: results[1].status === 'fulfilled' ? results[1].value : [],
    source:    'api',
    fetchedAt: now,
    errors: {
      countries: results[0].status === 'rejected' ? results[0].reason.message : null,
      positions: results[1].status === 'rejected' ? results[1].reason.message : null,
    },
  };
}

/** Son firmalar — /api/crewinjob/companies */
async function getLastCompanies(count) {
  var companies = await getLastRegisteredCompanies(count || 10);
  return { companies: companies, source: 'api', fetchedAt: new Date().toISOString() };
}

/** Tüm istatistikler — /api/stats, /api/dashboard */
async function fetchAllData() {
  var results = await Promise.allSettled([
    callApi('GemiAdamiGenel/GetTotalCountOfGemiAdamiGenel', {}),                           // [0]
    callApi('GemiAdamiGenel/GetGemiAdamiGenelWhoRegisteredInLastSevenDays', {}),           // [1]
    callApi('GemiAdamiGenel/GetCountOfUsersWithAProfileFillRateOfZero', {}),               // [2]
    callApi('GemiAdamiGenel/GetCountOfUsersWithAProfileFillRateIsBetweenZeroAndThirty', {}), // [3]
    callApi('GemiAdamiGenel/GetCountOfUsersWithAProfileFillRateIsBetweenThirtyAndSixty', {}),// [4]
    callApi('GemiAdamiGenel/GetCountOfUsersWithAProfileFillRateMoreThanSixty', {}),         // [5]
    callApi('FirmaGenel/GetTotalCountOfFirmaGenel', {}),                                   // [6]
    callApi('FirmaGenel/GetFirmaGenelWhoRegisteredInLastSevenDays', {}),                   // [7]
    callApi('Ilan/GetTotalCountOfIlan', {}),                                                // [8]
  ]);

  function val(i) { return results[i].status === 'fulfilled' ? results[i].value : null; }
  function err(i) { return results[i].status === 'rejected'  ? results[i].reason.message : null; }

  var totalSeafarers = val(0) || 0;
  var weeklyRaw      = val(1) || {};
  var fillZero       = val(2) || 0;
  var fillLow        = val(3) || 0;
  var fillMid        = val(4) || 0;
  var fillHigh       = val(5) || 0;
  var totalCompanies = val(6) || 0;
  var weeklyFirmaRaw = val(7) || {};
  var totalJobs      = val(8) || 0;

  var newThisWeek   = sumDailyRegistrations(weeklyRaw);
  var newFirmaWeek  = sumDailyRegistrations(weeklyFirmaRaw);
  var profilePct    = calcProfileCompletion(fillZero, fillLow, fillMid, fillHigh);

  var errors = [0,1,2,3,4,5,6,7,8].map(err).filter(Boolean);

  var seafarers = {
    total:              totalSeafarers,
    newThisWeek:        newThisWeek,
    newToday:           weeklyRaw.seventhDay || 0,
    profileCompletion:  profilePct,
    incompleteProfiles: totalSeafarers - fillHigh,
    fillRateBuckets:    { zero: fillZero, low: fillLow, mid: fillMid, high: fillHigh },
    source: 'api',
  };

  var jobs = {
    total:                totalJobs,
    active:               totalJobs,
    newThisWeek:          0,
    companies:            totalCompanies,
    newCompaniesThisWeek: newFirmaWeek,
    source: 'api',
  };

  return {
    seafarers:  seafarers,
    jobs:       jobs,
    incomplete: { total: seafarers.incompleteProfiles, segments: [], source: 'api' },
    sources:    { channels: {}, source: 'api' },
    fetchedAt:  new Date().toISOString(),
    isRealData: true,
    apiErrors:  errors.length ? errors : undefined,
    stats: {
      seafarers:  String(totalSeafarers),
      jobs:       String(totalJobs),
      businesses: String(totalCompanies),
    },
    newJobs: [],
  };
}

// ── Export ────────────────────────────────────────────────────────────────────
module.exports = {
  getCountryWithMostGemiAdamiGenelMembersCount,
  getCountriesWithMostGemiAdamiGenelMembersCount,
  getTheTopPositionsWithHighestCountOfSeafarers,
  getLastRegisteredCompanies,
  fetchAllData,
  getBreakdownData,
  getLastCompanies,
};
