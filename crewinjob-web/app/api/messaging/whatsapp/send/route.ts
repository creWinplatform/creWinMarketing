import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import { LegacyWhatsAppError, sendLegacyWhatsApp, type LegacyWhatsAppSender } from '@/lib/legacy-whatsapp-consent';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

// Tekli, toplu ve şablon gönderimi yalnız izni kayıtlı, çıkış yapmamış numaralara gider (lib/legacy-whatsapp-consent.ts).
// İzinsiz veya çıkmış numara atlanır ve sonuçta sayılır; tekli/şablonda hiçbir şey gönderilmeden 409 döner.
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const result = await sendLegacyWhatsApp(body, agentModule<LegacyWhatsAppSender>('modules/messaging-send.js'));
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: err instanceof LegacyWhatsAppError ? err.status : 500 });
  }
}
