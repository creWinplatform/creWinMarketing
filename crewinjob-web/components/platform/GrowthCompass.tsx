'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronLeft, Compass, ExternalLink, Flag, HelpCircle, Link2, LockKeyhole, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { COMPASS_CHANNELS, COMPASS_INTENTS, COMPASS_PATHS, CONNECTION_GUIDES, connectionGuide, connectionGuideName, type CompassIntent, type GuideId } from '@/lib/platform/guidance-catalog';
import type { CompassPreferences, CompassSnapshot } from '@/lib/platform/guidance-types';
import Msg from '@/components/Msg';

type Draft = Pick<CompassPreferences,'intent'|'experience'|'goalId'|'campaignId'|'appId'|'channels'|'obstacles'>;
type Context = { data:CompassSnapshot|null; error:string; loading:boolean; refresh:()=>void; open:()=>void; guide:(id:GuideId)=>void };
const CompassContext=createContext<Context|null>(null);
const empty:Draft={intent:'leads',experience:'guided',goalId:'',campaignId:'',appId:'',channels:['linkedin_company'],obstacles:{}};
const channelNames:Record<string,[string,string]>={linkedin_company:['LinkedIn şirket','LinkedIn company'],linkedin_person:['LinkedIn kişisel','LinkedIn personal'],facebook:['Facebook Sayfası','Facebook Page'],instagram:['Instagram','Instagram'],twitter:['X','X'],email:['E-posta','Email']};
const labels={done:['Doğrulandı','Verified'],todo:['Sırada','Next'],blocked:['Ön koşul var','Prerequisite'],unknown:['Doğrulanmadı','Unverified']} as const;
const providerLabels={missing:['Henüz bağlı değil','Not connected'],configured:['Kaydedildi; doğrulanmadı','Saved; not verified'],access_verified:['Erişim doğrulandı','Access verified'],publishing_verified:['Yayın erişimi doğrulandı','Publishing access verified'],operator_setup:['Ryzevo kurulumu bekleniyor','Ryzevo setup pending'],restricted:['Yetkili ekip üyesi gerekli','Authorized team member needed']} as const;

export function GrowthCompassProvider({enabled,lang,children}:{enabled:boolean;lang:Locale;children:ReactNode}){
  const tr=lang==='tr',idx=tr?0:1;
  const [data,setData]=useState<CompassSnapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [opened,setOpened]=useState(false),[view,setView]=useState<'setup'|'plan'|'guide'>('plan'),[guideId,setGuideId]=useState<GuideId>('linkedin_company'),[draft,setDraft]=useState<Draft>(empty);
  const dialog=useRef<HTMLDialogElement>(null),previousFocus=useRef<HTMLElement|null>(null),request=useRef<AbortController|null>(null),firstConsidered=useRef(false),draftRevision=useRef(0);
  const callbackVisit=useRef(typeof window!=='undefined'&&['googleConnection','socialConnection','metaConnection','linkedinOrganizationConnection','xConnection'].some(key=>new URLSearchParams(window.location.search).has(key)));
  const refresh=useCallback(()=>{
    if(!enabled)return;request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setError('');
    projectRequest<CompassSnapshot>('/api/platform/compass',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  },[enabled]);
  useEffect(()=>{refresh();const onFocus=()=>{if(document.visibilityState==='visible')refresh();};window.addEventListener('focus',onFocus);return()=>{request.current?.abort();window.removeEventListener('focus',onFocus);};},[refresh]);
  useEffect(()=>{
    if(!data||firstConsidered.current)return;firstConsidered.current=true;
    if(data.firstRun&&!callbackVisit.current){setDraft({...empty,goalId:data.goals.length===1?data.goals[0].id:''});setView('setup');setOpened(true);}
  },[data]);
  useEffect(()=>{
    const element=dialog.current;if(!element)return;
    if(opened&&!element.open){previousFocus.current=document.activeElement as HTMLElement;element.showModal();}
    if(!opened&&element.open){element.close();previousFocus.current?.focus();}
  },[opened]);
  useEffect(()=>{
    if(!opened)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[opened]);
  useEffect(()=>{
    if(!opened)return;dialog.current?.querySelector<HTMLElement>('#compass-title')?.focus();
    dialog.current?.querySelector<HTMLElement>('.compass-scroll')?.scrollTo(0,0);
  },[opened,view,guideId]);
  const open=()=>{setNotice('');setView(data?.preferences?'plan':'setup');draftRevision.current=data?.preferences?.revision||0;setDraft(data?.preferences||{...empty,goalId:data?.goals.length===1?data.goals[0].id:''});setOpened(true);refresh();};
  const guide=(id:GuideId)=>{setGuideId(id);setNotice('');setView('guide');setOpened(true);refresh();};
  const post=async(body:object)=>projectRequest<CompassSnapshot>('/api/platform/compass',{method:'POST',body:JSON.stringify(body)});
  const save=async(input:Draft,revision=data?.preferences?.revision||0)=>{
    if(!data||busy)return;setBusy(true);setError('');setNotice('');
    try{const value=await post({...input,action:'save',expectedRevision:revision});setData(value);setDraft(value.preferences!);draftRevision.current=value.preferences!.revision;setView('plan');}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}
    finally{setBusy(false);}
  };
  const close=async()=>{
    if(busy)return;
    if(data?.firstRun){setBusy(true);setError('');try{setData(await post({action:'defer',expectedRevision:0}));setOpened(false);}catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}finally{setBusy(false);}}
    else setOpened(false);
  };
  const handoff=async()=>{
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{const value=await projectRequest<{created:boolean}>('/api/platform/compass',{method:'POST',body:JSON.stringify({action:'handoff',provider:guideId})});setNotice(value.created?(tr?'Kurulum işi Takvim’e eklendi. Kimseye otomatik mesaj gönderilmedi.':'Setup task added to Calendar. No automatic message was sent.'):(tr?'Bu bağlantının açık işi zaten Takvim’de. İkinci bir iş oluşturulmadı.':'An open task already exists in Calendar. No duplicate was created.'));}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}finally{setBusy(false);}
  };
  const currentGuide=connectionGuide(guideId)!,provider=data?.providers.find(item=>item.id===guideId),next=data?.steps.find(item=>item.id===data.nextStepId);
  const edit=()=>{setDraft(data?.preferences||empty);draftRevision.current=data?.preferences?.revision||0;setView('setup');setNotice('');};
  const selectIntent=(intent:CompassIntent)=>setDraft(old=>({...old,intent,channels:[...COMPASS_PATHS[intent].channels],campaignId:'',appId:''}));
  const value:Context={data,error,loading,refresh,open,guide};
  if(!enabled)return <>{children}</>;
  return <CompassContext.Provider value={value}>{children}
    <dialog ref={dialog} className="growth-compass" aria-labelledby="compass-title" aria-describedby="compass-description" onCancel={event=>{event.preventDefault();void close();}}>
      <header className="compass-header"><span className="compass-symbol"><Compass size={23}/></span><div><p>{data?.projectName||'Ryzevo'}</p><h2 id="compass-title" tabIndex={-1}>{view==='setup'?(tr?'Senin büyüme rotan':'Your growth path'):view==='guide'?connectionGuideName(guideId,lang):(tr?'Büyüme pusulası':'Growth compass')}</h2></div><button type="button" className="icon-button" disabled={busy} aria-label={tr?'Pusulayı kapat':'Close compass'} title={tr?'Pusulayı kapat':'Close compass'} onClick={()=>void close()}><X size={19}/></button></header>
      <div className="compass-scroll">
        <p id="compass-description" className="compass-intro">{view==='setup'?(tr?'Önce tek bir sonuç seçelim. Mevcut hedeflerin ve araçlarınla, kaldığın yerden ilerle.':'Start with one outcome. Continue from your existing goals and tools.'):view==='guide'?currentGuide.purpose[lang]:(tr?'Tamamlanan adımlar proje kayıtlarından doğrulanır. Okumak veya sonraya bırakmak bir işlemi tamamlamaz.':'Completed steps are verified from project records. Reading or deferring does not complete an action.')}</p>
        {error&&<div role="alert" className="studio-error"><Msg text={error}/><button type="button" className="icon-button" title={tr?'Yenile':'Refresh'} aria-label={tr?'Yenile':'Refresh'} onClick={refresh}><RefreshCw size={16}/></button></div>}
        {notice&&<p className="compass-notice" role="status"><Msg text={notice}/> <a href="/?tab=calendar">{tr?'Takvimi aç':'Open Calendar'}<ArrowRight size={13}/></a></p>}
        {!data&&<p role="status">{loading?(tr?'Rotan hazırlanıyor…':'Preparing your path…'):(tr?'Pusula yüklenemedi. Araçları kullanmaya devam edebilirsin.':'Compass unavailable. You can keep using your tools.')}</p>}
        {data&&view==='setup'&&<form onSubmit={event=>{event.preventDefault();void save(draft,draftRevision.current);}}>
          <fieldset className="compass-choices" disabled={busy}><legend>{tr?'İlk önceliğin ne?':'What is your first priority?'}</legend>{COMPASS_INTENTS.map(intent=><label key={intent} className={draft.intent===intent?'selected':''}><input type="radio" name="compass-intent" value={intent} checked={draft.intent===intent} onChange={()=>selectIntent(intent)}/><span><strong>{COMPASS_PATHS[intent].label[lang]}</strong><small>{COMPASS_PATHS[intent].outcome[lang]}</small></span><ArrowRight size={15}/></label>)}</fieldset>
          <div className="compass-form-row"><label>{tr?'Mevcut büyüme hedefi':'Existing growth goal'}<select aria-label={tr?'Mevcut büyüme hedefi':'Existing growth goal'} value={draft.goalId} onChange={event=>setDraft({...draft,goalId:event.target.value,campaignId:''})}><option value="">{tr?'Henüz seçmedim':'Not selected yet'}</option>{data.goals.map(goal=><option key={goal.id} value={goal.id}>{goal.label[lang]}</option>)}</select></label><fieldset className="compass-experience"><legend>{tr?'Ne kadar yönlendirme istersin?':'How much guidance?'}</legend><label><input type="radio" name="compass-experience" checked={draft.experience==='guided'} onChange={()=>setDraft({...draft,experience:'guided'})}/>{tr?'Adım adım':'Step by step'}</label><label><input type="radio" name="compass-experience" checked={draft.experience==='experienced'} onChange={()=>setDraft({...draft,experience:'experienced'})}/>{tr?'Özet plan':'Compact plan'}</label></fieldset></div>
          {['leads','social'].includes(draft.intent)&&<fieldset className="compass-channel-picker" disabled={busy}><legend>{tr?'İlk pilot kanalları · en fazla 3':'First pilot channels · up to 3'}</legend>{COMPASS_CHANNELS.map(channel=><label key={channel}><input type="checkbox" checked={draft.channels.includes(channel)} disabled={!draft.channels.includes(channel)&&draft.channels.length>=3} onChange={event=>setDraft({...draft,channels:event.target.checked?[...draft.channels,channel]:draft.channels.filter(item=>item!==channel)})}/>{channelNames[channel][idx]}</label>)}</fieldset>}
          {draft.channels.length>1&&<div className="compass-form-row"><label>{tr?'İlk prova kanalı':'First rehearsal channel'}<select aria-label={tr?'İlk prova kanalı':'First rehearsal channel'} value={draft.channels[0]} onChange={event=>setDraft({...draft,channels:[event.target.value as Draft['channels'][number],...draft.channels.filter(item=>item!==event.target.value)]})}>{draft.channels.map(channel=><option key={channel} value={channel}>{channelNames[channel][idx]}</option>)}</select></label></div>}
          <footer className="compass-actions"><button type="button" className="studio-text-button" disabled={busy} onClick={()=>data.preferences?setView('plan'):void close()}>{data.preferences?(tr?'Vazgeç':'Cancel'):(tr?'Şimdilik keşfedeceğim':'Explore for now')}</button><button className="studio-primary" disabled={busy}>{busy?(tr?'Kaydediliyor…':'Saving…'):(tr?'Rotamı oluştur':'Build my path')}<ArrowRight size={16}/></button></footer>
        </form>}
        {data&&view==='plan'&&<>
          <div className="compass-plan-summary"><div><span>{data.preferences?COMPASS_PATHS[data.preferences.intent].label[lang]:''}</span><strong>{data.completed}<small> / {data.total} {tr?'adım doğrulandı':'steps verified'}</small></strong></div><button className="studio-text-button" onClick={edit}>{tr?'Rotayı değiştir':'Change path'}</button><progress max={data.total||1} value={data.completed} aria-label={tr?'Doğrulanmış adımlar':'Verified steps'}/></div>
          {(data.campaigns.length>0||data.apps.length>0)&&<div className="compass-bindings">{data.preferences?.intent!=='seo'&&data.campaigns.length>0&&<label>{tr?'Bu rotadaki kampanya':'Campaign for this path'}<select aria-label={tr?'Bu rotadaki kampanya':'Campaign for this path'} disabled={busy} value={data.boundCampaignId||''} onChange={event=>void save({...data.preferences!,campaignId:event.target.value})}><option value="">{tr?'Kampanya seç':'Select a campaign'}</option>{data.campaigns.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{data.preferences?.intent==='mobile'&&data.apps.length>0&&<label>{tr?'Mobil uygulama':'Mobile app'}<select aria-label={tr?'Mobil uygulama':'Mobile app'} disabled={busy} value={data.boundAppId||''} onChange={event=>void save({...data.preferences!,appId:event.target.value})}><option value="">{tr?'Uygulama seç':'Select app'}</option>{data.apps.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>}
          <ol className={`compass-steps ${data.preferences?.experience==='experienced'?'compact':''}`}>
            {data.steps.map((step,index)=><li key={step.id} className={`compass-step ${step.state}`} aria-current={step.id===next?.id?'step':undefined}>
              <span className="compass-step-number">{step.state==='done'?<Check size={16}/>:index+1}</span>
              <div>
                <div className="compass-step-heading"><h3>{step.label[lang]}</h3><span>{labels[step.state][idx]}</span></div>
                <p>{step.detail[lang]}</p>
                {step.reason&&<p className="compass-prerequisite"><LockKeyhole size={13}/>{step.reason[lang]}</p>}
                {step.evidenceAt&&<time dateTime={step.evidenceAt}>{new Date(step.evidenceAt).toLocaleString(localeTag(lang))}</time>}
                <div className="compass-step-actions">
                  {step.provider&&<button className="studio-text-button" onClick={()=>guide(step.provider!)}><HelpCircle size={14}/>{tr?'Hesap / izin rehberi':'Account / access guide'}</button>}
                  {step.id==='channels'||step.id==='goal'&&data.goals.length>0?
                    <button className="studio-text-button" onClick={edit}>{step.id==='goal'?(tr?'Hedef seç':'Choose goal'):(tr?'Kanal seç':'Choose channel')}<ArrowRight size={14}/></button>:
                    step.canAct?<a href={step.href} className="studio-text-button">{step.state==='done'?(tr?'Kaydı incele':'Review record'):(tr?'Bu adıma git':'Go to step')}<ArrowRight size={14}/></a>:<span>{tr?'Yetkili ekip üyesine danış':'Contact an authorized teammate'}</span>}
                </div>
              </div>
            </li>)}
          </ol>
          <footer className="compass-actions"><span className="compass-safety"><ShieldCheck size={16}/>{tr?'Bu plan kendiliğinden gönderim yapmaz.':'This plan never sends automatically.'}</span><button className="icon-button" disabled={loading} title={tr?'Durumu yenile':'Refresh status'} aria-label={tr?'Durumu yenile':'Refresh status'} onClick={refresh}><RefreshCw size={17} className={loading?'animate-spin':''}/></button></footer>
        </>}
        {data&&view==='guide'&&<>
          <button className="studio-text-button compass-back" onClick={()=>setView(data.preferences?'plan':'setup')}><ChevronLeft size={15}/>{tr?'Rotama dön':'Back to my path'}</button>
          {provider&&<p className="compass-provider-state"><Link2 size={16}/>{providerLabels[provider.state][idx]}{provider.checkedAt&&<time dateTime={provider.checkedAt}>{new Date(provider.checkedAt).toLocaleString(localeTag(lang))}</time>}</p>}
          <div className="compass-guide-columns"><section><h3>{tr?'Başlamadan önce':'Before you start'}</h3><ul>{currentGuide.needs.map((item,index)=><li key={index}>{item[lang]}</li>)}</ul></section><section><h3>{tr?'İzlenecek sıra':'Next steps'}</h3><ol>{currentGuide.steps.map((item,index)=><li key={index}>{item[lang]}</li>)}</ol></section></div>
          <div className="compass-troubleshooting">{currentGuide.troubleshooting.map((item,index)=><details key={index}><summary>{item.problem[lang]}</summary><p>{item.solution[lang]}</p></details>)}</div>
          <div className="compass-form-row"><label>{tr?'Nerede takıldın?':'What is blocking you?'}<select aria-label={tr?'Nerede takıldın?':'What is blocking you?'} disabled={busy||!data.preferences} value={data.preferences?.obstacles[guideId]||''} onChange={event=>{const obstacles={...data.preferences!.obstacles};if(event.target.value)obstacles[guideId]=event.target.value as 'unknown';else delete obstacles[guideId];void save({...data.preferences!,obstacles}).then(()=>{setGuideId(guideId);setView('guide');});}}><option value="">{tr?'Engel seçilmedi':'No blocker selected'}</option><option value="unknown">{tr?'Nereden başlayacağımı bilmiyorum':'I do not know where to start'}</option><option value="no_account">{tr?'Henüz hesabım / sayfam yok':'I do not have an account / page'}</option><option value="need_access">{tr?'Hesap var, yetkim yok':'The account exists; I need access'}</option><option value="later">{tr?'Sonraya bırakacağım':'I will do this later'}</option></select></label><div className="compass-handoff"><button className="studio-secondary" disabled={busy||!data.canWrite} onClick={()=>void handoff()}><Flag size={15}/>{tr?'Kurulum işi oluştur':'Create setup task'}</button><small>{tr?'Mevcut Takvim’de izlenir; otomatik atama veya mesaj yok.':'Tracked in the existing Calendar; no automatic assignment or message.'}</small></div></div>
          <nav className="compass-doc-links" aria-label={tr?'Resmî kurulum kaynakları':'Official setup resources'}>{currentGuide.links.map(link=><a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.label[lang]}<ExternalLink size={13}/></a>)}</nav>
          <footer className="compass-actions"><span className="compass-safety"><ShieldCheck size={16}/>{tr?'Parola veya token iş notuna yazılmaz.':'Never add passwords or tokens to task notes.'}</span>{data.canManage?<a className="studio-primary" href={currentGuide.href}>{tr?'Kurulum ekranına git':'Go to setup'}<ArrowRight size={15}/></a>:<span>{tr?'Hesap yöneticinden yardım iste.':'Ask your account administrator.'}</span>}</footer>
        </>}
      </div>
    </dialog>
  </CompassContext.Provider>;
}

export function CompassLauncher({lang}:{lang:Locale}){const compass=useContext(CompassContext);if(!compass)return null;const tr=lang==='tr';return <button type="button" className="compass-launcher" onClick={compass.open} title={tr?'Büyüme pusulasını aç':'Open growth compass'} aria-label={tr?'Büyüme pusulasını aç':'Open growth compass'}><Compass size={18}/><span>{tr?'Pusula':'Compass'}</span></button>;}

export function CompassOverview({lang}:{lang:Locale}){
  const compass=useContext(CompassContext);if(!compass)return null;const {data,loading,error}=compass,tr=lang==='tr',next=data?.steps.find(item=>item.id===data.nextStepId);
  return <section className="compass-overview"><div className="studio-section-title"><h2><Compass size={17}/>{tr?'Büyüme pusulası':'Growth compass'}</h2>{data?.preferences&&<span className="studio-badge">{data.completed}/{data.total}</span>}</div>{error?<p role="status">{tr?'Pusula yüklenemedi; mevcut araçlar kullanılabilir.':'Compass unavailable; your tools remain available.'}</p>:loading&&!data?<p role="status">{tr?'Rotan yükleniyor…':'Loading your path…'}</p>:<><progress max={data?.total||1} value={data?.completed||0} aria-label={tr?'Doğrulanmış adımlar':'Verified steps'}/><h3>{data?.preferences?next?.label[lang]||(tr?'Rotadaki adımlar doğrulandı':'Path steps verified'):(tr?'İlk hedefini seç':'Choose your first goal')}</h3><p>{data?.preferences?next?.reason?.[lang]||next?.detail[lang]:(tr?'Mevcut araçlarınla, sana uygun bir başlangıç.':'A relevant starting point using your existing tools.')}</p></>}<button type="button" className="studio-text-button" onClick={compass.open}>{tr?'Rotama devam et':'Continue my path'}<ArrowRight size={15}/></button></section>;
}

export function ConnectionGuidePanel({lang}:{lang:Locale}){
  const compass=useContext(CompassContext);if(!compass)return null;const tr=lang==='tr';
  return <details className="connection-guide-panel"><summary><HelpCircle size={17}/>{tr?'Hangi hesap ve izin gerekli?':'Which account and permissions do I need?'}</summary><div>{CONNECTION_GUIDES.filter(item=>['linkedin_company','linkedin_person','facebook','instagram','twitter','ga4','search_console','email','product_data','mobile'].includes(item.id)).map(guide=><button key={guide.id} type="button" onClick={()=>compass.guide(guide.id)}><span>{connectionGuideName(guide.id,lang)}</span><ArrowRight size={14}/></button>)}</div></details>;
}

export function ProviderGuideButton({lang,id}:{lang:Locale;id:GuideId}){const compass=useContext(CompassContext);if(!compass)return null;return <button type="button" className="studio-text-button" onClick={()=>compass.guide(id)}><HelpCircle size={14}/>{lang==='tr'?'Kurulum rehberi':'Setup guide'}</button>;}
