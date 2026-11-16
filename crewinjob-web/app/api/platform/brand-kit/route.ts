import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { BrandKits } from '@/lib/platform/brand-kit';
export const dynamic = 'force-dynamic';

// GET: the project's brand kit. PUT: save it (the logo travels as base64, at most 400 KB, so the body is bounded at 600 KB).
async function handle(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const access = await getRyzevoAccess();
    if (!access) return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403, headers });
    const kits = new BrandKits(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId });
    if (request.method === 'GET') return NextResponse.json(await kits.read(), { headers });
    if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedJsonBytes(request, 600 * 1024))); } catch { throw new MarketingStoreError('Geçersiz istek.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MarketingStoreError('Geçersiz istek.');
    return NextResponse.json(await kits.save(body as Record<string, unknown>), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Marka kiti şu anda yüklenemedi.' }, { status: error instanceof MarketingStoreError ? error.status : 500, headers });
  }
}
export const GET = handle, PUT = handle;
