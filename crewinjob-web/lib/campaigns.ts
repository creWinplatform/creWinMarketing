import path from 'path';
import type { AdPlatform } from '@/lib/ads-types';
import { readJson, withFileLock, writeJsonAtomic } from '@/lib/json-store';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'campaigns.json');
// Tüm read-modify-write işlemleri bu kilit altında (eşzamanlı cron / "şimdi başlat" / UI yazmaları)
const LOCK_KEY = 'campaigns';
const ACTIVE_WINDOW_DAYS = 30;

export type CampaignStatus = 'draft' | 'ready' | 'scheduled' | 'running' | 'partial' | 'completed' | 'failed' | 'cancelled';
export type CampaignObjective =
  | 'awareness'
  | 'traffic'
  | 'registration'
  | 'job_application'
  | 'reactivation'
  | 'profile_completion'
  | 'company_acquisition'
  | 'free_job_posting'
  | 'applicant_growth'
  | 'cv_unlock'
  | 'bullseye_cv_unlock';
export type CampaignAudienceType = 'seafarers' | 'maritime_businesses' | 'company_prospects';
export type ProspectSource = 'manual' | 'csv' | 'crm' | 'external';
export type FillBucket = 'zero' | 'low' | 'mid' | 'high';
export type DeliveryStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface CampaignAudience {
  fillBuckets: FillBucket[];
  audienceType?: CampaignAudienceType;
  prospectSource?: ProspectSource;
  prospectCompanyTypes?: string[];
  countries?: string[];
  nationalities?: string[];
  positions?: string[];
  activity?: 'all' | 'active' | 'inactive';
  reachableChannels?: Array<'email' | 'whatsapp' | 'telegram' | 'push'>;
  manualEmails?: string[];
  whatsappNumbers?: string[];
  telegramChatIds?: Array<string | number>;
  consentConfirmed?: boolean;
}

export interface CampaignChannels {
  social: string[];
  email: boolean;
  whatsapp: boolean;
  telegram: boolean;
  paidAds: AdPlatform[];
}

export interface CampaignContent {
  text: string;
  templateId?: string;
  subject?: string;
  html?: string;
  imageData?: string;
  imageMime?: string;
  perPlatformContent?: Record<string, string>;
  ctaUrl?: string;
}

export interface CampaignBackendChannelConfig {
  templateId?: string;
  integrationId?: string;
}

export interface CampaignDispatch {
  dispatchId: string;
  status: 'queued' | 'processing' | 'completed' | 'cancelled' | 'failed';
  estimatedRecipients?: number;
  totalRecipients?: number;
  queued?: number;
  processing?: number;
  sent?: number;
  delivered?: number;
  opened?: number;
  clicked?: number;
  processed?: number;
  failed?: number;
  skipped?: number;
  cancelled?: number;
  progressPercent?: number;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  reused?: boolean;
  idempotencyKey?: string;
  campaignName?: string;
  channel?: string;
  dispatched?: number;
  totalTargeted?: number;
  dispatchedAt?: string;
}

export interface CampaignBudget {
  currency: string;
  dailyByPlatform: Partial<Record<AdPlatform, number>>;
}

export interface CampaignDelivery {
  id: string;
  channel: string;
  status: DeliveryStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  externalId?: string;
  url?: string;
  sentCount?: number;
  failedCount?: number;
  error?: string;
}

export interface UnifiedCampaign {
  id: string;
  goalId?: string;
  segmentBinding?: import('./platform/segment-types').SegmentBinding;
  backendId?: string;
  backendVersion?: 'v1' | 'v2';
  backendSync?: 'synced' | 'local_only' | 'pending';
  /** Backend'den gelen aktif dispatch ID (long). null = aktif dispatch yok. */
  activeDispatchId?: number | null;
  /** Yalnızca backend'de olan (yerel kaydı olmayan) kampanya — panelden düzenlenemez/başlatılamaz/silinemez. */
  remoteOnly?: boolean;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  audience: CampaignAudience;
  channels: CampaignChannels;
  content: CampaignContent;
  backendChannels?: Record<string, CampaignBackendChannelConfig>;
  maxRecipients?: number;
  budget: CampaignBudget;
  launchAt?: string;
  timezone: string;
  utm: {
    campaign: string;
    source?: string;
    medium?: string;
  };
  deliveries: CampaignDelivery[];
  dispatch?: CampaignDispatch;
  createdAt: string;
  updatedAt: string;
  launchedAt?: string;
  completedAt?: string;
}

export type CreateCampaignInput = Pick<UnifiedCampaign, 'name' | 'objective' | 'audience' | 'channels' | 'content'> & {
  goalId?: string;
  backendChannels?: UnifiedCampaign['backendChannels'];
  maxRecipients?: number;
  budget?: Partial<CampaignBudget>;
  launchAt?: string;
  timezone?: string;
  utm?: Partial<UnifiedCampaign['utm']>;
};

export function loadCampaigns(): UnifiedCampaign[] {
  const value = readJson<unknown>(FILE, []);
  return Array.isArray(value) ? value as UnifiedCampaign[] : [];
}

// Kilit altında oku → değiştir → atomik yaz. fn `items` dönerse dosya yazılır.
// Not: withFileLock yeniden girişli değildir; fn içinden başka mutate çağrısı yapılmamalı.
function mutateCampaigns<T>(fn: (items: UnifiedCampaign[]) => { items?: UnifiedCampaign[]; result: T }): Promise<T> {
  return withFileLock(LOCK_KEY, () => {
    const { items, result } = fn(loadCampaigns());
    if (items) writeJsonAtomic(FILE, items);
    return result;
  });
}

export function isRemoteOnlyCampaignId(id: string): boolean {
  return id.startsWith('cmp_remote_');
}

/** createCampaign ile aynı kural: gelecekteki launchAt → scheduled, aksi halde ready. */
export function statusForLaunchAt(launchAt?: string | null): CampaignStatus {
  return launchAt && new Date(launchAt).getTime() > Date.now() ? 'scheduled' : 'ready';
}

/**
 * Önizleme (PreviewAudience) ile gerçek gönderimde (Dispatch, GetCampaignRecipients, backend snapshot)
 * kullanılan ortak segment filtreleri — önizlenen kitle ile gönderilen kitle aynı kurallarla hesaplanır.
 */
export function audienceSegmentFilters(audience: Pick<CampaignAudience, 'countries' | 'nationalities' | 'positions' | 'activity'>, now = new Date()) {
  return {
    countries: (audience.countries || []).map(item => String(item).trim().toUpperCase()).filter(Boolean),
    nationalities: (audience.nationalities || []).map(item => String(item).trim()).filter(Boolean),
    positions: (audience.positions || []).map(item => String(item).trim()).filter(Boolean),
    ...(audience.activity === 'inactive' ? { inactiveForDays: ACTIVE_WINDOW_DAYS } : {}),
    ...(audience.activity === 'active' ? { lastActiveFrom: new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString() } : {}),
  };
}

function slug(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'kampanya';
}

function deliveryChannels(channels: CampaignChannels): string[] {
  return [
    ...channels.social.map(platform => `social:${platform}`),
    ...(channels.email ? ['email'] : []),
    ...(channels.whatsapp ? ['whatsapp'] : []),
    ...(channels.telegram ? ['telegram'] : []),
    ...channels.paidAds.map(platform => `ads:${platform}`),
  ];
}

export function buildCampaign(input: CreateCampaignInput): UnifiedCampaign {
  const now = new Date().toISOString();
  const id = `cmp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const channels: CampaignChannels = {
    social: input.channels.social || [],
    email: Boolean(input.channels.email),
    whatsapp: Boolean(input.channels.whatsapp),
    telegram: Boolean(input.channels.telegram),
    paidAds: input.channels.paidAds || [],
  };
  const launchAt = input.launchAt ? new Date(input.launchAt).toISOString() : undefined;
  const campaign: UnifiedCampaign = {
    id,
    ...(input.goalId ? { goalId: input.goalId } : {}),
    backendSync: 'local_only',
    name: input.name.trim(),
    objective: input.objective,
    status: statusForLaunchAt(launchAt),
    audience: { ...input.audience, fillBuckets: input.audience.fillBuckets || [] },
    channels,
    content: input.content,
    backendChannels: input.backendChannels,
    ...(input.maxRecipients ? { maxRecipients: input.maxRecipients } : {}),
    budget: {
      currency: input.budget?.currency || 'USD',
      dailyByPlatform: input.budget?.dailyByPlatform || {},
    },
    launchAt,
    timezone: input.timezone || 'Europe/Istanbul',
    utm: {
      campaign: input.utm?.campaign || `${slug(input.name)}-${id.slice(-8)}`,
      source: input.utm?.source,
      medium: input.utm?.medium,
    },
    deliveries: deliveryChannels(channels).map((channel, index) => ({
      id: `${id}_d${index + 1}`,
      channel,
      status: 'pending',
      attempts: 0,
    })),
    createdAt: now,
    updatedAt: now,
  };
  return campaign;
}

export async function createCampaign(input: CreateCampaignInput): Promise<UnifiedCampaign> {
  const campaign = buildCampaign(input);
  return mutateCampaigns(items => ({ items: [campaign, ...items], result: campaign }));
}

export function getCampaign(id: string): UnifiedCampaign | null {
  return loadCampaigns().find(item => item.id === id) || null;
}

// items dizisini yerinde günceller (kilit içinde çağrılır); bulunamazsa null.
function applyCampaignPatch(items: UnifiedCampaign[], id: string, patch: Partial<UnifiedCampaign>): UnifiedCampaign | null {
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current = items[index];
  const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
  if (patch.channels) {
    const previousByChannel = new Map(current.deliveries.map(delivery => [delivery.channel, delivery]));
    next.deliveries = deliveryChannels(next.channels).map((channel, deliveryIndex) => previousByChannel.get(channel) || {
      id: `${id}_d${deliveryIndex + 1}`,
      channel,
      status: 'pending' as const,
      attempts: 0,
    });
  }
  items[index] = next;
  return next;
}

export function updateCampaign(id: string, patch: Partial<UnifiedCampaign>): Promise<UnifiedCampaign | null> {
  return mutateCampaigns(items => {
    const next = applyCampaignPatch(items, id, patch);
    return next ? { items, result: next } : { result: null };
  });
}

export function updateDelivery(campaignId: string, deliveryId: string, patch: Partial<CampaignDelivery>): Promise<UnifiedCampaign | null> {
  return mutateCampaigns(items => {
    const campaign = items.find(item => item.id === campaignId);
    if (!campaign) return { result: null };
    const next = applyCampaignPatch(items, campaignId, {
      deliveries: campaign.deliveries.map(delivery =>
        delivery.id === deliveryId ? { ...delivery, ...patch, id: deliveryId } : delivery
      ),
    });
    return { items, result: next };
  });
}

export function deleteCampaign(id: string): Promise<boolean> {
  return mutateCampaigns(items => {
    const next = items.filter(item => item.id !== id);
    return next.length === items.length ? { result: false } : { items: next, result: true };
  });
}

function isDue(item: UnifiedCampaign, now: Date): boolean {
  return item.status === 'scheduled' && Boolean(item.launchAt) && new Date(item.launchAt!).getTime() <= now.getTime();
}

export function getDueCampaigns(now = new Date()): UnifiedCampaign[] {
  return loadCampaigns().filter(item => isDue(item, now));
}

/**
 * Zamanı gelmiş 'scheduled' kampanyaları kilit altında atomik olarak 'running'e çeker (claim).
 * Çakışan cron çalışmaları veya "şimdi başlat" aynı kampanyayı ikinci kez gönderemez.
 */
export function claimDueCampaigns(now = new Date()): Promise<UnifiedCampaign[]> {
  return mutateCampaigns(items => {
    const claimed: UnifiedCampaign[] = [];
    for (const item of items.slice()) {
      if (!isDue(item, now)) continue;
      const next = applyCampaignPatch(items, item.id, { status: 'running' });
      if (next) claimed.push(next);
    }
    return claimed.length ? { items, result: claimed } : { result: claimed };
  });
}

/**
 * Tek kampanyayı çalıştırmak için claim: durumu `allowed` içindeyse kilit altında 'running' yapar.
 * Zaten çalışıyorsa veya durum uygun değilse null döner.
 */
export function claimCampaign(id: string, allowed: CampaignStatus[]): Promise<{ campaign: UnifiedCampaign; previousStatus: CampaignStatus } | null> {
  return mutateCampaigns(items => {
    const current = items.find(item => item.id === id);
    if (!current || !allowed.includes(current.status)) return { result: null };
    const next = applyCampaignPatch(items, id, { status: 'running' });
    return next ? { items, result: { campaign: next, previousStatus: current.status } } : { result: null };
  });
}

/** Claim sonrası gönderim başlamadan hata olursa: hâlâ 'running' ise verilen duruma çeker. */
export function releaseCampaign(id: string, status: CampaignStatus): Promise<UnifiedCampaign | null> {
  return mutateCampaigns(items => {
    const current = items.find(item => item.id === id);
    if (!current || current.status !== 'running') return { result: current || null };
    const next = applyCampaignPatch(items, id, { status });
    return { items, result: next };
  });
}

export function appendUtm(text: string, campaign: UnifiedCampaign, source: string, medium: string): string {
  return text.replace(/https?:\/\/[^\s<>"]+/g, raw => {
    const suffix = raw.match(/[),.!?]+$/)?.[0] || '';
    const candidate = suffix ? raw.slice(0, -suffix.length) : raw;
    try {
      const url = new URL(candidate);
      url.searchParams.set('utm_campaign', campaign.utm.campaign);
      url.searchParams.set('utm_source', source);
      url.searchParams.set('utm_medium', medium);
      url.searchParams.set('utm_content', campaign.id);
      return `${url.toString()}${suffix}`;
    } catch {
      return raw;
    }
  });
}
