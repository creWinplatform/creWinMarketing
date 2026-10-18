// SEO iş kartları — data/seo-work-items.json. Tek kaynak: hem /api/data/seo-work-items hem site-crawl bunu kullanır.
// Read-modify-write işlemleri withFileLock ile sıralanır, yazma writeJsonAtomic ile (yarım dosya kalmaz).
import path from 'path';
import { readJson, withFileLock, writeJsonAtomic } from '@/lib/json-store';
import { marketingBackend } from '@/lib/marketing-backend';
import type { AuditPriority } from '@/lib/site-audit';

export type SeoWorkStatus = 'proposed' | 'approved' | 'rejected' | 'applied';
export type SeoWorkItem = { id: string; url: string; title: string; recommendation: string; evidence: string; priority: AuditPriority; status: SeoWorkStatus; createdAt: string; updatedAt: string; appliedAt?: string; implementationNote?: string; affectedUrls?: string[]; source?: 'manual' | 'site_crawl' };

export const SEO_WORK_STATUSES: SeoWorkStatus[] = ['proposed', 'approved', 'rejected', 'applied'];
export const SEO_WORK_PRIORITIES: AuditPriority[] = ['high', 'medium', 'low'];

const FILE = path.join(process.cwd(), 'data', 'seo-work-items.json');
const LOCK_KEY = 'seo-work-items';

function load(): SeoWorkItem[] {
  const items = readJson<unknown>(FILE, []);
  return Array.isArray(items) ? items as SeoWorkItem[] : [];
}

function save(items: SeoWorkItem[]) { writeJsonAtomic(FILE, items); }

export function listSeoWorkItems(): SeoWorkItem[] {
  return load().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function addActivity(label: string, detail: string, item: SeoWorkItem) {
  try { await marketingBackend().marketingActivityPost('Add', { activityType: `seo_${item.status}`, label, detail, entityType: 'seo_recommendation', entityId: item.id, metadata: { url: item.url, priority: item.priority, affectedUrls: item.affectedUrls || [], implementationNote: item.implementationNote || null }, occurredAt: item.updatedAt }); } catch { /* Uzak aktivite kaydı yoksa yerel akış devam eder. */ }
}

function newItem(input: Omit<SeoWorkItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>): SeoWorkItem {
  const now = new Date().toISOString();
  return { ...input, id: `seo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, status: 'proposed', createdAt: now, updatedAt: now };
}

export async function createSeoWorkItem(input: Omit<SeoWorkItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<SeoWorkItem> {
  const item = await withFileLock(LOCK_KEY, () => {
    const created = newItem(input);
    save([created, ...load()]);
    return created;
  });
  void addActivity('SEO önerisi oluşturuldu', item.title, item);
  return item;
}

export async function createOrMergeCrawlWorkItem(input: Omit<SeoWorkItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<SeoWorkItem> {
  const result = await withFileLock(LOCK_KEY, () => {
    const items = load();
    const key = `${input.url}|${input.title}`;
    const existingIndex = items.findIndex(item => `${item.url}|${item.title}` === key && item.status !== 'rejected');
    if (existingIndex >= 0) {
      const current = items[existingIndex];
      const merged: SeoWorkItem = { ...current, affectedUrls: Array.from(new Set([...(current.affectedUrls || []), ...(input.affectedUrls || [])])).slice(0, 100), evidence: input.evidence, updatedAt: new Date().toISOString(), source: 'site_crawl' };
      items[existingIndex] = merged;
      save(items);
      return { item: merged, created: false };
    }
    const created = newItem(input);
    save([created, ...items]);
    return { item: created, created: true };
  });
  if (result.created) void addActivity('SEO önerisi oluşturuldu', result.item.title, result.item);
  return result.item;
}

export async function updateSeoWorkItem(id: string, status: SeoWorkStatus, implementationNote?: string): Promise<SeoWorkItem | null> {
  const item = await withFileLock(LOCK_KEY, () => {
    const items = load();
    const index = items.findIndex(entry => entry.id === id);
    if (index < 0) return null;
    const now = new Date().toISOString();
    const updated: SeoWorkItem = { ...items[index], status, updatedAt: now, implementationNote: implementationNote?.trim() || items[index].implementationNote, ...(status === 'applied' ? { appliedAt: now } : {}) };
    items[index] = updated;
    save(items);
    return updated;
  });
  if (item) void addActivity(`SEO önerisi: ${status}`, item.title, item);
  return item;
}
