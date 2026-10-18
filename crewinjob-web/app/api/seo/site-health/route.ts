import { NextRequest, NextResponse } from 'next/server';
import { backendStatus, isRecord, marketingBackend, records, stringValue } from '@/lib/marketing-backend';
import { assertPublicUrl } from '@/lib/site-audit';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const getEndpoints = {
  sites: 'GetSites',
  inventory: 'GetUrlInventory',
  crawlStatus: 'GetCrawlStatus',
  crawlResults: 'GetCrawlResults',
  findings: 'GetFindings',
  recommendations: 'GetRecommendationGroups',
  schedule: 'GetSchedule',
} as const;

type GetAction = keyof typeof getEndpoints;

function queryParams(request: NextRequest) {
  const params: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => { if (key !== 'action') params[key] = value; });
  return params;
}

function endpointParams(action: GetAction, request: NextRequest) {
  const params = queryParams(request);
  if (action === 'crawlStatus' && params.id) {
    params.jobId = params.id;
    delete params.id;
  }
  if (action === 'crawlResults' && params.id) {
    params.jobId = params.id;
    delete params.id;
  }
  return params;
}

// Doğrulama hataları backend hatası değil → 400
class SiteValidationError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, SiteValidationError.prototype);
  }
}

function responseError(error: unknown, fallback: string) {
  if (error instanceof SiteValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: backendStatus(error) });
}

// Backend site kaydı oluşturulan her adresi tarar → yalnızca izinli alan adları (SSRF koruması)
function allowedHosts(): string[] {
  return String(process.env.SEO_ALLOWED_HOSTS || 'crewinjob.com,www.crewinjob.com,crewin.org,www.crewin.org')
    .split(',').map(host => host.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
}

/** URL'yi doğrular: http/https, izinli host, özel port/kimlik yok, genel IP'ye çözümleniyor → origin. */
async function publicOrigin(value: unknown): Promise<string> {
  let url: URL;
  try { url = new URL(stringValue(value).trim()); } catch { throw new SiteValidationError('Geçerli bir site URL’si gerekli.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SiteValidationError('Geçerli bir site URL’si gerekli.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!allowedHosts().includes(host)) throw new SiteValidationError(`Bu alan adı SEO taraması için izinli değil: ${host}. İzinli: ${allowedHosts().join(', ')} (SEO_ALLOWED_HOSTS).`);
  try { await assertPublicUrl(url); } catch (error) { throw new SiteValidationError(error instanceof Error ? error.message : 'Site adresi doğrulanamadı.'); }
  return url.origin;
}

/** Sitemap adresi site ile aynı origin'de olmalı (backend bunu da tarar). */
function sitemapFor(origin: string, value: unknown): string {
  const raw = stringValue(value).trim();
  if (!raw) return `${origin}/sitemap.xml`;
  let url: URL;
  try { url = new URL(raw, origin); } catch { throw new SiteValidationError('Geçerli bir sitemap URL’si gerekli.'); }
  if (url.origin !== origin) throw new SiteValidationError('Sitemap adresi site ile aynı alan adında olmalı.');
  return url.toString();
}

function siteBaseUrl(site: Record<string, unknown>): string {
  return stringValue(site.baseUrl || site.url || site.siteUrl || site.origin).replace(/\/$/, '');
}

async function ensureSite(baseUrl: unknown) {
  const origin = await publicOrigin(baseUrl);
  const allSites = records(await marketingBackend().siteSeoGet('GetSites', { skipCount: 0, maxResultCount: 500 }));
  const matching = allSites.find(site => siteBaseUrl(site) === origin);
  if (matching) return matching;

  const parsed = new URL(origin);
  const created = await marketingBackend().siteSeoPost('CreateOrUpdateSite', {
    name: parsed.hostname,
    baseUrl: origin,
    sitemapUrl: `${origin}/sitemap.xml`,
    timezone: 'Europe/Istanbul',
    isActive: true,
  });
  if (!isRecord(created)) throw new Error('Site kaydı oluşturuldu ancak geçerli bir yanıt alınamadı.');
  return created;
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action') as GetAction | null;
  if (!action || !(action in getEndpoints)) return NextResponse.json({ error: 'Geçerli bir SiteSeo sorgu türü gerekli.' }, { status: 400 });
  try {
    return NextResponse.json(await marketingBackend().siteSeoGet(getEndpoints[action], endpointParams(action, request)));
  } catch (error) {
    return responseError(error, 'Site denetimi verisi alınamadı.');
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: 'Geçerli JSON gövdesi gerekli.' }, { status: 400 }); }
  try {
    if (body.action === 'ensureSite') return NextResponse.json(await ensureSite(body.baseUrl));
    if (body.action === 'saveSite') {
      const origin = await publicOrigin(body.baseUrl);
      const payload = {
        ...(body.id ? { id: body.id } : {}),
        name: stringValue(body.name).trim() || new URL(origin).hostname,
        baseUrl: origin,
        sitemapUrl: sitemapFor(origin, body.sitemapUrl),
        timezone: stringValue(body.timezone).trim() || 'Europe/Istanbul',
        isActive: body.isActive !== false,
      };
      return NextResponse.json(await marketingBackend().siteSeoPost('CreateOrUpdateSite', payload));
    }
    if (body.action === 'startCrawl') {
      let site: Record<string, unknown>;
      if (body.siteId) {
        // Var olan kayıt da izinli bir alan adına ait olmalı (eski/elle eklenmiş kayıtlar taranmasın)
        const allSites = records(await marketingBackend().siteSeoGet('GetSites', { skipCount: 0, maxResultCount: 500 }));
        const existing = allSites.find(item => stringValue(item.id ?? item.siteId) === stringValue(body.siteId));
        if (!existing) return NextResponse.json({ error: 'Site kaydı bulunamadı.' }, { status: 404 });
        await publicOrigin(siteBaseUrl(existing));
        site = existing;
      } else {
        site = await ensureSite(body.baseUrl);
      }
      const siteId = site.id || site.siteId;
      if (siteId === undefined || siteId === null || siteId === '') throw new Error('Tarama için site kimliği alınamadı.');
      const maxUrls = Math.max(1, Math.min(500, Number(body.maxUrls) || 25));
      const result = await marketingBackend().siteSeoPost('StartCrawl', { siteId, maxUrls });
      return NextResponse.json({ ...(isRecord(result) ? result : { result }), siteId: String(siteId) });
    }
    if (body.action === 'recommendation') {
      if (!body.siteId || !body.findingGroupKey || !body.status) return NextResponse.json({ error: 'Site, öneri grubu ve durum gerekli.' }, { status: 400 });
      return NextResponse.json(await marketingBackend().siteSeoPost('UpdateRecommendationStatus', { siteId: body.siteId, findingGroupKey: body.findingGroupKey, status: body.status, implementationNote: body.implementationNote }));
    }
    if (body.action === 'schedule') return NextResponse.json(await marketingBackend().siteSeoPost('ConfigureSchedule', body.schedule as Record<string, unknown> || {}));
    return NextResponse.json({ error: 'Geçerli bir SiteSeo işlem türü gerekli.' }, { status: 400 });
  } catch (error) {
    return responseError(error, 'Site denetimi işlemi tamamlanamadı.');
  }
}
