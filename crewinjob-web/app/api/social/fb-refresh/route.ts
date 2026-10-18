/**
 * GET  /api/social/fb-refresh  — Token durumunu kontrol eder
 * POST /api/social/fb-refresh  — Kısa ömürlü Facebook token'ını uzun ömürlü Page token'ına çevirir
 *
 * Kullanım:
 *   POST { "shortToken": "EAA..." }
 *   Döner: { ok: true, pageTokenMasked: "EAAB…x9Z", pageName: "Crewin", pageId: "...", expiresAt, stored: true }
 *
 * Uzun ömürlü token tarayıcıya DÖNDÜRÜLMEZ — sunucuda data/social-tokens.json'a yazılır.
 * Production'da Facebook Graph Explorer yerine OAuth flow kullanın (callback handler).
 * Bu endpoint sadece manuel token yenileme için yardımcıdır.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getToken, graphFetch, graphUrl, setToken } from '@/lib/social-tokens';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const APP_ID     = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const PAGE_ID    = process.env.FACEBOOK_PAGE_ID;

/** Token'ın yalnızca baş/son birkaç karakteri — tanıma için yeterli, kullanılamaz */
function maskToken(token: string): string {
  return token.length > 12 ? `${token.slice(0, 4)}…${token.slice(-3)}` : '…';
}

/** debug_token: app token (APP_ID|SECRET) varsa onunla, yoksa token kendisini sorgular. Token'lar URL'ye değil başlığa. */
async function debugToken(token: string): Promise<Record<string, unknown>> {
  const inspector = APP_ID && APP_SECRET ? `${APP_ID}|${APP_SECRET}` : token;
  const res = await graphFetch(`debug_token?input_token=${encodeURIComponent(token)}`, inspector);
  return await res.json() as Record<string, unknown>;
}

/** Mevcut Page token'ının son kullanma tarihini ve debug bilgisini döner */
export async function GET() {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || getToken('facebook')?.accessToken;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'FACEBOOK_PAGE_ACCESS_TOKEN tanımlı değil' });
  }

  // Token debug bilgisi — süre dolmuş mu?
  const dbData = await debugToken(token);

  if (dbData.error) {
    const err = dbData.error as Record<string, string>;
    return NextResponse.json({ ok: false, error: err.message, code: err.code });
  }

  const info     = dbData.data as Record<string, unknown>;
  const isValid  = info?.is_valid as boolean;
  const expAt    = info?.expires_at as number;  // UNIX timestamp, 0 = never
  const neverExp = expAt === 0;
  const expDate  = expAt && !neverExp ? new Date(expAt * 1000).toISOString() : 'Hiç sona ermiyor';
  const scopes   = (info?.scopes as string[]) || [];

  return NextResponse.json({
    ok:        isValid,
    valid:     isValid,
    expiresAt: expDate,
    neverExp,
    scopes,
    appId:     info?.app_id,
    tokenType: info?.type,
  });
}

/** Kısa ömürlü token'ı uzun ömürlü Page token'ına çevirir */
export async function POST(req: NextRequest) {
  if (!APP_ID || !APP_SECRET) {
    return NextResponse.json({ ok: false, error: 'FACEBOOK_APP_ID veya FACEBOOK_APP_SECRET eksik' });
  }

  const { shortToken } = await req.json().catch(() => ({})) as { shortToken?: string };
  const inputToken = shortToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!inputToken) {
    return NextResponse.json({ ok: false, error: 'shortToken body\'da gönderilmeli veya FACEBOOK_PAGE_ACCESS_TOKEN tanımlı olmalı' });
  }

  // Adım 1: Kısa ömürlü user token → Uzun ömürlü user token (~60 gün). Secret URL'de değil POST gövdesinde.
  const longRes  = await fetch(graphUrl('oauth/access_token'), {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:        'fb_exchange_token',
      client_id:         APP_ID,
      client_secret:     APP_SECRET,
      fb_exchange_token: inputToken,
    }),
  });
  const longData = await longRes.json() as Record<string, unknown>;
  if (!longRes.ok || longData.error) {
    const err = (longData.error as Record<string, string>) || {};
    return NextResponse.json({ ok: false, error: err.message || 'Token değişimi başarısız' });
  }

  const longToken = longData.access_token as string;

  // Adım 2: Uzun ömürlü user token'dan Page Access Token al (süresiz)
  const targetPage = PAGE_ID ? encodeURIComponent(PAGE_ID) : 'me';
  const pagesRes   = await graphFetch(`${targetPage}?fields=id,name,access_token`, longToken);
  const pagesData  = await pagesRes.json() as Record<string, unknown>;

  const pageToken = (pagesData.access_token as string) || longToken;
  const pageName  = (pagesData.name as string) || '';
  const pageId    = (pagesData.id as string) || PAGE_ID || '';

  // Page token süresini kontrol et
  const dbData = await debugToken(pageToken);
  const info   = (dbData.data as Record<string, unknown>) || {};
  const expAt  = Number(info.expires_at ?? NaN);
  const neverExp = expAt === 0;

  // Token sunucuda saklanır (tarayıcıya gitmez). FACEBOOK_PAGE_ACCESS_TOKEN env'i tanımlıysa o öncelikli kalır.
  setToken('facebook', {
    accessToken: pageToken,
    pageId:      pageId || undefined,
    pageName:    pageName || undefined,
    expiresAt:   Number.isFinite(expAt) && expAt > 0 ? expAt * 1000 : undefined,
  });

  return NextResponse.json({
    ok:              true,
    stored:          true,
    pageTokenMasked: maskToken(pageToken),
    pageName,
    pageId,
    neverExp,
    expiresAt:       neverExp ? 'Hiç sona ermiyor ✅' : Number.isFinite(expAt) ? new Date(expAt * 1000).toISOString() : 'Bilinmiyor',
    instruction:     'Yeni Page token sunucuda data/social-tokens.json dosyasına kaydedildi. .env.local\'daki FACEBOOK_PAGE_ACCESS_TOKEN tanımlıysa öncelikli kullanılır — eskimişse kaldırın veya sunucudaki dosyadan güncelleyin.',
  });
}
