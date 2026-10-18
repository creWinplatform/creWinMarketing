import fs from 'fs';
import path from 'path';
import type { CampaignAudience, FillBucket } from '@/lib/campaigns';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'campaign-audiences.json');
const FILL_BUCKETS: FillBucket[] = ['zero', 'low', 'mid', 'high'];

export type SavedAudienceFilters = Pick<CampaignAudience, 'fillBuckets' | 'countries' | 'nationalities' | 'positions' | 'activity' | 'reachableChannels'>;

export interface SavedAudience {
  id: string;
  name: string;
  description?: string;
  filters: SavedAudienceFilters;
  estimatedRecipients?: number;
  storage?: 'backend' | 'local';
  createdAt: string;
  updatedAt: string;
}

export interface SaveAudienceInput {
  name: string;
  description?: string;
  filters: SavedAudienceFilters;
  estimatedRecipients?: number;
}

function uniqueStrings(value: unknown, uppercase = false): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => uppercase ? item.toUpperCase() : item);
  return Array.from(new Set(items));
}

function normalizeFilters(value: SavedAudienceFilters): SavedAudienceFilters {
  const fillBuckets = Array.isArray(value?.fillBuckets)
    ? Array.from(new Set(value.fillBuckets.filter(bucket => FILL_BUCKETS.includes(bucket))))
    : [];
  return {
    fillBuckets,
    countries: uniqueStrings(value?.countries, true),
    nationalities: uniqueStrings(value?.nationalities),
    positions: uniqueStrings(value?.positions),
    activity: value?.activity === 'active' || value?.activity === 'inactive' ? value.activity : 'all',
    reachableChannels: uniqueStrings(value?.reachableChannels)
      .filter(item => ['email', 'whatsapp', 'telegram', 'push'].includes(item)) as SavedAudienceFilters['reachableChannels'],
  };
}

function writeSavedAudiences(items: SavedAudience[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(items, null, 2));
  fs.renameSync(temp, FILE);
}

export function loadSavedAudiences(): SavedAudience[] {
  try {
    if (!fs.existsSync(FILE)) return [];
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(value) ? value as SavedAudience[] : [];
  } catch {
    return [];
  }
}

export function validateSavedAudience(input: SaveAudienceInput): string | null {
  if (!input?.name?.trim()) return 'Kitle adı zorunludur.';
  const filters = normalizeFilters(input.filters);
  if (!filters.fillBuckets.length) return 'En az bir profil segmenti seçilmelidir.';
  return null;
}

export function createSavedAudience(input: SaveAudienceInput): SavedAudience {
  const now = new Date().toISOString();
  const item: SavedAudience = {
    id: `aud_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    filters: normalizeFilters(input.filters),
    estimatedRecipients: input.estimatedRecipients,
    storage: 'local',
    createdAt: now,
    updatedAt: now,
  };
  writeSavedAudiences([item, ...loadSavedAudiences()]);
  return item;
}

export function deleteSavedAudience(id: string): boolean {
  const items = loadSavedAudiences();
  const next = items.filter(item => item.id !== id);
  if (next.length === items.length) return false;
  writeSavedAudiences(next);
  return true;
}

export interface SavedAudienceStore {
  list(): SavedAudience[];
  create(input: SaveAudienceInput): SavedAudience;
  remove(id: string): boolean;
}

const localSavedAudienceStore: SavedAudienceStore = {
  list: loadSavedAudiences,
  create: createSavedAudience,
  remove: deleteSavedAudience,
};

export function getSavedAudienceStore(): SavedAudienceStore {
  return localSavedAudienceStore;
}
