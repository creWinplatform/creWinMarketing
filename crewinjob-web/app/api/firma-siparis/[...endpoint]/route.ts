import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// ABP standardina gecis sonrasi GET metotlari Get* onekiyle yayinlaniyor.
const GET_ENDPOINTS = new Set([
  'GetMyOrders',
  'GetAll',
  'GetSiparisDurumu',
]);

function endpointOf(params: { endpoint?: string[] }) {
  return (params.endpoint || []).join('/');
}

function errorResponse(err: unknown) {
  const status = typeof err === 'object' && err && 'status' in err && typeof err.status === 'number'
    ? err.status
    : 500;
  const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ endpoint?: string[] }> }) {
  const endpoint = endpointOf((await ctx.params));
  if (!GET_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: 'Desteklenmeyen firma sipariş endpointi' }, { status: 404 });
  }

  try {
    const api = agentModule<{
      firmaSiparisGet: (endpoint: string, params: Record<string, string>) => Promise<unknown>;
    }>('modules/api.js');
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const result = await api.firmaSiparisGet(endpoint, params);
    return NextResponse.json({ result });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
