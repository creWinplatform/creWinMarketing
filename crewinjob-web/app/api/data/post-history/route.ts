import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import {
  isRecord,
  marketingBackend,
  numberValue,
  parseObject,
  records,
  stringValue,
  timestampValue,
} from '@/lib/marketing-backend';
import { readJson, withFileLock, writeJsonAtomic } from '@/lib/json-store';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'post-history.json');
const HIDDEN_FILE = path.join(DATA_DIR, 'post-history-hidden.json');

interface PostMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  fetchedAt: number;
}

interface PostHistoryItem {
  id: string;
  platform: string;
  postId: string;
  postUrl?: string;
  content: string;
  thumbnail?: string;
  publishedAt: number;
  metrics?: PostMetrics;
  campaignId?: string;
  deliveryId?: string;
  status?: string;
}

// Tüm read-modify-write işlemleri withFileLock(FILE) altında ve await'ten SONRA yeniden okunarak yapılır:
// "Tümünü yenile" paralel PATCH atıyor — önceden her istek eski kopyayı yazıp diğerlerini eziyordu.
function load(): PostHistoryItem[] {
  const list = readJson<PostHistoryItem[]>(FILE, []);
  return Array.isArray(list) ? list : [];
}

function hiddenIds(): Set<string> {
  const list = readJson<string[]>(HIDDEN_FILE, []);
  return new Set(Array.isArray(list) ? list : []);
}

function save(items: PostHistoryItem[]) {
  writeJsonAtomic(FILE, items.slice(0, 200));
}

function saveHidden(ids: Set<string>) {
  writeJsonAtomic(HIDDEN_FILE, Array.from(ids).slice(-1000));
}

function normalizeRemote(raw: Record<string, unknown>, local?: PostHistoryItem): PostHistoryItem {
  const extra = parseObject(raw.extraMetrics);
  return {
    id: stringValue(raw.id),
    platform: stringValue(raw.platform, local?.platform || 'unknown'),
    postId: stringValue(raw.postId, local?.postId || ''),
    postUrl: stringValue(raw.postUrl, local?.postUrl) || undefined,
    content: stringValue(raw.content, local?.content || ''),
    thumbnail: stringValue(raw.thumbnailUrl, local?.thumbnail) || undefined,
    publishedAt: timestampValue(raw.publishedAt, raw.creationTime, local?.publishedAt),
    campaignId: stringValue(raw.campaignId, local?.campaignId) || undefined,
    deliveryId: stringValue(raw.deliveryId, local?.deliveryId) || undefined,
    status: stringValue(raw.status, local?.status || 'published'),
    metrics: {
      impressions: numberValue(raw.impressions),
      clicks: numberValue(raw.clicks),
      likes: numberValue(raw.likes),
      shares: numberValue(raw.shares),
      comments: numberValue(raw.comments),
      reach: numberValue(raw.reach),
      views: numberValue(extra.views, numberValue(raw.impressions, local?.metrics?.views || 0)),
      fetchedAt: timestampValue(raw.metricsUpdatedAt, raw.lastModificationTime, raw.publishedAt),
    },
  };
}

async function fetchRemote(): Promise<PostHistoryItem[]> {
  const result = await marketingBackend().marketingPostHistoryGet('GetAll', {
    skipCount: 0,
    maxResultCount: 200,
  });
  return records(result).map(item => normalizeRemote(item));
}

export async function GET() {
  const local = load();
  try {
    const hidden = hiddenIds();
    const remote = (await fetchRemote()).filter(item => !hidden.has(item.id) && !hidden.has(`${item.platform}:${item.postId}`));
    const remoteKeys = new Set(remote.flatMap(item => [item.id, `${item.platform}:${item.postId}`]));
    const merged = await withFileLock(FILE, () => {
      const current = load();   // backend beklenirken yazılmış kayıtlar kaybolmasın
      const next = [...remote, ...current.filter(item => !remoteKeys.has(item.id) && !remoteKeys.has(`${item.platform}:${item.postId}`))]
        .sort((a, b) => b.publishedAt - a.publishedAt)
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
  const body = await req.json() as Omit<PostHistoryItem, 'id'>;
  let item: PostHistoryItem = {
    ...body,
    id: `${body.platform}_${body.postId}_${Date.now()}`,
  };
  try {
    const result = await marketingBackend().marketingPostHistoryPost('RecordPost', {
      platform: body.platform,
      postId: body.postId,
      postUrl: body.postUrl || null,
      campaignId: body.campaignId || null,
      deliveryId: body.deliveryId || null,
      content: body.content,
      thumbnailUrl: body.thumbnail || null,
      publishedAt: new Date(body.publishedAt).toISOString(),
      status: body.status || 'published',
    });
    if (isRecord(result)) item = normalizeRemote(result, item);
  } catch { /* paylaşım başarılıysa geçmiş yerelde yine korunur */ }
  await withFileLock(FILE, () => save([item, ...load().filter(existing => existing.id !== item.id)]));
  return NextResponse.json(item);
}

export async function PATCH(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  const body = await req.json() as Partial<PostHistoryItem>;
  if (!id || !load().some(item => item.id === id)) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
  if (body.metrics) {
    try {
      await marketingBackend().marketingPostHistoryPost('UpdateMetrics', {
        id,
        impressions: body.metrics.impressions ?? body.metrics.views ?? 0,
        clicks: body.metrics.clicks ?? 0,
        likes: body.metrics.likes ?? 0,
        shares: body.metrics.shares ?? 0,
        comments: body.metrics.comments ?? 0,
        reach: body.metrics.reach ?? 0,
        extraMetrics: { views: body.metrics.views ?? 0, fetchedAt: body.metrics.fetchedAt },
      });
    } catch { /* metrikler yerel cache'te korunur */ }
  }
  // Backend beklenirken dosya değişmiş olabilir → kilit altında güncel kopyaya uygula
  const updated = await withFileLock(FILE, () => {
    const items = load();
    const index = items.findIndex(item => item.id === id);
    if (index === -1) return null;
    items[index] = { ...items[index], ...body, id };
    save(items);
    return items[index];
  });
  if (!updated) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  await withFileLock(FILE, () => {
    const items = load();
    const hidden = hiddenIds();
    const targets = id ? items.filter(item => item.id === id) : items;
    if (id) hidden.add(id);
    targets.forEach(item => {
      hidden.add(item.id);
      hidden.add(`${item.platform}:${item.postId}`);
    });
    saveHidden(hidden);
    save(id ? items.filter(item => item.id !== id) : []);
  });
  return NextResponse.json({ ok: true });
}
