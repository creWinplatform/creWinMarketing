import { NextRequest, NextResponse } from 'next/server';
import { marketingBackend, records } from '@/lib/marketing-backend';
import { activityClearedAt, clearActivity, loadActivity, normalizeActivity, recordActivity, withActivity } from '@/lib/activity-log-server';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const normalize = normalizeActivity;

export async function GET() {
  const local = await loadActivity();
  try {
    const result = await marketingBackend().marketingActivityGet('GetAll', { skipCount: 0, maxResultCount: 200 });
    const cleared = await activityClearedAt();
    const remote = records(result).map(normalize).filter(item => item.ts > cleared);
    const merged = await withActivity(({ load, save }) => {
      // await sonrası kilit altında yeniden oku — arada eklenen kayıtlar kaybolmasın
      const current = load();
      const ids = new Set(remote.map(item => item.id));
      const next = [...remote, ...current.filter(item => !ids.has(item.id))]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 200);
      if (JSON.stringify(next) !== JSON.stringify(current)) save(next);
      return next;
    });
    return NextResponse.json(merged);
  } catch {
    return NextResponse.json(local);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { type: string; label: string; detail?: string; campaignId?: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> };
  return NextResponse.json(await recordActivity(body));
}

export async function DELETE() {
  await clearActivity();
  return NextResponse.json({ ok: true });
}
