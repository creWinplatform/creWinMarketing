import { NextRequest, NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE     = path.join(DATA_DIR, 'content-history.json');

interface HistoryItem {
  id:        string;
  platform:  string;
  language:  string;
  content:   string;
  prompt:    string;
  timestamp: number;
  imageData?: string;
  imageMime?: string;
}

function load(): HistoryItem[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as HistoryItem[];
  } catch { /* ignore */ }
  return [];
}

function save(items: HistoryItem[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
}

/** GET — tüm geçmişi döndür */
export async function GET() {
  return NextResponse.json(load());
}

/** POST — yeni kayıt ekle */
export async function POST(req: NextRequest) {
  const body = await req.json() as Omit<HistoryItem, 'id' | 'timestamp'>;
  const items = load();
  const newItem: HistoryItem = {
    ...body,
    id:        `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  };
  save([newItem, ...items].slice(0, 50));
  return NextResponse.json(newItem);
}

/** PATCH — kaydı güncelle (içerik veya görsel) */
export async function PATCH(req: NextRequest) {
  const id   = new URL(req.url).searchParams.get('id');
  const body = await req.json() as Partial<HistoryItem>;
  const items = load();
  const idx  = items.findIndex(i => i.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
  items[idx] = { ...items[idx], ...body };
  save(items);
  return NextResponse.json(items[idx]);
}

/** DELETE — tek kayıt sil (?id=xxx) veya tümünü temizle */
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  save(id ? load().filter(i => i.id !== id) : []);
  return NextResponse.json({ ok: true });
}
