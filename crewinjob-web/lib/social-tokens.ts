import { mutateStore, readStore, webStore } from '@/lib/legacy-store';

// data/social-tokens.json and oauth-state.json, or legacy_records 'web:social-tokens' / 'web:oauth-state' (one row per
// platform / state) with PLATFORM_LEGACY_STORE=mssql.
const TOKENS = () => webStore('social-tokens.json', 'object');
const STATES = () => webStore('oauth-state.json', 'object');

export interface PlatformToken {
  accessToken:   string;
  refreshToken?: string;
  expiresAt?:    number;
  userId?:       string;
  username?:     string;
  displayName?:  string;
  // Facebook/Instagram
  pageId?:       string;
  pageName?:     string;
  igUserId?:     string;
}

export interface AllTokens {
  twitter?:   PlatformToken;
  linkedin?:  PlatformToken;
  facebook?:  PlatformToken;
  instagram?: PlatformToken;
  tiktok?:    PlatformToken;
}

export async function loadTokens(): Promise<AllTokens> {
  return readStore(TOKENS()) as Promise<AllTokens>;
}

// Read-modify-write depo kilidi altında; yazım atomik (dosya: tmp + rename, tablo: tek transaction).
export async function saveTokens(tokens: AllTokens) {
  await mutateStore(TOKENS(), () => ({ ...tokens }) as Record<string, unknown>);
}

export async function setToken(platform: keyof AllTokens, data: PlatformToken) {
  await mutateStore(TOKENS(), tokens => ({ ...tokens, [platform]: data }));
}

export async function getToken(platform: keyof AllTokens): Promise<PlatformToken | null> {
  // Önce depodan bak
  const stored = (await loadTokens())[platform];
  if (stored) return stored;

  // Dosyada yoksa env var'lardan yükle (statik token desteği)
  if (platform === 'twitter') {
    // TWITTER_ACCESS_TOKEN + TWITTER_ACCESS_TOKEN_SECRET birlikteyse bu bir OAuth 1.0a kullanıcı
    // token'ıdır (bkz. twitterOAuth1Creds) — OAuth2 Bearer olarak kullanılamaz.
    if (process.env.TWITTER_ACCESS_TOKEN_SECRET) return null;
    const at = process.env.TWITTER_ACCESS_TOKEN;
    const rt = process.env.TWITTER_REFRESH_TOKEN;
    const un = process.env.TWITTER_USERNAME;
    if (at) return { accessToken: at, refreshToken: rt, username: un };
  }
  if (platform === 'linkedin') {
    const at = process.env.LINKEDIN_ACCESS_TOKEN;
    const uid = process.env.LINKEDIN_USER_ID;
    if (at) return { accessToken: at, userId: uid };
  }
  if (platform === 'facebook') {
    const at  = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
    const pid = process.env.FACEBOOK_PAGE_ID;
    if (at) return { accessToken: at, pageId: pid };
  }
  if (platform === 'instagram') {
    const at  = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    const uid = process.env.INSTAGRAM_IG_USER_ID || process.env.INSTAGRAM_USER_ID;
    if (at) return { accessToken: at, igUserId: uid };
  }
  if (platform === 'tiktok') {
    const at  = process.env.TIKTOK_ACCESS_TOKEN;
    const uid = process.env.TIKTOK_OPEN_ID;
    if (at) return { accessToken: at, userId: uid };
  }

  return null;
}

// ── Meta Graph API ────────────────────────────────────────────────────────────
// v19.0 Mayıs 2026'da kapandı; sürüm tek yerden (env) yönetilir.
export function graphVersion(): string {
  return process.env.META_GRAPH_VERSION || 'v25.0';
}

export function graphUrl(p: string): string {
  return `https://graph.facebook.com/${graphVersion()}/${p.replace(/^\//, '')}`;
}

/** Token URL'ye yazılmaz (log/proxy/referer sızıntısı) — Authorization: Bearer başlığıyla gider. */
export function graphFetch(p: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(graphUrl(p), { ...init, headers });
}

// ── Twitter / X ───────────────────────────────────────────────────────────────
/**
 * OAuth 1.0a kullanıcı kimlik bilgileri — tam set yoksa null.
 * TWITTER_ACCESS_TOKEN_V1 yoksa TWITTER_ACCESS_TOKEN, SECRET ile birlikte OAuth1 token'ı sayılır.
 */
export function twitterOAuth1Creds(): { apiKey: string; apiSecret: string; accessToken: string; tokenSecret: string } | null {
  const apiKey      = process.env.TWITTER_API_KEY;
  const apiSecret   = process.env.TWITTER_API_SECRET;
  const tokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN_V1 || process.env.TWITTER_ACCESS_TOKEN;
  if (!apiKey || !apiSecret || !tokenSecret || !accessToken) return null;
  return { apiKey, apiSecret, accessToken, tokenSecret };
}

/**
 * Twitter OAuth2 token uç noktası isteği.
 * Confidential client (TWITTER_CLIENT_SECRET varsa) → Basic auth; public client → body'de client_id.
 */
export function twitterTokenRequest(params: Record<string, string>): RequestInit {
  const clientId     = process.env.TWITTER_CLIENT_ID || '';
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const body = new URLSearchParams(params);
  if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  else body.set('client_id', clientId);
  return { method: 'POST', headers, body };
}

/**
 * OAuth2 Bearer token'ı döner; süresi dolmuşsa (veya force) refresh_token ile yeniler.
 * Twitter her yenilemede yeni refresh_token verir → dosyaya yazılır.
 */
export async function getFreshTwitterOAuth2Token(force = false): Promise<PlatformToken | null> {
  const token = await getToken('twitter');
  if (!token?.accessToken) return null;
  const expired = token.expiresAt ? token.expiresAt - 60_000 <= Date.now() : false;
  if (!force && !expired) return token;
  if (!token.refreshToken || !process.env.TWITTER_CLIENT_ID) return token;   // yenilenemez — çağıran 401 alır

  try {
    const res  = await fetch('https://api.twitter.com/2/oauth2/token', twitterTokenRequest({
      grant_type:    'refresh_token',
      refresh_token: token.refreshToken,
    }));
    const data = await res.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !data.access_token) {
      console.warn('[twitter] OAuth2 token yenilenemedi:', res.status, data.error_description || '');
      return token;
    }
    const next: PlatformToken = {
      ...token,
      accessToken:  data.access_token,
      refreshToken: data.refresh_token || token.refreshToken,
      expiresAt:    data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    };
    await setToken('twitter', next);
    return next;
  } catch (e) {
    console.warn('[twitter] OAuth2 token yenileme hatası:', e);
    return token;
  }
}

// ── OAuth state (CSRF + PKCE) ─────────────────────────────────────────────────
interface OAuthState {
  platform:      string;
  codeVerifier?: string;
  /** Akışı başlatan oturum kullanıcısı — callback'te aynı oturum aranır */
  user?:         string;
  createdAt:     number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

export async function saveOAuthState(state: string, platform: string, codeVerifier?: string, user?: string) {
  await mutateStore(STATES(), list => {
    const s = list as Record<string, OAuthState>;
    // Temizle — 10 dakikadan eski state'leri sil
    const now = Date.now();
    for (const [k, v] of Object.entries(s)) {
      if (now - v.createdAt > STATE_TTL_MS) delete s[k];
    }
    s[state] = { platform, codeVerifier, user, createdAt: now };
    return s;
  });
}

/** Tek kullanımlık: bulunursa silinir (kilit altında — iki istek aynı state'i kullanamaz). Süresi geçmişse null. */
export async function consumeOAuthState(state: string): Promise<OAuthState | null> {
  let data: OAuthState | undefined;
  await mutateStore(STATES(), list => {
    const s = list as Record<string, OAuthState>;
    data = s[state];
    if (!data) return undefined;
    delete s[state];
    return s;
  });
  if (!data) return null;
  if (Date.now() - data.createdAt > STATE_TTL_MS) return null;
  return data;
}
