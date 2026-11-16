import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { markMentions, saveWebWatch, webMentions, webWatch } from '@/lib/platform/web-mentions';
export const dynamic = 'force-dynamic';

// GET: the watch settings and the latest mentions. POST {action:'save', enabled, queries, feeds, language} | {action:'seen', ids}.
async function handle(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const access = await getRyzevoAccess();
    if (!access) return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403, headers });
    const db = platformDatabase(), scope = { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId };
    if (request.method === 'GET') return NextResponse.json({ watch: await webWatch(db, scope), mentions: await webMentions(db, scope) }, { headers });
    if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedJsonBytes(request, 8192))); } catch { throw new MarketingStoreError('Geçersiz istek.'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MarketingStoreError('Geçersiz istek.');
    if (raw.action === 'save') return NextResponse.json({ watch: await saveWebWatch(db, scope, raw), mentions: await webMentions(db, scope) }, { headers });
    if (raw.action === 'seen') return NextResponse.json({ watch: await webWatch(db, scope), mentions: await markMentions(db, scope, raw) }, { headers });
    throw new MarketingStoreError('Geçersiz web takibi işlemi.');
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Web takibi şu anda yüklenemedi.' }, { status: error instanceof MarketingStoreError ? error.status : 500, headers });
  }
}
export const GET = handle, POST = handle;
