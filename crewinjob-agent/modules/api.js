// ─── crewinjob API Module ─────────────────────────────────────────────────────
// api.crewin.org bağlantısı — ABP Framework token auth.
// Mock data YOKTUR. Tüm veriler gerçek API'den çekilir.

const BASE     = (process.env.CREWINJOB_API_URL     || 'https://api.crewin.org').replace(/\/$/, '');
const API_KEY  =  process.env.CREWINJOB_API_KEY      || '';
const USERNAME =  process.env.CREWINJOB_API_USERNAME || '';
const PASSWORD =  process.env.CREWINJOB_API_PASSWORD || '';
const CREDIT_API_KEY  = process.env.CREWINJOB_CREDIT_API_KEY      || '';
const CREDIT_USERNAME = process.env.CREWINJOB_CREDIT_API_USERNAME || '';
const CREDIT_PASSWORD = process.env.CREWINJOB_CREDIT_API_PASSWORD || '';
const TENANT_ID = process.env.CREWINJOB_TENANT_ID || process.env.ABP_TENANT_ID || '';

// Next.js route handler'larında global fetch yamalıdır ve yanıtları (GET route içindeki POST login dahil)
// veri önbelleğine alabilir → günler önce süresi dolmuş token tekrar tekrar döner. Tüm çağrılar önbelleksiz.
// globalThis.fetch çağrı anında okunur (testlerdeki global.fetch mock'u çalışmaya devam eder).
var fetch = function(url, opts) { return globalThis.fetch(url, Object.assign({ cache: 'no-store' }, opts)); };

// ── Token cache ───────────────────────────────────────────────────────────────
var _tokenCache  = { token: null, expiresAt: 0 };
var _loginPromise = null; // mutex — paralel login yarışını önler
var _creditTokenCache = { token: null, expiresAt: 0 };
var _creditLoginPromise = null;
var _creditPermissionCache = { token: null, allowed: null, expiresAt: 0 };

// ── Data cache (90 sn TTL) — her istekte 9 API çağrısı yapılmasını önler ──────
var _dataCache        = { data: null, expiresAt: 0 };
var _dataFetchPromise = null; // mutex — eş zamanlı isteklerde tek çağrı

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

// Önbellekteki token'ı geçersiz say (401 sonrası). Statik CREWINJOB_API_KEY yenilenemez.
// Yalnızca hâlâ aynı token önbellekteyse sıfırla — paralel bir istek yeni token almış olabilir.
function invalidateToken(token) {
  if (API_KEY) return;
  if (_tokenCache.token === token) {
    _tokenCache.token = null;
    _tokenCache.expiresAt = 0;
  }
}

// Servis token'ıyla istek at; HTTP 401 gelirse token'ı sıfırlayıp BİR kez yeniden dene
// (backend restart / token iptali sonrası 24 saat boyunca 401 almayı önler).
// buildOptions(token) her denemede yeni options (ve yeni AbortSignal) üretmeli.
async function fetchWithAuth(url, buildOptions) {
  var token = await getToken();
  var res = await fetch(url, buildOptions(token));
  if (res.status === 401 && !API_KEY) {
    invalidateToken(token);
    token = await getToken();
    res = await fetch(url, buildOptions(token));
  }
  return res;
}

async function loginForCredit() {
  var res = await fetch(BASE + '/api/TokenAuth/Authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ userNameOrEmailAddress: CREDIT_USERNAME, password: CREDIT_PASSWORD }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    var t = ''; try { t = await res.text(); } catch(_) {}
    throw new Error('Kredi servisi login HTTP ' + res.status + (t ? ' — ' + t.slice(0, 200) : ''));
  }
  var data = await res.json();
  var result = data.result || data;
  if (!result || !result.accessToken) throw new Error('Kredi servisi login yanıtında accessToken yok');
  _creditTokenCache.token = result.accessToken;
  _creditTokenCache.expiresAt = Date.now() + (result.expireInSeconds || 86400) * 1000 - 60000;
  return result.accessToken;
}

async function getCreditToken() {
  if (CREDIT_API_KEY) return CREDIT_API_KEY;
  if (!CREDIT_USERNAME || !CREDIT_PASSWORD) return await getToken();
  if (_creditTokenCache.token && Date.now() < _creditTokenCache.expiresAt) return _creditTokenCache.token;
  if (_creditLoginPromise) return await _creditLoginPromise;
  _creditLoginPromise = loginForCredit().finally(function() { _creditLoginPromise = null; });
  return await _creditLoginPromise;
}

async function ensureFirmaKrediPermission(token) {
  if (_creditPermissionCache.token === token && Date.now() < _creditPermissionCache.expiresAt) {
    if (_creditPermissionCache.allowed) return;
    var cachedErr = new Error('Kredi yönetimi API hesabında Pages.FirmaKrediYonetimi yetkisi yok.');
    cachedErr.status = 403;
    throw cachedErr;
  }

  var res = await fetch(BASE + '/AbpUserConfiguration/GetAll', {
    headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
    signal: AbortSignal.timeout(12000),
  });
  // Fail-closed: yetki doğrulanamıyorsa kredi işlemine İZİN VERME.
  if (!res.ok) {
    var checkErr = new Error('Kredi yönetimi yetkisi doğrulanamadı (AbpUserConfiguration/GetAll → HTTP ' + res.status + '). İşlem güvenlik nedeniyle durduruldu.');
    checkErr.status = (res.status === 401 || res.status === 403) ? 403 : 503;
    throw checkErr;
  }

  var data = await res.json();
  var root = data && data.result ? data.result : data;
  var auth = root && root.auth ? root.auth : {};
  var permissions = auth.grantedPermissions || auth.grantedPolicies || {};
  var permission = permissions['Pages.FirmaKrediYonetimi'];
  var allowed = permission === true || permission === 'true';
  _creditPermissionCache = { token: token, allowed: allowed, expiresAt: Date.now() + 60000 };
  if (!allowed) {
    var err = new Error('Kredi yönetimi API hesabında Pages.FirmaKrediYonetimi yetkisi yok.');
    err.status = 403;
    throw err;
  }
}

// ── Genel fetch yardımcısı ────────────────────────────────────────────────────
async function callApi(path, params) {
  var url     = new URL(BASE + '/api/services/app/' + path);
  Object.entries(params || {}).forEach(function(e) {
    if (e[1] !== undefined && e[1] !== null && e[1] !== '') url.searchParams.set(e[0], String(e[1]));
  });
  var res = await fetchWithAuth(url.toString(), function(token) {
    return {
      headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
      signal:  AbortSignal.timeout(12000),
    };
  });
  if (!res.ok) {
    var b = ''; try { b = await res.text(); } catch(_) {}
    var callErr = new Error(path + ' → HTTP ' + res.status + (b ? ' | ' + b.slice(0, 300) : ''));
    callErr.status   = res.status;
    callErr.endpoint = path;
    throw callErr;
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
  // Backend bucket'larının orta noktalarıyla üretilen yaklaşık ortalama.
  return Math.round((low * 25 + mid * 65 + high * 90) / total);
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

/** Tüm istatistikler — /api/stats, /api/dashboard
 *  90 saniyelik bellek cache'i ile tekrar eden isteklerde API çağrısı atlanır. */
async function fetchAllData() {
  // Cache hit → hemen dön
  if (_dataCache.data && Date.now() < _dataCache.expiresAt) {
    return _dataCache.data;
  }
  // Eş zamanlı istek varsa onu bekle — çift çağrı yapma
  if (_dataFetchPromise) return await _dataFetchPromise;

  _dataFetchPromise = _fetchAllDataFresh().finally(function() { _dataFetchPromise = null; });
  return await _dataFetchPromise;
}

async function _fetchAllDataFresh() {
  var calls = [
    ['GemiAdamiGenel/GetTotalCountOfGemiAdamiGenel', {}],                             // [0]
    ['GemiAdamiGenel/GetGemiAdamiGenelWhoRegisteredInLastSevenDays', {}],             // [1]
    ['GemiAdamiGenel/GetSeafarersByFillBucket', { bucket: 'zero', page: 1, size: 1 }], // [2] 0
    ['GemiAdamiGenel/GetSeafarersByFillBucket', { bucket: 'low',  page: 1, size: 1 }], // [3] 1-49
    ['GemiAdamiGenel/GetSeafarersByFillBucket', { bucket: 'mid',  page: 1, size: 1 }], // [4] 50-79
    ['GemiAdamiGenel/GetSeafarersByFillBucket', { bucket: 'high', page: 1, size: 1 }], // [5] 80+
    ['FirmaGenel/GetTotalCountOfFirmaGenel', {}],                                     // [6]
    ['FirmaGenel/GetFirmaGenelWhoRegisteredInLastSevenDays', {}],                     // [7]
    ['Ilan/GetTotalCountOfIlan', {}],                                                  // [8]
    ['Ilan/GetIlanWhoRegisteredInLastSevenDays', {}],                                  // [9] — yoksa null
    ['GemiAdamiGenel/GetIncompleteProfileSegments', {}],                               // [10] — segment breakdown
    ['GrowthAnalytics/GetProfileCompletionSummary', {}],                               // [11] — kesin profil özeti
  ];
  var results = await Promise.allSettled(calls.map(function(c) { return callApi(c[0], c[1]); }));

  function val(i) { return results[i].status === 'fulfilled' ? results[i].value : null; }
  // Kısa hata metni: yalnızca endpoint adı + HTTP durumu (token/yanıt gövdesi ASLA dışarı sızmaz)
  function err(i) {
    if (results[i].status !== 'rejected') return null;
    var reason = results[i].reason || {};
    var name = calls[i][0] + (calls[i][1].bucket ? '(' + calls[i][1].bucket + ')' : '');
    if (typeof reason.status === 'number') return name + ' → HTTP ' + reason.status;
    if (reason.name === 'TimeoutError' || reason.name === 'AbortError') return name + ' → zaman aşımı';
    return name + ' → bağlantı hatası';
  }
  var anySucceeded = results.some(function(r) { return r.status === 'fulfilled'; });

  var totalSeafarers = val(0) || 0;
  var weeklyRaw      = val(1) || {};
  function bucketCount(i) {
    var raw = val(i);
    if (typeof raw === 'number') return raw;
    if (raw && typeof raw.totalCount === 'number') return raw.totalCount;
    return raw && Array.isArray(raw.items) ? raw.items.length : 0;
  }
  var fillZero       = bucketCount(2);
  var fillLow        = bucketCount(3);
  var fillMid        = bucketCount(4);
  var fillHigh       = bucketCount(5);
  var totalCompanies = val(6) || 0;
  var weeklyFirmaRaw = val(7) || {};
  var totalJobs      = val(8) || 0;
  var weeklyIlanRaw  = val(9);   // endpoint yoksa null — 0 gösterip yalan söyleme

  var newThisWeek   = sumDailyRegistrations(weeklyRaw);
  var newFirmaWeek  = sumDailyRegistrations(weeklyFirmaRaw);
  var newIlanWeek   = weeklyIlanRaw ? sumDailyRegistrations(weeklyIlanRaw) : null;
  var profilePct    = calcProfileCompletion(fillZero, fillLow, fillMid, fillHigh);
  var activationRate = totalSeafarers > 0 ? Math.round((fillHigh / totalSeafarers) * 1000) / 10 : 0;
  var completeProfiles = null;
  var profileSummary = val(11);
  if (profileSummary && typeof profileSummary.total === 'number') {
    totalSeafarers = profileSummary.total;
    fillZero = Number(profileSummary.empty || 0);
    fillLow = Number(profileSummary.between1And49 || 0);
    fillMid = Number(profileSummary.between50And79 || 0);
    fillHigh = Number(profileSummary.activated80Plus || 0);
    completeProfiles = Number(profileSummary.complete100 || 0);
    profilePct = Number(profileSummary.averageProfileCompletion || 0);
    activationRate = Number(profileSummary.activationRate || 0);
  }

  // [9] ve [10] opsiyonel — hata verirse veri yok demektir, uyarı listesine girmez
  var errors = [0,1,2,3,4,5,6,7,8].map(err).filter(Boolean);

  // Segment normalizasyonu — GetIncompleteProfileSegments artık agregat endpoint,
  // response: { segments: [{ missingField, count, lastActiveDaysAvg }], totalProfiles }
  var rawSegments   = val(10);
  var segments      = [];
  var totalProfiles = null;
  try {
    var list = Array.isArray(rawSegments) ? rawSegments
             : (rawSegments && Array.isArray(rawSegments.segments)) ? rawSegments.segments
             : [];
    segments = list.map(function(s) {
      return {
        missingField:       s.missingField       || '',
        count:              s.count              || 0,
        lastActiveDaysAvg:  s.lastActiveDaysAvg  || 0,
      };
    }).filter(function(s) { return s.missingField; });
    if (rawSegments && typeof rawSegments.totalProfiles === 'number') {
      totalProfiles = rawSegments.totalProfiles;
    }
  } catch(_) {}

  // dailyRegistrations SIRASI: index 0 = firstDay = EN ESKİ gün (6 gün önce),
  // index 6 = seventhDay = EN YENİ gün (bugün). Bu, newToday = seventhDay varsayımıyla tutarlıdır.
  // DİKKAT: Backend dokümanları (context/*.md) firstDay..seventhDay sırasını açıkça tanımlamıyor;
  // bu sıra mevcut kodun varsayımıdır. Index'ler haftanın günü (Pzt..Paz) DEĞİL, bugüne göre
  // göreli günlerdir — grafik etiketi bugünden geriye hesaplanmalı.
  var seafarers = {
    total:              totalSeafarers,
    newThisWeek:        newThisWeek,
    newToday:           weeklyRaw.seventhDay || 0,
    dailyRegistrations: ['firstDay','secondDay','thirdDay','fourthDay','fifthDay','sixthDay','seventhDay'].map(function(k) { return weeklyRaw[k] || 0; }),
    profileCompletion:  profilePct,          // ortalama doluluk % — "tamamlanmış kullanıcı oranı" DEĞİL
    profileCompletionIsExact: Boolean(profileSummary),
    incompleteProfiles: profileSummary ? Number(profileSummary.profilesBelow80 || 0) : totalSeafarers - fillHigh,
    profilesBelow80:    profileSummary ? Number(profileSummary.profilesBelow80 || 0) : totalSeafarers - fillHigh,
    activatedSeafarers: fillHigh,            // pazarlama KPI tanımı: profil doluluğu %80+
    completeProfiles:   completeProfiles,
    activationRate:     activationRate,
    readyToHire:        fillHigh,            // geriye uyumlu alias; yeni kod activatedSeafarers kullanmalı
    fillRateBuckets:    { zero: fillZero, low: fillLow, mid: fillMid, high: fillHigh },
    source: 'api',
  };

  var jobs = {
    total:                totalJobs,
    // NOT: Aktif ilan sayısı için ayrı bir endpoint YOK; bu değer toplam ilan sayısıdır
    // (süresi dolmuş/pasif ilanlar dahil). UI bunu "aktif" diye etiketlememeli.
    active:               totalJobs,
    newThisWeek:          newIlanWeek,       // null = endpoint yok, UI "–" gösterir
    companies:            totalCompanies,
    newCompaniesThisWeek: newFirmaWeek,
    source: 'api',
  };

  var result = {
    seafarers:  seafarers,
    jobs:       jobs,
    incomplete: { total: totalProfiles != null ? totalProfiles : seafarers.incompleteProfiles, segments: segments, source: 'api' },
    sources:    { channels: {}, source: 'api' },
    fetchedAt:  new Date().toISOString(),
    // En az bir API çağrısı başarılıysa gerçek veri; hepsi başarısızsa sayılar 0 ve güvenilmez.
    isRealData: anySucceeded,
    partial:    errors.length > 0,
    apiErrors:  errors.length ? errors : undefined,
    stats: {
      seafarers:  String(totalSeafarers),
      jobs:       String(totalJobs),
      businesses: String(totalCompanies),
    },
    newJobs: [],
  };

  // Cache'e yaz — 90 sn boyunca API tekrar çağrılmaz.
  // Tüm çağrılar başarısızsa sadece 15 sn tut: backend toparlanınca sıfırlar uzun süre gösterilmesin.
  _dataCache.data      = result;
  _dataCache.expiresAt = Date.now() + (anySucceeded ? 90_000 : 15_000);
  return result;
}

// =============================================================================
// AKTİVASYON ENDPOİNT FONKSİYONLARI
// =============================================================================

/**
 * P2 — Eksik profil segmentleri. AGREGAT endpoint — userId GÖNDERİLMEMELİ.
 * Response: { segments: [{ missingField, count, lastActiveDaysAvg }], totalProfiles }
 */
async function getIncompleteProfileSegments() {
  var raw = await callApi('GemiAdamiGenel/GetIncompleteProfileSegments', {});
  var list = Array.isArray(raw) ? raw
           : (raw && Array.isArray(raw.segments)) ? raw.segments
           : [];
  var segments = list.map(function(s) {
    return {
      missingField:      s.missingField      || '',
      count:             s.count             || 0,
      lastActiveDaysAvg: s.lastActiveDaysAvg || 0,
    };
  }).filter(function(s) { return s.missingField; });
  var totalProfiles = (raw && typeof raw.totalProfiles === 'number') ? raw.totalProfiles : null;
  return { segments: segments, totalProfiles: totalProfiles };
}

/**
 * P3 — Profil görünürlük kazancı. Kullanıcı-bazlı — admin/pazarlama panelinde
 * userId ZORUNLU. Seafarer kendi hesabından çağırıyorsa userId opsiyonel.
 */
async function getProfileVisibilityGain(userId) {
  return await callApi('GemiAdamiGenel/GetProfileVisibilityGain', userId ? { userId: userId } : {});
}

/**
 * P1 — Onboarding durumu. Kullanıcı-bazlı — admin/pazarlama panelinde userId ZORUNLU.
 * Seafarer kendi hesabından çağırıyorsa userId opsiyonel.
 */
async function getOnboardingState(userId) {
  return await callApi('GemiAdamiGenel/GetOnboardingState', userId ? { userId: userId } : {});
}

/**
 * Aktivasyon huninin ölçümü — event tracking.
 * @param {string} eventName — bkz. TRACKED_EVENT_NAMES
 * @param {number} [userId]
 * @param {object} [metadata] — otomatik JSON.stringify edilir
 * @param {string} [source] — varsayılan 'frontend'
 */
var TRACKED_EVENT_NAMES = [
  'onboarding_shown', 'onboarding_cv_selected', 'onboarding_manual_selected', 'onboarding_skipped', 'onboarding_completed',
  'cv_uploaded', 'cv_parse_succeeded', 'cv_parse_partial', 'cv_parse_failed', 'cv_parse_confirmed',
  'profile_completed_50', 'profile_completed_80', 'certificate_uploaded', 'availability_updated',
  'social_signup_initiated', 'social_signup_completed',
  'email_sent', 'email_opened', 'email_clicked', 'email_bounced',
];

async function trackActivationEvent(eventName, userId, metadata, source) {
  var body = {
    eventName:    eventName,
    source:       source || 'frontend',
    userId:       userId || undefined,
    metadataJson: metadata ? JSON.stringify(metadata) : undefined,
  };
  var res = await fetchWithAuth(BASE + '/api/services/app/GemiAdamiGenel/TrackActivationEvent', function(token) {
    return {
      method:  'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(12000),
    };
  });
  if (!res.ok) {
    var b = ''; try { b = await res.text(); } catch(_) {}
    throw new Error('TrackActivationEvent → HTTP ' + res.status + (b ? ' | ' + b.slice(0, 300) : ''));
  }
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

/**
 * A3 — Doluluk bucket'ına göre gemi adamı listesi (e-posta re-aktivasyon kampanyası için).
 * Bucket eşikleri (backend tanımı): zero=0, low=1-49, mid=50-79, high=80+.
 * NOT: Backend emailOptOut=true olanları zaten dışarıda bırakıyor — buradaki filtre
 * sadece ek bir güvenlik ağı, backend'in davranışına bağımlı değil.
 * @param {'zero'|'low'|'mid'|'high'} bucket
 * @param {number} page
 * @param {number} size
 */
async function getSeafarersByFillBucket(bucket, page, size) {
  var raw = await callApi('GemiAdamiGenel/GetSeafarersByFillBucket', {
    bucket: bucket,
    page:   page || 1,
    size:   size || 100,
  });
  // ABP PagedResult: { totalCount, items } veya düz dizi
  var totalCount = (raw && typeof raw.totalCount === 'number') ? raw.totalCount : null;
  var list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items)) ? raw.items : [];
  var items = list
    .map(function(s) {
      return {
        userId:         s.userId         || null,
        email:          s.email          || '',
        fullName:       s.fullName       || '',
        fillRate:       typeof s.fillRate === 'number' ? s.fillRate : 0,
        lastActiveAt:   s.lastActiveAt   || null,
        emailOptOut:    !!s.emailOptOut,
        unsubscribeUrl: s.unsubscribeUrl || null,
        nationality:    s.nationality    || s.uyruk || null,
        position:       s.position       || s.positionName || s.pozisyon || null,
      };
    })
    .filter(function(s) { return s.email && !s.emailOptOut; });
  return { items: items, totalCount: totalCount };
}

/**
 * P1 — Onboarding aksiyonları (admin/servis hesabı adına, BELİRLİ bir kullanıcı için).
 * backend-brief.md: "POST MarkOnboardingShown/SkipOnboarding/CompleteOnboarding —
 * userId verilmezse login olan kullanıcı baz alınır"; iletisim-backend.md: "Kullanıcı-özel
 * ekranlarda userId ile çağrılabiliyor". userId'nin body mi query mi olduğu belgelenmediği için
 * ikisinde birden gönderilir (ABP: DTO parametresi body'den, primitive parametre query'den bağlanır).
 * userId ZORUNLU — verilmezse servis hesabının kendisi işaretlenirdi.
 * @param {'MarkOnboardingShown'|'SkipOnboarding'|'CompleteOnboarding'} action
 * @param {number|string} userId - hedef gemi adamı kullanıcı ID'si
 */
var ONBOARDING_ACTIONS = ['MarkOnboardingShown', 'SkipOnboarding', 'CompleteOnboarding'];

async function postOnboardingAction(action, userId) {
  if (ONBOARDING_ACTIONS.indexOf(action) === -1) {
    var actionErr = new Error('Geçersiz onboarding aksiyonu: ' + action);
    actionErr.status = 400;
    throw actionErr;
  }
  var uid = Number(userId);
  if (!userId || !Number.isInteger(uid) || uid <= 0) {
    var uidErr = new Error(action + ': userId zorunlu — servis hesabı adına onboarding işaretlenmez (admin-on-behalf için hedef kullanıcı belirtilmeli).');
    uidErr.status = 400;
    throw uidErr;
  }
  var url = new URL(BASE + '/api/services/app/GemiAdamiGenel/' + action);
  url.searchParams.set('userId', String(uid));
  var res = await fetchWithAuth(url.toString(), function(token) {
    return {
      method:  'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body:    JSON.stringify({ userId: uid }),
      signal:  AbortSignal.timeout(12000),
    };
  });
  if (!res.ok) {
    var b = ''; try { b = await res.text(); } catch(_) {}
    throw new Error(action + ' → HTTP ' + res.status + (b ? ' | ' + b.slice(0, 300) : ''));
  }
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

/**
 * "Size Uygun İlanlar" kampanyası — Ilan/GetAll endpoint'i.
 *
 * Endpoint: GET /Ilan/GetAll?filtered=1&noticeType=1&userId={id}
 *
 * Servis token'ıyla userId OLMADAN çağrıldığında filtered=1 parametresi
 * yok sayılır ve tüm aktif ilanlar döner (en güncel ilanlar).
 * Kişiselleştirilmiş eşleşme için backend'de userId parametresi desteği
 * gerekiyor (bkz. context/yapilacaklar-backend-frontend.md).
 *
 * @param {number|null} [userId] - Kişisel eşleşme için seafarer userId (backend desteği gerekir)
 * @param {number}      [limit]  - Kaç ilan dönsün (varsayılan: 6)
 */
async function getJobListings(userId, limit) {
  var params = {
    noticeType:       1,
    sorting:          'id desc',
    skipCount:        0,
    maxResultCount:   limit || 6,
    countryList:      -1,
    cityList:         -1,
    statusList:       -1,
    vesselList:       -1,
    machineList:      -1,
    contractTypeList: -1,
    languageList:     -1,
    endorsementList:  -1,
    visaList:         -1,
    minTonage:        0,
    maxTonage:        0,
    minPrice:         0,
    maxPrice:         0,
  };
  if (userId) {
    params.filtered = 1;
    params.userId   = userId; // backend bu parametreyi destekliyorsa kişisel eşleşme
  } else {
    params.filtered = 0; // servis token'ıyla en güncel aktif ilanlar
  }

  var raw  = await callApi('Ilan/GetAll', params);
  var list = Array.isArray(raw) ? raw
           : (raw && Array.isArray(raw.items)) ? raw.items
           : [];

  // Response yapısı: her öğe { ilan: {...}, ilanBasvuruForView: {...} }
  return list.slice(0, limit || 6).map(function(item) {
    var j      = (item && item.ilan) ? item.ilan : item; // normalize: nested veya düz
    var minP   = j.minPrice || 0;
    var maxP   = j.maxPrice || 0;
    var cur    = j.currencyName || 'USD';
    var salary = '';
    if (minP > 0 || maxP > 0) {
      salary = minP === maxP
        ? (minP.toLocaleString() + ' ' + cur)
        : (minP.toLocaleString() + '–' + maxP.toLocaleString() + ' ' + cur);
    }
    return {
      jobId:      j.id                || null,
      title:      j.positionName      || '',
      company:    j.firmName          || j.companyName || '',
      vesselType: j.ship              || j.vesselTypeName || '',
      duration:   j.contratTypeName   || j.contractDuration || '',
      salary:     salary,
      location:   j.ilanCountryName   || j.countryName || '',
      postedAt:   j.startDate         || j.noticeDate  || null,
      // /jobs/{id} 404 verir — gerçek ilan detay sayfası /jobs/detail/{id} kalıbında
      applyUrl:   'https://www.crewinjob.com/jobs/detail/' + (j.id || ''),
    };
  });
}

/**
 * P0 — CV yükle ve parse et
 * @param {Buffer|Blob} fileBuffer - dosya içeriği
 * @param {string} fileName - orijinal dosya adı
 * @param {Object} opts - { belgeKaynakTipi, forceOcr, islemBaslat }
 */
// Dosya adı uzantısından MIME tipi — bilinmiyorsa application/octet-stream
var UPLOAD_MIME_TYPES = {
  pdf:  'application/pdf',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
};

// Node 18+/20 yerleşik FormData yalnızca Blob kabul eder; Buffer'ı Blob'a sar.
// (form.append(name, Buffer, {filename}) Node 20'de "parameter 2 is not of type 'Blob'" fırlatır.)
function toUploadBlob(fileBuffer, fileName) {
  if (typeof Blob === 'undefined' || typeof FormData === 'undefined') {
    throw new Error('Dosya yükleme için Node 18+ (yerleşik FormData/Blob) gerekli');
  }
  if (fileBuffer instanceof Blob) return fileBuffer;
  var ext = String(fileName || '').split('.').pop().toLowerCase();
  return new Blob([fileBuffer], { type: UPLOAD_MIME_TYPES[ext] || 'application/octet-stream' });
}

async function uploadAndParseCV(fileBuffer, fileName, opts) {
  opts = opts || {};
  var url = new URL(BASE + '/api/services/app/GemiAdamiGenel/UploadAndParseCV');
  if (opts.belgeKaynakTipi !== undefined) url.searchParams.set('belgeKaynakTipi', String(opts.belgeKaynakTipi));
  if (opts.forceOcr)    url.searchParams.set('forceOcr',    'true');
  if (opts.islemBaslat) url.searchParams.set('islemBaslat', 'true');

  // FormData oluştur — Content-Type header'ı manuel SET ETME; fetch boundary'yi otomatik koyar
  var blob = toUploadBlob(fileBuffer, fileName);
  var form = new FormData();
  form.append('dosya', blob, fileName);
  // Hem 'dosya' hem 'file' alanını destekle (backend her ikisini kabul ediyor)
  form.append('file', blob, fileName);

  var res = await fetchWithAuth(url.toString(), function(token) {
    return {
      method:  'POST',
      headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
      body:    form,
      signal:  AbortSignal.timeout(30000), // parse zaman alabilir
    };
  });
  if (!res.ok) {
    var b = ''; try { b = await res.text(); } catch(_) {}
    throw new Error('UploadAndParseCV → HTTP ' + res.status + (b ? ' | ' + b.slice(0, 300) : ''));
  }
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

/**
 * P0 — Parse edilen CV'yi onayla
 * @param {{ belgeId: number, onaylananKalemIds?: number[], onaylananKalemler?: Array<{taslakKalemId:number,onaylandi:boolean}> }} body
 */
async function confirmParsedCV(body) {
  var res = await fetchWithAuth(BASE + '/api/services/app/GemiAdamiGenel/ConfirmParsedCV', function(token) {
    return {
      method:  'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(12000),
    };
  });
  if (!res.ok) {
    var b = ''; try { b = await res.text(); } catch(_) {}
    throw new Error('ConfirmParsedCV → HTTP ' + res.status + (b ? ' | ' + b.slice(0, 300) : ''));
  }
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

// =============================================================================
// FIRMA KREDI YONETIMI ENDPOINTLERI
// =============================================================================

// ABP cakisma durumlarini (mukerrer banka referansi, zaten onaylanmis siparis)
// HTTP 500 olarak dondurur; ayirt edici bilgi govdedeki error.code alanindadir.
// Bu yuzden 409'u status'a burada normalize ediyoruz, cagiran taraf tek kural gorsun.
async function firmaHatasi(prefix, res) {
  var b = ''; try { b = await res.text(); } catch(_) {}
  var code = null;
  try { var j = JSON.parse(b); code = j && j.error && j.error.code; } catch(_) {}
  var err = new Error(prefix + ' → HTTP ' + res.status + (b ? ' | ' + b.slice(0, 300) : ''));
  err.status = (code === 409) ? 409 : res.status;
  err.code   = code || null;
  err.body   = b;
  return err;
}

async function firmaKrediGet(endpoint, params) {
  var token = await getCreditToken();
  await ensureFirmaKrediPermission(token);
  var url = new URL(BASE + '/api/services/app/FirmaKrediYonetimi/' + encodeEndpointPath(endpoint));
  Object.entries(params || {}).forEach(function(e) {
    if (e[1] !== undefined && e[1] !== null && e[1] !== '') url.searchParams.set(e[0], String(e[1]));
  });
  var res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
    signal:  AbortSignal.timeout(12000),
  });
  if (!res.ok) throw await firmaHatasi(endpoint, res);
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

async function firmaKrediPost(endpoint, body) {
  var token = await getCreditToken();
  await ensureFirmaKrediPermission(token);
  var res = await fetch(BASE + '/api/services/app/FirmaKrediYonetimi/' + encodeEndpointPath(endpoint), {
    method:  'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body:    JSON.stringify(body || {}),
    signal:  AbortSignal.timeout(20000),
  });
  if (!res.ok) throw await firmaHatasi(endpoint, res);
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

async function firmaKrediDekontYukle(fileBuffer, fileName) {
  var token = await getCreditToken();
  await ensureFirmaKrediPermission(token);
  // Yerleşik FormData + Blob — Content-Type'ı (boundary) fetch kendisi koyar
  var form = new FormData();
  form.append('dosya', toUploadBlob(fileBuffer, fileName), fileName);

  var res = await fetch(BASE + '/api/services/app/FirmaKrediYonetimi/DekontYukle', {
    method:  'POST',
    headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
    body:    form,
    signal:  AbortSignal.timeout(30000),
  });
  if (!res.ok) throw await firmaHatasi('DekontYukle', res);
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

// =============================================================================
// FIRMA SIPARIS ENDPOINTLERI
// =============================================================================

async function firmaSiparisGet(endpoint, params) {
  var url = new URL(BASE + '/api/services/app/FirmaSiparis/' + encodeEndpointPath(endpoint));
  Object.entries(params || {}).forEach(function(e) {
    if (e[1] !== undefined && e[1] !== null && e[1] !== '') url.searchParams.set(e[0], String(e[1]));
  });
  var res = await fetchWithAuth(url.toString(), function(token) {
    return {
      headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
      signal:  AbortSignal.timeout(12000),
    };
  });
  if (!res.ok) throw await firmaHatasi('FirmaSiparis/' + endpoint, res);
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

// GrowthAnalytics raporları için mevcut Crewin API yolunu kullanan read-only geçit.
async function growthAnalyticsGet(endpoint, params) {
  var url = new URL(BASE + '/api/services/app/GrowthAnalytics/' + encodeEndpointPath(endpoint));
  Object.entries(params || {}).forEach(function(entry) {
    var key = entry[0];
    var value = entry[1];
    if (Array.isArray(value)) {
      value.forEach(function(item) { if (item !== undefined && item !== null && item !== '') url.searchParams.append(key, String(item)); });
    } else if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  var res = await fetchWithAuth(url.toString(), function(token) {
    return {
      headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
      signal: AbortSignal.timeout(20000),
    };
  });
  if (!res.ok) {
    var text = ''; try { text = await res.text(); } catch(_) {}
    throw new Error('GrowthAnalytics/' + endpoint + ' → HTTP ' + res.status + (text ? ' | ' + text.slice(0, 300) : ''));
  }
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

async function growthAnalyticsPost(endpoint, body) {
  var res = await fetchWithAuth(BASE + '/api/services/app/GrowthAnalytics/' + encodeEndpointPath(endpoint), function(token) {
    return {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(20000),
    };
  });
  if (!res.ok) {
    var text = ''; try { text = await res.text(); } catch(_) {}
    throw new Error('GrowthAnalytics/' + endpoint + ' → HTTP ' + res.status + (text ? ' | ' + text.slice(0, 300) : ''));
  }
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

// ProcessUnsubscribe anonim çalışır; kullanıcı token'ı istemez ve servis hesabı
// kimlik bilgilerini dışarıya açmadan web geçidi tarafından kullanılabilir.
async function growthAnalyticsPublicPost(endpoint, body) {
  var res = await fetch(BASE + '/api/services/app/GrowthAnalytics/' + encodeEndpointPath(endpoint), {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    var text = ''; try { text = await res.text(); } catch(_) {}
    var err = new Error('GrowthAnalytics/' + endpoint + ' → HTTP ' + res.status + (text ? ' | ' + text.slice(0, 300) : ''));
    err.status = res.status;
    throw err;
  }
  var responseText = await res.text();
  if (!responseText) return undefined;
  var json = JSON.parse(responseText);
  return (json && json.result !== undefined) ? json.result : json;
}

async function growthAnalyticsPut(endpoint, body) {
  var res = await fetchWithAuth(BASE + '/api/services/app/GrowthAnalytics/' + encodeEndpointPath(endpoint), function(token) {
    return {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(20000),
    };
  });
  if (!res.ok) {
    var text = ''; try { text = await res.text(); } catch(_) {}
    throw new Error('GrowthAnalytics/' + endpoint + ' → HTTP ' + res.status + (text ? ' | ' + text.slice(0, 300) : ''));
  }
  var json = await res.json();
  return (json && json.result !== undefined) ? json.result : json;
}

// Endpoint'i güvenli path segmentlerine çevir: '/' ile böl, boş / '.' / '..' segmentleri
// reddet (path traversal: ör. '../../TokenAuth/Authenticate'), her segmenti encode et.
// Not: WHATWG URL '%2e%2e'yi de '..' sayar; bu yüzden kontrol encode ÖNCESİ yapılır.
function encodeEndpointPath(endpoint) {
  var raw = String(endpoint == null ? '' : endpoint);
  var segments = raw.split('/');
  var invalid = segments.some(function(s) { return s === '' || s === '.' || s === '..'; });
  if (!raw || invalid) {
    var pathErr = new Error('Geçersiz endpoint yolu: "' + raw.slice(0, 80) + '"');
    pathErr.status = 400;
    throw pathErr;
  }
  return segments.map(encodeURIComponent).join('/');
}

async function marketingServiceRequest(service, method, endpoint, payload, timeoutMs, extraHeaders) {
  var safeEndpoint = encodeEndpointPath(endpoint);
  var url = new URL(BASE + '/api/services/app/' + service + '/' + safeEndpoint);
  var body;
  if (method === 'GET' || method === 'DELETE') {
    Object.entries(payload || {}).forEach(function(entry) {
      var value = entry[1];
      if (Array.isArray(value)) value.forEach(function(item) { if (item !== undefined && item !== null && item !== '') url.searchParams.append(entry[0], String(item)); });
      else if (value !== undefined && value !== null && value !== '') url.searchParams.set(entry[0], String(value));
    });
  } else {
    body = JSON.stringify(payload || {});
  }
  var res = await fetchWithAuth(url.toString(), function(token) {
    var options = {
      method: method,
      headers: Object.assign({ 'Accept': 'application/json', 'Authorization': 'Bearer ' + token }, extraHeaders || {}),
      signal: AbortSignal.timeout(timeoutMs || 20000),
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = body;
    }
    return options;
  });
  if (!res.ok) {
    var text = ''; try { text = await res.text(); } catch(_) {}
    var err = new Error(service + '/' + endpoint + ' → HTTP ' + res.status + (text ? ' | ' + text.slice(0, 300) : ''));
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined;
  var responseText = await res.text();
  if (!responseText) return undefined;
  var json = JSON.parse(responseText);
  return (json && json.result !== undefined) ? json.result : json;
}

function marketingCampaignGet(endpoint, params) { return marketingServiceRequest('MarketingCampaign', 'GET', endpoint, params); }
function marketingCampaignPost(endpoint, body) { return marketingServiceRequest('MarketingCampaign', 'POST', endpoint, body); }
function marketingCampaignDelete(endpoint, params) { return marketingServiceRequest('MarketingCampaign', 'DELETE', endpoint, params); }
function marketingTemplateGet(endpoint, params) { return marketingServiceRequest('MarketingTemplate', 'GET', endpoint, params); }
function marketingIntegrationGet(endpoint, params) { return marketingServiceRequest('MarketingIntegration', 'GET', endpoint, params); }
function marketingCampaignV2Get(endpoint, params) { return marketingServiceRequest('MarketingCampaignV2', 'GET', endpoint, params); }
function marketingCampaignV2Post(endpoint, body) { return marketingServiceRequest('MarketingCampaignV2', 'POST', endpoint, body); }
function marketingProspectPost(endpoint, body) {
  // AI araştırması bazı backend sürümlerinde job kaydını oluşturmadan önce
  // provider hazırlığını bekleyebiliyor. Diğer prospect CRUD çağrıları 20 sn kalır.
  var timeoutMs = endpoint === 'StartResearch' || endpoint === 'Research' ? 120000 : 20000;
  return marketingServiceRequest('MarketingProspect', 'POST', endpoint, body, timeoutMs);
}
function marketingProspectGet(endpoint, params) { return marketingServiceRequest('MarketingProspect', 'GET', endpoint, params); }
function marketingCampaignV2Delete(endpoint, params) { return marketingServiceRequest('MarketingCampaignV2', 'DELETE', endpoint, params); }
function marketingContentHistoryGet(endpoint, params) { return marketingServiceRequest('MarketingContentHistory', 'GET', endpoint, params); }
function marketingContentHistoryPost(endpoint, body) { return marketingServiceRequest('MarketingContentHistory', 'POST', endpoint, body); }
function marketingContentHistoryDelete(endpoint, params) { return marketingServiceRequest('MarketingContentHistory', 'DELETE', endpoint, params); }
function marketingPostHistoryGet(endpoint, params) { return marketingServiceRequest('MarketingPostHistory', 'GET', endpoint, params); }
function marketingPostHistoryPost(endpoint, body) { return marketingServiceRequest('MarketingPostHistory', 'POST', endpoint, body); }
function marketingActivityGet(endpoint, params) { return marketingServiceRequest('MarketingActivity', 'GET', endpoint, params); }
function marketingActivityPost(endpoint, body) { return marketingServiceRequest('MarketingActivity', 'POST', endpoint, body); }
function marketingCalendarGet(endpoint, params) { return marketingServiceRequest('MarketingCalendar', 'GET', endpoint, params); }
function marketingCalendarPost(endpoint, body) { return marketingServiceRequest('MarketingCalendar', 'POST', endpoint, body); }
function marketingCalendarDelete(endpoint, params) { return marketingServiceRequest('MarketingCalendar', 'DELETE', endpoint, params); }
function marketingAssetGet(endpoint, params) { return marketingServiceRequest('MarketingAsset', 'GET', endpoint, params); }
function marketingAssetPost(endpoint, body) { return marketingServiceRequest('MarketingAsset', 'POST', endpoint, body, 60000); }
function marketingAssetDelete(endpoint, params) { return marketingServiceRequest('MarketingAsset', 'DELETE', endpoint, params); }
// Fonksiyon adı mevcut frontend importları için korunuyor; canlı ABP route adı MarketingAutomation.
function marketingAutomationJobGet(endpoint, params) { return marketingServiceRequest('MarketingAutomation', 'GET', endpoint, params); }
function marketingAutomationJobPost(endpoint, body) { return marketingServiceRequest('MarketingAutomation', 'POST', endpoint, body); }
function marketingIntegrationConnectionGet(endpoint, params) { return marketingServiceRequest('MarketingIntegrationConnection', 'GET', endpoint, params); }
function marketingIntegrationConnectionPost(endpoint, body) { return marketingServiceRequest('MarketingIntegrationConnection', 'POST', endpoint, body); }

function siteSeoRequest(method, endpoint, payload) {
  if (!TENANT_ID) {
    var configError = new Error('SiteSeo için CREWINJOB_TENANT_ID veya ABP_TENANT_ID tanımlı değil.');
    configError.status = 422;
    throw configError;
  }
  return marketingServiceRequest('SiteSeo', method, endpoint, payload, 20000, { 'Abp.TenantId': String(TENANT_ID) });
}

function siteSeoGet(endpoint, params) { return siteSeoRequest('GET', endpoint, params); }
function siteSeoPost(endpoint, body) { return siteSeoRequest('POST', endpoint, body); }
function siteSeoActionGet(endpoint, params) {
  if (!TENANT_ID) {
    var configError = new Error('SiteSeoAction için CREWINJOB_TENANT_ID veya ABP_TENANT_ID tanımlı değil.');
    configError.status = 422;
    throw configError;
  }
  return marketingServiceRequest('SiteSeoAction', 'GET', endpoint, params, 20000, { 'Abp.TenantId': String(TENANT_ID) });
}
function siteSeoActionPost(endpoint, body) {
  if (!TENANT_ID) {
    var configError = new Error('SiteSeoAction için CREWINJOB_TENANT_ID veya ABP_TENANT_ID tanımlı değil.');
    configError.status = 422;
    throw configError;
  }
  return marketingServiceRequest('SiteSeoAction', 'POST', endpoint, body, 20000, { 'Abp.TenantId': String(TENANT_ID) });
}

// ── Export ────────────────────────────────────────────────────────────────────
module.exports = {
  // Auth (servis token'ı — tek kaynak; başka modüller kendi login'ini yazmasın)
  getToken,
  // Mevcut
  getCountryWithMostGemiAdamiGenelMembersCount,
  getCountriesWithMostGemiAdamiGenelMembersCount,
  getTheTopPositionsWithHighestCountOfSeafarers,
  getLastRegisteredCompanies,
  fetchAllData,
  getBreakdownData,
  getLastCompanies,
  // Aktivasyon (P0–P3)
  getIncompleteProfileSegments,
  getProfileVisibilityGain,
  getOnboardingState,
  getSeafarersByFillBucket,
  trackActivationEvent,
  TRACKED_EVENT_NAMES,
  postOnboardingAction,
  uploadAndParseCV,
  confirmParsedCV,
  getJobListings,
  firmaKrediGet,
  firmaKrediPost,
  firmaKrediDekontYukle,
  firmaSiparisGet,
  growthAnalyticsGet,
  growthAnalyticsPost,
  growthAnalyticsPublicPost,
  growthAnalyticsPut,
  marketingCampaignGet,
  marketingCampaignPost,
  marketingCampaignDelete,
  marketingTemplateGet,
  marketingIntegrationGet,
  marketingCampaignV2Get,
  marketingCampaignV2Post,
  marketingProspectPost,
  marketingProspectGet,
  marketingCampaignV2Delete,
  marketingContentHistoryGet,
  marketingContentHistoryPost,
  marketingContentHistoryDelete,
  marketingPostHistoryGet,
  marketingPostHistoryPost,
  marketingActivityGet,
  marketingActivityPost,
  marketingCalendarGet,
  marketingCalendarPost,
  marketingCalendarDelete,
  marketingAssetGet,
  marketingAssetPost,
  marketingAssetDelete,
  marketingAutomationJobGet,
  marketingAutomationJobPost,
  marketingIntegrationConnectionGet,
  marketingIntegrationConnectionPost,
  siteSeoGet,
  siteSeoPost,
  siteSeoActionGet,
  siteSeoActionPost,
};
