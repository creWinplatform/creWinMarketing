import { NextResponse } from 'next/server';
import { marketingBackend } from '@/lib/marketing-backend';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await marketingBackend().marketingCalendarGet('GetScheduledPostStatus', { id });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Planlı gönderi durumu alınamadı.' },
      { status: Number((error as { status?: number }).status || 502) },
    );
  }
}
