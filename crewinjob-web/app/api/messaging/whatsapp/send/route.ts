import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import { LegacyWhatsAppError, sendLegacyWhatsApp, type LegacyWhatsAppSender } from '@/lib/legacy-whatsapp-consent';
import { crewinIys } from '@/lib/crewin-iys';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

// Tekli, toplu ve şablon gönderimi yalnız izni kayıtlı, çıkış yapmamış numaralara gider (lib/legacy-whatsapp-consent.ts).
// İzinsiz veya çıkmış numara atlanır ve sonuçta sayılır; tekli/şablonda hiçbir şey gönderilmeden 409 döner.
// İYS (lib/crewin-iys.ts): Crewin'in beyanı yoksa hiç gönderim yapılmaz; +90 numaralar ayrıca İYS onayı ister.
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const result = await sendLegacyWhatsApp(body, agentModule<LegacyWhatsAppSender>('modules/messaging-send.js'), undefined, crewinIys(platformDatabase(), credentialEncryptionKey()));
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: err instanceof LegacyWhatsAppError ? err.status : 500 });
  }
}
