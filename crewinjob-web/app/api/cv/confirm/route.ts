import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// POST /api/cv/confirm
// Body: { belgeId: number, onaylananKalemIds?: number[] }
//    veya { belgeId: number, onaylananKalemler?: Array<{taslakKalemId:number,onaylandi:boolean}> }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      belgeId: number;
      onaylananKalemIds?: number[];
      onaylananKalemler?: Array<{ taslakKalemId: number; onaylandi: boolean }>;
      userId?: number;
    };

    if (!body.belgeId) {
      return NextResponse.json({ error: 'belgeId zorunlu' }, { status: 400 });
    }

    const api    = agentModule('modules/api.js');
    const result = await api.confirmParsedCV(body);

    if (body.userId) {
      void api.trackActivationEvent('cv_parse_confirmed', body.userId, { belgeId: body.belgeId, appliedFieldCount: result?.appliedFieldCount }).catch(() => null);
    }

    return NextResponse.json({ result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
