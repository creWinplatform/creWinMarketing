import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

type ProspectApi = {
  marketingProspectPost: (endpoint: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  marketingProspectGet: (endpoint: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

// Servis token'ı ile backend'e geçirilen MarketingProspect metotları — yalnızca UI'ın gerçekten
// çağırdıkları (ProspectFinderPanel + CampaignHubTab). Listede olmayan her şey 404.
// Not: DispatchCampaign / GetDispatchStatus lib/campaign-dispatch.ts içinden doğrudan api.js ile
// çağrılır; tarayıcıdan bu proxy üzerinden çağrılmaları gerekmez (kampanya onay akışı atlanmasın).
const GET_ALLOW = new Set([
  'GetCapabilities',
  'GetProviderStatus',
  'GetResearchSources',
  'GetAll',
  'GetResearchStatus',     // ?jobId= / ?id= adayları
  'GetSuppressionStatus',
]);
const POST_ALLOW = new Set([
  'StartResearch',
  'GetResearchStatus',     // bazı backend sürümlerinde POST { id }
  'Upsert',
  'MatchCompany',
  'AddActivity',
  'ImportJson',
  'UpdateStatus',
  'VerifyEmails',
  'Suppress',
  'Preflight',
]);
const SEGMENT_RE = /^[A-Za-z0-9]+$/;

/** Tek segmentli, alfanümerik ve allow-list'teki metot adı; değilse null. */
function endpointName(endpoint: string[] | undefined, allow: Set<string>): string | null {
  const parts = (endpoint || []).filter(Boolean);
  if (parts.length !== 1 || !SEGMENT_RE.test(parts[0])) return null;
  return allow.has(parts[0]) ? parts[0] : null;
}

function notFound() {
  return NextResponse.json({ error: 'Bilinmeyen prospect işlemi.' }, { status: 404 });
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Prospect servisi kullanılamıyor.';
  if (/ResearchEnabled\s*=\s*false/i.test(message)) {
    return NextResponse.json({ available: false, reason: 'feature_disabled', error: 'AI araştırma özelliği şu an devre dışı.' }, { status: 503 });
  }
  if (/aborted due to timeout|timeout|TimeoutError/i.test(message)) {
    return NextResponse.json({
      available: false,
      reason: 'timeout',
      error: 'AI araştırma servisi zamanında yanıt vermedi. İşlem backend kuyruğuna alınmış olabilir; Lead havuzunu yenileyin veya tekrar deneyin.',
    }, { status: 504 });
  }
  const status = /HTTP\s+401/i.test(message) ? 401 : /HTTP\s+403/i.test(message) ? 403 : /HTTP\s+404|HTTP\s+405/i.test(message) ? 503 : 502;
  return NextResponse.json({
    available: false,
    reason: status === 503 ? 'backend_not_ready' : status === 401 ? 'authentication_required' : status === 403 ? 'permission_denied' : 'backend_error',
    error: message,
  }, { status });
}

export async function GET(req: NextRequest, context: { params: Promise<{ endpoint: string[] }> }) {
  const name = endpointName((await context.params).endpoint, GET_ALLOW);
  if (!name) return notFound();
  try {
    const api = agentModule<ProspectApi>('modules/api.js');
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    return NextResponse.json(await api.marketingProspectGet(name, params));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ endpoint: string[] }> }) {
  const name = endpointName((await context.params).endpoint, POST_ALLOW);
  if (!name) return notFound();
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json() as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Geçersiz JSON gövdesi.' }, { status: 400 });
  }
  try {
    const api = agentModule<ProspectApi>('modules/api.js');
    return NextResponse.json(await api.marketingProspectPost(name, body));
  } catch (error) {
    return errorResponse(error);
  }
}
