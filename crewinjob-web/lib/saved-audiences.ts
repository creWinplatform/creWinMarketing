import type { CampaignAudience, FillBucket } from '@/lib/campaigns';
import { mutateStore, readStore, webStore } from '@/lib/legacy-store';

// data/campaign-audiences.json, or legacy_records 'web:campaign-audiences' with PLATFORM_LEGACY_STORE=mssql.
const STORE = () => webStore('campaign-audiences.json', 'array');
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

export function loadSavedAudiences(): Promise<SavedAudience[]> {
  return readStore<SavedAudience>(STORE());
}

export function validateSavedAudience(input: SaveAudienceInput): string | null {
  if (!input?.name?.trim()) return 'Kitle adı zorunludur.';
  const filters = normalizeFilters(input.filters);
  if (!filters.fillBuckets.length) return 'En az bir profil segmenti seçilmelidir.';
  return null;
}

export async function createSavedAudience(input: SaveAudienceInput): Promise<SavedAudience> {
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
  await mutateStore(STORE(), items => [item, ...items]);
  return item;
}

export async function deleteSavedAudience(id: string): Promise<boolean> {
  let removed = false;
  await mutateStore(STORE(), items => {
    const next = items.filter(item => (item as SavedAudience).id !== id);
    if (next.length === items.length) return undefined;
    removed = true;
    return next;
  });
  return removed;
}

export interface SavedAudienceStore {
  list(): Promise<SavedAudience[]>;
  create(input: SaveAudienceInput): Promise<SavedAudience>;
  remove(id: string): Promise<boolean>;
}

const localSavedAudienceStore: SavedAudienceStore = {
  list: loadSavedAudiences,
  create: createSavedAudience,
  remove: deleteSavedAudience,
};

export function getSavedAudienceStore(): SavedAudienceStore {
  return localSavedAudienceStore;
}
