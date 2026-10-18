import { NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import type { AllData } from '@/lib/types';

// Sunucu tarafında her request'te taze veri — Next.js static cache'ini devre dışı bırak
export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

/** apiErrors yalnızca kısa metinler olarak iletilir (obje/stack/yanıt gövdesi sızmaz). */
function safeApiErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .slice(0, 20)
    .map(item => item.slice(0, 200));
}

export async function GET() {
  try {
    const api  = agentModule<{ fetchAllData: () => Promise<AllData> }>('modules/api.js');
    const data = await api.fetchAllData();
    const apiErrors = safeApiErrors(data.apiErrors);
    return NextResponse.json({
      seafarers:  data.seafarers,
      jobs:       data.jobs,
      incomplete: data.incomplete,
      sources:    data.sources,
      // isRealData: en az bir çağrı başarılı; partial: bazı çağrılar başarısız (badge sarı)
      isRealData: Boolean(data.isRealData),
      partial:    Boolean(data.partial) || (Boolean(data.isRealData) && apiErrors.length > 0),
      apiErrors,
      fetchedAt:  data.fetchedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message, isRealData: false }, { status: 500 });
  }
}
