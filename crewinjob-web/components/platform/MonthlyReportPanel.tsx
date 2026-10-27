'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, FileText, Link2, RotateCcw } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { REPORT_LIMITS, type MonthlyReportView } from '@/lib/platform/monthly-report-types';
import MonthlyReportDocument from './MonthlyReportDocument';
import Msg from '@/components/Msg';

// The team's side of the monthly report: preview, a note, approval of exactly what is on screen, and read-only links.
export default function MonthlyReportPanel({lang}:{lang:Locale}){
  const tr=lang==='tr',locale=localeTag(lang);
  const [data,setData]=useState<MonthlyReportView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [note,setNote]=useState(''),[ack,setAck]=useState(false),[days,setDays]=useState<number>(30),[link,setLink]=useState(''),[copied,setCopied]=useState(false);
  const mounted=useRef(false);
  const apply=(value:MonthlyReportView)=>{setData(value);setNote(value.note);setAck(false);};
  async function load(month?:string){
    setBusy(true);setError('');setLink('');
    try{const value=await projectRequest<MonthlyReportView>(`/api/platform/monthly-report${month?`?month=${month}`:''}`,{signal:AbortSignal.timeout(20000)});if(mounted.current)apply(value);}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:(tr?'Rapor alınamadı.':'Could not load the report.'));}
    finally{if(mounted.current)setBusy(false);}
  }
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[]);
  async function act(body:Record<string,unknown>,success:string){
    if(busy||!data)return;setBusy(true);setError('');setNotice('');
    try{
      const value=await projectRequest<MonthlyReportView|{token:string;report:MonthlyReportView}>('/api/platform/monthly-report',{method:'POST',body:JSON.stringify({month:data.month,...body}),signal:AbortSignal.timeout(20000)});
      if(!mounted.current)return;
      if('token' in value){apply(value.report);setLink(`${window.location.origin}/report#token=${value.token}`);setCopied(false);}else{apply(value);if(body.action!=='share')setLink('');}
      setNotice(success);
    }catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}
    finally{if(mounted.current)setBusy(false);}
  }
  if(!data)return error?<p role="alert" className="studio-error"><Msg text={error}/></p>:null;
  const monthName=(key:string)=>new Date(`${key}-15T12:00:00Z`).toLocaleDateString(locale,{month:'long',year:'numeric',timeZone:'UTC'});
  const when=(value:string)=>new Date(value).toLocaleString(locale,{dateStyle:'medium',timeStyle:'short'});
  const current=data.month===data.months[0],approved=data.state==='approved',now=Date.now();
  return <section className="studio-band monthly-report-panel" aria-labelledby="monthly-report-title" aria-busy={busy}>
    <div className="studio-section-title"><h2 id="monthly-report-title"><FileText size={16}/>{tr?'Aylık sonuç raporu':'Monthly results report'}</h2><span className="studio-badge">{approved?(tr?'Onaylı':'Approved'):(tr?'Taslak':'Draft')}</span></div>
    <p className="studio-note">{tr?'Ayın kayıtlarından kendiliğinden hazırlanır: paylaşımlar, siteye gelen ziyaretler, cevaplanan mesajlar, e-posta, reklam ve ölçümler. Onay yetkisi olan biri inceleyip onaylar; yalnız onaylı rapor, süreli ve kapatılabilir bir bağlantıyla paylaşılır. Müşteri mesajı veya kişisel veri içermez.':'Built from the month’s records: posts, site visits, answered messages, email, ads and measurements. Someone with approval rights reviews and approves it; only an approved report is shared, through a link that expires and can be turned off. It contains no customer messages or personal data.'}</p>
    {error&&<p role="alert" className="studio-error"><Msg text={error}/></p>}{notice&&<p role="status" className="studio-success">{notice}</p>}
    <div className="monthly-report-controls">
      <label>{tr?'Ay':'Month'}<select value={data.month} disabled={busy} onChange={event=>void load(event.target.value)}>{data.months.map((key,index)=><option key={key} value={key}>{monthName(key)}{index===0?(tr?' (devam ediyor)':' (in progress)'):''}</option>)}</select></label>
      {approved&&data.approvedAt&&<p className="studio-note"><CheckCircle2 size={14}/> {tr?`Onaylandı: ${when(data.approvedAt)}${data.approvedBy?` · ${data.approvedBy}`:''}. Sayılar onay anındaki haliyle sabitlendi.`:`Approved ${when(data.approvedAt)}${data.approvedBy?` · ${data.approvedBy}`:''}. Figures are frozen as they were at approval.`}</p>}
    </div>
    {!approved&&data.canEdit&&<form className="studio-form-grid" onSubmit={event=>{event.preventDefault();void act({action:'note',note,expectedRevision:data.revision},tr?'Not kaydedildi.':'Note saved.');}}>
      <label className="studio-form-full">{tr?'Ekipten not (isteğe bağlı, raporun başında görünür)':'A note from the team (optional, shown at the top)'}<textarea rows={3} maxLength={REPORT_LIMITS.note} value={note} disabled={busy} onChange={event=>setNote(event.target.value)}/></label>
      <div className="studio-form-actions studio-form-full"><button className="studio-secondary" disabled={busy||note.trim()===data.note}>{tr?'Notu kaydet':'Save note'}</button></div>
    </form>}
    {!approved&&(current?<p className="studio-note">{tr?'Bu ay devam ediyor; rapor ay bitince onaylanabilir. Önizleme şu anki kayıtları gösterir.':'This month is still in progress; the report can be approved once it ends. The preview shows the current records.'}</p>
      :data.canApprove?<div className="monthly-report-approve">
        <label className="publication-toggle"><input type="checkbox" checked={ack} disabled={busy} onChange={event=>setAck(event.target.checked)}/>{tr?'Aşağıdaki raporu inceledim; bu sayılar ve not paylaşılabilir.':'I reviewed the report below; these figures and the note can be shared.'}</label>
        <button type="button" className="studio-primary" disabled={busy||!ack||note.trim()!==data.note} onClick={()=>void act({action:'approve',expectedDigest:data.digest,expectedRevision:data.revision,acknowledged:true},tr?'Rapor onaylandı.':'Report approved.')}>{tr?'Raporu onayla':'Approve report'}</button>
        {note.trim()!==data.note&&<p className="studio-note">{tr?'Önce notu kaydedin.':'Save the note first.'}</p>}
      </div>:<p className="studio-note">{tr?'Raporu onay yetkisi olan bir ekip üyesi onaylar.':'A teammate with approval rights approves the report.'}</p>)}
    {approved&&data.canApprove&&<div className="monthly-report-share-box">
      <div className="monthly-report-controls">
        <label>{tr?'Bağlantı süresi':'Link lifetime'}<select value={days} disabled={busy} onChange={event=>setDays(Number(event.target.value))}>{REPORT_LIMITS.shareDays.map(value=><option key={value} value={value}>{tr?`${value} gün`:`${value} days`}</option>)}</select></label>
        <button type="button" className="studio-primary" disabled={busy} onClick={()=>void act({action:'share',days},tr?'Bağlantı oluşturuldu.':'Link created.')}><Link2 size={15}/>{tr?'Paylaşım bağlantısı oluştur':'Create share link'}</button>
        <button type="button" className="studio-secondary" disabled={busy} onClick={()=>{if(window.confirm(tr?'Onay geri alınsın mı? Bu raporun bütün bağlantıları hemen kapanır.':'Withdraw the approval? Every link to this report stops working at once.'))void act({action:'reopen',expectedRevision:data.revision},tr?'Onay geri alındı; bağlantılar kapatıldı.':'Approval withdrawn; links turned off.');}}><RotateCcw size={15}/>{tr?'Onayı geri al':'Withdraw approval'}</button>
      </div>
      {link&&<div className="monthly-report-link"><input readOnly value={link} aria-label={tr?'Paylaşım bağlantısı':'Share link'} onFocus={event=>event.currentTarget.select()}/><button type="button" className="studio-secondary" onClick={()=>{void navigator.clipboard?.writeText(link).then(()=>setCopied(true)).catch(()=>setCopied(false));}}><Copy size={15}/>{copied?(tr?'Kopyalandı':'Copied'):(tr?'Kopyala':'Copy')}</button>
        <p className="studio-note">{tr?'Bu bağlantı yalnız şimdi gösterilir; saklanmaz. Bağlantıya sahip herkes raporu görebilir.':'This link is shown only now and is not stored. Anyone with the link can see the report.'}</p></div>}
      {data.shares.length>0&&<ul className="monthly-report-shares" aria-label={tr?'Paylaşım bağlantıları':'Share links'}>{data.shares.map(share=>{const live=!share.revokedAt&&Date.parse(share.expiresAt)>now;return <li key={share.id}>
        <span>{live?(tr?`Etkin · ${when(share.expiresAt)} tarihine kadar`:`Active · until ${when(share.expiresAt)}`):share.revokedAt?(tr?'Kapatıldı':'Turned off'):(tr?'Süresi doldu':'Expired')} · {tr?`${share.views} görüntüleme`:`${share.views} view(s)`}{share.lastViewedAt?(tr?` · son ${when(share.lastViewedAt)}`:` · last ${when(share.lastViewedAt)}`):''}</span>
        {live&&<button type="button" className="studio-text-button" disabled={busy} onClick={()=>void act({action:'revoke',shareId:share.id},tr?'Bağlantı kapatıldı.':'Link turned off.')}>{tr?'Bağlantıyı kapat':'Turn off link'}</button>}</li>;})}</ul>}
    </div>}
    <MonthlyReportDocument facts={data.facts} note={approved?data.note:note.trim()} approvedAt={data.approvedAt} draft={!approved}/>
  </section>;
}
