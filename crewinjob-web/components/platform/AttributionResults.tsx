'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Users } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { AttributionPeriod, AttributionReport } from '@/lib/platform/attribution-types';
import Msg from '@/components/Msg';

const CHANNELS: Record<string, [string, string]> = { linkedin: ['LinkedIn', 'LinkedIn'], facebook: ['Facebook', 'Facebook'], x: ['X', 'X'], telegram: ['Telegram', 'Telegram'], email: ['E-posta', 'Email'], '': ['Kanal bilinmiyor', 'Unknown channel'] };

// Which posts and emails brought the people who signed up, activated or paid: the first tagged link each person came
// through (reported by the team's own product events), counted per goal stage. Observations, not credited causes.
export default function AttributionResults({ lang }: { lang: Locale }) {
  const tr = lang === 'tr', locale = localeTag(lang);
  const [data, setData] = useState<AttributionReport | null>(null), [days, setDays] = useState<AttributionPeriod>(30), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true; const controller = new AbortController(); setLoading(true); setError('');
    projectRequest<AttributionReport>(`/api/platform/attribution?days=${days}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(value => { if (mounted.current) setData(value); })
      .catch(reason => { if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : (tr ? 'Kaynak atfı okunamadı.' : 'Could not read source attribution.')); })
      .finally(() => { if (mounted.current && !controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [days, tr]);
  if (!data) return error ? <p role="alert" className="studio-error"><Msg text={error} /></p> : null;
  const n = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 });
  const money = (value: number | null) => { if (value === null || !data.value) return '—'; try { return new Intl.NumberFormat(locale, { style: 'currency', currency: data.value.currency }).format(value); } catch { return `${n(value)} ${data.value.currency}`; } };
  const channel = (source: string) => CHANNELS[source]?.[tr ? 0 : 1] || source;
  const stage = (index: number) => data.stages[index]?.label[lang] || '';
  const day = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const summary = (counts: number[]) => counts.map((count, index) => `${n(count)} ${stage(index)}`).join(' · ');
  const setup = [
    { done: data.setup.activeSources > 0, label: tr ? 'Ürün olaylarınızı imzalı webhook ile gönderin' : 'Send your product events through a signed webhook', href: '/?tab=project&settings=data' },
    { done: data.setup.touches > 0, label: tr ? 'Sitenize kod parçasını ekleyin ve kayıt olayında kaynak etiketini gönderin' : 'Add the snippet to your site and send the source tag with your signup event', href: '/?tab=project&settings=data' },
    { done: data.setup.stagesMapped, label: tr ? 'Hedef aşamalarını ürün olaylarına bağlayın (aşağıda, Otomatik ölçümler)' : 'Map goal stages to product events (below, Automatic measurements)', href: '/?tab=analytics' },
  ];
  const ready = data.setup.touches > 0 && data.stages.length > 0, coverage = data.coverage;
  return <section className="studio-band attribution-results" aria-labelledby="attribution-title" aria-busy={loading}>
    <div className="studio-section-title"><h2 id="attribution-title"><Users size={16} />{tr ? 'Hangi iş müşteri getirdi' : 'Which work brought customers'}</h2>
      <label className="attribution-period">{tr ? 'Dönem' : 'Period'} <select value={days} disabled={loading} onChange={event => setDays(Number(event.target.value) as AttributionPeriod)}>
        <option value={30}>{tr ? 'Son 30 gün' : 'Last 30 days'}</option><option value={90}>{tr ? 'Son 90 gün' : 'Last 90 days'}</option></select></label></div>
    <p className="studio-note">{tr
      ? 'Paylaşım ve e-postalardaki etiketli bağlantıyla sitenize ilk kez gelen kişiler, sonra ürününüzde kayıt olduğunda veya ödeme yaptığında burada sayılır. Bilgi sizin ürün olaylarınızdan gelir; kişi kimliği saklanmaz.'
      : 'People who first came to your site through a tagged link in a post or email are counted here when they later sign up or pay in your product. The figures come from your own product events; no personal id is kept.'}</p>
    {error && <p role="alert" className="studio-error"><Msg text={error} /></p>}
    {!ready && <div className="attribution-setup">{setup.map((item, index) => <a key={index} className="studio-checklist-row" href={item.href}>
      {item.done ? <span className="checklist-complete" aria-hidden="true"><Check size={12} /></span> : <span className="checklist-number" aria-hidden="true">{index + 1}</span>}
      <span>{item.label}{item.done ? <span className="sr-only">{tr ? ' (tamam)' : ' (done)'}</span> : null}</span><ChevronRight size={14} aria-hidden="true" /></a>)}
      {!data.setup.canManage && <p className="studio-note">{tr ? 'Kaynak ve kod parçası adımlarını proje sahibi veya yöneticisi yapar.' : 'The project owner or an admin does the source and snippet steps.'}</p>}
    </div>}
    {ready && <>
      {coverage && coverage.entities > 0 && <p className="attribution-coverage" role="status">{tr
        ? `Son ${data.days} günde “${stage(0)}” aşamasına ulaşan ${n(coverage.entities)} kişiden ${n(coverage.touched)} kişinin ilk geliş kaynağı biliniyor; ${n(coverage.ryzevo)} kişi Ryzevo’nun etiketlediği bir paylaşım veya e-postadan geldi.`
        : `In the last ${data.days} days “${stage(0)}” was reached by ${n(coverage.entities)} people; ${n(coverage.touched)} of them have a known first source and ${n(coverage.ryzevo)} came through a post or email Ryzevo tagged.`}</p>}
      {data.items.length ? <div className="studio-table-scroll" tabIndex={0} role="region" aria-label={tr ? 'Kişi getiren işler' : 'Work that brought people'}><table className="studio-table">
        <thead><tr><th scope="col">{tr ? 'Paylaşım / e-posta' : 'Post / email'}</th><th scope="col">{tr ? 'Kanal' : 'Channel'}</th>{data.stages.map((_, index) => <th scope="col" key={index}>{stage(index)}</th>)}{data.value && <th scope="col">{tr ? 'Tutar' : 'Amount'}</th>}<th scope="col">{tr ? 'Siteye oturum (GA4)' : 'Site sessions (GA4)'}</th></tr></thead>
        <tbody>{data.items.map(item => <tr key={item.tag}><td>{item.title || (tr ? 'Adsız' : 'Untitled')}<small className="attribution-kind">{item.kind === 'content' ? (tr ? 'Paylaşım' : 'Post') : (tr ? 'Kampanya' : 'Campaign')}</small></td>
          <td>{item.sources.map(channel).join(', ') || '—'}</td>{item.counts.map((count, index) => <td key={index}>{n(count)}</td>)}{data.value && <td>{money(item.value)}</td>}<td>{item.sessions === null ? '—' : n(item.sessions)}</td></tr>)}</tbody></table></div>
        : <p className="studio-note">{tr ? `Son ${data.days} günde etiketli bir paylaşım veya e-postadan gelip bir hedef aşamasına ulaşan kişi görülmedi.` : `Nobody who came through a tagged post or email reached a goal stage in the last ${data.days} days.`}</p>}
      {data.channels.length > 0 && <p className="studio-note"><strong>{tr ? 'Kanallara göre: ' : 'By channel: '}</strong>{data.channels.map(item => `${channel(item.source)} — ${summary(item.counts)}${item.value !== null && data.value ? ` · ${money(item.value)}` : ''}`).join('; ')}</p>}
      {data.other.length > 0 && <p className="studio-note"><strong>{tr ? 'Ryzevo dışı kampanyalar: ' : 'Campaigns outside Ryzevo: '}</strong>{data.other.map(item => `${item.campaign}${item.source ? ` (${item.source})` : ''} — ${summary(item.counts)}`).join('; ')}</p>}
      {data.unmatched.some(count => count > 0) && <p className="studio-note">{tr ? `Silinmiş veya bu projeye ait olmayan Ryzevo etiketleriyle gelenler: ${summary(data.unmatched)}.` : `People with Ryzevo tags that are deleted or not in this project: ${summary(data.unmatched)}.`}</p>}
      <p className="studio-note">{tr
        ? `Kişi, ilk geldiği etiketli bağlantıya göre sayılır (ilk temas, ${data.windowDays} gün içinde). Aynı kişi birden çok aşamada görünebilir; bir aşamada yalnız bir kez sayılır.${data.site.from && data.site.to ? ` Oturumlar Google Analytics’in ${day(data.site.from)}–${day(data.site.to)} dönemidir.` : ''} Bu bir gözlemdir, neden-sonuç kanıtı değildir.`
        : `People are counted by the tagged link they first came through (first touch, within ${data.windowDays} days). One person can appear in several stages but is counted once per stage.${data.site.from && data.site.to ? ` Sessions are Google Analytics’ ${day(data.site.from)}–${day(data.site.to)} period.` : ''} This is an observation, not proof of cause.`}</p>
    </>}
  </section>;
}
