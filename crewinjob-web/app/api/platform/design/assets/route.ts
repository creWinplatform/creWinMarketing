import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { aiPicture, geminiImageGenerator, searchStock, stockPicture } from '@/lib/platform/design-assets';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Design studio pictures: {action:'stock-search', query} · {action:'stock-image', id} · {action:'ai-image', prompt, aspect,
// source?} (source: a product photo the browser scaled to at most 1024 px, so the body stays under 1 MB).
export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const access = await getRyzevoAccess();
    if (!access) return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403, headers });
    if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedJsonBytes(request, 1024 * 1024))); } catch { throw new MarketingStoreError('Geçersiz istek.'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MarketingStoreError('Geçersiz istek.');
    const db = platformDatabase(), scope = { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId };
    if (raw.action === 'stock-search') return NextResponse.json({ items: await searchStock(db, scope, raw) }, { headers });
    if (raw.action === 'stock-image') return NextResponse.json(await stockPicture(db, scope, raw), { headers });
    if (raw.action === 'ai-image') return NextResponse.json(await aiPicture(db, scope, raw, geminiImageGenerator()), { headers });
    throw new MarketingStoreError('Geçersiz görsel işlemi.');
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Görsel işlemi tamamlanamadı.' }, { status: error instanceof MarketingStoreError ? error.status : 500, headers });
  }
}
