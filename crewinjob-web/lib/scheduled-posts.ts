/**
 * Sunucu taraflı zamanlanmış post yöneticisi.
 * data/scheduled-posts.json dosyasında saklar.
 *
 * Her post: { id, platforms[], content, imageData?, imageMime?, scheduledAt (ISO), status }
 *
 * Buradaki fonksiyonlar senkron (load → değiştir → kaydet arasında await yok); async akışlar
 * (publish, backend senkronu) SCHEDULED_POSTS_LOCK anahtarıyla withFileLock kullanır.
 */
import path from 'path';
import { readJson, writeJsonAtomic } from '@/lib/json-store';

const DATA_DIR  = path.join(process.cwd(), 'data');
const POST_FILE = path.join(DATA_DIR, 'scheduled-posts.json');

/** withFileLock anahtarı — zamanlanmış post dosyasına yazan tüm async akışlar bunu kullanır */
export const SCHEDULED_POSTS_LOCK = POST_FILE;

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

export function loadPosts(): ScheduledPost[] {
  const list = readJson<ScheduledPost[]>(POST_FILE, []);
  return Array.isArray(list) ? list : [];
}

function savePosts(posts: ScheduledPost[]) {
  writeJsonAtomic(POST_FILE, posts);
}

export function upsertPost(post: ScheduledPost): ScheduledPost {
  const posts = loadPosts();
  const index = posts.findIndex(item => item.id === post.id);
  if (index >= 0) posts[index] = post;
  else posts.push(post);
  savePosts(posts);
  return post;
}

/** Yeni zamanlanmış post oluştur */
export function createPost(data: Omit<ScheduledPost, 'id' | 'createdAt' | 'status'>): ScheduledPost {
  const posts = loadPosts();
  const newPost: ScheduledPost = {
    ...data,
    id:        `sched_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    status:    'pending',
    createdAt: new Date().toISOString(),
  };
  savePosts([...posts, newPost]);
  return newPost;
}

/** Postu güncelle */
export function updatePost(id: string, patch: Partial<ScheduledPost>): ScheduledPost | null {
  const posts = loadPosts();
  const idx   = posts.findIndex(p => p.id === id);
  if (idx === -1) return null;
  posts[idx] = { ...posts[idx], ...patch };
  savePosts(posts);
  return posts[idx];
}

/** Postu sil */
export function deletePost(id: string): boolean {
  const posts = loadPosts();
  const filtered = posts.filter(p => p.id !== id);
  if (filtered.length === posts.length) return false;
  savePosts(filtered);
  return true;
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
export function getDuePosts(now: Date = new Date()): ScheduledPost[] {
  return loadPosts().filter(p => isClaimable(p, now));
}

/**
 * Zamanı gelen postları tek adımda 'publishing' durumuna alır ve döndürür.
 * Senkron (load → işaretle → kaydet) — çağıran ayrıca SCHEDULED_POSTS_LOCK ile sarar;
 * böylece paralel cron / "Şimdi Yayınla" aynı postu iki kez sahiplenemez.
 */
export function claimDuePosts(now: Date = new Date()): ScheduledPost[] {
  const posts   = loadPosts();
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
  if (claimed.length) savePosts(posts);
  return claimed;
}
