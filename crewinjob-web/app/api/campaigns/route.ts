import { NextRequest, NextResponse } from 'next/server';
import { audienceSegmentFilters, createCampaign, loadCampaigns, updateCampaign, type CreateCampaignInput } from '@/lib/campaigns';
import { agentModule } from '@/lib/agent-bridge';
import { projectCampaignResponse } from '@/lib/platform/marketing-routes';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

function localStatus(value: unknown) {
  const status = String(value || '').toLowerCase();
  if (status === 'draft') return 'ready';
  return ['scheduled', 'running', 'completed', 'cancelled', 'failed'].includes(status) ? status : undefined;
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

function parseActiveDispatchId(raw: unknown): number | null | undefined {
  const v = raw !== undefined ? raw : undefined;
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function frontendChannel(value: string): string {
  if (value === 'metaAds') return 'ads:meta';
  if (value === 'linkedinAds') return 'ads:linkedin';
  if (value === 'googleAds') return 'ads:google';
  return ['email', 'whatsapp', 'telegram'].includes(value) ? value : `social:${value}`;
}

function remoteV2Campaign(r: Record<string, unknown>, local?: import('@/lib/campaigns').UnifiedCampaign): import('@/lib/campaigns').UnifiedCampaign {
  const bid = String(r.id);
  const filters = recordValue(r.filters);
  const remoteChannels = Array.isArray(r.channels) ? r.channels as Array<Record<string, unknown>> : [];
  const channelNames = remoteChannels.map(channel => String(channel.channel || '').trim()).filter(Boolean);
  const now = new Date().toISOString();
  const id = local?.id || String(r.campaignIntegrationId || `cmp_remote_${bid}`);
  const objectiveMap: Record<string, import('@/lib/campaigns').CampaignObjective> = {
    application: 'job_application',
    activation: 'reactivation',
    acquisition: 'company_acquisition',
  };
  const rawObjective = String(r.objective || 'awareness');
  const objective = objectiveMap[rawObjective] || rawObjective as import('@/lib/campaigns').CampaignObjective;
  const firstChannel = remoteChannels[0] || {};
  const deliveries = remoteChannels.map((channel, index) => {
    const rawStatus = String(channel.status || 'pending').toLowerCase();
    const status = ['pending', 'running', 'succeeded', 'failed', 'skipped'].includes(rawStatus)
      ? rawStatus as import('@/lib/campaigns').DeliveryStatus
      : 'pending';
    return {
      id: String(channel.id || `${id}_d${index + 1}`),
      channel: frontendChannel(String(channel.channel || '')),
      status,
      attempts: Number(channel.attempts || 0),
      externalId: channel.externalId == null ? undefined : String(channel.externalId),
      sentCount: Number(channel.sentCount || 0),
      failedCount: Number(channel.failedCount || 0),
      startedAt: channel.startedAt == null ? undefined : String(channel.startedAt),
      completedAt: channel.completedAt == null ? undefined : String(channel.completedAt),
      error: channel.lastError == null ? undefined : String(channel.lastError),
    };
  });
  return {
    ...(local || {} as import('@/lib/campaigns').UnifiedCampaign),
    id,
    backendId: bid,
    backendVersion: 'v2',
    backendSync: 'synced',
    // Yerel kaydı olmayan backend kampanyası: listede görünür ama panelden yönetilemez (UI rozet + kapalı aksiyonlar)
    remoteOnly: !local,
    activeDispatchId: parseActiveDispatchId(r.activeDispatchId ?? r.ActiveDispatchId),
    name: String(r.name || local?.name || `Campaign ${bid}`),
    objective,
    status: (localStatus(r.status) || local?.status || 'ready') as import('@/lib/campaigns').CampaignStatus,
    audience: {
      ...(local?.audience || { fillBuckets: [] }),
      fillBuckets: stringList(filters.profileBuckets) as import('@/lib/campaigns').FillBucket[],
      audienceType: String(filters.audienceType || local?.audience.audienceType || 'seafarers') as import('@/lib/campaigns').CampaignAudienceType,
      prospectSource: String(filters.prospectSource || local?.audience.prospectSource || 'manual') as import('@/lib/campaigns').ProspectSource,
      prospectCompanyTypes: stringList(filters.companyTypes),
      countries: stringList(filters.countries),
      nationalities: stringList(filters.nationalities),
      positions: stringList(filters.positions),
    },
    channels: {
      social: channelNames.filter(channel => !['email', 'whatsapp', 'telegram', 'metaAds', 'linkedinAds', 'googleAds'].includes(channel)),
      email: channelNames.includes('email'),
      whatsapp: channelNames.includes('whatsapp'),
      telegram: channelNames.includes('telegram'),
      paidAds: channelNames.map(frontendChannel).filter(channel => channel.startsWith('ads:')).map(channel => channel.slice(4)) as import('@/lib/ads-types').AdPlatform[],
    },
    content: {
      ...(local?.content || { text: '' }),
      text: String(firstChannel.content || local?.content.text || ''),
      subject: firstChannel.subject == null ? local?.content.subject : String(firstChannel.subject),
      ctaUrl: String(r.targetUrl || firstChannel.targetUrl || local?.content.ctaUrl || '') || undefined,
    },
    backendChannels: Object.fromEntries(remoteChannels.map(channel => [String(channel.channel), {
      integrationId: channel.integrationId == null ? undefined : String(channel.integrationId),
      templateId: channel.templateId == null ? undefined : String(channel.templateId),
    }])),
    maxRecipients: r.maxRecipients == null ? local?.maxRecipients : Number(r.maxRecipients),
    budget: local?.budget || { currency: 'USD', dailyByPlatform: {} },
    launchAt: r.scheduledAt == null ? local?.launchAt : String(r.scheduledAt),
    timezone: String(r.timezone || local?.timezone || 'Europe/Istanbul'),
    utm: {
      campaign: String(r.utmCampaign || local?.utm.campaign || `campaign-${bid}`),
      source: r.utmSource == null ? local?.utm.source : String(r.utmSource),
      medium: r.utmMedium == null ? local?.utm.medium : String(r.utmMedium),
    },
    deliveries,
    createdAt: String(r.creationTime || local?.createdAt || now),
    updatedAt: String(r.lastModificationTime || local?.updatedAt || now),
    launchedAt: r.launchedAt == null ? local?.launchedAt : String(r.launchedAt),
    completedAt: r.completedAt == null ? local?.completedAt : String(r.completedAt),
  };
}

// Backend yavaş/erişilemezse UI'ı bekletmemek için sync'i sınırlar.
// ms içinde dönmezse null döner; kampanya 'pending' işaretlenip sonraki
// load()'ta campaignIntegrationId eşleştirmesiyle reconcile edilir.
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

export async function GET(req: NextRequest) {
  const scoped = await projectCampaignResponse(req);
  if (scoped) return scoped;
  const status = req.nextUrl.searchParams.get('status');
  const search = (req.nextUrl.searchParams.get('search') || '').toLocaleLowerCase('tr-TR');

  // Yerel JSON base64 görsel gibi backend DTO'sunda tutulmayan alanlar için enrichment/fallback kaynağıdır.
  const localItems = loadCampaigns();
  const byBackendId  = new Map(localItems.filter(i => i.backendId).map(i => [i.backendId!, i]));
  const byLocalId    = new Map(localItems.map(i => [i.id, i]));

  let items = localItems; // backend erişilemezse fallback

  try {
    const api = agentModule<{
      marketingCampaignV2Get: (name: string, query: Record<string, unknown>) => Promise<Record<string, unknown>>;
      marketingCampaignGet:   (name: string, query: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }>('modules/api.js');

    const [v2Result, v1Result] = await Promise.all([
      withTimeout(api.marketingCampaignV2Get('GetAll', { keyword: search || undefined, status: status || undefined, skipCount: 0, maxResultCount: 100 }), 7000),
      withTimeout(api.marketingCampaignGet('GetAll', { skipCount: 0, maxResultCount: 100 }), 7000),
    ]);

    const remoteV2 = v2Result && Array.isArray(v2Result.items) ? v2Result.items as Array<Record<string, unknown>> : [];
    const remoteV1 = v1Result && Array.isArray(v1Result.items) ? v1Result.items as Array<Record<string, unknown>> : [];

    const merged = new Map<string, import('@/lib/campaigns').UnifiedCampaign>();

    // V2 kampanyaları — çok kanallı; yerel ile backendId VEYA campaignIntegrationId üzerinden eşleştir
    // (backendId henüz yazılamamış 'pending' yerel kayıtlar remote-only sanılmasın)
    for (const r of remoteV2) {
      const bid = String(r.id);
      const local = byBackendId.get(bid)
        || (r.campaignIntegrationId ? byLocalId.get(String(r.campaignIntegrationId)) : undefined);
      const campaign = remoteV2Campaign(r, local);
      merged.set(campaign.id, campaign);
    }

    // V1 kampanyaları — tek kanallı; backendId VEYA campaignIntegrationId ile eşleştir
    for (const r of remoteV1) {
      const bid = String(r.id);
      const local = byBackendId.get(bid)
        || (r.campaignIntegrationId ? byLocalId.get(String(r.campaignIntegrationId)) : undefined);
      if (!local) continue;
      if (merged.has(local.id)) continue; // V2'de zaten işlendi
      const activeDispatchId = parseActiveDispatchId(r.activeDispatchId ?? r.ActiveDispatchId);
      const nextStatus = localStatus(r.status);
      merged.set(local.id, {
        ...local,
        backendId: bid,
        backendSync: 'synced' as const,
        ...(nextStatus ? { status: nextStatus as typeof local.status } : {}),
        activeDispatchId: activeDispatchId !== undefined ? activeDispatchId : local.activeDispatchId,
      });
    }

    // Henüz backend'e senkronize edilmemiş yerel kampanyalar
    for (const local of localItems) {
      if (!merged.has(local.id)) merged.set(local.id, local);
    }

    items = Array.from(merged.values());
  } catch {
    // Backend erişilemezse yerel kampanyalar kullanılmaya devam eder.
  }

  items = items.filter(item =>
    (!status || item.status === status) && (!search || item.name.toLocaleLowerCase('tr-TR').includes(search))
  );
  return NextResponse.json({ items, totalCount: items.length });
}

export async function POST(req: NextRequest) {
  const scoped = await projectCampaignResponse(req);
  if (scoped) return scoped;
  try {
    const body = await req.json() as CreateCampaignInput;
    if (!body.name?.trim()) return NextResponse.json({ error: 'Kampanya adı zorunludur.' }, { status: 400 });
    if (!body.content?.text?.trim()) return NextResponse.json({ error: 'Kampanya içeriği zorunludur.' }, { status: 400 });
    const channelCount = (body.channels?.social?.length || 0) + (body.channels?.paidAds?.length || 0)
      + Number(Boolean(body.channels?.email)) + Number(Boolean(body.channels?.whatsapp)) + Number(Boolean(body.channels?.telegram));
    if (!channelCount) return NextResponse.json({ error: 'En az bir kanal seçilmelidir.' }, { status: 400 });
    if (['maritime_businesses', 'company_prospects'].includes(body.audience?.audienceType || '') && (!Array.isArray(body.audience.manualEmails) || body.audience.manualEmails.length === 0)) {
      return NextResponse.json({ error: body.audience?.audienceType === 'company_prospects' ? 'Prospect kampanyası için en az bir lead e-postası gereklidir.' : 'Maritime business kampanyası için en az bir şirket e-postası gereklidir.' }, { status: 400 });
    }
    if (body.launchAt && Number.isNaN(new Date(body.launchAt).getTime())) {
      return NextResponse.json({ error: 'Geçersiz yayın tarihi.' }, { status: 400 });
    }
    if (body.maxRecipients !== undefined && (!Number.isInteger(body.maxRecipients) || body.maxRecipients < 1 || body.maxRecipients > 500)) {
      return NextResponse.json({ error: 'Pilot alıcı limiti 1 ile 500 arasında bir tam sayı olmalıdır.' }, { status: 400 });
    }
    if (body.maxRecipients !== undefined && (body.channels?.email !== true || channelCount !== 1)) {
      return NextResponse.json({ error: 'Pilot gönderim yalnızca tek kanallı e-posta kampanyasında kullanılabilir.' }, { status: 400 });
    }
    let campaign = await createCampaign(body);
    if (campaign.deliveries.length > 1) {
      const api = agentModule<{ marketingCampaignV2Post: (name: string, body: Record<string, unknown>) => Promise<Record<string, unknown>> }>('modules/api.js');
      const backend = await withTimeout(api.marketingCampaignV2Post('CreateOrUpdate', {
          id: null,
          name: campaign.name,
          objective: backendObjective(campaign.objective),
          audienceId: null,
          filters: {
            audienceType: campaign.audience.audienceType || 'seafarers',
            ...(campaign.audience.audienceType === 'company_prospects' ? {
              prospectSource: campaign.audience.prospectSource || 'manual',
              companyTypes: campaign.audience.prospectCompanyTypes || [],
            } : {}),
            profileBuckets: campaign.audience.fillBuckets,
            // Önizleme ve gönderimle aynı filtreler (uyruk, aktif/pasif)
            ...audienceSegmentFilters(campaign.audience),
          },
          scheduledAt: campaign.launchAt || null,
          timezone: campaign.timezone,
          campaignIntegrationId: campaign.id,
          targetUrl: campaign.content.ctaUrl || null,
          maxRecipients: campaign.maxRecipients || 0,
          utmCampaign: campaign.utm.campaign,
          utmSource: campaign.utm.source || null,
          utmMedium: campaign.utm.medium || null,
          status: campaign.status === 'ready' ? 'draft' : campaign.status === 'partial' ? 'failed' : campaign.status,
          channels: campaign.deliveries.map(delivery => {
            const channel = backendChannel(delivery.channel);
            const config = campaign.backendChannels?.[channel] || {};
            return {
              channel,
              integrationId: config.integrationId || null,
              templateId: config.templateId || null,
              subject: channel === 'email' ? campaign.content.subject || null : null,
              content: campaign.content.text,
              targetUrl: campaign.content.ctaUrl || null,
              enabled: true,
            };
          }),
      }), 9000);
      campaign = backend && backend.id
        ? await updateCampaign(campaign.id, { backendId: String(backend.id), backendVersion: 'v2', backendSync: 'synced' }) || campaign
        : await updateCampaign(campaign.id, { backendSync: 'pending' }) || campaign;
    } else if (campaign.deliveries.length === 1) {
      const api = agentModule<{ marketingCampaignPost: (name: string, body: Record<string, unknown>) => Promise<Record<string, unknown>> }>('modules/api.js');
      const channel = campaign.deliveries[0].channel.replace(/^(social|ads):/, '');
      const backendChannel = campaign.backendChannels?.[channel] || {};
      const payload = {
        id: null,
        name: campaign.name,
        channel,
        integrationId: backendChannel.integrationId || null,
        templateId: backendChannel.templateId || campaign.content.templateId || null,
        audienceId: null,
        audienceSnapshot: {
          audienceType: campaign.audience.audienceType || 'seafarers',
          ...(campaign.audience.audienceType === 'company_prospects' ? {
            prospectSource: campaign.audience.prospectSource || 'manual',
            companyTypes: campaign.audience.prospectCompanyTypes || [],
          } : {}),
          profileBuckets: campaign.audience.fillBuckets,
          // Önizlemeyle aynı filtreler — önceden uyruk ve "aktif" filtresi snapshot'ta düşüyordu
          ...audienceSegmentFilters(campaign.audience),
        },
        campaignIntegrationId: campaign.id,
        status: campaign.status,
        scheduledAt: campaign.launchAt || null,
      };
      const backend = await withTimeout((async () => {
        try {
          return await api.marketingCampaignPost('CreateOrUpdate', payload);
        } catch (error) {
          // Eski backend sürümlerindeki ad korunur; yeni sözleşme önceliklidir.
          if (!(error instanceof Error) || !/HTTP (404|405)/.test(error.message)) throw error;
          return await api.marketingCampaignPost('CreateOrUpdateCampaign', payload);
        }
      })(), 9000);
      campaign = backend && backend.id
        ? await updateCampaign(campaign.id, { backendId: String(backend.id), backendSync: 'synced' }) || campaign
        : await updateCampaign(campaign.id, { backendSync: 'pending' }) || campaign;
    }
    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Kampanya oluşturulamadı.' }, { status: 500 });
  }
}
