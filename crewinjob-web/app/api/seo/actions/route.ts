import { NextRequest, NextResponse } from 'next/server';
import { backendStatus, marketingBackend } from '@/lib/marketing-backend';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'SiteSeo iş kartı işlemi tamamlanamadı.' }, { status: backendStatus(error) });
}

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const view = params.view || 'all';
  delete params.view;
  const endpoint = view === 'summary' ? 'GetSummary' : view === 'recommendation' ? 'GetByRecommendation' : params.id ? 'Get' : 'GetAll';
  try {
    return NextResponse.json(await marketingBackend().siteSeoActionGet(endpoint, params));
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action || 'save');
  const endpoint = action === 'status' ? 'UpdateStatus' : action === 'assign' ? 'Assign' : 'CreateOrUpdate';
  const payload = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'action'));
  try {
    return NextResponse.json(await marketingBackend().siteSeoActionPost(endpoint, payload));
  } catch (error) { return failure(error); }
}
