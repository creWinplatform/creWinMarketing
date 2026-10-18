import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// Bu route pazarlama/admin panelinden çağrılır — kullanıcı-bazlı endpoint olduğu için
// userId ZORUNLU (backend spesifikasyonu). Seafarer kendi hesabından çağırırken
// userId göndermeden de çalışabilir, ama bu panel her zaman belirli bir kullanıcıyı sorgular.
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: '"userId" zorunludur.' }, { status: 400 });
    }
    const api = agentModule('modules/api.js');
    const result = await api.getProfileVisibilityGain(userId);
    return NextResponse.json({ result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
