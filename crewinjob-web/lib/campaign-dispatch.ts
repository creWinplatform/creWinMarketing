import { agentModule } from '@/lib/agent-bridge';
import { audienceSegmentFilters, getCampaign, updateCampaign, type CampaignDispatch, type FillBucket, type UnifiedCampaign } from '@/lib/campaigns';
import { crewinDispatchAllowed } from '@/lib/crewin-iys-email';

type MarketingApi = {
  marketingCampaignGet: (name: string, query: Record<string, unknown>) => Promise<Record<string, unknown>>;
  marketingCampaignPost: (name: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  marketingProspectPost: (name: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  marketingProspectGet: (name: string, query: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

// Pilot gönderimler backend'e bu sabit entegrasyon kimliğiyle gider (backend pilot/allowlist modunu
// bununla tanıyabilir — sözleşme doğrulanmadığı için değiştirilmedi). Raporlama bu kimlik + backendId /
// dispatchId ile sorgulanır (bkz. CampaignHubTab rapor sorgusu).
export const PILOT_INTEGRATION_ID = 'pilot-test-email';

/** UI'ın TR/EN mesaja çevirebilmesi için kodlu hata. */
export class CampaignDispatchError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CampaignDispatchError';
    this.code = code;
  }
}

function normalize(value: Record<string, unknown>): CampaignDispatch {
  return {
    dispatchId: String(value.dispatchId || ''),
    status: String(value.status || 'queued') as CampaignDispatch['status'],
    estimatedRecipients: value.estimatedRecipients === undefined ? undefined : Number(value.estimatedRecipients),
    totalRecipients: value.totalRecipients === undefined ? undefined : Number(value.totalRecipients),
    queued: value.queued === undefined && value.queuedRecipients === undefined ? undefined : Number(value.queued ?? value.queuedRecipients),
    processing: value.processing === undefined ? undefined : Number(value.processing),
    sent: value.sent === undefined ? undefined : Number(value.sent),
    delivered: value.delivered === undefined ? undefined : Number(value.delivered),
    opened: value.opened === undefined ? undefined : Number(value.opened),
    clicked: value.clicked === undefined ? undefined : Number(value.clicked),
    processed: value.processed === undefined ? undefined : Number(value.processed),
    failed: value.failed === undefined ? undefined : Number(value.failed),
    skipped: value.skipped === undefined ? undefined : Number(value.skipped),
    cancelled: value.cancelled === undefined ? undefined : Number(value.cancelled),
    progressPercent: value.progressPercent === undefined ? undefined : Number(value.progressPercent),
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : undefined,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : undefined,
    lastError: typeof value.lastError === 'string' ? value.lastError : undefined,
    reused: value.reused === undefined ? undefined : Boolean(value.reused),
  };
}

function api() {
  return agentModule<MarketingApi>('modules/api.js');
}

function requireCampaign(id: string): UnifiedCampaign {
  const campaign = getCampaign(id);
  if (!campaign) throw new Error('Kampanya bulunamadı');
  return campaign;
}

function activeDispatchId(value: Record<string, unknown>): number | null | undefined {
  const raw = value.activeDispatchId !== undefined ? value.activeDispatchId : value.ActiveDispatchId;
  if (raw === null) return null;
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function requireActiveDispatchId(campaign: UnifiedCampaign): number {
  const dispatchId = campaign.activeDispatchId;
  if (dispatchId === null || dispatchId === undefined || !Number.isSafeInteger(dispatchId) || dispatchId <= 0) {
    throw new Error('Aktif dispatch bulunamadı. Kampanya listesini yenileyip tekrar deneyin.');
  }
  return dispatchId;
}

// Backend Dispatch İYS kapısından geçmez: zorunlu İYS modunda bireysel kitlelerin kampanyaları panelin kapılı
// gönderimine (lib/campaign-executor.ts → /api/messaging/email/send) düşer; şirket ve prospect kitleleri tacir muafiyetinde.
export function canUseBackendDispatch(campaign: UnifiedCampaign): boolean {
  const isProspectCampaign = campaign.audience.audienceType === 'company_prospects';
  return crewinDispatchAllowed(campaign.audience.audienceType)
    && campaign.deliveries.length === 1
    && campaign.deliveries[0]?.channel === 'email'
    && Boolean(campaign.backendChannels?.email?.templateId || campaign.content.templateId)
    && (isProspectCampaign
      ? Boolean(campaign.audience.manualEmails?.length)
      : Boolean(campaign.backendId));
}

const BUCKET_ORDER: FillBucket[] = ['zero', 'low', 'mid', 'high'];
const BUCKET_RANGES: Record<FillBucket, [number, number]> = { zero: [0, 0], low: [1, 49], mid: [50, 79], high: [80, 100] };

/** Seçili doluluk segmentleri boşluksuz ardışık mı? (ör. zero+low evet, zero+high hayır) */
export function bucketsAreContiguous(buckets: FillBucket[]): boolean {
  const indexes = Array.from(new Set(buckets)).map(bucket => BUCKET_ORDER.indexOf(bucket)).filter(index => index >= 0).sort((a, b) => a - b);
  return indexes.every((value, i) => i === 0 || value === indexes[i - 1] + 1);
}

// Dispatch API'si tek bir profileMin-profileMax aralığı alır. Bitişik olmayan seçim (ör. %0 + %80+)
// 0-100'e genişleyip seçilmeyen segmentlere de gönderirdi → bunun yerine açık hatayla reddedilir.
function audienceRange(buckets: FillBucket[]) {
  if (!buckets.length) return {};
  if (!bucketsAreContiguous(buckets)) {
    throw new CampaignDispatchError(
      'non_contiguous_buckets',
      'Seçili profil segmentleri bitişik değil (ör. %0 ve %80+). Arka plan gönderimi tek bir doluluk aralığı kullanır; bitişik segmentler seçin veya her aralık için ayrı kampanya oluşturun.',
    );
  }
  const ranges = buckets.map(bucket => BUCKET_RANGES[bucket]).filter(Boolean);
  return { profileMin: Math.min(...ranges.map(range => range[0])), profileMax: Math.max(...ranges.map(range => range[1])) };
}

export async function createCampaignDispatch(id: string): Promise<UnifiedCampaign> {
  const campaign = requireCampaign(id);
  if (!crewinDispatchAllowed(campaign.audience.audienceType)) throw new CampaignDispatchError('iys_enforce', 'Zorunlu İYS modunda bireysel kitlelere backend gönderimi kapalı; kampanyayı başlatın, panel İYS kontrolüyle gönderir.');
  if (!canUseBackendDispatch(campaign)) throw new Error('Background dispatch için yalnız e-posta kanalı ve backend şablonu gereklidir.');
  const isProspectCampaign = campaign.audience.audienceType === 'company_prospects';
  const templateId = campaign.backendChannels?.email?.templateId || campaign.content.templateId;
  const integrationId = campaign.maxRecipients ? PILOT_INTEGRATION_ID : campaign.id;
  let result: Record<string, unknown>;
  if (isProspectCampaign) {
    const recipients = Array.from(new Set((campaign.audience.manualEmails || []).map(item => item.trim().toLowerCase()).filter(Boolean)));
    const preflight = await api().marketingProspectPost('Preflight', {
      prospectIds: [],
      emails: recipients,
      channel: 'email',
      templateId,
    });
    const preflightRoot = preflight && typeof preflight === 'object' && preflight.result && typeof preflight.result === 'object'
      ? preflight.result as Record<string, unknown>
      : preflight;
    if (preflightRoot && (preflightRoot.allowed === false || preflightRoot.canDispatch === false || preflightRoot.valid === false)) {
      throw new Error(String(preflightRoot.error || preflightRoot.message || 'Prospect kampanyası gönderim ön kontrolünden geçemedi.'));
    }
    result = await api().marketingProspectPost('DispatchCampaign', {
      campaignId: campaign.backendId || null,
      campaignIntegrationId: integrationId,
      ...(campaign.maxRecipients ? { maxRecipients: campaign.maxRecipients } : {}),
      prospectIds: [],
      emails: recipients,
      recipients,
      channel: 'email',
      templateId,
      subject: campaign.content.subject || campaign.name,
      templateVariables: { CTA_URL: campaign.content.ctaUrl || 'https://www.crewinjob.com/account/login' },
      scheduledAt: campaign.launchAt || null,
      idempotencyKey: `marketing-panel:${campaign.id}:email`,
    });
  } else {
    // Önizleme ile aynı segment filtreleri (uyruk, aktiflik dahil) — bkz. audienceSegmentFilters
    const audienceFilters = {
      ...audienceRange(campaign.audience.fillBuckets || []),
      ...audienceSegmentFilters(campaign.audience),
    };
    result = await api().marketingCampaignPost('Dispatch', {
      campaignId: campaign.backendId || null,
      campaignIntegrationId: integrationId,
      ...(campaign.maxRecipients ? { maxRecipients: campaign.maxRecipients } : {}),
      audienceFilters,
      channel: 'email',
      templateId,
      // firstName ve UNSUBSCRIBE_URL alıcı bazında backend worker tarafından üretilir.
      // Panel yalnızca kampanyanın ortak CTA değerini gönderir.
      templateVariables: {
        CTA_URL: campaign.content.ctaUrl || 'https://www.crewinjob.com/account/login',
      },
      scheduledAt: campaign.launchAt || null,
      idempotencyKey: `marketing-panel:${campaign.id}:email`,
    });
  }
  const dispatch = normalize(result);
  const newActiveDispatchId = activeDispatchId(result);
  return (await updateCampaign(id, {
    dispatch,
    ...(newActiveDispatchId !== undefined ? { activeDispatchId: newActiveDispatchId } : {}),
    status: dispatch.status === 'completed' ? 'completed' : 'running',
    launchedAt: campaign.launchedAt || new Date().toISOString(),
  }))!;
}

export async function refreshCampaignDispatch(id: string): Promise<UnifiedCampaign> {
  const campaign = requireCampaign(id);
  const isProspectCampaign = campaign.audience.audienceType === 'company_prospects';
  const dispatchId = isProspectCampaign ? campaign.dispatch?.dispatchId : campaign.activeDispatchId;
  if (!dispatchId) throw new Error('Dispatch bulunamadı');
  const result = isProspectCampaign
    ? await api().marketingProspectGet('GetDispatchStatus', { dispatchId })
    : await api().marketingCampaignGet('GetDispatchStatus', { dispatchId });
  const dispatch = normalize(result);
  if (campaign.audience.audienceType === 'company_prospects' && result.status === 'dispatched') {
    dispatch.status = 'completed';
    dispatch.dispatched = Number(result.dispatched || 0);
    dispatch.totalTargeted = Number(result.totalTargeted || 0);
    dispatch.sent = dispatch.dispatched;
    dispatch.totalRecipients = dispatch.totalTargeted;
    dispatch.progressPercent = dispatch.totalTargeted ? Math.round((dispatch.dispatched / dispatch.totalTargeted) * 100) : 100;
    dispatch.dispatchedAt = typeof result.dispatchedAt === 'string' ? result.dispatchedAt : undefined;
  }
  const status = dispatch.status === 'completed' ? 'completed' : dispatch.status === 'cancelled' ? 'cancelled' : dispatch.status === 'failed' ? 'failed' : 'running';
  return (await updateCampaign(id, { dispatch, status, ...(dispatch.completedAt ? { completedAt: dispatch.completedAt } : {}) }))!;
}

export async function mutateCampaignDispatch(id: string, action: 'cancel' | 'retry'): Promise<UnifiedCampaign> {
  const campaign = requireCampaign(id);
  // Prospect dispatch'leri MarketingProspect servisinde yaşar (kimlik dispatch.dispatchId);
  // seafarer dispatch'leri MarketingCampaign'de (kimlik activeDispatchId).
  const isProspectCampaign = campaign.audience.audienceType === 'company_prospects';
  const dispatchId = isProspectCampaign
    ? (campaign.dispatch?.dispatchId || campaign.activeDispatchId)
    : (campaign.activeDispatchId ?? campaign.dispatch?.dispatchId);
  if (!dispatchId) throw new Error('Dispatch bulunamadı');
  // Durdurmak her zaman serbest; yeniden denemek yeni gönderimdir ve zorunlu İYS modunda bireysel kitlelere kapalıdır.
  if (action === 'retry' && !crewinDispatchAllowed(campaign.audience.audienceType)) throw new CampaignDispatchError('iys_enforce', 'Zorunlu İYS modunda bireysel kitlelere backend gönderimi kapalı; kampanyayı başlatın, panel İYS kontrolüyle gönderir.');
  const post = (name: string, body: Record<string, unknown>) => isProspectCampaign
    ? api().marketingProspectPost(name, body)
    : api().marketingCampaignPost(name, body);
  let result: Record<string, unknown>;
  if (action === 'cancel') {
    try {
      result = await post('CancelDispatch', { dispatchId });
    } catch (cancelError) {
      // "Aktif dispatch bulunamadı" → dispatch zaten sona ermiş, gerçek durumu sorgula
      if (cancelError instanceof Error && /Aktif dispatch bulunamad|no active dispatch/i.test(cancelError.message)) {
        try {
          const statusResult = isProspectCampaign
            ? await api().marketingProspectGet('GetDispatchStatus', { dispatchId })
            : await api().marketingCampaignGet('GetDispatchStatus', { dispatchId });
          const d = normalize(statusResult);
          const s = d.status === 'completed' ? 'completed' : d.status === 'cancelled' ? 'cancelled' : d.status === 'failed' ? 'failed' : 'completed';
          return (await updateCampaign(id, { dispatch: d, status: s }))!;
        } catch {
          const d = normalize({ ...(campaign.dispatch || {}), status: 'cancelled' });
          return (await updateCampaign(id, { dispatch: d, status: 'cancelled', activeDispatchId: null }))!;
        }
      }
      throw cancelError;
    }
  } else {
    try {
      result = await post('RetryDispatch', { dispatchId });
    } catch (error) {
      if (!(error instanceof Error) || !/HTTP (404|405)/.test(error.message)) throw error;
      result = await post('RetryFailedRecipients', { dispatchId });
    }
  }
  const dispatch = action === 'cancel' && (!result || !result.dispatchId)
    ? normalize({ ...(campaign.dispatch || {}), status: 'cancelled' })
    : normalize(result || {});
  const status = dispatch.status === 'completed' ? 'completed' : dispatch.status === 'cancelled' ? 'cancelled' : 'running';
  return (await updateCampaign(id, { dispatch, status }))!;
}
