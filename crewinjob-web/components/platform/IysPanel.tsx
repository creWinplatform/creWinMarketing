'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { IysView } from '@/lib/platform/iys-types';
import Msg from '@/components/Msg';

type QueryResult = { checked: number; onay: number; ret: number; none: number; view: IysView };
// Sending consents (İYS): the project's declaration, its İYS API user, what İYS reported for the recipients a live
// send could reach, and the consents and opt-outs waiting to be reported within three business days.
// crewin: the Crewin workspace, where only its own WhatsApp sender checks İYS (lib/crewin-iys.ts).
export default function IysPanel({ lang, crewin = false }: { lang: Locale; crewin?: boolean }) {
  const tr = lang === 'tr', locale = localeTag(lang);
  const [view, setView] = useState<IysView | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<'tr' | 'none' | ''>(''), [form, setForm] = useState({ username: '', password: '', iysCode: '', brandCode: '', environment: 'production' });
  const mounted = useRef(false);
  // The status check answers with a view without Crewin's email mode; the last known one is kept.
  const apply = (value: IysView) => { setView(old => value.crewinEmail || !old?.crewinEmail ? value : { ...value, crewinEmail: old.crewinEmail }); setScope(value.scope || ''); };
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    projectRequest<IysView>('/api/platform/iys', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(value => { if (mounted.current) apply(value); })
      .catch(reason => { if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : (tr ? 'İYS ayarları okunamadı.' : 'Could not load IYS settings.')); });
    return () => { mounted.current = false; controller.abort(); };
  }, [tr]);
  async function act<T>(body: Record<string, unknown>, done: (value: T) => string, pick: (value: T) => IysView = value => value as unknown as IysView) {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { const value = await projectRequest<T>('/api/platform/iys', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }); if (mounted.current) { apply(pick(value)); setNotice(done(value)); } }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : (tr ? 'İstek tamamlanamadı.' : 'Request failed.')); }
    finally { if (mounted.current) setBusy(false); }
  }
  if (!view) return error ? <p role="alert" className="studio-error"><Msg text={error} /></p> : null;
  const time = (value: string | null) => value ? new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const n = (value: number) => value.toLocaleString(locale);
  const connect = (event: FormEvent) => { event.preventDefault(); void act<IysView>({ action: 'connect', ...form }, () => { setForm(old => ({ ...old, password: '' })); return tr ? 'İYS bağlandı ve marka kodu doğrulandı.' : 'IYS connected and the brand code verified.'; }); };
  return <section className="studio-band iys-panel" aria-labelledby="iys-title" aria-busy={busy}>
    <div className="studio-section-title"><h2 id="iys-title"><ShieldCheck size={16} />{tr ? 'Gönderim izinleri (İYS)' : 'Sending consents (IYS)'}</h2></div>
    <p className="studio-note">{tr
      ? 'Türkiye’deki alıcılara ticari e-posta ve WhatsApp mesajı göndermek için alıcının İYS’de onayı olmalı; yeni izinler ve çıkışlar 3 iş günü içinde İYS’ye bildirilir. Ryzevo bunu gönderim akışının içinde yapar: onayı olmayan alıcıya canlı ileti gitmez.'
      : 'Commercial email and WhatsApp messages to recipients in Turkey need the recipient’s consent in IYS; new consents and opt-outs are reported to IYS within 3 business days. Ryzevo does this inside the send flow: no live message goes to a recipient without consent.'}</p>
    {crewin && <p className="studio-note"><strong>Crewin:</strong> {tr
      ? 'WhatsApp’ta İYS yalnız +90 numaralar için denetlenir; orada kaydedilen izinler ve çıkışlar İYS’ye bildirilir. E-postada (re-aktivasyon, iş eşleşme, kampanya) İYS uyruğu TR olan ya da bilinmeyen alıcılardan aranır; şirket ve prospect kitleleri tacir muafiyetiyle dışarıda kalır. Kayıttaki e-posta izinlerini İYS’ye bildirmek Crewin backend’inin işidir.'
      : 'On WhatsApp, IYS is checked only for +90 numbers; consents and opt-outs recorded there are reported to IYS. On email (reactivation, job match, campaigns), IYS is required for recipients whose nationality is TR or unknown; company and prospect audiences are left out under the merchant exemption. Reporting the email consents given at sign-up to IYS is the Crewin backend’s job.'}</p>}
    {crewin && view.crewinEmail && <div className="iys-connection">
      <p><strong>{tr ? 'Crewin e-postası' : 'Crewin email'}</strong> · {view.crewinEmail.mode === 'enforce'
        ? (tr ? 'Zorunlu: İYS onayı olmayan alıcıya ticari e-posta gitmez.' : 'Enforced: no commercial email goes to a recipient without IYS consent.')
        : (tr ? 'Ölçüm: e-postalar gider; her gönderim, İYS zorunlu olsaydı kaç alıcının atlanacağını gösterir.' : 'Measuring: emails still go; each send shows how many recipients IYS would have stopped.')}
        {view.crewinEmail.at ? ` · ${view.crewinEmail.by || '—'} · ${time(view.crewinEmail.at)}` : ''}</p>
      <p className="studio-note">{tr ? `İYS’de sorgulanmayı bekleyen adres: ${n(view.crewinEmail.pending)}. Worker her çalışmada en çok 50 adres sorgular; durumu bilinen alıcıları değişiklik akışı güncel tutar.` : `Addresses waiting for an IYS check: ${n(view.crewinEmail.pending)}. The worker checks up to 50 per run; the change feed keeps known recipients current.`}</p>
      {view.canManage && <button type="button" className="studio-secondary" disabled={busy} onClick={() => {
        const next = view.crewinEmail?.mode === 'enforce' ? 'measure' : 'enforce';
        if (next === 'enforce' && !window.confirm(tr ? 'Zorunlu moda geçilsin mi? İYS onayı görünmeyen (uyruğu TR ya da bilinmeyen) alıcılara ticari e-posta gitmez.' : 'Switch to enforce? Recipients (nationality TR or unknown) without an IYS consent get no commercial email.')) return;
        void act<IysView>({ action: 'crewin_email_mode', mode: next }, () => next === 'enforce' ? (tr ? 'Crewin e-postası artık İYS’ye uyuyor.' : 'Crewin email now follows IYS.') : (tr ? 'Crewin e-postası ölçüm moduna döndü.' : 'Crewin email is back in measure mode.'));
      }}>{view.crewinEmail.mode === 'enforce' ? (tr ? 'Ölçüm moduna dön' : 'Back to measuring') : (tr ? 'Zorunlu moda geç' : 'Switch to enforce')}</button>}
    </div>}
    {error && <p role="alert" className="studio-error"><Msg text={error} /></p>}{notice && <p role="status" className="studio-success"><Msg text={notice} /></p>}
    <fieldset className="iys-declare" disabled={busy || !view.canManage}><legend>{tr ? 'Türkiye’deki alıcılara ticari ileti gönderiyor musunuz?' : 'Do you send commercial messages to recipients in Turkey?'}</legend>
      <label><input type="radio" name="iys-scope" checked={scope === 'tr'} onChange={() => setScope('tr')} />{tr ? 'Evet: İYS kontrolü zorunlu' : 'Yes: IYS checks are required'}</label>
      <label><input type="radio" name="iys-scope" checked={scope === 'none'} onChange={() => setScope('none')} />{tr ? 'Hayır: Türkiye’deki alıcılara ticari ileti göndermiyoruz' : 'No: we send no commercial messages to recipients in Turkey'}</label>
      {view.canManage && <button type="button" className="studio-secondary" disabled={!scope || scope === view.scope} onClick={() => void act<IysView>({ action: 'declare', scope }, () => tr ? 'Beyan kaydedildi.' : 'Declaration saved.')}>{tr ? 'Beyanı kaydet' : 'Save declaration'}</button>}
      <p className="studio-note">{view.scope ? (tr ? `Kayıtlı beyan: ${view.scope === 'tr' ? 'Evet' : 'Hayır'} · ${view.declaredBy || '—'} · ${time(view.declaredAt)}.${view.scope === 'none' ? ' “Hayır” beyanı sizin sorumluluğunuzdadır.' : ''}` : `Recorded: ${view.scope === 'tr' ? 'Yes' : 'No'} · ${view.declaredBy || '—'} · ${time(view.declaredAt)}.${view.scope === 'none' ? ' A “No” is your own statement.' : ''}`)
        : crewin
          ? (tr ? 'Beyan yapılana kadar Crewin WhatsApp gönderimi kapalıdır; e-posta ölçüm modunda gider, zorunlu modda o da durur.' : 'Until you declare, Crewin WhatsApp sending stays off; email still goes in measure mode and stops in enforce mode.')
          : (tr ? 'Beyan yapılana kadar canlı e-posta ve WhatsApp gönderimi kapalıdır; provalar çalışır.' : 'Until you declare, live email and WhatsApp sending stays off; rehearsals still work.')}</p>
    </fieldset>
    {view.scope === 'tr' && <>
      {view.connection ? <div className="iys-connection">
        <p><strong>{tr ? 'Bağlı İYS hesabı' : 'Connected IYS account'}</strong> · {view.connection.environment === 'sandbox' ? (tr ? 'Sandbox' : 'Sandbox') : (tr ? 'Canlı' : 'Live')}{view.canManage ? ` · İYS ${view.connection.iysCode} · ${tr ? 'marka' : 'brand'} ${view.connection.brandCode}` : ''} · {time(view.connection.connectedAt)}</p>
        {view.canManage && <button type="button" className="studio-text-button" disabled={busy} onClick={() => { if (window.confirm(tr ? 'İYS bağlantısı kaldırılsın mı? Türkiye’deki alıcılara canlı gönderim durur.' : 'Remove the IYS connection? Live sending to recipients in Turkey stops.')) void act<IysView>({ action: 'revoke' }, () => tr ? 'İYS bağlantısı kaldırıldı.' : 'IYS connection removed.'); }}><Unplug size={14} />{tr ? 'Bağlantıyı kaldır' : 'Remove connection'}</button>}
      </div> : view.canManage ? <form className="studio-form-grid iys-connect" onSubmit={connect}>
        <p className="studio-form-full studio-note">{tr ? 'İYS panelinde (iys.org.tr) markanız için bir API kullanıcısı oluşturun. Şifre şifreli saklanır ve bir daha gösterilmez.' : 'Create an API user for your brand in the IYS panel (iys.org.tr). The password is stored encrypted and never shown again.'}</p>
        <label>{tr ? 'İYS API kullanıcı adı' : 'IYS API username'}<input required autoComplete="off" maxLength={200} value={form.username} onChange={event => setForm(old => ({ ...old, username: event.target.value }))} /></label>
        <label>{tr ? 'Şifre' : 'Password'}<input required type="password" autoComplete="new-password" maxLength={500} value={form.password} onChange={event => setForm(old => ({ ...old, password: event.target.value }))} /></label>
        <label>{tr ? 'İYS kodu' : 'IYS code'}<input required inputMode="numeric" pattern="\d{3,20}" value={form.iysCode} onChange={event => setForm(old => ({ ...old, iysCode: event.target.value.trim() }))} /></label>
        <label>{tr ? 'Marka kodu' : 'Brand code'}<input required inputMode="numeric" pattern="\d{3,20}" value={form.brandCode} onChange={event => setForm(old => ({ ...old, brandCode: event.target.value.trim() }))} /></label>
        <label>{tr ? 'Ortam' : 'Environment'}<select value={form.environment} onChange={event => setForm(old => ({ ...old, environment: event.target.value }))}><option value="production">{tr ? 'Canlı' : 'Live'}</option><option value="sandbox">Sandbox</option></select></label>
        <div className="studio-form-actions studio-form-full"><button className="studio-primary" disabled={busy}>{tr ? 'Bağla ve doğrula' : 'Connect and verify'}</button></div>
      </form> : <p className="studio-note">{tr ? 'İYS bağlı değil. Bağlantıyı proje sahibi veya yöneticisi yapar.' : 'IYS is not connected. The project owner or an admin connects it.'}</p>}
      {view.connection && <div className="iys-status">
        <p>{view.pull.state === 'failed' ? <span className="studio-error"><Msg text={view.pull.error || (tr ? 'İYS değişiklikleri okunamadı.' : 'IYS changes could not be read.')} /></span>
          : tr ? `İYS değişiklikleri 30 dakikada bir okunur · son okuma: ${time(view.pull.at)}` : `IYS changes are read every 30 minutes · last read: ${time(view.pull.at)}`}</p>
        <dl className="publication-metrics"><div><dt>{tr ? 'E-posta onay / ret' : 'Email consent / rejected'}</dt><dd>{n(view.statuses.EPOSTA.ONAY)} / {n(view.statuses.EPOSTA.RET)}</dd></div><div><dt>{tr ? 'WhatsApp onay / ret' : 'WhatsApp consent / rejected'}</dt><dd>{n(view.statuses.MESAJ.ONAY)} / {n(view.statuses.MESAJ.RET)}</dd></div>
          <div><dt>{tr ? 'Bildirilecek' : 'To report'}</dt><dd>{n(view.outbox.queued)}</dd></div><div><dt>{tr ? 'Bildirildi' : 'Reported'}</dt><dd>{n(view.outbox.sent)}</dd></div><div><dt>{tr ? 'Gönderilemedi' : 'Failed'}</dt><dd>{n(view.outbox.failed)}</dd></div></dl>
        {view.outbox.nextDue && <p className="studio-note">{tr ? `En yakın bildirim son tarihi: ${time(view.outbox.nextDue)}${view.outbox.overdue ? ` · ${n(view.outbox.overdue)} kaydın süresi geçti` : ''}` : `Next reporting deadline: ${time(view.outbox.nextDue)}${view.outbox.overdue ? ` · ${n(view.outbox.overdue)} record(s) are overdue` : ''}`}</p>}
        <button type="button" className="studio-secondary" disabled={busy} onClick={() => void act<QueryResult>({ action: 'query' }, value => tr ? `${n(value.checked)} alıcı İYS’de sorgulandı: ${n(value.onay)} onay, ${n(value.ret)} ret, ${n(value.none)} kaydı yok.` : `${n(value.checked)} recipient(s) checked in IYS: ${n(value.onay)} consented, ${n(value.ret)} rejected, ${n(value.none)} without a record.`, value => value.view)}><RefreshCw size={14} />{tr ? 'Alıcıların İYS durumunu sorgula' : 'Check recipients in IYS'}</button>
        <p className="studio-note">{crewin
          ? (tr ? 'İYS’nin daha önce bilgi verdiği Crewin WhatsApp numaraları yeniden sorgulanır (her seferde en çok 50, en eski önce). Yeni numaraları WhatsApp izinleri bölümünden sorgulayın. Alıcıya hiçbir şey gönderilmez.' : 'Crewin WhatsApp numbers IYS already reported on are checked again (up to 50 at a time, oldest first). Check new numbers from the WhatsApp consents section. Nothing is sent to the recipients.')
          : (tr ? 'Pilot listesindeki e-posta adresleri ve WhatsApp kişileri sorgulanır (her seferde en çok 50, en eski önce). Alıcıya hiçbir şey gönderilmez.' : 'The pilot list’s email addresses and the WhatsApp contacts are checked (up to 50 at a time, oldest first). Nothing is sent to the recipients.')}</p>
      </div>}
      {view.attention.length > 0 && <div className="iys-attention"><h3>{tr ? 'İlgilenmeniz gerekenler' : 'Needs attention'}</h3><ul>{view.attention.map(item => <li key={item.id}>
        <span className="coach-state">{item.channel === 'EPOSTA' ? (tr ? 'E-posta' : 'Email') : 'WhatsApp'} · {item.status === 'ONAY' ? (tr ? 'onay' : 'consent') : (tr ? 'ret' : 'opt-out')}</span>
        <span>{item.masked} · {tr ? 'son tarih' : 'deadline'} {time(item.dueAt)}</span>
        {item.error && <span className="studio-error"><Msg text={item.error} /></span>}
        {item.state === 'failed' && item.masked !== '—' && view.canManage && <button type="button" className="studio-text-button" disabled={busy} onClick={() => void act<IysView>({ action: 'retry', id: item.id }, () => tr ? 'Kayıt yeniden kuyruğa alındı.' : 'The record was queued again.')}>{tr ? 'Yeniden dene' : 'Retry'}</button>}
      </li>)}</ul></div>}
    </>}
    <details className="iys-rules"><summary>{tr ? 'Kurallar ve sınırlar' : 'Rules and limits'}</summary><ul>
      <li>{tr ? 'Alıcılar bireysel (BIREYSEL) sayılır; tacir istisnası kullanılmaz.' : 'Recipients count as individuals (BIREYSEL); the merchant exemption is not used.'}</li>
      <li>{tr ? 'E-posta İYS’de EPOSTA, WhatsApp MESAJ türüdür.' : 'Email is EPOSTA in IYS and WhatsApp is MESAJ.'}</li>
      <li>{tr ? 'Bildirim süresi 3 iş günüdür; hafta sonları atlanır, resmi tatiller sayılmaz (süre hiçbir zaman yasal süreden geç bitmez). 3 iş gününden eski izinler bildirilemez; bu alıcıların İYS durumunu sorgulayın.' : 'The reporting deadline is 3 business days; weekends are skipped and public holidays are not counted (it never ends later than the legal deadline). Consents older than 3 business days cannot be reported; check those recipients in IYS instead.'}</li>
      <li>{tr ? 'Bir alıcının İYS durumu 24 saatten eskiyse ve değişiklikler okunamıyorsa canlı ileti gitmez.' : 'If a recipient’s IYS status is older than 24 hours and changes cannot be read, no live message goes.'}</li>
      <li>{tr ? 'Provalar ve müşterinin başlattığı konuşmalara verilen gelen kutusu yanıtları bu kontrolün dışındadır.' : 'Rehearsals and inbox replies to conversations the customer started are outside this check.'}</li>
      <li>{tr ? 'Bu kuralların işletmenize uygunluğunu hukuk danışmanınızla teyit edin.' : 'Confirm with your legal adviser that these rules fit your business.'}</li>
    </ul></details>
  </section>;
}
