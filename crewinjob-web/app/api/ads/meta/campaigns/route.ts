/**
 * GET  /api/ads/meta/campaigns        — List Meta (FB+IG) campaigns
 * POST /api/ads/meta/campaigns        — Create a new campaign (+ ad set, PAUSED)
 *
 * Graph sürümü: META_GRAPH_VERSION (varsayılan v25.0). Token Authorization başlığında gönderilir.
 */
import { NextRequest, NextResponse } from 'next/server';
import type {
  AdCampaign, CampaignsResponse, CreateCampaignResponse, CampaignStatus,
} from '@/lib/ads-types';
import {
  badRequest, defaultCurrency, errorMessage, isConfigured, metaAccountCurrency, metaAccountId,
  metaFetch, metaMinorUnitFactor, notConfiguredResponse, readJsonBody, validateCreateRequest,
} from '../../_lib/platforms';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// Hedef → ad set optimizasyonu. Meta, optimization_goal'ün kampanya hedefiyle uyumlu olmasını şart koşar
// (eskiden hepsi REACH gönderiliyordu → awareness dışındaki hedeflerde ad set oluşturma başarısız).
// Not: canlı hesapla test edilemedi; Meta hata dönerse mesaj olduğu gibi kullanıcıya iletilir.
const OBJECTIVE_PLAN: Record<string, { optimization_goal: string; billing_event: string; destination_type?: string; needsPage?: boolean }> = {
  OUTCOME_AWARENESS:  { optimization_goal: 'REACH',           billing_event: 'IMPRESSIONS' },
  OUTCOME_TRAFFIC:    { optimization_goal: 'LINK_CLICKS',     billing_event: 'IMPRESSIONS', destination_type: 'WEBSITE' },
  OUTCOME_ENGAGEMENT: { optimization_goal: 'POST_ENGAGEMENT', billing_event: 'IMPRESSIONS', destination_type: 'ON_POST' },
  // Instant form lead'leri Facebook sayfası ister (promoted_object.page_id)
  OUTCOME_LEADS:      { optimization_goal: 'LEAD_GENERATION', billing_event: 'IMPRESSIONS', destination_type: 'ON_AD', needsPage: true },
};

// ── Normalize Meta campaign → AdCampaign ─────────────────────────────────────
function normalize(raw: Record<string, unknown>, currency: string): AdCampaign {
  const factor = metaMinorUnitFactor(currency);   // en küçük birim → ana birim
  const daily  = raw.daily_budget    ? Number(raw.daily_budget)    / factor : null;
  const total  = raw.lifetime_budget ? Number(raw.lifetime_budget) / factor : null;
  return {
    id:          String(raw.id),
    platform:    'meta',
    name:        String(raw.name || ''),
    status:      (String(raw.effective_status || raw.status || 'UNKNOWN').toUpperCase()) as CampaignStatus,
    objective:   String(raw.objective || ''),
    budgetDaily: daily,
    budgetTotal: total,
    currency,
    startDate:   raw.start_time ? String(raw.start_time).slice(0, 10) : null,
    endDate:     raw.stop_time  ? String(raw.stop_time).slice(0, 10)  : null,
    createdAt:   raw.created_time ? String(raw.created_time) : null,
  };
}

// ── GET — list campaigns ──────────────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  if (!isConfigured('meta')) {
    return NextResponse.json({
      platform: 'meta', campaigns: getMockCampaigns(), source: 'mock', mock: true, configured: false, currency: defaultCurrency(),
    } as CampaignsResponse);
  }

  try {
    const act      = metaAccountId();
    const currency = await metaAccountCurrency();
    const fields   = 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time';
    const json     = await metaFetch<{ data?: Record<string, unknown>[] }>(`${act}/campaigns?fields=${fields}&limit=50`);
    const campaigns = (json.data || []).map(raw => normalize(raw, currency));
    return NextResponse.json({ platform: 'meta', campaigns, source: 'api', configured: true, currency } as CampaignsResponse);
  } catch (err: unknown) {
    return NextResponse.json({ platform: 'meta', campaigns: [], source: 'api', configured: true, error: errorMessage(err) } as CampaignsResponse, { status: 502 });
  }
}

// ── POST — create campaign ────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isConfigured('meta')) return notConfiguredResponse('meta');

  const raw = await readJsonBody(req);
  if (!raw) return badRequest('Geçersiz JSON gövdesi.');
  const parsed = validateCreateRequest(raw);
  if (!parsed.ok) return badRequest(parsed.error);
  const body = parsed.value;
  const plan = OBJECTIVE_PLAN[body.objective];
  if (!plan) return badRequest(`Desteklenmeyen Meta hedefi: ${body.objective}. Desteklenenler: ${Object.keys(OBJECTIVE_PLAN).join(', ')}`);
  const countries = body.countries.filter(c => /^[A-Z]{2}$/.test(c));
  if (!countries.length) return badRequest('Meta için en az bir ISO ülke kodu gerekli.');
  const pageId = String(process.env.FACEBOOK_PAGE_ID || '').trim();
  if (plan.needsPage && !/^\d+$/.test(pageId)) {
    return badRequest('Lead Generation hedefi için FACEBOOK_PAGE_ID tanımlı olmalı (instant form sayfası).');
  }

  const act = metaAccountId();
  let campaignId = '';
  try {
    const currency = await metaAccountCurrency();

    // 1. Create campaign — iş ilanı reklamları EMPLOYMENT özel kategorisinde olmak zorunda
    const campJson = await metaFetch<{ id?: string }>(`${act}/campaigns`, {
      method: 'POST',
      body: new URLSearchParams({
        name:                        body.name,
        objective:                   body.objective,
        status:                      'PAUSED',   // always start paused — user activates manually
        special_ad_categories:       JSON.stringify(['EMPLOYMENT']),
        special_ad_category_country: JSON.stringify(countries),
        // Kampanya bütçesi (CBO) kullanılmıyor; bütçe ad set'te → paylaşım kapalı
        is_adset_budget_sharing_enabled: 'false',
      }),
    });
    if (!campJson.id) throw new Error('Meta kampanya ID döndürmedi.');
    campaignId = campJson.id;

    // 2. Create ad set with budget
    // EMPLOYMENT kategorisi yaş/cinsiyet daraltmaya izin vermez → 18-65 sabit (istekteki ageMin/ageMax yok sayılır)
    const adsetBody = new URLSearchParams({
      name:              `${body.name} — Ad Set`,
      campaign_id:       campaignId,
      daily_budget:      String(Math.round(body.budgetDaily * metaMinorUnitFactor(currency))),
      billing_event:     plan.billing_event,
      optimization_goal: plan.optimization_goal,
      bid_strategy:      'LOWEST_COST_WITHOUT_CAP',
      start_time:        new Date(body.startDate).toISOString(),
      ...(body.endDate ? { end_time: new Date(`${body.endDate}T23:59:59Z`).toISOString() } : {}),
      targeting:         JSON.stringify({ geo_locations: { countries }, age_min: 18, age_max: 65 }),
      status:            'PAUSED',
      ...(plan.destination_type ? { destination_type: plan.destination_type } : {}),
      ...(/^\d+$/.test(pageId) && (plan.needsPage || plan.destination_type === 'ON_POST')
        ? { promoted_object: JSON.stringify({ page_id: pageId }) } : {}),
    });
    try {
      await metaFetch(`${act}/adsets`, { method: 'POST', body: adsetBody });
    } catch (adsetErr) {
      // Ad set oluşmadıysa yetim kampanyayı geri al
      let cleanup = '';
      try { await metaFetch(campaignId, { method: 'DELETE' }); }
      catch (cleanupErr) { cleanup = ` (yetim kampanya ${campaignId} silinemedi: ${errorMessage(cleanupErr)} — Ads Manager'dan silin)`; }
      throw new Error(`Ad set oluşturulamadı: ${errorMessage(adsetErr)}${cleanup}`);
    }

    return NextResponse.json({ platform: 'meta', campaignId, success: true, configured: true, status: 'PAUSED' } as CreateCampaignResponse);
  } catch (err: unknown) {
    return NextResponse.json({ platform: 'meta', campaignId: '', success: false, configured: true, error: errorMessage(err) } as CreateCampaignResponse, { status: 502 });
  }
}

// ── Mock data (when not configured) ──────────────────────────────────────────
function getMockCampaigns(): AdCampaign[] {
  const currency = defaultCurrency();
  return [
    {
      id: 'mock_meta_1', platform: 'meta', name: 'Seafarer Registration — TR',
      status: 'ACTIVE', objective: 'OUTCOME_LEADS',
      budgetDaily: 15, budgetTotal: null, currency,
      startDate: '2026-05-01', endDate: null, createdAt: '2026-05-01T10:00:00Z',
      insights: { impressions: 42500, clicks: 1820, spend: 312.5, ctr: 4.28, cpc: 0.17, conversions: 148, cpm: 7.35 },
    },
    {
      id: 'mock_meta_2', platform: 'meta', name: 'Shipowner B2B — Global',
      status: 'PAUSED', objective: 'OUTCOME_TRAFFIC',
      budgetDaily: 25, budgetTotal: null, currency,
      startDate: '2026-04-15', endDate: null, createdAt: '2026-04-15T08:00:00Z',
      insights: { impressions: 18200, clicks: 540, spend: 198.0, ctr: 2.97, cpc: 0.37, conversions: 32, cpm: 10.88 },
    },
  ];
}
