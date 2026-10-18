import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectMeasurements } from '@/lib/platform/measurements';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic = 'force-dynamic', maxDuration = 45;
async function handle(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const access = await getPlatformAccess();
    if (!access || access.identity.mode !== 'platform') return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403, headers });
    const service = new ProjectMeasurements(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }, credentialEncryptionKey());
    if (request.method === 'GET') return NextResponse.json(request.nextUrl.searchParams.has('id') ? service.get(request.nextUrl.searchParams.get('id')!) : service.workspace(request.nextUrl.searchParams.get('from') ?? undefined, request.nextUrl.searchParams.get('to') ?? undefined), { headers });
    if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
    const input = await readAuthenticationJson(request);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MarketingStoreError('Geçersiz ölçüm isteği.');
    if (input.action === 'save') return NextResponse.json(service.save(input), { headers });
    if (input.action === 'pause') return NextResponse.json(service.pause(input.id, input.expectedVersion), { headers });
    if (input.action === 'enqueue') return NextResponse.json(service.enqueue(input), { headers });
    if (input.action === 'run') return NextResponse.json(await service.run(input.id), { headers });
    if (input.action === 'cancel') return NextResponse.json(service.cancel(input.id), { headers });
    throw new MarketingStoreError('Geçersiz ölçüm işlemi.');
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Ölçüm tamamlanamadı.' }, { status: error instanceof MarketingStoreError ? error.status : 400, headers });
  }
}
export const GET = handle, POST = handle;
