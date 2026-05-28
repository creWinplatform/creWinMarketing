import { NextRequest, NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE     = path.join(DATA_DIR, 'calendar.json');

interface CalendarEvent {
  id:        string;
  date:      string;
  platform:  string;
  content:   string;
  language:  string;
  published: boolean;
  createdAt: number;
}

function load(): CalendarEvent[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as CalendarEvent[];
  } catch { /* ignore */ }
  return [];
}

function save(events: CalendarEvent[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(events, null, 2));
}

export async function GET() {
  return NextResponse.json(load());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Omit<CalendarEvent, 'id' | 'createdAt'>;
  const events = load();
  const newEvent: CalendarEvent = {
    ...body,
    id:        `cal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  save([...events, newEvent]);
  return NextResponse.json(load());
}

/** PATCH ?id=xxx&action=toggle — published toggle */
export async function PATCH(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const id     = params.get('id');
  const action = params.get('action');
  const events = load();
  if (action === 'toggle') {
    const updated = events.map(ev => ev.id === id ? { ...ev, published: !ev.published } : ev);
    save(updated);
    return NextResponse.json(updated);
  }
  // Genel güncelleme
  const body  = await req.json() as Partial<CalendarEvent>;
  const idx   = events.findIndex(e => e.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
  events[idx] = { ...events[idx], ...body };
  save(events);
  return NextResponse.json(events);
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  save(id ? load().filter(e => e.id !== id) : []);
  return NextResponse.json(load());
}
