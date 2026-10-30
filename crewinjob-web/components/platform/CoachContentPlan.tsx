'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarPlus, Check, Pencil, Plus, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { COACH_CONTENT_CHANNELS, COACH_PREFILL_KEY, type CoachChannel, type CoachContentItem, type CoachContentSnapshot } from '@/lib/platform/coach-types';
import Msg from '@/components/Msg';
import CoachAssign from './CoachAssign';

type Form={id:string|null;revision:number;channel:CoachChannel;theme:string;title:string;angle:string;goalId:string;stageIndex:string;plannedFor:string};
const channelNames:Record<CoachChannel,[string,string]>={linkedin:['LinkedIn','LinkedIn'],instagram:['Instagram','Instagram'],facebook:['Facebook','Facebook'],twitter:['X','X'],email:['E-posta','Email'],seo:['Blog (SEO)','Blog (SEO)'],whatsapp:['WhatsApp','WhatsApp'],ads:['Ücretli reklam','Paid ads']};
const stateNames={suggested:['Öneri','Suggestion'],approved:['Onaylı','Approved'],dismissed:['Çıkarıldı','Dismissed']} as const;
const sourceNames={ai:['AI önerisi','AI suggestion'],template:['Başlangıç şablonu','Starter template'],human:['Ekip ekledi','Added by the team']} as const;

export default function CoachContentPlan({workspace,lang}:{workspace:WorkspaceContext;lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [data,setData]=useState<CoachContentSnapshot|null>(null),[month,setMonth]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[form,setForm]=useState<Form|null>(null);
  const request=useRef<AbortController|null>(null),formRef=useRef<HTMLFormElement>(null);
  const load=useCallback((target?:string)=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;setError('');
    projectRequest<CoachContentSnapshot>(`/api/platform/coach/content${target?`?month=${encodeURIComponent(target)}`:''}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}).then(value=>{if(!controller.signal.aborted){setData(value);setMonth(value.month);}}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);});
  },[]);
  useEffect(()=>{load();return()=>request.current?.abort();},[load]);
  useEffect(()=>{if(form)formRef.current?.querySelector<HTMLElement>('input,select,textarea')?.focus();},[form?.id,Boolean(form)]);
  const fail=(reason:unknown)=>reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.');
  const post=async<T,>(body:object)=>projectRequest<T>('/api/platform/coach/content',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const run=async(key:string,body:object,message?:string)=>{if(busy)return;setBusy(key);setError('');setNotice('');try{const value=await post<CoachContentSnapshot|{created:boolean;snapshot:CoachContentSnapshot}>(body);if('snapshot' in value){setData(value.snapshot);setNotice(value.created?(tr?'Plan maddesi Takvim’e planlanmış iş olarak eklendi. Kimseye bildirim gönderilmedi.':'Plan item added to the Calendar as a planned task. No one was notified.'):(tr?'Bu maddenin açık bir işi zaten Takvim’de.':'This item already has an open task in the Calendar.'));}else{setData(value);if(message)setNotice(message);}return true;}catch(reason){setError(fail(reason));return false;}finally{setBusy('');}};
  const generate=(mode:'ai'|'template')=>{
    if(data?.items.some(item=>item.state==='suggested'&&item.source!=='human')&&!window.confirm(tr?'Açık öneriler yenileriyle değiştirilsin mi? Onaylı ve ekibin eklediği maddeler korunur.':'Replace open suggestions with new ones? Approved and team-added items are kept.'))return;
    void run('generate',{action:'generate',mode,month},tr?'Öneriler hazır. Her maddeyi inceleyip onaylayın.':'Suggestions are ready. Review and approve each item.');
  };
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(!form)return;const body={channel:form.channel,theme:form.theme,title:form.title,angle:form.angle,goalId:form.goalId||null,stageIndex:form.goalId&&form.stageIndex!==''?Number(form.stageIndex):null,plannedFor:form.plannedFor};
    if(await run('form',form.id?{action:'update',id:form.id,expectedRevision:form.revision,...body}:{action:'add',month,...body},form.id?(tr?'Madde güncellendi. Değişen madde yeniden onay bekler.':'Item updated. A changed item needs approval again.'):(tr?'Madde eklendi; onaylandığında kullanılabilir.':'Item added; it can be used once approved.')))setForm(null);
  };
  // Email items open a campaign draft (audience, consent and approval live there); everything else opens the content studio.
  const studio=(item:CoachContentItem)=>item.channel==='email'?'campaigns':'library';
  const handoff=(item:CoachContentItem)=>{if(!item.prefill)return;try{sessionStorage.setItem(COACH_PREFILL_KEY,JSON.stringify({...item.prefill,tab:studio(item),at:Date.now()}));}catch{/* The studio still opens without a pre-filled brief. */}};
  const date=(value:string)=>new Date(`${value}T12:00:00Z`).toLocaleDateString(locale,{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
  const monthLabel=(value:string)=>new Date(`${value}-15T12:00:00Z`).toLocaleDateString(locale,{month:'long',year:'numeric',timeZone:'UTC'});
  const lastDay=(value:string)=>{const [year,index]=value.split('-').map(Number);return `${value}-${String(new Date(Date.UTC(year,index,0)).getUTCDate()).padStart(2,'0')}`;};
  const blank=():Form=>({id:null,revision:0,channel:data?.briefChannels[0]||'linkedin',theme:'',title:'',angle:'',goalId:data?.goals[0]?.id||'',stageIndex:'',plannedFor:data?.today.startsWith(month+'-')?data.today:`${month}-01`});
  const goalLabel=(id:string|null)=>data?.goals.find(goal=>goal.id===id)?.label[lang];
  const open=data?.items.filter(item=>item.state!=='dismissed')||[],dismissed=data?.items.filter(item=>item.state==='dismissed')||[];
  const channels=[...new Set<CoachChannel>([...(data?.briefChannels||[]),...open.map(item=>item.channel)])];

  const editor=form&&<form ref={formRef} className="coach-content-form studio-form-grid" onSubmit={event=>void save(event)}>
    <label>{tr?'Kanal':'Channel'}<select value={form.channel} onChange={event=>setForm({...form,channel:event.target.value as CoachChannel})}>{COACH_CONTENT_CHANNELS.map(id=><option key={id} value={id}>{channelNames[id][idx]}</option>)}</select></label>
    <label>{tr?'Tarih':'Date'}<input type="date" required min={`${month}-01`} max={lastDay(month)} value={form.plannedFor} onChange={event=>setForm({...form,plannedFor:event.target.value})}/></label>
    <label>{tr?'Tema':'Theme'}<input required maxLength={60} value={form.theme} onChange={event=>setForm({...form,theme:event.target.value})}/></label>
    <label>{tr?'Hedef':'Goal'}<select value={form.goalId} onChange={event=>setForm({...form,goalId:event.target.value,stageIndex:''})}><option value="">{tr?'Hedefe bağlı değil':'Not linked to a goal'}</option>{data?.goals.map(goal=><option key={goal.id} value={goal.id}>{goal.label[lang]}</option>)}</select></label>
    {form.goalId&&<label>{tr?'Hangi aşamayı ilerletmeli?':'Which stage should it move?'}<select value={form.stageIndex} onChange={event=>setForm({...form,stageIndex:event.target.value})}><option value="">{tr?'Belirtilmedi':'Not set'}</option>{data?.goals.find(goal=>goal.id===form.goalId)?.stages.map((stage,index)=><option key={index} value={String(index)}>{stage[lang]}</option>)}</select></label>}
    <label className="studio-form-full">{tr?'Başlık':'Title'}<input required maxLength={140} value={form.title} onChange={event=>setForm({...form,title:event.target.value})}/></label>
    <label className="studio-form-full">{tr?'Kısa açı':'Short angle'}<textarea required maxLength={400} rows={3} value={form.angle} onChange={event=>setForm({...form,angle:event.target.value})}/></label>
    <div className="studio-form-full coach-footer-buttons"><button type="button" className="studio-text-button" onClick={()=>setForm(null)}><X size={14}/>{tr?'Vazgeç':'Cancel'}</button><button className="studio-primary" disabled={Boolean(busy)}>{busy==='form'?(tr?'Kaydediliyor…':'Saving…'):(tr?'Kaydet':'Save')}</button></div>
  </form>;

  const card=(item:CoachContentItem)=><li key={item.id} className={`coach-content-item ${item.state}`}>
    {form?.id===item.id?editor:<>
      <div className="coach-action-meta"><time dateTime={item.plannedFor}>{date(item.plannedFor)}</time><span className="studio-badge">{item.theme}</span><span className={`coach-state ${item.state==='approved'?'done':''}`}>{stateNames[item.state][idx]}</span><span>{sourceNames[item.source][idx]}</span></div>
      <h4>{item.title}</h4><p>{item.angle}</p>
      {item.goalId&&<p className="coach-muted">{tr?'Hedef: ':'Goal: '}{goalLabel(item.goalId)||item.goalId}{item.stageIndex!==null&&data?.goals.find(goal=>goal.id===item.goalId)?.stages[item.stageIndex]?` · ${data.goals.find(goal=>goal.id===item.goalId)!.stages[item.stageIndex!][lang]}`:''}</p>}
      {item.state!=='dismissed'&&<CoachAssign kind="content" itemId={item.id} assignment={item.assignment} lang={lang} onSaved={()=>load(month)}/>}
      {data?.canWrite&&<div className="coach-action-buttons">
        {item.state==='suggested'&&<><button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void run(item.id,{action:'decide',id:item.id,expectedRevision:item.revision,decision:'approve'})}><Check size={15}/>{tr?'Onayla':'Approve'}</button><button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void run(item.id,{action:'decide',id:item.id,expectedRevision:item.revision,decision:'dismiss'})}><X size={15}/>{tr?'Çıkar':'Dismiss'}</button></>}
        {item.state==='approved'&&<><a className="studio-secondary" href={`/?tab=${studio(item)}`} onClick={()=>handoff(item)}>{item.channel==='email'?tr?'Kampanya taslağı oluştur':'Create a campaign draft':tr?'Taslak oluştur':'Create a draft'}<ArrowRight size={15}/></a>{item.taskId?<a className="studio-text-button" href="/?tab=calendar"><CalendarPlus size={15}/>{tr?'Takvimde':'In Calendar'}</a>:<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void run(item.id,{action:'schedule',id:item.id})}><CalendarPlus size={15}/>{tr?'Takvime ekle':'Add to Calendar'}</button>}</>}
        <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>setForm({id:item.id,revision:item.revision,channel:item.channel,theme:item.theme,title:item.title,angle:item.angle,goalId:item.goalId||'',stageIndex:item.stageIndex===null?'':String(item.stageIndex),plannedFor:item.plannedFor})}><Pencil size={14}/>{tr?'Düzenle':'Edit'}</button>
      </div>}
    </>}
  </li>;

  return <section className="coach-content-plan">
    <header className="studio-page-heading"><div><p className="studio-eyebrow">{tr?'BÜYÜME KOÇU':'GROWTH COACH'}</p><h1>{tr?'Aylık içerik planı':'Monthly content plan'}</h1><p className="studio-subtitle">{tr?'Onaylı strateji briefinden kanal bazında içerik önerileri. Her maddeyi siz onaylarsınız.':'Per-channel content suggestions from your approved strategy brief. You approve every item.'}</p></div></header>
    {error&&<div className="studio-error" role="alert"><Msg text={error}/></div>}
    {notice&&<p className="studio-success" role="status"><Msg text={notice}/></p>}
    {!data&&!error&&<p className="studio-skeleton" role="status">{tr?'İçerik planı yükleniyor…':'Loading the content plan…'}</p>}
    {data&&!data.hasBrief&&<div className="studio-empty"><Sparkles size={24}/><p>{tr?'İçerik planı, onaylı bir strateji briefinden hazırlanır. Önce genel bakıştaki büyüme koçunda briefi onaylayın.':'The content plan is prepared from an approved strategy brief. Approve a brief in the growth coach on the overview first.'}</p><a className="studio-text-button" href="/?tab=dashboard">{tr?'Büyüme koçuna git':'Go to the growth coach'}<ArrowRight size={14}/></a></div>}
    {data&&data.hasBrief&&<>
      <div className="coach-content-toolbar">
        <div className="coach-month-switch" role="group" aria-label={tr?'Ay':'Month'}>{data.months.map(value=><button key={value} type="button" aria-pressed={value===month} onClick={()=>{setForm(null);load(value);}}>{monthLabel(value)}</button>)}</div>
        {data.canWrite&&<div className="coach-footer-buttons">
          <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>setForm(blank())}><Plus size={15}/>{tr?'Madde ekle':'Add an item'}</button>
          {data.aiConfigured&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>generate('template')}>{tr?'Başlangıç şablonu':'Starter template'}</button>}
          <button type="button" className="studio-primary" disabled={Boolean(busy)} onClick={()=>generate(data.aiConfigured?'ai':'template')}><Sparkles size={15}/>{busy==='generate'?(tr?'Hazırlanıyor…':'Preparing…'):data.aiConfigured?(tr?'AI ile öner':'Suggest with AI'):(tr?'Başlangıç planı öner':'Suggest a starter plan')}</button>
        </div>}
      </div>
      {!data.aiConfigured&&data.canWrite&&<p className="coach-note"><Sparkles size={14}/>{tr?'Bu platformda AI yapılandırılmadı; öneriler briefinizden kural tabanlı hazırlanır.':'AI isn’t configured on this platform; suggestions are rule-based from your brief.'}</p>}
      {form&&!form.id&&<div className="coach-content-new">{editor}</div>}
      {open.length===0&&!form&&<div className="studio-empty"><p>{tr?`${monthLabel(month)} için henüz plan maddesi yok.`:`No plan items for ${monthLabel(month)} yet.`}</p></div>}
      {channels.filter(channel=>open.some(item=>item.channel===channel)).map(channel=>{const items=open.filter(item=>item.channel===channel);return <section key={channel} className="coach-content-channel"><h3>{channelNames[channel][idx]}<span className="studio-badge">{items.length}</span></h3><ol>{items.map(card)}</ol></section>;})}
      {dismissed.length>0&&<details className="coach-resolved"><summary>{tr?`Çıkarılanlar (${dismissed.length})`:`Dismissed (${dismissed.length})`}</summary><ul>{dismissed.map(item=><li key={item.id}><span className="coach-state">{channelNames[item.channel][idx]}</span><span>{item.title}</span>{data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void run(item.id,{action:'decide',id:item.id,expectedRevision:item.revision,decision:'restore'})}><RotateCcw size={14}/>{tr?'Geri al':'Restore'}</button>}</li>)}</ul></details>}
      <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Plan maddeleri öneridir; onaylasanız da hiçbir şey otomatik yayınlanmaz veya gönderilmez.':'Plan items are suggestions; even approved, nothing is published or sent automatically.'}</p>
    </>}
  </section>;
}
