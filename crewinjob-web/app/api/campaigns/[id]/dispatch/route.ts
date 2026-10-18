import { NextRequest, NextResponse } from 'next/server';
import { createCampaignDispatch, mutateCampaignDispatch, refreshCampaignDispatch } from '@/lib/campaign-dispatch';
import { isRemoteOnlyCampaignId } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

function remoteOnlyResponse() {
  return NextResponse.json({ error: 'Bu kampanya yalnızca backend\'de kayıtlı; gönderimini backend yönetiminden yönetin. / This campaign exists only in the backend; manage it there.', code: 'remote_only' }, { status: 409 });
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Dispatch işlemi başarısız.';
  const code = (error as { code?: string }).code;
  const status = /bulunamadı/i.test(message) ? 404 : /HTTP\s+403|yetki/i.test(message) ? 403 : /HTTP\s+401/i.test(message) ? 401 : 409;
  return NextResponse.json({ error: status === 403 ? 'Background dispatch için yetki gerekiyor.' : message, ...(code ? { code } : {}) }, { status });
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (isRemoteOnlyCampaignId(params.id)) return remoteOnlyResponse();
  try { return NextResponse.json(await refreshCampaignDispatch(params.id)); }
  catch (error) { return responseError(error); }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (isRemoteOnlyCampaignId(params.id)) return remoteOnlyResponse();
  try {
    const body = await req.json().catch(() => ({})) as { action?: 'cancel' | 'retry' };
    return NextResponse.json(body.action ? await mutateCampaignDispatch(params.id, body.action) : await createCampaignDispatch(params.id));
  } catch (error) { return responseError(error); }
}
