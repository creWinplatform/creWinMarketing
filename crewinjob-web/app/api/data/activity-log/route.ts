import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { marketingBackend, records } from '@/lib/marketing-backend';
import { withFileLock, writeTextAtomic } from '@/lib/json-store';
import { ACTIVITY_FILE, loadActivity, normalizeActivity, recordActivity, saveActivity } from '@/lib/activity-log-server';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const FILE = ACTIVITY_FILE;
const CLEARED_FILE = path.join(process.cwd(), 'data', 'activity-log-cleared-at.txt');

const load = loadActivity, save = saveActivity;

function clearedAt(): number {
  try { return Number(fs.readFileSync(CLEARED_FILE, 'utf-8')) || 0; } catch { return 0; }
}

const normalize = normalizeActivity;

export async function GET() {
  const local = load();
  try {
    const result = await marketingBackend().marketingActivityGet('GetAll', { skipCount: 0, maxResultCount: 200 });
    const remote = records(result).map(normalize).filter(item => item.ts > clearedAt());
    const merged = await withFileLock(FILE, () => {
      // await sonrası yeniden oku — arada eklenen kayıtlar kaybolmasın
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
  await withFileLock(FILE, () => {
    writeTextAtomic(CLEARED_FILE, String(Date.now()));
    save([]);
  });
  return NextResponse.json({ ok: true });
}
