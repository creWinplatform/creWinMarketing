import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readBoundedBodyBytes } from '@/lib/platform/request-json';
import { EXPERT_PART_BYTES } from '@/lib/platform/experts-types';
import { Experts } from '@/lib/platform/experts';
export const dynamic = 'force-dynamic';

// GET ?request=&file= : one delivered file of an expert request, for the client project and the partner's team only.
// PUT ?file=&part= : one part (binary body) of a delivery file the partner is uploading.
export async function GET(request: NextRequest) {
  try {
    const access = await getRyzevoAccess();
    if (!access) return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403 });
    const url = new URL(request.url), file = await new Experts(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }).file(url.searchParams.get('request') || '', url.searchParams.get('file') || '');
    const name = encodeURIComponent(file.name), inline = url.searchParams.get('download') !== '1' && file.mime !== 'application/pdf';
    return new NextResponse(new Uint8Array(file.data), { headers: { 'Content-Type': file.mime, 'Content-Length': String(file.data.length), 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Dosya yüklenemedi.' }, { status: error instanceof MarketingStoreError ? error.status : 500 });
  }
}
export async function PUT(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const access = await getRyzevoAccess();
    if (!access) return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403, headers });
    if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
    let data: Uint8Array;
    try { data = await readBoundedBodyBytes(request, EXPERT_PART_BYTES); } catch { throw new MarketingStoreError('Dosya parçası okunamadı veya çok büyük.', 413); }
    const url = new URL(request.url);
    return NextResponse.json(await new Experts(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }).filePart(url.searchParams.get('file'), url.searchParams.get('part'), data), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Dosya parçası yüklenemedi.' }, { status: error instanceof MarketingStoreError ? error.status : 500, headers });
  }
}
