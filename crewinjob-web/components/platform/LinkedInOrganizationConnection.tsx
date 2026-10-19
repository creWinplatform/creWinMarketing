'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Building2, Link2, ChevronDown, X, RefreshCw } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { ProviderGuideButton } from './GrowthCompass';
import { translateMessage } from '@/lib/i18n/messages';
import Msg from '@/components/Msg';

type Selection={publishing:boolean;items:{id:string;name:string;roles:string[];available:boolean;canPublish:boolean}[];hasMore:boolean;limitReached:boolean};
export default function LinkedInOrganizationConnection({lang,onSaved,requestedProvider}:{lang:Locale;onSaved:()=>Promise<void>;requestedProvider?:string}){
  const tr=lang==='tr',failed=tr?'İstek tamamlanamadı.':'Request failed.',mounted=useRef(false),locked=useRef(false),controller=useRef<AbortController|null>(null);
  const [configured,setConfigured]=useState<boolean|null>(null),[selection,setSelection]=useState<Selection|null>(null),[pageId,setPageId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function load(more=false){
    if(locked.current)return;const request=new AbortController();controller.current=request;locked.current=true;setBusy(true);
    try{const data=await projectRequest<{configured:boolean;selection:Selection|null}>(`/api/platform/linkedin-organizations${more?'?more=true':''}`,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(25000)])});if(mounted.current&&!request.signal.aborted){setConfigured(data.configured);setSelection(data.selection);setError('');}}
    catch(reason){if(mounted.current&&!request.signal.aborted){setConfigured(value=>value??false);setError(reason instanceof Error&&reason.message?reason.message:failed);}}
    finally{if(mounted.current&&controller.current===request){locked.current=false;setBusy(false);}}
  }
  useEffect(()=>{
    mounted.current=true;const url=new URL(window.location.href),result=url.searchParams.get('linkedinOrganizationConnection');
    if(result){if(result==='failed')setError(tr?'LinkedIn şirket onayı tamamlanamadı.':'LinkedIn organization authorization failed.');url.searchParams.delete('linkedinOrganizationConnection');window.history.replaceState(null,'',url.pathname+url.search+url.hash);}
    void load();return()=>{mounted.current=false;controller.current?.abort();locked.current=false;};
  },[]);
  async function act(action:'start'|'select'|'cancel',publishing=false){
    if(locked.current)return;const request=new AbortController();controller.current=request;locked.current=true;setBusy(true);setError('');setMessage('');
    try{
      const result=await projectRequest<{authorizationUrl?:string}>('/api/platform/linkedin-organizations',{method:'POST',body:JSON.stringify({action,pageId,publishing}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(30000)])});
      if(!mounted.current||request.signal.aborted)return;
      if(action==='start'){
        const url=new URL(result.authorizationUrl||'');if(url.origin!=='https://www.linkedin.com'||url.pathname!=='/oauth/v2/authorization')throw new Error(tr?'LinkedIn yetkilendirme adresi geçersiz.':'Invalid LinkedIn authorization URL.');window.location.assign(url.href);return;
      }
      setSelection(null);setPageId('');setMessage(action==='select'?(tr?'Seçilen LinkedIn şirket sayfası projeye bağlandı.':'Selected LinkedIn company page connected to this project.'):(tr?'Seçim iptal edildi.':'Selection cancelled.'));
      if(action==='select')await onSaved();
    }catch(reason){if(mounted.current&&!request.signal.aborted)setError(reason instanceof Error&&reason.message?reason.message:failed);}
    finally{if(mounted.current&&controller.current===request){locked.current=false;setBusy(false);}}
  }
  function start(event:FormEvent<HTMLFormElement>){event.preventDefault();void act('start',new FormData(event.currentTarget).has('publishing'));}
  return <div>
    {error&&<><p role="alert" className="studio-error">{translateMessage(error,lang)}</p><button className="icon-button" title={tr?'Bağlantı durumunu yenile':'Refresh connection status'} aria-label={tr?'Bağlantı durumunu yenile':'Refresh connection status'} disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/></button></>}{message&&<p role="status" className="studio-success"><Msg text={message}/></p>}
    {selection&&<section className="linkedin-page-selection" aria-label={tr?'LinkedIn şirket sayfası seçimi':'LinkedIn company page selection'}>
      <h3><Building2 size={18}/>{tr?'Şirket sayfasını seçin':'Choose a company page'}</h3>
      <fieldset disabled={busy}>{selection.items.map(page=><label className="linkedin-page-choice" key={page.id}><input type="radio" name="linkedin-page" value={page.id} checked={pageId===page.id} disabled={!page.available||selection.publishing&&!page.canPublish} onChange={()=>setPageId(page.id)}/><span><strong>{page.name}</strong><small>{page.id} · {page.roles.map(role=>({ADMINISTRATOR:tr?'Yönetici':'Administrator',CONTENT_ADMINISTRATOR:tr?'İçerik yöneticisi':'Content admin',CONTENT_ADMIN:tr?'İçerik yöneticisi':'Content admin',ANALYST:tr?'Analist':'Analyst'}[role]||role)).join(', ')}</small>{!page.available?<small>{tr?'Sayfa bilgisi alınamadı':'Page details unavailable'}</small>:selection.publishing&&!page.canPublish&&<small>{tr?'Organik yayın yetkisi yok':'No organic publishing role'}</small>}</span></label>)}</fieldset>
      {!selection.items.length&&<p className="studio-note">{tr?'Bu izinlerle erişilebilir şirket sayfası bulunamadı.':'No company pages accessible with this grant.'}</p>}
      {selection.limitReached&&<p className="studio-note">{tr?'İlk 200 yetki kaydı yüklendi.':'First 200 role records loaded.'}</p>}
      <div className="studio-form-actions">{selection.hasMore&&<button className="studio-secondary" disabled={busy} onClick={()=>void load(true)}><ChevronDown size={16}/>{tr?'Daha fazla':'Load more'}</button>}<button className="studio-primary" disabled={busy||!pageId} onClick={()=>void act('select')}><Link2 size={16}/>{tr?'Seçilen sayfayı bağla':'Connect selected page'}</button><button className="icon-button" title={tr?'Seçimi iptal et':'Cancel selection'} aria-label={tr?'Seçimi iptal et':'Cancel selection'} disabled={busy} onClick={()=>void act('cancel')}><X size={16}/></button></div>
    </section>}
    <details open={requestedProvider==='linkedin_company'||undefined}><summary className="cursor-pointer text-sm font-medium">{tr?'LinkedIn şirket sayfası bağla':'Connect LinkedIn company page'}</summary>
      <ProviderGuideButton lang={lang} id="linkedin_company"/>
      {configured===null?<p role="status">{tr?'Bağlantı durumu yükleniyor…':'Loading connection status…'}</p>:configured?<form className="studio-form-grid mt-3" onSubmit={start}><fieldset className="studio-form-grid studio-form-full" disabled={busy}><label className="publication-toggle studio-form-full"><input type="checkbox" name="publishing"/>{tr?'Seçeceğim şirket sayfası için yayın izni de iste':'Also request publishing access for the company page I select'}</label><div className="studio-form-actions studio-form-full"><button className="studio-secondary"><Building2 size={16}/>{busy?(tr?'Bağlanıyor…':'Connecting…'):(tr?'LinkedIn ile devam et':'Continue with LinkedIn')}</button></div></fieldset></form>:<p className="studio-note">{tr?'LinkedIn uygulaması ve etkin API sürümü sunucuda yapılandırılmalı.':'Configure the LinkedIn app and an enabled API version on the server.'}</p>}
    </details>
  </div>;
}
