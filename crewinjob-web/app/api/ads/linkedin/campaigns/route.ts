/**
 * GET  /api/ads/linkedin/campaigns    — List LinkedIn Sponsored campaigns
 * POST /api/ads/linkedin/campaigns    — Create a new campaign
 */
import { NextRequest, NextResponse } from 'next/server';
import type {
  AdCampaign, CampaignsResponse, CreateCampaignRequest, CreateCampaignResponse, CampaignStatus,
} from '@/lib/ads-types';

const LI_API = 'https://api.linkedin.com/v2';

function token()     { return process.env.LINKEDIN_ACCESS_TOKEN  || ''; }
function accountId() { return process.env.LINKEDIN_ADS_ACCOUNT_ID || ''; }  // numeric, e.g. "505123456"

function headers() {
  return {
    'Authorization': `Bearer ${token()}`,
    'Content-Type':  'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

// ── Normalize LinkedIn campaign → AdCampaign ─────────────────────────────────
function normalize(raw: Record<string, unknown>): AdCampaign {
  const cost   = raw.costType === 'CPM' ? 'CPM' : 'CPC';
  const budget = raw.dailyBudget as { amount?: string; currencyCode?: string } | undefined;
  const total  = raw.totalBudget  as { amount?: string } | undefined;
  const status = String(raw.status || 'UNKNOWN').toUpperCase() as CampaignStatus;
  const urn    = String(raw.id || '');

  return {
    id:          urn.split(':').pop() || urn,
    platform:    'linkedin',
    name:        String(raw.name || ''),
    status,
    objective:   String((raw.objectiveType as string) || ''),
    budgetDaily: budget?.amount ? parseFloat(budget.amount) : null,
    budgetTotal: total?.amount  ? parseFloat(total.amount)  : null,
    currency:    budget?.currencyCode || 'USD',
    startDate:   raw.runSchedule
      ? new Date((raw.runSchedule as { start: number }).start).toISOString().slice(0, 10)
      : null,
    endDate:     raw.runSchedule && (raw.runSchedule as { end?: number }).end
      ? new Date((raw.runSchedule as { end: number }).end).toISOString().slice(0, 10)
      : null,
    createdAt:   raw.changeAuditStamps
      ? new Date(((raw.changeAuditStamps as { created?: { time?: number } }).created?.time) ?? 0).toISOString()
      : null,
    insights: undefined,
  };

  void cost; // budgetType for future use
}

// ── GET — list campaigns ──────────────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  const tok = token();
  const act = accountId();

  if (!tok || !act) {
    return NextResponse.json({ platform: 'linkedin', campaigns: getMockCampaigns(), source: 'mock' } as CampaignsResponse);
  }

  try {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${act}`);
    const url = `${LI_API}/adCampaignsV2?q=search&search.account.values[0]=${accountUrn}&count=50`;
    const res = await fetch(url, { headers: headers(), next: { revalidate: 60 } });
    const json = await res.json() as { elements?: Record<string, unknown>[]; message?: string };

    if (!res.ok) throw new Error((json as { message?: string }).message || `HTTP ${res.status}`);

    const campaigns = (json.elements || []).map(normalize);
    return NextResponse.json({ platform: 'linkedin', campaigns, source: 'api' } as CampaignsResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ platform: 'linkedin', campaigns: [], source: 'api', error: msg } as CampaignsResponse, { status: 500 });
  }
}

// ── POST — create campaign ────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const tok = token();
  const act = accountId();

  if (!tok || !act) {
    return NextResponse.json({ platform: 'linkedin', campaignId: 'mock_li_' + Date.now(), success: true } as CreateCampaignResponse);
  }

  try {
    const body: CreateCampaignRequest = await req.json();
    const accountUrn = `urn:li:sponsoredAccount:${act}`;

    const payload = {
      account:        accountUrn,
      name:           body.name,
      status:         'PAUSED',
      type:           'TEXT_AD',
      costType:       'CPM',
      objectiveType:  body.objective,
      dailyBudget: {
        amount:       String(body.budgetDaily.toFixed(2)),
        currencyCode: 'USD',
      },
      runSchedule: {
        start: new Date(body.startDate).getTime(),
        ...(body.endDate ? { end: new Date(body.endDate).getTime() } : {}),
      },
      targeting: {
        includedTargetingFacets: {
          locations: body.targeting?.countries?.length
            ? body.targeting.countries.map(c => `urn:li:country:${c.toLowerCase()}`)
            : ['urn:li:country:tr'],
        },
      },
      locale: { country: 'US', language: 'en' },
    };

    const res  = await fetch(`${LI_API}/adCampaignsV2`, {
      method:  'POST',
      headers: headers(),
      body:    JSON.stringify(payload),
    });
    const json = await res.json() as { id?: string; message?: string };
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);

    const campaignId = String(json.id || '').split(':').pop() || '';
    return NextResponse.json({ platform: 'linkedin', campaignId, success: true } as CreateCampaignResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ platform: 'linkedin', campaignId: '', success: false, error: msg } as CreateCampaignResponse, { status: 500 });
  }
}

// ── Mock data ─────────────────────────────────────────────────────────────────
function getMockCampaigns(): AdCampaign[] {
  return [
    {
      id: 'mock_li_1', platform: 'linkedin', name: 'Manning Agency Outreach Q2',
      status: 'ACTIVE', objective: 'LEAD_GENERATION',
      budgetDaily: 20, budgetTotal: 400, currency: 'USD',
      startDate: '2026-04-01', endDate: '2026-06-30', createdAt: '2026-04-01T09:00:00Z',
      insights: { impressions: 9800, clicks: 195, spend: 287.4, ctr: 1.99, cpc: 1.47, conversions: 22, cpm: 29.3 },
    },
    {
      id: 'mock_li_2', platform: 'linkedin', name: 'CrewinJob Brand Awareness',
      status: 'PAUSED', objective: 'BRAND_AWARENESS',
      budgetDaily: 10, budgetTotal: null, currency: 'USD',
      startDate: '2026-03-01', endDate: null, createdAt: '2026-03-01T11:00:00Z',
      insights: { impressions: 21400, clicks: 310, spend: 154.0, ctr: 1.45, cpc: 0.50, conversions: 0, cpm: 7.2 },
    },
  ];
}
