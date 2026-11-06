'use client';
import { useEffect, useState } from 'react';
import { Eye, RefreshCw } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { CompetitorSiteChange, CompetitorSiteView } from '@/lib/platform/coach-types';
import Msg from '@/components/Msg';

// What changed on the competitors' websites, read once a week, and what the team could do about it. reloadKey: changes
// when the competitor notes are saved, so a new address shows up at once.
export default function CompetitorSiteWatch({ lang, canWrite, reloadKey }: { lang: Locale; canWrite: boolean; reloadKey: string }) {
  const tr = lang === 'tr', locale = localeTag(lang);
  const [sites, setSites] = useState<CompetitorSiteView[] | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); projectRequest<CompetitorSiteView[]>('/api/platform/coach/brand?view=sites', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(setSites).catch(() => {}); return () => controller.abort(); }, [reloadKey]);
  if (!sites?.length) return null;
  const check = async (key: string) => {
    if (busy) return; setBusy(key); setError('');
    try { setSites(await projectRequest<CompetitorSiteView[]>('/api/platform/coach/brand', { method: 'POST', body: JSON.stringify({ action: 'check-site', key }), signal: AbortSignal.timeout(45000) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'İstek tamamlanamadı.' : 'Request failed.')); }
    finally { setBusy(''); }
  };
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const describe = (change: CompetitorSiteChange): [string, string] => {
    const d = change.detail;
    switch (change.kind) {
      case 'title': return [tr ? `Başlık değişti: “${text(d.before)}” → “${text(d.after)}”` : `Title changed: “${text(d.before)}” → “${text(d.after)}”`, tr ? 'Ana mesajlarını değiştirmiş olabilirler; kendi farkınızı anlatan bir paylaşım planlayın.' : 'They may have changed their main message; plan a post that states your difference.'];
      case 'description': return [tr ? `Site açıklaması değişti: “${text(d.after)}”` : `Site description changed: “${text(d.after)}”`, tr ? 'Neyi öne çıkardıklarına bakın; sizin açınızı netleştirin.' : 'See what they now stress; sharpen your own angle.'];
      case 'headings': return [tr ? `Ana sayfa başlıkları değişti${Array.isArray(d.added) && d.added.length ? `: yeni “${(d.added as string[]).slice(0, 3).join('”, “')}”` : ''}` : `Home page headings changed${Array.isArray(d.added) && d.added.length ? `: new “${(d.added as string[]).slice(0, 3).join('”, “')}”` : ''}`, tr ? 'Yeni bir kampanya veya özellik duyuruyor olabilirler.' : 'They may be announcing a campaign or feature.'];
      case 'new_pages': return [tr ? `Yeni sayfa veya yazı: ${(Array.isArray(d.pages) ? d.pages as { path: string; text: string }[] : []).map(page => page.text || page.path).join(', ')}` : `New pages or posts: ${(Array.isArray(d.pages) ? d.pages as { path: string; text: string }[] : []).map(page => page.text || page.path).join(', ')}`, tr ? 'Aynı konuda sizin bakışınızı anlatan bir içerik planına ekleyin.' : 'Add a content plan item that gives your view on the same topic.'];
      case 'pricing': return [tr ? 'Fiyat sayfası değişti.' : 'The pricing page changed.', tr ? 'Kendi fiyat mesajınızı ve tekliflerinizi gözden geçirin.' : 'Review your own pricing message and offers.'];
    }
  };
  return <div className="competitor-site-watch">
    <h3><Eye size={15} aria-hidden="true" />{tr ? 'Rakip siteleri' : 'Competitor websites'}</h3>
    <p className="coach-note">{tr ? 'Adres girdiğiniz rakiplerin herkese açık ana sayfası ve fiyat sayfası haftada bir okunur (robots.txt’ye uyulur). Değişiklikler sabit kurallarla bulunur; rakibe hiçbir şey gönderilmez.' : 'The public home and pricing pages of competitors with an address are read once a week (robots.txt respected). Changes are found by fixed rules; nothing is sent to the competitor.'}</p>
    {error && <p role="alert" className="studio-error"><Msg text={error} /></p>}
    <ul>{sites.map(site => <li key={site.key}>
      <p><strong>{site.name}</strong> · <span className="coach-muted">{site.checkedAt ? (site.status === 'blocked' ? (tr ? `robots.txt okumaya kapalı (${date(site.checkedAt)})` : `robots.txt closes it to reading (${date(site.checkedAt)})`) : site.status === 'unreadable' ? (tr ? `okunamadı (${date(site.checkedAt)})` : `could not be read (${date(site.checkedAt)})`) : (tr ? `son okuma ${date(site.checkedAt)}` : `last read ${date(site.checkedAt)}`)) : (tr ? 'henüz okunmadı; ilk okuma bir sonraki çalışmada' : 'not read yet; the first read is in the next run')}</span>
        {canWrite && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void check(site.key)}><RefreshCw size={13} />{busy === site.key ? (tr ? 'Okunuyor…' : 'Reading…') : (tr ? 'Şimdi kontrol et' : 'Check now')}</button>}</p>
      {site.changes.length ? <ul className="competitor-site-changes">{site.changes.map(change => { const [what, idea] = describe(change); return <li key={change.id}><span className="coach-state">{date(change.detectedAt)}</span> {what}<small>{idea}</small></li>; })}</ul>
        : site.checkedAt && site.status === 'ok' ? <p className="coach-muted">{tr ? 'Son 90 günde kayda değer bir değişiklik görülmedi. İlk okuma yalnız karşılaştırma noktasıdır.' : 'No notable change in the last 90 days. The first read is only a baseline.'}</p> : null}
    </li>)}</ul>
  </div>;
}
