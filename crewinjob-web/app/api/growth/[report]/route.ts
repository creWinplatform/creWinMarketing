import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const REPORTS: Record<string, { endpoint: string; method: 'GET' | 'POST' }> = {
  acquisition: { endpoint: 'GetAcquisitionReport', method: 'GET' },
  'activation-trend': { endpoint: 'GetActivationTrend', method: 'GET' },
  'campaign-conversion': { endpoint: 'GetCampaignConversionReport', method: 'GET' },
  // Backend son sözleşmesinde delivery ayrı bir uç olarak yayınlanmıyor;
  // paneldeki eski route aynı conversion raporundan beslenmeye devam eder.
  'campaign-delivery': { endpoint: 'GetCampaignConversionReport', method: 'GET' },
  'profile-completion': { endpoint: 'GetProfileCompletionSummary', method: 'GET' },
};

type GrowthApi = {
  growthAnalyticsGet: (name: string, query: Record<string, unknown>) => Promise<unknown>;
  growthAnalyticsPost: (name: string, body: Record<string, unknown>) => Promise<unknown>;
};

function normalize(report: string, raw: unknown) {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const number = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      if (value[key] !== undefined && value[key] !== null) {
        const parsed = Number(value[key]);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return undefined;
  };
  const list = (...keys: string[]): Array<Record<string, unknown>> => {
    for (const key of keys) if (Array.isArray(value[key])) return value[key] as Array<Record<string, unknown>>;
    return [];
  };
  if (report === 'acquisition') {
    const periods = list('periods', 'items');
    const registrations = number('totalRegistrations', 'registrations');
    const periodActivated = periods.reduce((sum, item) => sum + Number(item.activated80Plus ?? item.activatedSeafarers ?? item.newActivated ?? 0), 0);
    const activatedSeafarers = number('activatedSeafarers', 'totalActivatedSeafarers') ?? periodActivated;
    return {
      summary: {
        registrations,
        attributedRegistrations: number('attributedRegistrations'),
        unattributedRegistrations: number('unattributedRegistrations'),
        activatedSeafarers,
        activationRate: number('activationRate', 'activationRatePct') ?? (registrations && registrations > 0 ? activatedSeafarers / registrations * 100 : undefined),
      },
      periods,
      totalCount: periods.length,
      sourceBreakdown: list('sourceBreakdown'),
      mediumBreakdown: list('mediumBreakdown'),
      campaignBreakdown: list('campaignBreakdown'),
      countryBreakdown: list('countryBreakdown'),
      from: value.from,
      to: value.to,
      interval: value.interval,
      dataNote: value.dataNote,
      isHistorical: value.isHistorical,
      generatedAt: value.generatedAt,
    };
  }
  if (report === 'activation-trend') {
    const periods = Array.isArray(value.periods) ? value.periods as Array<Record<string, unknown>> : [];
    const dataNote = typeof value.dataNote === 'string' ? value.dataNote : undefined;
    const isHistorical = value.isHistorical === undefined
      ? (dataNote && /approximat|query-time|yaklaşık/i.test(dataNote) ? false : undefined)
      : Boolean(value.isHistorical);
    // GetActivationTrend sözleşmesinde "profil başlatan" alanı yok; backend eklerse (startedProfiles /
    // newStartedProfiles) iletilir, yoksa alan hiç gönderilmez ve UI sütunu gizler (0 diye uydurulmaz).
    const started = (item: Record<string, unknown>): number | undefined => {
      const raw = item.startedProfiles ?? item.newStartedProfiles;
      const parsed = raw === undefined || raw === null ? Number.NaN : Number(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    return {
      items: periods.map(item => ({
        date: item.periodStart,
        registrations: Number(item.newRegistrations ?? item.registrations ?? 0),
        ...(started(item) !== undefined ? { startedProfiles: started(item) } : {}),
        activatedSeafarers: Number(item.newActivated ?? item.activatedSeafarers ?? 0),
        activationRate: Number(item.activationRate ?? item.activationRatePct ?? 0),
      })),
      totalCount: periods.length,
      dataNote,
      isHistorical,
      totalRegistrations: number('totalRegistrations'),
      totalActivatedSeafarers: number('totalActivatedSeafarers'),
      activationRate: number('activationRate', 'activationRatePct'),
    };
  }
  if (report === 'campaign-conversion' || report === 'campaign-delivery') {
    return {
      summary: {
        totalQueued: number('totalQueued', 'queued'),
        totalSent: number('totalSent', 'sent'),
        delivered: number('delivered', 'totalDelivered'),
        uniqueDelivered: number('uniqueDelivered'),
        opens: number('opened', 'opens', 'totalOpened'),
        uniqueOpened: number('uniqueOpened'),
        clicks: number('clicked', 'clicks', 'totalClicked'),
        uniqueClicked: number('uniqueClicked'),
        bounced: number('bounced', 'totalBounced'),
        complained: number('complained', 'totalComplained'),
        failed: number('failed', 'totalFailed'),
        unsubscribed: number('unsubscribed', 'totalUnsubscribed'),
        registrations: number('registered', 'registrations'),
        activatedSeafarers: number('activated', 'activatedSeafarers'),
        deliveryRate: number('deliveryRate', 'deliveryRatePct'),
        activationRate: number('activationRate', 'conversionRatePct'),
        openRate: number('openRate', 'openRatePct'),
        clickRate: number('clickRate', 'clickRatePct'),
        clickToOpenRate: number('clickToOpenRate', 'clickToOpenRatePct'),
        registrationRate: number('registrationRate', 'registrationRatePct'),
      },
      campaignId: value.campaignId,
      channelBreakdown: list('channelBreakdown'),
      periodBreakdown: list('periodBreakdown', 'periods'),
      dataNote: value.dataNote,
    };
  }
  return value;
}

export async function GET(req: NextRequest, context: { params: Promise<{ report: string }> }) {
  const report = REPORTS[(await context.params).report];
  if (!report) return NextResponse.json({ error: 'Bilinmeyen growth raporu.' }, { status: 404 });

  const params: Record<string, unknown> = {};
  for (const key of Array.from(new Set(Array.from(req.nextUrl.searchParams.keys())))) {
    const values = req.nextUrl.searchParams.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }
  for (const key of ['skip', 'take']) {
    if (typeof params[key] === 'string') params[key] = Number(params[key]);
  }
  if (params.from !== undefined && params.startDate === undefined) params.startDate = params.from;
  if (params.to !== undefined && params.endDate === undefined) params.endDate = params.to;
  if (params.interval !== undefined && params.groupBy === undefined && (await context.params).report === 'acquisition') params.groupBy = params.interval;
  delete params.from;
  delete params.to;
  const api = agentModule<GrowthApi>('modules/api.js');
  try {
    const raw = report.method === 'POST'
      ? await api.growthAnalyticsPost(report.endpoint, params)
      : await api.growthAnalyticsGet(report.endpoint, params);
    return NextResponse.json({ available: true, result: normalize((await context.params).report, raw) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Growth raporu alınamadı.';
    if (/HTTP\s+404|not found|bulunamadı/i.test(message)) {
      return NextResponse.json({ available: false, reason: 'backend_not_ready' });
    }
    if (/HTTP\s+401|unauthorized|authentication/i.test(message)) {
      return NextResponse.json({ available: false, reason: 'authentication_required' }, { status: 401 });
    }
    if (/HTTP\s+403|forbidden|yetki|permission/i.test(message)) {
      return NextResponse.json({ available: false, reason: 'permission_denied' }, { status: 403 });
    }
    if (/HTTP\s+429|rate.?limit/i.test(message)) {
      return NextResponse.json({ available: false, reason: 'rate_limited' }, { status: 429 });
    }
    return NextResponse.json({ available: false, reason: 'backend_error', error: message }, { status: 502 });
  }
}
