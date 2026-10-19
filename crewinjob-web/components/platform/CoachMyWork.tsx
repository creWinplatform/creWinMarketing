'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, UserRoundCheck } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import type { CoachAssignmentsSnapshot } from '@/lib/platform/coach-types';
import { coachDay, coachTeam } from './CoachAssign';

// "Assigned to me": the viewer's own open coach work, overdue first. Shown only once the team uses assignments.
export default function CoachMyWork({lang}:{lang:Locale}){
  const tr=lang==='tr';
  const [data,setData]=useState<CoachAssignmentsSnapshot|null>(null);
  useEffect(()=>{let live=true;const load=()=>{coachTeam().then(value=>{if(live)setData(value);}).catch(()=>{});};load();window.addEventListener('ryzevo:coach-assignments',load);return()=>{live=false;window.removeEventListener('ryzevo:coach-assignments',load);};},[]);
  if(!data||!data.all.length)return null;
  const mine=[...data.mine].sort((a,b)=>Number(b.overdue)-Number(a.overdue)),overdue=mine.filter(item=>item.overdue).length,teamOpen=data.all.filter(item=>item.state==='open').length;
  return <section className="studio-band coach-my-work" aria-labelledby="coach-my-work-title">
    <div className="studio-section-title"><h2 id="coach-my-work-title"><UserRoundCheck size={17}/>{tr?'Bana atananlar':'Assigned to me'}</h2><span className="studio-badge">{tr?`Ekipte ${teamOpen} açık iş`:`${teamOpen} open on the team`}</span></div>
    {overdue>0&&<p className="coach-assign-label overdue" role="status">{tr?`${overdue} işin son tarihi geçti.`:`${overdue} item(s) are past their due date.`}</p>}
    {mine.length?<ul className="coach-my-work-list">{mine.map(item=><li key={`${item.kind}:${item.itemId}`}>
      <span className="coach-state">{item.kind==='action'?(tr?'Koç eylemi':'Coach action'):(tr?'İçerik planı':'Content plan')}</span>
      <span>{item.title}</span>
      <span className={item.overdue?'coach-assign-label overdue':'coach-muted'}>{item.dueOn?`${tr?'Son tarih ':'Due '}${coachDay(item.dueOn,lang)}${item.overdue?(tr?' · gecikti':' · overdue'):''}`:(tr?'Tarih yok':'No date')}</span>
      <a className="studio-text-button" href={item.href}>{tr?'Aç':'Open'}<ArrowRight size={14}/></a>
    </li>)}</ul>:<p className="coach-muted">{tr?'Size atanmış açık iş yok.':'Nothing open is assigned to you.'}</p>}
  </section>;
}
