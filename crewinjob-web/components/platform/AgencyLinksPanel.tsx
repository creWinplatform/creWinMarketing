'use client';
import { useEffect, useRef, useState } from 'react';
import { Building2 } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { AgencyClientLink } from '@/lib/platform/member-invites-types';
import Msg from '@/components/Msg';

// The project owner's say over agency coverage: agree to, decline or end it. Hidden when no agency is involved.
export default function AgencyLinksPanel({lang}:{lang:Locale}){
  const tr=lang==='tr',locale=localeTag(lang);
  const [items,setItems]=useState<AgencyClientLink[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;projectRequest<{items:AgencyClientLink[]}>('/api/platform/agency-links',{signal:AbortSignal.timeout(15000)}).then(value=>{if(mounted.current)setItems(value.items);}).catch(()=>{if(mounted.current)setItems([]);});return()=>{mounted.current=false;};},[]);
  async function act(body:Record<string,unknown>,success:string){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{const value=await projectRequest<{items:AgencyClientLink[]}>('/api/platform/agency-links',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(mounted.current){setItems(value.items);setNotice(success);}}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}
    finally{if(mounted.current)setBusy(false);}
  }
  if(!items?.length)return null;
  const date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'short',year:'numeric'});
  const states={requested:tr?'Onayınızı bekliyor':'Waiting for you',linked:tr?'Ajans paketinde':'In the agency package',declined:tr?'Reddedildi':'Declined',removed:tr?'Paketten çıkarıldı':'Removed'};
  return <section className="studio-band agency-links" aria-labelledby="agency-links-title" aria-busy={busy}>
    <div className="studio-section-title"><h2 id="agency-links-title"><Building2 size={16}/>{tr?'Ajans paketi':'Agency package'}</h2></div>
    <p className="studio-note">{tr?'Bir ajans projenizi kendi paketine eklerse, projeniz Growth haklarını ajansın paketinden alır; sizin ayrıca ödemeniz gerekmez. Proje, verileri ve ekibi sizde kalır. Paketten istediğiniz an çıkarabilirsiniz; o zaman projeniz kendi planına döner.':'If an agency adds your project to its package, your project gets Growth rights from the agency’s package and you don’t pay separately. The project, its data and team stay yours. You can remove it at any time; your project then returns to its own plan.'}</p>
    {error&&<p role="alert" className="studio-error"><Msg text={error}/></p>}{notice&&<p role="status" className="studio-success">{notice}</p>}
    <ul className="team-alert-list">{items.map(item=><li key={item.id} className="team-alert">
      <span><strong>{item.agencyName}</strong> · {item.agencyOrganization} · {states[item.state]}<small className="approval-age"> · {tr?`${item.requestedBy} · ${date(item.requestedAt)}`:`${item.requestedBy} · ${date(item.requestedAt)}`}{item.state==='linked'&&!item.packageRunning?(tr?' · ajansın paketi şu anda etkin değil':' · the agency’s package is not running now'):''}</small></span>
      <span className="portfolio-actions">{item.state==='requested'&&<><button type="button" className="studio-primary" disabled={busy} onClick={()=>void act({action:'decide',id:item.id,decision:'approve'},tr?'Projeniz ajans paketine eklendi.':'Your project was added to the agency package.')}>{tr?'Onayla':'Approve'}</button><button type="button" className="studio-secondary" disabled={busy} onClick={()=>void act({action:'decide',id:item.id,decision:'decline'},tr?'İstek reddedildi.':'Request declined.')}>{tr?'Reddet':'Decline'}</button></>}
        {item.state==='linked'&&<button type="button" className="studio-secondary" disabled={busy} onClick={()=>{if(window.confirm(tr?'Proje ajans paketinden çıkarılsın mı? Growth hakları hemen biter ve proje kendi planına döner.':'Remove the project from the agency package? Growth rights end at once and the project returns to its own plan.'))void act({action:'remove',id:item.id},tr?'Proje ajans paketinden çıkarıldı.':'Project removed from the agency package.');}}>{tr?'Paketten çıkar':'Remove from package'}</button>}</span></li>)}</ul>
  </section>;
}
