import { NextRequest, NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE     = path.join(DATA_DIR, 'post-history.json');

interface PostMetrics {
  likes?:    number;
  comments?: number;
  shares?:   number;
  views?:    number;
  fetchedAt: number;
}

interface PostHistoryItem {
  id:          string;
  platform:    string;
  postId:      string;
  postUrl?:    string;
  content:     string;
  thumbnail?:  string;
  publishedAt: number;
  metrics?:    PostMetrics;
}

function load(): PostHistoryItem[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as PostHistoryItem[];
  } catch { /* ignore */ }
  return [];
}

function save(items: PostHistoryItem[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
}

export async function GET() {
  return NextResponse.json(load());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Omit<PostHistoryItem, 'id'>;
  const items = load();
  const newItem: PostHistoryItem = {
    ...body,
    id: `${body.platform}_${body.postId}_${Date.now()}`,
  };
  save([newItem, ...items].slice(0, 100));
  return NextResponse.json(newItem);
}

export async function PATCH(req: NextRequest) {
  const id    = new URL(req.url).searchParams.get('id');
  const body  = await req.json() as Partial<PostHistoryItem>;
  const items = load();
  const idx   = items.findIndex(i => i.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
  items[idx] = { ...items[idx], ...body };
  save(items);
  return NextResponse.json(items[idx]);
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  save(id ? load().filter(i => i.id !== id) : []);
  return NextResponse.json({ ok: true });
}
