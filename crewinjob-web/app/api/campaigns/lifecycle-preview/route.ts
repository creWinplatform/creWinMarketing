import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

async function run(body: Record<string, unknown>) {
  const api = agentModule<{ growthAnalyticsPost: (name: string, body: Record<string, unknown>) => Promise<unknown> }>('modules/api.js');
  try {
    const result = await api.growthAnalyticsPost('PreviewLifecycleAudience', body);
    return NextResponse.json({ available: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lifecycle kitlesi hesaplanamadı.';
    if (/HTTP\s+404|not found|bulunamadı/i.test(message)) {
      return NextResponse.json({ available: false, reason: 'backend_not_ready' });
    }
    return NextResponse.json({ available: false, reason: 'backend_error', error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  return run(await req.json() as Record<string, unknown>);
}

export async function GET(req: NextRequest) {
  return run({ day: Number(req.nextUrl.searchParams.get('day') || 7) });
}
