// ─── Legacy Crewin panel: own one-click unsubscribe for recipients without a backend token ──────────────────
// Prospect, company and manually entered recipients get no unsubscribe token from the Crewin backend. The panel
// issues its own signed, expiring link instead. The token carries only a one-way key of the address (never the
// address itself); unsubscribing adds that key to data/email-suppressions.json, and every legacy marketing send
// skips suppressed addresses.
import 'server-only';
import path from 'path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readJson, withFileLock, writeJsonAtomic } from './json-store';

export const LEGACY_SUPPRESSIONS_FILE = path.join(process.cwd(), 'data', 'email-suppressions.json');
const PREFIX = 'cwl1_';
const VALID_DAYS = 365;
const MAX_ENTRIES = 100000;
const TOKEN_RE = /^cwl1_([A-Za-z0-9_-]{43})\.(\d{5,6})\.([A-Za-z0-9_-]{22})$/;

type Suppressions = Record<string, { reason: 'unsubscribe'; at: string }>;

function secret(): string | null {
  const value = process.env.TRACKING_SECRET || process.env.AUTH_SECRET;
  return value && value.length >= 16 ? value : null;
}
const today = () => Math.floor(Date.now() / 86400000);
const signature = (key: string, expires: number, value: string) =>
  createHmac('sha256', value).update(`legacy-unsubscribe-v1:${key}.${expires}`).digest('base64url').slice(0, 22);

/** One-way key of an address; the same address always gives the same key. */
export function legacyEmailKey(email: string): string | null {
  const value = secret();
  return value ? createHmac('sha256', value).update(`legacy-email-v1:${email.trim().toLowerCase()}`).digest('base64url') : null;
}

export const isLegacyUnsubscribe = (token: string) => token.startsWith(PREFIX);

/** /unsubscribe link for one address, valid for a year; null when the server has no signing secret or base URL. */
export function legacyUnsubscribeUrl(email: string, baseUrl: string): string | null {
  const value = secret(), key = legacyEmailKey(email);
  if (!value || !key || !/^https?:\/\/[^/]+$/.test(baseUrl)) return null;
  const expires = today() + VALID_DAYS;
  return `${baseUrl}/unsubscribe?token=${encodeURIComponent(`${PREFIX}${key}.${expires}.${signature(key, expires, value)}`)}`;
}

/** Verifies the token and records the opt-out. Repeating it is harmless. Throws on an invalid or expired link. */
export async function processLegacyUnsubscribe(token: string, file = LEGACY_SUPPRESSIONS_FILE): Promise<{ unsubscribed: true }> {
  const value = secret(), match = TOKEN_RE.exec(token);
  if (!value || !match) throw new Error('invalid');
  const [, key, expiresText, given] = match, expires = Number(expiresText);
  const wanted = Buffer.from(signature(key, expires, value)), actual = Buffer.from(given);
  if (wanted.length !== actual.length || !timingSafeEqual(wanted, actual) || expires < today()) throw new Error('invalid');
  await withFileLock(file, () => {
    const list = readJson<Suppressions>(file, {});
    if (list[key]) return;
    if (Object.keys(list).length >= MAX_ENTRIES) throw new Error('full');
    list[key] = { reason: 'unsubscribe', at: new Date().toISOString() };
    writeJsonAtomic(file, list);
  });
  return { unsubscribed: true };
}

/** Lower-cased addresses from `emails` that have unsubscribed through a legacy link. */
export function legacySuppressed(emails: string[], file = LEGACY_SUPPRESSIONS_FILE): Set<string> {
  const list = readJson<Suppressions>(file, {}), out = new Set<string>();
  for (const email of emails) {
    const key = legacyEmailKey(email);
    if (key && list[key]) out.add(email.trim().toLowerCase());
  }
  return out;
}
