import fs   from 'fs';
import path from 'path';

const DATA_DIR   = path.join(process.cwd(), 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'social-tokens.json');
const STATE_FILE = path.join(DATA_DIR, 'oauth-state.json');

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

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadTokens(): AllTokens {
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  } catch { /* ignore */ }
  return {};
}

export function saveTokens(tokens: AllTokens) {
  ensureDir();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function setToken(platform: keyof AllTokens, data: PlatformToken) {
  const t = loadTokens();
  t[platform] = data;
  saveTokens(t);
}

export function getToken(platform: keyof AllTokens): PlatformToken | null {
  // Önce dosyadan bak
  const stored = loadTokens()[platform];
  if (stored) return stored;

  // Dosyada yoksa env var'lardan yükle (statik token desteği)
  if (platform === 'twitter') {
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

export function removeToken(platform: keyof AllTokens) {
  const t = loadTokens();
  delete t[platform];
  saveTokens(t);
}

// ── OAuth state (CSRF + PKCE) ─────────────────────────────────────────────────
interface OAuthState {
  platform:      string;
  codeVerifier?: string;
  createdAt:     number;
}

function loadStates(): Record<string, OAuthState> {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch { /* ignore */ }
  return {};
}

function saveStates(s: Record<string, OAuthState>) {
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

export function saveOAuthState(state: string, platform: string, codeVerifier?: string) {
  const s = loadStates();
  // Temizle — 10 dakikadan eski state'leri sil
  const now = Date.now();
  for (const [k, v] of Object.entries(s)) {
    if (now - v.createdAt > 10 * 60 * 1000) delete s[k];
  }
  s[state] = { platform, codeVerifier, createdAt: now };
  saveStates(s);
}

export function consumeOAuthState(state: string): OAuthState | null {
  const s = loadStates();
  const data = s[state];
  if (!data) return null;
  if (Date.now() - data.createdAt > 10 * 60 * 1000) { delete s[state]; saveStates(s); return null; }
  delete s[state];
  saveStates(s);
  return data;
}
