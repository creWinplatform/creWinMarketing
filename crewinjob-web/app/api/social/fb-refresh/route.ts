/**
 * GET  /api/social/fb-refresh  — Token durumunu kontrol eder
 * POST /api/social/fb-refresh  — Kısa ömürlü Facebook token'ını uzun ömürlü Page token'ına çevirir
 *
 * Kullanım:
 *   POST { "shortToken": "EAA..." }
 *   Döner: { ok: true, pageToken: "EAA...", pageName: "Crewin", pageId: "..." }
 *
 * Production'da Facebook Graph Explorer yerine OAuth flow kullanın (callback handler).
 * Bu endpoint sadece manuel token yenileme için yardımcıdır.
 */
import { NextRequest, NextResponse } from 'next/server';

const APP_ID     = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const PAGE_ID    = process.env.FACEBOOK_PAGE_ID;

/** Mevcut Page token'ının son kullanma tarihini ve debug bilgisini döner */
export async function GET() {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'FACEBOOK_PAGE_ACCESS_TOKEN tanımlı değil' });
  }

  // Token debug bilgisi — süre dolmuş mu?
  const dbRes  = await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`);
  const dbData = await dbRes.json() as Record<string, unknown>;

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

  const { shortToken } = await req.json() as { shortToken?: string };
  const inputToken = shortToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!inputToken) {
    return NextResponse.json({ ok: false, error: 'shortToken body\'da gönderilmeli veya FACEBOOK_PAGE_ACCESS_TOKEN tanımlı olmalı' });
  }

  // Adım 1: Kısa ömürlü user token → Uzun ömürlü user token (~60 gün)
  const longRes  = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${inputToken}`
  );
  const longData = await longRes.json() as Record<string, unknown>;
  if (!longRes.ok || longData.error) {
    const err = (longData.error as Record<string, string>) || {};
    return NextResponse.json({ ok: false, error: err.message || JSON.stringify(longData) });
  }

  const longToken = longData.access_token as string;

  // Adım 2: Uzun ömürlü user token'dan Page Access Token al (süresiz)
  const targetPage = PAGE_ID || 'me';
  const pagesRes   = await fetch(`https://graph.facebook.com/v19.0/${targetPage}?fields=name,access_token&access_token=${longToken}`);
  const pagesData  = await pagesRes.json() as Record<string, unknown>;

  const pageToken = (pagesData.access_token as string) || longToken;
  const pageName  = (pagesData.name as string) || '';
  const pageId    = (pagesData.id as string) || '';

  // Page token süresini kontrol et
  const dbRes  = await fetch(`https://graph.facebook.com/debug_token?input_token=${pageToken}&access_token=${pageToken}`);
  const dbData = await dbRes.json() as Record<string, unknown>;
  const info   = (dbData.data as Record<string, unknown>) || {};
  const expAt  = info.expires_at as number;

  return NextResponse.json({
    ok:         true,
    pageToken,
    pageName,
    pageId,
    neverExp:   expAt === 0,
    expiresAt:  expAt === 0 ? 'Hiç sona ermiyor ✅' : new Date(expAt * 1000).toISOString(),
    instruction: `Bu token'ı .env.local (veya production env) dosyasındaki FACEBOOK_PAGE_ACCESS_TOKEN değerine yapıştır.`,
  });
}
