import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { isRecord, marketingBackend, records, stringValue, timestampValue } from '@/lib/marketing-backend';
import { readJson, withFileLock, writeJsonAtomic, writeTextAtomic } from '@/lib/json-store';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'activity-log.json');
const CLEARED_FILE = path.join(DATA_DIR, 'activity-log-cleared-at.txt');

interface ActivityEntry {
  id: string;
  type: string;
  label: string;
  detail?: string;
  ts: number;
}

function load(): ActivityEntry[] {
  const list = readJson<ActivityEntry[]>(FILE, []);
  return Array.isArray(list) ? list : [];
}

function save(entries: ActivityEntry[]) {
  writeJsonAtomic(FILE, entries.slice(0, 200));
}

function clearedAt(): number {
  try { return Number(fs.readFileSync(CLEARED_FILE, 'utf-8')) || 0; } catch { return 0; }
}

function normalize(raw: Record<string, unknown>): ActivityEntry {
  return {
    id: stringValue(raw.id),
    type: stringValue(raw.activityType, 'content_generated'),
    label: stringValue(raw.label),
    detail: stringValue(raw.detail) || undefined,
    ts: timestampValue(raw.occurredAt, raw.creationTime),
  };
}

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
  let entry: ActivityEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: body.type,
    label: body.label,
    detail: body.detail,
    ts: Date.now(),
  };
  try {
    const result = await marketingBackend().marketingActivityPost('Add', {
      activityType: body.type,
      label: body.label,
      detail: body.detail || null,
      campaignId: body.campaignId || null,
      entityType: body.entityType || null,
      entityId: body.entityId || null,
      metadata: body.metadata || {},
      occurredAt: new Date(entry.ts).toISOString(),
    });
    if (isRecord(result)) entry = normalize(result);
  } catch { /* aktivite yerel mirror'da kaybolmaz */ }
  await withFileLock(FILE, () => save([entry, ...load().filter(item => item.id !== entry.id)]));
  return NextResponse.json(entry);
}

export async function DELETE() {
  await withFileLock(FILE, () => {
    writeTextAtomic(CLEARED_FILE, String(Date.now()));
    save([]);
  });
  return NextResponse.json({ ok: true });
}
