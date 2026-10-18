// ─── E-posta takip linkleri: HMAC imzası + yardımcılar ───────────────────────
// /api/track/open ve /api/track/click oturumsuz çağrılır. uid/campaign imzasız kabul edilirse
// herkes sahte açılma/tıklama event'i üretebilir. Gönderimde `sig` = HMAC-SHA256(uid|campaign)
// eklenir; track route'ları imzayı sabit zamanlı karşılaştırır, imza yoksa/geçersizse event KAYDETMEZ
// (piksel ve yönlendirme yine çalışır → eski e-postalar bozulmaz).
// Secret: TRACKING_SECRET || AUTH_SECRET. Node runtime (crypto modülü) gerektirir.
import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { publicAppUrl } from '@/lib/internal-fetch';

const SIG_LENGTH = 22; // base64url → ~128 bit; URL'yi kısa tutar

function trackingSecret(): string | null {
  const secret = process.env.TRACKING_SECRET || process.env.AUTH_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

/** uid|campaign için kısa imza. Secret yoksa null (link imzasız gider, event kaydedilmez). */
export function signTracking(uid: string | number, campaign?: string | null): string | null {
  const secret = trackingSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update(`${uid}|${campaign ?? ''}`).digest('base64url').slice(0, SIG_LENGTH);
}

/** Sabit zamanlı imza doğrulaması. */
export function verifyTracking(uid: string, campaign: string | null | undefined, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const expected = signTracking(uid, campaign);
  if (!expected) return false;
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function trackingParams(userId: number, campaign?: string): URLSearchParams {
  const params = new URLSearchParams({ uid: String(userId) });
  if (campaign) params.set('campaign', campaign);
  const sig = signTracking(userId, campaign);
  if (sig) params.set('sig', sig);
  return params;
}

/** CTA linkini imzalı tıklama takibine sarar. uid yoksa doğrudan hedef döner. */
export function clickTrackingUrl(userId: number | null | undefined, campaign: string | undefined, target: string): string {
  if (userId == null) return target;
  const params = trackingParams(userId, campaign);
  params.set('url', target);
  return `${publicAppUrl()}/api/track/click?${params.toString()}`;
}

/** Görünmez, imzalı açılma pikseli. uid yoksa boş string. */
export function openPixelTag(userId: number | null | undefined, campaign: string | undefined): string {
  if (userId == null) return '';
  const query = trackingParams(userId, campaign).toString().replace(/&/g, '&amp;');
  return `<img src="${publicAppUrl()}/api/track/open?${query}" width="1" height="1" style="display:none" alt="" />`;
}

// ─── Unsubscribe yardımcıları ────────────────────────────────────────────────

/** Yalnızca http(s)/mailto unsubscribe linklerini kabul eder; diğerleri null. */
export function safeUnsubscribeUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Backend unsubscribe token'ı olmayan (prospect/şirket/manuel) alıcılar için yanıtla-çık adresi. */
export function mailtoUnsubscribeUrl(): string | null {
  const from = (process.env.SMTP_FROM_EMAIL || '').trim();
  if (!from || !/^[^\s@<>"]+@[^\s@<>"]+$/.test(from)) return null;
  return `mailto:${from}?subject=Unsubscribe`;
}

/**
 * List-Unsubscribe başlığına yazılacak URL. Link bu panelin /unsubscribe?token= sayfasıysa
 * RFC 8058 one-click POST'u kabul eden /api/unsubscribe?token= adresine çevrilir;
 * diğer (backend) linkler aynen kullanılır.
 */
export function listUnsubscribeTarget(unsubscribeUrl: string | null | undefined): string | null {
  const safe = safeUnsubscribeUrl(unsubscribeUrl);
  if (!safe) return null;
  const url = new URL(safe);
  const token = url.searchParams.get('token');
  if (token && `${url.origin}${url.pathname.replace(/\/$/, '')}` === `${publicAppUrl()}/unsubscribe`) {
    return `${publicAppUrl()}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  }
  return safe;
}

// ─── Backend çağrı yelpazesini sınırlama ─────────────────────────────────────

/** Görevleri en fazla `limit` eşzamanlı çalıştırır; hatalar yutulur (best-effort event'ler için). */
export async function runTrackingTasks(tasks: Array<() => Promise<unknown>>, limit = 10): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    while (index < tasks.length) {
      const task = tasks[index++];
      try { await task(); } catch { /* best-effort */ }
    }
  });
  await Promise.all(workers);
}

// Track hit'leri için: aynı (event|uid|campaign) kısa sürede tekrar gelirse (görsel proxy prefetch,
// tekrar açma) backend'e yeniden gidilmez; eşzamanlı arka plan çağrısı sayısı da sınırlıdır.
const DEDUPE_TTL_MS = 2 * 60 * 1000;
const DEDUPE_MAX_KEYS = 5000;
const MAX_IN_FLIGHT_HITS = 20;
type HitStore = { seen: Map<string, number>; inFlight: number };
const g = globalThis as typeof globalThis & { __crewinTrackHits?: HitStore };
const hits: HitStore = g.__crewinTrackHits ?? (g.__crewinTrackHits = { seen: new Map(), inFlight: 0 });

/** Bu hit için backend'e event gönderilmeli mi? (tekrar + yük sınırı) */
export function claimTrackingHit(key: string): boolean {
  const now = Date.now();
  const last = hits.seen.get(key);
  if (last !== undefined && now - last < DEDUPE_TTL_MS) return false;
  if (hits.inFlight >= MAX_IN_FLIGHT_HITS) return false;
  if (hits.seen.size >= DEDUPE_MAX_KEYS) {
    const oldest = hits.seen.keys().next().value;
    if (oldest !== undefined) hits.seen.delete(oldest);
  }
  hits.seen.delete(key);
  hits.seen.set(key, now);
  return true;
}

/** Tek hit'in backend çağrılarını (en fazla birkaç tane) sıralı/sınırlı çalıştırır. */
export async function runTrackingHit(tasks: Array<() => Promise<unknown>>): Promise<void> {
  hits.inFlight++;
  try {
    await runTrackingTasks(tasks.slice(0, 3), 2);
  } finally {
    hits.inFlight--;
  }
}
