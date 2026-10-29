'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '@/lib/platform/catalog';
import MetaConnection from './MetaConnection';
import XConnection from './XConnection';
import LinkedInOrganizationConnection from './LinkedInOrganizationConnection';
import { ConnectionGuidePanel, ProviderGuideButton } from './GrowthCompass';
import { translateMessage } from '@/lib/i18n/messages';

type Connection = { id: string; provider: string; integrationId: string; accountName: string; status: string; verificationMessage?: string };
type Job = { id: string; connectionId: string; status: string; message: string };
// crewin: the Crewin workspace connects only Google (Search Console, GA4) and Meta (inbox) here; its social posting, email
// and WhatsApp keep their own tools. Its requests ask for the Ryzevo store explicitly (?store=ryzevo).
export default function ProjectConnections({ lang, crewin = false }: { lang: Locale; crewin?: boolean }) {
  const tr = lang === 'tr', store = crewin ? '?store=ryzevo' : '';
  const failed = tr ? 'İstek tamamlanamadı.' : 'Request failed.';
  const [items, setItems] = useState<Connection[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [provider, setProvider] = useState('email');
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [googleProvider, setGoogleProvider] = useState('ga4');
  const [oauthResult, setOauthResult] = useState('');
  const [linkedinConfigured, setLinkedinConfigured] = useState(false);
  const [socialResult, setSocialResult] = useState('');
  const [requestedProvider,setRequestedProvider]=useState('');
  useEffect(()=>{const value=new URLSearchParams(window.location.search).get('guideProvider')||'';setRequestedProvider(value);if(['ga4','search_console'].includes(value))setGoogleProvider(value);},[]);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/marketing/connections${store}`, { cache: 'no-store' });
      if (response.status === 403) { setAllowed(false); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || failed);
      setItems(data.items.filter((item:Connection)=>!['product_rest','product_webhook','mobile'].includes(item.provider))); setAllowed(true);
      const jobResponse = await fetch(`/api/marketing/automation${store}`, { cache: 'no-store' });
      if (jobResponse.ok) setJobs((await jobResponse.json()).items.filter((job:Job & {jobType?:string})=>job.jobType!=='product.sync'));
      const googleResponse = await fetch('/api/platform/google', { cache: 'no-store' });
      if (googleResponse.ok) setGoogleConfigured((await googleResponse.json()).configured);
      // LinkedIn is not connected here in the Crewin workspace, so its server setting is not read.
      if (!crewin) { const socialResponse = await fetch('/api/platform/social', { cache: 'no-store' }); if (socialResponse.ok) setLinkedinConfigured((await socialResponse.json()).linkedinConfigured); }
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); }
  }, [failed, store, crewin]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const url = new URL(window.location.href), result = url.searchParams.get('googleConnection'), social = url.searchParams.get('socialConnection');
    if (result) {
      setOauthResult(result === 'connected' ? 'connected' : 'failed');
      url.searchParams.delete('googleConnection');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    if (social) {
      setSocialResult(social === 'connected' ? 'connected' : 'failed');
      url.searchParams.delete('socialConnection'); window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, []);
  const connectGoogle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/platform/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || failed);
      const url = new URL(data.authorizationUrl);
      if (url.origin !== 'https://accounts.google.com') throw new Error(tr ? 'Google yetkilendirme adresi geçersiz.' : 'Invalid Google authorization URL.');
      window.location.assign(url.href);
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); setBusy(false); }
  };
  const connectLinkedIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const formData=new FormData(event.currentTarget);
      const response = await fetch('/api/platform/social', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(formData), publishing:formData.has('publishing'), platform: 'linkedin' }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || failed);
      const url = new URL(data.authorizationUrl);
      if (url.origin !== 'https://www.linkedin.com') throw new Error(tr ? 'LinkedIn yetkilendirme adresi geçersiz.' : 'Invalid LinkedIn authorization URL.');
      window.location.assign(url.href);
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); setBusy(false); }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError('');
    try {
      const fields = Object.fromEntries(new FormData(form));
      const payload = fields.provider === 'email' ? {
        provider: fields.provider, integrationId: fields.integrationId, accountName: fields.accountName, accessToken: fields.accessToken,
        smtp: { host: fields.smtpHost, port: Number(fields.smtpPort), user: fields.smtpUser, fromEmail: fields.fromEmail, fromName: fields.fromName },
      } : fields.provider === 'social' ? { provider: fields.provider, integrationId: fields.integrationId, accountName: fields.accountName, accessToken: fields.accessToken, social: { platform: fields.socialPlatform, accountId: fields.socialAccountId } } : fields;
      const response = await fetch(`/api/marketing/connections${store}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || failed);
      form.reset(); await load();
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/marketing/connections${store}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke', id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || failed);
      await load();
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); }
    finally { setBusy(false); }
  };
  const verify = async (connectionId: string) => {
    setBusy(true); setError('');
    const post = async (body: object) => {
      const response = await fetch(`/api/marketing/automation${store}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || failed);
      return data as Job;
    };
    try {
      const pending = jobs.find(job => job.connectionId === connectionId && ['queued', 'running'].includes(job.status));
      const job = pending || await post({ jobType: 'connection.verify', connectionId, idempotencyKey: crypto.randomUUID() });
      await load();
      const result = await post({ action: 'run', id: job.id });
      if (result.status === 'failed') setError(result.message || (tr ? 'Doğrulama başarısız.' : 'Verification failed.'));
      await load();
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); await load(); }
    finally { setBusy(false); }
  };
  const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
  return <section className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-700"><h2 className="text-base font-semibold">{tr ? 'Proje bağlantıları' : 'Project connections'}</h2>
    <ConnectionGuidePanel lang={lang}/>
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{translateMessage(error, lang)}</p>}
    {socialResult && <p role="status" className={socialResult === 'connected' ? 'text-sm text-emerald-600 dark:text-emerald-300' : 'text-sm text-red-600 dark:text-red-300'}>{socialResult === 'connected' ? (tr ? 'LinkedIn bağlantısı kaydedildi. Hesap erişimini test edebilirsiniz.' : 'LinkedIn connection saved. You can test account access.') : (tr ? 'LinkedIn bağlantısı tamamlanamadı. Proje ve hesap izinlerini kontrol ederek yeniden deneyin.' : 'LinkedIn connection failed. Check project and account permissions, then retry.')}</p>}
    {oauthResult && <p role="status" className={oauthResult === 'connected' ? 'text-sm text-emerald-600 dark:text-emerald-300' : 'text-sm text-red-600 dark:text-red-300'}>{oauthResult === 'connected' ? (tr ? 'Google bağlantısı kaydedildi. Mülk erişimini test edebilirsiniz.' : 'Google connection saved. You can test property access.') : (tr ? 'Google bağlantısı tamamlanamadı. Aktif projenizi ve Google mülk izinlerinizi kontrol edip yeniden deneyin.' : 'Google connection failed. Check your active project and property permissions, then retry.')}</p>}
    {allowed ? <>
      <MetaConnection lang={lang} onSaved={load} requestedProvider={requestedProvider}/>
      {crewin && <p className="text-sm text-slate-500">{tr ? 'Crewin’in sosyal paylaşımları, e-postası ve WhatsApp’ı kendi sekmelerinden çalışır. Buradaki bağlantılar yalnız Ryzevo özellikleri içindir: Google (Search Console, GA4) ölçüm ve SEO takibine, Meta gelen kutusuna veri verir.' : 'Crewin’s social posts, email and WhatsApp run from their own tabs. These connections are only for the Ryzevo features: Google (Search Console, GA4) feeds measurements and SEO tracking, Meta feeds the inbox.'}</p>}
      {!crewin && <XConnection lang={lang} requestedProvider={requestedProvider}/>}
      {!crewin && <LinkedInOrganizationConnection lang={lang} onSaved={load} requestedProvider={requestedProvider}/>}
      {!crewin && <details open={requestedProvider==='linkedin_person'||undefined}><summary className="cursor-pointer text-sm font-medium">{tr ? 'LinkedIn hesabı bağla' : 'Connect LinkedIn account'}</summary><ProviderGuideButton lang={lang} id="linkedin_person"/>{linkedinConfigured ? <form onSubmit={connectLinkedIn} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs">{tr ? 'Hesap adı' : 'Account name'}<input name="accountName" required maxLength={160} className={input} /></label>
        <label className="publication-toggle"><input type="checkbox" name="publishing" />{tr ? 'LinkedIn kişisel hesabımda yayın izni de iste' : 'Also request publishing access to my LinkedIn personal account'}</label>
        <button disabled={busy} className="self-end studio-primary disabled:opacity-50">{tr ? 'LinkedIn ile bağlan' : 'Connect with LinkedIn'}</button>
      </form> : <p className="mt-2 text-sm text-amber-600 dark:text-amber-300">{tr ? 'LinkedIn OAuth henüz sunucuda yapılandırılmadı.' : 'LinkedIn OAuth is not configured on the server yet.'}</p>}</details>}
      <details open={['ga4','search_console'].includes(requestedProvider)||undefined}><summary className="cursor-pointer text-sm font-medium">{tr ? 'Google hesabı bağla' : 'Connect Google account'}</summary><ProviderGuideButton lang={lang} id={googleProvider==='search_console'?'search_console':'ga4'}/>{googleConfigured ? <form onSubmit={connectGoogle} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs">{tr ? 'Google servisi' : 'Google service'}<select name="provider" value={googleProvider} onChange={event => setGoogleProvider(event.target.value)} className={input}><option value="ga4">Google Analytics</option><option value="search_console">Search Console</option></select></label>
        <label className="text-xs">{googleProvider === 'ga4' ? (tr ? 'GA4 mülk kimliği' : 'GA4 property ID') : (tr ? 'Search Console mülkü' : 'Search Console property')}<input name="resource" required maxLength={160} pattern={googleProvider === 'ga4' ? '[0-9]{1,20}' : undefined} placeholder={googleProvider === 'ga4' ? '123456789' : 'sc-domain:example.com'} className={input} /></label>
        <label className="text-xs">{tr ? 'Hesap adı' : 'Account name'}<input name="accountName" required maxLength={160} className={input} /></label>
        <button disabled={busy} className="self-end studio-primary disabled:opacity-50">{tr ? 'Google ile bağlan' : 'Connect with Google'}</button>
      </form> : <p className="mt-2 text-sm text-amber-600 dark:text-amber-300">{tr ? 'Google OAuth henüz sunucuda yapılandırılmadı.' : 'Google OAuth is not configured on the server yet.'}</p>}</details>
      <div aria-live="polite" className="divide-y divide-slate-200 dark:divide-slate-700">{items.map(item => {
        const pending = jobs.find(job => job.connectionId === item.id && ['queued', 'running'].includes(job.status));
        const labels: Record<string, string> = tr ? { revoked: 'İptal edildi', verified: 'Erişim doğrulandı', failed: 'Doğrulama başarısız', unsupported: 'Adaptör bekleniyor', verification_expired: 'Yeniden doğrulama gerekli', configured_not_verified: 'Doğrulama bekliyor' } : { revoked: 'Revoked', verified: 'Access verified', failed: 'Verification failed', unsupported: 'Adapter pending', verification_expired: 'Reverification required', configured_not_verified: 'Awaiting verification' };
        return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{item.accountName}</p><p className="text-xs text-slate-500">{item.provider} · {pending ? (tr ? 'Kontrol sürüyor' : 'Check pending') : (labels[item.status] ?? item.status)}</p>{item.verificationMessage && <p className="mt-1 text-xs text-slate-500">{translateMessage(item.verificationMessage, lang)}</p>}</div>{item.status !== 'revoked' && <div className="flex flex-wrap gap-2">{['ga4', 'search_console', 'email', 'social'].includes(item.provider) && <button disabled={busy} onClick={() => void verify(item.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600">{busy ? (tr ? 'Kontrol ediliyor…' : 'Checking…') : pending ? (tr ? 'Kontrole devam et' : 'Resume check') : (tr ? 'Erişimi test et' : 'Test access')}</button>}<button disabled={busy} onClick={() => void revoke(item.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600">{tr ? 'Bağlantıyı iptal et' : 'Revoke connection'}</button></div>}</div>;
      })}{!items.length && <p className="py-3 text-sm text-slate-500">{tr ? 'Henüz bağlantı eklenmedi.' : 'No connections yet.'}</p>}</div>
      {!crewin && <details><summary className="cursor-pointer text-sm font-medium">{tr ? 'Bağlantı bilgisi ekle' : 'Add connection details'}</summary><form onSubmit={save} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs">{tr ? 'Sağlayıcı' : 'Provider'}<select name="provider" value={provider} onChange={event => setProvider(event.target.value)} className={input}><option value="email">{tr ? 'E-posta (SMTP)' : 'Email (SMTP)'}</option><option value="ga4">Google Analytics</option><option value="search_console">Search Console</option><option value="social">{tr ? 'Sosyal' : 'Social'}</option></select></label>
        {provider !== 'social' && <label className="text-xs">{provider === 'ga4' ? (tr ? 'GA4 mülk kimliği' : 'GA4 property ID') : provider === 'search_console' ? (tr ? 'Search Console mülkü' : 'Search Console property') : (tr ? 'Bağlantı adı' : 'Connection name')}<input required maxLength={160} name="integrationId" placeholder={provider === 'ga4' ? '123456789' : provider === 'search_console' ? 'sc-domain:example.com' : ''} className={input} /></label>}
        <label className="text-xs">{tr ? 'Hesap adı' : 'Account name'}<input required maxLength={160} name="accountName" className={input} /></label>
        {provider === 'email' && <>
          <label className="text-xs">{tr ? 'SMTP sunucusu' : 'SMTP host'}<input required name="smtpHost" maxLength={253} placeholder="email-smtp.eu-west-1.amazonaws.com" className={input} /></label>
          <label className="text-xs">{tr ? 'SMTP portu' : 'SMTP port'}<select name="smtpPort" defaultValue="587" className={input}><option value="587">587 (STARTTLS)</option><option value="465">465 (TLS)</option></select></label>
          <label className="text-xs">{tr ? 'SMTP kullanıcı adı' : 'SMTP username'}<input required name="smtpUser" maxLength={320} autoComplete="off" className={input} /></label>
          <label className="text-xs">{tr ? 'Gönderen e-posta' : 'Sender email'}<input required type="email" name="fromEmail" maxLength={254} className={input} /></label>
          <label className="text-xs">{tr ? 'Gönderen adı' : 'Sender name'}<input name="fromName" maxLength={160} className={input} /></label>
        </>}
        {provider === 'social' && <>
          <label className="text-xs">{tr ? 'Sosyal platform' : 'Social platform'}<select name="socialPlatform" className={input}><option value="linkedin">LinkedIn</option><option value="twitter">X / Twitter</option><option value="telegram">{tr ? 'Telegram kanalı (bot)' : 'Telegram channel (bot)'}</option></select></label>
          <label className="text-xs">{tr ? 'Hesap kimliği' : 'Account ID'}<input name="socialAccountId" required maxLength={128} className={input} /></label>
          <p className="text-xs text-slate-500 md:col-span-2">{tr ? 'Telegram için: BotFather ile bir bot oluşturun, botu kanalınıza “Mesaj gönder” izniyle yönetici olarak ekleyin. Hesap kimliğine kanalın @kullanıcı adını (veya -100… kimliğini), erişim anahtarına bot token’ını yazın. Bot yalnız bu kanala yayın yapar; özel sohbet veya grup okumaz.' : 'For Telegram: create a bot with BotFather and add it to your channel as an administrator with “Post messages”. Enter the channel’s @username (or its -100… id) as the account ID and the bot token as the access token. The bot only posts to this channel; it never reads private chats or groups.'}</p>
        </>}
        <label className="text-xs">{provider === 'email' ? (tr ? 'SMTP parolası' : 'SMTP password') : (tr ? 'Erişim anahtarı' : 'Access token')}<input required type="password" maxLength={16384} autoComplete="new-password" name="accessToken" className={input} /></label>
        {!['email', 'social'].includes(provider) && <label className="text-xs">{tr ? 'Yenileme anahtarı (isteğe bağlı)' : 'Refresh token (optional)'}<input type="password" maxLength={16384} autoComplete="off" name="refreshToken" className={input} /></label>}
        <button disabled={busy} className="self-end studio-primary disabled:opacity-50">{tr ? 'Bağlantı bilgisini kaydet' : 'Save connection details'}</button>
      </form></details>}</> : <p className="text-xs text-slate-500">{tr ? 'Bağlantı yönetimi için sahip veya yönetici yetkisi gerekir.' : 'Connection management requires an owner or admin role.'}</p>}
  </section>;
}
