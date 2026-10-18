import { NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// Agregat endpoint — userId GÖNDERİLMEZ. Response: { segments, totalProfiles }
export async function GET() {
  try {
    const api = agentModule('modules/api.js');
    const { segments, totalProfiles } = await api.getIncompleteProfileSegments();
    return NextResponse.json({ segments, totalProfiles });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
