import { NextRequest, NextResponse } from 'next/server';
import { gscConfigured, createGscClient, dateRangeForDays, googleErrorStatus } from '@/lib/gsc';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  if (!gscConfigured()) {
    return NextResponse.json({ ok: false, notConfigured: true });
  }

  const rangeParam = req.nextUrl.searchParams.get('range') || '30';
  const days = ['7', '30', '90'].includes(rangeParam) ? parseInt(rangeParam) : 30;
  const dateRange = dateRangeForDays(days);

  try {
    const gsc = await createGscClient();

    const [overview, queries, pages, daily] = await Promise.all([
      gsc.query({ ...dateRange }),
      gsc.query({ ...dateRange, dimensions: ['query'],  rowLimit: 10 }),
      gsc.query({ ...dateRange, dimensions: ['page'],   rowLimit: 8  }),
      gsc.query({ ...dateRange, dimensions: ['date'],   rowLimit: 90 }),
    ]);

    return NextResponse.json({ ok: true, overview, queries, pages, daily, fetchedAt: new Date().toISOString() });
  } catch (e: unknown) {
    // Google hatası artık sessizce boş veri olarak dönmez: {ok:false} + uygun HTTP durumu
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Search Console verisi alınamadı' }, { status: googleErrorStatus(e) });
  }
}
