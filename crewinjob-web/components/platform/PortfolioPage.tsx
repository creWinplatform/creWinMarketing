'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, BellRing, Building2, ClipboardCheck, FileText, Inbox, Send } from 'lucide-react';
import Brand from '@/components/platform/Brand';
import Msg from '@/components/Msg';
import type { AgencyView, PortfolioProject, PortfolioView, ReceivedInvite } from '@/lib/platform/member-invites-types';

// "All projects": every project the person belongs to, side by side, with what needs them in each. Opening a project
// switches the session to it; every figure was read with the person's own rights in that project.
export default function PortfolioPage({lang}:{lang:'tr'|'en'}){
  const tr=lang==='tr',locale=tr?'tr-TR':'en-GB';
  const [data,setData]=useState<PortfolioView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [client,setClient]=useState({organizationName:'',projectName:'',website:''});
  const mounted=useRef(false);
  const request=async<T,>(url:string,init?:RequestInit)=>{const response=await fetch(url,{cache:'no-store',...init,headers:{'Content-Type':'application/json',...(init?.headers||{})}});if(response.status===401||response.status===403&&url==='/api/platform/portfolio'&&!init){window.location.href='/login';throw new Error();}const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||(tr?'İstek tamamlanamadı.':'Request failed.'));return body as T;};
  useEffect(()=>{mounted.current=true;request<PortfolioView>('/api/platform/portfolio').then(value=>{if(mounted.current)setData(value);}).catch(reason=>{if(mounted.current&&reason.message)setError(reason.message);});return()=>{mounted.current=false;};},[]);
  async function open(project:{organizationId:string;projectId:string},href='/'){
    if(busy)return;setBusy(true);setError('');
    try{await request('/api/workspace',{method:'POST',body:JSON.stringify({organizationId:project.organizationId,projectId:project.projectId})});window.location.href=href;}
    catch{if(mounted.current){setError(tr?'Proje açılamadı.':'Could not open the project.');setBusy(false);}}
  }
  async function decide(invite:ReceivedInvite,decision:'accept'|'decline'){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{const value=await request<{portfolio:PortfolioView;accepted:boolean}>('/api/platform/portfolio',{method:'POST',body:JSON.stringify({action:'decide',id:invite.id,decision})});if(mounted.current){setData(value.portfolio);setNotice(value.accepted?(tr?`${invite.projectName} projesine katıldınız.`:`You joined ${invite.projectName}.`):(tr?'Davet reddedildi.':'Invitation declined.'));}}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'');}
    finally{if(mounted.current)setBusy(false);}
  }
  async function agency(home:AgencyView,body:Record<string,unknown>,success:string){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{const value=await request<{portfolio:PortfolioView}>('/api/platform/agency',{method:'POST',body:JSON.stringify({homeOrganizationId:home.organizationId,homeProjectId:home.projectId,...body})});if(mounted.current){setData(value.portfolio);setNotice(success);if(body.action==='create')setClient({organizationName:'',projectName:'',website:''});}}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'');}
    finally{if(mounted.current)setBusy(false);}
  }
  const roles:Record<string,string>=tr?{owner:'Sahip',admin:'Yönetici',editor:'Editör',analyst:'Analist',viewer:'Görüntüleyici'}:{owner:'Owner',admin:'Admin',editor:'Editor',analyst:'Analyst',viewer:'Viewer'};
  const date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'short',year:'numeric'});
  const n=(value:number)=>value.toLocaleString(locale);
  const plan=(project:PortfolioProject)=>{const p=project.plan;if(!p)return tr?'Plan doğrulanamadı':'Plan unverified';if(p.id==='pilot')return 'Pilot';if(p.id==='paid')return p.active?(tr?`Ücretli${p.endsAt?` · ${date(p.endsAt)}`:''}`:`Paid${p.endsAt?` · ${date(p.endsAt)}`:''}`):(tr?'Ücretli dönem bitti':'Paid period ended');return p.active?(tr?`Deneme · ${p.endsAt?date(p.endsAt):''}`:`Trial · ${p.endsAt?date(p.endsAt):''}`):(tr?'Deneme bitti':'Trial ended');};
  const month=(key:string)=>new Date(`${key}-15T12:00:00Z`).toLocaleDateString(locale,{month:'long',timeZone:'UTC'});
  return <div className="shared-report-page portfolio-page">
    <header className="shared-report-bar"><Brand/><a className="studio-secondary" href="/"><ArrowLeft size={15}/>{tr?'Çalışma alanına dön':'Back to workspace'}</a></header>
    <main id="ryzevo-main" className="shared-report-main">
      <h1>{tr?'Tüm projeler':'All projects'}</h1>
      <p className="studio-note">{tr?'Üyesi olduğunuz projeler. Her projedeki sayılar sizin o projedeki yetkinizle okunur; bir projenin bilgisi diğerine geçmez.':'Projects you are a member of. Each project’s figures are read with your rights in that project; nothing crosses from one project to another.'}</p>
      {error&&<p role="alert" className="studio-error"><Msg text={error}/></p>}{notice&&<p role="status" className="studio-success">{notice}</p>}
      {!data&&!error&&<p role="status" className="studio-note">{tr?'Projeler yükleniyor…':'Loading projects…'}</p>}
      {data?.agencies.map(home=><section key={home.projectId} className="studio-band agency-package" aria-labelledby={`agency-${home.projectId}`}>
        <h2 id={`agency-${home.projectId}`}><Building2 size={16}/> {tr?`Ajans paketi · ${home.name}`:`Agency package · ${home.name}`}</h2>
        <p className={home.period?'studio-note':'studio-error'}>{home.period?(home.period.inGrace?(tr?`Dönem bitti; ek süre ${date(home.period.graceEndsAt)} tarihinde sona eriyor.`:`The period has ended; the grace period ends ${date(home.period.graceEndsAt)}.`):(tr?`Etkin · ${date(home.period.endsAt)} tarihine kadar.`:`Active · until ${date(home.period.endsAt)}.`)):(tr?'Paket şu anda etkin değil; bağlı projeler Growth haklarını almıyor. Ana projenin Plan ve ödeme bölümünden yenileyin.':'The package is not running; linked projects don’t get Growth rights. Renew it from the main project’s Plan and payment section.')} {tr?`${n(home.used)} / ${n(home.limit)} müşteri projesi (onay bekleyenler dahil). Her biri Growth haklarıyla.`:`${n(home.used)} / ${n(home.limit)} client projects (pending ones included), each with Growth rights.`}</p>
        {home.period&&home.used<home.limit&&<details className="agency-new"><summary>{tr?'Yeni müşteri projesi aç':'Open a new client project'}</summary>
          <form className="studio-form-grid" onSubmit={event=>{event.preventDefault();void agency(home,{action:'create',...client},tr?'Müşteri projesi açıldı ve pakete eklendi. Müşterinizi o projenin Ekip bölümünden davet edebilirsiniz.':'Client project opened and added to the package. You can invite your client from that project’s Team section.');}}>
            <label>{tr?'Müşteri (kuruluş) adı':'Client (organization) name'}<input required maxLength={120} value={client.organizationName} disabled={busy} onChange={event=>setClient({...client,organizationName:event.target.value})}/></label>
            <label>{tr?'Proje adı':'Project name'}<input required maxLength={120} value={client.projectName} disabled={busy} onChange={event=>setClient({...client,projectName:event.target.value})}/></label>
            <label className="studio-form-full">{tr?'Web sitesi':'Website'}<input type="url" required placeholder="https://" value={client.website} disabled={busy} onChange={event=>setClient({...client,website:event.target.value})}/></label>
            <div className="studio-form-actions studio-form-full"><button className="studio-primary" disabled={busy}>{tr?'Projeyi aç':'Open project'}</button></div>
          </form></details>}
      </section>)}
      {data&&data.agencies.length===0&&data.projects.length>1&&<p className="studio-note">{tr?'Birden çok müşteriyle mi çalışıyorsunuz? Ajans paketi bir projenizin Plan ve ödeme bölümünden alınır; o proje ve 10 müşteri projesine kadar her biri Growth haklarını alır.':'Working with several clients? The agency package is bought from one project’s Plan and payment section; that project and up to 10 client projects each get Growth rights.'}</p>}
      {data&&data.invites.length>0&&<section className="studio-band" aria-labelledby="portfolio-invites"><h2 id="portfolio-invites">{tr?'Bekleyen davetler':'Pending invitations'}</h2>
        <ul className="team-alert-list">{data.invites.map(invite=><li key={invite.id} className="team-alert"><span><strong>{invite.projectName}</strong> · {invite.organizationName} · {roles[invite.role]}<small className="approval-age"> · {tr?`${invite.invitedBy} davet etti, ${date(invite.expiresAt)} tarihine kadar geçerli`:`invited by ${invite.invitedBy}, valid until ${date(invite.expiresAt)}`}</small></span>
          <span className="portfolio-actions"><button type="button" className="studio-primary" disabled={busy} onClick={()=>void decide(invite,'accept')}>{tr?'Kabul et':'Accept'}</button><button type="button" className="studio-secondary" disabled={busy} onClick={()=>void decide(invite,'decline')}>{tr?'Reddet':'Decline'}</button></span></li>)}</ul></section>}
      {data&&<div className="portfolio-grid">{data.projects.map(project=><article key={project.projectId} className={`portfolio-card${project.alerts.urgent?' portfolio-card-urgent':''}`} aria-label={project.projectName}>
        <header><div><h2>{project.projectName}</h2><p>{project.organizationName} · {roles[project.role]||project.role}</p></div>{project.current&&<span className="studio-badge">{tr?'Açık':'Open'}</span>}</header>
        <p className="portfolio-plan">{plan(project)}</p>
        <dl className="portfolio-stats">
          <div><dt><AlertTriangle size={13} aria-hidden="true"/>{tr?'Acil':'Urgent'}</dt><dd>{n(project.alerts.urgent)}</dd></div>
          <div><dt><BellRing size={13} aria-hidden="true"/>{tr?'Uyarı':'Warnings'}</dt><dd>{n(project.alerts.warning)}</dd></div>
          <div><dt><ClipboardCheck size={13} aria-hidden="true"/>{tr?'Kararınızı bekleyen':'Awaiting you'}</dt><dd>{n(project.approvals)}</dd></div>
          <div><dt><Send size={13} aria-hidden="true"/>{tr?'Yayın (30 gün)':'Posts (30 days)'}</dt><dd>{n(project.posts30)}</dd></div>
          <div><dt><Inbox size={13} aria-hidden="true"/>{tr?'Açık mesaj ve yorum':'Open messages'}</dt><dd>{project.inboxOpen===null?'—':n(project.inboxOpen)}</dd></div>
          <div><dt><FileText size={13} aria-hidden="true"/>{project.lastReport?(tr?`${month(project.lastReport.month)} raporu`:`${month(project.lastReport.month)} report`):(tr?'Aylık rapor':'Monthly report')}</dt><dd>{project.lastReport?.approved?(tr?'Onaylı':'Approved'):(tr?'Taslak':'Draft')}</dd></div>
        </dl>
        <div className="portfolio-actions"><button type="button" className="studio-primary" disabled={busy} onClick={()=>void open(project)}>{project.current?(tr?'Genel bakışa git':'Go to overview'):(tr?'Projeyi aç':'Open project')}<ArrowRight size={15}/></button>
          {project.lastReport&&!project.lastReport.approved&&<button type="button" className="studio-secondary" disabled={busy} onClick={()=>void open(project,'/?tab=analytics')}>{tr?'Raporu aç':'Open report'}</button>}</div>
        <AgencyLine project={project} homes={data.agencies} tr={tr} busy={busy} act={agency}/>
      </article>)}</div>}
      {data&&data.total>data.projects.length&&<p className="studio-note">{tr?`İlk ${data.projects.length} proje gösteriliyor (toplam ${data.total}).`:`Showing the first ${data.projects.length} of ${data.total} projects.`}</p>}
    </main>
  </div>;
}

// What the agency package means for one project card: the main project, linked, waiting, someone else's, or addable.
function AgencyLine({project,homes,tr,busy,act}:{project:PortfolioProject;homes:AgencyView[];tr:boolean;busy:boolean;act:(home:AgencyView,body:Record<string,unknown>,success:string)=>Promise<void>}){
  const home=homes.find(item=>item.projectId===project.agency?.agencyProjectId),active=homes.find(item=>item.period&&item.used<item.limit);
  if(homes.some(item=>item.projectId===project.projectId))return <p className="portfolio-agency">{tr?'Ajans paketinin ana projesi':'Main project of the agency package'}</p>;
  if(project.agency&&home)return <p className="portfolio-agency">{project.agency.state==='linked'?(tr?'Ajans paketinde':'In the agency package'):(tr?'Müşteri onayı bekleniyor':'Waiting for the client’s approval')} <button type="button" className="studio-text-button" disabled={busy} onClick={()=>void act(home,{action:'unlink',id:project.agency!.linkId},tr?'Proje paketten çıkarıldı.':'Project removed from the package.')}>{project.agency.state==='linked'?(tr?'Paketten çıkar':'Remove from package'):(tr?'İsteği geri al':'Withdraw request')}</button></p>;
  if(project.agency)return <p className="portfolio-agency">{tr?'Başka bir ajans paketinde':'In another agency’s package'}</p>;
  if(active&&project.plan?.id!=='pilot')return <p className="portfolio-agency"><button type="button" className="studio-text-button" disabled={busy} onClick={()=>void act(active,{action:'link',organizationId:project.organizationId,projectId:project.projectId},project.role==='owner'?(tr?'Proje pakete eklendi.':'Project added to the package.'):(tr?'İstek gönderildi; proje sahibi onaylayınca pakete eklenir.':'Request sent; the project joins the package once its owner approves.'))}>{tr?'Ajans paketine ekle':'Add to agency package'}</button></p>;
  return null;
}
