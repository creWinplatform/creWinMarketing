'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, Check, Copy, ExternalLink, Lightbulb, Loader2, Mail, MessageCircle, Phone, Play, Reply, Send, Settings2, Sparkles, Target, Users, X } from 'lucide-react';
import { SIGNALS, type SignalKey } from '@/lib/platform/prospect-finder-types';
import { PRIVACY_TEMPLATE } from '@/lib/platform/prospect-workflow-types';
import { projectRequest } from '@/lib/platform/client';
import { ProposalBlock } from './ProspectWorkflow';
import type { ProspectContact } from '@/lib/platform/prospect-finder-types';
import {
  ANALYSIS_TOKEN, OUTREACH_LIMITS, PIPELINE_STAGES, REPLY_CLASSES, STAGE_LABELS, WAIT_LABELS,
  FIRST_HUNDRED, LEARNING_MIN_SENDS, type SalesWeek, type OutreachStep, type OutreachView, type PipelineStage, type ReplyClass, type SalesSnapshot,
} from '@/lib/platform/prospect-outreach-types';

export type SalesPost = <T>(key: string, body: Record<string, unknown>, message?: string) => Promise<T | null>;
const copyText = async (value: string) => { try { await navigator.clipboard.writeText(value); return true; } catch { return false; } };
const STEP_LABELS: [string, string][] = [['İlk e-posta', 'First email'], ['1. takip', 'Follow-up 1'], ['2. takip', 'Follow-up 2'], ['3. takip', 'Follow-up 3'], ['4. takip', 'Follow-up 4']];
const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const SEND_LABELS: Record<string, [string, string]> = { reserved: ['gönderiliyor', 'sending'], accepted: ['gönderildi', 'sent'], delivered: ['teslim edildi', 'delivered'], bounced: ['geri döndü', 'bounced'], complained: ['spam bildirildi', 'reported as spam'], uncertain: ['sonucu belirsiz', 'result unknown'], rejected: ['reddedildi', 'rejected'] };
const STATE_LABELS: Record<OutreachView['state'], [string, string]> = { draft: ['Taslak', 'Draft'], active: ['Gönderim sürüyor', 'Sending'], finished: ['Tüm e-postalar gitti', 'All emails sent'], replied: ['Yanıt geldi', 'Replied'], stopped: ['Durduruldu', 'Stopped'], bounced: ['Geri döndü', 'Bounced'], failed: ['Gönderilemedi', 'Could not be sent'] };
const STOP_LABELS: Record<string, [string, string]> = { cancelled: ['ekip durdurdu', 'stopped by the team'], replied: ['yanıt geldi', 'a reply came'], unsubscribed: ['alıcı ret bağlantısını kullandı', 'the recipient opted out'], blocked: ['adres engelli veya İYS’de ret var', 'the address is blocked or rejected in İYS'], bounced: ['e-posta geri döndü', 'the email bounced'], complained: ['alıcı spam bildirdi', 'the recipient reported spam'], uncertain: ['sunucu yanıtı belirsiz; tekrar denenmez', 'the server’s answer was unclear; it is not retried'], rejected: ['sunucu reddetti', 'the server rejected it'], stage: ['satış aşaması değişti', 'the sales stage changed'], removed: ['adres listeden kaldırıldı', 'the address was removed'] };
// wa.me needs the number in international form without "+"; Turkish local numbers get 90 in front.
const waNumber = (value: string) => { const digits = value.replace(/\D/g, ''); return value.startsWith('+') ? digits : digits.length === 11 && digits.startsWith('0') ? `90${digits.slice(1)}` : digits.length === 10 && digits.startsWith('5') ? `90${digits}` : digits; };

// Readiness for sales emails and the team's sending settings.
export function SalesSetupPanel({ tr, data, busy, post, open = false }: { tr: boolean; data: SalesSnapshot; busy: string; post: SalesPost; open?: boolean }) {
  const t = (a: string, b: string) => tr ? a : b, r = data.readiness;
  const formOf = (value: SalesSnapshot['settings']) => ({ fromName: value.fromName, signature: value.signature, calendarUrl: value.calendarUrl, days: [...value.followUpDays], privacyUrl: value.privacyUrl, retentionMonths: value.retentionMonths, weeklyGoal: value.weeklyGoal, orgWide: value.orgWide, assignMode: value.assignMode, assignRules: value.assignRules });
  const [form, setForm] = useState(() => formOf(data.settings)), [ack, setAck] = useState(false), [copiedNotice, setCopiedNotice] = useState(false);
  useEffect(() => { setForm(formOf(data.settings)); }, [data.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const months = form.retentionMonths ? t(`${form.retentionMonths} ay`, `${form.retentionMonths} months`) : t('iş ilişkisi sürdüğü müddetçe', 'as long as the business contact lasts');
  const notice = PRIVACY_TEMPLATE[tr ? 0 : 1].replace(/\{name\}/g, data.settings.fromName || t('İşletmemiz', 'Our business')).replace(/\{website\}/g, t('web sitemiz', 'our website')).replace('{months}', months);
  const iysText = { not_required: t('İYS: bu proje için gerekli değil.', 'İYS: not required for this project.'), ready: t('İYS: tacir istisnası açık; her e-postadan önce ret kontrolü yapılır.', 'İYS: the merchant exemption is on; every email is checked for a rejection first.'),
    needs_exemption: t('İYS: firma adreslerine yazmak için Gönderim izinleri (İYS) bölümünde tacir istisnasını açın.', 'İYS: turn on the merchant exemption under Sending consents (İYS) to write to company addresses.'),
    not_connected: t('İYS: Türkiye beyanı var ama İYS bağlı değil.', 'İYS: Turkey is declared but İYS is not connected.'), scope_missing: t('İYS: önce Gönderim izinleri (İYS) bölümünde beyan yapın.', 'İYS: first make the declaration under Sending consents (İYS).') }[r.iys];
  const checks: [boolean, string][] = [
    [r.switchOn, r.switchOn ? t('Sunucuda satış e-postası gönderimi açık.', 'Sales email sending is on for this server.') : t('Sunucuda satış e-postası gönderimi kapalı (PLATFORM_PROSPECT_EMAIL_ENABLED). Taslak hazırlanır, gönderilmez.', 'Sales email sending is off on this server (PLATFORM_PROSPECT_EMAIL_ENABLED). Drafts are written, nothing is sent.')],
    [r.senderReady, r.senderReady ? t(`Gönderen doğrulandı${r.domain ? ` (${r.domain})` : ''}: alan adı, DKIM ve geri bildirim tamam.`, `Sender verified${r.domain ? ` (${r.domain})` : ''}: domain, DKIM and feedback are in place.`) : t('Gönderen hazır değil: Proje ayarları → E-posta göndereni ve Amazon SES adımlarını tamamlayın.', 'The sender is not ready: finish Project settings → Email sender and the Amazon SES steps.')],
    [r.publicOrigin, r.publicOrigin ? t('Ret bağlantısı için genel adres tanımlı.', 'The public address for opt-out links is set.') : t('Ret bağlantısı için genel adres (PLATFORM_PUBLIC_ORIGIN) eksik.', 'The public address for opt-out links (PLATFORM_PUBLIC_ORIGIN) is missing.')],
    [r.iys === 'not_required' || r.iys === 'ready', iysText],
  ];
  const missing = checks.filter(([ok]) => !ok).length + (r.paused ? 1 : 0);
  return <details className="studio-band sales-setup" open={open || Boolean(r.paused)}>
    <summary><Settings2 size={15} aria-hidden="true" /><strong>{t('Satış e-postası ayarları', 'Sales email settings')}</strong><span className={missing ? 'sales-badge is-warn' : 'sales-badge is-ok'}>{missing ? t(`${missing} eksik`, `${missing} to do`) : t('Hazır', 'Ready')}</span></summary>
    <div className="sales-setup-body">
      {r.paused && <div className="sales-paused" role="alert"><AlertTriangle size={16} aria-hidden="true" /><div><strong>{t('Satış e-postaları durduruldu.', 'Sales emails are paused.')}</strong> {r.paused.reason === 'complaints' ? t('Alıcılar spam bildirdi.', 'Recipients reported spam.') : t('Çok sayıda e-posta geri döndü.', 'Too many emails bounced.')} {t('Adres listesini ve metinleri gözden geçirin; bağlantı yöneticisi devam ettirebilir.', 'Review the addresses and the texts; a connection manager can resume.')}
        {data.canManage && <div className="sales-inline"><label className="design-toggle"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />{t('Kontrol ettim; geri dönen adresler engellendi.', 'I checked; bounced addresses are blocked.')}</label>
          <button type="button" className="studio-secondary" disabled={!ack || Boolean(busy)} onClick={() => void post('resume', { action: 'resume', acknowledged: true }, t('Satış e-postaları devam ediyor.', 'Sales emails resumed.'))}><Play size={14} />{t('Devam ettir', 'Resume')}</button></div>}</div></div>}
      <ul className="sales-checks">{checks.map(([ok, text], index) => <li key={index} className={ok ? 'is-ok' : 'is-warn'}>{ok ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}<span>{text}</span></li>)}
        <li className={r.dmarc.state === 'ok' ? 'is-ok' : 'is-warn'}>{r.dmarc.state === 'ok' ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}<span>{r.dmarc.state === 'ok' ? t('Alan adında DMARC kaydı var.', 'The domain has a DMARC record.') : r.dmarc.state === 'missing' ? t('Alan adında DMARC kaydı yok. Gmail ve Yahoo bunu bekler; DNS’e “_dmarc” TXT kaydı ekleyin (ör. v=DMARC1; p=none).', 'The domain has no DMARC record. Gmail and Yahoo expect one; add a “_dmarc” TXT record (e.g. v=DMARC1; p=none).') : t('DMARC kaydı henüz kontrol edilmedi.', 'The DMARC record has not been checked yet.')}
          {data.canApprove && r.domain && <button type="button" className="studio-text-button sales-inline-button" disabled={Boolean(busy)} onClick={() => void post('dmarc', { action: 'check-domain' })}>{busy === 'dmarc' ? <Loader2 size={13} className="animate-spin" /> : null}{t('Kontrol et', 'Check')}</button>}</span></li>
        <li className="is-info"><Send size={14} aria-hidden="true" /><span>{t(`Son 24 saatte ${r.sentToday}/${r.dailyLimit} e-posta. Sınır ilk gün 10’dur, her gün 5 artar (en çok 50); e-postalar hafta içi 09–18 arasında gider.`, `${r.sentToday}/${r.dailyLimit} emails in the last 24 hours. The limit starts at 10 and grows by 5 a day (at most 50); emails go on weekdays 9–18.`)}</span></li>
      </ul>
      {data.canApprove ? <form className="prospect-form sales-settings" onSubmit={event => { event.preventDefault(); void post('sales-settings', { action: 'settings', fromName: form.fromName, signature: form.signature, calendarUrl: form.calendarUrl, followUpDays: form.days.map(Number), privacyUrl: form.privacyUrl, retentionMonths: form.retentionMonths, weeklyGoal: Number(form.weeklyGoal), orgWide: form.orgWide, assignMode: form.assignMode, assignRules: form.assignRules }, t('Satış e-postası ayarları kaydedildi.', 'Sales email settings saved.')); }}>
        <div className="prospect-form-row"><label>{t('Gönderen adı (boşsa proje adı)', 'Sender name (project name if empty)')}<input maxLength={80} value={form.fromName} onChange={event => setForm({ ...form, fromName: event.target.value })} /></label>
          <label>{t('Randevu bağlantısı (boşsa Ryzevo randevu sayfanız)', 'Booking link (empty: your Ryzevo booking page)')}<input type="url" maxLength={300} placeholder={data.settings.bookingUrl || 'https://'} value={form.calendarUrl} onChange={event => setForm({ ...form, calendarUrl: event.target.value })} /></label></div>
        <label>{t('İmza (unvan, şirket bilgisi)', 'Signature (title, company details)')}<textarea rows={2} maxLength={OUTREACH_LIMITS.signature} value={form.signature} onChange={event => setForm({ ...form, signature: event.target.value })} /></label>
        <label>{t('Haftalık temas hedefi (e-posta, tanıdık, LinkedIn, telefon)', 'Weekly touch goal (email, introductions, LinkedIn, phone)')}<input type="number" min={1} max={500} value={form.weeklyGoal} onChange={event => setForm({ ...form, weeklyGoal: Number(event.target.value) })} /></label>
        <fieldset className="sales-step"><legend>{t('Takip e-postaları (yanıt gelmezse)', 'Follow-ups (only without a reply)')}</legend>
          <p className="coach-muted">{t('Y Combinator 2–4 takip öneriyor: insanlar meşgul. Her takip bir öncekinden kaç gün sonra gitsin?', 'Y Combinator suggests 2–4 follow-ups: people are busy. How many days after the previous email should each go?')}</p>
          <div className="sales-inline">{form.days.map((day, index) => <label key={index} className="sales-day">{STEP_LABELS[index + 1][tr ? 0 : 1]}<input type="number" min={1} max={21} value={day} onChange={event => setForm({ ...form, days: form.days.map((item, position) => position === index ? Number(event.target.value) : item) })} /></label>)}
            {form.days.length < OUTREACH_LIMITS.followUps && <button type="button" className="studio-text-button" onClick={() => setForm({ ...form, days: [...form.days, 7] })}>{t('+ Takip ekle', '+ Add a follow-up')}</button>}
            {form.days.length > 1 && <button type="button" className="studio-text-button" onClick={() => setForm({ ...form, days: form.days.slice(0, -1) })}>{t('Son takibi kaldır', 'Remove the last one')}</button>}</div>
        </fieldset>
        <fieldset className="sales-step"><legend>{t('Ekip dağıtımı', 'Sharing out in the team')}</legend>
          <label>{t('Onaylanan firma kime gitsin?', 'Who gets a newly approved company?')}<select value={form.assignMode} onChange={event => setForm({ ...form, assignMode: event.target.value as typeof form.assignMode })}><option value="manual">{t('Elle seçilir', 'Chosen by hand')}</option><option value="round_robin">{t('Sırayla', 'In turn')}</option><option value="by_sector">{t('Sektöre göre (yoksa sırayla)', 'By sector (else in turn)')}</option></select></label>
          {form.assignMode === 'by_sector' && <>{form.assignRules.map((rule, index) => <div key={index} className="sales-inline"><input aria-label={t('Sektör', 'Sector')} placeholder={t('Sektör (ör. Diş)', 'Sector (e.g. Dental)')} maxLength={80} value={rule.sector} onChange={event => setForm({ ...form, assignRules: form.assignRules.map((item, position) => position === index ? { ...item, sector: event.target.value } : item) })} />
            <select aria-label={t('Ekip üyesi', 'Teammate')} value={rule.userId} onChange={event => setForm({ ...form, assignRules: form.assignRules.map((item, position) => position === index ? { ...item, userId: event.target.value } : item) })}>{data.members.map(member => <option key={member.id} value={member.id}>{member.username}</option>)}</select>
            <button type="button" className="studio-text-button" aria-label={t('Kuralı kaldır', 'Remove the rule')} onClick={() => setForm({ ...form, assignRules: form.assignRules.filter((_, position) => position !== index) })}><X size={14} /></button></div>)}
            {data.members.length > 0 && form.assignRules.length < 20 && <button type="button" className="studio-text-button" onClick={() => setForm({ ...form, assignRules: [...form.assignRules, { sector: '', userId: data.members[0].id }] })}>{t('+ Kural ekle', '+ Add a rule')}</button>}</>}
        </fieldset>
        <fieldset className="sales-step"><legend>{t('Uyumluluk', 'Compliance')}</legend>
          <label className="design-toggle"><input type="checkbox" checked={form.orgWide} onChange={event => setForm({ ...form, orgWide: event.target.checked })} />{t('“Bir daha yazma” listesi kuruluştaki tüm projelerde geçerli', 'The never-contact list applies to every project of the organisation')}</label>
          <label>{t('Sonuç çıkmayan adaylar ne kadar saklansın?', 'How long are candidates without a result kept?')}<select value={form.retentionMonths} onChange={event => setForm({ ...form, retentionMonths: Number(event.target.value) })}><option value={0}>{t('Silinmesin', 'Keep them')}</option><option value={3}>{t('3 ay', '3 months')}</option><option value={6}>{t('6 ay', '6 months')}</option><option value={12}>{t('12 ay', '12 months')}</option></select></label>
          <label>{t('Aydınlatma metni bağlantısı (e-postalara eklenir)', 'Privacy notice link (added to emails)')}<input type="url" maxLength={300} placeholder="https://" value={form.privacyUrl} onChange={event => setForm({ ...form, privacyUrl: event.target.value })} /></label>
          <details><summary className="coach-muted">{t('Örnek B2B aydınlatma metni', 'Sample B2B privacy notice')}</summary><p className="sales-message">{notice}</p>
            <button type="button" className="studio-text-button" onClick={() => void copyText(notice).then(ok => { setCopiedNotice(ok); setTimeout(() => setCopiedNotice(false), 1800); })}>{copiedNotice ? <Check size={14} /> : <Copy size={14} />}{t('Metni kopyala', 'Copy the text')}</button>
            <p className="coach-muted">{t('Kendi bilgilerinizle düzenleyip sitenizde yayımlayın; bir avukata okutmanız önerilir.', 'Edit it with your own details and publish it on your site; having a lawyer read it is recommended.')}</p></details>
        </fieldset>
        <div className="coach-action-buttons"><button type="submit" className="studio-secondary" disabled={Boolean(busy)}><Check size={14} />{t('Kaydet', 'Save')}</button></div>
      </form> : <p className="coach-muted">{t('Bu ayarları onay yetkisi olan ekip üyeleri değiştirir.', 'Teammates with approval rights change these settings.')}</p>}
      <p className="coach-muted">{t('Her e-postada gönderen bilgisi ve tek tıkla ret bağlantısı bulunur. Ret, yanıt, geri dönme veya spam bildirimi kalan e-postaları durdurur; “istemiyorum” diyen adres bir daha yazılmaz ve İYS’ye bildirilir.', 'Every email carries the sender’s details and a one-click opt-out. An opt-out, a reply, a bounce or a spam report stops the remaining emails; an address that says no is never written to again and is reported to İYS.')}</p>
    </div>
  </details>;
}

type Draft = { contactId: string; steps: OutreachStep[]; linkedin: string; whatsapp: string };
const toDraft = (item: OutreachView | undefined, contacts: ProspectContact[]): Draft => ({ contactId: item?.contactId || contacts.find(contact => contact.kind === 'email')?.id || '', steps: item?.steps.length ? item.steps.map(step => ({ ...step })) : [], linkedin: item?.linkedin || '', whatsapp: item?.whatsapp || '' });

// Outreach for one approved company: the pipeline stage, the email sequence, replies and other channels.
export function ProspectSalesBlock({ tr, prospect, contacts, sales, busy, post }: { tr: boolean; prospect: { id: string; company: string; contactRole: string }; contacts: ProspectContact[]; sales: SalesSnapshot; busy: string; post: SalesPost }) {
  const t = (a: string, b: string) => tr ? a : b, idx = tr ? 0 : 1, id = prospect.id;
  const item = sales.outreach[id], entry = sales.pipeline[id], stage = entry?.stage || 'new', emails = contacts.filter(contact => contact.kind === 'email'), phones = contacts.filter(contact => contact.kind === 'phone');
  const [draft, setDraft] = useState<Draft>(() => toDraft(item, contacts)), [ack, setAck] = useState(false), [personAck, setPersonAck] = useState(false), [reply, setReply] = useState({ text: '', kind: '' as ReplyClass | '' }), [copied, setCopied] = useState('');
  const [deal, setDeal] = useState({ stage: stage as PipelineStage, value: entry?.valueMinor ? String(entry.valueMinor / 100) : '', currency: entry?.currency || (tr ? 'TRY' : 'USD'), lostReason: entry?.lostReason || '' });
  useEffect(() => { setDraft(toDraft(item, contacts)); setAck(false); }, [item?.revision, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDeal({ stage, value: entry?.valueMinor ? String(entry.valueMinor / 100) : '', currency: entry?.currency || (tr ? 'TRY' : 'USD'), lostReason: entry?.lostReason || '' }); }, [entry?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const day = (value: string) => new Date(value).toLocaleString(tr ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const dirty = Boolean(item && item.state === 'draft' && JSON.stringify(toDraft(item, contacts)) !== JSON.stringify(draft));
  const copy = async (key: string, value: string) => { if (await copyText(value)) { setCopied(key); setTimeout(() => setCopied(''), 2000); } };
  const stageChanged = deal.stage !== stage || (deal.stage === 'won' && String(entry?.valueMinor ? entry.valueMinor / 100 : '') !== deal.value) || (deal.stage === 'lost' && deal.lostReason !== (entry?.lostReason || ''));
  const recipient = emails.find(contact => contact.id === (item?.contactId || '')), personal = Boolean(recipient?.person);
  const linkedinUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${prospect.company} ${prospect.contactRole}`.trim())}`;
  const sendStep = (index: number, change: Partial<OutreachStep>) => setDraft({ ...draft, steps: draft.steps.map((step, position) => position === index ? { ...step, ...change } : step) });
  return <div className="sales-block">
    <div className="sales-stage-row">
      <label>{t('Satış aşaması', 'Sales stage')}<select value={deal.stage} disabled={!sales.canWrite} onChange={event => setDeal({ ...deal, stage: event.target.value as PipelineStage })}>{PIPELINE_STAGES.map(value => <option key={value} value={value}>{STAGE_LABELS[value][idx]}</option>)}</select></label>
      {deal.stage === 'won' && <><label>{t('Tutar (isteğe bağlı)', 'Value (optional)')}<input inputMode="decimal" value={deal.value} onChange={event => setDeal({ ...deal, value: event.target.value.replace(/[^\d.,]/g, '') })} /></label>
        <label>{t('Para birimi', 'Currency')}<select value={deal.currency} onChange={event => setDeal({ ...deal, currency: event.target.value })}>{['TRY', 'USD', 'EUR'].map(value => <option key={value}>{value}</option>)}</select></label></>}
      {deal.stage === 'lost' && <label>{t('Neden (isteğe bağlı)', 'Reason (optional)')}<input maxLength={160} value={deal.lostReason} onChange={event => setDeal({ ...deal, lostReason: event.target.value })} /></label>}
      {sales.members.length > 1 && <label>{t('Sorumlu', 'Owner')}<select value={entry?.assignedTo || ''} disabled={!sales.canWrite || Boolean(busy)} onChange={event => void post(`assign-${id}`, { action: 'assign', id, userId: event.target.value || null }, t('Sorumlu güncellendi.', 'Owner updated.'))}><option value="">{t('Atanmadı', 'Nobody')}</option>{sales.members.map(member => <option key={member.id} value={member.id}>{member.username}</option>)}</select></label>}
      {sales.canWrite && stageChanged && <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void post(`stage-${id}`, { action: 'stage', id, stage: deal.stage, valueMinor: deal.stage === 'won' && deal.value ? Math.round(Number(deal.value.replace(',', '.')) * 100) : null, currency: deal.currency, lostReason: deal.lostReason }, t('Satış aşaması güncellendi.', 'Sales stage updated.'))}><Check size={14} />{t('Kaydet', 'Save')}</button>}
    </div>

    {(() => { const q = entry?.qualification; if (!['replied', 'meeting', 'proposal', 'won'].includes(stage) && !q?.nextStep && !entry?.featureGap) return null;
      return <details className="sales-section sales-channels" open={Boolean(entry?.stale)}>
        <summary>{t('Niteleme ve sonraki adım', 'Qualifying and next step')}{entry?.stale && <span className="sales-badge is-warn">{t('14 gündür ilerlemiyor', 'No movement for 14 days')}</span>}{q?.nextStepAt && <span className="coach-muted"> · {new Date(q.nextStepAt).toLocaleDateString(tr ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short' })}</span>}</summary>
        {entry?.stale && <p className="sales-reminder">{t('“Belki”de bekleyen firma zaman yer. Net bir evet ya da hayır isteyin; hayırsa “Kaybedildi” yapın.', 'Maybes eat your time. Ask for a clear yes or no; if it is a no, mark it lost.')}</p>}
        {entry?.featureGap && <p className="sales-reminder">{t('Eksik özellik', 'Missing feature')}: {entry.featureGap} · {t('YC’ye göre bu neredeyse bir ret.', 'Y Combinator treats this as almost a pass.')}</p>}
        <QualifyForm tr={tr} id={id} value={q} canWrite={sales.canWrite} busy={busy} post={post} hasGap={Boolean(entry?.featureGap)} />
      </details>; })()}
    <section className="sales-section" aria-label={t('Satış e-postası', 'Sales email')}>
      <h3><Mail size={14} aria-hidden="true" />{t('Satış e-postası', 'Sales email')}{item && <span className={`coach-state ${item.state === 'active' ? '' : item.state === 'finished' || item.state === 'replied' ? 'done' : ''}`}>{STATE_LABELS[item.state][idx]}</span>}</h3>
      {!item && (sales.canWrite ? <div className="coach-action-buttons">
        {sales.aiConfigured && <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void post(`draft-${id}`, { action: 'draft', id }, t('Taslak hazır. Okuyun, düzenleyin; onaylanmadan hiçbir şey gitmez.', 'The draft is ready. Read and edit it; nothing goes out before approval.'))}>{busy === `draft-${id}` ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{t('AI ile hazırla', 'Write with AI')}</button>}
        <button type="button" className={sales.aiConfigured ? 'studio-text-button' : 'studio-secondary'} disabled={Boolean(busy)} onClick={() => void post(`draft-${id}`, { action: 'draft', id, mode: 'template' }, t('Şablon hazır. Firmaya göre düzenleyin.', 'The template is ready. Adjust it to the company.'))}>{t('Şablonla başla', 'Start from a template')}</button>
        {!emails.length && <span className="coach-muted">{t('Firmanın yayımladığı bir e-posta adresi yok; yalnız LinkedIn ve WhatsApp mesajları hazırlanır.', 'The company publishes no email address; only LinkedIn and WhatsApp messages are prepared.')}</span>}
      </div> : <p className="coach-muted">{t('Henüz taslak yok.', 'No draft yet.')}</p>)}

      {item?.state === 'draft' && <div className="sales-editor">
        {item.contactId && emails.length > 1 && <label>{t('Alıcı (firmanın kurumsal adresi)', 'Recipient (the company’s role address)')}<select value={draft.contactId} disabled={!sales.canWrite} onChange={event => setDraft({ ...draft, contactId: event.target.value })}>{emails.map(contact => <option key={contact.id} value={contact.id}>{contact.value}{contact.source === 'guess' ? t(' (tahmini)', ' (guessed)') : contact.source === 'hunter' ? ' (Hunter)' : contact.source === 'import' ? t(' (liste)', ' (list)') : ''}{contact.note ? ` · ${contact.note}` : ''}</option>)}</select></label>}
        {item.contactId && emails.length === 1 && <p className="coach-muted">{t('Alıcı', 'Recipient')}: <strong>{emails[0].value}</strong></p>}
        {draft.steps.map((step, index) => <fieldset key={index} className="sales-step"><legend>{STEP_LABELS[index][idx]}{index > 0 && <span className="coach-muted"> · {t(`${sales.settings.followUpDays[index - 1]} gün sonra, yanıt gelmezse`, `${sales.settings.followUpDays[index - 1]} days later, if no reply`)}</span>}</legend>
          {index === 0 && <label>{t('Konu', 'Subject')}<input maxLength={OUTREACH_LIMITS.subject} value={step.subject} disabled={!sales.canWrite} onChange={event => sendStep(index, { subject: event.target.value })} /></label>}
          <label>{t('Metin', 'Text')}<textarea rows={index ? 4 : 8} value={step.body} disabled={!sales.canWrite} onChange={event => sendStep(index, { body: event.target.value })} /></label>
          {(() => { const target = index ? OUTREACH_LIMITS.followTarget : OUTREACH_LIMITS.firstTarget, count = countWords(step.body.split(ANALYSIS_TOKEN).join(' ')), questions = (step.body.match(/\?/g) || []).length;
            const tips = [count > target ? t(`Hedef ${target} kelime; kısaltın.`, `Aim for ${target} words; shorten it.`) : '', !index && questions === 0 ? t('Sonda tek bir net soru sorun (ör. “Bu hafta 15 dakika konuşabilir miyiz?”).', 'End with one clear question (e.g. “Could we talk for 15 minutes this week?”).') : '', questions > 1 ? t('Birden fazla soru var; tek bir çağrı daha çok yanıt alır.', 'There is more than one question; a single ask gets more replies.') : ''].filter(Boolean);
            return <p className={tips.length ? 'sales-word-count is-warn' : 'sales-word-count'}>{t(`${count} kelime`, `${count} words`)} / {target}{tips.length ? ` · ${tips.join(' ')}` : ''}</p>; })()}
        </fieldset>)}
        {item.contactId && <p className="coach-muted">{t(`${ANALYSIS_TOKEN} yazan yere firmanın mini analiz bağlantısı konur. Gönderen bilgisi, imza ve ret bağlantısı otomatik eklenir. Kısa yazın: ilk e-posta için hedef ${OUTREACH_LIMITS.firstTarget}, takipler için ${OUTREACH_LIMITS.followTarget} kelime, sonda tek bir soru. Bağlantı, adres, telefon, yüzde ve garanti yazılmaz.`, `The company’s mini analysis link goes where ${ANALYSIS_TOKEN} is. Sender details, the signature and the opt-out link are added for you. Keep it short: aim for ${OUTREACH_LIMITS.firstTarget} words in the first email and ${OUTREACH_LIMITS.followTarget} in follow-ups, with one question at the end. No links, addresses, phone numbers, percentages or guarantees.`)}</p>}
        <label>{t('LinkedIn bağlantı notu', 'LinkedIn connection note')}<textarea rows={2} maxLength={OUTREACH_LIMITS.linkedinChars} value={draft.linkedin} disabled={!sales.canWrite} onChange={event => setDraft({ ...draft, linkedin: event.target.value })} /></label>
        <label>{t('WhatsApp mesajı', 'WhatsApp message')}<textarea rows={2} maxLength={OUTREACH_LIMITS.channelChars} value={draft.whatsapp} disabled={!sales.canWrite} onChange={event => setDraft({ ...draft, whatsapp: event.target.value })} /></label>
        <div className="coach-action-buttons">
          {sales.canWrite && dirty && <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void post(`save-${id}`, { action: 'save', id, expectedRevision: item.revision, contactId: draft.contactId || undefined, steps: draft.steps, linkedin: draft.linkedin, whatsapp: draft.whatsapp }, t('Taslak kaydedildi.', 'Draft saved.'))}><Check size={14} />{t('Kaydet', 'Save')}</button>}
          {sales.canWrite && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t('Taslak silinsin mi?', 'Discard this draft?'))) void post(`cancel-${id}`, { action: 'cancel', id }); }}><X size={14} />{t('Taslağı sil', 'Discard')}</button>}
        </div>
        {item.contactId && (sales.canApprove ? <div className="sales-approve">
          <label className="design-toggle"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />{t('Metinleri okudum; alıcı firmanın kendi sitesinde yayımladığı kurumsal bir adres. İlk e-posta şimdi (mesai saatindeyse), takipler yanıt gelmezse gider.', 'I read the texts; the recipient is a role address the company publishes on its own site. The first email goes now (in business hours), the follow-ups only if there is no reply.')}</label>
          {personal && <label className="design-toggle"><input type="checkbox" checked={personAck} onChange={event => setPersonAck(event.target.checked)} />{recipient?.source === 'guess' ? t('Bu tahmini adresin doğru olduğunu teyit ettim; kişiye iş amaçlı yazıyorum.', 'I confirmed this guessed address is right; I am writing to this person for business.') : t('Bu kişi firmanın çalışanı; kurumsal adresine iş amaçlı yazıyorum.', 'This person works at the company; I am writing to their work address for business.')}</label>}
          <button type="button" className="studio-primary" disabled={!ack || (personal && !personAck) || dirty || Boolean(busy)} title={dirty ? t('Önce değişiklikleri kaydedin.', 'Save your changes first.') : undefined} onClick={() => void post(`approve-${id}`, { action: 'approve', id, expectedRevision: item.revision, acknowledged: true, confirmPerson: personal && personAck }, t('Onaylandı. İlk e-posta gönderildi veya ilk uygun saatte gidecek.', 'Approved. The first email was sent or goes at the next opening.'))}>{busy === `approve-${id}` ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}{t('Onayla ve gönder', 'Approve and send')}</button>
        </div> : <p className="coach-muted">{t('Gönderimi onay yetkisi olan bir ekip üyesi onaylar.', 'A teammate with approval rights approves the sending.')}</p>)}
      </div>}

      {item && item.state !== 'draft' && <div className="sales-status">
        {item.maskedEmail && <p className="coach-muted">{t('Alıcı', 'Recipient')}: {item.maskedEmail} · {t(`${item.sentSteps}/${item.steps.length} e-posta gitti`, `${item.sentSteps}/${item.steps.length} emails sent`)}</p>}
        {item.sends.length > 0 && <ul className="sales-sends">{item.sends.map(send => <li key={send.step}><span>{STEP_LABELS[send.step][idx]}</span><span className={['bounced', 'complained', 'uncertain', 'rejected'].includes(send.state) ? 'is-bad' : 'is-good'}>{SEND_LABELS[send.state][idx]}</span><span className="coach-muted">{day(send.at)}</span></li>)}</ul>}
        {item.state === 'active' && item.nextDueAt && <p className="coach-muted">{t('Sıradaki', 'Next')}: {STEP_LABELS[item.sentSteps]?.[idx]} · {day(item.nextDueAt)}{item.wait && <> · <strong>{WAIT_LABELS[item.wait][idx]}</strong></>}</p>}
        {item.stopReason && item.state !== 'active' && <p className="coach-muted">{t('Durma nedeni', 'Stopped because')}: {STOP_LABELS[item.stopReason]?.[idx] || item.stopReason}</p>}
        {item.reply && <div className="sales-reply"><p><Reply size={14} aria-hidden="true" /><strong>{REPLY_CLASSES[item.reply.kind].label[idx]}</strong>{item.reply.summary && <> · {item.reply.summary}</>}</p><p className="coach-muted">{REPLY_CLASSES[item.reply.kind].effect[idx]}</p>
          {item.reply.draft && <div className="sales-copy"><textarea readOnly rows={4} value={item.reply.draft} aria-label={t('Önerilen cevap', 'Suggested answer')} /><button type="button" className="studio-text-button" onClick={() => void copy(`reply-${id}`, item.reply!.draft)}><Copy size={14} />{copied === `reply-${id}` ? t('Kopyalandı', 'Copied') : t('Cevabı kopyala', 'Copy the answer')}</button><span className="coach-muted">{t('Cevabı kendi e-posta kutunuzdan gönderin.', 'Send the answer from your own mailbox.')}</span></div>}</div>}
        {item.remindAt && Date.parse(item.remindAt) <= Date.now() && <p className="sales-reminder"><Target size={14} aria-hidden="true" />{t('3 ay önce “şimdi değil” demişti; yeniden yazmanın zamanı.', 'They said “not now” 3 months ago; time to write again.')}{sales.canWrite && <button type="button" className="studio-text-button" onClick={() => void post(`remind-${id}`, { action: 'dismiss-reminder', id })}>{t('Tamam', 'Done')}</button>}</p>}
        {sales.canWrite && <div className="coach-action-buttons">
          {item.state === 'active' && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t('Kalan e-postalar gönderilmesin mi?', 'Stop the remaining emails?'))) void post(`cancel-${id}`, { action: 'cancel', id }, t('Gönderim durduruldu.', 'Sending stopped.')); }}><Ban size={14} />{t('Gönderimi durdur', 'Stop sending')}</button>}
          {item.state !== 'active' && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t('Yeni bir taslak hazırlansın mı? Önceki sıranın kaydı silinir; engellenen adresler engelli kalır.', 'Write a new draft? The previous sequence is removed; blocked addresses stay blocked.'))) void post(`draft-${id}`, { action: 'draft', id, mode: sales.aiConfigured ? undefined : 'template' }); }}><Sparkles size={14} />{t('Yeni taslak', 'New draft')}</button>}
        </div>}
        {sales.canWrite && item.sentSteps > 0 && <form className="prospect-form sales-reply-form" onSubmit={event => { event.preventDefault(); void post(`reply-${id}`, { action: 'reply', id, text: reply.text, kind: reply.kind || undefined }, t('Yanıt işlendi.', 'Reply recorded.')).then(value => { if (value) setReply({ text: '', kind: '' }); }); }}>
          <label>{t('Yanıt geldi mi? Metnini yapıştırın (saklanmaz) veya türünü seçin', 'Did they reply? Paste the text (it is not stored) or pick its kind')}<textarea rows={3} maxLength={4000} value={reply.text} onChange={event => setReply({ ...reply, text: event.target.value })} /></label>
          <div className="sales-inline"><select aria-label={t('Yanıt türü', 'Reply kind')} value={reply.kind} onChange={event => setReply({ ...reply, kind: event.target.value as ReplyClass | '' })}><option value="">{sales.aiConfigured ? t('Türü AI belirlesin', 'Let AI decide the kind') : t('Tür seçin', 'Pick a kind')}</option>{(Object.keys(REPLY_CLASSES) as ReplyClass[]).map(key => <option key={key} value={key}>{REPLY_CLASSES[key].label[idx]}</option>)}</select>
            <button type="submit" className="studio-secondary" disabled={Boolean(busy) || (!reply.kind && !(reply.text.trim() && sales.aiConfigured))}>{busy === `reply-${id}` ? <Loader2 size={14} className="animate-spin" /> : <Reply size={14} />}{t('Yanıtı işle', 'Record the reply')}</button></div>
        </form>}
      </div>}
    </section>

    <ProposalBlock tr={tr} id={id} canWrite={sales.canWrite} aiConfigured={sales.aiConfigured} />
    <details className="sales-section sales-channels">
      <summary><Users size={14} aria-hidden="true" />{t('LinkedIn, WhatsApp ve telefon', 'LinkedIn, WhatsApp and phone')}{(sales.touches[id] || []).length > 0 && <span className="coach-muted"> · {t(`${sales.touches[id].length} temas`, `${sales.touches[id].length} touch(es)`)}</span>}</summary>
      <p className="coach-muted">{t('Bu mesajları Ryzevo göndermez; kendi hesabınızdan siz gönderir, burada işaretlersiniz. Takip zamanı gelince uyarı çıkar.', 'Ryzevo does not send these; you send them from your own account and mark them here. You are reminded when it is time to follow up.')}</p>
      <div className="sales-channel"><strong>LinkedIn</strong>
        {item?.linkedin ? <p className="sales-message">{item.linkedin}</p> : <p className="coach-muted">{t('Önce taslak hazırlayın; bağlantı notu da yazılır.', 'Prepare a draft first; it includes a connection note.')}</p>}
        <div className="coach-action-buttons">{item?.linkedin && <button type="button" className="studio-text-button" onClick={() => void copy(`li-${id}`, item.linkedin)}><Copy size={14} />{copied === `li-${id}` ? t('Kopyalandı', 'Copied') : t('Notu kopyala', 'Copy the note')}</button>}
          <a className="studio-text-button" href={linkedinUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />{t('LinkedIn’de ara', 'Search on LinkedIn')}</a>
          {sales.canWrite && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void post(`touch-${id}`, { action: 'touch', id, channel: 'linkedin' }, t('LinkedIn teması kaydedildi.', 'LinkedIn touch recorded.'))}><Check size={14} />{t('Gönderdim', 'I sent it')}</button>}</div></div>
      <div className="sales-channel"><strong>WhatsApp</strong>
        {phones.length ? <>
          {item?.whatsapp && <p className="sales-message">{item.whatsapp}</p>}
          <div className="coach-action-buttons">{phones.map(phone => <a key={phone.id} className="studio-text-button" href={`https://wa.me/${waNumber(phone.value)}${item?.whatsapp ? `?text=${encodeURIComponent(item.whatsapp)}` : ''}`} target="_blank" rel="noreferrer"><MessageCircle size={14} />{phone.value}</a>)}
            {sales.canWrite && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void post(`touch-${id}`, { action: 'touch', id, channel: 'whatsapp' }, t('WhatsApp teması kaydedildi.', 'WhatsApp touch recorded.'))}><Check size={14} />{t('Gönderdim', 'I sent it')}</button>}</div>
          <p className="coach-muted">{t('Firma (tacir) numaralarına önceden onay gerekmez ama İYS’de ret varsa yazılmaz; bireysel numaralara onaysız ticari mesaj gönderilemez.', 'Company (merchant) numbers need no prior consent but must not be written to after a rejection in İYS; personal numbers cannot get commercial messages without consent.')}</p>
        </> : <p className="coach-muted">{t('Yayımlanmış bir telefon numarası yok.', 'No published phone number.')}</p>}</div>
      {phones.length > 0 && sales.canWrite && <div className="sales-channel"><strong>{t('Telefon', 'Phone')}</strong><div className="coach-action-buttons">
        <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void post(`touch-${id}`, { action: 'touch', id, channel: 'phone' }, t('Arama kaydedildi.', 'Call recorded.'))}><Phone size={14} />{t('Aradım', 'I called')}</button></div></div>}
      {(sales.touches[id] || []).length > 0 && <ul className="finder-history">{sales.touches[id].slice(0, 5).map(touch => <li key={touch.at}>{touch.channel === 'linkedin' ? 'LinkedIn' : touch.channel === 'whatsapp' ? 'WhatsApp' : touch.channel === 'network' ? t('Tanıdık', 'Introduction') : t('Telefon', 'Phone')} · {day(touch.at)}</li>)}</ul>}
    </details>
  </div>;
}

// The pipeline: approved companies by stage, with the next best ones to contact today.
export function SalesPipeline({ tr, items, sales, score, onOpen }: { tr: boolean; items: { id: string; company: string }[]; sales: SalesSnapshot; score: (id: string) => number; onOpen: (id: string) => void }) {
  const t = (a: string, b: string) => tr ? a : b, idx = tr ? 0 : 1, stageOf = (id: string) => sales.pipeline[id]?.stage || 'new';
  const today = items.filter(item => stageOf(item.id) === 'new' && !sales.outreach[item.id]).sort((a, b) => score(b.id) - score(a.id)).slice(0, 5);
  return <section className="sales-pipeline" aria-label={t('Satış hunisi', 'Sales pipeline')}>
    {today.length > 0 && <div className="studio-band sales-today"><h2><Target size={15} aria-hidden="true" />{t('Bugünkü hedefler', 'Today’s targets')}</h2>
      <p className="coach-muted">{t('Puanı en yüksek, henüz ulaşılmamış onaylı firmalar.', 'Approved companies with the highest score that nobody has contacted yet.')}</p>
      <ol>{today.map(item => <li key={item.id}><button type="button" className="studio-text-button" onClick={() => onOpen(item.id)}>{item.company}</button>{score(item.id) >= 0 && <span className="coach-muted"> · {t('puan', 'score')} {score(item.id)}</span>}</li>)}</ol></div>}
    {sales.learning.sends > 0 && <div className="studio-band sales-learning"><h2><Lightbulb size={15} aria-hidden="true" />{t('Öğrenen asistan', 'What is working')}</h2>
      <p className="coach-muted">{t(`${sales.learning.sends} ilk e-posta · ${sales.learning.replies} yanıt · ${sales.learning.interested} ilgilenen · ${sales.learning.won} kazanılan firma`, `${sales.learning.sends} first emails · ${sales.learning.replies} replies · ${sales.learning.interested} interested · ${sales.learning.won} won`)}</p>
      {(() => { const ready = (rows: typeof sales.learning.sectors) => rows.filter(row => row.sends >= LEARNING_MIN_SENDS), sectors = ready(sales.learning.sectors), signals = ready(sales.learning.signals), sources = ready(sales.learning.sources);
        const channelName = (key: string) => ({ email: t('E-posta', 'Email'), network: t('Tanıdık', 'Introduction'), linkedin: 'LinkedIn', whatsapp: 'WhatsApp', phone: t('Telefon', 'Phone') } as Record<string, string>)[key] || key;
        const label = (key: string) => key in SIGNALS ? SIGNALS[key as SignalKey].label[idx] : key === 'ai' ? t('AI taslağı', 'AI draft') : key === 'template' ? t('Şablon', 'Template') : key === 'human' ? t('Ekibin yazdığı', 'Written by the team') : key;
        const lines = [sectors[0] && t(`En çok yanıt veren sektör: ${sectors[0].key} (${sectors[0].sends} e-postadan ${sectors[0].replies} yanıt).`, `Sector that replies most: ${sectors[0].key} (${sectors[0].replies} replies from ${sectors[0].sends} emails).`),
          signals[0] && t(`En iyi çalışan bulgu: ${label(signals[0].key)} (${signals[0].sends} e-postadan ${signals[0].replies} yanıt).`, `Finding that works best: ${label(signals[0].key)} (${signals[0].replies} replies from ${signals[0].sends} emails).`),
          sales.learning.channels.length > 1 && t(`Kanallar (ilerleyen/temas): ${sales.learning.channels.map(row => `${channelName(row.key)} ${row.replies}/${row.sends}`).join(' · ')}.`, `Ways in (moved on/touched): ${sales.learning.channels.map(row => `${channelName(row.key)} ${row.replies}/${row.sends}`).join(' · ')}.`),
          sources.length > 1 && t(`Metin: ${sources.map(row => `${label(row.key)} ${row.replies}/${row.sends}`).join(' · ')}.`, `Text: ${sources.map(row => `${label(row.key)} ${row.replies}/${row.sends}`).join(' · ')}.`)].filter(Boolean);
        return lines.length ? <ul>{lines.map(text => <li key={String(text)}>{text}</li>)}</ul> : <p className="coach-muted">{t(`Öneri için bir sektörde veya bulguda en az ${LEARNING_MIN_SENDS} e-posta gerekiyor.`, `Suggestions need at least ${LEARNING_MIN_SENDS} emails in one sector or finding.`)}</p>; })()}
    </div>}
    <div className="sales-board" role="region" aria-label={t('Aşamalara göre firmalar', 'Companies by stage')} tabIndex={0}>
      {PIPELINE_STAGES.map(stage => { const list = items.filter(item => stageOf(item.id) === stage); return <div key={stage} className={`sales-column sales-column-${stage}`}>
        <h3>{STAGE_LABELS[stage][idx]} <span className="studio-badge">{list.length}</span></h3>
        {list.length ? <ul>{list.map(item => { const out = sales.outreach[item.id], entry = sales.pipeline[item.id]; return <li key={item.id}><button type="button" onClick={() => onOpen(item.id)}><strong>{item.company}</strong>
          <span className="coach-muted">{entry?.assignedTo ? `${sales.members.find(member => member.id === entry.assignedTo)?.username || ''} · ` : ''}{out ? STATE_LABELS[out.state][idx] : t('Henüz temas yok', 'Not contacted yet')}{entry?.stale ? t(' · 14 gündür bekliyor', ' · waiting 14+ days') : ''}{stage === 'won' && entry?.valueMinor ? ` · ${(entry.valueMinor / 100).toLocaleString(tr ? 'tr-TR' : 'en-GB')} ${entry.currency}` : ''}</span></button></li>; })}</ul>
          : <p className="coach-muted">—</p>}
      </div>; })}
    </div>
  </section>;
}

// Qualifying (Y Combinator): is the problem real, is there a budget, who signs; and the next step with its date.
function QualifyForm({ tr, id, value, canWrite, busy, post, hasGap }: { tr: boolean; id: string; value: SalesSnapshot['pipeline'][string]['qualification'] | undefined; canWrite: boolean; busy: string; post: SalesPost; hasGap: boolean }) {
  const t = (a: string, b: string) => tr ? a : b;
  const [form, setForm] = useState({ problem: value?.problem || 'unknown', budget: value?.budget || 'unknown', signer: value?.signer || '', nextStep: value?.nextStep || '', nextStepAt: value?.nextStepAt?.slice(0, 10) || '' });
  const answers = [['yes', t('Var', 'Yes')], ['no', t('Yok', 'No')], ['unknown', t('Bilinmiyor', 'Unknown')]];
  return <form className="prospect-form" onSubmit={event => { event.preventDefault(); void post(`qualify-${id}`, { action: 'qualify', id, ...form, nextStepAt: form.nextStepAt ? `${form.nextStepAt}T09:00:00` : null }, t('Niteleme kaydedildi.', 'Qualification saved.')); }}>
    <div className="prospect-form-row"><label>{t('Gerçek bir sorunları var mı?', 'Do they have a real problem?')}<select value={form.problem} disabled={!canWrite} onChange={event => setForm({ ...form, problem: event.target.value as typeof form.problem })}>{answers.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>{t('Bütçeleri var mı?', 'Do they have a budget?')}<select value={form.budget} disabled={!canWrite} onChange={event => setForm({ ...form, budget: event.target.value as typeof form.budget })}>{answers.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    <label>{t('Kim imzalıyor? (rol, ör. Genel müdür)', 'Who signs? (role, e.g. Managing director)')}<input maxLength={80} value={form.signer} disabled={!canWrite} onChange={event => setForm({ ...form, signer: event.target.value })} /></label>
    <div className="prospect-form-row"><label>{t('Sonraki adım', 'Next step')}<input maxLength={160} placeholder={t('Ör. Demoyu yapalım ve karar soralım', 'E.g. Run the demo and ask for a decision')} value={form.nextStep} disabled={!canWrite} onChange={event => setForm({ ...form, nextStep: event.target.value })} /></label>
      <label>{t('Tarihi', 'Date')}<input type="date" value={form.nextStepAt} disabled={!canWrite} onChange={event => setForm({ ...form, nextStepAt: event.target.value })} /></label></div>
    <p className="coach-muted">{t('İlk görüşmede satış yapmayın: sorunu, bütçeyi ve imza yetkisini öğrenip demoyu ayarlayın.', 'Don’t sell on the first call: learn the problem, the budget and who signs, then book the demo.')}</p>
    {canWrite && <div className="coach-action-buttons"><button type="submit" className="studio-secondary" disabled={Boolean(busy)}><Check size={14} />{t('Kaydet', 'Save')}</button>
      {hasGap && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void post(`qualify-${id}`, { action: 'qualify', id, ...form, nextStepAt: form.nextStepAt ? `${form.nextStepAt}T09:00:00` : null, clearFeatureGap: true })}>{t('Eksik özellik notunu kaldır', 'Clear the missing feature note')}</button>}</div>}
  </form>;
}

// The overview card: this week's touches against the goal, replies and meetings, the first 100 touches by hand and
// replies per 100 emails (Y Combinator: it is a numbers game).
export function SalesWeekCard({ tr }: { tr: boolean }) {
  const t = (a: string, b: string) => tr ? a : b, n = (value: number) => value.toLocaleString(tr ? 'tr-TR' : 'en-GB');
  const [week, setWeek] = useState<SalesWeek | null>(null);
  useEffect(() => { projectRequest<SalesWeek>('/api/platform/prospects/outreach?view=week').then(setWeek).catch(() => setWeek(null)); }, []);
  if (!week?.active) return null;
  const rate = week.emails >= 20 ? Math.round((week.emailReplies / week.emails) * 1000) / 10 : null;
  return <section className="studio-band sales-week" aria-labelledby="sales-week-title">
    <div className="studio-section-title"><h2 id="sales-week-title"><Target size={16} aria-hidden="true" />{t('Bu hafta satış', 'Sales this week')}</h2><a className="studio-text-button" href="/?tab=campaigns&campaignView=prospects">{t('Satış asistanı', 'Sales assistant')}</a></div>
    <div className="sales-week-goal"><strong>{n(week.touches)}<span> / {n(week.goal)}</span></strong><span>{t('temas', 'touches')}</span><progress value={Math.min(week.touches, week.goal)} max={week.goal} aria-label={t('Haftalık hedef', 'Weekly goal')} /></div>
    <ul className="sales-week-figures"><li><strong>{n(week.replies)}</strong>{t('yanıt', 'replies')}</li><li><strong>{n(week.meetings)}</strong>{t('görüşme', 'meetings')}</li>
      {rate !== null && <li><strong>{n(rate)}</strong>{t('yanıt / 100 e-posta', 'replies per 100 emails')}</li>}</ul>
    {week.firstHundred < FIRST_HUNDRED && <p className="coach-muted">{t(`İlk 100 temas: ${n(week.firstHundred)}/100. Otomasyondan önce ilk 100 temasın tek tek, elle onaylanması önerilir.`, `First 100 touches: ${n(week.firstHundred)}/100. The first 100 touches are best approved one by one, by hand, before anything is automated.`)}</p>}
    {rate !== null && <p className="coach-muted">{rate >= 2 ? t('100 e-postada 2–3 yanıt geliştirmeye başlamak için iyi bir yer.', '2–3 replies per 100 emails is a good place to start improving.') : t('100 e-postada 2’den az yanıt: hedef firma seçimini veya ilk cümleyi değiştirmeyi deneyin.', 'Fewer than 2 replies per 100 emails: try changing which companies you target or the first sentence.')}</p>}
    {week.touches < week.goal && <p className="coach-muted">{t(`Hedefe ${n(week.goal - week.touches)} temas kaldı. Tanıdıklarınız ve puanı yüksek onaylı firmalar en hızlı başlangıç.`, `${n(week.goal - week.touches)} touches to the goal. People you know and high-scored approved companies are the fastest start.`)}</p>}
  </section>;
}
