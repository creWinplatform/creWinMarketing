'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, Check, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { CoachRefreshSnapshot } from '@/lib/platform/coach-types';
import { briefChangeLines } from './coach-changes';
import Msg from '@/components/Msg';

const channelNames:Record<string,[string,string]>={linkedin:['LinkedIn','LinkedIn'],instagram:['Instagram','Instagram'],facebook:['Facebook','Facebook'],twitter:['X','X'],email:['E-posta','Email'],seo:['Arama (SEO/blog)','Search (SEO/blog)'],blog:['Blog','Blog']};

// Monthly renewal: a proposed brief for the next 30 days from this period's records. Nothing changes until it is approved.
export default function CoachRefresh({workspace,lang,onChange}:{workspace:WorkspaceContext;lang:Locale;onChange?:()=>void}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [data,setData]=useState<CoachRefreshSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
  const request=useRef<AbortController|null>(null);
  const load=useCallback(()=>{request.current?.abort();const controller=new AbortController();request.current=controller;
    projectRequest<CoachRefreshSnapshot>('/api/platform/coach/refresh',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);});},[]);
  useEffect(()=>{load();return()=>request.current?.abort();},[load]);
  const post=async(key:string,body:object,message:string,changed=false)=>{if(busy)return;setBusy(key);setError('');setNotice('');try{setData(await projectRequest<CoachRefreshSnapshot>('/api/platform/coach/refresh',{method:'POST',body:JSON.stringify(body)}));setNotice(message);if(changed)onChange?.();}catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));load();}finally{setBusy('');}};
  if(!data||!data.hasBrief||!data.due&&!data.refresh)return error?<p className="studio-error" role="alert"><Msg text={error}/></p>:null;
  const refresh=data.refresh,n=(value:number)=>value.toLocaleString(locale),date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:workspace.project.timezone});
  const channel=(key:string|null)=>key?channelNames[key]?.[idx]||key:'';
  const monthLabel=new Date(`${data.month}-15T12:00:00Z`).toLocaleDateString(locale,{month:'long',year:'numeric',timeZone:'UTC'});
  const generate=(mode:'template'|'ai')=>void post(mode,{action:'generate',mode},tr?'Yenileme önerisi hazırlandı. İnceleyin; onaylanana kadar plan değişmez.':'The renewal proposal is ready. Review it; the plan doesn’t change until it is approved.');
  const generators=data.canWrite&&<div className="coach-footer-buttons">
    <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>generate('template')}><RefreshCw size={15} className={busy==='template'?'animate-spin':''}/>{refresh?(tr?'Kurallarla yeniden öner':'Propose again with rules'):(tr?'Kurallarla öner':'Propose with rules')}</button>
    {data.aiConfigured&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>generate('ai')}><Sparkles size={15}/>{tr?'AI ile öner':'Propose with AI'}</button>}
  </div>;
  const facts=refresh?.facts,counts=facts?{done:facts.plan.filter(item=>item.state==='done').length,skipped:facts.plan.filter(item=>item.state==='skipped').length,open:facts.plan.filter(item=>item.state==='open').length,drafts:Object.values(facts.drafts).reduce((sum,value)=>sum+value,0)}:null;
  return <section className="coach-panel coach-refresh" aria-labelledby="coach-refresh-title">
    <div className="studio-section-title"><h2 id="coach-refresh-title"><CalendarClock size={17}/>{tr?'Aylık yenileme':'Monthly renewal'}</h2><span className="studio-badge">{monthLabel}</span></div>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}
    {notice&&<p className="coach-note" role="status"><Msg text={notice}/></p>}
    {!refresh&&<><p>{data.planWeek&&data.planWeek>=4?(tr?'30 günlük plan son haftasında.':'The 30-day plan is in its last week.'):(tr?'Yeni bir ay başladı.':'A new month has started.')} {tr?'Koç, bu dönemin kayıtlarından (tamamlanan eylemler, taslaklar, yayınlar, ölçümler) gelecek 30 gün için güncel bir brief önerebilir. Onaylanana kadar hiçbir şey değişmez.':'The coach can propose an updated brief for the next 30 days from this period’s records (completed actions, drafts, publications, measurements). Nothing changes until it is approved.'}</p>{generators}{!data.canWrite&&<p className="coach-muted">{tr?'Öneriyi içerik yazma yetkisi olan ekip üyeleri hazırlar.':'Teammates with content rights prepare the proposal.'}</p>}</>}
    {refresh&&refresh.state==='approved'&&<p className="coach-note" role="status"><Check size={14}/>{tr?`Bu ayın yenilemesi ${refresh.decidedAt?date(refresh.decidedAt):''} tarihinde onaylandı; yeni 30 günlük plan başladı.`:`This month’s renewal was approved on ${refresh.decidedAt?date(refresh.decidedAt):''}; the new 30-day plan has started.`}</p>}
    {refresh&&refresh.state==='dismissed'&&<><p className="coach-muted">{tr?'Bu ayın önerisi reddedildi; plan değişmedi. İsterseniz yeniden hazırlayabilirsiniz.':'This month’s proposal was dismissed; the plan is unchanged. You can prepare it again.'}</p>{generators}</>}
    {refresh&&refresh.state==='proposed'&&facts&&counts&&<>
      <div className="coach-panel-tools"><span className="studio-badge">{refresh.source==='ai'?(tr?'AI önerisi':'AI proposal'):(tr?'Kurallara dayalı öneri':'Rule-based proposal')}</span><span className="coach-muted">{date(facts.from)} – {date(facts.to)}</span></div>
      {refresh.stale&&<p className="studio-error" role="alert">{tr?'Brief bu öneri hazırlandıktan sonra değişti. Onaylamadan önce öneriyi yeniden hazırlayın.':'The brief changed after this proposal was prepared. Prepare it again before approving.'}</p>}
      <p>{tr?`Bu dönem: ${n(counts.done)} eylem tamamlandı, ${n(counts.skipped)} ertelendi, ${n(counts.open)} açık · ${n(counts.drafts)} taslak · ${n(facts.publications)} kabul edilen yayın · ${n(facts.emailRecipients)} e-posta alıcısı · ${facts.measurements.length?`${n(facts.measurements.length)} ölçüm satırı`:'ölçüm yok'}.`:`This period: ${n(counts.done)} action(s) done, ${n(counts.skipped)} skipped, ${n(counts.open)} open · ${n(counts.drafts)} draft(s) · ${n(facts.publications)} accepted publication(s) · ${n(facts.emailRecipients)} email recipient(s) · ${facts.measurements.length?`${n(facts.measurements.length)} measurement row(s)`:'no measurements'}.`}</p>
      <div className="coach-review-grid">
        <section><h3>{tr?'Neden':'Why'}</h3><ul>{refresh.reasons.map((item,index)=><li key={index}><strong>{item.title}</strong> — {item.why}</li>)}</ul></section>
        <section><h3>{tr?'Değişenler':'What changes'}</h3>{refresh.changes?<ul>{briefChangeLines(refresh.changes,tr).map((line,index)=><li key={index}>{line}</li>)}</ul>:null}
          <p className="coach-muted">{tr?'Öncelikli kanallar':'Priority channels'}: {refresh.brief.channels.map(item=>channel(item.id)).join(', ')}</p></section>
      </div>
      <details className="coach-resolved"><summary>{tr?`Yeni 30 günlük plan (${refresh.brief.plan.length} eylem)`:`New 30-day plan (${refresh.brief.plan.length} actions)`}</summary><ul>{refresh.brief.plan.map((item,index)=><li key={index}><span className="coach-state">{tr?`${item.week}. hafta`:`Week ${item.week}`}</span><span>{item.title}</span><span className="coach-muted">{channel(item.channel)}{item.channel?' · ':''}{tr?`${item.minutes} dk`:`${item.minutes} min`}</span></li>)}</ul></details>
      <div className="coach-footer-buttons">
        {data.canApprove&&<button type="button" className="studio-primary" disabled={Boolean(busy)||refresh.stale} onClick={()=>void post('approve',{action:'approve',id:refresh.id,expectedRevision:refresh.revision,expectedCoachRevision:data.coachRevision},tr?'Yeni brief onaylandı; 30 günlük plan yeniden başladı.':'The new brief is approved; the 30-day plan has restarted.',true)}><Check size={15}/>{tr?'Onayla ve yeni planı başlat':'Approve and start the new plan'}</button>}
        {data.canWrite&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void post('dismiss',{action:'dismiss',id:refresh.id,expectedRevision:refresh.revision},tr?'Öneri reddedildi; plan değişmedi.':'Proposal dismissed; the plan is unchanged.')}><X size={15}/>{tr?'Reddet':'Dismiss'}</button>}
        {data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>generate('template')}><RefreshCw size={14} className={busy==='template'?'animate-spin':''}/>{tr?'Yeniden hazırla':'Prepare again'}</button>}
      </div>
      {!data.canApprove&&<p className="coach-muted">{tr?'Yeni briefi onay yetkisi olan ekip üyeleri onaylar.':'Teammates with approval rights approve the new brief.'}</p>}
    </>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Öneri yalnız bu projenin kayıtlarından hazırlanır; tahmin, artış vaadi veya otomatik değişiklik yoktur.':'The proposal uses only this project’s records; no estimates, promised growth or automatic changes.'}</p>
  </section>;
}
