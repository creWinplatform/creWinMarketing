import { NextRequest, NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { openProspectAnalysis } from '@/lib/platform/prospect-finder';
import { consumeLoginAttempt } from '@/lib/platform/account';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic = 'force-dynamic';
// Public, cookie-free mini analysis: the page posts the token it read from its own URL fragment, so the token never
// appears in a request URL, a server log or a Referer header. Unknown, expired, revoked and rate-limited links get the
// same answer.
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
export async function POST(request: NextRequest) {
  if (!request.headers.get('origin') || !hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
  try {
    const input = await readAuthenticationJson(request) as { token?: unknown; preview?: unknown } | null, db = platformDatabase(), token = input && typeof input === 'object' ? input.token : undefined;
    const analysis = typeof token === 'string' && token.length === 43 && await consumeLoginAttempt(db, `analysis-view:${token}`) ? await openProspectAnalysis(db, token, input?.preview === true) : null;
    if (!analysis) throw new Error('Unavailable.');
    return NextResponse.json(analysis, { headers });
  } catch { return NextResponse.json({ error: 'Bu analiz bağlantısı geçersiz, süresi dolmuş veya kapatılmış.' }, { status: 404, headers }); }
}
