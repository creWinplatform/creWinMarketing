'use client';
import { useEffect, useState } from 'react';
import { Mic, Loader2 } from 'lucide-react';
import { VOICE_AGENT_OPENING, currentVoiceText, fillVoiceText, voiceFills } from '@/lib/platform/voice-consent-texts';
import type { VoiceRegion } from '@/lib/platform/voice-features';

// The assistant notice on the booking page and the voice-processing consent asked before the first use. Rendered only
// while voice features are on (BookingPage gets `voice` from the server page). The visitor is a random id made in this
// browser tab (sessionStorage), not a device fingerprint; it ends with the tab. Consent and withdrawal are both kept
// server side as new lines (lib/platform/voice-consent.ts).
const VISITOR_KEY = 'ryzevo_voice_visitor';
const storedVisitor = () => { try { return sessionStorage.getItem(VISITOR_KEY) || ''; } catch { return ''; } };
const newVisitor = () => { const id = crypto.randomUUID(); try { sessionStorage.setItem(VISITOR_KEY, id); } catch { /* private mode: this page only */ } return id; };

export default function VoiceAssistantConsent({ lang, region, business, call }: { lang: 'tr' | 'en'; region: VoiceRegion; business: string; call: (body: Record<string, unknown>) => Promise<{ granted?: boolean }> }) {
  const tr = lang === 'tr', t = (a: string, b: string) => tr ? a : b;
  const [visitor, setVisitor] = useState(''), [open, setOpen] = useState(false), [checked, setChecked] = useState(false), [granted, setGranted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const text = currentVoiceText('voice_assistant', lang), fills = voiceFills(region, { 'İşletme adı': business });
  useEffect(() => {
    const id = storedVisitor(); if (!id) return;
    setVisitor(id); call({ action: 'voice_status', visitor: id, lang }).then(value => setGranted(Boolean(value.granted))).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = async (action: 'voice_consent' | 'voice_withdraw') => {
    if (busy) return; setBusy(true); setError('');
    try { const id = visitor || newVisitor(); setVisitor(id); const value = await call({ action, visitor: id, lang, consent: action === 'voice_consent' ? checked : undefined }); setGranted(Boolean(value.granted)); setOpen(false); setChecked(false); }
    catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : t('Kaydedilemedi. Lütfen tekrar deneyin.', 'Could not be saved. Please try again.')); }
    finally { setBusy(false); }
  };
  return <section className="analysis-card voice-assistant" aria-labelledby="voice-assistant-title">
    <p className="analysis-eyebrow" id="voice-assistant-title"><Mic size={14} aria-hidden="true" /> {t('Yapay zekâ asistanı', 'AI assistant')}</p>
    <p>{fillVoiceText(VOICE_AGENT_OPENING[lang], fills)}</p>
    {granted ? <>
      <p className="analysis-note" role="status">{t('Sesli asistan için onayınız kayıtlı.', 'Your consent for the voice assistant is on record.')}</p>
      <button type="button" className="booking-button" disabled={busy} onClick={() => void decide('voice_withdraw')}>{busy && <Loader2 size={16} className="animate-spin" />}{t('Onayımı geri al', 'Withdraw my consent')}</button>
    </> : open ? <div className="booking-form">
      <p>{fillVoiceText(text.body, fills)}</p>
      <label className="booking-consent"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /><span>{text.checkbox}</span></label>
      <button type="button" className="booking-button" disabled={busy || !checked} onClick={() => void decide('voice_consent')}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} aria-hidden="true" />}{t('Onayla ve sesli devam et', 'Consent and continue by voice')}</button>
      <button type="button" className="booking-button" disabled={busy} onClick={() => setOpen(false)}>{t('Yazarak devam et', 'Continue by typing')}</button>
    </div> : <button type="button" className="booking-button" onClick={() => setOpen(true)}><Mic size={16} aria-hidden="true" />{t('Sesli asistanı kullan', 'Use the voice assistant')}</button>}
    {error && <p role="alert" className="booking-error">{error}</p>}
  </section>;
}
