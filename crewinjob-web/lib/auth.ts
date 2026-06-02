/**
 * Auth yardımcıları — Web Crypto API (Edge Runtime + Node.js uyumlu)
 * Node.js'e özgü `crypto` modülü kullanılmaz; `crypto.subtle` (globalThis) tercih edilir.
 */
import { cookies }     from 'next/headers';
import { NextRequest } from 'next/server';

export const COOKIE_NAME   = 'crm_auth';
export const SESSION_HOURS = 8;

const enc = new TextEncoder();

function getSecret(): string {
  return process.env.AUTH_SECRET || 'crewinjob-marketing-agent-secret-key-change-in-production';
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

function hexToBuf(hex: string): ArrayBuffer {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out.buffer as ArrayBuffer;
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
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
}

// ── Token işlemleri ───────────────────────────────────────────────────────────

export async function createSessionToken(username: string): Promise<string> {
  const expiry  = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = `${username}:${expiry}`;
  const key     = await getHmacKey(getSecret());
  const sig     = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return b64uEncode(`${payload}:${bufToHex(sig)}`);
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const decoded = b64uDecode(token);
    const lastColon = decoded.lastIndexOf(':');
    if (lastColon < 0) return null;

    const payload = decoded.slice(0, lastColon);    // "username:expiry"
    const sigHex  = decoded.slice(lastColon + 1);   // hex HMAC

    const colonIdx = payload.indexOf(':');
    if (colonIdx < 0) return null;
    const username  = payload.slice(0, colonIdx);
    const expiryStr = payload.slice(colonIdx + 1);
    if (Date.now() > parseInt(expiryStr, 10)) return null;

    const key   = await getHmacKey(getSecret());
    const valid = await crypto.subtle.verify(
      'HMAC', key, hexToBuf(sigHex), enc.encode(payload),
    );
    return valid ? username : null;
  } catch {
    return null;
  }
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
  return verifySessionToken(token);
}

// ── Kimlik bilgisi doğrulama ──────────────────────────────────────────────────

export function validateCredentials(username: string, password: string): boolean {
  const validUser = process.env.ADMIN_USERNAME || 'admin';
  const validPass = process.env.ADMIN_PASSWORD || 'crewinjob2026';
  // Uzunluk eşit değilse hemen false — timing leak minimal
  if (username.length !== validUser.length || password.length !== validPass.length) return false;
  let uMatch = true;
  let pMatch = true;
  for (let i = 0; i < validUser.length; i++) uMatch = uMatch && (username[i] === validUser[i]);
  for (let i = 0; i < validPass.length; i++) pMatch = pMatch && (password[i] === validPass[i]);
  return uMatch && pMatch;
}
