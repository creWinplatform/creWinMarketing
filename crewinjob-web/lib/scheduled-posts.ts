/**
 * Sunucu taraflı zamanlanmış post yöneticisi.
 * data/scheduled-posts.json dosyasında (PLATFORM_LEGACY_STORE=mssql ile legacy_records 'web:scheduled-posts') saklar.
 *
 * Her post: { id, platforms[], content, imageData?, imageMime?, scheduledAt (ISO), status }
 *
 * Her yazan fonksiyon kendi read-modify-write işlemini depo kilidi altında yapar ;
 * çağıranlar ayrıca kilit almamalıdır (kilit yeniden girişli değildir).
 */
import { mutateStore, readStore, webStore } from '@/lib/legacy-store';

const STORE = () => webStore('scheduled-posts.json', 'array');

/**
 * publishing: yayın için sahiplenildi (cron + "Şimdi Yayınla" aynı postu iki kez göndermesin)
 * partial:    bazı platformlar başarılı — yalnızca başarısız platformlar yeniden denenir
 */
export type PostStatus = 'pending' | 'publishing' | 'published' | 'partial' | 'failed' | 'cancelled';

/** partial postlar en fazla bu kadar otomatik denenir (kalıcı hata her saat API'yi yormasın) */
export const MAX_PUBLISH_ATTEMPTS = 5;
/** publishing durumunda bu süreden uzun kalan (çökmüş) sahiplenme yeniden alınabilir */
const STALE_CLAIM_MS = 15 * 60 * 1000;

export interface ScheduledPost {
  id:          string;
  platforms:   string[];
  content:     string;
  imageData?:  string;
  imageMime?:  string;
  scheduledAt: string;   // ISO 8601: "2026-05-26T14:30:00Z"
  status:      PostStatus;
  createdAt:   string;
  publishedAt?: string;
  results?:    Array<{ platform: string; success: boolean; url?: string; postId?: string; error?: string }>;
  note?:       string;   // kullanıcı notu
  campaignId?: string;
  deliveryId?: string;
  perPlatformContent?: Record<string, string>;
  mediaUrls?: string[];
  idempotencyKey?: string;
  timezone?: string;
  backendSync?: 'synced' | 'local_only';
  claimedAt?:  string;   // publishing'e alındığı an
  attempts?:   number;   // yayın deneme sayısı
}


export async function loadPosts(): Promise<ScheduledPost[]> {
  return readStore<ScheduledPost>(STORE());
}

// Read-modify-write under the store lock; `work` returns the result and may replace the list through `save`.
async function withPosts<R>(work: (posts: ScheduledPost[], save: (posts: ScheduledPost[]) => void) => R): Promise<R> {
  let result!: R;
  await mutateStore(STORE(), list => {
    let next: ScheduledPost[] | undefined;
    result = work(list as ScheduledPost[], posts => { next = posts; });
    return next;
  });
  return result;
}

export function upsertPost(post: ScheduledPost): Promise<ScheduledPost> {
  return replacePost(post.id, post);
}

/** Replaces the post stored under `id` (a local id that the backend renumbered) with `post`, in one write. */
export function replacePost(id: string, post: ScheduledPost): Promise<ScheduledPost> {
  return withPosts((posts, save) => {
    const kept = posts.filter(item => item.id !== id || item.id === post.id);
    const index = kept.findIndex(item => item.id === post.id);
    if (index >= 0) kept[index] = post;
    else kept.push(post);
    save(kept);
    return post;
  });
}

/** Yeni zamanlanmış post oluştur */
export function createPost(data: Omit<ScheduledPost, 'id' | 'createdAt' | 'status'>): Promise<ScheduledPost> {
  const newPost: ScheduledPost = {
    ...data,
    id:        `sched_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    status:    'pending',
    createdAt: new Date().toISOString(),
  };
  return withPosts((posts, save) => { save([...posts, newPost]); return newPost; });
}

/** Postu güncelle (güncel kayda yalnızca patch uygulanır) */
export function updatePost(id: string, patch: Partial<ScheduledPost>): Promise<ScheduledPost | null> {
  return withPosts((posts, save) => {
    const idx = posts.findIndex(p => p.id === id);
    if (idx === -1) return null;
    posts[idx] = { ...posts[idx], ...patch };
    save(posts);
    return posts[idx];
  });
}

/** Postu sil */
export function deletePost(id: string): Promise<boolean> {
  return withPosts((posts, save) => {
    const filtered = posts.filter(p => p.id !== id);
    if (filtered.length === posts.length) return false;
    save(filtered);
    return true;
  });
}

function isClaimable(p: ScheduledPost, now: Date): boolean {
  if (p.backendSync === 'synced' || new Date(p.scheduledAt) > now) return false;
  if (p.status === 'pending') return true;
  if (p.status === 'partial') return (p.attempts ?? 0) < MAX_PUBLISH_ATTEMPTS;
  if (p.status === 'publishing') {
    const claimed = p.claimedAt ? Date.parse(p.claimedAt) : 0;
    return now.getTime() - claimed > STALE_CLAIM_MS;
  }
  return false;
}

/** Zamanı gelmiş ve henüz yayınlanmamış (veya kısmen yayınlanmış) postları getir */
export async function getDuePosts(now: Date = new Date()): Promise<ScheduledPost[]> {
  return (await loadPosts()).filter(p => isClaimable(p, now));
}

/**
 * Zamanı gelen postları tek adımda, depo kilidi altında 'publishing' durumuna alır ve döndürür;
 * böylece paralel cron / "Şimdi Yayınla" (ve başka süreçler) aynı postu iki kez sahiplenemez.
 */
export function claimDuePosts(now: Date = new Date()): Promise<ScheduledPost[]> {
  return withPosts((posts, save) => {
    const claimed: ScheduledPost[] = [];
    for (let i = 0; i < posts.length; i++) {
      if (!isClaimable(posts[i], now)) continue;
      posts[i] = {
        ...posts[i],
        status:    'publishing',
        claimedAt: now.toISOString(),
        attempts:  (posts[i].attempts ?? 0) + 1,
      };
      claimed.push(posts[i]);
    }
    if (claimed.length) save(posts);
    return claimed;
  });
}
