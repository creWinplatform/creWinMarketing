'use client';
import { useEffect, useState } from 'react';
import { CalendarClock, Check, Copy, FileText, Link2, Loader2, Sparkles, X } from 'lucide-react';
import { projectRequest } from '@/lib/platform/client';
import Msg from '@/components/Msg';
import { BOOKING_LIMITS, PROPOSAL_LIMITS, type BookingSettings, type BookingSnapshot, type ProposalContent, type ProposalView } from '@/lib/platform/prospect-workflow-types';

const copyText = async (value: string) => { try { await navigator.clipboard.writeText(value); return true; } catch { return false; } };
const DAYS: [number, string, string][] = [[1, 'Pzt', 'Mon'], [2, 'Sal', 'Tue'], [3, 'Çar', 'Wed'], [4, 'Per', 'Thu'], [5, 'Cum', 'Fri'], [6, 'Cmt', 'Sat'], [0, 'Paz', 'Sun']];
const post = async <T,>(body: Record<string, unknown>) => await projectRequest<T>('/api/platform/prospects/workflow', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(65000) });

// The team's own booking page: when, how long, and the upcoming meetings booked through it.
export function BookingPanel({ tr }: { tr: boolean }) {
  const t = (a: string, b: string) => tr ? a : b, locale = tr ? 'tr-TR' : 'en-GB';
  const [data, setData] = useState<BookingSnapshot | null>(null), [form, setForm] = useState<BookingSettings | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [copied, setCopied] = useState(false);
  useEffect(() => { projectRequest<BookingSnapshot>('/api/platform/prospects/workflow').then(value => { setData(value); setForm(value.settings); }).catch(() => setData(null)); }, []);
  if (!data || !form) return null;
  const run = async (body: Record<string, unknown>, message: string) => { if (busy) return; setBusy(true); setError(''); setNotice(''); try { const value = await post<BookingSnapshot>(body); setData(value); setForm(value.settings); setNotice(message); } catch (reason) { setError(reason instanceof Error ? reason.message : t('İstek tamamlanamadı.', 'Request failed.')); } finally { setBusy(false); } };
  return <details className="studio-band sales-setup">
    <summary><CalendarClock size={15} aria-hidden="true" /><strong>{t('Randevu sayfası', 'Booking page')}</strong><span className={data.settings.enabled ? 'sales-badge is-ok' : 'sales-badge'}>{data.settings.enabled ? t('Açık', 'On') : t('Kapalı', 'Off')}</span></summary>
    <div className="sales-setup-body">
      <p className="coach-muted">{t('Calendly gerekmeden kendi randevu sayfanız. Açıkken satış e-postalarında ve tekliflerde “Görüşme planla” bağlantısı olarak kullanılır; alınan randevu Takvim’e iş olarak düşer ve firma huni içinde “Görüşme” aşamasına geçer.', 'Your own booking page, no Calendly needed. When on, it is the “Book a meeting” link in sales emails and proposals; each booking becomes a Calendar task and moves the company to “Meeting”.')}</p>
      {error && <p className="studio-error" role="alert"><Msg text={error} /></p>}{notice && <p className="coach-note" role="status">{notice}</p>}
      {data.link && <div className="prospect-link-box"><input readOnly value={data.link} aria-label={t('Randevu sayfası bağlantısı', 'Booking page link')} onFocus={event => event.target.select()} />
        <button type="button" className="studio-secondary" onClick={() => void copyText(data.link!).then(ok => { setCopied(ok); setTimeout(() => setCopied(false), 1800); })}>{copied ? <Check size={14} /> : <Copy size={14} />}{t('Kopyala', 'Copy')}</button>
        <a className="studio-text-button" href={data.link} target="_blank" rel="noreferrer">{t('Aç', 'Open')}</a></div>}
      {data.canManage ? <form className="prospect-form" onSubmit={event => { event.preventDefault(); void run({ action: 'booking-settings', ...form }, t('Randevu sayfası kaydedildi.', 'Booking page saved.')); }}>
        <label className="design-toggle"><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} />{t('Randevu sayfası açık', 'Booking page on')}</label>
        <div className="prospect-form-row"><label>{t('Görüşme adı', 'Meeting name')}<input maxLength={80} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
          <label>{t('Süre', 'Length')}<select value={form.durationMin} onChange={event => setForm({ ...form, durationMin: Number(event.target.value) })}>{BOOKING_LIMITS.durations.map(value => <option key={value} value={value}>{t(`${value} dakika`, `${value} minutes`)}</option>)}</select></label></div>
        <fieldset className="booking-weekdays"><legend>{t('Günler', 'Days')}</legend>{DAYS.map(([day, a, b]) => <label key={day} className="design-toggle"><input type="checkbox" checked={form.weekdays.includes(day)} onChange={event => setForm({ ...form, weekdays: event.target.checked ? [...form.weekdays, day] : form.weekdays.filter(item => item !== day) })} />{tr ? a : b}</label>)}</fieldset>
        <div className="prospect-form-row"><label>{t('Başlangıç saati', 'From')}<input type="number" min={6} max={22} value={form.startHour} onChange={event => setForm({ ...form, startHour: Number(event.target.value) })} /></label>
          <label>{t('Bitiş saati', 'Until')}<input type="number" min={7} max={23} value={form.endHour} onChange={event => setForm({ ...form, endHour: Number(event.target.value) })} /></label></div>
        <div className="prospect-form-row"><label>{t('En az kaç saat önceden', 'At least hours ahead')}<input type="number" min={1} max={168} value={form.noticeHours} onChange={event => setForm({ ...form, noticeHours: Number(event.target.value) })} /></label>
          <label>{t('Kaç gün ileriye', 'Days ahead')}<input type="number" min={3} max={60} value={form.horizonDays} onChange={event => setForm({ ...form, horizonDays: Number(event.target.value) })} /></label></div>
        <div className="coach-action-buttons"><button type="submit" className="studio-secondary" disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{t('Kaydet', 'Save')}</button></div>
      </form> : <p className="coach-muted">{t('Randevu sayfasını onay yetkisi olan ekip üyeleri ayarlar.', 'Teammates with approval rights set up the booking page.')}</p>}
      {data.upcoming.length > 0 && <ul className="sources-visitors">{data.upcoming.map(item => <li key={item.id} className={item.state === 'cancelled' ? 'is-cancelled' : ''}><div><strong>{new Date(item.startsAt).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong> · {item.name}{item.company ? ` · ${item.company}` : ''}<br /><span className="coach-muted prospect-contact-value">{item.email}</span>{item.note && <><br /><span className="coach-muted">{item.note}</span></>}</div>
        {item.state === 'cancelled' ? <span className="coach-muted">{t('İptal edildi', 'Cancelled')}</span> : data.canWrite && <button type="button" className="studio-text-button" disabled={busy} onClick={() => { if (window.confirm(t('Bu randevu iptal edilsin mi? Kişiye siz haber vermelisiniz.', 'Cancel this booking? You need to tell the person yourself.'))) void run({ action: 'booking-cancel', id: item.id }, t('Randevu iptal edildi.', 'Booking cancelled.')); }}><X size={14} />{t('İptal et', 'Cancel')}</button>}</li>)}</ul>}
    </div>
  </details>;
}

const empty: ProposalContent = { title: '', summary: '', needs: [], solution: '', scope: [], successMetrics: [], timeline: '', price: '', nextStep: '' };
// A proposal for one company: drafted with AI or the template, edited, then shared through a link.
export function ProposalBlock({ tr, id, canWrite, aiConfigured }: { tr: boolean; id: string; canWrite: boolean; aiConfigured: boolean }) {
  const t = (a: string, b: string) => tr ? a : b;
  const [open, setOpen] = useState(false), [data, setData] = useState<ProposalView | null | undefined>(undefined), [form, setForm] = useState<ProposalContent>(empty), [price, setPrice] = useState(''), [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [link, setLink] = useState(''), [copied, setCopied] = useState(false);
  const apply = (value: ProposalView | null) => { setData(value); if (value) { setForm({ ...value.content, successMetrics: value.content.successMetrics || [] }); setPrice(value.content.price); } };
  useEffect(() => { if (open && data === undefined) post<{ proposal: ProposalView | null }>({ action: 'proposal', id }).then(value => apply(value.proposal)).catch(() => setData(null)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (key: string, body: Record<string, unknown>) => { if (busy) return null; setBusy(key); setError(''); try { const value = await post<{ proposal: ProposalView | null; url?: string }>(body); apply(value.proposal); return value; } catch (reason) { setError(reason instanceof Error ? reason.message : t('İstek tamamlanamadı.', 'Request failed.')); return null; } finally { setBusy(''); } };
  const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean).slice(0, PROPOSAL_LIMITS.items);
  const dirty = Boolean(data && JSON.stringify({ ...data.content }) !== JSON.stringify({ ...form, price }));
  return <details className="sales-section sales-channels" open={open} onToggle={event => setOpen((event.target as HTMLDetailsElement).open)}>
    <summary><FileText size={14} aria-hidden="true" />{t('Teklif', 'Proposal')}{data?.shared?.active && <span className="coach-muted"> · {t(`paylaşıldı, ${data.shared.views} görüntülenme`, `shared, ${data.shared.views} views`)}</span>}</summary>
    {error && <p className="studio-error" role="alert"><Msg text={error} /></p>}
    {data === undefined ? <p className="coach-muted">{t('Yükleniyor…', 'Loading…')}</p> : !data ? (canWrite ? <div className="prospect-form">
      <label>{t('Görüşme notları (isteğe bağlı, AI için)', 'Meeting notes (optional, for the AI)')}<textarea rows={2} maxLength={600} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <label>{t('Fiyat (yalnız siz yazarsınız)', 'Price (only you write it)')}<input maxLength={PROPOSAL_LIMITS.price} value={price} onChange={event => setPrice(event.target.value)} /></label>
      <div className="coach-action-buttons">{aiConfigured && <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void run('ai', { action: 'proposal-draft', id, price, notes })}>{busy === 'ai' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{t('AI ile taslak', 'Draft with AI')}</button>}
        <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void run('template', { action: 'proposal-draft', id, price, mode: 'template' })}>{t('Şablonla başla', 'Start from a template')}</button></div></div>
      : <p className="coach-muted">{t('Henüz teklif yok.', 'No proposal yet.')}</p>)
    : <div className="prospect-form">
      <label>{t('Başlık', 'Title')}<input maxLength={PROPOSAL_LIMITS.title} value={form.title} disabled={!canWrite} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
      <label>{t('Özet', 'Summary')}<textarea rows={3} value={form.summary} disabled={!canWrite} onChange={event => setForm({ ...form, summary: event.target.value })} /></label>
      <label>{t('İhtiyaçlar (her satıra bir madde)', 'Needs (one per line)')}<textarea rows={3} value={form.needs.join('\n')} disabled={!canWrite} onChange={event => setForm({ ...form, needs: lines(event.target.value) })} /></label>
      <label>{t('Önerimiz', 'Our proposal')}<textarea rows={4} value={form.solution} disabled={!canWrite} onChange={event => setForm({ ...form, solution: event.target.value })} /></label>
      <label>{t('Kapsam (her satıra bir madde)', 'Scope (one per line)')}<textarea rows={3} value={form.scope.join('\n')} disabled={!canWrite} onChange={event => setForm({ ...form, scope: lines(event.target.value) })} /></label>
      <label>{t('Başarı ölçütleri (müşteriyle önceden anlaşın; her satıra bir tane)', 'Success metrics (agree them with the customer first; one per line)')}<textarea rows={2} value={form.successMetrics.join('\n')} disabled={!canWrite} onChange={event => setForm({ ...form, successMetrics: lines(event.target.value) })} /></label>
      <div className="prospect-form-row"><label>{t('Zaman planı', 'Timeline')}<input maxLength={400} value={form.timeline} disabled={!canWrite} onChange={event => setForm({ ...form, timeline: event.target.value })} /></label>
        <label>{t('Fiyat', 'Price')}<input maxLength={PROPOSAL_LIMITS.price} value={price} disabled={!canWrite} onChange={event => setPrice(event.target.value)} /></label></div>
      <label>{t('Sonraki adım', 'Next step')}<input maxLength={400} value={form.nextStep} disabled={!canWrite} onChange={event => setForm({ ...form, nextStep: event.target.value })} /></label>
      {canWrite && <div className="coach-action-buttons">
        {dirty && <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void run('save', { action: 'proposal-save', id, expectedRevision: data.revision, content: { ...form, price } })}><Check size={14} />{t('Kaydet', 'Save')}</button>}
        <button type="button" className="studio-primary" disabled={Boolean(busy) || dirty} title={dirty ? t('Önce kaydedin.', 'Save first.') : undefined} onClick={() => void run('share', { action: 'proposal-share', id }).then(value => { if (value?.url) setLink(value.url); })}>{busy === 'share' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}{data.shared?.active ? t('Yeni bağlantı oluştur', 'Create a new link') : t('Paylaşım bağlantısı oluştur', 'Create a share link')}</button>
        {data.shared?.active && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => { setLink(''); void run('revoke', { action: 'proposal-revoke', id }); }}><X size={14} />{t('Bağlantıyı kapat', 'Turn the link off')}</button>}
      </div>}
      {link && <div className="prospect-link-box"><input readOnly value={link} aria-label={t('Teklif bağlantısı', 'Proposal link')} onFocus={event => event.target.select()} />
        <button type="button" className="studio-secondary" onClick={() => void copyText(link).then(ok => { setCopied(ok); setTimeout(() => setCopied(false), 1800); })}>{copied ? <Check size={14} /> : <Copy size={14} />}{t('Kopyala', 'Copy')}</button>
        <a className="studio-text-button" href={`${link}&preview=1`} target="_blank" rel="noreferrer">{t('Önizle (sayılmaz)', 'Preview (not counted)')}</a>
        <p className="coach-muted">{t('Bağlantı yalnız şimdi gösterilir. Paylaşınca firma huni içinde “Teklif” aşamasına geçer.', 'The link is shown only now. Sharing moves the company to “Proposal” in the pipeline.')}</p></div>}
    </div>}
  </details>;
}
