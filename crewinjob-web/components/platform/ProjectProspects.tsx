'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, CalendarPlus, Check, Globe, Pencil, Plus, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { ProspectState, ProspectsSnapshot, ProspectView } from '@/lib/platform/prospect-types';
import Msg from '@/components/Msg';
import type { FinderSnapshot } from '@/lib/platform/prospect-finder-types';
import { ProspectFinderPanel, ProspectInsightBlock } from './ProspectFinder';
import { onTabKeys } from './tab-keys';

const STATES:Record<ProspectState,[string,string]>={candidate:['Aday','Candidate'],approved:['Onaylı','Approved'],rejected:['Reddedildi','Rejected']};
type Edit={id:string;revision:number;reason:string;contactRole:string;sector:string;country:string};

// B2B prospects: companies the team picks, each backed by its own public page (address and check date shown).
// Separate from the product's users. Research, approval and outreach are separate steps; nothing is sent.
export default function ProjectProspects({lang}:{lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [data,setData]=useState<ProspectsSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[filter,setFilter]=useState<ProspectState>('candidate');
  const [form,setForm]=useState({company:'',website:'',sector:'',country:'',contactRole:'',reason:''}),[adding,setAdding]=useState(false),[edit,setEdit]=useState<Edit|null>(null);
  // Sales assistant (search, scan, score, contacts, mini analysis); absent until the database has its tables.
  const [finder,setFinder]=useState<FinderSnapshot|null>(null);
  const load=useCallback(()=>{projectRequest<ProspectsSnapshot>('/api/platform/prospects').then(setData).catch(reason=>setError(reason.message));projectRequest<FinderSnapshot>('/api/platform/prospects/finder').then(setFinder).catch(()=>setFinder(null));},[]);
  useEffect(()=>{load();},[load]);
  const finderPost=async<T,>(key:string,body:Record<string,unknown>,message?:string):Promise<T|null>=>{if(busy)return null;setBusy(key);setError('');setNotice('');
    try{const value=await projectRequest<Record<string,unknown>>('/api/platform/prospects/finder',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(65000)});const snapshot=('snapshot' in value?value.snapshot:value) as FinderSnapshot;setFinder(snapshot);
      if(body.action==='discover'){const found=Number(value.found),added=Number(value.added),without=Number(value.withoutWebsite);setNotice(tr?`${found} işletme bulundu; ${added} yeni firma aday listesine eklendi${without?`, ${without} işletmenin web sitesi yok`:''}.`:`${found} businesses found; ${added} new companies added as candidates${without?`, ${without} have no website`:''}.`);setFilter('candidate');}
      else if(message)setNotice(message);
      if(['discover','scan','remove-contact'].includes(String(body.action)))projectRequest<ProspectsSnapshot>('/api/platform/prospects').then(setData).catch(()=>undefined);
      return value as T;}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));return null;}finally{setBusy('');}};
  const post=async(key:string,body:object,message?:string)=>{if(busy)return false;setBusy(key);setError('');setNotice('');
    try{const value=await projectRequest<Record<string,unknown>>('/api/platform/prospects',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});setData(('snapshot' in value?value.snapshot:value) as ProspectsSnapshot);if(message)setNotice(message);return true;}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));load();return false;}finally{setBusy('');}};
  if(!data)return error?<p className="studio-error" role="alert"><Msg text={error}/></p>:<div className="studio-skeleton" role="status">{tr?'Adaylar yükleniyor…':'Loading prospects…'}</div>;
  const date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'short',year:'numeric'});
  const add=async(event:FormEvent)=>{event.preventDefault();if(await post('add',{action:'add',...form},tr?'Aday eklendi. Şimdi web sitesini kontrol edin.':'Prospect added. Now check its website.')){setForm({company:'',website:'',sector:'',country:'',contactRole:'',reason:''});setAdding(false);}};
  const save=async(event:FormEvent)=>{event.preventDefault();if(edit&&await post(edit.id,{action:'update',...edit,expectedRevision:edit.revision},tr?'Kaydedildi.':'Saved.'))setEdit(null);};
  const scoreOf=(item:ProspectView)=>finder?.insights[item.id]?.score.total??-1;
  const shown=data.prospects.filter(item=>item.state===filter).sort((a,b)=>filter==='candidate'?scoreOf(b)-scoreOf(a):0);
  const card=(item:ProspectView)=><li key={item.id} className="studio-draft-row">
    <div className="studio-draft-top"><div>
      <span className={`coach-state ${item.state==='approved'?'done':''}`}>{STATES[item.state][idx]}</span>{item.sector&&<span className="coach-muted"> · {item.sector}</span>}{item.country&&<span className="coach-muted"> · {item.country}</span>}
      <h2 className="mt-2">{item.company}</h2><a className="prospect-link" href={item.website} target="_blank" rel="noreferrer"><Globe size={13}/>{item.website.replace(/^https?:\/\//,'')}</a>
    </div>
    {data.canWrite&&<div className="coach-action-buttons">
      {item.state!=='rejected'&&(finder?<button type="button" className="studio-text-button" disabled={Boolean(busy)||data.checksLeft<1} onClick={()=>void finderPost(`scan-${item.id}`,{action:'scan',id:item.id},tr?'Site tarandı: sinyaller ve yayımlanan iletişim adresleri güncellendi.':'Site scanned: signals and published contact addresses updated.')}><Globe size={14}/>{item.check.status==='not_checked'?(tr?'Siteyi tara':'Scan the site'):(tr?'Yeniden tara':'Scan again')}</button>
        :<button type="button" className="studio-text-button" disabled={Boolean(busy)||data.checksLeft<1} onClick={()=>void post(item.id,{action:'check',id:item.id},tr?'Web sitesi kontrol edildi.':'Website checked.')}><Globe size={14}/>{item.check.status==='not_checked'?(tr?'Web sitesini kontrol et':'Check the website'):(tr?'Yeniden kontrol et':'Check again')}</button>)}
      {item.state==='candidate'&&data.aiConfigured&&item.check.status==='ok'&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'suggest',id:item.id},tr?'AI gerekçesi sayfadaki bir alıntıyla eklendi. Okuyup gerekirse düzeltin.':'An AI reason was added with a quote from the page. Read it and fix it if needed.')}><Sparkles size={14}/>{tr?'AI ile gerekçe öner':'Suggest a reason with AI'}</button>}
      <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>setEdit({id:item.id,revision:item.revision,reason:item.reason,contactRole:item.contactRole,sector:item.sector,country:item.country})}><Pencil size={14}/>{tr?'Düzenle':'Edit'}</button>
    </div>}</div>
    {item.check.status==='ok'?<div className="prospect-evidence"><p><strong>{tr?'Kanıt: ':'Evidence: '}</strong>“{item.check.evidence||item.check.pageTitle||'—'}”</p><p className="coach-muted">{tr?'Kaynak':'Source'}: <a href={item.check.sourceUrl!} target="_blank" rel="noreferrer">{item.check.sourceUrl}</a> · {tr?'kontrol':'checked'} {date(item.check.checkedAt!)}</p></div>
      :item.check.status==='unreachable'?<p className="coach-muted">{tr?`Web sitesi okunamadı (${date(item.check.checkedAt!)}). Kanıt olmadan onaylanamaz.`:`The website couldn’t be read (${date(item.check.checkedAt!)}). It can’t be approved without evidence.`}</p>:<p className="coach-muted">{tr?'Henüz kontrol edilmedi.':'Not checked yet.'}</p>}
    {finder?.insights[item.id]&&<ProspectInsightBlock tr={tr} id={item.id} insight={finder.insights[item.id]} canWrite={data.canWrite} busy={busy} post={finderPost}/>}
    {edit?.id===item.id?<form className="prospect-form" onSubmit={event=>void save(event)}>
      <label>{tr?'Uygunluk gerekçesi':'Why they fit'}<textarea rows={3} maxLength={600} value={edit.reason} onChange={event=>setEdit({...edit,reason:event.target.value})}/></label>
      <label>{tr?'Önerilen temas rolü (kişi adı değil)':'Suggested contact role (not a name)'}<input maxLength={80} value={edit.contactRole} onChange={event=>setEdit({...edit,contactRole:event.target.value})}/></label>
      <div className="prospect-form-row"><label>{tr?'Sektör':'Sector'}<input maxLength={80} value={edit.sector} onChange={event=>setEdit({...edit,sector:event.target.value})}/></label><label>{tr?'Ülke':'Country'}<input maxLength={60} value={edit.country} onChange={event=>setEdit({...edit,country:event.target.value})}/></label></div>
      <div className="coach-action-buttons"><button type="submit" className="studio-secondary" disabled={Boolean(busy)}>{tr?'Kaydet':'Save'}</button><button type="button" className="studio-text-button" onClick={()=>setEdit(null)}>{tr?'Vazgeç':'Cancel'}</button></div>
    </form>:<>
      <p><strong>{tr?'Neden uygun: ':'Why they fit: '}</strong>{item.reason||(tr?'Henüz yazılmadı.':'Not written yet.')}{item.reasonSource==='ai'&&<span className="coach-muted"> {tr?'(AI önerisi)':'(AI suggestion)'}</span>}</p>
      {item.contactRole&&<p className="coach-muted">{tr?'Önerilen temas rolü: ':'Suggested contact role: '}{item.contactRole}</p>}
    </>}
    <div className="coach-action-buttons prospect-decisions">
      {item.state==='candidate'&&data.canApprove&&<button type="button" className="studio-secondary" disabled={Boolean(busy)||item.check.status!=='ok'||!item.reason.trim()} onClick={()=>void post(item.id,{action:'decide',id:item.id,decision:'approve',expectedRevision:item.revision},tr?'Aday onaylandı. Temas planlamak ayrı bir adımdır.':'Prospect approved. Planning outreach is a separate step.')}><Check size={14}/>{tr?'Onayla':'Approve'}</button>}
      {item.state==='candidate'&&data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'decide',id:item.id,decision:'reject',expectedRevision:item.revision})}><X size={14}/>{tr?'Reddet':'Reject'}</button>}
      {item.state!=='candidate'&&data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'decide',id:item.id,decision:'reopen',expectedRevision:item.revision})}><Undo2 size={14}/>{tr?'Adaya geri al':'Back to candidate'}</button>}
      {item.state==='approved'&&data.canWrite&&(item.task&&!['completed','cancelled'].includes(item.task.status)?<a className="studio-text-button" href="/?tab=calendar"><CalendarPlus size={14}/>{tr?'Takvimde':'In Calendar'}</a>
        :<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'plan',id:item.id},tr?'Temas, Takvim’e iş olarak eklendi. Ryzevo bu firmaya hiçbir şey göndermez.':'Outreach was added to the Calendar as a task. Ryzevo sends nothing to this company.')}><CalendarPlus size={14}/>{tr?'Temas planla':'Plan outreach'}</button>)}
      {data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>{if(window.confirm(tr?'Bu aday silinsin mi?':'Delete this prospect?'))void post(item.id,{action:'remove',id:item.id});}}><Trash2 size={14}/>{tr?'Sil':'Delete'}</button>}
    </div>
  </li>;
  return <section className="prospect-center">
    <header className="studio-page-heading"><div><p className="studio-eyebrow">B2B</p><h1>{tr?'B2B adaylar':'B2B prospects'}</h1>
      <p className="studio-subtitle">{tr?'Google Haritalar’dan bulunan ya da ekibin eklediği firmalar; her biri kendi web sitesinden alınan kanıt, sinyaller ve puanla. Ürününüzün kullanıcılarından ayrı bir listedir.':'Companies found on Google Maps or added by the team, each with evidence, signals and a score from its own website. A separate list from your product’s users.'}</p></div>
      {data.canWrite&&!adding&&<div className="overview-header-actions"><button type="button" className="studio-primary" title={tr?'Firma ekle':'Add a company'} onClick={()=>setAdding(true)}><Plus size={15}/>{tr?'Firma ekle':'Add a company'}</button></div>}
    </header>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}
    {notice&&<p className="coach-note" role="status">{notice}</p>}
    {finder&&<ProspectFinderPanel tr={tr} data={finder} busy={busy} post={finderPost}/>}
    {adding&&<form className="studio-band prospect-form" onSubmit={event=>void add(event)}>
      <div className="prospect-form-row"><label>{tr?'Firma adı':'Company name'}<input required maxLength={120} value={form.company} onChange={event=>setForm({...form,company:event.target.value})}/></label>
        <label>{tr?'Web sitesi':'Website'}<input required maxLength={300} placeholder="firma.com" value={form.website} onChange={event=>setForm({...form,website:event.target.value})}/></label></div>
      <div className="prospect-form-row"><label>{tr?'Sektör (isteğe bağlı)':'Sector (optional)'}<input maxLength={80} value={form.sector} onChange={event=>setForm({...form,sector:event.target.value})}/></label>
        <label>{tr?'Önerilen temas rolü (kişi adı değil)':'Suggested contact role (not a name)'}<input maxLength={80} value={form.contactRole} onChange={event=>setForm({...form,contactRole:event.target.value})}/></label></div>
      <label>{tr?'Neden uygun (isteğe bağlı)':'Why they fit (optional)'}<textarea rows={2} maxLength={600} value={form.reason} onChange={event=>setForm({...form,reason:event.target.value})}/></label>
      <p className="coach-muted">{tr?'Kişi adı, e-posta, telefon veya kullanıcı adı yazmayın; liste yalnız firmaları ve rolleri tutar.':'Don’t enter names, emails, phone numbers or handles; the list keeps companies and roles only.'}</p>
      <div className="coach-action-buttons"><button type="submit" className="studio-primary" disabled={Boolean(busy)}><Building2 size={15}/>{tr?'Ekle':'Add'}</button><button type="button" className="studio-text-button" onClick={()=>setAdding(false)}>{tr?'Vazgeç':'Cancel'}</button></div>
    </form>}
    <div className="publication-view-tabs" role="tablist" onKeyDown={onTabKeys} aria-label={tr?'Aday durumu':'Prospect state'}>{(['candidate','approved','rejected'] as const).map(state=><button key={state} role="tab" aria-selected={filter===state} tabIndex={filter===state?0:-1} onClick={()=>setFilter(state)}>{STATES[state][idx]} ({data.counts[state]})</button>)}</div>
    {shown.length?<ul className="prospect-list">{shown.map(card)}</ul>:<div className="studio-empty"><p>{filter==='candidate'?(tr?'Aday yok. Hedef müşteri profilinize uyan bir firmayı ve web sitesini ekleyin.':'No candidates. Add a company that fits your target customer, with its website.'):(tr?'Bu durumda aday yok.':'No prospects in this state.')}</p></div>}
    <p className="compass-safety"><Building2 size={15}/>{tr?`Yalnız firmanın herkese açık sayfası okunur (bugün ${data.checksLeft} kontrol hakkı kaldı). AI kişi veya iletişim bilgisi üretmez; gerekçesi sayfada birebir geçen bir alıntıya dayanmak zorundadır. Yalnız firmanın kendi sitesinde yayımladığı kurumsal adresler (info@ gibi) saklanır. Bu listeden kimseye ileti gönderilmez.`:`Only the company’s public page is read (${data.checksLeft} checks left today). AI never produces people or contact details; its reason must rest on a quote that appears word for word on the page. Only role addresses a company publishes on its own site are kept. Nothing is sent to anyone from this list.`}</p>
  </section>;
}
