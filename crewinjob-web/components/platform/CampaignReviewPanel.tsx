'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {X,RefreshCw,Mail,AlignLeft,Check,ShieldCheck,HelpCircle,LockKeyhole,MessageSquare,Undo2} from 'lucide-react';
import type {Locale} from '@/lib/platform/catalog';
import {projectRequest} from '@/lib/platform/client';
import {REVIEW_CHECK_LABELS,REVIEW_CHECK_HINTS,REVIEW_STATE_LABELS,type CampaignReviewData,type ReviewDecision} from '@/lib/platform/campaign-review-types';
import EmailPilotPanel from './EmailPilotPanel';
import EmailDeliveryPanel from './EmailDeliveryPanel';

export default function CampaignReviewPanel({id,lang,onClose}:{id:string;lang:Locale;onClose:()=>void}){
  const tr=lang==='tr',[data,setData]=useState<CampaignReviewData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[ack,setAck]=useState(false),[view,setView]=useState<'design'|'text'>('design');
  const request=useRef<AbortController|null>(null),panel=useRef<HTMLElement>(null);
  const [pending,setPending]=useState(''),[notice,setNotice]=useState('');
  const load=useCallback(async()=>{
    const controller=new AbortController();request.current?.abort();request.current=controller;setError('');setNotice('');setPending('load');setBusy(true);
    try{const value=await projectRequest<CampaignReviewData>(`/api/platform/campaign-review?id=${encodeURIComponent(id)}`,{signal:controller.signal});if(!controller.signal.aborted){setData(value);setAck(false);}}
    catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Request failed.');}
    finally{if(!controller.signal.aborted){setBusy(false);setPending('');}}
  },[id]);
  useEffect(()=>{void load();panel.current?.scrollIntoView({block:'start',behavior:'instant'});panel.current?.focus({preventScroll:true});return()=>request.current?.abort();},[load]);
  useEffect(()=>{if(error)panel.current?.scrollIntoView({block:'start',behavior:'instant'});},[error]);
  async function action(decision?:ReviewDecision){
    if(!data)return;
    const controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setPending(decision?'decision':'check');setError('');setNotice('');
    try{
      const next=await projectRequest<CampaignReviewData>('/api/platform/campaign-review',{method:'POST',signal:controller.signal,body:JSON.stringify({id,expectedDigest:data.digest,...(decision?{action:'decide',decision,note,expectedReviewId:data.history[0]?.id??null}:{action:'check'})})});
      if(!controller.signal.aborted){setData(next);setAck(false);if(decision){setNote('');setNotice(tr?'Karar kaydedildi. Gönderim yapılmadı.':'Decision recorded. No message was sent.');}}
    }catch(reason){if(!controller.signal.aborted){setAck(false);setError(reason instanceof Error?reason.message:'Request failed.');}}
    finally{if(!controller.signal.aborted){setBusy(false);setPending('');}}
  }
  const ready=data?.checks.slice(0,8).every(check=>check.state==='pass');
  const date=(value:string)=>new Date(value).toLocaleString(tr?'tr-TR':'en-GB',{timeZone:data?.timezone||'UTC'});
  return <section className="studio-band campaign-review" ref={panel} tabIndex={-1} aria-labelledby="campaign-review-heading">
    <div className="studio-section-title"><div><p className="studio-eyebrow">{tr?'E-POSTA İNCELEMESİ':'EMAIL REVIEW'}</p><h2 id="campaign-review-heading">{data?.name||(tr?'Taslak incelemesi':'Draft review')}</h2></div><div className="studio-row-actions"><button className="icon-button" title={tr?'İncelemeyi yenile':'Refresh review'} aria-label={tr?'İncelemeyi yenile':'Refresh review'} disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/></button><button className="icon-button" title={tr?'İncelemeyi kapat':'Close review'} aria-label={tr?'İncelemeyi kapat':'Close review'} onClick={onClose}><X size={18}/></button></div></div>
    {error&&<p role="alert" className="studio-error">{error}</p>}
    {!data&&busy&&<p role="status" className="studio-skeleton">{tr?'Kaydedilmiş taslak yükleniyor…':'Loading saved draft…'}</p>}
    {data&&<>
      <div className="campaign-review-status"><span className={`studio-badge ${data.approval==='approved'?'review-approved':''}`} role="status">{REVIEW_STATE_LABELS[data.approval][tr?0:1]}</span><span><LockKeyhole size={14}/>{tr?'İçerik onayı gönderim başlatmaz':'Content approval does not start sending'}</span></div>
      <div className="campaign-review-grid"><div className="campaign-review-message">
        <nav className="studio-settings-tabs" aria-label={tr?'Mesaj görünümü':'Message view'}><button aria-current={view==='design'?'page':undefined} onClick={()=>setView('design')}><Mail size={16}/>{tr?'E-posta':'Email'}</button><button aria-current={view==='text'?'page':undefined} onClick={()=>setView('text')}><AlignLeft size={16}/>{tr?'Düz metin':'Plain text'}</button></nav>
        {view==='design'?<iframe sandbox="" referrerPolicy="no-referrer" title={tr?'Güvenli e-posta önizlemesi':'Safe email preview'} srcDoc={data.html}/>:<div className="campaign-review-plain"><h3>{data.subject||(tr?'Konu eksik':'Missing subject')}</h3><p>{data.text}</p></div>}
        <dl className="campaign-review-meta"><div><dt>{tr?'Hedef URL':'Target URL'}</dt><dd>{data.ctaUrl||'—'}</dd></div><div><dt>{tr?'İçerik sürümü':'Content revision'}</dt><dd><code>{data.digest.slice(0,12)}</code></dd></div></dl>
      </div><div className="campaign-review-readiness">
        <div className="studio-section-title"><h3>{tr?'İçerik ve kitle':'Content and audience'}</h3>{data.canCheck&&<button className="studio-text-button" disabled={busy} onClick={()=>void action()}><RefreshCw size={15}/>{pending==='check'?(tr?'Kontrol ediliyor…':'Checking…'):(tr?'Ön kontrolü yenile':'Run preflight')}</button>}</div>
        {data.checks.map((check,index)=><div key={check.code} className={`campaign-review-check check-${check.state}`}>{index===9&&<h3>{tr?'Gönderim kapıları':'Sending gates'}</h3>}<div>{check.state==='pass'?<Check size={16}/>:check.state==='pending'?<HelpCircle size={16}/>:<LockKeyhole size={16}/>}<span>{REVIEW_CHECK_LABELS[check.code]?.[tr?0:1]||check.code}</span><small>{check.state==='pass'?(tr?'Uygun':'Passed'):check.state==='pending'?(tr?'Bekliyor':'Pending'):(tr?'Kapalı':'Blocked')}</small></div>{check.state==='blocked'&&REVIEW_CHECK_HINTS[check.code]&&<p className="studio-note">{REVIEW_CHECK_HINTS[check.code][tr?0:1]}</p>}</div>)}
        {data.audienceError&&<p className="studio-error" role="alert">{data.audienceError}</p>}
        {data.audience&&<div className="campaign-review-audience"><strong>{data.audience.matched} / {data.audience.total}</strong><span>{tr?'eşleşen gözlenen kayıt':'matching observed records'}</span><p>{data.audience.unknown} {tr?'belirsiz':'unknown'} · {date(data.audience.computedAt)}</p>{!data.audience.fresh&&<p className="studio-error">{tr?'Ön kontrol güncel değil. Yeniden çalıştırın.':'Preflight is out of date. Run it again.'}</p>}</div>}
        <p className="studio-note">{tr?'İzinli benzersiz alıcı':'Eligible unique recipients'}: <strong>{data.eligibleRecipients??(tr?'Hesaplanmadı':'Not evaluated')}</strong>. {tr?'İçerik onayı gönderim izni değildir.':'Content approval does not authorize sending.'}</p>
        {data.eligibility&&<dl className="recipient-counts"><div><dt>{tr?'Geçersiz adres':'Invalid address'}</dt><dd>{data.eligibility.invalid}</dd></div><div><dt>{tr?'İzin bekliyor':'Awaiting consent'}</dt><dd>{data.eligibility.unconsented}</dd></div><div><dt>{tr?'Engellenmiş':'Suppressed'}</dt><dd>{data.eligibility.suppressed}</dd></div><div><dt>{tr?'Tekilleştirilen':'Deduplicated'}</dt><dd>{data.eligibility.duplicates}</dd></div></dl>}
        <dl className="campaign-review-meta"><div><dt>{tr?'Seçili gönderen':'Selected sender'}</dt><dd>{data.sender.maskedSender||'—'}{data.sender.domain?` · ${data.sender.domain}`:''}</dd></div></dl>
        {data.pilot&&<dl className="recipient-counts"><div><dt>{tr?'Pilot listesinde izinli':'Consented and allowlisted'}</dt><dd>{data.pilot.allowed}</dd></div><div><dt>{tr?'Sınır sonrası pilot':'Pilot after cap'}</dt><dd>{data.pilot.planned}</dd></div><div><dt>{tr?'Pilot listesi dışında':'Not allowlisted'}</dt><dd>{data.pilot.notAllowlisted}</dd></div><div><dt>{tr?'Pilot sınırı':'Pilot cap'}</dt><dd>{data.pilot.maxRecipients??'—'}</dd></div></dl>}
      </div></div>
      {data.canApprove?<div className="campaign-review-decision">
        {notice&&<p className="studio-success" role="status">{notice}</p>}
        <label>{tr?'İnceleme notu':'Review note'}<textarea rows={3} maxLength={1000} disabled={busy} value={note} onChange={event=>setNote(event.target.value)}/></label>
        {data.approval!=='approved'&&<label className="campaign-review-ack"><input type="checkbox" disabled={busy||!ready} checked={ack} onChange={event=>setAck(event.target.checked)}/>{tr?'Kaydedilmiş içeriği ve hedef kitleyi inceledim.':'I reviewed the saved content and target audience.'}</label>}
        <div className="studio-form-actions"><button className="studio-secondary" disabled={busy||!note.trim()} onClick={()=>void action('rejected')}><MessageSquare size={15}/>{tr?'Değişiklik iste':'Request changes'}</button>{data.approval==='approved'?<button className="studio-secondary" disabled={busy||!note.trim()} onClick={()=>void action('revoked')}><Undo2 size={15}/>{pending==='decision'?(tr?'Kaydediliyor…':'Saving…'):(tr?'Onayı geri çek':'Withdraw approval')}</button>:<button className="studio-primary" disabled={busy||!ready||!ack} onClick={()=>void action('approved')}><ShieldCheck size={16}/>{pending==='decision'?(tr?'Kaydediliyor…':'Saving…'):(tr?'İçeriği onayla':'Approve content')}</button>}</div>
      </div>:<p className="studio-data-notice">{tr?'İçerik onayını proje sahibi veya yöneticisi verebilir.':'Only a project owner or administrator can approve content.'}</p>}
      <EmailPilotPanel key={data.campaignId} campaignId={data.campaignId} expectedDigest={data.digest} expectedReviewId={data.history[0]?.id??null} ready={Boolean(data.approval==='approved'&&data.audience?.fresh&&(data.pilot?.planned??0)>0)} lang={lang} canManage={data.canApprove}/>
      <EmailDeliveryPanel key={`delivery-${data.campaignId}`} campaignId={data.campaignId} digest={data.digest} reviewId={data.history[0]?.id??null} ready={Boolean(data.approval==='approved'&&data.audience?.fresh&&(data.pilot?.planned??0)>0)} lang={lang} canManage={data.canApprove}/>
      <section className="campaign-review-history"><h3>{tr?'Karar geçmişi':'Decision history'}</h3>{data.history.length===0?<p className="studio-note">{tr?'Henüz bir karar kaydedilmedi.':'No decision recorded yet.'}</p>:data.history.map(item=><article key={item.id}><div><strong>{REVIEW_STATE_LABELS[item.decision][tr?0:1]}</strong><time dateTime={item.createdAt}>{date(item.createdAt)}</time><span>{item.byYou?(tr?'Siz':'You'):(tr?'Proje yetkilisi':'Project reviewer')}</span></div>{item.note&&<p>{item.note}</p>}</article>)}</section>
    </>}
  </section>;
}
