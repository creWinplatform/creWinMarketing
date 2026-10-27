'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, BellRing, ClipboardCheck, FileText, Inbox, Send } from 'lucide-react';
import Brand from '@/components/platform/Brand';
import Msg from '@/components/Msg';
import type { PortfolioProject, PortfolioView, ReceivedInvite } from '@/lib/platform/member-invites-types';

// "All projects": every project the person belongs to, side by side, with what needs them in each. Opening a project
// switches the session to it; every figure was read with the person's own rights in that project.
export default function PortfolioPage({lang}:{lang:'tr'|'en'}){
  const tr=lang==='tr',locale=tr?'tr-TR':'en-GB';
  const [data,setData]=useState<PortfolioView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
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
      </article>)}</div>}
      {data&&data.total>data.projects.length&&<p className="studio-note">{tr?`İlk ${data.projects.length} proje gösteriliyor (toplam ${data.total}).`:`Showing the first ${data.projects.length} of ${data.total} projects.`}</p>}
    </main>
  </div>;
}
