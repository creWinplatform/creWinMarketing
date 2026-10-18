import { NextRequest, NextResponse } from 'next/server';
import { GoogleApiError, getServiceAccountToken, googleErrorStatus, googlePostJson } from '@/lib/gsc';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

type OrderBy = { metric: { metricName: string }; desc: boolean };

// res.ok kontrolü googlePostJson içinde — GA4 hatası artık {ok:true} içinde "veri" gibi dönmez
async function runReport(
  token: string,
  propertyId: string,
  dimensions: string[],
  metrics: string[],
  dateRanges = [{ startDate: '30daysAgo', endDate: 'today' }],
  orderBys?: OrderBy[],
  limit = 10,
) {
  const body: Record<string, unknown> = {
    dateRanges,
    dimensions: dimensions.map(n => ({ name: n })),
    metrics:    metrics.map(n => ({ name: n })),
    limit,
  };
  if (orderBys) body.orderBys = orderBys;
  return googlePostJson<Record<string, unknown>>(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    token,
    body,
    'GA4',
  );
}

export async function GET(req: NextRequest) {
  // Env istek anında okunur
  const propertyId = (process.env.GA4_PROPERTY_ID || '').trim();
  const saRaw      = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!propertyId || !saRaw) {
    return NextResponse.json({ ok: false, notConfigured: true });
  }
  if (!/^\d+$/.test(propertyId)) {
    return NextResponse.json({ ok: false, error: 'GA4_PROPERTY_ID sayısal property ID olmalı' }, { status: 500 });
  }

  let saJson: Record<string, string>;
  try { saJson = JSON.parse(saRaw); }
  catch { return NextResponse.json({ ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON geçersiz JSON' }, { status: 500 }); }

  const rangeParam = req.nextUrl.searchParams.get('range') || '30';
  const days = ['7', '30', '90'].includes(rangeParam) ? parseInt(rangeParam) : 30;

  const cur  = { startDate: `${days}daysAgo`,      endDate: 'today' };
  const prev = { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` };

  const bySessionsDesc: OrderBy[] = [{ metric: { metricName: 'sessions' }, desc: true }];
  const byViewsDesc:    OrderBy[] = [{ metric: { metricName: 'screenPageViews' }, desc: true }];

  try {
    const token = await getServiceAccountToken(GA4_SCOPE, saJson);

    const [overview, prevOverview, topPages, countries, cities, sources, devices, daily, campaigns] =
      await Promise.all([
        runReport(token, propertyId, [],
          ['sessions','activeUsers','newUsers','bounceRate','averageSessionDuration','engagementRate'],
          [cur]),
        runReport(token, propertyId, [],
          ['sessions','activeUsers','newUsers','bounceRate','averageSessionDuration'],
          [prev]),
        runReport(token, propertyId, ['pagePath'],
          ['screenPageViews','averageSessionDuration'],
          [cur], byViewsDesc, 10),
        runReport(token, propertyId, ['country'], ['sessions'], [cur], bySessionsDesc, 8),
        runReport(token, propertyId, ['city'],    ['sessions'], [cur], bySessionsDesc, 6),
        runReport(token, propertyId, ['sessionSource'], ['sessions'], [cur], bySessionsDesc, 8),
        runReport(token, propertyId, ['deviceCategory'], ['sessions'], [cur], bySessionsDesc, 5),
        runReport(token, propertyId, ['date'], ['sessions','activeUsers'], [cur], undefined, 90),
        runReport(token, propertyId, ['sessionCampaignName'], ['sessions','activeUsers','engagedSessions'], [cur], bySessionsDesc, 20),
      ]);

    return NextResponse.json({
      ok: true,
      overview, prevOverview, topPages, countries, cities, sources, devices, daily, campaigns,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e: unknown) {
    const message = e instanceof GoogleApiError || e instanceof Error ? e.message : 'GA4 verisi alınamadı';
    return NextResponse.json({ ok: false, error: message }, { status: googleErrorStatus(e) });
  }
}
