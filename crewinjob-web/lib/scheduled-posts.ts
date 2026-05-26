/**
 * Sunucu taraflı zamanlanmış post yöneticisi.
 * data/scheduled-posts.json dosyasında saklar.
 *
 * Her post: { id, platforms[], content, imageData?, imageMime?, scheduledAt (ISO), status }
 */
import fs   from 'fs';
import path from 'path';

const DATA_DIR  = path.join(process.cwd(), 'data');
const POST_FILE = path.join(DATA_DIR, 'scheduled-posts.json');

export type PostStatus = 'pending' | 'published' | 'failed' | 'cancelled';

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
  results?:    Array<{ platform: string; success: boolean; url?: string; error?: string }>;
  note?:       string;   // kullanıcı notu
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadPosts(): ScheduledPost[] {
  try {
    if (fs.existsSync(POST_FILE)) {
      return JSON.parse(fs.readFileSync(POST_FILE, 'utf-8')) as ScheduledPost[];
    }
  } catch { /* ignore */ }
  return [];
}

function savePosts(posts: ScheduledPost[]) {
  ensureDir();
  fs.writeFileSync(POST_FILE, JSON.stringify(posts, null, 2));
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

/** Zamanı gelmiş ve henüz yayınlanmamış postları getir */
export function getDuePosts(now: Date = new Date()): ScheduledPost[] {
  return loadPosts().filter(p =>
    p.status === 'pending' && new Date(p.scheduledAt) <= now
  );
}

/** Gelecek 30 gündeki pending postlar */
export function getUpcomingPosts(days = 30): ScheduledPost[] {
  const limit = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return loadPosts()
    .filter(p => p.status === 'pending' && new Date(p.scheduledAt) <= limit)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}
