import { NextRequest, NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE     = path.join(DATA_DIR, 'activity-log.json');

export type ActivityType =
  | 'content_generated'
  | 'post_published'
  | 'scheduler_run'
  | 'image_generated'
  | 'wa_sent'
  | 'tg_sent'
  | 'calendar_added'
  | 'kpi_generated';

interface ActivityEntry {
  id:      string;
  type:    ActivityType;
  label:   string;
  detail?: string;
  ts:      number;
}

function load(): ActivityEntry[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as ActivityEntry[];
  } catch { /* ignore */ }
  return [];
}

function save(entries: ActivityEntry[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(entries, null, 2));
}

export async function GET() {
  return NextResponse.json(load());
}

export async function POST(req: NextRequest) {
  const { type, label, detail } = await req.json() as { type: ActivityType; label: string; detail?: string };
  const entries = load();
  const entry: ActivityEntry = {
    id:     `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    label,
    detail,
    ts: Date.now(),
  };
  save([entry, ...entries].slice(0, 50));
  return NextResponse.json(entry);
}

export async function DELETE() {
  save([]);
  return NextResponse.json({ ok: true });
}
