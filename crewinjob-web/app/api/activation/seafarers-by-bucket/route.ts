import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bucket = searchParams.get('bucket') as 'zero' | 'low' | 'mid' | 'high' | null;
  const page   = Number(searchParams.get('page') ?? '1');
  const size   = Number(searchParams.get('size') ?? '200');

  if (!bucket || !['zero', 'low', 'mid', 'high'].includes(bucket)) {
    return NextResponse.json({ error: '"bucket" zorunludur: zero | low | mid | high' }, { status: 400 });
  }

  try {
    const api = agentModule('modules/api.js');
    // { items: EmailRecipient[], totalCount: number | null }
    const result = await api.getSeafarersByFillBucket(bucket, page, size);
    return NextResponse.json({ items: result.items, totalCount: result.totalCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
