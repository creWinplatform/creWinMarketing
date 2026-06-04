/**
 * GET  /api/ads/google/campaigns      — List Google Ads campaigns
 * POST /api/ads/google/campaigns      — Create a new campaign
 *
 * Uses Google Ads REST API v17 with OAuth 2.0 refresh token flow.
 * Requires: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
 *           GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
 *           GOOGLE_ADS_CUSTOMER_ID  (no dashes, e.g. "1234567890")
 */
import { NextRequest, NextResponse } from 'next/server';
import type {
  AdCampaign, CampaignsResponse, CreateCampaignRequest, CreateCampaignResponse, CampaignStatus,
} from '@/lib/ads-types';

const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v17';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ── OAuth access token (cached in-process, refreshed every 55 min) ───────────
let _accessToken = '';
let _tokenExpiry  = 0;

async function getAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;

  const res  = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_ADS_CLIENT_ID     || '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
      grant_type:    'refresh_token',
    }),
  });
  const json = await res.json() as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(json.error || 'Failed to get Google access token');

  _accessToken = json.access_token;
  _tokenExpiry  = Date.now() + 55 * 60 * 1000;  // 55 minutes
  return _accessToken;
}

function customerId() { return (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, ''); }

function googleHeaders(accessToken: string) {
  return {
    'Authorization':         `Bearer ${accessToken}`,
    'developer-token':       process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    'Content-Type':          'application/json',
    ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
      ? { 'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID }
      : {}),
  };
}

// ── Normalize Google campaign row → AdCampaign ───────────────────────────────
function normalize(row: Record<string, unknown>): AdCampaign {
  const camp   = (row.campaign || {}) as Record<string, unknown>;
  const budget = (row.campaignBudget || {}) as Record<string, unknown>;
  const metrics = (row.metrics || {}) as Record<string, unknown>;

  const statusMap: Record<string, CampaignStatus> = {
    ENABLED:  'ACTIVE',
    PAUSED:   'PAUSED',
    REMOVED:  'DELETED',
    UNKNOWN:  'UNKNOWN',
  };

  return {
    id:          String(camp.id || ''),
    platform:    'google',
    name:        String(camp.name || ''),
    status:      statusMap[String(camp.status || 'UNKNOWN')] || 'UNKNOWN',
    objective:   String(camp.advertisingChannelType || ''),
    budgetDaily: budget.amountMicros ? Number(budget.amountMicros) / 1_000_000 : null,
    budgetTotal: null,
    currency:    'USD',
    startDate:   camp.startDate ? String(camp.startDate) : null,
    endDate:     camp.endDate   ? String(camp.endDate)   : null,
    createdAt:   null,
    insights: metrics.impressions !== undefined ? {
      impressions: Number(metrics.impressions || 0),
      clicks:      Number(metrics.clicks || 0),
      spend:       metrics.costMicros ? Number(metrics.costMicros) / 1_000_000 : 0,
      ctr:         metrics.ctr ? Number(metrics.ctr) * 100 : 0,
      cpc:         metrics.averageCpc ? Number(metrics.averageCpc) / 1_000_000 : 0,
      conversions: Number(metrics.conversions || 0),
      cpm:         metrics.averageCpm ? Number(metrics.averageCpm) / 1_000_000 : 0,
    } : undefined,
  };
}

// ── GET — list campaigns via GAQL ─────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  const cid = customerId();
  const hasCreds = !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    cid
  );

  if (!hasCreds) {
    return NextResponse.json({ platform: 'google', campaigns: getMockCampaigns(), source: 'mock' } as CampaignsResponse);
  }

  try {
    const accessToken = await getAccessToken();
    const query = `
      SELECT
        campaign.id, campaign.name, campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date, campaign.end_date,
        campaign_budget.amount_micros,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.ctr, metrics.average_cpc, metrics.average_cpm, metrics.conversions
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.id DESC
      LIMIT 50
    `;

    const url = `${GOOGLE_ADS_API}/customers/${cid}/googleAds:search`;
    const res = await fetch(url, {
      method:  'POST',
      headers: googleHeaders(accessToken),
      body:    JSON.stringify({ query }),
    });
    const json = await res.json() as { results?: Record<string, unknown>[]; error?: { message: string } };
    if (!res.ok || json.error) throw new Error(json.error?.message || `HTTP ${res.status}`);

    const campaigns = (json.results || []).map(normalize);
    return NextResponse.json({ platform: 'google', campaigns, source: 'api' } as CampaignsResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ platform: 'google', campaigns: [], source: 'api', error: msg } as CampaignsResponse, { status: 500 });
  }
}

// ── POST — create campaign ────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const cid = customerId();
  const hasCreds = !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_REFRESH_TOKEN && cid);

  if (!hasCreds) {
    return NextResponse.json({ platform: 'google', campaignId: 'mock_g_' + Date.now(), success: true } as CreateCampaignResponse);
  }

  try {
    const body: CreateCampaignRequest = await req.json();
    const accessToken = await getAccessToken();
    const hdrs = googleHeaders(accessToken);

    // 1. Create campaign budget
    const budgetRes = await fetch(`${GOOGLE_ADS_API}/customers/${cid}/campaignBudgets:mutate`, {
      method:  'POST',
      headers: hdrs,
      body: JSON.stringify({
        operations: [{
          create: {
            name:         `${body.name} — Budget`,
            amountMicros: Math.round(body.budgetDaily * 1_000_000),
            deliveryMethod: 'STANDARD',
          },
        }],
      }),
    });
    const budgetJson = await budgetRes.json() as { results?: [{ resourceName: string }]; error?: { message: string } };
    if (!budgetRes.ok || budgetJson.error) throw new Error(budgetJson.error?.message || 'Budget creation failed');
    const budgetResource = budgetJson.results?.[0]?.resourceName || '';

    // 2. Create campaign
    const campRes = await fetch(`${GOOGLE_ADS_API}/customers/${cid}/campaigns:mutate`, {
      method:  'POST',
      headers: hdrs,
      body: JSON.stringify({
        operations: [{
          create: {
            name:                    body.name,
            status:                  'PAUSED',
            advertisingChannelType:  body.objective || 'SEARCH',
            campaignBudget:          budgetResource,
            startDate:               body.startDate.replace(/-/g, ''),
            ...(body.endDate ? { endDate: body.endDate.replace(/-/g, '') } : {}),
            networkSettings: {
              targetGoogleSearch:         true,
              targetSearchNetwork:        true,
              targetContentNetwork:       body.objective === 'DISPLAY',
              targetPartnerSearchNetwork: false,
            },
          },
        }],
      }),
    });
    const campJson = await campRes.json() as { results?: [{ resourceName: string }]; error?: { message: string } };
    if (!campRes.ok || campJson.error) throw new Error(campJson.error?.message || 'Campaign creation failed');

    const resourceName = campJson.results?.[0]?.resourceName || '';
    const campaignId   = resourceName.split('/').pop() || '';

    return NextResponse.json({ platform: 'google', campaignId, success: true } as CreateCampaignResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ platform: 'google', campaignId: '', success: false, error: msg } as CreateCampaignResponse, { status: 500 });
  }
}

// ── Mock data ─────────────────────────────────────────────────────────────────
function getMockCampaigns(): AdCampaign[] {
  return [
    {
      id: 'mock_g_1', platform: 'google', name: 'Seafarer Jobs — Search TR',
      status: 'ACTIVE', objective: 'SEARCH',
      budgetDaily: 20, budgetTotal: null, currency: 'USD',
      startDate: '2026-05-01', endDate: null, createdAt: null,
      insights: { impressions: 6200, clicks: 310, spend: 248.0, ctr: 5.0, cpc: 0.80, conversions: 58, cpm: 40.0 },
    },
    {
      id: 'mock_g_2', platform: 'google', name: 'CrewinJob YouTube — Global',
      status: 'PAUSED', objective: 'VIDEO',
      budgetDaily: 30, budgetTotal: null, currency: 'USD',
      startDate: '2026-04-01', endDate: null, createdAt: null,
      insights: { impressions: 31000, clicks: 420, spend: 390.0, ctr: 1.35, cpc: 0.93, conversions: 18, cpm: 12.6 },
    },
  ];
}
