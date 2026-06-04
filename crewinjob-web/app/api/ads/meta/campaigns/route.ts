/**
 * GET  /api/ads/meta/campaigns        — List Meta (FB+IG) campaigns
 * POST /api/ads/meta/campaigns        — Create a new campaign
 */
import { NextRequest, NextResponse } from 'next/server';
import type {
  AdCampaign, CampaignsResponse, CreateCampaignRequest, CreateCampaignResponse, CampaignStatus,
} from '@/lib/ads-types';

const GRAPH = 'https://graph.facebook.com/v19.0';

function token()     { return process.env.META_ADS_ACCESS_TOKEN || ''; }
function accountId() { return process.env.META_ADS_ACCOUNT_ID   || ''; }   // "act_123456789"

// ── Normalize Meta campaign → AdCampaign ─────────────────────────────────────
function normalize(raw: Record<string, unknown>): AdCampaign {
  const daily  = raw.daily_budget  ? Number(raw.daily_budget)  / 100 : null;  // cents → USD
  const total  = raw.lifetime_budget ? Number(raw.lifetime_budget) / 100 : null;
  return {
    id:          String(raw.id),
    platform:    'meta',
    name:        String(raw.name || ''),
    status:      (String(raw.effective_status || raw.status || 'UNKNOWN').toUpperCase()) as CampaignStatus,
    objective:   String(raw.objective || ''),
    budgetDaily: daily,
    budgetTotal: total,
    currency:    String(raw.account_currency || 'USD'),
    startDate:   raw.start_time ? String(raw.start_time).slice(0, 10) : null,
    endDate:     raw.stop_time  ? String(raw.stop_time).slice(0, 10)  : null,
    createdAt:   raw.created_time ? String(raw.created_time) : null,
  };
}

// ── GET — list campaigns ──────────────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  const tok = token();
  const act = accountId();

  if (!tok || !act) {
    const mock = getMockCampaigns();
    return NextResponse.json({ platform: 'meta', campaigns: mock, source: 'mock' } as CampaignsResponse);
  }

  try {
    const fields = 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time';
    const url    = `${GRAPH}/${act}/campaigns?fields=${fields}&limit=50&access_token=${tok}`;
    const res    = await fetch(url, { next: { revalidate: 60 } });
    const json   = await res.json() as { data?: Record<string, unknown>[]; error?: { message: string } };

    if (json.error) throw new Error(json.error.message);

    const campaigns = (json.data || []).map(normalize);
    return NextResponse.json({ platform: 'meta', campaigns, source: 'api' } as CampaignsResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ platform: 'meta', campaigns: [], source: 'api', error: msg } as CampaignsResponse, { status: 500 });
  }
}

// ── POST — create campaign ────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const tok = token();
  const act = accountId();

  if (!tok || !act) {
    return NextResponse.json({ platform: 'meta', campaignId: 'mock_' + Date.now(), success: true } as CreateCampaignResponse);
  }

  try {
    const body: CreateCampaignRequest = await req.json();

    // 1. Create campaign
    const campUrl  = `${GRAPH}/${act}/campaigns`;
    const campBody = new URLSearchParams({
      name:             body.name,
      objective:        body.objective,
      status:           'PAUSED',   // always start paused — user activates manually
      special_ad_categories: '[]',
      access_token:     tok,
    });
    const campRes  = await fetch(campUrl, { method: 'POST', body: campBody });
    const campJson = await campRes.json() as { id?: string; error?: { message: string } };
    if (campJson.error) throw new Error(campJson.error.message);
    const campaignId = campJson.id!;

    // 2. Create ad set with budget
    const adsetUrl  = `${GRAPH}/${act}/adsets`;
    const adsetBody = new URLSearchParams({
      name:                    `${body.name} — Ad Set`,
      campaign_id:             campaignId,
      daily_budget:            String(Math.round(body.budgetDaily * 100)), // USD → cents
      billing_event:           'IMPRESSIONS',
      optimization_goal:       'REACH',
      bid_strategy:            'LOWEST_COST_WITHOUT_CAP',
      start_time:              new Date(body.startDate).toISOString(),
      ...(body.endDate ? { end_time: new Date(body.endDate).toISOString() } : {}),
      targeting:               JSON.stringify({
        geo_locations: {
          countries: body.targeting?.countries?.length ? body.targeting.countries : ['TR'],
        },
        age_min: body.targeting?.ageMin ?? 18,
        age_max: body.targeting?.ageMax ?? 65,
      }),
      status:       'PAUSED',
      access_token: tok,
    });
    const adsetRes  = await fetch(adsetUrl, { method: 'POST', body: adsetBody });
    const adsetJson = await adsetRes.json() as { id?: string; error?: { message: string } };
    if (adsetJson.error) throw new Error(adsetJson.error.message);

    return NextResponse.json({ platform: 'meta', campaignId, success: true } as CreateCampaignResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ platform: 'meta', campaignId: '', success: false, error: msg } as CreateCampaignResponse, { status: 500 });
  }
}

// ── Mock data (when not configured) ──────────────────────────────────────────
function getMockCampaigns(): AdCampaign[] {
  return [
    {
      id: 'mock_meta_1', platform: 'meta', name: 'Seafarer Registration — TR',
      status: 'ACTIVE', objective: 'OUTCOME_LEADS',
      budgetDaily: 15, budgetTotal: null, currency: 'USD',
      startDate: '2026-05-01', endDate: null, createdAt: '2026-05-01T10:00:00Z',
      insights: { impressions: 42500, clicks: 1820, spend: 312.5, ctr: 4.28, cpc: 0.17, conversions: 148, cpm: 7.35 },
    },
    {
      id: 'mock_meta_2', platform: 'meta', name: 'Shipowner B2B — Global',
      status: 'PAUSED', objective: 'OUTCOME_TRAFFIC',
      budgetDaily: 25, budgetTotal: null, currency: 'USD',
      startDate: '2026-04-15', endDate: null, createdAt: '2026-04-15T08:00:00Z',
      insights: { impressions: 18200, clicks: 540, spend: 198.0, ctr: 2.97, cpc: 0.37, conversions: 32, cpm: 10.88 },
    },
  ];
}
