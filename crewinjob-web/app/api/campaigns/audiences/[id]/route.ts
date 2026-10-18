import { NextRequest, NextResponse } from 'next/server';
import { getSavedAudienceStore } from '@/lib/saved-audiences';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (params.id.startsWith('aud_')) {
    if (!getSavedAudienceStore().remove(params.id)) return NextResponse.json({ error: 'Kayıtlı kitle bulunamadı.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  const api = agentModule<{ marketingCampaignPost: (name: string, body: Record<string, unknown>) => Promise<unknown> }>('modules/api.js');
  try {
    await api.marketingCampaignPost('DeleteSavedAudience', { id: params.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kitle silinemedi.';
    const status = /HTTP\s+404/i.test(message) ? 404 : /HTTP\s+403/i.test(message) ? 403 : 502;
    return NextResponse.json({ error: status === 403 ? 'Kitleyi silmek için yetki gerekiyor.' : 'Kitle backend üzerinden silinemedi.' }, { status });
  }
  return NextResponse.json({ ok: true });
}
