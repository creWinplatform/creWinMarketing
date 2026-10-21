'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BadgeDollarSign, Check, Pause, Pencil, Play, Plus, RefreshCw, ShieldCheck, UploadCloud } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { AD_OBJECTIVES, AD_SPECIAL_CATEGORIES, type AdPlanView, type AdsSnapshot } from '@/lib/platform/ad-types';
import Msg from '@/components/Msg';
import { onTabKeys } from './tab-keys';

type Form={id?:string;revision?:number;name:string;objective:string;specialCategory:string;daily:string;startDate:string;endDate:string;countries:string;linkUrl:string};
type Provider='meta'|'google'|'linkedin';
// Provider wording: name, Turkish locative ("Meta’da"), and the provider's own tool where creatives are added.
const PROVIDERS:Record<Provider,{name:string;on:string;to:string;of:string;tool:string;acc:string;group:[string,string]}>={
  meta:{name:'Meta',on:'Meta’da',to:'Meta’ya',of:'Meta’nın',tool:'Meta Ads Manager',acc:'kampanyayı ve reklam setini',group:['kampanya ve reklam seti','campaign and ad set']},
  google:{name:'Google Ads',on:'Google Ads’te',to:'Google Ads’e',of:'Google Ads’in',tool:'Google Ads',acc:'bütçeyi ve Arama kampanyasını',group:['bütçe ve Arama kampanyası','budget and Search campaign']},
  linkedin:{name:'LinkedIn',on:'LinkedIn’de',to:'LinkedIn’e',of:'LinkedIn’in',tool:'LinkedIn Campaign Manager',acc:'kampanya grubunu ve kampanyayı',group:['kampanya grubu ve kampanya','campaign group and campaign']},
};
const STATES:Record<string,[string,string]>={draft:['Taslak','Draft'],approved:['Onaylı','Approved'],created:['Sağlayıcıda duraklatılmış','Paused at the provider'],active:['Yayında','Running'],paused:['Duraklatıldı','Paused'],failed:['Oluşturulamadı','Failed']};
const OBJECTIVES:Record<string,[string,string]>={OUTCOME_AWARENESS:['Bilinirlik','Awareness'],OUTCOME_TRAFFIC:['Site trafiği','Traffic']};
const CATEGORIES:Record<string,[string,string]>={NONE:['Yok','None'],EMPLOYMENT:['İstihdam','Employment'],HOUSING:['Konut','Housing'],CREDIT:['Kredi','Credit'],ISSUES_ELECTIONS_POLITICS:['Sosyal konu / siyaset','Social issues / politics']};

// Ad plans for the project's own Meta ad account: caps first, then approval, then a PAUSED campaign on Meta, and
// only then an explicit start. Spend is shown as Meta reports it.
export default function ProjectAds({lang}:{lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang),today=new Date().toISOString().slice(0,10);
  const [data,setData]=useState<AdsSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[form,setForm]=useState<Form|null>(null),[confirm,setConfirm]=useState(''),[ack,setAck]=useState(false);
  const [connect,setConnect]=useState({adAccountId:'',accessToken:''}),[caps,setCaps]=useState({daily:'',monthly:''}),[provider,setProvider]=useState<Provider>('meta'),[customer,setCustomer]=useState('');
  const P=PROVIDERS[provider];
  const load=useCallback(()=>{projectRequest<AdsSnapshot>(`/api/platform/ads?provider=${provider}`).then(value=>{setData(value);setCaps({daily:'',monthly:''});if(value.policy)setCaps({daily:String(value.policy.dailyCapMinor/value.minorUnit),monthly:String(value.policy.monthlyCapMinor/value.minorUnit)});}).catch(reason=>setError(reason.message));},[provider]);
  useEffect(()=>{setData(null);setForm(null);load();},[load]);
  const post=async(key:string,body:object,message?:string)=>{if(busy)return false;setBusy(key);setError('');setNotice('');
    try{setData(await projectRequest<AdsSnapshot>('/api/platform/ads',{method:'POST',body:JSON.stringify({...body,provider}),signal:AbortSignal.timeout(45000)}));if(message)setNotice(message);return true;}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));load();return false;}finally{setBusy('');}};
  // Google Ads sign-in reuses the project's Google OAuth flow with the adwords scope.
  const googleSignIn=async()=>{if(busy)return;setBusy('google');setError('');
    try{const response=await fetch('/api/platform/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'google_ads',resource:customer.trim(),accountName:'Google Ads'})}),value=await response.json() as {authorizationUrl?:string;error?:string};
      if(!response.ok||!value.authorizationUrl)throw new Error(value.error||(tr?'Google bağlantısı başlatılamadı.':'Google sign-in could not start.'));window.location.assign(value.authorizationUrl);}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));setBusy('');}};
  // The provider tabs stay mounted while a provider loads, so keyboard focus is kept on the chosen tab.
  const tabs=<div className="publication-view-tabs ads-provider-tabs" role="tablist" aria-label={tr?'Reklam sağlayıcısı':'Ad provider'} onKeyDown={onTabKeys}>{(['meta','google','linkedin'] as const).map(item=><button key={item} role="tab" aria-selected={provider===item} tabIndex={provider===item?0:-1} onClick={()=>{if(item!==provider){setProvider(item);setError('');setNotice('');}}}>{PROVIDERS[item].name}</button>)}</div>;
  if(!data)return <section className="ads-center">{tabs}{error?<p className="studio-error" role="alert"><Msg text={error}/></p>:<div className="studio-skeleton" role="status">{tr?'Reklamlar yükleniyor…':'Loading ads…'}</div>}</section>;
  const currency=data.account?.currency||data.policy?.currency||'USD',unit=data.minorUnit;
  const money=(minor:number)=>(minor/unit).toLocaleString(locale,{style:'currency',currency,maximumFractionDigits:unit===1?0:2});
  const toMinor=(value:string)=>Math.round(Number(value.replace(',','.'))*unit);
  const edit=(item:AdPlanView)=>setForm({id:item.id,revision:item.revision,name:item.name,objective:item.objective,specialCategory:item.specialCategory,daily:String(item.dailyBudgetMinor/unit),startDate:item.startDate,endDate:item.endDate,countries:item.countries.join(', '),linkUrl:item.linkUrl});
  const save=async(event:FormEvent)=>{event.preventDefault();if(!form)return;
    if(await post('save',{action:'save',...(form.id?{id:form.id,expectedRevision:form.revision}:{}),name:form.name,objective:form.objective,specialCategory:form.specialCategory,dailyBudgetMinor:toMinor(form.daily),startDate:form.startDate,endDate:form.endDate,countries:form.countries.split(/[,\s]+/).filter(Boolean),linkUrl:form.linkUrl},tr?`Plan taslak olarak kaydedildi; onaylanana kadar ${P.to} hiçbir şey gönderilmez.`:`Plan saved as a draft; nothing goes to ${P.name} until it is approved.`))setForm(null);};
  const set=<K extends keyof Form>(key:K,value:Form[K])=>setForm(old=>old?{...old,[key]:value}:old);
  return <section className="ads-center">
    {tabs}
    <header className="studio-page-heading"><div><p className="studio-eyebrow">{P.name.toUpperCase()}</p><h1>{tr?'Reklamlar':'Ads'}</h1>
      <p className="studio-subtitle">{tr?`Kendi reklam hesabınızda, bütçe tavanları içinde ve onayla: planlar ${P.on} duraklatılmış olarak oluşturulur, ayrı bir onayla başlar.`:`In your own ad account, within budget caps and with approval: plans are created on ${P.name} as paused and start only with a separate go-ahead.`}</p></div>
      {data.canWrite&&data.policy&&!form&&<div className="overview-header-actions"><button type="button" className="studio-primary" title={tr?'Yeni plan':'New plan'} onClick={()=>setForm({name:'',objective:'OUTCOME_TRAFFIC',specialCategory:'NONE',daily:'',startDate:today,endDate:today,countries:'TR',linkUrl:''})}><Plus size={15}/>{tr?'Yeni plan':'New plan'}</button></div>}
    </header>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}
    {notice&&<p className="coach-note" role="status">{notice}</p>}
    {!data.providerReady&&<p className="studio-error" role="alert">{tr?'Google Ads geliştirici anahtarı bu sunucuda yapılandırılmamış (PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN). Hesap bağlanabilir ama okunamaz ve kampanya oluşturulamaz.':'The Google Ads developer token is not configured on this server (PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN). The account can be connected but not read, and no campaign can be created.'}</p>}
    <section className="studio-band ads-account"><h2>{tr?'Reklam hesabı':'Ad account'}</h2>
      {data.pendingVerification&&!data.account&&<p className="coach-muted">{tr?'Google oturumu bağlı; hesabın doğrulanması bekleniyor.':'Google sign-in is connected; the account still needs to be verified.'}</p>}
      {data.account?<p>{data.account.name} · {data.account.adAccountId} · {data.account.currency}{data.account.timezone?` · ${data.account.timezone}`:''}<span className="coach-muted"> · {tr?'kontrol':'checked'} {new Date(data.account.checkedAt).toLocaleDateString(locale)}</span></p>:<p className="coach-muted">{tr?'Henüz bağlı reklam hesabı yok.':'No ad account connected yet.'}</p>}
      {data.canManage&&provider==='google'?<div className="ads-form-row">
        {data.account||data.pendingVerification?<button type="button" className="studio-secondary" disabled={Boolean(busy)||!data.providerReady} onClick={()=>void post('connect',{action:'connect'},tr?'Google Ads hesabı okundu ve doğrulandı.':'Google Ads account read and verified.')}>{tr?'Hesabı doğrula':'Verify account'}</button>:null}
        <label>{tr?'Google Ads müşteri kimliği (123-456-7890)':'Google Ads customer ID (123-456-7890)'}<input value={customer} placeholder="123-456-7890" onChange={event=>setCustomer(event.target.value)}/></label>
        <button type="button" className="studio-secondary" disabled={Boolean(busy)||!/^\d{3}-?\d{3}-?\d{4}$/.test(customer.trim())} onClick={()=>void googleSignIn()}>{tr?'Google ile bağlan':'Connect with Google'}</button>
        <p className="coach-muted">{tr?'Google oturumu adwords izniyle açılır; dönüşte bu sekmede “Hesabı doğrula” ile para birimi ve hesap adı okunur.':'Google sign-in asks for the adwords permission; after returning, “Verify account” on this tab reads the currency and account name.'}</p>
      </div>:data.canManage?<form className="ads-form-row" onSubmit={event=>{event.preventDefault();void post('connect',{action:'connect',...connect},tr?'Reklam hesabı doğrulandı ve bağlandı.':'Ad account verified and connected.').then(ok=>{if(ok)setConnect({adAccountId:'',accessToken:''});});}}>
        <label>{tr?'Reklam hesabı kimliği':'Ad account ID'}<input required placeholder={provider==='linkedin'?'510000001':'act_123456789'} value={connect.adAccountId} onChange={event=>setConnect({...connect,adAccountId:event.target.value})}/></label>
        <label>{provider==='linkedin'?(tr?'Erişim anahtarı (rw_ads izinli)':'Access token (with rw_ads)'):(tr?'Erişim anahtarı (sistem kullanıcısı)':'Access token (system user)')}<input required type="password" autoComplete="new-password" maxLength={4096} value={connect.accessToken} onChange={event=>setConnect({...connect,accessToken:event.target.value})}/></label>
        <button type="submit" className="studio-secondary" disabled={Boolean(busy)}>{data.account?(tr?'Yeniden bağla':'Reconnect'):(tr?'Bağla':'Connect')}</button>
      </form>:<p className="coach-muted">{tr?'Reklam hesabını bağlantı yönetimi ve onay yetkisi olan ekip üyeleri bağlar.':'Teammates with connection and approval rights connect the ad account.'}</p>}
      {data.account&&<>
        <h3>{tr?'Bütçe tavanı':'Budget caps'} ({currency})</h3>
        {data.canManage?<form className="ads-form-row" onSubmit={event=>{event.preventDefault();void post('policy',{action:'policy',dailyCapMinor:toMinor(caps.daily),monthlyCapMinor:toMinor(caps.monthly),expectedRevision:data.policy?.revision||0},tr?'Bütçe tavanı kaydedildi.':'Budget caps saved.');}}>
          <label>{tr?'Plan başına günlük en çok':'Daily maximum per plan'}<input required inputMode="decimal" value={caps.daily} onChange={event=>setCaps({...caps,daily:event.target.value})}/></label>
          <label>{tr?'Aylık toplam en çok':'Monthly total maximum'}<input required inputMode="decimal" value={caps.monthly} onChange={event=>setCaps({...caps,monthly:event.target.value})}/></label>
          <button type="submit" className="studio-secondary" disabled={Boolean(busy)}>{tr?'Kaydet':'Save'}</button>
        </form>:data.policy&&<p>{tr?'Günlük':'Daily'} {money(data.policy.dailyCapMinor)} · {tr?'aylık':'monthly'} {money(data.policy.monthlyCapMinor)}</p>}
        {data.policy&&<p className="coach-muted">{tr?`Bu ay yayındaki planların planlanan harcaması: ${money(data.plannedActiveMinor)} / ${money(data.policy.monthlyCapMinor)}. ${P.name} reklam hesabında ayrıca bir harcama limiti tanımlamanızı öneririz.`:`Planned spend of running plans this month: ${money(data.plannedActiveMinor)} / ${money(data.policy.monthlyCapMinor)}. We recommend also setting a spending limit on the ${P.name} ad account.`}</p>}
      </>}
    </section>
    {form&&<form className="studio-band ads-plan-form" onSubmit={event=>void save(event)}>
      <h2>{form.id?(tr?'Planı düzenle':'Edit plan'):(tr?'Yeni reklam planı':'New ad plan')}</h2>
      <label>{tr?'Ad':'Name'}<input required maxLength={100} value={form.name} onChange={event=>set('name',event.target.value)}/></label>
      <div className="ads-form-row"><label>{tr?'Hedef':'Objective'}<select value={form.objective} onChange={event=>set('objective',event.target.value)}>{AD_OBJECTIVES.filter(item=>provider!=='google'||item==='OUTCOME_TRAFFIC').map(item=><option key={item} value={item}>{OBJECTIVES[item][idx]}</option>)}</select></label>
        {provider==='meta'&&<label>{tr?'Özel reklam kategorisi':'Special ad category'}<select value={form.specialCategory} onChange={event=>set('specialCategory',event.target.value)}>{AD_SPECIAL_CATEGORIES.map(item=><option key={item} value={item}>{CATEGORIES[item][idx]}</option>)}</select></label>}</div>
      <div className="ads-form-row"><label>{tr?`Günlük bütçe (${currency})`:`Daily budget (${currency})`}<input required inputMode="decimal" value={form.daily} onChange={event=>set('daily',event.target.value)}/></label>
        <label>{tr?'Ülkeler (ör. TR, DE)':'Countries (e.g. TR, DE)'}<input required value={form.countries} onChange={event=>set('countries',event.target.value)}/></label></div>
      <div className="ads-form-row"><label>{tr?'Başlangıç':'Start'}<input type="date" required min={today} value={form.startDate} onChange={event=>set('startDate',event.target.value)}/></label>
        <label>{tr?'Bitiş (en çok 31 gün)':'End (at most 31 days)'}<input type="date" required min={form.startDate} value={form.endDate} onChange={event=>set('endDate',event.target.value)}/></label></div>
      <label>{tr?'Hedef bağlantı (https)':'Destination link (https)'}<input required type="url" value={form.linkUrl} onChange={event=>set('linkUrl',event.target.value)}/></label>
      <p className="coach-muted">{tr?`Reklam görseli ve metni ${P.tool} içinde eklenir; Ryzevo ${P.acc} duraklatılmış olarak hazırlar.`:`Ad images and copy are added in ${P.tool}; Ryzevo prepares the ${P.group[1]} as paused.`}</p>
      <div className="coach-action-buttons"><button type="submit" className="studio-primary" disabled={Boolean(busy)}>{tr?'Taslağı kaydet':'Save draft'}</button><button type="button" className="studio-text-button" onClick={()=>setForm(null)}>{tr?'Vazgeç':'Cancel'}</button></div>
    </form>}
    {data.plans.length?<ul className="ads-list">{data.plans.map(item=><li key={item.id} className="studio-draft-row">
      <div className="studio-draft-top"><div><span className={`coach-state ${item.state==='active'?'done':''}`}>{STATES[item.state][idx]}</span>{item.approved&&item.state!=='approved'?<span className="coach-muted"> · {tr?'onaylı':'approved'}</span>:null}<h2 className="mt-2">{item.name}</h2>
        <p className="coach-muted">{OBJECTIVES[item.objective][idx]} · {money(item.dailyBudgetMinor)}/{tr?'gün':'day'} · {item.startDate} → {item.endDate} ({item.days} {tr?'gün':'days'}, {tr?'en çok':'up to'} {money(item.totalMinor)}) · {item.countries.join(', ')}{item.specialCategory!=='NONE'?` · ${CATEGORIES[item.specialCategory][idx]}`:''}</p></div>
        <div className="coach-action-buttons">
          {['draft','approved'].includes(item.state)&&data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>edit(item)}><Pencil size={14}/>{tr?'Düzenle':'Edit'}</button>}
          {item.state==='draft'&&data.canApprove&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'approve',id:item.id,expectedRevision:item.revision},tr?`Plan onaylandı. ${P.on} oluşturmak ayrı bir adımdır.`:`Plan approved. Creating it on ${P.name} is a separate step.`)}><Check size={14}/>{tr?'Onayla':'Approve'}</button>}
          {item.state==='approved'&&data.canManage&&<button type="button" className="studio-secondary" disabled={Boolean(busy)||!item.approved} onClick={()=>void post(item.id,{action:'create',id:item.id},tr?`${P.on} ${P.group[0]} duraklatılmış olarak oluşturuldu. Harcama başlamadı.`:`Campaign and ad set created on ${P.name} as paused. No spend has started.`)}><UploadCloud size={14}/>{tr?`${P.on} duraklatılmış oluştur`:`Create paused on ${P.name}`}</button>}
          {['created','paused'].includes(item.state)&&data.canManage&&<button type="button" className="studio-secondary" disabled={Boolean(busy)||!data.launchEnabled||!item.approved} title={data.launchEnabled?undefined:(tr?'Reklam başlatma bu sunucuda kapalı.':'Starting ads is off on this server.')} onClick={()=>{setConfirm(item.id);setAck(false);}}><Play size={14}/>{tr?'Yayını başlat':'Start delivery'}</button>}
          {item.state==='active'&&data.canWrite&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'pause',id:item.id},tr?`Duraklatma isteği ${P.name} tarafından kabul edildi.`:`${P.name} accepted the pause request.`)}><Pause size={14}/>{tr?'Duraklat':'Pause'}</button>}
          {item.providerCampaignId&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'spend',id:item.id})}><RefreshCw size={14}/>{tr?'Harcamayı güncelle':'Refresh spend'}</button>}
        </div></div>
      {confirm===item.id&&<div className="automation-approve"><label className="automation-choice"><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)}/>{tr?`Bu planın ${P.on} yayına girip günde en çok ${money(item.dailyBudgetMinor)}, toplamda en çok ${money(item.totalMinor)} harcayabileceğini anlıyorum.`:`I understand this plan will go live on ${P.name} and may spend up to ${money(item.dailyBudgetMinor)} a day and ${money(item.totalMinor)} in total.`}</label>
        <div className="coach-action-buttons"><button type="button" className="studio-primary" disabled={!ack||Boolean(busy)} onClick={()=>void post(item.id,{action:'start',id:item.id,acknowledged:true},tr?`${P.name} yayını başlatma isteğini kabul etti. Teslimat ${P.of} incelemesine bağlıdır.`:`${P.name} accepted the start request. Delivery depends on ${P.name}’s review.`).then(()=>setConfirm(''))}><Play size={14}/>{tr?'Başlat':'Start'}</button><button type="button" className="studio-text-button" onClick={()=>setConfirm('')}>{tr?'Vazgeç':'Cancel'}</button></div></div>}
      {item.lastError&&<p className="studio-error" role="alert"><Msg text={item.lastError}/></p>}
      {item.spendCheckedAt&&<p className="coach-muted"><BadgeDollarSign size={13}/> {item.spendMinor===null?(tr?`${P.name} harcama verisi döndürmedi.`:`${P.name} returned no spend data.`):(tr?`${P.of} bildirdiği harcama: ${money(item.spendMinor)}`:`Spend reported by ${P.name}: ${money(item.spendMinor)}`)} · {new Date(item.spendCheckedAt).toLocaleString(locale)}</p>}
    </li>)}</ul>:data.policy&&!form?<div className="studio-empty"><p>{tr?'Henüz reklam planı yok.':'No ad plans yet.'}</p></div>:null}
    {!data.launchEnabled&&<p className="coach-muted">{tr?`Reklam yayınını başlatma bu sunucuda kapalı (PLATFORM_ADS_ENABLED). Planlar onaylanıp ${P.on} duraklatılmış olarak hazırlanabilir.`:`Starting ads is off on this server (PLATFORM_ADS_ENABLED). Plans can still be approved and prepared on ${P.name} as paused.`}</p>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?`Ryzevo bütçeyi kendi başına artırmaz veya harcamayı başlatmaz. Harcama ve sonuçlar yalnız ${P.of} bildirdiği şekilde gösterilir; getiri vaadi yoktur.`:`Ryzevo never raises a budget or starts spending on its own. Spend and results are shown only as ${P.name} reports them; no return is promised.`}</p>
  </section>;
}
