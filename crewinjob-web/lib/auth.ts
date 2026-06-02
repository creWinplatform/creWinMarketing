/**
 * Auth yardımcıları — HMAC-SHA256 ile imzalı cookie session
 * Dış bağımlılık yok; Node.js crypto modülü kullanılır.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies }                      from 'next/headers';
import { NextRequest }                  from 'next/server';

export const COOKIE_NAME    = 'crm_auth';
export const SESSION_HOURS  = 8;

function getSecret(): string {
  return process.env.AUTH_SECRET || 'crewinjob-marketing-agent-secret-key-change-in-production';
}

/** İmzalı token oluştur: "<username>:<expiry>" → HMAC */
export function createSessionToken(username: string): string {
  const expiry  = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = `${username}:${expiry}`;
  const sig     = createHmac('sha256', getSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

/** Token doğrula — geçerli username döner, hatalıysa null */
export function verifySessionToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts   = decoded.split(':');
    if (parts.length < 3) return null;

    const sig      = parts.pop()!;
    const payload  = parts.join(':');
    const expected = createHmac('sha256', getSecret()).update(payload).digest('hex');

    // Zamanlama saldırısına karşı sabit-süre karşılaştırma
    const sigBuf = Buffer.from(sig,      'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

    const [username, expiryStr] = payload.split(':');
    if (Date.now() > parseInt(expiryStr, 10)) return null; // süresi dolmuş

    return username;
  } catch {
    return null;
  }
}

/** Server component'ten mevcut oturumu al */
export async function getSession(): Promise<string | null> {
  const jar   = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Request'ten oturumu kontrol et (middleware için) */
export function getSessionFromRequest(req: NextRequest): string | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Çevre değişkenlerinden kimlik bilgilerini doğrula */
export function validateCredentials(username: string, password: string): boolean {
  const validUser = process.env.ADMIN_USERNAME || 'admin';
  const validPass = process.env.ADMIN_PASSWORD || 'crewinjob2026';

  // Zamanlama saldırısına karşı sabit-süre karşılaştırma
  const uBuf = Buffer.from(username);
  const pBuf = Buffer.from(password);
  const vuBuf = Buffer.from(validUser);
  const vpBuf = Buffer.from(validPass);

  const uMatch = uBuf.length === vuBuf.length && timingSafeEqual(uBuf, vuBuf);
  const pMatch = pBuf.length === vpBuf.length && timingSafeEqual(pBuf, vpBuf);
  return uMatch && pMatch;
}
