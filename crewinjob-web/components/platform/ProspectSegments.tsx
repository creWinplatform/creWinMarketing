'use client';
import { useState, type FormEvent } from 'react';
import { Check, Loader2, Pause, Pencil, Play, Plus, Search, Sparkles, Trash2, Users } from 'lucide-react';
import { SIGNALS, SIGNAL_KEYS, type SignalKey } from '@/lib/platform/prospect-finder-types';
import { SEGMENT_ADVICE, SEGMENT_LIMITS, type SegmentView, type SegmentsSnapshot } from '@/lib/platform/prospect-segments-types';

export type SegmentsPost = <T>(key: string, body: Record<string, unknown>, message?: string) => Promise<T | null>;
type Form = { id: string; name: string; reason: string; keyword: string; fit: string; signals: SignalKey[] };
const empty: Form = { id: '', name: '', reason: '', keyword: '', fit: '60', signals: [] };

// Who to sell to: a few concrete customer groups, each with a search for Find companies and its own results, so the
// team grows what works and stops what does not.
export function SegmentsPanel({ tr, data, busy, post, onSearch }: { tr: boolean; data: SegmentsSnapshot; busy: string; post: SegmentsPost; onSearch: (segment: SegmentView) => void }) {
  const t = (a: string, b: string) => tr ? a : b, idx = tr ? 0 : 1;
  const [form, setForm] = useState<Form | null>(null);
  const basis = [data.basis.profile ? t('müşteri profili', 'customer profile') : '', data.basis.competitors ? t(`${data.basis.competitors} rakip`, `${data.basis.competitors} competitor(s)`) : '', data.basis.approved ? t(`${data.basis.approved} onaylı firma`, `${data.basis.approved} approved companies`) : '', data.basis.won ? t(`${data.basis.won} kazanılan`, `${data.basis.won} won`) : ''].filter(Boolean);
  const canSuggest = data.canWrite && data.suggestionsLeft > 0 && (data.aiConfigured ? basis.length > 0 : data.basis.approved > 0);
  const submit = (event: FormEvent) => { event.preventDefault(); if (!form) return;
    void post('segment-save', { action: 'save', id: form.id || undefined, name: form.name, reason: form.reason, keyword: form.keyword, fit: Number(form.fit), signals: form.signals }, form.id ? t('Grup güncellendi.', 'Group updated.') : t('Grup eklendi. Şimdi bu grupta firma arayın.', 'Group added. Now search for companies in it.')).then(value => { if (value) setForm(null); }); };
  const editor = form && <form className="prospect-form segment-form" onSubmit={submit}>
    <div className="prospect-form-row"><label>{t('Grup adı', 'Group name')}<input required minLength={3} maxLength={SEGMENT_LIMITS.name} value={form.name} placeholder={t('Ör. Online randevusu olmayan diş klinikleri', 'E.g. Dental clinics without online booking')} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label>{t('Firma bul’da aranacak sektör', 'Sector to search in Find companies')}<input required minLength={2} maxLength={SEGMENT_LIMITS.keyword} value={form.keyword} placeholder={t('Ör. diş kliniği', 'E.g. dental clinic')} onChange={event => setForm({ ...form, keyword: event.target.value })} /></label></div>
    <label>{t('Neden bu grup? (isteğe bağlı)', 'Why this group? (optional)')}<input maxLength={SEGMENT_LIMITS.reason} value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} /></label>
    <div className="prospect-form-row"><label>{t('Tahmini uyum (0–100)', 'Estimated fit (0–100)')}<input type="number" min={0} max={100} value={form.fit} onChange={event => setForm({ ...form, fit: event.target.value })} /></label>
      <fieldset className="segment-signals"><legend>{t(`Fırsat sinyalleri (en çok ${SEGMENT_LIMITS.signals})`, `Opportunity signals (up to ${SEGMENT_LIMITS.signals})`)}</legend>
        <div className="sales-inline">{SIGNAL_KEYS.map(key => <label key={key} className="design-toggle"><input type="checkbox" checked={form.signals.includes(key)} disabled={!form.signals.includes(key) && form.signals.length >= SEGMENT_LIMITS.signals} onChange={event => setForm({ ...form, signals: event.target.checked ? [...form.signals, key] : form.signals.filter(item => item !== key) })} />{SIGNALS[key].label[idx]}</label>)}</div></fieldset></div>
    <div className="coach-action-buttons"><button type="submit" className="studio-secondary" disabled={Boolean(busy)}><Check size={14} />{t('Kaydet', 'Save')}</button><button type="button" className="studio-text-button" onClick={() => setForm(null)}>{t('Vazgeç', 'Cancel')}</button></div>
  </form>;
  return <section className="studio-band segments-panel" aria-labelledby="segments-title">
    <div className="finder-head"><h2 id="segments-title"><Users size={16} aria-hidden="true" />{t('Kime satıyorsunuz?', 'Who do you sell to?')}</h2>
      {data.canWrite && <div className="coach-action-buttons">
        <button type="button" className="studio-secondary" disabled={Boolean(busy) || !canSuggest} title={!canSuggest ? (data.suggestionsLeft < 1 ? t('Bugünkü öneri hakkı doldu.', 'No suggestions left today.') : t('Öneri için Büyüme koçunda müşteri profilinizi oluşturun veya birkaç firmayı onaylayın.', 'Build your customer profile in the Growth coach or approve a few companies first.')) : undefined}
          onClick={() => void post('segment-suggest', { action: 'suggest', mode: data.aiConfigured ? undefined : 'template' }, t('Müşteri grupları önerildi. Okuyun; size uymayanı silin, uyanla firma arayın.', 'Customer groups suggested. Read them; delete what does not fit and search with the ones that do.'))}>
          {busy === 'segment-suggest' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{data.aiConfigured ? t('AI ile grup öner', 'Suggest groups with AI') : t('Onaylı firmalardan öner', 'Suggest from approved companies')}</button>
        {!form && data.segments.length < SEGMENT_LIMITS.max && <button type="button" className="studio-text-button" onClick={() => setForm({ ...empty })}><Plus size={14} />{t('Grup ekle', 'Add a group')}</button>}
      </div>}</div>
    <p className="coach-muted">{t('Satışa birkaç somut müşteri grubuyla başlayın (ör. “online randevusu olmayan diş klinikleri”). Her grup için firma arayın; e-postalar, yanıtlar ve görüşmeler gruba göre sayılır ve hangi grubun işe yaradığını görürsünüz.', 'Start selling with a few concrete customer groups (e.g. “dental clinics without online booking”). Search for companies in each group; emails, replies and meetings are counted per group, so you see which one works.')}
      {basis.length > 0 && <> {t('Öneriler şunlara dayanır', 'Suggestions rest on')}: {basis.join(' · ')}.</>}</p>
    {form && !form.id && editor}
    {data.segments.length === 0 && !form ? <p className="studio-empty">{t('Henüz müşteri grubu yok.', 'No customer groups yet.')}</p>
      : <ul className="segment-list">{data.segments.map(segment => { const advice = SEGMENT_ADVICE[segment.advice];
        return <li key={segment.id} className={`segment-card ${segment.state === 'paused' ? 'is-paused' : ''}`}>
          <div className="segment-top"><div><h3>{segment.name}</h3>
            <p className="coach-muted"><span className="segment-fit" title={t('AI veya ekibin tahmini; gerçek sonuç aşağıdaki sayılardır.', 'An estimate by AI or the team; the real result is in the figures below.')}>{t(`Tahmini uyum %${segment.fit}`, `Estimated fit ${segment.fit}%`)}</span> · {t('Arama', 'Search')}: “{segment.keyword}”{segment.source === 'ai' ? t(' · AI önerisi', ' · AI suggestion') : ''}{segment.state === 'paused' ? t(' · duraklatıldı', ' · paused') : ''}</p></div>
            <span className={`sales-badge ${segment.advice === 'scale' ? 'is-ok' : segment.advice === 'pause' ? 'is-warn' : ''}`}>{advice.label[idx]}</span></div>
          {segment.reason && <p>{segment.reason}</p>}
          {segment.signals.length > 0 && <p className="segment-signals-list">{segment.signals.map(key => <span key={key} className="finder-chip">{SIGNALS[key].label[idx]}</span>)}</p>}
          <p className="segment-stats">{t(`${segment.prospects} firma · ${segment.approved} onaylı · ${segment.sends} temas · ${segment.replies} yanıt · ${segment.interested} ilgili · ${segment.meetings} görüşme · ${segment.won} kazanıldı`, `${segment.prospects} companies · ${segment.approved} approved · ${segment.sends} touches · ${segment.replies} replies · ${segment.interested} interested · ${segment.meetings} meetings · ${segment.won} won`)}</p>
          <p className="coach-muted">{advice.text[idx]}</p>
          {form?.id === segment.id ? editor : data.canWrite && <div className="coach-action-buttons">
            {segment.state === 'active' && <button type="button" className="studio-secondary" onClick={() => onSearch(segment)}><Search size={14} />{t('Bu grupta firma ara', 'Find companies in this group')}</button>}
            <button type="button" className="studio-text-button" onClick={() => setForm({ id: segment.id, name: segment.name, reason: segment.reason, keyword: segment.keyword, fit: String(segment.fit), signals: [...segment.signals] })}><Pencil size={14} />{t('Düzenle', 'Edit')}</button>
            <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void post(`segment-state-${segment.id}`, { action: 'state', id: segment.id, state: segment.state === 'active' ? 'paused' : 'active' })}>{segment.state === 'active' ? <><Pause size={14} />{t('Duraklat', 'Pause')}</> : <><Play size={14} />{t('Devam et', 'Resume')}</>}</button>
            <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t('Grup silinsin mi? Firmalar listede kalır.', 'Delete this group? Its companies stay on the list.'))) void post(`segment-remove-${segment.id}`, { action: 'remove', id: segment.id }); }}><Trash2 size={14} />{t('Sil', 'Delete')}</button>
          </div>}
        </li>; })}</ul>}
  </section>;
}

// The group of one company on its card: shown, and changeable by hand (for example for a company from a list).
export function SegmentChip({ tr, prospectId, segments, current, canWrite, busy, post }: { tr: boolean; prospectId: string; segments: SegmentView[]; current: string | null; canWrite: boolean; busy: string; post: SegmentsPost }) {
  const t = (a: string, b: string) => tr ? a : b;
  if (!segments.length) return null;
  return <label className="segment-chip">{t('Müşteri grubu', 'Customer group')}
    <select value={current || ''} disabled={!canWrite || Boolean(busy)} onChange={event => void post(`segment-assign-${prospectId}`, { action: 'assign', prospectId, segmentId: event.target.value || null })}>
      <option value="">{t('Grup yok', 'No group')}</option>{segments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</select></label>;
}
