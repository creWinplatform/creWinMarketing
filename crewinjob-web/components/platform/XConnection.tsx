'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Link2 } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { ProviderGuideButton } from './GrowthCompass';

export default function XConnection({lang,requestedProvider}:{lang:Locale;requestedProvider?:string}) {
  const tr=lang==='tr', [configured,setConfigured]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    void projectRequest<{configured:boolean}>('/api/platform/x',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(data=>setConfigured(data.configured)).catch(()=>{if(!controller.signal.aborted)setConfigured(false);});
    const url=new URL(window.location.href),value=url.searchParams.get('xConnection');
    if(value){setResult(value==='connected'?'connected':'failed');url.searchParams.delete('xConnection');window.history.replaceState(null,'',url.pathname+url.search+url.hash);}
    return()=>controller.abort();
  },[]);
  async function connect(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;
    const form=new FormData(event.currentTarget);setBusy(true);setError('');
    try {
      const data=await projectRequest<{authorizationUrl:string}>('/api/platform/x',{method:'POST',body:JSON.stringify({accountName:form.get('accountName'),publishing:form.has('publishing')}),signal:AbortSignal.timeout(15000)});
      const url=new URL(data.authorizationUrl);
      if(url.origin!=='https://x.com'||url.pathname!=='/i/oauth2/authorize')throw new Error('Invalid X authorization URL.');
      window.location.assign(url.href);
    }catch(reason){setError(reason instanceof Error?reason.message:'Request failed.');setBusy(false);}
  }
  return <details open={requestedProvider==='twitter'||undefined}>
    <summary className="cursor-pointer text-sm font-medium">{tr?'X hesabı bağla':'Connect X account'}</summary>
    <ProviderGuideButton lang={lang} id="twitter"/>
    {result&&<p role="status" className={result==='connected'?'studio-success':'studio-error'}>{result==='connected'?(tr?'X bağlantısı kaydedildi.':'X connection saved.'):(tr?'X bağlantısı tamamlanamadı. Hesap ve uygulama izinlerini kontrol edin.':'X connection failed. Check account and app permissions.')}</p>}
    {error&&<p role="alert" className="studio-error">{error}</p>}
    {configured===null?<p role="status">{tr?'Bağlantı durumu yükleniyor…':'Loading connection status…'}</p>:configured?<form onSubmit={connect} className="studio-form-grid mt-3"><fieldset className="studio-form-grid studio-form-full" disabled={busy}>
      <label>{tr?'Hesap adı':'Account name'}<input name="accountName" required maxLength={160} autoComplete="off"/></label>
      <label className="publication-toggle studio-form-full"><input type="checkbox" name="publishing"/>{tr?'X hesabımda metin yayınlama izni de iste':'Also request text publishing access to my X account'}</label>
      <div className="studio-form-actions studio-form-full"><button className="studio-secondary"><Link2 size={16}/>{busy?(tr?'Bağlanıyor…':'Connecting…'):(tr?'X ile bağlan':'Connect with X')}</button></div>
    </fieldset></form>:<p className="mt-2 text-sm text-amber-600 dark:text-amber-300">{tr?'X OAuth sunucuda yapılandırılmadı.':'X OAuth is not configured on the server.'}</p>}
  </details>;
}
