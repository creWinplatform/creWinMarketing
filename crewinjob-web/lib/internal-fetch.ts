// ─── Dahili (sunucu → kendi API'si) çağrılar ─────────────────────────────────
// Route handler'lar başka bir route'u HTTP ile çağırırken bunu kullanır:
// - Hedef her zaman bu sürecin kendisidir (Host başlığından türetilmez → cookie başka origin'e gitmez)
// - Kısa ömürlü (5 dk) servis oturumu cookie'si eklenir; middleware'den geçer
import 'server-only';
import { COOKIE_NAME, createSessionToken } from '@/lib/auth';

const INTERNAL_TOKEN_TTL_MS = 5 * 60 * 1000;

/** Sunucunun kendine ulaştığı adres. Varsayılan: http://127.0.0.1:$PORT (3033). */
export function internalBaseUrl(): string {
  return (process.env.INTERNAL_APP_URL || `http://127.0.0.1:${process.env.PORT || 3033}`).replace(/\/$/, '');
}

/** Dışarıya (e-posta linkleri, OAuth callback vb.) gösterilen public adres. */
export function publicAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3033').replace(/\/$/, '');
}

export async function internalFetch(path: string, init: RequestInit = {}, actor = 'internal-runner'): Promise<Response> {
  const token   = await createSessionToken(actor, INTERNAL_TOKEN_TTL_MS);
  const headers = new Headers(init.headers);
  headers.set('Cookie', `${COOKIE_NAME}=${token}`);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${internalBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers, cache: 'no-store' });
}
