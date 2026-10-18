import { NextRequest, NextResponse } from 'next/server';
import { backendStatus, marketingBackend } from '@/lib/marketing-backend';
import { projectConnectionResponse } from '@/lib/platform/marketing-routes';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  const scoped = await projectConnectionResponse(req);
  if (scoped) return scoped;
  const params = Object.fromEntries(req.nextUrl.searchParams);
  try {
    return NextResponse.json(await marketingBackend().marketingIntegrationConnectionGet(params.id ? 'Get' : 'GetAll', params));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bağlantılar alınamadı.' }, { status: backendStatus(error) });
  }
}

export async function POST(req: NextRequest) {
  const scoped = await projectConnectionResponse(req);
  if (scoped) return scoped;
  const body = await req.json() as Record<string, unknown>;
  const endpoint = body.action === 'revoke' ? 'RevokeConnection' : 'SaveConnection';
  const payload = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'action'));
  try {
    return NextResponse.json(await marketingBackend().marketingIntegrationConnectionPost(endpoint, payload));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bağlantı işlemi tamamlanamadı.' }, { status: backendStatus(error) });
  }
}
