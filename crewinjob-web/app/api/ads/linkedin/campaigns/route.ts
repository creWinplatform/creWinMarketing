/**
 * GET  /api/ads/linkedin/campaigns    — List LinkedIn Sponsored campaigns
 * POST /api/ads/linkedin/campaigns    — Create a new campaign (DRAFT)
 *
 * Versiyonlu REST API: /rest/adAccounts/{accountId}/adCampaigns
 * Başlıklar: Linkedin-Version (LINKEDIN_API_VERSION, varsayılan 202608) + X-Restli-Protocol-Version 2.0.0
 * (eski /v2/adCampaignsV2 kullanımdan kaldırıldı).
 *
 * ⚠️ Canlı hesapla test edilemedi — muhafazakâr tasarım:
 *   - Kampanya DRAFT oluşturulur: yayına girmez; teklif/kreatif LinkedIn Campaign Manager'da tamamlanıp aktifleştirilir.
 *   - LinkedIn hata dönerse mesaj olduğu gibi kullanıcıya iletilir.
 */
import { NextRequest, NextResponse } from 'next/server';
import type {
  AdCampaign, CampaignsResponse, CreateCampaignResponse, CampaignStatus,
} from '@/lib/ads-types';
import {
  badRequest, defaultCurrency, errorMessage, isConfigured, linkedinAccountCurrency, linkedinAccountId,
  linkedinCreatedId, linkedinFetch, notConfiguredResponse, readJsonBody, validateCreateRequest,
} from '../../_lib/platforms';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// Hedef → maliyet tipi (+ eminsek otomatik teklif hedefi). Eski çoğul değerler (WEBSITE_VISITS…) tekile eşlenir.
const OBJECTIVE_PLAN: Record<string, { objectiveType: string; costType: 'CPM' | 'CPC' | 'CPV'; optimizationTargetType?: string }> = {
  BRAND_AWARENESS:    { objectiveType: 'BRAND_AWARENESS',    costType: 'CPM', optimizationTargetType: 'MAX_IMPRESSION' },
  WEBSITE_VISIT:      { objectiveType: 'WEBSITE_VISIT',      costType: 'CPC' },
  ENGAGEMENT:         { objectiveType: 'ENGAGEMENT',         costType: 'CPM' },
  LEAD_GENERATION:    { objectiveType: 'LEAD_GENERATION',    costType: 'CPM' },
  VIDEO_VIEW:         { objectiveType: 'VIDEO_VIEW',         costType: 'CPV', optimizationTargetType: 'MAX_VIDEO_VIEW' },
  WEBSITE_CONVERSION: { objectiveType: 'WEBSITE_CONVERSION', costType: 'CPM', optimizationTargetType: 'MAX_CONVERSION' },
};
const LEGACY_OBJECTIVES: Record<string, string> = {
  WEBSITE_VISITS: 'WEBSITE_VISIT', VIDEO_VIEWS: 'VIDEO_VIEW', WEBSITE_CONVERSIONS: 'WEBSITE_CONVERSION',
};

// ISO ülke kodu → LinkedIn geo URN ID (urn:li:geo:<id>). Versiyonlu API'de urn:li:country:xx değil geo URN'leri kullanılır.
// Liste kısıtlı tutuldu; listede olmayan ülke için istekte doğrudan "urn:li:geo:<id>" gönderilebilir
// (ID'ler LinkedIn adTargetingEntities typeahead ile doğrulanabilir).
const LINKEDIN_COUNTRY_GEO: Record<string, string> = {
  US: '103644278', GB: '101165590', TR: '102105699', IN: '102713980', PH: '103121230', ID: '102478259',
  UA: '102264497', GR: '104677530', NL: '102890719', SG: '102454443', DE: '101282230', FR: '105015875',
  NO: '103819153', CA: '101174742', AU: '101452733', IT: '103350119', ES: '105646813', PL: '105072130',
  AE: '104305776', RO: '106670623', CN: '102890883', JP: '101355337', BR: '106057199',
};

// ── Normalize LinkedIn campaign → AdCampaign ─────────────────────────────────
function normalize(raw: Record<string, unknown>, fallbackCurrency: string): AdCampaign {
  const budget   = raw.dailyBudget as { amount?: string; currencyCode?: string } | undefined;
  const total    = raw.totalBudget as { amount?: string; currencyCode?: string } | undefined;
  const status   = String(raw.status || 'UNKNOWN').toUpperCase() as CampaignStatus;
  const schedule = raw.runSchedule as { start?: number; end?: number } | undefined;
  const created  = (raw.changeAuditStamps as { created?: { time?: number } } | undefined)?.created?.time;

  return {
    id:          String(raw.id ?? '').split(':').pop() || '',
    platform:    'linkedin',
    name:        String(raw.name || ''),
    status,
    objective:   String((raw.objectiveType as string) || ''),
    budgetDaily: budget?.amount ? parseFloat(budget.amount) : null,
    budgetTotal: total?.amount  ? parseFloat(total.amount)  : null,
    currency:    budget?.currencyCode || total?.currencyCode || fallbackCurrency,
    startDate:   schedule?.start ? new Date(schedule.start).toISOString().slice(0, 10) : null,
    endDate:     schedule?.end   ? new Date(schedule.end).toISOString().slice(0, 10)   : null,
    createdAt:   created ? new Date(created).toISOString() : null,
    insights:    undefined,
  };
}

// ── Kampanya grubu: her kampanya bir gruba bağlı olmak zorunda ────────────────
// Öncelik: LINKEDIN_ADS_CAMPAIGN_GROUP_ID → hesaptaki "CrewinJob Panel" grubu → yoksa oluştur.
const GROUP_NAME = 'CrewinJob Panel';
const gl = globalThis as typeof globalThis & { __crewinLinkedinGroup?: Map<string, string> };
const groupCache: Map<string, string> = gl.__crewinLinkedinGroup ?? (gl.__crewinLinkedinGroup = new Map());

async function campaignGroupUrn(accountId: string): Promise<string> {
  const envId = String(process.env.LINKEDIN_ADS_CAMPAIGN_GROUP_ID || '').trim().replace(/^urn:li:sponsoredCampaignGroup:/, '');
  if (envId) {
    if (!/^\d+$/.test(envId)) throw new Error('LINKEDIN_ADS_CAMPAIGN_GROUP_ID sayısal olmalı.');
    return `urn:li:sponsoredCampaignGroup:${envId}`;
  }
  const cached = groupCache.get(accountId);
  if (cached) return cached;

  // Rest.li 2.0 sorgusu ham yazılır (parantez/virgül encode edilmez)
  const found = await linkedinFetch<{ elements?: Array<{ id?: number | string; name?: string }> }>(
    `/adAccounts/${accountId}/adCampaignGroups?q=search&search=(status:(values:List(ACTIVE,DRAFT)))`,
  );
  const existing = (found.json.elements || []).find(group => group.name === GROUP_NAME);
  let groupId = existing ? String(existing.id ?? '').split(':').pop() || '' : '';

  if (!groupId) {
    const created = await linkedinFetch(`/adAccounts/${accountId}/adCampaignGroups`, {
      method: 'POST',
      body: JSON.stringify({
        account:     `urn:li:sponsoredAccount:${accountId}`,
        name:        GROUP_NAME,
        status:      'ACTIVE',
        runSchedule: { start: Date.now() + 5 * 60 * 1000 },   // grup için zorunlu; geçmiş olmasın
      }),
    });
    groupId = linkedinCreatedId(created);
  }
  if (!/^\d+$/.test(groupId)) throw new Error('LinkedIn kampanya grubu bulunamadı/oluşturulamadı.');
  const urn = `urn:li:sponsoredCampaignGroup:${groupId}`;
  groupCache.set(accountId, urn);
  return urn;
}

// ── GET — list campaigns ──────────────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  if (!isConfigured('linkedin')) {
    return NextResponse.json({
      platform: 'linkedin', campaigns: getMockCampaigns(), source: 'mock', mock: true, configured: false, currency: defaultCurrency(),
    } as CampaignsResponse);
  }

  try {
    const act      = linkedinAccountId();
    const currency = await linkedinAccountCurrency();
    const { json } = await linkedinFetch<{ elements?: Record<string, unknown>[] }>(
      `/adAccounts/${act}/adCampaigns?q=search&search=(status:(values:List(ACTIVE,PAUSED,DRAFT,COMPLETED)))`,
    );
    const campaigns = (json.elements || []).map(raw => normalize(raw, currency));
    return NextResponse.json({ platform: 'linkedin', campaigns, source: 'api', configured: true, currency } as CampaignsResponse);
  } catch (err: unknown) {
    return NextResponse.json({ platform: 'linkedin', campaigns: [], source: 'api', configured: true, error: errorMessage(err) } as CampaignsResponse, { status: 502 });
  }
}

// ── POST — create campaign ────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isConfigured('linkedin')) return notConfiguredResponse('linkedin');

  const raw = await readJsonBody(req);
  if (!raw) return badRequest('Geçersiz JSON gövdesi.');
  const parsed = validateCreateRequest(raw);
  if (!parsed.ok) return badRequest(parsed.error);
  const body = parsed.value;
  const plan = OBJECTIVE_PLAN[LEGACY_OBJECTIVES[body.objective] || body.objective];
  if (!plan) return badRequest(`Desteklenmeyen LinkedIn hedefi: ${body.objective}. Desteklenenler: ${Object.keys(OBJECTIVE_PLAN).join(', ')}`);

  const geoUrns: string[] = [];
  const unknown: string[] = [];
  for (const item of body.countries) {
    if (item.startsWith('urn:li:geo:')) geoUrns.push(item);
    else if (LINKEDIN_COUNTRY_GEO[item]) geoUrns.push(`urn:li:geo:${LINKEDIN_COUNTRY_GEO[item]}`);
    else unknown.push(item);
  }
  if (unknown.length) {
    return badRequest(`LinkedIn konum ID'si bilinmeyen ülke(ler): ${unknown.join(', ')}. Desteklenenler: ${Object.keys(LINKEDIN_COUNTRY_GEO).join(', ')} — ya da "urn:li:geo:<id>" gönderin.`);
  }

  try {
    const act      = linkedinAccountId();
    const currency = await linkedinAccountCurrency();   // bütçe para birimi hesapla aynı olmak zorunda
    const group    = await campaignGroupUrn(act);
    // Başlangıç geçmişte olamaz → en erken 10 dk sonrası (grup başlangıcından sonra)
    const start = Math.max(Date.parse(`${body.startDate}T00:00:00Z`), Date.now() + 10 * 60 * 1000);

    const payload = {
      account:       `urn:li:sponsoredAccount:${act}`,
      campaignGroup: group,
      name:          body.name,
      status:        'DRAFT',
      type:          'SPONSORED_UPDATES',
      costType:      plan.costType,
      objectiveType: plan.objectiveType,
      ...(plan.optimizationTargetType ? { optimizationTargetType: plan.optimizationTargetType } : {}),
      dailyBudget: {
        amount:       body.budgetDaily.toFixed(2),
        currencyCode: currency,
      },
      runSchedule: {
        start,
        ...(body.endDate ? { end: Date.parse(`${body.endDate}T23:59:59Z`) } : {}),
      },
      // Yeni hedefleme biçimi: include.and[].or{facet: [urn…]}
      targetingCriteria: {
        include: {
          and: [
            { or: { 'urn:li:adTargetingFacet:locations': geoUrns } },
          ],
        },
      },
      locale:                   { country: 'US', language: 'en' },
      offsiteDeliveryEnabled:   false,
      audienceExpansionEnabled: false,
    };

    const created    = await linkedinFetch(`/adAccounts/${act}/adCampaigns`, { method: 'POST', body: JSON.stringify(payload) });
    const campaignId = linkedinCreatedId(created);
    return NextResponse.json({ platform: 'linkedin', campaignId, success: true, configured: true, status: 'DRAFT' } as CreateCampaignResponse);
  } catch (err: unknown) {
    return NextResponse.json({ platform: 'linkedin', campaignId: '', success: false, configured: true, error: errorMessage(err) } as CreateCampaignResponse, { status: 502 });
  }
}

// ── Mock data ─────────────────────────────────────────────────────────────────
function getMockCampaigns(): AdCampaign[] {
  const currency = defaultCurrency();
  return [
    {
      id: 'mock_li_1', platform: 'linkedin', name: 'Manning Agency Outreach Q2',
      status: 'ACTIVE', objective: 'LEAD_GENERATION',
      budgetDaily: 20, budgetTotal: 400, currency,
      startDate: '2026-04-01', endDate: '2026-06-30', createdAt: '2026-04-01T09:00:00Z',
      insights: { impressions: 9800, clicks: 195, spend: 287.4, ctr: 1.99, cpc: 1.47, conversions: 22, cpm: 29.3 },
    },
    {
      id: 'mock_li_2', platform: 'linkedin', name: 'CrewinJob Brand Awareness',
      status: 'PAUSED', objective: 'BRAND_AWARENESS',
      budgetDaily: 10, budgetTotal: null, currency,
      startDate: '2026-03-01', endDate: null, createdAt: '2026-03-01T11:00:00Z',
      insights: { impressions: 21400, clicks: 310, spend: 154.0, ctr: 1.45, cpc: 0.50, conversions: 0, cpm: 7.2 },
    },
  ];
}
