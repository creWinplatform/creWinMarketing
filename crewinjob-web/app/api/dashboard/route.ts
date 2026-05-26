import { NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import type { AllData, BreakdownData } from '@/lib/types';

export const dynamic = 'force-dynamic';

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
      isRealData:         allData.isRealData,
      fetchedAt:          allData.fetchedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
