import { NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';

const nativeRequire = eval('require') as NodeRequire;
function agentModule(relPath: string) {
  return nativeRequire(path.join(process.cwd(), '..', 'crewinjob-agent', relPath));
}

/** WhatsApp ve Telegram yapılandırma durumunu döndürür (gizli bilgiler maskelenir) */
export async function GET() {
  try {
    const send = agentModule('modules/messaging-send.js');
    const config = send.getConfigStatus();
    return NextResponse.json(config);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
