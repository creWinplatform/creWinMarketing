'use client';
import { useEffect, useRef, useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { LINK_REASONS, type LinkTrackingView } from '@/lib/platform/link-tracking-types';
import Msg from '@/components/Msg';

// Own-site link tagging and the GA4 property its results are read from. The tagged text itself is shown in the
// publication preview; this panel only switches tagging and chooses where results come from.
export default function LinkTrackingPanel({lang,onChange}:{lang:Locale;onChange?:()=>void}){
  const tr=lang==='tr',locale=localeTag(lang);
  const [data,setData]=useState<LinkTrackingView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [enabled,setEnabled]=useState(true),[connectionId,setConnection]=useState('');
  const mounted=useRef(false);
  const apply=(value:LinkTrackingView)=>{setData(value);setEnabled(value.enabled);setConnection(value.connectionId||'');};
  useEffect(()=>{mounted.current=true;const controller=new AbortController();
    projectRequest<LinkTrackingView>('/api/platform/link-tracking',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(value=>{if(mounted.current)apply(value);}).catch(reason=>{if(mounted.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:(tr?'Bağlantı sonuçları alınamadı.':'Could not load link results.'));});
    return()=>{mounted.current=false;controller.abort();};},[tr]);
  async function act(body:Record<string,unknown>,success:string){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{const value=await projectRequest<LinkTrackingView>('/api/platform/link-tracking',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(mounted.current){apply(value);setNotice(success);onChange?.();}}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}
    finally{if(mounted.current)setBusy(false);}
  }
  if(!data)return error?<p role="alert" className="studio-error"><Msg text={error}/></p>:null;
  let host='';try{host=new URL(data.website).hostname;}catch{host=data.website;}
  const day=(value:string)=>new Date(`${value}T12:00:00Z`).toLocaleDateString(locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  const time=(value:string)=>new Date(value).toLocaleString(locale,{dateStyle:'medium',timeStyle:'short'});
  const dirty=enabled!==data.enabled||(connectionId||null)!==data.connectionId;
  const chosen=data.connections.find(item=>item.id===data.connectionId);
  return <section className="studio-band link-tracking" aria-labelledby="link-tracking-title" aria-busy={busy}>
    <div className="studio-section-title"><h2 id="link-tracking-title"><Link2 size={16}/>{tr?'Paylaşımlardan sitenize gelenler':'Visits from your posts'}</h2>
      {data.canManage&&data.connectionId&&<button type="button" className="icon-button" disabled={busy||data.state==='refreshing'} onClick={()=>void act({action:'refresh'},tr?'Sonuçlar Google Analytics’ten yenilendi.':'Results refreshed from Google Analytics.')} aria-label={tr?'Sonuçları şimdi yenile':'Refresh results now'} title={tr?'Sonuçları şimdi yenile (10 dakikada bir)':'Refresh results now (every 10 minutes)'}><RefreshCw size={16}/></button>}</div>
    <p className="studio-note">{tr?`${host} adresine giden bağlantılara kaynak etiketi eklenir (utm_source=kanal, utm_medium=social, utm_campaign=paylaşım). Etiketli metni yayın önizlemesinde görür ve onu onaylarsınız. Google Analytics, bu bağlantılardan gelen oturumları ve önemli olayları bildirir; her paylaşımın altında görünür. Instagram açıklamalarındaki bağlantılar tıklanamadığı için etiketlenmez; başka sitelere giden ve zaten utm_ içeren bağlantılara dokunulmaz.`:`Links to ${host} get a source tag (utm_source=channel, utm_medium=social, utm_campaign=post). You see the tagged text in the publication preview and approve it. Google Analytics reports the sessions and key events that arrived through these links; they appear under each post. Instagram caption links aren’t clickable, so they aren’t tagged; links to other sites and links that already carry utm_ are left as they are.`}</p>
    {error&&<p role="alert" className="studio-error"><Msg text={error}/></p>}{notice&&<p role="status" className="studio-success">{notice}</p>}
    {data.canManage&&<form className="studio-form-grid" onSubmit={event=>{event.preventDefault();void act({action:'configure',enabled,connectionId:connectionId||null},tr?'Ayar kaydedildi.':'Settings saved.');}}>
      <label className="publication-toggle studio-form-full"><input type="checkbox" checked={enabled} disabled={busy} onChange={event=>setEnabled(event.target.checked)}/>{tr?'Sitemize giden bağlantılara kaynak etiketi ekle':'Add a source tag to links to our site'}</label>
      {data.connections.length?<label>{tr?'Sonuçların okunacağı Google Analytics mülkü':'Google Analytics property to read results from'}<select value={connectionId} disabled={busy} onChange={event=>setConnection(event.target.value)}><option value="">{tr?'Seçilmedi (sonuç okunmaz)':'None (no results are read)'}</option>{data.connections.map(item=><option key={item.id} value={item.id}>{item.name} · {item.property}</option>)}</select></label>
        :<p className="studio-note studio-form-full">{tr?'Sonuçları görmek için önce bir Google Analytics bağlantısı ekleyin.':'To see results, add a Google Analytics connection first.'} <a href="/?tab=project&settings=connections">{tr?'Bağlantılar':'Connections'}</a></p>}
      {connectionId&&connectionId!==data.connectionId&&<p className="studio-note studio-form-full">{tr?'Sonuçlar bu mülkten sizin yetkinizle günde bir kez okunur. Mülkü değiştirirseniz önceki sonuçlar silinir.':'Results are read from this property once a day with your access. Changing the property deletes the earlier results.'}</p>}
      <div className="studio-form-actions studio-form-full"><button className="studio-primary" disabled={busy||!dirty}>{tr?'Kaydet':'Save'}</button></div>
    </form>}
    {!data.canManage&&<p className="studio-note">{data.enabled?(tr?'Kaynak etiketi açık.':'Source tagging is on.'):(tr?'Kaynak etiketi kapalı.':'Source tagging is off.')} {chosen||data.connectionId?(tr?'Sonuçlar Google Analytics’ten okunuyor.':'Results are read from Google Analytics.'):(tr?'Sonuçların okunacağı mülk seçilmedi.':'No property has been chosen for results.')}</p>}
    {data.connectionId&&<p className="studio-note" role="status">
      {data.state==='refreshing'?(tr?'Google Analytics’ten okunuyor…':'Reading from Google Analytics…')
        :data.from&&data.to&&data.checkedAt?(tr?`Son okuma: ${time(data.checkedAt)} · dönem ${day(data.from)}–${day(data.to)} · ${data.tagged} etiketli paylaşım.`:`Last read: ${time(data.checkedAt)} · period ${day(data.from)}–${day(data.to)} · ${data.tagged} tagged post(s).`)
        :(tr?'Henüz okunmadı. İlk okuma birkaç dakika içinde yapılır; yenile düğmesiyle hemen başlatabilirsiniz.':'Not read yet. The first read happens within minutes; use refresh to start it now.')}
      {data.resultState==='partial'&&(tr?' Google Analytics bu dönem için eksik veya örneklenmiş veri bildirdi; sayılar eksik olabilir.':' Google Analytics reported thresholded or sampled data for this period; counts may be incomplete.')}
    </p>}
    {data.reason&&(data.state==='failed'||data.state==='blocked')&&<p className="studio-error" role="alert">{LINK_REASONS[data.reason]?.[tr?0:1]||data.reason}</p>}
  </section>;
}
