import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // Arayüzden gelen count parametreleri — yoksa varsayılan 10
    const { searchParams } = req.nextUrl;
    const countCountries = Math.max(1, Math.min(50, parseInt(searchParams.get('countCountries') || '10', 10) || 10));
    const countPositions = Math.max(1, Math.min(50, parseInt(searchParams.get('countPositions') || '10', 10) || 10));

    const api  = agentModule<{
      getBreakdownData: (countC: number, countP: number) => Promise<{
        countries: { id: number; name: string; code?: string; count: number }[];
        positions: { id: number; name: string; count: number }[];
        source:    'api' | 'mock';
        fetchedAt: string;
        errors?:   { countries?: string | null; positions?: string | null };
      }>;
    }>('modules/api.js');

    const data = await api.getBreakdownData(countCountries, countPositions);
    return NextResponse.json(data);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
