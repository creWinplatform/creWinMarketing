import { NextRequest, NextResponse } from 'next/server';
import {
  audienceSegmentFilters,
  deleteCampaign,
  getCampaign,
  isRemoteOnlyCampaignId,
  statusForLaunchAt,
  updateCampaign,
  type UnifiedCampaign,
} from '@/lib/campaigns';
import { agentModule } from '@/lib/agent-bridge';
import { projectCampaignResponse } from '@/lib/platform/marketing-routes';

// cmp_remote_* kampanyalar yalnızca backend'de var (yerel kayıt yok) → 404 yerine açık 409
function remoteOnlyResponse() {
  return NextResponse.json({ error: 'Bu kampanya yalnızca backend\'de kayıtlı; düzenleme/silme backend yönetiminden yapılmalı. / This campaign exists only in the backend; manage it there.', code: 'remote_only' }, { status: 409 });
}

function backendChannel(value: string) {
  const channel = value.replace(/^(social|ads):/, '');
  if (value === 'ads:meta') return 'metaAds';
  if (value === 'ads:linkedin') return 'linkedinAds';
  if (value === 'ads:google') return 'googleAds';
  return channel;
}

function backendObjective(value: string) {
  if (value === 'job_application') return 'application';
  if (['profile_completion', 'reactivation'].includes(value)) return 'activation';
  if (['company_acquisition', 'free_job_posting', 'applicant_growth', 'cv_unlock', 'bullseye_cv_unlock'].includes(value)) return 'acquisition';
  return value;
}

function backendFilters(campaign: UnifiedCampaign) {
  return {
    audienceType: campaign.audience.audienceType || 'seafarers',
    ...(campaign.audience.audienceType === 'company_prospects' ? {
      prospectSource: campaign.audience.prospectSource || 'manual',
      companyTypes: campaign.audience.prospectCompanyTypes || [],
    } : {}),
    profileBuckets: campaign.audience.fillBuckets,
    // Önizleme ve gönderimle aynı filtreler (uyruk, aktif/pasif)
    ...audienceSegmentFilters(campaign.audience),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, ms);
    promise.then(
      value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } },
    );
  });
}

async function syncBackendCampaign(campaign: UnifiedCampaign) {
  if (!campaign.backendId) return campaign.backendId;
  const api = agentModule<{
    marketingCampaignPost: (name: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
    marketingCampaignV2Post: (name: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }>('modules/api.js');
  if (campaign.backendVersion === 'v2' || campaign.deliveries.length > 1) {
    const backend = await api.marketingCampaignV2Post('CreateOrUpdate', {
      id: campaign.backendId,
      name: campaign.name,
      objective: backendObjective(campaign.objective),
      audienceId: null,
      filters: backendFilters(campaign),
      scheduledAt: campaign.launchAt || null,
      timezone: campaign.timezone,
      campaignIntegrationId: campaign.id,
      targetUrl: campaign.content.ctaUrl || null,
      maxRecipients: campaign.maxRecipients || 0,
      utmCampaign: campaign.utm.campaign,
      utmSource: campaign.utm.source || null,
      utmMedium: campaign.utm.medium || null,
      status: campaign.status === 'ready' ? 'draft' : campaign.status,
      channels: campaign.deliveries.map(delivery => {
        const channel = backendChannel(delivery.channel);
        const config = campaign.backendChannels?.[channel] || {};
        return { channel, integrationId: config.integrationId || null, templateId: config.templateId || null, subject: channel === 'email' ? campaign.content.subject || null : null, content: campaign.content.text, targetUrl: campaign.content.ctaUrl || null, enabled: true };
      }),
    });
    return String(backend.id || campaign.backendId);
  }
  const channel = campaign.deliveries[0]?.channel.replace(/^(social|ads):/, '') || 'email';
  const config = campaign.backendChannels?.[channel] || {};
  const payload = {
    id: campaign.backendId,
    name: campaign.name,
    channel,
    integrationId: config.integrationId || null,
    templateId: config.templateId || campaign.content.templateId || null,
    audienceId: null,
    audienceSnapshot: backendFilters(campaign),
    campaignIntegrationId: campaign.id,
    status: campaign.status,
    scheduledAt: campaign.launchAt || null,
  };
  try {
    const backend = await api.marketingCampaignPost('CreateOrUpdate', payload);
    return String(backend.id || campaign.backendId);
  } catch (error) {
    if (!(error instanceof Error) || !/HTTP (404|405)/.test(error.message)) throw error;
    const backend = await api.marketingCampaignPost('CreateOrUpdateCampaign', payload);
    return String(backend.id || campaign.backendId);
  }
}

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const scoped = await projectCampaignResponse(_req, params.id);
  if (scoped) return scoped;
  if (isRemoteOnlyCampaignId(params.id)) return remoteOnlyResponse();
  const local = getCampaign(params.id);
  if (!local) return NextResponse.json({ error: 'Kampanya bulunamadı.' }, { status: 404 });
  if (!local.backendId) return NextResponse.json(local);
  try {
    const api = agentModule<{
      marketingCampaignGet:   (name: string, query: Record<string, unknown>) => Promise<Record<string, unknown>>;
      marketingCampaignV2Get: (name: string, query: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }>('modules/api.js');
    const isV2 = local.backendVersion === 'v2' || local.deliveries.length > 1;
    const raw = isV2
      ? await api.marketingCampaignV2Get('Get', { id: local.backendId })
      : await api.marketingCampaignGet('Get', { id: local.backendId });
    const activeDispatchId = (() => {
      const v = raw.activeDispatchId ?? raw.ActiveDispatchId;
      if (v === undefined) return local.activeDispatchId;
      if (v === null || v === '') return null;
      const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null;
    })();
    const nextStatus = (() => {
      const s = String(raw.status || '').toLowerCase();
      if (s === 'draft') return 'ready';
      return ['scheduled', 'running', 'completed', 'cancelled', 'failed'].includes(s) ? s : undefined;
    })();
    const remoteChannels = Array.isArray(raw.channels) ? raw.channels as Array<Record<string, unknown>> : [];
    const deliveries = isV2 ? local.deliveries.map(delivery => {
      const channel = backendChannel(delivery.channel);
      const remote = remoteChannels.find(item => String(item.channel || '').toLowerCase() === channel.toLowerCase());
      if (!remote) return delivery;
      const remoteStatus = String(remote.status || delivery.status).toLowerCase();
      return {
        ...delivery,
        id: String(remote.id || delivery.id),
        status: ['pending', 'running', 'succeeded', 'failed', 'skipped'].includes(remoteStatus) ? remoteStatus as typeof delivery.status : delivery.status,
        externalId: remote.externalId == null ? delivery.externalId : String(remote.externalId),
        attempts: Number(remote.attempts ?? delivery.attempts),
        sentCount: Number(remote.sentCount ?? delivery.sentCount ?? 0),
        failedCount: Number(remote.failedCount ?? delivery.failedCount ?? 0),
        startedAt: remote.startedAt == null ? delivery.startedAt : String(remote.startedAt),
        completedAt: remote.completedAt == null ? delivery.completedAt : String(remote.completedAt),
        error: remote.lastError == null ? delivery.error : String(remote.lastError),
      };
    }) : local.deliveries;
    return NextResponse.json({
      ...local,
      ...(nextStatus ? { status: nextStatus } : {}),
      activeDispatchId,
      backendVersion: isV2 ? 'v2' : local.backendVersion,
      backendSync: 'synced' as const,
      timezone: raw.timezone == null ? local.timezone : String(raw.timezone),
      maxRecipients: raw.maxRecipients == null ? local.maxRecipients : Number(raw.maxRecipients),
      launchAt: raw.scheduledAt == null ? local.launchAt : String(raw.scheduledAt),
      launchedAt: raw.launchedAt == null ? local.launchedAt : String(raw.launchedAt),
      completedAt: raw.completedAt == null ? local.completedAt : String(raw.completedAt),
      content: {
        ...local.content,
        ctaUrl: raw.targetUrl == null ? local.content.ctaUrl : String(raw.targetUrl),
      },
      utm: {
        campaign: String(raw.utmCampaign || local.utm.campaign),
        source: raw.utmSource == null ? local.utm.source : String(raw.utmSource),
        medium: raw.utmMedium == null ? local.utm.medium : String(raw.utmMedium),
      },
      deliveries,
    });
  } catch {
    return NextResponse.json(local);
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const scoped = await projectCampaignResponse(req, params.id);
  if (scoped) return scoped;
  if (isRemoteOnlyCampaignId(params.id)) return remoteOnlyResponse();
  const current = getCampaign(params.id);
  if (!current) return NextResponse.json({ error: 'Kampanya bulunamadı.' }, { status: 404 });
  if (['running', 'completed'].includes(current.status)) {
    return NextResponse.json({ error: 'Çalışan veya tamamlanan kampanya düzenlenemez.' }, { status: 409 });
  }
  const body = await req.json() as Omit<Partial<UnifiedCampaign>, 'launchAt'> & { launchAt?: string | null };
  const allowed: Partial<UnifiedCampaign> = {};
  for (const key of ['name', 'objective', 'audience', 'channels', 'content', 'backendChannels', 'maxRecipients', 'budget', 'timezone', 'utm', 'status'] as const) {
    if (body[key] !== undefined) Object.assign(allowed, { [key]: body[key] });
  }
  // launchAt: null/'' → zamanlamayı kaldır; değer → ISO'ya normalize (createCampaign ile aynı)
  const launchAtProvided = body.launchAt !== undefined;
  if (launchAtProvided) {
    if (body.launchAt && Number.isNaN(new Date(body.launchAt).getTime())) return NextResponse.json({ error: 'Geçersiz yayın tarihi.' }, { status: 400 });
    allowed.launchAt = body.launchAt ? new Date(body.launchAt).toISOString() : undefined;
  }
  if (typeof allowed.name === 'string' && !allowed.name.trim()) return NextResponse.json({ error: 'Kampanya adı zorunludur.' }, { status: 400 });
  if (allowed.content && (!allowed.content.text || !allowed.content.text.trim())) return NextResponse.json({ error: 'Kampanya içeriği zorunludur.' }, { status: 400 });
  const candidate = { ...current, ...allowed, ...(body.maxRecipients === null ? { maxRecipients: undefined } : {}) } as UnifiedCampaign;
  const channelCount = (candidate.channels?.social?.length || 0) + (candidate.channels?.paidAds?.length || 0)
    + Number(Boolean(candidate.channels?.email)) + Number(Boolean(candidate.channels?.whatsapp)) + Number(Boolean(candidate.channels?.telegram));
  if (!channelCount) return NextResponse.json({ error: 'En az bir kanal seçilmelidir.' }, { status: 400 });
  if (['maritime_businesses', 'company_prospects'].includes(candidate.audience?.audienceType || '') && (!Array.isArray(candidate.audience.manualEmails) || candidate.audience.manualEmails.length === 0)) {
    return NextResponse.json({ error: candidate.audience.audienceType === 'company_prospects' ? 'Prospect kampanyası için en az bir lead e-postası gereklidir.' : 'Maritime business kampanyası için en az bir şirket e-postası gereklidir.' }, { status: 400 });
  }
  if (candidate.launchAt && Number.isNaN(new Date(candidate.launchAt).getTime())) return NextResponse.json({ error: 'Geçersiz yayın tarihi.' }, { status: 400 });
  if (body.maxRecipients === null) Object.assign(allowed, { maxRecipients: undefined });
  if (candidate.maxRecipients !== undefined && (!Number.isInteger(candidate.maxRecipients) || candidate.maxRecipients < 1 || candidate.maxRecipients > 500)) {
    return NextResponse.json({ error: 'Pilot alıcı limiti 1 ile 500 arasında bir tam sayı olmalıdır.' }, { status: 400 });
  }
  if (candidate.maxRecipients !== undefined && (candidate.channels?.email !== true || channelCount !== 1)) {
    return NextResponse.json({ error: 'Pilot gönderim yalnızca tek kanallı e-posta kampanyasında kullanılabilir.' }, { status: 400 });
  }
  if (allowed.status && !['draft', 'ready', 'scheduled', 'cancelled'].includes(allowed.status)) {
    return NextResponse.json({ error: 'Geçersiz durum geçişi.' }, { status: 400 });
  }
  // launchAt değiştiyse durum createCampaign kuralıyla yeniden hesaplanır (gelecek → scheduled, aksi → ready);
  // yalnızca draft/ready/scheduled kampanyalarda ve durum açıkça gönderilmediyse.
  if (launchAtProvided && allowed.status === undefined && ['draft', 'ready', 'scheduled'].includes(current.status)
    && (allowed.launchAt || null) !== (current.launchAt || null)) {
    allowed.status = statusForLaunchAt(allowed.launchAt);
  }
  let updated = await updateCampaign(params.id, allowed);
  if (!updated) return NextResponse.json({ error: 'Kampanya güncellenemedi.' }, { status: 500 });
  if (updated.backendId && updated.backendSync === 'synced') {
    const backendId = await withTimeout(syncBackendCampaign(updated), 9000);
    if (backendId) {
      updated = (await updateCampaign(params.id, { backendId, backendSync: 'synced' })) || updated;
    } else {
      updated = (await updateCampaign(params.id, { backendSync: 'pending' })) || updated;
    }
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const scoped = await projectCampaignResponse(_req, params.id);
  if (scoped) return scoped;
  if (isRemoteOnlyCampaignId(params.id)) return remoteOnlyResponse();
  const current = getCampaign(params.id);
  if (!current) return NextResponse.json({ error: 'Kampanya bulunamadı.' }, { status: 404 });
  if (current.status === 'running') return NextResponse.json({ error: 'Çalışan kampanya silinemez.' }, { status: 409 });
  if (current.backendId && current.backendSync === 'synced') {
    try {
      const api = agentModule<{
        marketingCampaignPost: (name: string, body: Record<string, unknown>) => Promise<unknown>;
        marketingCampaignDelete: (name: string, body: Record<string, unknown>) => Promise<unknown>;
        marketingCampaignV2Delete: (name: string, body: Record<string, unknown>) => Promise<unknown>;
      }>('modules/api.js');
      if (current.deliveries.length > 1) await api.marketingCampaignV2Delete('Delete', { id: current.backendId });
      else await api.marketingCampaignDelete('Delete', { id: current.backendId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backend kampanyası silinemedi.';
      if (!/HTTP\s+404/i.test(message)) return NextResponse.json({ error: 'Kampanya backend üzerinden silinemedi; yerel kayıt korundu.' }, { status: 502 });
    }
  }
  await deleteCampaign(params.id);
  return NextResponse.json({ ok: true });
}
