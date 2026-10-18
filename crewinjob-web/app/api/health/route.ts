import { NextResponse } from 'next/server';

// Public sağlık kontrolü (Docker healthcheck / uptime izleme) — hiçbir gizli bilgi döndürmez.
export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
