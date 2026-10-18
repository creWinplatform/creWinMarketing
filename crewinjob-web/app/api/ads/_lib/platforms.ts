// ─── Reklam platformları için ortak sunucu yardımcıları ──────────────────────
// Yalnızca app/api/ads/** route'ları kullanır (`_lib` klasörü route değildir).
// - Yapılandırma her istekte env'den okunur (status/list/create aynı kuralı kullanır)
// - API sürümleri env ile değiştirilebilir: META_GRAPH_VERSION, GOOGLE_ADS_API_VERSION, LINKEDIN_API_VERSION
// - Token'lar URL'ye değil Authorization başlığına konur; tüm çağrılar cache: 'no-store'
import 'server-only';
import { NextResponse } from 'next/server';
import type { AdPlatform } from '@/lib/ads-types';

// ── Yapılandırma ──────────────────────────────────────────────────────────────
const REQUIRED_ENV: Record<AdPlatform, string[]> = {
  meta:     ['META_ADS_ACCESS_TOKEN', 'META_ADS_ACCOUNT_ID'],
  linkedin: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ADS_ACCOUNT_ID'],
  // Refresh token akışı client id/secret olmadan çalışmaz → onlar da zorunlu
  google:   ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'],
};

export const PLATFORM_LABEL: Record<AdPlatform, string> = {
  meta: 'Meta Ads', linkedin: 'LinkedIn Ads', google: 'Google Ads',
};

/** Eksik env değişkeni ADLARI (değerler asla döndürülmez). */
export function missingEnv(platform: AdPlatform): string[] {
  return REQUIRED_ENV[platform].filter(name => !String(process.env[name] || '').trim());
}

export function isConfigured(platform: AdPlatform): boolean {
  return missingEnv(platform).length === 0;
}

/** Platform yapılandırılmamışken create/PATCH/DELETE → 503 (sahte "başarılı" yanıt yok). */
export function notConfiguredResponse(platform: AdPlatform) {
  return NextResponse.json({
    platform,
    campaignId: '',
    success:    false,
    configured: false,
    error:      `${PLATFORM_LABEL[platform]} yapılandırılmamış — eksik env: ${missingEnv(platform).join(', ')}`,
  }, { status: 503 });
}

/** Hesap para birimi alınamazsa kullanılan varsayılan (ADS_CURRENCY, yoksa USD). */
export function defaultCurrency(): string {
  const value = String(process.env.ADS_CURRENCY || 'USD').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : 'USD';
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Bilinmeyen hata';
}

export function badRequest(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

/** JSON gövdesi; bozuk JSON veya obje olmayan gövde → null (route 400 döner). */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json() as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Gövdede izin verilmeyen anahtar varsa adlarını döndürür. */
export function unknownKeys(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body).filter(key => !allowed.includes(key));
}

// ── Create isteği doğrulama (tüm platformlar) ───────────────────────────────
export interface ValidCreateRequest {
  name:        string;
  objective:   string;
  budgetDaily: number;      // hesap para biriminde, ana birim
  startDate:   string;      // YYYY-MM-DD
  endDate?:    string;
  countries:   string[];    // ISO-3166 alpha-2 (LinkedIn için urn:li:geo:<id> de kabul edilir)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCreateRequest(body: Record<string, unknown>): { ok: true; value: ValidCreateRequest } | { ok: false; error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) return { ok: false, error: 'Kampanya adı zorunlu (en fazla 200 karakter).' };
  const objective = typeof body.objective === 'string' ? body.objective.trim().toUpperCase() : '';
  if (!/^[A-Z_]{2,40}$/.test(objective)) return { ok: false, error: 'Geçersiz kampanya hedefi.' };
  const budgetDaily = typeof body.budgetDaily === 'number' ? body.budgetDaily : Number.NaN;
  if (!Number.isFinite(budgetDaily) || budgetDaily <= 0 || budgetDaily > 1_000_000) return { ok: false, error: 'Günlük bütçe pozitif bir sayı olmalı.' };
  const startDate = typeof body.startDate === 'string' ? body.startDate : '';
  if (!DATE_RE.test(startDate) || Number.isNaN(Date.parse(startDate))) return { ok: false, error: 'Başlangıç tarihi YYYY-MM-DD olmalı.' };
  const endDate = typeof body.endDate === 'string' && body.endDate ? body.endDate : undefined;
  if (endDate && (!DATE_RE.test(endDate) || Number.isNaN(Date.parse(endDate)) || endDate < startDate)) {
    return { ok: false, error: 'Bitiş tarihi YYYY-MM-DD olmalı ve başlangıçtan önce olamaz.' };
  }
  const targeting = body.targeting && typeof body.targeting === 'object' ? body.targeting as Record<string, unknown> : {};
  const rawCountries = Array.isArray(targeting.countries) ? targeting.countries : [];
  const countries = Array.from(new Set(rawCountries.map(item => String(item).trim()).filter(Boolean)
    .map(item => /^urn:li:geo:\d+$/.test(item) ? item : item.toUpperCase())));
  if (countries.length > 50 || countries.some(item => !/^[A-Z]{2}$/.test(item) && !/^urn:li:geo:\d+$/.test(item))) {
    return { ok: false, error: 'Hedef ülkeler ISO-3166 iki harfli kod olmalı (ör. TR, PH).' };
  }
  return { ok: true, value: { name, objective, budgetDaily, startDate, endDate, countries: countries.length ? countries : ['TR'] } };
}

// ── Meta (Graph API) ─────────────────────────────────────────────────────────
export function metaGraphBase(): string {
  const version = String(process.env.META_GRAPH_VERSION || 'v25.0').trim();
  return `https://graph.facebook.com/${/^v\d+\.\d+$/.test(version) ? version : 'v25.0'}`;
}

/** "act_123" biçimi (env "123" de olabilir). */
export function metaAccountId(): string {
  const raw = String(process.env.META_ADS_ACCOUNT_ID || '').trim();
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

export const META_ID_RE = /^\d{1,30}$/;

/** Graph çağrısı: token Authorization başlığında, cache yok; hata → Error(mesaj). */
export async function metaFetch<T = Record<string, unknown>>(pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${process.env.META_ADS_ACCESS_TOKEN || ''}`);
  const res  = await fetch(`${metaGraphBase()}/${pathAndQuery.replace(/^\//, '')}`, { ...init, headers, cache: 'no-store' });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* JSON olmayan yanıt */ }
  const error = json.error as { message?: string; error_user_msg?: string } | undefined;
  if (!res.ok || error) throw new Error(error?.error_user_msg || error?.message || `Meta HTTP ${res.status}`);
  return json as T;
}

// Meta bütçeleri para biriminin en küçük biriminde ister; bu para birimlerinde ofset 1'dir (kuruş yok)
const META_OFFSET_ONE = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']);
export function metaMinorUnitFactor(currency: string): number {
  return META_OFFSET_ONE.has(currency.toUpperCase()) ? 1 : 100;
}

type CurrencyCache = Map<string, { value: string; at: number }>;
const cg = globalThis as typeof globalThis & { __crewinAdsCurrency?: CurrencyCache };
const currencyCache: CurrencyCache = cg.__crewinAdsCurrency ?? (cg.__crewinAdsCurrency = new Map());
const CURRENCY_TTL_MS = 10 * 60 * 1000;

async function cachedCurrency(key: string, load: () => Promise<string | undefined>): Promise<string> {
  const hit = currencyCache.get(key);
  if (hit && Date.now() - hit.at < CURRENCY_TTL_MS) return hit.value;
  try {
    const value = String(await load() || '').toUpperCase();
    if (/^[A-Z]{3}$/.test(value)) {
      currencyCache.set(key, { value, at: Date.now() });
      return value;
    }
  } catch { /* hesap para birimi okunamazsa varsayılana düş */ }
  return defaultCurrency();
}

/** Reklam hesabının para birimi (Graph: /act_x?fields=currency), 10 dk cache. */
export function metaAccountCurrency(): Promise<string> {
  const act = metaAccountId();
  return cachedCurrency(`meta:${act}`, async () => (await metaFetch<{ currency?: string }>(`${act}?fields=currency`)).currency);
}

// ── Google Ads (REST) ────────────────────────────────────────────────────────
export function googleAdsBase(): string {
  const version = String(process.env.GOOGLE_ADS_API_VERSION || 'v25').trim();
  return `https://googleads.googleapis.com/${/^v\d+$/.test(version) ? version : 'v25'}`;
}

/** v23+ kampanyada start_date/end_date yerine start_date_time/end_date_time ("yyyy-MM-dd HH:mm:ss", hesap saat dilimi). */
export function googleUsesDateTime(): boolean {
  return Number(googleAdsBase().split('/v').pop()) >= 23;
}

export function googleCustomerId(): string {
  return String(process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\D/g, '');
}

export const GOOGLE_ID_RE = /^\d{1,20}$/;

// OAuth access token — süreç içi cache; bitişinden ~60 sn önce yenilenir (globalThis: dev HMR'da korunur)
const gg = globalThis as typeof globalThis & { __crewinGoogleAdsToken?: { token: string; expiresAt: number } };

async function googleAccessToken(): Promise<string> {
  const cached = gg.__crewinGoogleAdsToken;
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_ADS_CLIENT_ID     || '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
      grant_type:    'refresh_token',
    }),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google OAuth: ${json.error_description || json.error || `HTTP ${res.status}`}`);
  gg.__crewinGoogleAdsToken = { token: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
  return json.access_token;
}

function googleErrorMessage(json: Record<string, unknown>, status: number): string {
  const error = json.error as { message?: string; details?: Array<{ errors?: Array<{ message?: string }> }> } | undefined;
  const detail = (error?.details || []).flatMap(d => d.errors || []).map(e => e.message).filter(Boolean).join('; ');
  return detail || error?.message || `Google Ads HTTP ${status}`;
}

/** customers/{cid}/<path> için POST (search ve mutate uçları POST'tur). */
export async function googleAdsPost<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const token   = await googleAccessToken();
  const headers: Record<string, string> = {
    'Authorization':   `Bearer ${token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    'Content-Type':    'application/json',
  };
  const loginCustomer = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');
  if (loginCustomer) headers['login-customer-id'] = loginCustomer;
  const res  = await fetch(`${googleAdsBase()}/customers/${googleCustomerId()}/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* JSON olmayan yanıt */ }
  if (!res.ok || json.error) throw new Error(googleErrorMessage(json, res.status));
  return json as T;
}

// ── LinkedIn (versiyonlu REST API) ───────────────────────────────────────────
// Eski /v2/adCampaignsV2 kaldırıldı; /rest/adAccounts/{id}/adCampaigns kullanılır.
export const LINKEDIN_REST = 'https://api.linkedin.com/rest';

export function linkedinVersion(): string {
  const version = String(process.env.LINKEDIN_API_VERSION || '202608').trim();
  return /^\d{6}$/.test(version) ? version : '202608';
}

/** Sayısal sponsored account ID (env "urn:li:sponsoredAccount:123" de olabilir). */
export function linkedinAccountId(): string {
  const id = String(process.env.LINKEDIN_ADS_ACCOUNT_ID || '').trim().replace(/^urn:li:sponsoredAccount:/, '');
  if (!/^\d+$/.test(id)) throw new Error('LINKEDIN_ADS_ACCOUNT_ID sayısal bir sponsored account ID olmalı.');
  return id;
}

/** Kampanya ID'si: "123" veya "urn:li:sponsoredCampaign:123" → "123"; geçersizse null. */
export function linkedinCampaignId(raw: string): string | null {
  const id = decodeURIComponent(raw || '').trim().replace(/^urn:li:sponsoredCampaign:/, '');
  return /^\d{1,20}$/.test(id) ? id : null;
}

export interface LinkedinResult<T> { json: T; headers: Headers; status: number }

/** Rest.li 2.0 çağrısı. Not: `search=(...)` gibi Rest.li sorguları path içinde ham verilmeli (encode edilmez). */
export async function linkedinFetch<T = Record<string, unknown>>(pathAndQuery: string, init: RequestInit = {}): Promise<LinkedinResult<T>> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN || ''}`);
  headers.set('Linkedin-Version', linkedinVersion());
  headers.set('X-Restli-Protocol-Version', '2.0.0');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const res  = await fetch(`${LINKEDIN_REST}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`, { ...init, headers, cache: 'no-store' });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* boş / JSON olmayan yanıt */ }
  if (!res.ok) throw new Error(String(json.message || `LinkedIn HTTP ${res.status}`));
  return { json: json as T, headers: res.headers, status: res.status };
}

/** Oluşturma yanıtında yeni kaydın ID'si başlıkta döner (gövde boş). */
export function linkedinCreatedId(result: LinkedinResult<Record<string, unknown>>): string {
  const raw = result.headers.get('x-restli-id') || result.headers.get('x-linkedin-id') || String(result.json.id || '');
  return raw.split(':').pop() || '';
}

/** Reklam hesabının para birimi (/rest/adAccounts/{id} → currency), 10 dk cache. */
export function linkedinAccountCurrency(): Promise<string> {
  const id = linkedinAccountId();
  return cachedCurrency(`linkedin:${id}`, async () => (await linkedinFetch<{ currency?: string }>(`/adAccounts/${id}`)).json.currency);
}
