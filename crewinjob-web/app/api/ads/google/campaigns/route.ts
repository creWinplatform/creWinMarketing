/**
 * GET  /api/ads/google/campaigns      — List Google Ads campaigns
 * POST /api/ads/google/campaigns      — Create a new campaign (Search / Display, PAUSED)
 *
 * Google Ads REST API — sürüm GOOGLE_ADS_API_VERSION (varsayılan v25; v17 kapatıldı).
 * Requires: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
 *           GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
 *           GOOGLE_ADS_CUSTOMER_ID  (no dashes, e.g. "1234567890")
 */
import { NextRequest, NextResponse } from 'next/server';
import type {
  AdCampaign, CampaignsResponse, CreateCampaignResponse, CampaignStatus,
} from '@/lib/ads-types';
import {
  badRequest, defaultCurrency, errorMessage, googleAdsPost, googleUsesDateTime, isConfigured,
  notConfiguredResponse, readJsonBody, validateCreateRequest,
} from '../../_lib/platforms';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// API ile tek adımda oluşturulabilen kanal tipleri (Video/PMax/Smart ek kurulum ister)
const CREATABLE_TYPES = ['SEARCH', 'DISPLAY'] as const;

// ── Normalize Google campaign row → AdCampaign ───────────────────────────────
function normalize(row: Record<string, unknown>): AdCampaign {
  const camp     = (row.campaign || {}) as Record<string, unknown>;
  const budget   = (row.campaignBudget || {}) as Record<string, unknown>;
  const metrics  = (row.metrics || {}) as Record<string, unknown>;
  const customer = (row.customer || {}) as Record<string, unknown>;

  const statusMap: Record<string, CampaignStatus> = {
    ENABLED:  'ACTIVE',
    PAUSED:   'PAUSED',
    REMOVED:  'DELETED',
    UNKNOWN:  'UNKNOWN',
  };
  // v23+: startDateTime "yyyy-MM-dd HH:mm:ss"; eski sürümler: startDate "yyyy-MM-dd"
  const start = camp.startDateTime || camp.startDate;
  const end   = camp.endDateTime   || camp.endDate;

  return {
    id:          String(camp.id || ''),
    platform:    'google',
    name:        String(camp.name || ''),
    status:      statusMap[String(camp.status || 'UNKNOWN')] || 'UNKNOWN',
    objective:   String(camp.advertisingChannelType || ''),
    budgetDaily: budget.amountMicros ? Number(budget.amountMicros) / 1_000_000 : null,
    budgetTotal: null,
    currency:    String(customer.currencyCode || defaultCurrency()),
    startDate:   start ? String(start).slice(0, 10) : null,
    endDate:     end   ? String(end).slice(0, 10)   : null,
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
  if (!isConfigured('google')) {
    return NextResponse.json({
      platform: 'google', campaigns: getMockCampaigns(), source: 'mock', mock: true, configured: false, currency: defaultCurrency(),
    } as CampaignsResponse);
  }

  try {
    const dateFields = googleUsesDateTime() ? 'campaign.start_date_time, campaign.end_date_time' : 'campaign.start_date, campaign.end_date';
    const query = `
      SELECT
        campaign.id, campaign.name, campaign.status,
        campaign.advertising_channel_type,
        ${dateFields},
        campaign_budget.amount_micros,
        customer.currency_code,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.ctr, metrics.average_cpc, metrics.average_cpm, metrics.conversions
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.id DESC
      LIMIT 50
    `;
    const json = await googleAdsPost<{ results?: Record<string, unknown>[] }>('googleAds:search', { query });
    const campaigns = (json.results || []).map(normalize);
    const currency  = campaigns[0]?.currency || defaultCurrency();
    return NextResponse.json({ platform: 'google', campaigns, source: 'api', configured: true, currency } as CampaignsResponse);
  } catch (err: unknown) {
    return NextResponse.json({ platform: 'google', campaigns: [], source: 'api', configured: true, error: errorMessage(err) } as CampaignsResponse, { status: 502 });
  }
}

// ── POST — create campaign ────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isConfigured('google')) return notConfiguredResponse('google');

  const raw = await readJsonBody(req);
  if (!raw) return badRequest('Geçersiz JSON gövdesi.');
  const parsed = validateCreateRequest(raw);
  if (!parsed.ok) return badRequest(parsed.error);
  const body = parsed.value;
  const channelType = body.objective as typeof CREATABLE_TYPES[number];
  if (!CREATABLE_TYPES.includes(channelType)) {
    return badRequest(`Google Ads kampanya tipi API ile oluşturulamıyor: ${body.objective}. Desteklenenler: ${CREATABLE_TYPES.join(', ')}`);
  }

  let budgetResource = '';
  try {
    // 1. Create campaign budget (micros; para biriminin en küçük birimine — cent — yuvarlanır)
    const budgetJson = await googleAdsPost<{ results?: Array<{ resourceName?: string }> }>('campaignBudgets:mutate', {
      operations: [{
        create: {
          name:             `${body.name} — Budget ${Date.now()}`,   // bütçe adları hesapta benzersiz olmalı
          amountMicros:     String(Math.round(body.budgetDaily * 100) * 10_000),
          deliveryMethod:   'STANDARD',
          explicitlyShared: false,
        },
      }],
    });
    budgetResource = budgetJson.results?.[0]?.resourceName || '';
    if (!budgetResource) throw new Error('Google Ads bütçe kaynağı döndürmedi.');

    // Başlangıç bugünse alan gönderilmez (Google "bugün/şimdi" kabul eder; geçmiş tarih hata verir)
    const today = new Date().toISOString().slice(0, 10);
    const dates: Record<string, string> = {};
    if (googleUsesDateTime()) {
      if (body.startDate > today) dates.startDateTime = `${body.startDate} 00:00:00`;
      if (body.endDate)           dates.endDateTime   = `${body.endDate} 23:59:59`;
    } else {
      if (body.startDate > today) dates.startDate = body.startDate;
      if (body.endDate)           dates.endDate   = body.endDate;
    }

    // 2. Create campaign
    let campJson: { results?: Array<{ resourceName?: string }> };
    try {
      campJson = await googleAdsPost('campaigns:mutate', {
        operations: [{
          create: {
            name:                   body.name,
            status:                 'PAUSED',
            advertisingChannelType: channelType,
            campaignBudget:         budgetResource,
            // Teklif stratejisi zorunlu — en öngörülebilir olan manuel TBM (anahtar kelime/reklam grubunda teklif verilir)
            manualCpc:              {},
            // Eylül 2025'ten beri zorunlu AB siyasi reklam beyanı
            containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
            ...dates,
            networkSettings: channelType === 'DISPLAY'
              ? { targetGoogleSearch: false, targetSearchNetwork: false, targetContentNetwork: true,  targetPartnerSearchNetwork: false }
              : { targetGoogleSearch: true,  targetSearchNetwork: true,  targetContentNetwork: false, targetPartnerSearchNetwork: false },
          },
        }],
      });
    } catch (campErr) {
      // Kampanya oluşmadıysa yetim bütçeyi kaldır
      let cleanup = '';
      try { await googleAdsPost('campaignBudgets:mutate', { operations: [{ remove: budgetResource }] }); }
      catch (cleanupErr) { cleanup = ` (yetim bütçe ${budgetResource} kaldırılamadı: ${errorMessage(cleanupErr)})`; }
      throw new Error(`Kampanya oluşturulamadı: ${errorMessage(campErr)}${cleanup}`);
    }

    const resourceName = campJson.results?.[0]?.resourceName || '';
    const campaignId   = resourceName.split('/').pop() || '';

    // Not: ülke hedeflemesi (campaignCriteria) henüz eklenmiyor — kampanya PAUSED oluşur,
    // yayına almadan önce Google Ads arayüzünde konum hedeflemesi yapılmalı.
    return NextResponse.json({ platform: 'google', campaignId, success: true, configured: true, status: 'PAUSED' } as CreateCampaignResponse);
  } catch (err: unknown) {
    return NextResponse.json({ platform: 'google', campaignId: '', success: false, configured: true, error: errorMessage(err) } as CreateCampaignResponse, { status: 502 });
  }
}

// ── Mock data ─────────────────────────────────────────────────────────────────
function getMockCampaigns(): AdCampaign[] {
  const currency = defaultCurrency();
  return [
    {
      id: 'mock_g_1', platform: 'google', name: 'Seafarer Jobs — Search TR',
      status: 'ACTIVE', objective: 'SEARCH',
      budgetDaily: 20, budgetTotal: null, currency,
      startDate: '2026-05-01', endDate: null, createdAt: null,
      insights: { impressions: 6200, clicks: 310, spend: 248.0, ctr: 5.0, cpc: 0.80, conversions: 58, cpm: 40.0 },
    },
    {
      id: 'mock_g_2', platform: 'google', name: 'CrewinJob YouTube — Global',
      status: 'PAUSED', objective: 'VIDEO',
      budgetDaily: 30, budgetTotal: null, currency,
      startDate: '2026-04-01', endDate: null, createdAt: null,
      insights: { impressions: 31000, clicks: 420, spend: 390.0, ctr: 1.35, cpc: 0.93, conversions: 18, cpm: 12.6 },
    },
  ];
}
