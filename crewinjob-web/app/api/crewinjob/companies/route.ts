// GET /api/crewinjob/companies?count=N
// GetLastRegisteredCompanies endpoint'ini çağırır.
import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';

interface CompanyItem {
  id:           number;
  name:         string;
  country:      string;
  countryCode:  string;
  registeredAt: string | null;
  type:         string;
  crewCount:    number;
}

interface CompaniesResponse {
  companies: CompanyItem[];
  source:    'api' | 'mock';
  fetchedAt: string;
  error?:    string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const count = Math.max(1, Math.min(50, parseInt(searchParams.get('count') || '10', 10) || 10));

    const api = agentModule<{
      getLastCompanies: (count: number) => Promise<CompaniesResponse>;
    }>('modules/api.js');

    const data = await api.getLastCompanies(count);
    return NextResponse.json(data);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message, companies: [], source: 'mock', fetchedAt: new Date().toISOString() }, { status: 500 });
  }
}
