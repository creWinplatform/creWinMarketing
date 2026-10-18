// Google Search Console — paylaşılan servis hesabı istemcisi.
// app/api/search-console ve app/api/seo/ctr-report route'ları bu modülü kullanır.
// Servis hesabı token'ı (getServiceAccountToken) GA4 route'u tarafından da kullanılır.
import crypto from 'crypto';

function serviceAccountJson(): string { return process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ''; }
function gscSiteUrl(): string { return process.env.GSC_SITE_URL || ''; }

/** Google API hatası — `status` route'un döneceği HTTP kodudur (upstream kodu `upstreamStatus`). */
export class GoogleApiError extends Error {
  constructor(message: string, public status: number, public upstreamStatus?: number) {
    super(message);
    this.name = 'GoogleApiError';
    Object.setPrototypeOf(this, GoogleApiError.prototype);   // eski derleme hedeflerinde instanceof çalışsın
  }
}

/** Route'lar için: yapılandırma hatası 500, Google rate limit 429, diğer upstream hataları 502. */
export function googleErrorStatus(error: unknown): number {
  return error instanceof GoogleApiError ? error.status : 502;
}

export function gscConfigured(): boolean {
  return Boolean(serviceAccountJson() && gscSiteUrl());
}

export function getSiteUrl(): string {
  return gscSiteUrl();
}

function parseServiceAccount(): Record<string, string> {
  try {
    return JSON.parse(serviceAccountJson());
  } catch {
    throw new GoogleApiError('GOOGLE_SERVICE_ACCOUNT_JSON geçersiz JSON', 500);
  }
}

/** Google JSON hata gövdesinden kısa mesaj (token vb. içermez). */
async function upstreamError(res: Response, label: string): Promise<GoogleApiError> {
  let detail = '';
  try {
    const body = await res.json() as { error?: { message?: string; status?: string } | string; error_description?: string };
    detail = typeof body.error === 'string'
      ? `${body.error}${body.error_description ? `: ${body.error_description}` : ''}`
      : body.error?.message || body.error?.status || '';
  } catch { /* JSON olmayan gövde */ }
  return new GoogleApiError(`${label} HTTP ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`, res.status === 429 ? 429 : 502, res.status);
}

// Servis hesabı access token'ı — her istekte yeni JWT basmak yerine bitişten ~60 sn öncesine kadar cache'lenir
type TokenCache = Map<string, { token: string; expiresAt: number }>;
const g = globalThis as typeof globalThis & { __crewinGoogleSaTokens?: TokenCache };
const tokenCache: TokenCache = g.__crewinGoogleSaTokens ?? (g.__crewinGoogleSaTokens = new Map());

export async function getServiceAccountToken(scope: string, saJson: Record<string, string> = parseServiceAccount()): Promise<string> {
  const { client_email, private_key } = saJson;
  if (!client_email || !private_key) throw new GoogleApiError('GOOGLE_SERVICE_ACCOUNT_JSON içinde client_email / private_key eksik', 500);
  const key    = `${client_email}|${scope}`;
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(private_key.replace(/\\n/g, '\n'), 'base64url');
  const jwt = `${header}.${payload}.${sig}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    cache: 'no-store',
  });
  if (!res.ok) throw await upstreamError(res, 'Google OAuth');
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new GoogleApiError('Google OAuth: token alınamadı', 502);
  tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

/** Google JSON API'sine POST; res.ok değilse GoogleApiError fırlatır. */
export async function googlePostJson<T>(url: string, token: string, body: unknown, label: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw await upstreamError(res, label);
  return res.json() as Promise<T>;
}

export interface GscQueryRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
export interface GscQueryResponse { rows?: GscQueryRow[]; }

async function gscQuery(
  token: string,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<GscQueryResponse> {
  return googlePostJson<GscQueryResponse>(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    token,
    body,
    'Search Console',
  );
}

function dateStr(d: Date) { return d.toISOString().slice(0, 10); }

export function dateRangeForDays(days: number): { startDate: string; endDate: string } {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: dateStr(start), endDate: dateStr(end) };
}

/** Kimlik doğrulanmış GSC istemcisi — çağıran taraf query()'i istediği gibi kullanır. */
export async function createGscClient(): Promise<{
  siteUrl: string;
  query: (body: Record<string, unknown>) => Promise<GscQueryResponse>;
}> {
  if (!gscConfigured()) throw new GoogleApiError('GSC yapılandırılmamış (GOOGLE_SERVICE_ACCOUNT_JSON / GSC_SITE_URL eksik)', 503);
  const token   = await getServiceAccountToken('https://www.googleapis.com/auth/webmasters.readonly');
  const siteUrl = gscSiteUrl();
  return {
    siteUrl,
    query: (body: Record<string, unknown>) => gscQuery(token, siteUrl, body),
  };
}
