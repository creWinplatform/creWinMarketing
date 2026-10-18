import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

interface TrackEventBody {
  eventName: string;
  userId?: number;
  metadata?: Record<string, unknown>;
  source?: string;
}

// POST /api/activation/track-event  → TrackActivationEvent proxy
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as TrackEventBody;
    const api = agentModule('modules/api.js');

    if (!api.TRACKED_EVENT_NAMES.includes(body.eventName)) {
      return NextResponse.json({ error: `Bilinmeyen event: ${body.eventName}` }, { status: 400 });
    }

    const result = await api.trackActivationEvent(body.eventName, body.userId, body.metadata, body.source);
    return NextResponse.json({ result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
