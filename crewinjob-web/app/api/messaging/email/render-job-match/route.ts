import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

interface Job {
  jobId:      number | null;
  title:      string;
  company:    string;
  vesselType: string;
  duration:   string;
  salary:     string;
  location:   string;
  applyUrl:   string;
}

interface RenderBody {
  jobs:         Job[];
  lang?:        string;        // fallback dil — nationality yoksa kullanılır
  nationality?: string | null; // ISO 3166-1 alpha-2 → dil otomatik belirlenir
}

export async function POST(request: NextRequest) {
  try {
    const body: RenderBody = await request.json();
    const { jobs, lang = 'tr', nationality } = body;

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return NextResponse.json({ error: '"jobs" dizisi zorunludur.' }, { status: 400 });
    }

    const retention = agentModule('modules/retention.js');
    const { subject, html } = retention.renderJobMatchEmail(jobs, { lang, nationality: nationality ?? null });
    return NextResponse.json({ subject, html });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
