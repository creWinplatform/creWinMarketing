import { NextRequest, NextResponse } from 'next/server';
import {
  isRecord,
  marketingBackend,
  parseObject,
  parseStringArray,
  records,
  stringValue,
  timestampValue,
} from '@/lib/marketing-backend';
import { readStore, storeVersion, webStore, withStore } from '@/lib/legacy-store';
import { projectHistoryResponse } from '@/lib/platform/marketing-routes';
import { EDIT_CONFLICT } from '@/lib/platform/marketing-store';

// Line endings and surrounding spaces are not a change; the backend round trip may alter them.
const sameText = (value: unknown) => String(value ?? '').replace(/\r\n/g, '\n').trim();

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// data/content-history.json, or legacy_records 'web:content-history' with PLATFORM_LEGACY_STORE=mssql.
// Compact JSON: the file is read far more often than a person opens it.
const STORE = () => webStore('content-history.json', 'array', { pretty: false });

interface HistoryItem {
  id: string;
  platform: string;
  language: string;
  content: string;
  prompt: string;
  timestamp: number;
  imageData?: string;
  imageMime?: string;
  rawBgData?: string;
  rawBgMime?: string;
  headline?: string;
  suggestions?: string[];
  subline?: string;
  metadata?: Record<string, unknown>;
}

// Dosya büyük (görseller base64) → her read-modify-write update() (depo kilidi) altında, await'ten sonra
// yeniden okunarak yapılır; GET yalnızca birleşik veri gerçekten değiştiyse yazar.
// ?lite=1: the list without image data (the file holds base64 images, ~20 MB), for views that show only text and
// figures; hasImage says an image exists.
function lite(request: NextRequest, items: HistoryItem[]) {
  if (request.nextUrl.searchParams.get('lite') !== '1') return items;
  return items.map(({ imageData, rawBgData, ...rest }) => {
    const { images, ...item } = rest as HistoryItem & { images?: unknown[] };
    return { ...item, hasImage: Boolean(imageData || images?.length || rawBgData) };
  });
}
// The file is ~20 MB (base64 images). Parsing it blocks the server for a noticeable time, and a page sends several of
// these requests at once, so the parsed list is kept until the store changes (file mtime + size, or the table's store
// version), and concurrent GETs share
// one backend merge that stays fresh for a few seconds. Writes update or drop both caches.
type Parsed = { key: string; items: HistoryItem[] };
type Merge = { at: number; promise: Promise<HistoryItem[]> };
const cache = globalThis as typeof globalThis & { __crewinContentHistory?: Parsed | null; __crewinContentHistoryMerge?: Merge | null };
const MERGE_FRESH_MS = 10_000;
async function load(): Promise<HistoryItem[]> {
  const key = await storeVersion(STORE());
  if (!key) return [];
  const hit = cache.__crewinContentHistory;
  if (hit?.key === key) return hit.items;
  // bozuk yerel yedek backend verisini engellememeli → okunamayan depo hata yerine [] döner
  const items = await readStore<HistoryItem>(STORE());
  cache.__crewinContentHistory = { key, items };
  return items;
}

// Read-modify-write under the store's lock: `work` gets the current list and may save a new one (the newest 100 are kept).
async function update<R>(work: (current: HistoryItem[], save: (items: HistoryItem[]) => void) => R): Promise<R> {
  let saved = false;
  try {
    return await withStore<HistoryItem[], R>(STORE(), ({ load: current, save }) => work(current(), items => { saved = true; save(items.slice(0, 100)); }));
  } finally {
    if (saved) { cache.__crewinContentHistory = null; cache.__crewinContentHistoryMerge = null; }
  }
}

/** Büyük alanlar (imageData vb.) çoğunlukla aynı referans — önce === ile ucuz karşılaştırma. */
function sameItem(a: HistoryItem, b: HistoryItem): boolean {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of Array.from(keys)) {
    const va = ra[k], vb = rb[k];
    if (va === vb) continue;
    if (va && vb && typeof va === 'object' && typeof vb === 'object' && JSON.stringify(va) === JSON.stringify(vb)) continue;
    return false;
  }
  return true;
}

function sameList(a: HistoryItem[], b: HistoryItem[]): boolean {
  return a.length === b.length && a.every((item, i) => sameItem(item, b[i]));
}

function normalizeRemote(raw: Record<string, unknown>, local?: HistoryItem): HistoryItem {
  const variables = parseObject(raw.templateVariables);
  const metadata = {
    ...(local?.metadata || {}),
    ...parseObject(variables.metadata),
    backendSync: 'synced',
    backendTitle: raw.title,
    campaignId: raw.campaignId,
    templateId: raw.templateId,
    status: raw.status,
    tags: parseStringArray(raw.tags),
    assetId: variables.assetId,
    assetUrl: variables.assetUrl,
  };
  return {
    ...(local || {} as HistoryItem),
    id: stringValue(raw.id, local?.id),
    platform: stringValue(raw.channel, stringValue(variables.platform, local?.platform || 'social')),
    language: stringValue(raw.language, local?.language || 'tr'),
    content: stringValue(raw.content, local?.content || ''),
    prompt: stringValue(variables.prompt, stringValue(raw.title, local?.prompt || '')),
    timestamp: timestampValue(raw.updatedAt, raw.lastModificationTime, raw.creationTime, local?.timestamp),
    headline: stringValue(variables.headline, local?.headline) || undefined,
    suggestions: parseStringArray(variables.suggestions).length ? parseStringArray(variables.suggestions) : local?.suggestions,
    subline: stringValue(variables.subline, local?.subline) || undefined,
    metadata,
  };
}

function backendPayload(item: HistoryItem) {
  const metadata = item.metadata || {};
  return {
    id: /^\d+$/.test(item.id) ? Number(item.id) : null,
    title: stringValue(metadata.backendTitle, item.prompt || `${item.platform} içerik`).slice(0, 180),
    contentType: stringValue(metadata.contentType, 'social_post'),
    channel: item.platform,
    content: item.content,
    subject: stringValue(metadata.subject) || null,
    templateVariables: {
      prompt: item.prompt,
      platform: item.platform,
      headline: item.headline || null,
      suggestions: item.suggestions || [],
      subline: item.subline || null,
      assetId: metadata.assetId || null,
      assetUrl: metadata.assetUrl || null,
      metadata: Object.fromEntries(Object.entries(metadata).filter(([key]) => !['backendSync', 'backendTitle'].includes(key))),
    },
    campaignId: metadata.campaignId || null,
    templateId: metadata.templateId || null,
    status: stringValue(metadata.status, 'draft'),
    language: item.language,
    tags: Array.isArray(metadata.tags) ? metadata.tags : [item.platform, item.language],
  };
}

async function fetchRemote(given?: HistoryItem[]): Promise<HistoryItem[]> {
  const local = given ?? await load();
  const result = await marketingBackend().marketingContentHistoryGet('GetAll', {
    skipCount: 0,
    maxResultCount: 200,
  });
  const localById = new Map(local.map(item => [item.id, item]));
  return records(result).map(item => normalizeRemote(item, localById.get(stringValue(item.id))));
}

async function uploadAsset(item: HistoryItem): Promise<HistoryItem> {
  if (!item.imageData || item.metadata?.assetId) return item;
  const result = await marketingBackend().marketingAssetPost('Upload', {
    fileName: `content-${item.id}.${item.imageMime?.includes('png') ? 'png' : 'jpg'}`,
    mimeType: item.imageMime || 'image/jpeg',
    base64Content: item.imageData,
    assetType: 'social_image',
    campaignId: item.metadata?.campaignId || null,
    altText: item.headline || item.prompt || `${item.platform} post image`,
    tags: [item.platform, item.language],
  });
  if (!isRecord(result)) return item;
  return {
    ...item,
    metadata: {
      ...(item.metadata || {}),
      assetId: result.id,
      assetUrl: result.url ?? result.fileUrl ?? result.publicUrl,
    },
  };
}

async function persistRemote(item: HistoryItem): Promise<HistoryItem> {
  const withAsset = await uploadAsset(item);
  const result = await marketingBackend().marketingContentHistoryPost('CreateOrUpdate', backendPayload(withAsset));
  return isRecord(result) ? normalizeRemote(result, withAsset) : withAsset;
}

async function mergeWithBackend(): Promise<HistoryItem[]> {
  const result = await marketingBackend().marketingContentHistoryGet('GetAll', {
    skipCount: 0,
    maxResultCount: 200,
  });
  return update((current, save) => {
    // Backend beklenirken yazılmış yerel değişiklikler kaybolmasın → kilit altında yeniden okunmuş liste
    const byId     = new Map(current.map(item => [item.id, item]));
    const remote   = records(result).map(item => normalizeRemote(item, byId.get(stringValue(item.id))));
    const ids      = new Set(remote.map(item => item.id));
    const next     = [...remote, ...current.filter(item => !ids.has(item.id))]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100);
    // Her GET'te ~20 MB dosyayı yeniden yazma — yalnızca gerçekten değiştiyse
    if (!sameList(next, current)) save(next);
    return next;
  });
}

// Concurrent and back-to-back GETs (several panels on one page) share one merge for MERGE_FRESH_MS.
function mergedHistory(): Promise<HistoryItem[]> {
  const now = Date.now(), hit = cache.__crewinContentHistoryMerge;
  if (hit && now - hit.at < MERGE_FRESH_MS) return hit.promise;
  const promise = mergeWithBackend();
  const entry: Merge = { at: now, promise };
  cache.__crewinContentHistoryMerge = entry;
  promise.catch(() => { if (cache.__crewinContentHistoryMerge === entry) cache.__crewinContentHistoryMerge = null; });
  return promise;
}

export async function GET(req: NextRequest) {
  const scoped = await projectHistoryResponse(req);
  if (scoped) return scoped;
  try {
    return NextResponse.json(lite(req, await mergedHistory()));
  } catch {
    return NextResponse.json(lite(req, await load()));
  }
}

export async function POST(req: NextRequest) {
  const scoped = await projectHistoryResponse(req);
  if (scoped) return scoped;
  const body = await req.json() as Omit<HistoryItem, 'id' | 'timestamp'>;
  let item: HistoryItem = {
    ...body,
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  };
  try {
    item = await persistRemote(item);
  } catch {
    item.metadata = { ...(item.metadata || {}), backendSync: 'pending' };
  }
  await update((list, save) => save([item, ...list.filter(existing => existing.id !== item.id)]));
  return NextResponse.json(item);
}

export async function PATCH(req: NextRequest) {
  const scoped = await projectHistoryResponse(req);
  if (scoped) return scoped;
  const id = new URL(req.url).searchParams.get('id');
  const body = await req.json() as Partial<HistoryItem>;
  // Yerel id (hist_…) backend senkronunda sayısal id'ye dönmüş olabilir → localId ile de ara
  let current = (await load()).find(item => item.id === id || item.metadata?.localId === id);
  if (!current && id) {
    try {
      const result = await marketingBackend().marketingContentHistoryGet('Get', { id });
      if (isRecord(result)) current = normalizeRemote(result);
    } catch { /* 404 aşağıda işlenir */ }
  }
  if (!current) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
  // The library editor sends the text it started from; a different stored text means another edit landed meanwhile.
  const { expectedContent, ...changes } = body as Partial<HistoryItem> & { expectedContent?: unknown };
  if (typeof expectedContent === 'string' && sameText(expectedContent) !== sameText(current.content)) {
    return NextResponse.json({ error: EDIT_CONFLICT }, { status: 409 });
  }

  let updated: HistoryItem = { ...current, ...changes, id: current.id };
  // Görsel değiştiyse eski asset artık bu görseli temsil etmiyor → yeniden yüklensin
  if (body.imageData !== undefined && body.imageData !== current.imageData) {
    const meta = { ...(updated.metadata || {}) };
    delete meta.assetId;
    delete meta.assetUrl;
    updated.metadata = meta;
  }
  try {
    updated = await persistRemote(updated);
  } catch {
    updated.metadata = { ...(updated.metadata || {}), backendSync: 'pending' };
  }
  const originalId = current.id;
  if (updated.id !== originalId) {
    // İstemci eski id ile düzenlemeye devam edebilir (OutputPanel) → eşleşme için sakla
    updated.metadata = { ...(updated.metadata || {}), localId: stringValue(current.metadata?.localId, originalId) };
  }
  await update((list, save) => {
    // Backend beklenirken başka kayıtlar güncellenmiş olabilir → güncel listeye uygula
    save([updated, ...list.filter(item => item.id !== originalId && item.id !== updated.id)]);
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const scoped = await projectHistoryResponse(req);
  if (scoped) return scoped;
  const id = new URL(req.url).searchParams.get('id');
  const local = await load();
  const ids = id ? [id] : Array.from(new Set([
    ...local.map(item => item.id),
    ...(await fetchRemote(local).catch(() => [])).map(item => item.id),
  ]));
  await Promise.allSettled(ids.filter(value => /^\d+$/.test(value)).map(value =>
    marketingBackend().marketingContentHistoryDelete('Delete', { id: value })
  ));
  await update((list, save) => save(id ? list.filter(item => item.id !== id) : []));
  return NextResponse.json({ ok: true });
}
