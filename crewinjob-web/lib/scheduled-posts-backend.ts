import 'server-only';
import sharp from 'sharp';
import { marketingBackend, isRecord, parseObject, parseStringArray, records, stringValue } from '@/lib/marketing-backend';
import { createPost, deletePost, loadPosts, updatePost, upsertPost, SCHEDULED_POSTS_LOCK, type ScheduledPost } from '@/lib/scheduled-posts';
import { withFileLock } from '@/lib/json-store';
import { internalFetch } from '@/lib/internal-fetch';
import { extractPostId } from '@/lib/post-history';

function normalize(raw: Record<string, unknown>, local?: ScheduledPost): ScheduledPost {
  const results = Array.isArray(raw.results) ? raw.results as ScheduledPost['results'] : local?.results;
  return {
    ...(local || {} as ScheduledPost),
    id: stringValue(raw.id, local?.id || ''),
    platforms: parseStringArray(raw.platforms).length ? parseStringArray(raw.platforms) : local?.platforms || [],
    content: stringValue(raw.content, local?.content || ''),
    mediaUrls: parseStringArray(raw.mediaUrls).length ? parseStringArray(raw.mediaUrls) : local?.mediaUrls,
    perPlatformContent: Object.keys(parseObject(raw.perPlatformContent)).length
      ? Object.fromEntries(Object.entries(parseObject(raw.perPlatformContent)).map(([key, value]) => [key, String(value)]))
      : local?.perPlatformContent,
    scheduledAt: stringValue(raw.scheduledAt, local?.scheduledAt || new Date().toISOString()),
    timezone: stringValue(raw.timezone, local?.timezone || 'Europe/Istanbul'),
    campaignId: stringValue(raw.campaignId, local?.campaignId) || undefined,
    deliveryId: stringValue(raw.deliveryId, local?.deliveryId) || undefined,
    idempotencyKey: stringValue(raw.idempotencyKey, local?.idempotencyKey) || undefined,
    status: stringValue(raw.status, local?.status || 'pending') as ScheduledPost['status'],
    createdAt: stringValue(raw.creationTime, local?.createdAt || new Date().toISOString()),
    publishedAt: stringValue(raw.publishedAt, local?.publishedAt) || undefined,
    results,
    backendSync: 'synced',
  };
}

function payload(post: ScheduledPost) {
  return {
    id: /^\d+$/.test(post.id) ? Number(post.id) : null,
    platforms: post.platforms,
    content: post.content,
    mediaUrls: post.mediaUrls || [],
    perPlatformContent: post.perPlatformContent || {},
    scheduledAt: post.scheduledAt,
    timezone: post.timezone || 'Europe/Istanbul',
    campaignId: post.campaignId || null,
    deliveryId: post.deliveryId || null,
    idempotencyKey: post.idempotencyKey || `schedule-${post.id}`,
  };
}

export async function listScheduledPosts(): Promise<ScheduledPost[]> {
  const local = loadPosts();
  try {
    const result = await marketingBackend().marketingCalendarGet('GetScheduledPosts', {
      skipCount: 0,
      maxResultCount: 500,
    });
    const byId = new Map(local.map(item => [item.id, item]));
    const remote = records(result)
      .map(item => normalize(item, byId.get(stringValue(item.id))))
      .filter(item => item.status !== 'cancelled');
    const remoteIds = new Set(remote.map(item => item.id));
    return [...remote, ...local.filter(item => !remoteIds.has(item.id) && item.status !== 'cancelled')]
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  } catch {
    return local;
  }
}

export async function createScheduledPost(input: Omit<ScheduledPost, 'id' | 'createdAt' | 'status'>): Promise<ScheduledPost> {
  let local = createPost({ ...input, backendSync: 'local_only' });
  try {
    if (input.imageData) {
      const asset = await marketingBackend().marketingAssetPost('Upload', {
        fileName: `scheduled-${local.id}.${input.imageMime?.includes('png') ? 'png' : 'jpg'}`,
        mimeType: input.imageMime || 'image/jpeg',
        base64Content: input.imageData,
        assetType: 'scheduled_post',
        campaignId: input.campaignId || null,
        altText: input.note || 'Scheduled social media post',
        tags: input.platforms,
      });
      if (isRecord(asset)) {
        const url = stringValue(asset.url ?? asset.fileUrl ?? asset.publicUrl);
        if (url) local = updatePost(local.id, { mediaUrls: [url] }) || local;
      }
    }
    const result = await marketingBackend().marketingCalendarPost('CreateOrUpdateScheduledPost', payload(local));
    if (isRecord(result)) {
      const synced = normalize(result, local);
      deletePost(local.id);
      return upsertPost(synced);
    }
  } catch { /* local queue remains publishable */ }
  return local;
}

export async function updateScheduledPost(id: string, patch: Partial<ScheduledPost>): Promise<ScheduledPost | null> {
  const current = loadPosts().find(post => post.id === id);
  if (!current) return null;
  const updated = { ...current, ...patch, id };
  if (patch.status === 'cancelled' && /^\d+$/.test(id)) {
    try { await marketingBackend().marketingCalendarPost('CancelScheduledPost', { id }); } catch { /* local state retained */ }
  } else if (current.backendSync === 'synced') {
    try { await marketingBackend().marketingCalendarPost('CreateOrUpdateScheduledPost', payload(updated)); } catch { /* local state retained */ }
  }
  // Await sırasında post yayına alınmış olabilir → bayat kopyayı değil yalnızca patch'i, güncel kayda uygula
  return withFileLock(SCHEDULED_POSTS_LOCK, () => updatePost(id, { ...patch, id }));
}

// ── Sunucu taraflı yayın yardımcıları (schedule/publish + scheduler/run) ──────

export interface SocialPostResult {
  platform: string;
  success:  boolean;
  url?:     string;
  postId?:  string;
  error?:   string;
}

/** /api/social/post'u dahili servis oturumuyla çağırır (cookie üretimi + adres tek yerde). */
export async function publishToSocial(body: {
  platforms: string[];
  content:   string;
  imageData?: string;
  imageMime?: string;
  perPlatformContent?: Record<string, string>;
}, actor: string): Promise<SocialPostResult[]> {
  const res  = await internalFetch('/api/social/post', { method: 'POST', body: JSON.stringify(body) }, actor);
  const data = await res.json().catch(() => ({})) as { results?: SocialPostResult[]; error?: string };
  if (!res.ok || !Array.isArray(data.results)) {
    throw new Error(data.error || `Sosyal paylaşım HTTP ${res.status}`);
  }
  return data.results;
}

/** Görselin küçük JPEG önizlemesi (SharePanel'deki tarayıcı makeThumbnail'in sunucu karşılığı) */
async function serverThumbnail(imageData?: string): Promise<string | undefined> {
  if (!imageData) return undefined;
  try {
    const buf = await sharp(Buffer.from(imageData, 'base64'))
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    return buf.toString('base64');
  } catch { return undefined; }
}

/**
 * Başarılı paylaşımları paylaşım geçmişine yazar — SharePanel ile aynı kurallar
 * (postId: API'nin döndürdüğü gerçek ID, yoksa URL'den extractPostId).
 * /api/data/post-history route mantığı (backend + yerel kilitli yazım) üzerinden gider.
 */
export async function recordPublishedPosts(
  results: SocialPostResult[],
  opts: { contentFor: (platform: string) => string; imageData?: string; campaignId?: string; deliveryId?: string; actor: string },
): Promise<void> {
  const ok = results.filter(r => r.success && (r.url || r.postId));
  if (!ok.length) return;
  const thumbnail = await serverThumbnail(opts.imageData);
  for (const r of ok) {
    const postId = r.postId || (r.url ? extractPostId(r.platform, r.url) : '') || r.url || '';
    try {
      await internalFetch('/api/data/post-history', {
        method: 'POST',
        body:   JSON.stringify({
          platform:    r.platform,
          postId,
          postUrl:     r.url,
          content:     opts.contentFor(r.platform),
          thumbnail,
          publishedAt: Date.now(),
          campaignId:  opts.campaignId,
          deliveryId:  opts.deliveryId,
        }),
      }, opts.actor);
    } catch (e) {
      console.warn(`[post-history] ${r.platform} kaydı yazılamadı:`, e);
    }
  }
}

export async function removeScheduledPost(id: string): Promise<boolean> {
  const current = loadPosts().find(post => post.id === id);
  if (current?.backendSync === 'synced' || /^\d+$/.test(id)) {
    try { await marketingBackend().marketingCalendarPost('CancelScheduledPost', { id }); } catch { /* local removal still applies */ }
  }
  return deletePost(id);
}
