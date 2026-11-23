import { NextRequest, NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { openProposal } from '@/lib/platform/prospect-workflow';
import { consumeLoginAttempt } from '@/lib/platform/account';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic = 'force-dynamic';
// Public, cookie-free proposal behind a link (the same fragment-token pattern as the mini analysis).
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
export async function POST(request: NextRequest) {
  if (!request.headers.get('origin') || !hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
  try {
    const input = await readAuthenticationJson(request) as { token?: unknown; preview?: unknown } | null, db = platformDatabase(), token = input && typeof input === 'object' ? input.token : undefined;
    const proposal = typeof token === 'string' && token.length === 43 && await consumeLoginAttempt(db, `proposal-view:${token}`) ? await openProposal(db, token, input?.preview === true) : null;
    if (!proposal) throw new Error('Unavailable.');
    return NextResponse.json(proposal, { headers });
  } catch { return NextResponse.json({ error: 'Bu teklif bağlantısı geçersiz, süresi dolmuş veya kapatılmış.' }, { status: 404, headers }); }
}
