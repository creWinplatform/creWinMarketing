'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCheck, ExternalLink, Loader2, Plus, Radar, Save, Trash2 } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { WebMention, WebWatch } from '@/lib/platform/web-mentions';
import Msg from '@/components/Msg';

type View = { watch: WebWatch; mentions: WebMention[] };
// Campaigns → Web mentions: what news sites and the team's feeds say about the brand, complaints first.
export default function WebMentionsPanel({ lang }: { lang: Locale }) {
  const tr = lang === 'tr', locale = localeTag(lang);
  const [data, setData] = useState<View | null>(null), [form, setForm] = useState<{ enabled: boolean; queries: string[]; feeds: string[]; language: 'tr' | 'en' } | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [filter, setFilter] = useState<'new' | 'all'>('new');
  const apply = (value: View) => { setData(value); setForm({ enabled: value.watch.enabled, queries: value.watch.queries.length ? value.watch.queries : [''], feeds: value.watch.feeds, language: value.watch.language }); };
  const load = useCallback(async () => { try { apply(await projectRequest<View>('/api/platform/web-mentions')); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Web takibi yüklenemedi.'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const post = async (key: string, body: object, message: string) => {
    if (busy) return; setBusy(key); setError(''); setNotice('');
    try { apply(await projectRequest<View>('/api/platform/web-mentions', { method: 'POST', body: JSON.stringify(body) })); setNotice(message); } catch (reason) { setError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.'); } finally { setBusy(''); }
  };
  const save = (event: FormEvent) => { event.preventDefault(); if (form) void post('save', { action: 'save', ...form, queries: form.queries.filter(item => item.trim()), feeds: form.feeds.filter(item => item.trim()) }, form.enabled ? (tr ? 'Web takibi kaydedildi; ilk okuma birkaç dakika içinde yapılır, sonra 3 saatte bir.' : 'Web mentions saved; the first read happens within minutes, then every 3 hours.') : (tr ? 'Web takibi kapatıldı.' : 'Web mentions turned off.')); };
  if (!data || !form) return error ? <p className="studio-error" role="alert"><Msg text={error} /></p> : <div className="studio-skeleton" role="status">{tr ? 'Web takibi yükleniyor…' : 'Loading web mentions…'}</div>;
  const canEdit = data.watch.canEdit, rank = (item: WebMention) => item.level === 'urgent' ? 0 : item.level === 'complaint' ? 1 : 2;
  const shown = data.mentions.filter(item => filter === 'all' || item.state === 'new').sort((a, b) => rank(a) - rank(b) || b.firstSeenAt.localeCompare(a.firstSeenAt));
  const when = (value: string | null) => value ? new Date(value).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const list = (key: 'queries' | 'feeds', label: string, max: number, placeholder: string, hint: string) => <fieldset className="web-watch-list"><legend>{label}</legend><small className="studio-note">{hint}</small>
    {form[key].map((value, index) => <div key={index} className="web-watch-row"><input value={value} maxLength={key === 'queries' ? 80 : 500} placeholder={placeholder} disabled={!canEdit} aria-label={`${label} ${index + 1}`} inputMode={key === 'feeds' ? 'url' : undefined} onChange={event => setForm({ ...form, [key]: form[key].map((item, i) => i === index ? event.target.value : item) })} />
      {canEdit && <button type="button" className="icon-button" aria-label={tr ? 'Kaldır' : 'Remove'} onClick={() => setForm({ ...form, [key]: form[key].filter((_, i) => i !== index) })}><Trash2 size={16} /></button>}</div>)}
    {canEdit && form[key].length < max && <button type="button" className="studio-secondary" onClick={() => setForm({ ...form, [key]: [...form[key], ''] })}><Plus size={15} />{tr ? 'Ekle' : 'Add'}</button>}
  </fieldset>;
  return (
    <section className="web-mentions" aria-labelledby="web-mentions-title">
      <div className="studio-section-title"><h2 id="web-mentions-title"><Radar size={16} aria-hidden="true" />{tr ? 'Web’de bahsedilenler' : 'Web mentions'}</h2>
        <p className="studio-note">{tr ? 'Google Haberler’de markanızla ilgili haberler ve eklediğiniz beslemeler (ör. Google Alerts) 3 saatte bir okunur. Şikâyet ve hukuki ifade içerenler öne çıkar ve “Dikkat gerekenler”e düşer. Kişisel sosyal hesaplar ve X burada yok; kendi hesaplarınızın yorumları Gelen kutusunda.' : 'News about your brand on Google News and the feeds you add (e.g. Google Alerts) are read every 3 hours. Complaints and legal wording come first and appear in “Needs attention”. Personal social accounts and X are not covered; comments on your own accounts are in the Inbox.'}</p></div>
      <form className="web-watch-form" onSubmit={save}>
        <label className="design-toggle"><input type="checkbox" checked={form.enabled} disabled={!canEdit} onChange={event => setForm({ ...form, enabled: event.target.checked })} />{tr ? 'Web takibi açık' : 'Web mentions on'}</label>
        {list('queries', tr ? 'Arama ifadeleri (en çok 3)' : 'Search terms (up to 3)', 3, tr ? 'Ör. marka adınız' : 'E.g. your brand name', tr ? 'Tam ifade olarak aranır (tırnak içinde).' : 'Searched as an exact phrase (in quotes).')}
        {list('feeds', tr ? 'RSS / Atom beslemeleri (en çok 5)' : 'RSS / Atom feeds (up to 5)', 5, 'https://www.google.com/alerts/feeds/…', tr ? 'Google Alerts’te uyarı oluştururken “Teslim yeri: RSS beslemesi” seçin ve adresi buraya yapıştırın.' : 'When creating a Google Alert, choose “Deliver to: RSS feed” and paste the address here.')}
        <label className="design-select">{tr ? 'Haber dili ve ülkesi' : 'News language and country'}<select value={form.language} disabled={!canEdit} onChange={event => setForm({ ...form, language: event.target.value as 'tr' | 'en' })}><option value="tr">Türkçe · Türkiye</option><option value="en">English · US</option></select></label>
        {canEdit && <div className="design-actions design-actions-top"><button className="studio-primary" disabled={Boolean(busy)}>{busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{tr ? 'Kaydet' : 'Save'}</button>
          {data.watch.checkedAt && <span className="studio-note">{tr ? 'Son okuma' : 'Last read'}: {when(data.watch.checkedAt)}{data.watch.lastError ? (tr ? ' · bazı kaynaklar okunamadı' : ' · some sources could not be read') : ''}</span>}</div>}
      </form>
      {error && <p className="studio-error" role="alert"><Msg text={error} /></p>}
      {notice && <p className="studio-success" role="status">{notice}</p>}
      <div className="publication-view-tabs" role="tablist" aria-label={tr ? 'Gösterilecekler' : 'Show'}>
        <button role="tab" aria-selected={filter === 'new'} onClick={() => setFilter('new')}>{tr ? 'Yeni' : 'New'} ({data.mentions.filter(item => item.state === 'new').length})</button>
        <button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>{tr ? 'Tümü' : 'All'} ({data.mentions.length})</button>
      </div>
      {canEdit && filter === 'new' && shown.length > 0 && <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void post('seen', { action: 'seen', ids: shown.map(item => item.id) }, tr ? 'Hepsi görüldü olarak işaretlendi.' : 'All marked as seen.')}><CheckCheck size={15} />{tr ? 'Hepsini görüldü işaretle' : 'Mark all as seen'}</button>}
      {shown.length ? <ul className="web-mention-list">{shown.map(item => <li key={item.id} className="web-mention">
        {item.level !== 'none' && <span className={`inbox-signal inbox-signal-${item.level}`}>{item.level === 'urgent' ? (tr ? 'Acil: hukuki veya dolandırıcılık ifadesi' : 'Urgent: legal or fraud wording') : (tr ? 'Olumsuz' : 'Negative')}</span>}
        <a href={item.url} target="_blank" rel="noreferrer noopener" className="web-mention-title">{item.title}<ExternalLink size={13} aria-hidden="true" /></a>
        {item.snippet && <p className="studio-note">{item.snippet}</p>}
        <p className="coach-muted">{item.source} · {when(item.publishedAt || item.firstSeenAt)}{item.state === 'seen' ? (tr ? ' · görüldü' : ' · seen') : ''}</p>
      </li>)}</ul> : <p className="studio-note">{data.watch.enabled ? (tr ? 'Şimdilik yeni bir şey yok.' : 'Nothing new for now.') : (tr ? 'Takibi açıp kaydedin; bulunanlar burada listelenir.' : 'Turn on and save; what is found is listed here.')}</p>}
    </section>
  );
}
