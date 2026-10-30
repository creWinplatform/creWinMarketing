'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, Target } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { copyText } from '@/lib/client-copy';
import { ATTRIBUTION_COOKIE, ATTRIBUTION_SERVER_EXAMPLE, ATTRIBUTION_SNIPPET, ATTRIBUTION_WINDOW_DAYS, type AttributionSettingsView } from '@/lib/platform/attribution-types';
import Msg from '@/components/Msg';

const FIELD = `"attribution": {
  "campaign": "rz_1a2b3c4d5e",
  "source": "linkedin",
  "medium": "social",
  "touchedAt": "2026-10-30T09:12:00.000Z"
}`;

// How the team's own site and server pass the first tagged link a person arrived through to Ryzevo, and which event
// carries the amount. Nothing here sends anything: the snippet writes one first-party cookie after consent.
export default function AttributionSetup({ lang }: { lang: Locale }) {
  const tr = lang === 'tr';
  const [view, setView] = useState<AttributionSettingsView | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState('');
  const [connectionId, setConnection] = useState(''), [eventName, setEvent] = useState(''), [valueKey, setKey] = useState(''), [currency, setCurrency] = useState('TRY');
  const mounted = useRef(false);
  const apply = (value: AttributionSettingsView) => { setView(value); setConnection(value.valueConnectionId || ''); setEvent(value.valueEvent || ''); setKey(value.valueKey || ''); setCurrency(value.currency || 'TRY'); };
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    projectRequest<AttributionSettingsView>('/api/platform/attribution?view=settings', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(value => { if (mounted.current) apply(value); })
      .catch(reason => { if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : (tr ? 'Kaynak atfı okunamadı.' : 'Could not read source attribution.')); });
    return () => { mounted.current = false; controller.abort(); };
  }, [tr]);
  const copy = async (key: string, value: string) => {
    const ok = await copyText(value, document.querySelector(`[data-copy-id="${key}"]`));
    setCopied(ok ? key : `failed:${key}`); window.setTimeout(() => { if (mounted.current) setCopied(current => current.endsWith(key) ? '' : current); }, ok ? 2500 : 6000);
  };
  const save = async (event: FormEvent, clear = false) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      const value = await projectRequest<AttributionSettingsView>('/api/platform/attribution', { method: 'POST', body: JSON.stringify(clear ? { action: 'save_settings', valueConnectionId: null, valueEvent: null, valueKey: null, currency: null } : { action: 'save_settings', valueConnectionId: connectionId, valueEvent: eventName, valueKey, currency: currency.trim().toUpperCase() }), signal: AbortSignal.timeout(30000) });
      if (mounted.current) { apply(value); setNotice(clear ? (tr ? 'Tutar ayarı kaldırıldı.' : 'Amount setting removed.') : (tr ? 'Tutar ayarı kaydedildi. Bundan sonra gelen olaylara uygulanır.' : 'Amount setting saved. It applies to events received from now on.')); }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : (tr ? 'İstek tamamlanamadı.' : 'Request failed.')); }
    finally { if (mounted.current) setBusy(false); }
  };
  const block = (key: string, label: string, value: string) => <div className="setup-env attribution-code">
    <div className="setup-env-head"><strong>{label}</strong><button type="button" className="studio-text-button" onClick={() => void copy(key, value)} aria-label={tr ? `${label}: kopyala` : `${label}: copy`}><Copy size={13} aria-hidden="true" />{copied === key ? (tr ? 'Kopyalandı' : 'Copied') : (tr ? 'Kopyala' : 'Copy')}</button></div>
    {copied === `failed:${key}` && <span role="status" className="setup-copy-failed">{tr ? 'Tarayıcı kopyalamaya izin vermedi; metin seçildi, Ctrl+C ile kopyalayın.' : 'The browser did not allow copying; the text is selected, press Ctrl+C.'}</span>}
    <pre data-copy-id={key} tabIndex={0}><code>{value}</code></pre></div>;
  const option = view?.options.find(item => item.connectionId === connectionId);
  return <section className="studio-band attribution-setup-panel" aria-labelledby="attribution-setup-title" aria-busy={busy}>
    <div className="studio-section-title"><h3 id="attribution-setup-title"><Target size={16} aria-hidden="true" />{tr ? 'Kaynak etiketi: hangi iş müşteri getirdi' : 'Source tag: which work brought customers'}</h3></div>
    <p className="studio-note">{tr
      ? `Ryzevo, paylaşım ve e-postalardaki kendi site bağlantılarınıza utm_campaign=rz_… etiketi ekler. Aşağıdaki kod parçası, ziyaretçinin ilk geldiği etiketi sitenizin kendi çerezinde (${ATTRIBUTION_COOKIE}, 90 gün) tutar. Kayıt olayında bu çerezi okuyup olaya “attribution” alanı olarak ekleyin; aynı kişinin sonraki olayları (aktivasyon, ödeme) etiketsiz gelse de ${ATTRIBUTION_WINDOW_DAYS} gün boyunca o etikete sayılır.`
      : `Ryzevo adds a utm_campaign=rz_… tag to links to your own site in posts and emails. The snippet below keeps the first tag a visitor arrived with in your site's own cookie (${ATTRIBUTION_COOKIE}, 90 days). Read the cookie in your signup event and add it as the “attribution” field; the same person's later events (activation, payment) count for that tag for ${ATTRIBUTION_WINDOW_DAYS} days even without it.`}</p>
    <ol className="attribution-steps">
      <li>{tr ? 'Kod parçasını sitenizin tüm sayfalarına ekleyin. Çerez onayı gelmeden hiçbir şey yazmaz: onay bannerınız kabul edildiğinde ryzevoTouch.allow() çağırın. Onayı sunucuda topluyorsanız data-consent="granted" yazın. Uygulamanız alt alan adındaysa data-domain=".alanadiniz.com" ekleyin.' : 'Add the snippet to every page of your site. It writes nothing before consent: call ryzevoTouch.allow() when your consent banner is accepted. If you collect consent on the server, set data-consent="granted". If your app is on a subdomain, add data-domain=".yourdomain.com".'}</li>
      <li>{tr ? 'Kayıt olayını gönderirken çerezi okuyup olaya ekleyin (sunucu örneği).' : 'When sending the signup event, read the cookie and add it (server example).'}</li>
      <li>{tr ? 'Aynı kişi için tüm kaynaklarda aynı kayıt türünü ve kimliği kullanın; ödeme olayı başka bir kaynaktan gelse de eşleşir.' : 'Use the same entity type and id for the person in every source; a payment event from another source still matches.'}</li>
    </ol>
    {block('snippet', tr ? 'Site kod parçası' : 'Site snippet', ATTRIBUTION_SNIPPET)}
    {block('server', tr ? 'Sunucu örneği (Node)' : 'Server example (Node)', ATTRIBUTION_SERVER_EXAMPLE)}
    {block('field', tr ? 'Olaydaki alan' : 'Field on the event', FIELD)}
    <p className="studio-note">{tr ? 'Biçimi bozuk bir etiket olayı reddettirmez; yalnız etiket yok sayılır. Örnek yüke bu alanı ekleyip “Şemayı önizle” ile deneyebilirsiniz.' : 'A malformed tag never rejects the event; only the tag is ignored. Add this field to the sample payload and use “Preview schema” to try it.'}</p>
    {error && <p role="alert" className="studio-error"><Msg text={error} /></p>}{notice && <p role="status" className="studio-success">{notice}</p>}
    {view?.canManage && view.options.length > 0 && <form className="studio-form-grid attribution-value" onSubmit={event => void save(event)}>
      <p className="studio-form-full"><strong>{tr ? 'Tutar (isteğe bağlı)' : 'Amount (optional)'}</strong> <span className="studio-note">{tr ? 'Ödeme olayınızda tutarı taşıyan sayısal alanı seçin; rapor, etiket başına toplamı gösterir. Para birimi dönüştürülmez.' : 'Choose the numeric attribute that carries the amount on your payment event; the report shows the total per tag. Currencies are not converted.'}</span></p>
      <label>{tr ? 'Kaynak' : 'Source'}<select value={connectionId} disabled={busy} onChange={event => { setConnection(event.target.value); setEvent(''); setKey(''); }}><option value="">{tr ? 'Seçin' : 'Choose'}</option>{view.options.map(item => <option key={item.connectionId} value={item.connectionId}>{item.name}</option>)}</select></label>
      <label>{tr ? 'Ödeme olayı' : 'Payment event'}<select value={eventName} disabled={busy || !option} onChange={event => setEvent(event.target.value)}><option value="">{tr ? 'Seçin' : 'Choose'}</option>{option?.eventNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>{tr ? 'Tutar alanı (sayı)' : 'Amount attribute (number)'}<select value={valueKey} disabled={busy || !option} onChange={event => setKey(event.target.value)}><option value="">{tr ? 'Seçin' : 'Choose'}</option>{option?.numberKeys.map(key => <option key={key} value={key}>{key}</option>)}</select>
        {option && !option.numberKeys.length && <small>{tr ? 'Bu kaynakta sayı türünde özellik yok.' : 'This source has no number attribute.'}</small>}</label>
      <label>{tr ? 'Para birimi' : 'Currency'}<input value={currency} maxLength={3} pattern="[A-Za-z]{3}" disabled={busy} onChange={event => setCurrency(event.target.value.toUpperCase())} /></label>
      <div className="studio-form-actions studio-form-full">
        {view.valueConnectionId && <button type="button" className="studio-secondary" disabled={busy} onClick={event => void save(event as unknown as FormEvent, true)}>{tr ? 'Tutar ayarını kaldır' : 'Remove amount setting'}</button>}
        <button className="studio-primary" disabled={busy || !connectionId || !eventName || !valueKey || !/^[A-Z]{3}$/.test(currency)}>{tr ? 'Kaydet' : 'Save'}</button></div>
    </form>}
  </section>;
}
