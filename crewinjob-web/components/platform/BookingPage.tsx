'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarCheck, CalendarPlus, Clock, Loader2 } from 'lucide-react';
import { BOOKING_NOTICE, type PublicBooking } from '@/lib/platform/prospect-workflow-types';
import type { VoiceRegion } from '@/lib/platform/voice-features';
import { currentVoiceText, fillVoiceText } from '@/lib/platform/voice-consent-texts';
import VoiceAssistantConsent from './VoiceAssistantConsent';

// A team's public booking page: free times by day in the visitor's own time zone, then a short form. The page key
// comes from the URL fragment, which the browser never sends to a server.
// voice: only while voice features are on (set by the server page): the assistant notice with its consent, and an
// optional phone with call consents in the form. Without it the page and its requests are exactly as before.
export default function BookingPage({ lang, voice }: { lang: 'tr' | 'en'; voice?: { region: VoiceRegion } }) {
  const [key, setKey] = useState(''), [data, setData] = useState<PublicBooking | null>(null), [failed, setFailed] = useState(''), [slot, setSlot] = useState(''), [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', company: '', note: '', consent: false }), [calls, setCalls] = useState({ phone: '', callConsent: false, iysCallConsent: false }), [done, setDone] = useState<{ startsAt: string; endsAt: string; title: string; project: string; callConsentSaved?: boolean } | null>(null), [error, setError] = useState('');
  const call = async (body: Record<string, unknown>) => { const response = await fetch('/api/booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000) }); const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error || ''); return value; };
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('k') || ''; setKey(value);
    if (!/^rzb_[A-Za-z0-9_-]{24}$/.test(value)) { setFailed('closed'); return; }
    call({ key: value, action: 'slots' }).then(page => setData(page as PublicBooking)).catch(() => setFailed('closed'));
  }, []);
  const tr = (data?.language || lang) === 'tr', t = (a: string, b: string) => tr ? a : b, locale = tr ? 'tr-TR' : 'en-GB';
  const days = useMemo(() => { const map = new Map<string, string[]>(); for (const item of data?.slots || []) { const day = new Date(item).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }); map.set(day, [...(map.get(day) || []), item]); } return [...map]; }, [data, locale]);
  const time = (value: string) => new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const book = async (event: FormEvent) => { event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { setDone(await call({ key, action: 'book', start: slot, ...form, ...(voice ? { ...calls, lang: tr ? 'tr' : 'en' } : {}) })); }
    catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : t('Randevu alınamadı. Lütfen tekrar deneyin.', 'The booking failed. Please try again.')); call({ key, action: 'slots' }).then(page => setData(page as PublicBooking)).catch(() => undefined); setSlot(''); }
    finally { setBusy(false); } };
  // A calendar file built in the browser (nothing leaves the page).
  const ics = (value: NonNullable<typeof done>) => { const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, ''); return `data:text/calendar;charset=utf-8,${encodeURIComponent(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ryzevo//Booking//TR', 'BEGIN:VEVENT', `UID:${stamp(value.startsAt)}-${Math.random().toString(36).slice(2)}@ryzevo`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(value.startsAt)}`, `DTEND:${stamp(value.endsAt)}`, `SUMMARY:${value.title.replace(/[,;\\]/g, ' ')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'))}`; };
  if (failed) return <main className="analysis-page"><p role="alert" className="analysis-card">{t('Bu randevu sayfası kapalı veya bağlantı eksik.', 'This booking page is closed or the link is incomplete.')}</p></main>;
  if (!data) return <main className="analysis-page"><p role="status" className="analysis-card">{t('Uygun saatler yükleniyor…', 'Loading free times…')}</p></main>;
  return <main className="analysis-page" style={{ ['--analysis-primary' as string]: data.primary, ['--analysis-accent' as string]: data.accent }}>
    <header className="analysis-head">{data.logo ? <img src={data.logo} alt={data.project} className="analysis-logo" /> : <strong className="analysis-sender">{data.project}</strong>}<span>{data.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span></header>
    {done ? <section className="analysis-card" aria-live="polite"><p className="analysis-eyebrow"><CalendarCheck size={14} aria-hidden="true" /> {t('Randevunuz alındı', 'You are booked')}</p>
      <h1>{data.title}</h1><p>{new Date(done.startsAt).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · {t(`${data.durationMin} dakika`, `${data.durationMin} minutes`)}</p>
      <p className="analysis-note">{t(`${data.project} ekibi görüşme bilgilerini e-posta adresinize iletecek.`, `The ${data.project} team will send the meeting details to your email address.`)}</p>
      {voice && done.callConsentSaved === false && <p role="alert" className="booking-error">{t('Randevunuz alındı ancak arama onayınız kaydedilemedi; sizi telefonla aramayacağız.', 'You are booked, but your call consent could not be saved; we will not call you.')}</p>}
      <a className="booking-button" href={ics(done)} download="randevu.ics"><CalendarPlus size={16} aria-hidden="true" />{t('Takvimime ekle', 'Add to my calendar')}</a></section>
    : <>{voice && <VoiceAssistantConsent lang={tr ? 'tr' : 'en'} region={voice.region} business={data.project} call={body => call({ key, ...body })} />}<section className="analysis-card">
      <p className="analysis-eyebrow"><Clock size={14} aria-hidden="true" /> {t(`${data.durationMin} dakikalık görüşme`, `${data.durationMin}-minute meeting`)}</p><h1>{data.title}</h1>
      <p className="analysis-note">{t('Saatler kendi saat diliminize göre gösterilir.', 'Times are shown in your own time zone.')}</p>
      {days.length ? <div className="booking-days">{days.map(([day, items]) => <div key={day} className="booking-day"><h2>{day}</h2><div className="booking-times">{items.map(item => <button key={item} type="button" aria-pressed={slot === item} className={slot === item ? 'is-selected' : ''} onClick={() => setSlot(item)}>{time(item)}</button>)}</div></div>)}</div>
        : <p>{t('Şu an uygun saat yok. Daha sonra tekrar bakın.', 'No free time right now. Please check again later.')}</p>}
      {slot && <form className="booking-form" onSubmit={event => void book(event)}>
        <h2>{new Date(slot).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</h2>
        <label>{t('Adınız soyadınız', 'Your name')}<input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>{t('E-posta', 'Email')}<input required type="email" maxLength={120} autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
        <label>{t('Firma (isteğe bağlı)', 'Company (optional)')}<input maxLength={120} autoComplete="organization" value={form.company} onChange={event => setForm({ ...form, company: event.target.value })} /></label>
        <label>{t('Not (isteğe bağlı)', 'Note (optional)')}<textarea rows={3} maxLength={500} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /></label>
        {voice && <>
          <label>{t('Telefon (isteğe bağlı, aranmak isterseniz)', 'Phone (optional, if you want a call)')}<input type="tel" maxLength={24} autoComplete="tel" placeholder="+90 5xx xxx xx xx" required={calls.callConsent || calls.iysCallConsent} value={calls.phone} onChange={event => setCalls({ ...calls, phone: event.target.value })} /></label>
          <label className="booking-consent"><input type="checkbox" checked={calls.callConsent} onChange={event => setCalls({ ...calls, callConsent: event.target.checked })} /><span>{fillVoiceText(currentVoiceText('call_informational', tr ? 'tr' : 'en').checkbox || '', { 'İşletme adı': data.project })}</span></label>
          <label className="booking-consent"><input type="checkbox" checked={calls.iysCallConsent} onChange={event => setCalls({ ...calls, iysCallConsent: event.target.checked })} /><span>{currentVoiceText('call_commercial', tr ? 'tr' : 'en').checkbox}</span></label>
        </>}
        <label className="booking-consent"><input type="checkbox" required checked={form.consent} onChange={event => setForm({ ...form, consent: event.target.checked })} /><span>{BOOKING_NOTICE[tr ? 0 : 1]}</span></label>
        {error && <p role="alert" className="booking-error">{error}</p>}
        <button type="submit" className="booking-button" disabled={busy || !form.consent}>{busy ? <Loader2 size={16} className="animate-spin" /> : <CalendarCheck size={16} aria-hidden="true" />}{t('Randevuyu onayla', 'Confirm the booking')}</button>
      </form>}
    </section></>}
    <footer className="analysis-foot"><p className="analysis-note">{t('Bu sayfa Ryzevo ile hazırlandı.', 'This page was made with Ryzevo.')}</p></footer>
  </main>;
}
