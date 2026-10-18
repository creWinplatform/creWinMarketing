import { NextRequest, NextResponse } from 'next/server';
import { auditPublicPage } from '@/lib/site-audit';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { url?: string };
    if (!body.url?.trim()) return NextResponse.json({ error: 'Denetlenecek URL gerekli.' }, { status: 400 });
    return NextResponse.json(await auditPublicPage(body.url.trim()));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Denetim başlatılamadı.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
