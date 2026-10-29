'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '@/lib/platform/catalog';
import { ProviderGuideButton } from './GrowthCompass';
import { translateMessage } from '@/lib/i18n/messages';
import Msg from '@/components/Msg';
import CallbackOriginNotice from './CallbackOriginNotice';
type Selection = { target: string; publishing?: boolean; items: { id: string; name: string; instagramId: string | null; instagramUsername: string | null }[]; hasMore: boolean; limitReached: boolean };
// inboxDefault: the inbox permission box starts ticked (the Crewin workspace connects Meta only for the inbox).
export default function MetaConnection({ lang, onSaved, requestedProvider, inboxDefault = false, setupHref }: { lang: Locale; onSaved: () => Promise<void>; requestedProvider?:string; inboxDefault?: boolean; setupHref?: string }) {
  const tr = lang === 'tr';
  const failed = tr ? 'İstek tamamlanamadı.' : 'Request failed.';
  const [metaOrigin, setMetaOrigin] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null), [selection, setSelection] = useState<Selection | null>(null), [pageId, setPageId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [target, setTarget] = useState('facebook');
  useEffect(()=>{if(requestedProvider==='facebook'||requestedProvider==='instagram')setTarget(requestedProvider);},[requestedProvider]);
  const load = useCallback(async (more = false) => {
    try {
      const response = await fetch(`/api/platform/meta${more ? '?more=true' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(16000) });
      const data = await response.json();
      setConfigured(data.configured || false); setMetaOrigin(data.configured && data.originOk === false ? data.callbackOrigin || '' : '');
      if (!response.ok) throw new Error(data.error || failed);
      setSelection(data.selection); return true;
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); return false; }
  }, [failed]);
  useEffect(() => {
    const url = new URL(window.location.href), result = url.searchParams.get('metaConnection');
    if (result) {
      if (result === 'failed') setError(tr ? 'Meta onayı tamamlanamadı. Yeniden bağlanın.' : 'Meta authorization failed. Reconnect.');
      url.searchParams.delete('metaConnection'); window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    void load();
  }, [load, tr]);
  const post = async (body: object) => {
    const response = await fetch('/api/platform/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(28000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || failed); return data;
  };
  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const form = new FormData(event.currentTarget);
      const result = await post({ action: 'start', target: form.get('target'), publishing: form.has('publishing'), inbox: form.has('inbox') });
      const url = new URL(result.authorizationUrl);
      if (url.origin !== 'https://www.facebook.com') throw new Error(tr ? 'Meta yetkilendirme adresi geçersiz.' : 'Invalid Meta authorization URL.');
      window.location.assign(url.href);
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); setBusy(false); }
  };
  const confirm = async (cancel = false) => {
    setBusy(true); setError('');
    try {
      await post({ action: cancel ? 'cancel' : 'select', pageId });
      setSelection(null); setPageId('');
      setMessage(cancel ? (tr ? 'Seçim iptal edildi.' : 'Selection cancelled.') : (tr ? 'Seçilen hesap projeye bağlandı.' : 'Selected account connected to this project.'));
      if (!cancel) await onSaved();
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); setSelection(null); setPageId(''); }
    finally { setBusy(false); }
  };
  const more = async () => { setBusy(true); setError(''); try { await load(true); } finally { setBusy(false); } };
  const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
  return <div className="space-y-3">
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{translateMessage(error, lang)}</p>}
    {message && <p role="status" className="text-sm text-emerald-600 dark:text-emerald-300"><Msg text={message}/></p>}
    {selection ? <section aria-label={tr ? 'Meta sayfa seçimi' : 'Meta page selection'} className="space-y-3 border-b border-slate-200 pb-4 dark:border-slate-700">
      <h3 className="text-sm font-semibold">{selection.target === 'instagram' ? (tr ? 'Instagram işletme hesabını seç' : 'Select Instagram business account') : (tr ? 'Facebook sayfasını seç' : 'Select Facebook page')}</h3>
      {selection.publishing && <p className="text-sm text-slate-500">{tr ? 'Sayfa yayın izni istendi; gönderimden önce ayrıca doğrulanacak.' : 'Page publishing access was requested; it will be checked separately before posting.'}</p>}
      <fieldset disabled={busy} className="space-y-2">{selection.items.map(page => <label key={page.id} className="flex items-start gap-3 rounded-lg border border-slate-300 p-3 dark:border-slate-600">
        <input type="radio" name="meta-page" value={page.id} checked={pageId === page.id} disabled={selection.target === 'instagram' && !page.instagramId} onChange={() => setPageId(page.id)} className="mt-1" />
        <span className="min-w-0 break-words text-sm"><span className="font-medium">{page.name}</span>{selection.target === 'instagram' && <span className="block text-xs text-slate-500">{page.instagramUsername ? `@${page.instagramUsername}` : (tr ? 'Bağlı Instagram işletme hesabı yok' : 'No linked Instagram business account')}</span>}</span>
      </label>)}</fieldset>
      {!selection.items.length && <p className="text-sm text-slate-500">{tr ? 'Bu izinlerle erişilebilir sayfa bulunamadı.' : 'No pages accessible with this grant.'}</p>}
      {selection.limitReached && <p className="text-xs text-amber-600">{tr ? '200 sayfa sınırına ulaşıldı.' : '200-page limit reached.'}</p>}
      <div className="flex flex-wrap gap-2">
        {selection.hasMore && <button disabled={busy} onClick={() => void more()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">{tr ? 'Daha fazla sayfa' : 'More pages'}</button>}
        <button disabled={busy || !pageId} onClick={() => void confirm()} className="studio-primary disabled:opacity-50">{tr ? 'Seçilen hesabı bağla' : 'Connect selected account'}</button>
        <button disabled={busy} onClick={() => void confirm(true)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">{tr ? 'İptal' : 'Cancel'}</button>
      </div>
    </section> : null}
    <details open={['facebook','instagram'].includes(requestedProvider||'')||undefined}><summary className="cursor-pointer text-sm font-medium">{tr ? 'Facebook / Instagram bağla' : 'Connect Facebook / Instagram'}</summary>
      <ProviderGuideButton lang={lang} id={target==='instagram'?'instagram':'facebook'}/>
      {configured === null ? <p role="status" className="mt-2 text-sm text-slate-500">{tr ? 'Meta bağlantısı kontrol ediliyor…' : 'Checking Meta connection…'}</p> : configured && metaOrigin ? <CallbackOriginNotice lang={lang} provider="Meta" callbackOrigin={metaOrigin} setupHref={setupHref}/> : configured ? <form onSubmit={start} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs">{tr ? 'Hesap türü' : 'Account type'}<select name="target" value={target} onChange={event => setTarget(event.target.value)} className={input}><option value="facebook">Facebook</option><option value="instagram">{tr ? 'Instagram işletme hesabı' : 'Instagram business account'}</option></select></label>
        <button disabled={busy} className="self-end studio-primary disabled:opacity-50">{tr ? 'Meta ile devam et' : 'Continue with Meta'}</button>
        <label key={target} className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="publishing" className="mt-1"/>{target==='instagram'?(tr?'Instagram görsel gönderileri için yayın izni de iste':'Also request permission to publish Instagram images'):(tr ? 'Sayfa gönderileri için yayın izni de iste' : 'Also request permission to publish Page posts')}</label>
        <label key={`inbox-${target}`} className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="inbox" defaultChecked={inboxDefault} className="mt-1"/>{target==='instagram'?(tr?'Gelen kutusu için Instagram yorum ve mesaj izinlerini de iste':'Also request Instagram comment and message permissions for the inbox'):(tr?'Gelen kutusu için Sayfa yorum ve mesaj izinlerini de iste':'Also request Page comment and message permissions for the inbox')}</label>
      </form> : <p className="mt-2 text-sm text-amber-600 dark:text-amber-300">{tr ? 'Meta OAuth henüz sunucuda yapılandırılmadı.' : 'Meta OAuth is not configured on the server yet.'}{setupHref && <> <a href={setupHref}>{tr ? 'Kurulum rehberini aç' : 'Open the setup guide'}</a></>}</p>}
    </details>
  </div>;
}
