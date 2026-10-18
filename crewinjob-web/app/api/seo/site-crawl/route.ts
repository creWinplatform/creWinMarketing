import { NextRequest, NextResponse } from 'next/server';
import { auditPublicPage, discoverSiteUrls, type AuditFinding, type PageAudit } from '@/lib/site-audit';
import { createOrMergeCrawlWorkItem } from '@/lib/seo-work-items';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

type PageResult = { url: string; audit?: PageAudit; error?: string };

async function mapConcurrent<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor; cursor += 1;
      result[index] = await work(items[index]);
    }
  }));
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { baseUrl?: string; maxPages?: number; autoCreateTasks?: boolean };
    if (!body.baseUrl?.trim()) return NextResponse.json({ error: 'Site URL’si gerekli.' }, { status: 400 });
    const maxPages = Math.max(1, Math.min(Number(body.maxPages) || 25, 50));
    const discovered = await discoverSiteUrls(body.baseUrl.trim(), maxPages);
    const pages = await mapConcurrent(discovered.urls, 3, async (url): Promise<PageResult> => {
      try { return { url, audit: await auditPublicPage(url) }; }
      catch (error) { return { url, error: error instanceof Error ? error.message : 'Sayfa denetlenemedi.' }; }
    });
    const grouped = new Map<string, { finding: AuditFinding; urls: string[] }>();
    for (const page of pages) {
      for (const finding of page.audit?.findings || []) {
        if (finding.priority === 'low') continue;
        const key = `${finding.priority}|${finding.category}|${finding.title}`;
        const entry = grouped.get(key) || { finding, urls: [] };
        entry.urls.push(page.audit!.finalUrl);
        grouped.set(key, entry);
      }
    }
    // Dosya kilidi zaten sıralar; sıralı await ile her grup tek tek birleştirilir
    const createdTasks: Awaited<ReturnType<typeof createOrMergeCrawlWorkItem>>[] = [];
    if (body.autoCreateTasks !== false) {
      for (const group of Array.from(grouped.values())) {
        createdTasks.push(await createOrMergeCrawlWorkItem({
          url: discovered.baseUrl,
          title: group.urls.length > 1 ? `${group.finding.title} (${group.urls.length} sayfa)` : group.finding.title,
          recommendation: group.finding.recommendation,
          evidence: `${group.urls.length} sayfada görüldü: ${group.urls.slice(0, 12).join(' | ')}${group.urls.length > 12 ? ' | …' : ''}`,
          priority: group.finding.priority,
          affectedUrls: group.urls,
          source: 'site_crawl',
        }));
      }
    }
    const completed = pages.filter(page => page.audit).length;
    const findingCount = pages.reduce((sum, page) => sum + (page.audit?.findings.length || 0), 0);
    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      baseUrl: discovered.baseUrl,
      discoverySource: discovered.source,
      discoveredCount: discovered.discoveredCount,
      scannedCount: pages.length,
      completedCount: completed,
      failedCount: pages.length - completed,
      findingCount,
      groupedFindingCount: grouped.size,
      taskCount: createdTasks.length,
      pages: pages.map(page => ({ url: page.audit?.finalUrl || page.url, httpStatus: page.audit?.httpStatus || null, findingCount: page.audit?.findings.length || 0, highCount: page.audit?.findings.filter(finding => finding.priority === 'high').length || 0, error: page.error || null })),
      limitations: ['Sayfalar sitemap öncelikli keşfedilir; sitemap yoksa ana sayfa bağlantılarıyla sınırlı keşif yapılır.', 'Tarama bu çalıştırmada en fazla 50 URL ile sınırlandırılmıştır.', 'Yalnızca yüksek ve orta öncelikli bulgular otomatik öneri kaydına dönüştürülür.', 'Canlı siteye otomatik değişiklik yayınlanmaz.'],
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Site taraması başlatılamadı.' }, { status: 400 });
  }
}
