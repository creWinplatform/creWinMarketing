import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import {
  isRecord,
  marketingBackend,
  parseObject,
  parseStringArray,
  records,
  stringValue,
  timestampValue,
} from '@/lib/marketing-backend';
import { readJson, withFileLock, writeJsonAtomic } from '@/lib/json-store';
import { projectHistoryResponse } from '@/lib/platform/marketing-routes';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'content-history.json');

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

// Dosya büyük (görseller base64) → her read-modify-write withFileLock(FILE) altında, await'ten sonra
// yeniden okunarak yapılır; GET yalnızca birleşik veri gerçekten değiştiyse yazar.
function load(): HistoryItem[] {
  // bozuk yerel yedek backend verisini engellememeli → readJson hata yerine [] döner
  const list = readJson<HistoryItem[]>(FILE, []);
  return Array.isArray(list) ? list : [];
}

function save(items: HistoryItem[]) {
  writeJsonAtomic(FILE, items.slice(0, 100));
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

async function fetchRemote(local: HistoryItem[] = load()): Promise<HistoryItem[]> {
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

export async function GET(req: NextRequest) {
  const scoped = await projectHistoryResponse(req);
  if (scoped) return scoped;
  try {
    const result = await marketingBackend().marketingContentHistoryGet('GetAll', {
      skipCount: 0,
      maxResultCount: 200,
    });
    const merged = await withFileLock(FILE, () => {
      // Backend beklenirken yazılmış yerel değişiklikler kaybolmasın → yeniden oku
      const current  = load();
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
    return NextResponse.json(merged);
  } catch {
    return NextResponse.json(load());
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
  await withFileLock(FILE, () => save([item, ...load().filter(existing => existing.id !== item.id)]));
  return NextResponse.json(item);
}

export async function PATCH(req: NextRequest) {
  const scoped = await projectHistoryResponse(req);
  if (scoped) return scoped;
  const id = new URL(req.url).searchParams.get('id');
  const body = await req.json() as Partial<HistoryItem>;
  // Yerel id (hist_…) backend senkronunda sayısal id'ye dönmüş olabilir → localId ile de ara
  let current = load().find(item => item.id === id || item.metadata?.localId === id);
  if (!current && id) {
    try {
      const result = await marketingBackend().marketingContentHistoryGet('Get', { id });
      if (isRecord(result)) current = normalizeRemote(result);
    } catch { /* 404 aşağıda işlenir */ }
  }
  if (!current) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });

  let updated: HistoryItem = { ...current, ...body, id: current.id };
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
  await withFileLock(FILE, () => {
    // Backend beklenirken başka kayıtlar güncellenmiş olabilir → güncel listeye uygula
    save([updated, ...load().filter(item => item.id !== originalId && item.id !== updated.id)]);
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const scoped = await projectHistoryResponse(req);
  if (scoped) return scoped;
  const id = new URL(req.url).searchParams.get('id');
  const local = load();
  const ids = id ? [id] : Array.from(new Set([
    ...local.map(item => item.id),
    ...(await fetchRemote(local).catch(() => [])).map(item => item.id),
  ]));
  await Promise.allSettled(ids.filter(value => /^\d+$/.test(value)).map(value =>
    marketingBackend().marketingContentHistoryDelete('Delete', { id: value })
  ));
  await withFileLock(FILE, () => save(id ? load().filter(item => item.id !== id) : []));
  return NextResponse.json({ ok: true });
}
