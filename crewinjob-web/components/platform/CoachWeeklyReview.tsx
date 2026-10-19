'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ClipboardList, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { CoachAdjustment, CoachReviewSnapshot } from '@/lib/platform/coach-types';
import Msg from '@/components/Msg';

const sources:Record<string,[string,string]>={manual:['Manuel kayıt','Manual record'],ga4:['Google Analytics','Google Analytics'],search_console:['Search Console','Search Console'],product_webhook:['Ürün olayları','Product events']};
const channels:Record<string,[string,string]>={linkedin:['LinkedIn','LinkedIn'],instagram:['Instagram','Instagram'],facebook:['Facebook','Facebook'],twitter:['X','X'],email:['E-posta','Email'],blog:['Blog','Blog'],tiktok:['TikTok','TikTok']};

export default function CoachWeeklyReview({workspace,lang,onChange}:{workspace:WorkspaceContext;lang:Locale;onChange?:()=>void}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [data,setData]=useState<CoachReviewSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
  const request=useRef<AbortController|null>(null);
  const load=useCallback(()=>{request.current?.abort();const controller=new AbortController();request.current=controller;
    projectRequest<CoachReviewSnapshot>('/api/platform/coach/review',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);});},[]);
  useEffect(()=>{load();return()=>request.current?.abort();},[load]);
  const post=async(key:string,body:object,message:string)=>{if(busy)return;setBusy(key);setError('');setNotice('');try{setData(await projectRequest<CoachReviewSnapshot>('/api/platform/coach/review',{method:'POST',body:JSON.stringify(body)}));setNotice(message);onChange?.();}catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));load();}finally{setBusy('');}};
  const date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:workspace.project.timezone});
  const n=(value:number)=>value.toLocaleString(locale);
  if(!data||!data.hasBrief)return error?<p className="studio-error" role="alert"><Msg text={error}/></p>:null;
  const review=data.review,facts=review?.facts;
  const decide=(item:CoachAdjustment,decision:'accept'|'reject')=>void post(item.id,{action:'decide',reviewId:review!.id,adjustmentId:item.id,decision,expectedRevision:data.coachRevision},decision==='accept'?(item.kind==='note'?(tr?'Not alındı.':'Noted.'):(tr?'Plan güncellendi; değişiklik gelecek haftanın eylemlerine yansır.':'The plan was updated; the change feeds next week’s actions.')):(tr?'Öneri reddedildi; plan değişmedi.':'Proposal rejected; the plan is unchanged.'));
  const happened=facts?[
    facts.actions.done||facts.actions.skipped?(tr?`Koç eylemleri: ${n(facts.actions.done)} tamamlandı, ${n(facts.actions.skipped)} atlandı, ${n(facts.actions.open)} açık.`:`Coach actions: ${n(facts.actions.done)} done, ${n(facts.actions.skipped)} skipped, ${n(facts.actions.open)} open.`):(tr?'Bu dönemde koç eylemi tamamlanmadı veya atlanmadı.':'No coach action was completed or skipped in this period.'),
    facts.content.drafts?(tr?`${n(facts.content.drafts)} içerik taslağı kaydedildi${Object.keys(facts.content.draftsByChannel).length?` (${Object.entries(facts.content.draftsByChannel).map(([key,value])=>`${channels[key]?.[idx]||key}: ${n(value)}`).join(', ')})`:''}.`:`${n(facts.content.drafts)} content draft(s) saved${Object.keys(facts.content.draftsByChannel).length?` (${Object.entries(facts.content.draftsByChannel).map(([key,value])=>`${channels[key]?.[idx]||key}: ${n(value)}`).join(', ')})`:''}.`):(tr?'Yeni içerik taslağı kaydedilmedi.':'No new content draft was saved.'),
    ...(facts.content.campaigns?[tr?`${n(facts.content.campaigns)} kampanya oluşturuldu.`:`${n(facts.content.campaigns)} campaign(s) created.`]:[]),
    facts.content.publications?(tr?`${n(facts.content.publications)} sosyal yayın sağlayıcı tarafından kabul edildi (kabul, erişim veya etkileşim değildir).`:`${n(facts.content.publications)} social publication(s) accepted by the provider (acceptance is not reach or engagement).`):(tr?'Bu dönemde kabul edilen sosyal yayın yok.':'No social publication was accepted in this period.'),
    ...(facts.content.planApproved?[tr?`${n(facts.content.planApproved)} içerik planı maddesi onaylandı.`:`${n(facts.content.planApproved)} content plan item(s) approved.`]:[]),
    ...(facts.seo.audits||facts.seo.briefsApproved?[tr?`SEO: ${n(facts.seo.audits)} bulgulu denetim, ${n(facts.seo.briefsApproved)} onaylı içerik briefi.`:`SEO: ${n(facts.seo.audits)} audit(s) with findings, ${n(facts.seo.briefsApproved)} approved content brief(s).`]:[]),
  ]:[];

  return <section className="coach-panel coach-review" aria-labelledby="coach-review-title">
    <div className="studio-section-title"><h2 id="coach-review-title"><ClipboardList size={17}/>{tr?'Haftalık özet':'Weekly review'}</h2>
      <div className="coach-panel-tools">{facts&&<span className="studio-badge">{date(facts.from)} – {date(facts.to)}</span>}{data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post('generate',{action:'generate'},tr?'Özet proje kayıtlarından hazırlandı.':'The review was built from project records.')}><RefreshCw size={14} className={busy==='generate'?'animate-spin':''}/>{review?(tr?'Özeti yenile':'Refresh the review'):(tr?'Bu haftanın özetini hazırla':'Prepare this week’s review')}</button>}</div>
    </div>
    {error&&<div className="studio-error" role="alert"><Msg text={error}/></div>}
    {notice&&<p className="studio-success" role="status"><Msg text={notice}/></p>}
    {!review&&<p className="coach-muted">{tr?'Son 7 günün proje kayıtlarından sade bir özet: ölçümler, koç eylemleri, taslaklar ve yayınlar. Tahmin, artış veya ROI hesaplanmaz.':'A plain summary of the last 7 days of project records: measurements, coach actions, drafts and publications. No estimates, uplift or ROI.'}</p>}
    {review&&facts&&<>
      {!review.hasData&&<p className="coach-note" role="status">{tr?'Bu dönem için kayıt yok: ölçüm, tamamlanan eylem, taslak veya yayın bulunmadı. Veri yokluğu sıfır sonuç demek değildir.':'There are no records for this period: no measurement, completed action, draft or publication. No data is not a zero result.'}</p>}
      <div className="coach-review-grid">
        <section><h3>{tr?'Ne oldu':'What happened'}</h3><ul>{happened.map((item,index)=><li key={index}>{item}</li>)}</ul>{facts.actions.doneTitles.length>0&&<p className="coach-muted">{tr?'Tamamlananlar: ':'Done: '}{facts.actions.doneTitles.join(' · ')}</p>}</section>
        <section><h3>{tr?'Ölçümler':'Measurements'}</h3>{facts.measurements.length?<ul>{facts.measurements.map(item=><li key={`${item.goalId}-${item.stage.en}`}><strong>{item.goal[lang]} · {item.stage[lang]}:</strong> {n(item.latest)} ({date(item.latestAt)}){item.previous!==null?(tr?` · önceki ${n(item.previous)} (${date(item.previousAt!)})`:` · previous ${n(item.previous)} (${date(item.previousAt!)})`):(tr?' · karşılaştırılacak önceki kayıt yok':' · no earlier record to compare')} · {sources[item.source]?.[idx]||item.source}</li>)}</ul>:<p>{tr?'Bu dönemde ölçüm kaydedilmedi. Veri yok, sıfır demek değildir.':'No measurement was recorded in this period. No data is not zero.'}</p>}
          {!facts.connections.ga4&&!facts.connections.searchConsole&&<p className="coach-muted">{tr?'Google Analytics ve Search Console bağlı değil; site trafiği hakkında bilgi yok.':'Google Analytics and Search Console aren’t connected; there is no information about site traffic.'}</p>}</section>
        <section><h3>{tr?'Ne işe yarıyor gibi':'What seems to work'}</h3>{facts.rose.length?<><ul>{facts.rose.map((item,index)=><li key={index}>{item.goal[lang]} · {item.stage[lang]}: {n(item.from)} → {n(item.to)}</li>)}</ul><p className="coach-muted">{tr?'Bu ölçümler, ekip aktifken arttı. Bu bir neden-sonuç kanıtı değildir.':'These measurements rose while the team was active. This is not proof of cause.'}</p></>:<p>{tr?'Neyin işe yaradığını söylemek için henüz yeterli veri yok.':'There isn’t enough data yet to tell what works.'}</p>}</section>
      </div>
      <section className="coach-review-adjustments"><h3>{tr?'Önerilen plan ayarlamaları':'Proposed plan adjustments'}</h3>
        {review.adjustments.length===0?<p className="coach-muted">{tr?'Bu hafta için ayarlama önerisi yok.':'No adjustments are proposed for this week.'}</p>:<ul>{review.adjustments.map(item=><li key={item.id} className={`coach-action ${item.state}`}>
          <div className="coach-action-meta"><span className="studio-badge">{item.kind==='add'?(tr?`${item.toWeek}. haftaya ekle`:`Add to week ${item.toWeek}`):item.kind==='move'?(tr?'Taşı':'Move'):(tr?'Not':'Note')}</span>{item.state!=='proposed'&&<span className={`coach-state ${item.state==='accepted'?'done':''}`}>{item.state==='accepted'?(tr?'Kabul edildi':'Accepted'):(tr?'Reddedildi':'Rejected')}</span>}</div>
          <h4>{item.title[lang]}</h4><p>{item.why[lang]}</p>
          {item.state==='proposed'&&<div className="coach-action-buttons">{data.canApprove||item.kind==='note'?<button type="button" className="studio-secondary" disabled={Boolean(busy)||!data.canApprove} onClick={()=>decide(item,'accept')}><Check size={15}/>{item.kind==='note'?(tr?'Anladım':'Got it'):(tr?'Plana uygula':'Apply to the plan')}</button>:<span className="coach-muted">{tr?'Plana uygulamak için onay yetkisi gerekir.':'Applying to the plan needs approval rights.'}</span>}{data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>decide(item,'reject')}><X size={15}/>{tr?'Reddet':'Reject'}</button>}</div>}
        </li>)}</ul>}
      </section>
    </>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Yalnız bu projenin kayıtlarından hazırlanır; tahmin, artış veya ROI hesaplanmaz. Plan değişiklikleri onayla uygulanır.':'Built only from this project’s records; no estimates, uplift or ROI. Plan changes apply only when approved.'}</p>
  </section>;
}
