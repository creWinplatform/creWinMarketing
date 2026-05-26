import { NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import type { AllData } from '@/lib/types';

// Sunucu tarafında her request'te taze veri — Next.js static cache'ini devre dışı bırak
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const api  = agentModule<{ fetchAllData: () => Promise<AllData> }>('modules/api.js');
    const data = await api.fetchAllData();
    return NextResponse.json({
      seafarers:  data.seafarers,
      jobs:       data.jobs,
      incomplete: data.incomplete,
      sources:    data.sources,
      isRealData: data.isRealData,
      fetchedAt:  data.fetchedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
