import { NextRequest, NextResponse } from 'next/server';
import { backendStatus, marketingBackend } from '@/lib/marketing-backend';
import { projectAutomationResponse } from '@/lib/platform/marketing-routes';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  const scoped = await projectAutomationResponse(req);
  if (scoped) return scoped;
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const endpoint = params.summary === 'true' ? 'GetStatus' : params.id ? 'Get' : 'GetAll';
  delete params.summary;
  try {
    return NextResponse.json(await marketingBackend().marketingAutomationJobGet(endpoint, params));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Otomasyon işleri alınamadı.' }, { status: backendStatus(error) });
  }
}

export async function POST(req: NextRequest) {
  const scoped = await projectAutomationResponse(req);
  if (scoped) return scoped;
  const body = await req.json() as Record<string, unknown>;
  const endpoint = body.action === 'cancel' ? 'Cancel' : 'Enqueue';
  const payload = endpoint === 'Cancel' ? { id: body.id } : Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'action'));
  try {
    return NextResponse.json(await marketingBackend().marketingAutomationJobPost(endpoint, payload));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Otomasyon işlemi tamamlanamadı.' }, { status: backendStatus(error) });
  }
}
