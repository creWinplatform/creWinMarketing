/**
 * Auth yardımcıları — Web Crypto API (Edge Runtime + Node.js uyumlu)
 * Node.js'e özgü `crypto` modülü kullanılmaz; `crypto.subtle` (globalThis) tercih edilir.
 */
import { cookies }     from 'next/headers';
import { NextRequest } from 'next/server';
import { isLegacyScope, LEGACY_SCOPE } from './platform/access';

export const COOKIE_NAME   = 'crm_auth';
export const SESSION_HOURS = 8;

const enc = new TextEncoder();

// Sabit (kod içine gömülü) yedek secret/şifre YOK — env eksikse giriş kapalı kalır (fail-closed).
function getSecret(): string | null {
  const secret = process.env.AUTH_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

/** AUTH_SECRET + ADMIN_USERNAME + ADMIN_PASSWORD tanımlı mı? */
export function authConfigured(): boolean {
  return Boolean(getSecret() && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD);
}

/** Uzunluk dışında zamanlama sızdırmayan string karşılaştırması. */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Cron çağrıları için: Authorization: Bearer <CRON_SECRET> veya x-cron-secret başlığı. */
export function hasValidCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = (req.headers.get('authorization') || req.headers.get('x-cron-secret') || '').replace(/^Bearer\s+/i, '');
  return Boolean(provided) && safeEqual(provided, secret);
}

// ── Web Crypto yardımcıları ────────────────────────────────────────────────────

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex: string): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

/** base64url encode (Node.js Buffer veya btoa) */
function b64uEncode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str).toString('base64url');
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** base64url decode */
function b64uDecode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'base64url').toString('utf-8');
  }
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return atob(padded);
}

// ── Token işlemleri ───────────────────────────────────────────────────────────

/** ttlMs verilmezse SESSION_HOURS; dahili (sunucu→sunucu) çağrılar kısa ömürlü token kullanır. */
export async function createSessionToken(username: string, ttlMs = SESSION_HOURS * 60 * 60 * 1000): Promise<string> {
  return signSession(`v2:${JSON.stringify({ subject: username, expiresAt: Date.now() + ttlMs, ...LEGACY_SCOPE })}`);
}

export type SessionIdentity = { subject: string; organizationId: string; projectId: string; mode: 'legacy' | 'platform'; securityVersion?: number };
export async function createPlatformSessionToken(identity: Omit<SessionIdentity, 'mode'>): Promise<string> {
  return signSession(`v3:${JSON.stringify({ subject: identity.subject, organizationId: identity.organizationId, projectId: identity.projectId, securityVersion: identity.securityVersion || 0, expiresAt: Date.now() + SESSION_HOURS * 60 * 60 * 1000 })}`);
}

async function signSession(payload: string): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error('AUTH_SECRET tanımlı değil (en az 16 karakter) — .env.local dosyasına ekleyin.');
  const key     = await getHmacKey(secret);
  const sig     = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return b64uEncode(`${payload}:${bufToHex(sig)}`);
}

export async function verifySessionIdentity(token: string): Promise<SessionIdentity | null> {
  try {
    const decoded = b64uDecode(token);
    const lastColon = decoded.lastIndexOf(':');
    if (lastColon < 0) return null;

    const payload = decoded.slice(0, lastColon);
    const sigHex  = decoded.slice(lastColon + 1);   // hex HMAC

    const secret = getSecret();
    if (!secret) return null;
    if (!/^[a-f0-9]{64}$/i.test(sigHex)) return null;
    const key   = await getHmacKey(secret);
    const signature = hexToBuf(sigHex) as unknown as BufferSource;
    const valid = await crypto.subtle.verify(
      'HMAC', key, signature, enc.encode(payload),
    );
    if (!valid) return null;

    // Old cookies remain valid during migration; the next refresh issues scoped v2.
    let username: unknown;
    let expiry: unknown;
    let scope: SessionIdentity = { subject: '', ...LEGACY_SCOPE, mode: 'legacy' };
    if (payload.startsWith('v3:')) {
      const identity = JSON.parse(payload.slice(3));
      if (!identity || ![identity.subject, identity.organizationId, identity.projectId].every(value => typeof value === 'string' && value.length > 0 && value.length < 200)) return null;
      username = identity.subject;
      expiry = identity.expiresAt;
      if(identity.securityVersion !== undefined && (!Number.isSafeInteger(identity.securityVersion) || identity.securityVersion < 0)) return null;
      scope = { subject: identity.subject, organizationId: identity.organizationId, projectId: identity.projectId, mode: 'platform', securityVersion: identity.securityVersion || 0 };
    } else if (payload.startsWith('v2:')) {
      const identity = JSON.parse(payload.slice(3));
      if (!identity || !isLegacyScope(identity.organizationId, identity.projectId)) return null;
      username = identity.subject;
      expiry = identity.expiresAt;
    } else {
      const colonIdx = payload.indexOf(':');
      if (colonIdx < 0) return null;
      username = payload.slice(0, colonIdx);
      const expiryString = payload.slice(colonIdx + 1);
      if (!/^\d+$/.test(expiryString)) return null;
      expiry = Number(expiryString);
    }
    if (typeof username !== 'string' || !username.trim() || typeof expiry !== 'number'
      || !Number.isSafeInteger(expiry) || expiry <= Date.now()) return null;
    return { ...scope, subject: username };
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string): Promise<string | null> {
  return (await verifySessionIdentity(token))?.subject || null;
}

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return token ? verifySessionIdentity(token) : null;
}

// ── Session okuma (Server Component) ─────────────────────────────────────────

export async function getSession(): Promise<string | null> {
  const jar   = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getSessionFromRequest(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const identity = await verifySessionIdentity(token);
  // Existing callers operate on Crewin-only OAuth and publishing state.
  return identity?.mode === 'legacy' ? identity.subject : null;
}

// ── Kimlik bilgisi doğrulama ──────────────────────────────────────────────────

export function validateCredentials(username: string, password: string): boolean {
  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;
  if (!validUser || !validPass) return false;
  // İki karşılaştırma da her zaman çalışır (kısa devre yok)
  const uMatch = safeEqual(username, validUser);
  const pMatch = safeEqual(password, validPass);
  return uMatch && pMatch;
}
