'use client';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { CalendarClock, UserRound, X } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { CoachAssignment, CoachAssignmentsSnapshot } from '@/lib/platform/coach-types';
import Msg from '@/components/Msg';

// One team lookup per page load: the picker lists active teammates with content rights.
let team:Promise<CoachAssignmentsSnapshot>|null=null;
export const coachTeam=()=>team??=projectRequest<CoachAssignmentsSnapshot>('/api/platform/coach/assignments').catch(reason=>{team=null;throw reason;});
// After a change, drop the cached lookup and let "Assigned to me" reload.
export const refreshCoachTeam=()=>{team=null;window.dispatchEvent(new Event('ryzevo:coach-assignments'));};
export const coachDay=(key:string,lang:Locale)=>new Date(`${key}T12:00:00Z`).toLocaleDateString(localeTag(lang),{day:'numeric',month:'short',timeZone:'UTC'});

// Owner and due date for a weekly action or a content plan item. Internal only: nobody is notified.
export default function CoachAssign({kind,itemId,assignment,lang,onSaved}:{kind:'action'|'content';itemId:string;assignment:CoachAssignment|null;lang:Locale;onSaved:()=>void}){
  const tr=lang==='tr',id=useId();
  const [members,setMembers]=useState<{id:string;name:string}[]>([]),[canWrite,setCanWrite]=useState(false),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [assignee,setAssignee]=useState(assignment?.assigneeId||''),[due,setDue]=useState(assignment?.dueOn||'');
  useEffect(()=>{let live=true;coachTeam().then(value=>{if(live){setMembers(value.members);setCanWrite(value.canWrite);}}).catch(()=>{});return()=>{live=false;};},[]);
  useEffect(()=>{setAssignee(assignment?.assigneeId||'');setDue(assignment?.dueOn||'');},[assignment?.assigneeId,assignment?.dueOn]);
  if(!assignment&&!canWrite)return null;
  const save=async(event:FormEvent|null,remove=false)=>{event?.preventDefault();if(busy)return;setBusy(true);setError('');
    try{await projectRequest('/api/platform/coach/assignments',{method:'POST',body:JSON.stringify({action:'assign',kind,itemId,assigneeId:remove?null:assignee||null,dueOn:remove?null:due||null,expectedRevision:assignment?.revision||0})});setOpen(false);refreshCoachTeam();onSaved();}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}finally{setBusy(false);}};
  return <div className="coach-assign">
    {assignment?<span className={`coach-assign-label${assignment.overdue?' overdue':''}`}><UserRound size={13}/>{tr?'Sorumlu: ':'Owner: '}<strong>{assignment.mine?(tr?'siz':'you'):assignment.assigneeName}</strong>{assignment.dueOn&&<><CalendarClock size={13}/>{tr?'Son tarih ':'Due '}{coachDay(assignment.dueOn,lang)}{assignment.overdue&&<em>{tr?' · gecikti':' · overdue'}</em>}</>}</span>
      :null}
    {canWrite&&!open&&<button type="button" className="studio-text-button" onClick={()=>setOpen(true)}><UserRound size={14}/>{assignment?(tr?'Sorumluyu değiştir':'Change owner'):(tr?'Sorumlu ata':'Assign an owner')}</button>}
    {open&&<form className="coach-assign-form" onSubmit={event=>void save(event)}>
      <label htmlFor={`${id}-who`}>{tr?'Sorumlu':'Owner'}</label>
      <select id={`${id}-who`} value={assignee} onChange={event=>setAssignee(event.target.value)} required><option value="">{tr?'Ekip üyesi seçin':'Choose a teammate'}</option>{members.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select>
      <label htmlFor={`${id}-due`}>{tr?'Son tarih (isteğe bağlı)':'Due date (optional)'}</label>
      <input id={`${id}-due`} type="date" value={due} onChange={event=>setDue(event.target.value)}/>
      <div className="coach-action-buttons"><button type="submit" className="studio-secondary" disabled={busy||!assignee}>{tr?'Kaydet':'Save'}</button>{assignment&&<button type="button" className="studio-text-button" disabled={busy} onClick={()=>void save(null,true)}><X size={14}/>{tr?'Atamayı kaldır':'Remove'}</button>}<button type="button" className="studio-text-button" disabled={busy} onClick={()=>setOpen(false)}>{tr?'Vazgeç':'Cancel'}</button></div>
      <p className="coach-muted">{tr?'Atama yalnız ekip içi bir nottur; kimseye bildirim gönderilmez.':'An assignment is an internal note only; nobody is notified.'}</p>
    </form>}
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}
  </div>;
}
