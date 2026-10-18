import { NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import type { AllData, BreakdownData } from '@/lib/types';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const api = agentModule<{
      fetchAllData:    () => Promise<AllData>;
      getBreakdownData: () => Promise<BreakdownData>;
    }>('modules/api.js');

    const [allData, breakdown] = await Promise.all([
      api.fetchAllData(),
      api.getBreakdownData(),
    ]);

    // Son 7 günlük günlük kayıt eğrisi
    const dailyReg = allData.seafarers?.dailyRegistrations ?? [];

    return NextResponse.json({
      seafarers:          allData.seafarers,
      jobs:               allData.jobs,
      fillRateBuckets:    allData.seafarers?.fillRateBuckets,
      dailyRegistrations: dailyReg,
      topCountries:       breakdown.countries.slice(0, 10),
      topPositions:       breakdown.positions.slice(0, 10),
      isRealData:         Boolean(allData.isRealData),
      partial:            Boolean(allData.partial),
      // Yalnızca kısa string hata metinleri (endpoint + HTTP durumu)
      apiErrors:          Array.isArray(allData.apiErrors)
        ? allData.apiErrors.filter((item): item is string => typeof item === 'string').slice(0, 20).map(item => item.slice(0, 200))
        : [],
      // dailyRegistrations[0] = 6 gün önce, son eleman = bugün (fetchedAt'e göre)
      fetchedAt:          allData.fetchedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
