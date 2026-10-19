'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BadgeDollarSign, Check, Pause, Pencil, Play, Plus, RefreshCw, ShieldCheck, UploadCloud } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { AD_OBJECTIVES, AD_SPECIAL_CATEGORIES, type AdPlanView, type AdsSnapshot } from '@/lib/platform/ad-types';
import Msg from '@/components/Msg';

type Form={id?:string;revision?:number;name:string;objective:string;specialCategory:string;daily:string;startDate:string;endDate:string;countries:string;linkUrl:string};
const STATES:Record<string,[string,string]>={draft:['Taslak','Draft'],approved:['Onaylı','Approved'],created:['Meta’da duraklatılmış','Paused on Meta'],active:['Yayında','Running'],paused:['Duraklatıldı','Paused'],failed:['Oluşturulamadı','Failed']};
const OBJECTIVES:Record<string,[string,string]>={OUTCOME_AWARENESS:['Bilinirlik','Awareness'],OUTCOME_TRAFFIC:['Site trafiği','Traffic']};
const CATEGORIES:Record<string,[string,string]>={NONE:['Yok','None'],EMPLOYMENT:['İstihdam','Employment'],HOUSING:['Konut','Housing'],CREDIT:['Kredi','Credit'],ISSUES_ELECTIONS_POLITICS:['Sosyal konu / siyaset','Social issues / politics']};

// Ad plans for the project's own Meta ad account: caps first, then approval, then a PAUSED campaign on Meta, and
// only then an explicit start. Spend is shown as Meta reports it.
export default function ProjectAds({lang}:{lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang),today=new Date().toISOString().slice(0,10);
  const [data,setData]=useState<AdsSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[form,setForm]=useState<Form|null>(null),[confirm,setConfirm]=useState(''),[ack,setAck]=useState(false);
  const [connect,setConnect]=useState({adAccountId:'',accessToken:''}),[caps,setCaps]=useState({daily:'',monthly:''});
  const load=useCallback(()=>{projectRequest<AdsSnapshot>('/api/platform/ads').then(value=>{setData(value);if(value.policy)setCaps({daily:String(value.policy.dailyCapMinor/value.minorUnit),monthly:String(value.policy.monthlyCapMinor/value.minorUnit)});}).catch(reason=>setError(reason.message));},[]);
  useEffect(()=>{load();},[load]);
  const post=async(key:string,body:object,message?:string)=>{if(busy)return false;setBusy(key);setError('');setNotice('');
    try{setData(await projectRequest<AdsSnapshot>('/api/platform/ads',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)}));if(message)setNotice(message);return true;}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));load();return false;}finally{setBusy('');}};
  if(!data)return error?<p className="studio-error" role="alert"><Msg text={error}/></p>:<div className="studio-skeleton" role="status">{tr?'Reklamlar yükleniyor…':'Loading ads…'}</div>;
  const currency=data.account?.currency||data.policy?.currency||'USD',unit=data.minorUnit;
  const money=(minor:number)=>(minor/unit).toLocaleString(locale,{style:'currency',currency,maximumFractionDigits:unit===1?0:2});
  const toMinor=(value:string)=>Math.round(Number(value.replace(',','.'))*unit);
  const edit=(item:AdPlanView)=>setForm({id:item.id,revision:item.revision,name:item.name,objective:item.objective,specialCategory:item.specialCategory,daily:String(item.dailyBudgetMinor/unit),startDate:item.startDate,endDate:item.endDate,countries:item.countries.join(', '),linkUrl:item.linkUrl});
  const save=async(event:FormEvent)=>{event.preventDefault();if(!form)return;
    if(await post('save',{action:'save',...(form.id?{id:form.id,expectedRevision:form.revision}:{}),name:form.name,objective:form.objective,specialCategory:form.specialCategory,dailyBudgetMinor:toMinor(form.daily),startDate:form.startDate,endDate:form.endDate,countries:form.countries.split(/[,\s]+/).filter(Boolean),linkUrl:form.linkUrl},tr?'Plan taslak olarak kaydedildi; onaylanana kadar Meta’ya hiçbir şey gönderilmez.':'Plan saved as a draft; nothing goes to Meta until it is approved.'))setForm(null);};
  const set=<K extends keyof Form>(key:K,value:Form[K])=>setForm(old=>old?{...old,[key]:value}:old);
  return <section className="ads-center">
    <header className="studio-page-heading"><div><p className="studio-eyebrow">META ADS</p><h1>{tr?'Reklamlar':'Ads'}</h1>
      <p className="studio-subtitle">{tr?'Kendi reklam hesabınızda, bütçe tavanları içinde ve onayla: planlar Meta’da duraklatılmış olarak oluşturulur, ayrı bir onayla başlar.':'In your own ad account, within budget caps and with approval: plans are created on Meta as paused and start only with a separate go-ahead.'}</p></div>
      {data.canWrite&&data.policy&&!form&&<div className="overview-header-actions"><button type="button" className="studio-primary" title={tr?'Yeni plan':'New plan'} onClick={()=>setForm({name:'',objective:'OUTCOME_TRAFFIC',specialCategory:'NONE',daily:'',startDate:today,endDate:today,countries:'TR',linkUrl:''})}><Plus size={15}/>{tr?'Yeni plan':'New plan'}</button></div>}
    </header>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}
    {notice&&<p className="coach-note" role="status">{notice}</p>}
    <section className="studio-band ads-account"><h2>{tr?'Reklam hesabı':'Ad account'}</h2>
      {data.account?<p>{data.account.name} · {data.account.adAccountId} · {data.account.currency}{data.account.timezone?` · ${data.account.timezone}`:''}<span className="coach-muted"> · {tr?'kontrol':'checked'} {new Date(data.account.checkedAt).toLocaleDateString(locale)}</span></p>:<p className="coach-muted">{tr?'Henüz bağlı reklam hesabı yok.':'No ad account connected yet.'}</p>}
      {data.canManage?<form className="ads-form-row" onSubmit={event=>{event.preventDefault();void post('connect',{action:'connect',...connect},tr?'Reklam hesabı doğrulandı ve bağlandı.':'Ad account verified and connected.').then(ok=>{if(ok)setConnect({adAccountId:'',accessToken:''});});}}>
        <label>{tr?'Reklam hesabı kimliği':'Ad account ID'}<input required placeholder="act_123456789" value={connect.adAccountId} onChange={event=>setConnect({...connect,adAccountId:event.target.value})}/></label>
        <label>{tr?'Erişim anahtarı (sistem kullanıcısı)':'Access token (system user)'}<input required type="password" autoComplete="new-password" maxLength={4096} value={connect.accessToken} onChange={event=>setConnect({...connect,accessToken:event.target.value})}/></label>
        <button type="submit" className="studio-secondary" disabled={Boolean(busy)}>{data.account?(tr?'Yeniden bağla':'Reconnect'):(tr?'Bağla':'Connect')}</button>
      </form>:<p className="coach-muted">{tr?'Reklam hesabını bağlantı yönetimi ve onay yetkisi olan ekip üyeleri bağlar.':'Teammates with connection and approval rights connect the ad account.'}</p>}
      {data.account&&<>
        <h3>{tr?'Bütçe tavanı':'Budget caps'} ({currency})</h3>
        {data.canManage?<form className="ads-form-row" onSubmit={event=>{event.preventDefault();void post('policy',{action:'policy',dailyCapMinor:toMinor(caps.daily),monthlyCapMinor:toMinor(caps.monthly),expectedRevision:data.policy?.revision||0},tr?'Bütçe tavanı kaydedildi.':'Budget caps saved.');}}>
          <label>{tr?'Plan başına günlük en çok':'Daily maximum per plan'}<input required inputMode="decimal" value={caps.daily} onChange={event=>setCaps({...caps,daily:event.target.value})}/></label>
          <label>{tr?'Aylık toplam en çok':'Monthly total maximum'}<input required inputMode="decimal" value={caps.monthly} onChange={event=>setCaps({...caps,monthly:event.target.value})}/></label>
          <button type="submit" className="studio-secondary" disabled={Boolean(busy)}>{tr?'Kaydet':'Save'}</button>
        </form>:data.policy&&<p>{tr?'Günlük':'Daily'} {money(data.policy.dailyCapMinor)} · {tr?'aylık':'monthly'} {money(data.policy.monthlyCapMinor)}</p>}
        {data.policy&&<p className="coach-muted">{tr?`Bu ay yayındaki planların planlanan harcaması: ${money(data.plannedActiveMinor)} / ${money(data.policy.monthlyCapMinor)}. Meta reklam hesabında ayrıca bir harcama limiti tanımlamanızı öneririz.`:`Planned spend of running plans this month: ${money(data.plannedActiveMinor)} / ${money(data.policy.monthlyCapMinor)}. We recommend also setting a spending limit on the Meta ad account.`}</p>}
      </>}
    </section>
    {form&&<form className="studio-band ads-plan-form" onSubmit={event=>void save(event)}>
      <h2>{form.id?(tr?'Planı düzenle':'Edit plan'):(tr?'Yeni reklam planı':'New ad plan')}</h2>
      <label>{tr?'Ad':'Name'}<input required maxLength={100} value={form.name} onChange={event=>set('name',event.target.value)}/></label>
      <div className="ads-form-row"><label>{tr?'Hedef':'Objective'}<select value={form.objective} onChange={event=>set('objective',event.target.value)}>{AD_OBJECTIVES.map(item=><option key={item} value={item}>{OBJECTIVES[item][idx]}</option>)}</select></label>
        <label>{tr?'Özel reklam kategorisi':'Special ad category'}<select value={form.specialCategory} onChange={event=>set('specialCategory',event.target.value)}>{AD_SPECIAL_CATEGORIES.map(item=><option key={item} value={item}>{CATEGORIES[item][idx]}</option>)}</select></label></div>
      <div className="ads-form-row"><label>{tr?`Günlük bütçe (${currency})`:`Daily budget (${currency})`}<input required inputMode="decimal" value={form.daily} onChange={event=>set('daily',event.target.value)}/></label>
        <label>{tr?'Ülkeler (ör. TR, DE)':'Countries (e.g. TR, DE)'}<input required value={form.countries} onChange={event=>set('countries',event.target.value)}/></label></div>
      <div className="ads-form-row"><label>{tr?'Başlangıç':'Start'}<input type="date" required min={today} value={form.startDate} onChange={event=>set('startDate',event.target.value)}/></label>
        <label>{tr?'Bitiş (en çok 31 gün)':'End (at most 31 days)'}<input type="date" required min={form.startDate} value={form.endDate} onChange={event=>set('endDate',event.target.value)}/></label></div>
      <label>{tr?'Hedef bağlantı (https)':'Destination link (https)'}<input required type="url" value={form.linkUrl} onChange={event=>set('linkUrl',event.target.value)}/></label>
      <p className="coach-muted">{tr?'Reklam görseli ve metni Meta Ads Manager’da eklenir; Ryzevo kampanyayı ve reklam setini duraklatılmış olarak hazırlar.':'Ad images and copy are added in Meta Ads Manager; Ryzevo prepares the campaign and ad set as paused.'}</p>
      <div className="coach-action-buttons"><button type="submit" className="studio-primary" disabled={Boolean(busy)}>{tr?'Taslağı kaydet':'Save draft'}</button><button type="button" className="studio-text-button" onClick={()=>setForm(null)}>{tr?'Vazgeç':'Cancel'}</button></div>
    </form>}
    {data.plans.length?<ul className="ads-list">{data.plans.map(item=><li key={item.id} className="studio-draft-row">
      <div className="studio-draft-top"><div><span className={`coach-state ${item.state==='active'?'done':''}`}>{STATES[item.state][idx]}</span>{item.approved&&item.state!=='approved'?<span className="coach-muted"> · {tr?'onaylı':'approved'}</span>:null}<h2 className="mt-2">{item.name}</h2>
        <p className="coach-muted">{OBJECTIVES[item.objective][idx]} · {money(item.dailyBudgetMinor)}/{tr?'gün':'day'} · {item.startDate} → {item.endDate} ({item.days} {tr?'gün':'days'}, {tr?'en çok':'up to'} {money(item.totalMinor)}) · {item.countries.join(', ')}{item.specialCategory!=='NONE'?` · ${CATEGORIES[item.specialCategory][idx]}`:''}</p></div>
        <div className="coach-action-buttons">
          {['draft','approved'].includes(item.state)&&data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>edit(item)}><Pencil size={14}/>{tr?'Düzenle':'Edit'}</button>}
          {item.state==='draft'&&data.canApprove&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'approve',id:item.id,expectedRevision:item.revision},tr?'Plan onaylandı. Meta’da oluşturmak ayrı bir adımdır.':'Plan approved. Creating it on Meta is a separate step.')}><Check size={14}/>{tr?'Onayla':'Approve'}</button>}
          {item.state==='approved'&&data.canManage&&<button type="button" className="studio-secondary" disabled={Boolean(busy)||!item.approved} onClick={()=>void post(item.id,{action:'create',id:item.id},tr?'Meta’da kampanya ve reklam seti duraklatılmış olarak oluşturuldu. Harcama başlamadı.':'Campaign and ad set created on Meta as paused. No spend has started.')}><UploadCloud size={14}/>{tr?'Meta’da duraklatılmış oluştur':'Create paused on Meta'}</button>}
          {['created','paused'].includes(item.state)&&data.canManage&&<button type="button" className="studio-secondary" disabled={Boolean(busy)||!data.launchEnabled||!item.approved} title={data.launchEnabled?undefined:(tr?'Reklam başlatma bu sunucuda kapalı.':'Starting ads is off on this server.')} onClick={()=>{setConfirm(item.id);setAck(false);}}><Play size={14}/>{tr?'Yayını başlat':'Start delivery'}</button>}
          {item.state==='active'&&data.canWrite&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'pause',id:item.id},tr?'Duraklatma isteği Meta tarafından kabul edildi.':'Meta accepted the pause request.')}><Pause size={14}/>{tr?'Duraklat':'Pause'}</button>}
          {item.providerCampaignId&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'spend',id:item.id})}><RefreshCw size={14}/>{tr?'Harcamayı güncelle':'Refresh spend'}</button>}
        </div></div>
      {confirm===item.id&&<div className="automation-approve"><label className="automation-choice"><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)}/>{tr?`Bu planın Meta’da yayına girip günde en çok ${money(item.dailyBudgetMinor)}, toplamda en çok ${money(item.totalMinor)} harcayabileceğini anlıyorum.`:`I understand this plan will go live on Meta and may spend up to ${money(item.dailyBudgetMinor)} a day and ${money(item.totalMinor)} in total.`}</label>
        <div className="coach-action-buttons"><button type="button" className="studio-primary" disabled={!ack||Boolean(busy)} onClick={()=>void post(item.id,{action:'start',id:item.id,acknowledged:true},tr?'Meta yayını başlatma isteğini kabul etti. Teslimat Meta’nın incelemesine bağlıdır.':'Meta accepted the start request. Delivery depends on Meta’s review.').then(()=>setConfirm(''))}><Play size={14}/>{tr?'Başlat':'Start'}</button><button type="button" className="studio-text-button" onClick={()=>setConfirm('')}>{tr?'Vazgeç':'Cancel'}</button></div></div>}
      {item.lastError&&<p className="studio-error" role="alert"><Msg text={item.lastError}/></p>}
      {item.spendCheckedAt&&<p className="coach-muted"><BadgeDollarSign size={13}/> {item.spendMinor===null?(tr?'Meta harcama verisi döndürmedi.':'Meta returned no spend data.'):(tr?`Meta’nın bildirdiği harcama: ${money(item.spendMinor)}`:`Spend reported by Meta: ${money(item.spendMinor)}`)} · {new Date(item.spendCheckedAt).toLocaleString(locale)}</p>}
    </li>)}</ul>:data.policy&&!form?<div className="studio-empty"><p>{tr?'Henüz reklam planı yok.':'No ad plans yet.'}</p></div>:null}
    {!data.launchEnabled&&<p className="coach-muted">{tr?'Reklam yayınını başlatma bu sunucuda kapalı (PLATFORM_ADS_ENABLED). Planlar onaylanıp Meta’da duraklatılmış olarak hazırlanabilir.':'Starting ads is off on this server (PLATFORM_ADS_ENABLED). Plans can still be approved and prepared on Meta as paused.'}</p>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Ryzevo bütçeyi kendi başına artırmaz veya harcamayı başlatmaz. Harcama ve sonuçlar yalnız Meta’nın bildirdiği şekilde gösterilir; getiri vaadi yoktur.':'Ryzevo never raises a budget or starts spending on its own. Spend and results are shown only as Meta reports them; no return is promised.'}</p>
  </section>;
}
