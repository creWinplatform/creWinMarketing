import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit  = Number(searchParams.get('limit')  ?? '6');
  const userId = searchParams.get('userId') ? Number(searchParams.get('userId')) : null;

  try {
    const api  = agentModule('modules/api.js');
    // İş eşleşme önizlemesi küçük limit (6) kullanır; SEO ilan seçici gibi tarama
    // arayüzleri daha büyük listeye ihtiyaç duyar — üst sınır 100.
    const jobs = await api.getJobListings(userId, Math.min(limit, 100));
    return NextResponse.json({ jobs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
