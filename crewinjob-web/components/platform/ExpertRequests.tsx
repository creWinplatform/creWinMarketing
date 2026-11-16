'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Download, FileText, Handshake, Loader2, Paperclip, RotateCcw, Save, Send, Trash2, UploadCloud, X } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { EXPERT_FILE_MAX_BYTES, EXPERT_FILE_MIMES, EXPERT_MAX_REVISIONS, EXPERT_SERVICES, EXPERT_SERVICE_LABELS, type ExpertFileMime, type ExpertRequestView, type ExpertService, type ExpertsSnapshot, type PartnerCard } from '@/lib/platform/experts-types';
import Msg from '@/components/Msg';

const API = '/api/platform/experts';
const STATES: Record<ExpertRequestView['state'], [string, string]> = {
  sent: ['Uzmanın yanıtı bekleniyor', 'Waiting for the expert'], accepted: ['Kabul edildi · çalışılıyor', 'Accepted · in progress'], declined: ['Reddedildi', 'Declined'],
  delivered: ['Teslim edildi · onay bekliyor', 'Delivered · awaiting review'], revision: ['Düzeltme istendi', 'Changes requested'], approved: ['Onaylandı', 'Approved'], cancelled: ['İptal edildi', 'Cancelled'],
};
const PARTNER_STATES: Partial<Record<ExpertRequestView['state'], [string, string]>> = { sent: ['Yeni talep', 'New request'], delivered: ['Teslim edildi · müşteri inceliyor', 'Delivered · client reviewing'] };
type Brief = { service: ExpertService; partnerId: string; title: string; details: string; deliverables: string; dueDate: string; budgetNote: string; brand: string; contact: string; ack: boolean };
type Profile = { displayName: string; summary: string; services: ExpertService[]; languages: ('tr' | 'en')[]; website: string; contact: string; listed: boolean };
const sha256 = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const fileUrl = (request: string, file: string, download = false) => `${API}/file?request=${encodeURIComponent(request)}&file=${encodeURIComponent(file)}${download ? '&download=1' : ''}`;

// Project → Expert requests. A client sends a listed partner agency a brief and reviews what it delivers; a project
// that bought the agency package manages its partner profile and the work it receives here as well.
export default function ExpertRequests({ lang }: { lang: Locale }) {
  const tr = lang === 'tr', idx = tr ? 0 : 1, locale = localeTag(lang), t = (a: string, b: string) => tr ? a : b;
  const [data, setData] = useState<ExpertsSnapshot | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [brief, setBrief] = useState<Brief | null>(null), [partners, setPartners] = useState<PartnerCard[] | null>(null), [profile, setProfile] = useState<Profile | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({}), [progress, setProgress] = useState('');
  // The section is long on a phone: a refusal is brought into view next to where the person was working.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [error]);
  const take = useCallback((value: ExpertsSnapshot) => {
    setData(value); const p = value.partner?.profile;
    setProfile(p ? { displayName: p.displayName, summary: p.summary, services: p.services, languages: p.languages, website: p.website, contact: p.contact, listed: p.listed } : { displayName: '', summary: '', services: [], languages: [tr ? 'tr' : 'en'], website: 'https://', contact: '', listed: false });
  }, [tr]);
  useEffect(() => { projectRequest<ExpertsSnapshot>(API).then(take).catch(reason => setError(reason instanceof Error ? reason.message : t('Uzman talepleri yüklenemedi.', 'Expert requests could not be loaded.'))); }, [take]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = async <T,>(key: string, body: Record<string, unknown>, message?: string) => {
    if (busy) return null; setBusy(key); setError(''); setNotice('');
    try { const value = await projectRequest<T>(API, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(45000) }); if (message) setNotice(message); return value; }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('İstek tamamlanamadı.', 'Request failed.')); return null; } finally { setBusy(''); }
  };
  const act = async (key: string, body: Record<string, unknown>, message: string) => { const value = await post<ExpertsSnapshot>(key, body, message); if (value) take(value); return Boolean(value); };
  const loadPartners = (service: ExpertService) => { setPartners(null); projectRequest<{ partners: PartnerCard[] }>(`${API}?directory=1&service=${service}`).then(value => { setPartners(value.partners); setBrief(old => old && !value.partners.some(item => item.id === old.partnerId) ? { ...old, partnerId: value.partners[0]?.id || '' } : old); }).catch(() => setPartners([])); };
  const openBrief = async () => {
    const draft = await post<{ brand: string }>('draft', { action: 'brief-draft' }); if (!draft) return;
    const due = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    setBrief({ service: 'design', partnerId: '', title: '', details: '', deliverables: '', dueDate: due, budgetNote: '', brand: draft.brand, contact: '', ack: false }); loadPartners('design');
  };
  const send = (event: FormEvent) => { event.preventDefault(); if (!brief) return; const { ack, ...rest } = brief;
    void act('send', { action: 'create', ...rest, shareAcknowledged: ack }, t('Talep uzmana gönderildi. Kabul ettiğinde iletişim bilgisi burada görünür.', 'The request was sent. Once the expert accepts, their contact details appear here.')).then(ok => { if (ok) setBrief(null); }); };
  const saveProfile = (event: FormEvent) => { event.preventDefault(); if (profile) void act('profile', { action: 'profile', ...profile }, profile.listed ? t('Profil kaydedildi ve uzman listesinde görünüyor.', 'Profile saved and listed.') : t('Profil kaydedildi (listede görünmüyor).', 'Profile saved (not listed).')); };
  // Delivery files go up in parts, then the server checks the whole file.
  const upload = async (request: ExpertRequestView, files: FileList | null) => {
    if (!files?.length || busy) return; setBusy(`upload:${request.id}`); setError(''); setNotice('');
    try {
      for (const [index, file] of [...files].entries()) {
        if (!EXPERT_FILE_MIMES.includes(file.type as ExpertFileMime) || file.size > EXPERT_FILE_MAX_BYTES) throw new Error(t(`${file.name}: en fazla 6 MB PNG, JPEG, WebP veya PDF olmalı.`, `${file.name}: must be a PNG, JPEG, WebP or PDF of at most 6 MB.`));
        const bytes = await file.arrayBuffer();
        const started = await projectRequest<{ fileId: string; parts: number; partBytes: number }>(API, { method: 'POST', body: JSON.stringify({ action: 'start-file', id: request.id, name: file.name, mime: file.type, bytes: bytes.byteLength, sha256: await sha256(bytes) }) });
        for (let part = 0; part < started.parts; part++) {
          setProgress(t(`${index + 1}/${files.length}: ${file.name} · %${Math.round((part / started.parts) * 100)}`, `${index + 1}/${files.length}: ${file.name} · ${Math.round((part / started.parts) * 100)}%`));
          const slice = bytes.slice(part * started.partBytes, Math.min(bytes.byteLength, (part + 1) * started.partBytes));
          let sent = false;
          for (let attempt = 0; attempt < 3 && !sent; attempt++) { const response = await fetch(`${API}/file?file=${started.fileId}&part=${part}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: slice, cache: 'no-store' }).catch(() => null); sent = Boolean(response?.ok); }
          if (!sent) throw new Error(t(`${file.name} yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.`, `${file.name} could not be uploaded. Check your connection and try again.`));
        }
        take(await projectRequest<ExpertsSnapshot>(API, { method: 'POST', body: JSON.stringify({ action: 'finish-file', id: request.id, fileId: started.fileId }) }));
      }
      setNotice(t('Dosyalar eklendi. Hazır olduğunuzda “Teslim et” deyin; müşteri ancak o zaman görür.', 'Files added. Choose “Deliver” when ready; the client sees them only then.'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('Dosya yüklenemedi.', 'The file could not be uploaded.')); }
    finally { setBusy(''); setProgress(''); }
  };
  const when = (value: string | null) => value ? new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const files = (item: ExpertRequestView, removable: boolean) => item.files.length > 0 && <ul className="expert-files">{item.files.map(file => <li key={file.id}>
    {file.mime === 'application/pdf' ? <span className="expert-file-icon"><FileText size={22} aria-hidden="true" /></span> : <a href={fileUrl(item.id, file.id)} target="_blank" rel="noreferrer"><img src={fileUrl(item.id, file.id)} alt={file.name} loading="lazy" /></a>}
    <span className="expert-file-name">{file.name}<small>{file.bytes < 1048576 ? `${Math.max(1, Math.round(file.bytes / 1024))} KB` : `${(file.bytes / 1048576).toFixed(1)} MB`} · {t('tur', 'round')} {file.round}{file.submitted ? '' : t(' · teslim edilmedi', ' · not delivered yet')}</small></span>
    <a className="studio-text-button" href={fileUrl(item.id, file.id, true)} aria-label={t(`${file.name} indir`, `Download ${file.name}`)}><Download size={15} /></a>
    {removable && !file.submitted && <button type="button" className="studio-text-button" aria-label={t(`${file.name} kaldır`, `Remove ${file.name}`)} disabled={Boolean(busy)} onClick={() => void act(`remove:${file.id}`, { action: 'remove-file', id: item.id, fileId: file.id }, t('Dosya kaldırıldı.', 'File removed.'))}><Trash2 size={15} /></button>}
  </li>)}</ul>;
  const history = (item: ExpertRequestView) => item.notes.length > 0 && <ol className="expert-notes">{item.notes.map((note, index) => <li key={index}><strong>{note.by === 'client' ? t('Müşteri', 'Client') : t('Uzman', 'Expert')} · {{ decline: t('ret nedeni', 'reason for declining'), revision: t('düzeltme isteği', 'change request'), delivery: t('teslim notu', 'delivery note'), cancel: t('iptal', 'cancelled') }[note.kind]}</strong> · {when(note.at)}{note.text ? <p>{note.text}</p> : null}</li>)}</ol>;
  const briefView = (item: ExpertRequestView) => <details className="expert-brief"><summary>{t('Brif', 'Brief')}</summary>
    <dl><dt>{t('İş tanımı', 'Description')}</dt><dd>{item.brief.details}</dd><dt>{t('Teslim edilecekler', 'Deliverables')}</dt><dd>{item.brief.deliverables}</dd>
      {item.brief.budgetNote && <><dt>{t('Bütçe notu', 'Budget note')}</dt><dd>{item.brief.budgetNote}</dd></>}
      {item.brief.brand && <><dt>{t('Marka bilgisi', 'Brand information')}</dt><dd>{item.brief.brand}</dd></>}
      <dt>{t('Site', 'Website')}</dt><dd>{item.brief.website}</dd><dt>{t('Müşteri iletişimi', 'Client contact')}</dt><dd>{item.brief.contact}</dd></dl></details>;

  if (!data) return <section className="expert-requests">{error ? <p className="studio-error" role="alert"><Msg text={error} /></p> : <div className="studio-skeleton" role="status">{t('Uzman talepleri yükleniyor…', 'Loading expert requests…')}</div>}</section>;
  const client = data.client, partner = data.partner;
  return <section className="expert-requests" aria-labelledby="expert-title">
    <div className="studio-section-title"><h2 id="expert-title"><Handshake size={16} aria-hidden="true" />{t('Uzman iste', 'Ask an expert')}</h2>
      <p className="studio-note">{t('Çekim, kurgu, reklam yönetimi gibi uzman eli gereken işler için listelenen ajanslara brif gönderin; teslimleri buradan inceleyip onaylayın. Ücret ve ödeme uzmanla aranızda kararlaştırılır, Ryzevo aracılık etmez ve ücret almaz.', 'Send a brief to a listed agency for work that needs an expert (shoots, editing, ad management) and review the deliveries here. Price and payment are agreed with the expert; Ryzevo does not mediate or charge.')}</p></div>
    {error && <p ref={errorRef} className="studio-error" role="alert"><Msg text={error} /></p>}
    {notice && <p className="studio-success" role="status">{notice}</p>}
    {progress && <p className="studio-note" role="status"><Loader2 size={14} className="animate-spin" /> {progress}</p>}

    {client && <>
      {client.canRequest && !brief && <div className="design-actions"><button type="button" className="studio-primary" disabled={Boolean(busy)} onClick={() => void openBrief()}>{busy === 'draft' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{t('Yeni talep', 'New request')}</button></div>}
      {brief && <form className="expert-form" onSubmit={send}>
        <h3>{t('Yeni uzman talebi', 'New expert request')}</h3>
        <label className="design-select">{t('Hizmet', 'Service')}<select value={brief.service} onChange={event => { const service = event.target.value as ExpertService; setBrief({ ...brief, service }); loadPartners(service); }}>{EXPERT_SERVICES.map(item => <option key={item} value={item}>{EXPERT_SERVICE_LABELS[item][idx]}</option>)}</select></label>
        <fieldset className="expert-partners"><legend>{t('Uzman', 'Expert')}</legend>
          {partners === null ? <p className="studio-note" role="status">{t('Uzmanlar yükleniyor…', 'Loading experts…')}</p> : partners.length ? partners.map(item => <label key={item.id} className={`expert-partner ${brief.partnerId === item.id ? 'is-selected' : ''}`}>
            <input type="radio" name="partner" value={item.id} checked={brief.partnerId === item.id} onChange={() => setBrief({ ...brief, partnerId: item.id })} />
            <span><strong>{item.displayName}</strong><small>{item.services.map(service => EXPERT_SERVICE_LABELS[service][idx]).join(' · ')} · {item.languages.map(language => language.toUpperCase()).join('/')}</small><span className="expert-summary">{item.summary}</span>
              <a href={item.website} target="_blank" rel="noreferrer noopener">{item.website.replace(/^https:\/\//, '').replace(/\/$/, '')}</a></span>
          </label>) : <p className="studio-note">{t('Bu hizmet için şu anda listelenen bir uzman yok.', 'No expert is listed for this service right now.')}</p>}
        </fieldset>
        <label>{t('Başlık', 'Title')}<input required minLength={3} maxLength={120} value={brief.title} onChange={event => setBrief({ ...brief, title: event.target.value })} placeholder={t('Ör. Yeni koleksiyon için ürün çekimi', 'E.g. Product shoot for the new collection')} /></label>
        <label>{t('İş tanımı', 'Description')}<textarea required minLength={20} maxLength={2000} rows={5} value={brief.details} onChange={event => setBrief({ ...brief, details: event.target.value })} /></label>
        <label>{t('Teslim edilecekler', 'Deliverables')}<textarea required minLength={3} maxLength={600} rows={3} value={brief.deliverables} onChange={event => setBrief({ ...brief, deliverables: event.target.value })} placeholder={t('Ör. 10 adet 1080×1350 JPEG, 1 adet 15 sn dikey video', 'E.g. 10 JPEGs at 1080×1350, one 15 s vertical video')} /></label>
        <div className="expert-row"><label>{t('Teslim tarihi', 'Due date')}<input type="date" required min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} value={brief.dueDate} onChange={event => setBrief({ ...brief, dueDate: event.target.value })} /></label>
          <label>{t('Bütçe notu (isteğe bağlı)', 'Budget note (optional)')}<input maxLength={120} value={brief.budgetNote} onChange={event => setBrief({ ...brief, budgetNote: event.target.value })} /></label></div>
        <label>{t('Size ulaşılacak iletişim bilgisi', 'How the expert reaches you')}<input required minLength={5} maxLength={120} value={brief.contact} onChange={event => setBrief({ ...brief, contact: event.target.value })} placeholder={t('Ad, e-posta veya telefon', 'Name, email or phone')} /></label>
        <label>{t('Marka bilgisi (marka kitinden ve marka dilinden; düzenleyebilirsiniz)', 'Brand information (from the brand kit and voice; you can edit it)')}<textarea maxLength={1500} rows={6} value={brief.brand} onChange={event => setBrief({ ...brief, brand: event.target.value })} /></label>
        <label className="design-toggle"><input type="checkbox" checked={brief.ack} onChange={event => setBrief({ ...brief, ack: event.target.checked })} />{t('Bu brifin, marka bilgisi ve iletişim bilgisi dahil, seçtiğim uzmanla paylaşılacağını onaylıyorum.', 'I confirm this brief, including the brand information and contact details, is shared with the selected expert.')}</label>
        <div className="design-actions"><button className="studio-primary" disabled={Boolean(busy) || !brief.ack || !brief.partnerId}>{busy === 'send' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{t('Talebi gönder', 'Send request')}</button>
          <button type="button" className="studio-text-button" onClick={() => setBrief(null)}><X size={15} />{t('Vazgeç', 'Cancel')}</button></div>
      </form>}
      {client.requests.length ? <ul className="expert-list">{client.requests.map(item => <li key={item.id} className="expert-card">
        <div className="expert-card-head"><span className={`coach-state ${item.state === 'approved' ? 'done' : ''}`}>{STATES[item.state][idx]}</span><h3>{item.brief.title}</h3>
          <p className="coach-muted">{item.partnerName} · {EXPERT_SERVICE_LABELS[item.service][idx]} · {t('teslim', 'due')} {when(item.brief.dueDate)} · {t('gönderildi', 'sent')} {when(item.requestedAt)}{item.revisions ? ` · ${item.revisions}/${EXPERT_MAX_REVISIONS} ${t('düzeltme', 'revisions')}` : ''}</p>
          {item.partnerContact && <p className="studio-note">{t('Uzman iletişimi', 'Expert contact')}: <span className="expert-contact">{item.partnerContact}</span></p>}</div>
        {briefView(item)}{history(item)}{files(item, false)}
        {client.canReview && item.state === 'delivered' && <div className="expert-review">
          <label>{t('Düzeltme isteği (düzeltme isterseniz)', 'Change request (if you ask for changes)')}<textarea rows={3} maxLength={1000} value={notes[item.id] || ''} onChange={event => setNotes({ ...notes, [item.id]: event.target.value })} /></label>
          <div className="design-actions"><button type="button" className="studio-primary" disabled={Boolean(busy)} onClick={() => void act(`approve:${item.id}`, { action: 'review', id: item.id, decision: 'approve' }, t('Teslim onaylandı.', 'Delivery approved.'))}><Check size={15} />{t('Teslimi onayla', 'Approve delivery')}</button>
            <button type="button" className="studio-secondary" disabled={Boolean(busy) || item.revisions >= EXPERT_MAX_REVISIONS || (notes[item.id] || '').trim().length < 5} onClick={() => void act(`revision:${item.id}`, { action: 'review', id: item.id, decision: 'revision', note: notes[item.id] }, t('Düzeltme isteği uzmana iletildi.', 'The change request was sent to the expert.')).then(ok => { if (ok) setNotes({ ...notes, [item.id]: '' }); })}><RotateCcw size={15} />{t('Düzeltme iste', 'Ask for changes')}</button></div>
          {item.revisions >= EXPERT_MAX_REVISIONS && <p className="studio-note">{t('Düzeltme hakkı doldu; kalan değişiklikleri uzmanla doğrudan konuşun.', 'No revision rounds left; agree further changes with the expert directly.')}</p>}
        </div>}
        {client.canRequest && ['sent', 'accepted'].includes(item.state) && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void act(`cancel:${item.id}`, { action: 'cancel', id: item.id }, t('Talep iptal edildi.', 'Request cancelled.'))}><X size={15} />{t('Talebi iptal et', 'Cancel request')}</button>}
      </li>)}</ul> : !brief && <p className="studio-note">{client.canRequest ? t('Henüz uzman talebi yok.', 'No expert requests yet.') : t('Uzman talebini onay yetkisi olan ekip üyeleri gönderir.', 'Teammates with approval rights send expert requests.')}</p>}
    </>}

    {partner && profile && <section className="expert-partner-side" aria-labelledby="expert-partner-title">
      <h3 id="expert-partner-title">{t('Ajans olarak: uzman profiliniz ve gelen talepler', 'As an agency: your expert profile and incoming requests')}</h3>
      {!partner.running && <p className="studio-note">{t('Ajans paketi etkin değil; profil listede görünmez ve yeni iş kabul edilemez. Mevcut işleri teslim edebilirsiniz.', 'The agency package is not running: the profile is not listed and new work cannot be accepted. Existing work can still be delivered.')}</p>}
      <form className="expert-form" onSubmit={saveProfile}>
        <fieldset disabled={!partner.canEdit || Boolean(busy)} className="expert-fieldset">
          <label>{t('Görünen ad', 'Display name')}<input required minLength={2} maxLength={80} value={profile.displayName} onChange={event => setProfile({ ...profile, displayName: event.target.value })} /></label>
          <label>{t('Tanıtım', 'About')}<textarea required minLength={20} maxLength={600} rows={4} value={profile.summary} onChange={event => setProfile({ ...profile, summary: event.target.value })} /></label>
          <div className="expert-chips" role="group" aria-label={t('Hizmetler', 'Services')}>{EXPERT_SERVICES.map(item => <label key={item} className="design-toggle"><input type="checkbox" checked={profile.services.includes(item)} onChange={event => setProfile({ ...profile, services: event.target.checked ? [...profile.services, item] : profile.services.filter(other => other !== item) })} />{EXPERT_SERVICE_LABELS[item][idx]}</label>)}</div>
          <div className="expert-chips" role="group" aria-label={t('Çalışma dilleri', 'Working languages')}>{(['tr', 'en'] as const).map(item => <label key={item} className="design-toggle"><input type="checkbox" checked={profile.languages.includes(item)} onChange={event => setProfile({ ...profile, languages: event.target.checked ? [...profile.languages, item] : profile.languages.filter(other => other !== item) })} />{item === 'tr' ? 'Türkçe' : 'English'}</label>)}</div>
          <div className="expert-row"><label>{t('Web sitesi (https)', 'Website (https)')}<input type="url" required value={profile.website} onChange={event => setProfile({ ...profile, website: event.target.value })} /></label>
            <label>{t('İletişim (kabul ettiğiniz müşterilere görünür)', 'Contact (shown to clients you accept)')}<input required minLength={5} maxLength={120} value={profile.contact} onChange={event => setProfile({ ...profile, contact: event.target.value })} /></label></div>
          <label className="design-toggle"><input type="checkbox" checked={profile.listed} disabled={!partner.running} onChange={event => setProfile({ ...profile, listed: event.target.checked })} />{t('Uzman listesinde görün', 'Show in the expert list')}</label>
          {partner.canEdit && <div className="design-actions"><button className="studio-primary">{busy === 'profile' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{t('Profili kaydet', 'Save profile')}</button></div>}
        </fieldset>
        {!partner.canEdit && <p className="studio-note">{t('Profili ajans paketinin sahibi düzenler.', 'The agency package owner edits the profile.')}</p>}
      </form>
      {partner.requests.length ? <ul className="expert-list">{partner.requests.map(item => <li key={item.id} className="expert-card">
        <div className="expert-card-head"><span className={`coach-state ${item.state === 'approved' ? 'done' : ''}`}>{(PARTNER_STATES[item.state] || STATES[item.state])[idx]}</span><h3>{item.brief.title}</h3>
          <p className="coach-muted">{item.clientName} · {EXPERT_SERVICE_LABELS[item.service][idx]} · {t('teslim', 'due')} {when(item.brief.dueDate)} · {t('geldi', 'received')} {when(item.requestedAt)}</p></div>
        {briefView(item)}{history(item)}{files(item, ['accepted', 'revision'].includes(item.state))}
        {item.state === 'sent' && partner.canDecide && <div className="expert-review">
          <label>{t('Ret nedeni (reddederseniz, isteğe bağlı)', 'Reason (if you decline, optional)')}<input maxLength={500} value={notes[item.id] || ''} onChange={event => setNotes({ ...notes, [item.id]: event.target.value })} /></label>
          <div className="design-actions"><button type="button" className="studio-primary" disabled={Boolean(busy) || !partner.running} onClick={() => void act(`accept:${item.id}`, { action: 'decide', id: item.id, decision: 'accept' }, t('Talep kabul edildi; müşteri iletişim bilginizi görür.', 'Request accepted; the client now sees your contact details.'))}><Check size={15} />{t('Kabul et', 'Accept')}</button>
            <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void act(`decline:${item.id}`, { action: 'decide', id: item.id, decision: 'decline', note: notes[item.id] || '' }, t('Talep reddedildi.', 'Request declined.'))}><X size={15} />{t('Reddet', 'Decline')}</button></div></div>}
        {['accepted', 'revision'].includes(item.state) && <div className="expert-review">
          <label className="studio-secondary design-file">{busy === `upload:${item.id}` ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}{t('Dosya ekle (PNG, JPEG, WebP, PDF · en çok 6 MB)', 'Add files (PNG, JPEG, WebP, PDF · up to 6 MB)')}
            <input type="file" multiple accept={EXPERT_FILE_MIMES.join(',')} disabled={Boolean(busy)} onChange={event => { void upload(item, event.target.files); event.target.value = ''; }} /></label>
          <label>{t('Teslim notu (isteğe bağlı)', 'Delivery note (optional)')}<textarea rows={2} maxLength={1000} value={notes[item.id] || ''} onChange={event => setNotes({ ...notes, [item.id]: event.target.value })} /></label>
          <div className="design-actions"><button type="button" className="studio-primary" disabled={Boolean(busy) || !item.files.some(file => !file.submitted)} onClick={() => void act(`deliver:${item.id}`, { action: 'deliver', id: item.id, note: notes[item.id] || '' }, t('Teslim edildi; müşteri dosyaları görüp onaylayabilir.', 'Delivered; the client can now see and review the files.')).then(ok => { if (ok) setNotes({ ...notes, [item.id]: '' }); })}><UploadCloud size={15} />{t('Teslim et', 'Deliver')}</button></div>
        </div>}
      </li>)}</ul> : <p className="studio-note">{t('Henüz gelen talep yok.', 'No incoming requests yet.')}</p>}
    </section>}
  </section>;
}
