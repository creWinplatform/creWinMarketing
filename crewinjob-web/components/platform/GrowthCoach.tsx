'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarPlus, Check, ChevronLeft, Clock3, Lightbulb, Plus, RefreshCw, ShieldCheck, SkipForward, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import type { LocalizedText, Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { COACH_BUDGETS, COACH_CHANNELS, COACH_CURRENT, COACH_HOURS, COACH_GOALS, COACH_MARKETS, COACH_OBSTACLES, COACH_PREFILL_KEY, COACH_PRICES, COACH_SALES, COACH_SKILLS, COACH_TOOLS, diffBriefs, type CoachAction, type CoachAnswers, type CoachGoal, type CoachBrief, type CoachChannel, type CoachSnapshot, type CoachTool } from '@/lib/platform/coach-types';
import Msg from '@/components/Msg';
import { briefChangeLines } from './coach-changes';
import { useCompassRefresh } from './GrowthCompass';
import CoachAssign from './CoachAssign';

type Pair=[string,string];
type EditBrief=Omit<CoachBrief,'icp'>&{icp:{summary:string;pains:string}};
const emptyAnswers:CoachAnswers={offer:'',customer:'',market:'b2b',price:'mid',sales:'online',current:['website'],hours:'2to5',budget:'none',skills:['writing'],obstacle:'start',success:''};
const goalChoices:Record<CoachGoal,[string,string,string,string]>={
  leads:['Nitelikli talep ve müşteri','Qualified leads and customers','Kayıt, teklif isteği, satış görüşmesi','Sign-ups, quote requests, sales calls'],
  social:['Sosyal medyada erişim','Social reach','Daha çok kişiye ulaşmak ve etkileşim','Reaching more people and engagement'],
  retention:['Mevcut kullanıcıyı etkinleştirme','Activate existing users','Kayıtlı kullanıcıları geri getirmek','Bringing registered users back'],
  seo:['Organik arama trafiği','Organic search traffic','Google’da bulunmak','Being found on Google'],
  mobile:['Mobil uygulama büyümesi','Mobile app growth','Uygulama kullanımı ve dönüş','App use and return visits'],
};
const choices={
  market:{b2b:['İşletmeler (B2B)','Businesses (B2B)'],b2c:['Bireyler (B2C)','Individuals (B2C)'],both:['Her ikisi','Both']},
  price:{free:['Ücretsiz / freemium','Free or freemium'],low:['Düşük · hızlı karar','Low · quick decision'],mid:['Orta · karşılaştırarak alınır','Mid · compared before buying'],high:['Yüksek · görüşme veya teklif gerekir','High · needs a conversation or quote']},
  sales:{online:['İnternetten, kendi kendine','Online, self-serve'],sales:['Görüşme veya demo ile','Through a conversation or demo'],local:['Yüz yüze / yerel','In person or local']},
  current:{website:['Web sitesi','Website'],linkedin:['LinkedIn','LinkedIn'],instagram:['Instagram','Instagram'],facebook:['Facebook','Facebook'],twitter:['X','X'],email:['E-posta','Email'],seo:['Arama / blog','Search / blog'],whatsapp:['WhatsApp','WhatsApp'],ads:['Ücretli reklam','Paid ads'],none:['Henüz yok','None yet']},
  budget:{none:['Reklam bütçemiz yok','No ad budget'],small:['Küçük · deneme için','Small · to test'],mid:['Orta · düzenli kampanya','Medium · regular campaigns'],high:['Geniş · birden çok kampanya','Large · several campaigns']},
  hours:{lt2:['2 saatten az','Less than 2 hours'],'2to5':['2–5 saat','2–5 hours'],'5to10':['5–10 saat','5–10 hours'],gt10:['10 saatten fazla','More than 10 hours']},
  skills:{writing:['Yazı','Writing'],design:['Tasarım','Design'],video:['Video','Video'],analytics:['Veri / analiz','Data / analysis'],sales:['Satış görüşmesi','Sales conversations'],none:['Henüz emin değilim','Not sure yet']},
  obstacle:{start:['Nereden başlayacağımı bilmiyorum','I don’t know where to start'],audience:['Henüz kitlemiz yok','We have no audience yet'],time:['Zamanımız yok','We don’t have time'],ideas:['İçerik fikri bulamıyoruz','We run out of content ideas'],conversion:['İlgi müşteriye dönüşmüyor','Interest doesn’t turn into customers'],measurement:['Sonucu ölçemiyoruz','We can’t measure results']},
} satisfies Record<string,Record<string,Pair>>;
const channelNames:Record<CoachChannel,Pair>={linkedin:['LinkedIn','LinkedIn'],instagram:['Instagram','Instagram'],facebook:['Facebook','Facebook'],twitter:['X','X'],email:['E-posta','Email'],seo:['Arama (SEO/blog)','Search (SEO/blog)'],whatsapp:['WhatsApp','WhatsApp'],ads:['Ücretli reklam','Paid ads']};
const toolNames:Record<CoachTool,Pair>={library:['İçerik stüdyosu','Content studio'],campaigns:['Kampanya merkezi','Campaign hub'],seo:['SEO operasyon merkezi','SEO operations hub'],calendar:['Takvim','Calendar'],project:['Proje ayarları','Project settings'],connections:['Bağlantılar','Connections'],analytics:['Analitik','Analytics'],ads:['Reklamlar','Ads'],whatsapp:['WhatsApp','WhatsApp']};
const openLabels:Record<CoachTool,Pair>={library:['İçerik stüdyosunu aç','Open content studio'],campaigns:['Kampanya merkezini aç','Open campaign hub'],seo:['SEO merkezini aç','Open SEO hub'],calendar:['Takvimi aç','Open Calendar'],project:['Proje ayarlarını aç','Open project settings'],connections:['Bağlantı kurulumunu aç','Open connection setup'],analytics:['Analitiği aç','Open Analytics'],ads:['Reklamları aç','Open Ads'],whatsapp:['WhatsApp’ı aç','Open WhatsApp']};
const toEdit=(brief:CoachBrief):EditBrief=>({...brief,icp:{summary:brief.icp.summary,pains:brief.icp.pains.join('\n')}});
const fromEdit=(brief:EditBrief):CoachBrief=>({...brief,icp:{summary:brief.icp.summary,pains:brief.icp.pains.split('\n').map(item=>item.trim()).filter(Boolean)}});

// guided: the overview's next-step card already invites to the diagnosis and the draft review, so before a brief is
// approved this card shows only its dialog (opened by the 'ryzevo:coach-open' event).
export default function GrowthCoach({workspace,lang,onChange,guided=false}:{workspace:WorkspaceContext;lang:Locale;onChange?:()=>void;guided?:boolean}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [data,setData]=useState<CoachSnapshot|null>(null),[error,setError]=useState(''),[dialogError,setDialogError]=useState(''),[notice,setNotice]=useState(''),[calendarNotice,setCalendarNotice]=useState(false),[libraryNotice,setLibraryNotice]=useState(false),[busy,setBusy]=useState('');
  const [opened,setOpened]=useState(false),[view,setView]=useState<'questions'|'review'|'brief'>('questions'),[answers,setAnswers]=useState<CoachAnswers>(emptyAnswers),[language,setLanguage]=useState<'tr'|'en'>(workspace.project.language||lang),[edit,setEdit]=useState<EditBrief|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),previousFocus=useRef<HTMLElement|null>(null),request=useRef<AbortController|null>(null),refreshCompass=useCompassRefresh(),firstStart=useRef(false);
  const show=(value:string|LocalizedText)=>typeof value==='string'?value:value[lang];
  const load=useCallback(()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;setError('');
    return projectRequest<CoachSnapshot>('/api/platform/coach',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}).then(value=>{if(!controller.signal.aborted)setData(value);return value;}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);return null;});
  },[]);
  useEffect(()=>{void load();return()=>request.current?.abort();},[load]);
  // Guided first start (set by the Compass on a member's first visit): open the diagnosis once, never over another dialog.
  useEffect(()=>{
    const start=()=>{const flag=window as Window&{__ryzevoCoachStart?:boolean};if(!flag.__ryzevoCoachStart||!data||!data.canWrite||data.brief||data.draft||opened)return;flag.__ryzevoCoachStart=false;firstStart.current=true;openQuestions();};
    start();window.addEventListener('ryzevo:coach-start',start);return()=>window.removeEventListener('ryzevo:coach-start',start);
  },[data]);
  useEffect(()=>{
    const open=()=>{if(!data||opened)return;if(data.draft)openReview(data.draft);else if(data.canWrite)openQuestions();};
    window.addEventListener('ryzevo:coach-open',open);return()=>window.removeEventListener('ryzevo:coach-open',open);
  },[data,opened]);
  useEffect(()=>{
    const element=dialog.current;if(!element)return;
    if(opened&&!element.open){previousFocus.current=document.activeElement as HTMLElement;element.showModal();}
    if(!opened&&element.open){element.close();previousFocus.current?.focus();}
  },[opened]);
  useEffect(()=>{if(!opened)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[opened]);
  useEffect(()=>{if(!opened)return;dialog.current?.querySelector<HTMLElement>('#coach-title')?.focus();dialog.current?.querySelector<HTMLElement>('.compass-scroll')?.scrollTo(0,0);},[opened,view]);
  const post=async<T,>(body:object)=>projectRequest<T>('/api/platform/coach',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const fail=(reason:unknown)=>reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.');
  const openQuestions=()=>{setAnswers(data?.answers||emptyAnswers);setLanguage(data?.draft?.language||data?.brief?.language||workspace.project.language||lang);setDialogError('');setView('questions');setOpened(true);};
  const openReview=(brief:CoachBrief)=>{setEdit(toEdit(brief));setDialogError('');setView('review');setOpened(true);};
  const openBrief=()=>{setDialogError('');setView('brief');setOpened(true);};
  // Closing the guided first start without a diagnosis defers the Compass first run, like closing the Compass itself.
  const close=()=>{if(busy)return;setOpened(false);if(firstStart.current&&!data?.draft&&!data?.brief){firstStart.current=false;void projectRequest('/api/platform/compass',{method:'POST',body:JSON.stringify({action:'defer',expectedRevision:0})}).catch(()=>{}).finally(refreshCompass);}};
  const diagnose=async(mode:'ai'|'template',event?:FormEvent)=>{
    event?.preventDefault();if(!data||busy)return;setBusy(mode);setDialogError('');
    try{const value=await post<CoachSnapshot>({action:'diagnose',mode,language,answers,expectedRevision:data.revision});setData(value);refreshCompass();if(value.draft)openReview(value.draft);}
    catch(reason){setDialogError(fail(reason));void load();}finally{setBusy('');}
  };
  const saveBrief=async(action:'save'|'approve')=>{
    if(!data||!edit||busy)return;setBusy(action);setDialogError('');
    try{const value=await post<CoachSnapshot>({action,brief:fromEdit(edit),expectedRevision:data.revision});setData(value);
      setCalendarNotice(false);onChange?.();if(action==='approve'){firstStart.current=false;refreshCompass();setOpened(false);window.dispatchEvent(new Event('ryzevo:compass-show-path'));setNotice(value.starterDrafts>0?(tr?`Strateji briefi onaylandı. İlk hafta için ${value.starterDrafts} başlangıç taslağı İçerik kütüphanesinde hazır; her birini okuyup kendi bilginizle düzenleyin. Hiçbiri kendiliğinden yayınlanmaz.`:`Strategy brief approved. ${value.starterDrafts} starter drafts for the first week are ready in the content library; read and edit each with your own facts. None is published on its own.`):(tr?'Strateji briefi onaylandı. Bu haftanın eylemleri aşağıda.':'Strategy brief approved. This week’s actions are below.'));setLibraryNotice(value.starterDrafts>0);}
      else{setLibraryNotice(false);setNotice(tr?'Taslak kaydedildi. Onaylanana kadar haftalık plan değişmez.':'Draft saved. The weekly plan doesn’t change until it is approved.');}}
    catch(reason){setDialogError(fail(reason));}finally{setBusy('');}
  };
  const act=async(action:CoachAction,state:'open'|'done'|'skipped')=>{
    if(busy)return;setBusy(action.id);setError('');setNotice('');setCalendarNotice(false);
    try{setData(await post<CoachSnapshot>({action:'act',actionId:action.id,state}));onChange?.();}catch(reason){setError(fail(reason));}finally{setBusy('');}
  };
  const schedule=async(action:CoachAction)=>{
    if(busy)return;setBusy(action.id);setError('');setNotice('');setCalendarNotice(false);
    try{const value=await post<{created:boolean;snapshot:CoachSnapshot}>({action:'schedule',actionId:action.id});setData(value.snapshot);onChange?.();setLibraryNotice(false);setCalendarNotice(true);setNotice(value.created?(tr?'Eylem Takvim’e planlanmış iş olarak eklendi. Kimseye bildirim gönderilmedi.':'Added to the Calendar as a planned task. No one was notified.'):(tr?'Bu eylemin açık bir işi zaten Takvim’de.':'This action already has an open task in the Calendar.'));}
    catch(reason){setError(fail(reason));}finally{setBusy('');}
  };
  const handoff=(action:CoachAction)=>{
    if(!action.prefill)return;
    try{sessionStorage.setItem(COACH_PREFILL_KEY,JSON.stringify({...action.prefill,tab:action.tool==='campaigns'?'campaigns':'library',at:Date.now()}));}catch{/* Storage can be unavailable; the tool still opens without a pre-filled brief. */}
  };
  const toggle=<K extends 'current'|'skills'>(key:K,value:CoachAnswers[K][number])=>setAnswers(old=>{
    const list=old[key] as string[],next=list.includes(value)?list.filter(item=>item!==value):value==='none'?['none']:[...list.filter(item=>item!=='none'),value];
    return {...old,[key]:next};
  });
  const minutes=(value:number)=>tr?`≈ ${value.toLocaleString(locale)} dk`:`≈ ${value.toLocaleString(locale)} min`;
  const date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'long',year:'numeric',timeZone:workspace.project.timezone});
  const brief=data?.brief,pending=data?.draft;

  const actionCard=(action:CoachAction)=><li key={action.id} className="coach-action">
    <div className="coach-action-meta"><span className="studio-badge">{action.kind==='setup'?(tr?'Ön koşul':'Prerequisite'):(tr?`Plan · ${action.week}. hafta`:`Plan · week ${action.week}`)}</span><span><Clock3 size={13}/>{minutes(action.minutes)}</span><span>{toolNames[action.tool][idx]}</span></div>
    <h3>{show(action.title)}</h3>
    <p><strong>{tr?'Neden: ':'Why: '}</strong>{show(action.why)}</p>
    <details><summary>{tr?'Nasıl yapılır':'How to do it'}</summary><p>{show(action.how)}</p></details>
    <CoachAssign kind="action" itemId={action.id} assignment={action.assignment} lang={lang} onSaved={()=>void load()}/>
    <div className="coach-action-buttons">
      {action.canAct?<a className="studio-secondary" href={action.href} onClick={()=>handoff(action)}>{openLabels[action.tool][idx]}<ArrowRight size={15}/></a>:<span className="coach-muted">{tr?'Bu araç için yetkili bir ekip üyesi gerekli.':'An authorized teammate is needed for this tool.'}</span>}
      {data?.canWrite&&<>
        {action.taskId?<a className="studio-text-button" href="/?tab=calendar"><CalendarPlus size={15}/>{tr?'Takvimde':'In Calendar'}</a>:<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void schedule(action)}><CalendarPlus size={15}/>{tr?'Takvime ekle':'Add to Calendar'}</button>}
        <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void act(action,'done')}><Check size={15}/>{tr?'Tamamlandı':'Done'}</button>
        <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void act(action,'skipped')}><SkipForward size={15}/>{tr?'Bu hafta atla':'Skip this week'}</button>
      </>}
    </div>
  </li>;

  const updatePlan=(index:number,patch:Partial<CoachBrief['plan'][number]>)=>setEdit(old=>old&&{...old,plan:old.plan.map((item,i)=>i===index?{...item,...patch}:item)});
  const briefLabel=(key:string)=>({tr:{icp:'İdeal müşteri (ICP)',pains:'Müşteri sorunları ve doğrulanacak varsayımlar',positioning:'Konumlandırma',channels:'Öncelikli kanallar',plan:'30 günlük plan'},en:{icp:'Ideal customer (ICP)',pains:'Customer problems and assumptions to validate',positioning:'Positioning',channels:'Priority channels',plan:'30-day plan'}})[lang][key as 'icp'];

  const cardHidden=guided&&!brief;
  return <section className={cardHidden?'coach-panel coach-panel-guided':'coach-panel'} aria-labelledby={cardHidden?undefined:'coach-panel-title'}>
    {!cardHidden&&<div className="studio-section-title"><h2 id="coach-panel-title"><Lightbulb size={17}/>{brief?(tr?'Bu hafta':'This week'):(tr?'Büyüme koçu':'Growth coach')}</h2>
      {brief&&<div className="coach-panel-tools">{data?.week&&<span className="studio-badge">{data.week<=4?(tr?`Hafta ${data.week} / 4`:`Week ${data.week} of 4`):(tr?'30 günlük dönem bitti':'30-day period ended')}</span>}<a className="studio-text-button" href="/?tab=calendar&planning=content">{tr?'İçerik planı':'Content plan'}<ArrowRight size={14}/></a><a className="studio-text-button" href="/?tab=project&settings=brand">{tr?'Marka & rakipler':'Brand & competitors'}<ArrowRight size={14}/></a><button type="button" className="studio-text-button" onClick={openBrief}>{tr?'Strateji briefi':'Strategy brief'}<ArrowRight size={14}/></button></div>}
    </div>}
    {error&&<div className="studio-error" role="alert"><Msg text={error}/><button type="button" className="icon-button" title={tr?'Yeniden dene':'Retry'} aria-label={tr?'Yeniden dene':'Retry'} onClick={()=>void load()}><RefreshCw size={16}/></button></div>}
    {notice&&<p className="studio-success" role="status"><Msg text={notice}/>{calendarNotice&&<> <a href="/?tab=calendar">{tr?'Takvimi aç':'Open Calendar'}</a></>}{libraryNotice&&<> <a href="/?tab=library">{tr?'Taslakları aç':'Open the drafts'}</a></>}</p>}
    {!data&&!error&&!cardHidden&&<p className="studio-skeleton" role="status">{tr?'Büyüme koçu yükleniyor…':'Loading growth coach…'}</p>}
    {data&&!cardHidden&&!brief&&!pending&&<div className="coach-intro">
      <div><h3>{tr?'Nereden başlayacağınızdan emin değil misiniz?':'Not sure where to start?'}</h3><p>{tr?'Ana hedefinizi seçin ve ürününüz ile ekibiniz hakkında 11 kısa soruyu yanıtlayın. Ryzevo; ideal müşteri, konumlandırma, 2–3 öncelikli kanal ve 30 günlük bir plan içeren bir strateji briefi taslağı hazırlar. Siz inceleyip düzenler ve onaylarsınız.':'Pick your main goal and answer 11 short questions about your product and team. Ryzevo drafts a strategy brief — ideal customer, positioning, 2–3 priority channels and a 30-day plan — for you to review, edit and approve.'} <a className="coach-guide-link" href="/guide" target="_blank" rel="noreferrer">{tr?'Kullanım rehberi':'User guide'}</a></p></div>
      {data.canWrite?<button type="button" className="studio-primary" onClick={openQuestions}>{tr?'Teşhise başla':'Start the diagnosis'}<ArrowRight size={16}/></button>:<p className="coach-muted">{tr?'Teşhisi içerik yetkisi olan bir ekip üyesi başlatabilir.':'A teammate with content permission can start the diagnosis.'}</p>}
    </div>}
    {data&&pending&&!cardHidden&&<div className="coach-pending" role="status"><div><strong>{brief?(tr?'Güncellenmiş bir brief taslağı onay bekliyor.':'A revised brief draft is waiting for approval.'):(tr?'Strateji briefi taslağınız inceleme bekliyor.':'Your strategy brief draft is waiting for review.')}</strong><span>{data.draftSource==='ai'?(tr?'AI önerisi':'AI suggestion'):(tr?'Yanıtlarınızdan kural tabanlı başlangıç':'Rule-based starter from your answers')}{data.draftAt?` · ${date(data.draftAt)}`:''}</span></div><button type="button" className="studio-secondary" onClick={()=>openReview(pending)}>{tr?'Taslağı incele':'Review draft'}<ArrowRight size={15}/></button></div>}
    {data&&brief&&<>
      {data.actions.length>0?<ol className="coach-actions">{data.actions.map(actionCard)}</ol>:<div className="studio-empty"><Check size={24}/><p>{data.remaining===0&&data.resolved.length===0?(tr?'Plandaki tüm eylemler tamamlandı. Gelecek ay için yeni bir teşhis yapabilirsiniz.':'Every plan action is handled. You can run a new diagnosis for next month.'):(tr?'Bu haftanın eylemleri tamamlandı veya ertelendi.':'This week’s actions are done or deferred.')}</p>{data.canWrite&&<button type="button" className="studio-text-button" onClick={openQuestions}>{tr?'Yeni teşhis':'New diagnosis'}<ArrowRight size={14}/></button>}</div>}
      {data.resolved.length>0&&<details className="coach-resolved"><summary>{tr?`Bu hafta ele alınanlar (${data.resolved.length})`:`Handled this week (${data.resolved.length})`}</summary><ul>{data.resolved.map(action=><li key={action.id}><span className={`coach-state ${action.state}`}>{action.state==='done'?(tr?'Tamamlandı':'Done'):(tr?'Atlandı':'Skipped')}</span><span>{show(action.title)}</span>{data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void act(action,'open')}><Undo2 size={14}/>{tr?'Geri al':'Undo'}</button>}</li>)}</ul></details>}
      <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Bunlar öneridir; hiçbir şey otomatik yayınlanmaz veya gönderilmez.':'These are suggestions; nothing is published or sent automatically.'}</p>
    </>}

    <dialog ref={dialog} className="growth-compass coach-dialog" aria-labelledby="coach-title" onCancel={event=>{event.preventDefault();close();}}>
      <header className="compass-header"><span className="compass-symbol"><Lightbulb size={22}/></span><div><p>{workspace.project.name}</p><h2 id="coach-title" tabIndex={-1}>{view==='questions'?(tr?'Büyüme teşhisi':'Growth diagnosis'):view==='review'?(tr?'Strateji briefini incele':'Review the strategy brief'):(tr?'Onaylı strateji briefi':'Approved strategy brief')}</h2></div><button type="button" className="icon-button" disabled={Boolean(busy)} aria-label={tr?'Kapat':'Close'} title={tr?'Kapat':'Close'} onClick={close}><X size={19}/></button></header>
      <div className="compass-scroll">
        {dialogError&&<div role="alert" className="studio-error"><Msg text={dialogError}/></div>}
        {data&&view==='questions'&&<form className="coach-questions" onSubmit={event=>void diagnose(data.aiConfigured?'ai':'template',event)}>
          <p className="compass-intro">{tr?'Kısa ve kendi kelimelerinizle yanıtlayın. Doğru ya da yanlış yanıt yok; her şeyi sonra düzenleyebilirsiniz.':'Answer briefly, in your own words. There are no wrong answers; you can edit everything later.'}</p>
          <fieldset disabled={Boolean(busy)}>
            <fieldset className="coach-options coach-goal"><legend>{tr?'Ana hedefiniz ne?':'What is your main goal?'}</legend><small>{tr?'Büyüme rotanız bu seçime göre kurulur; sonra değiştirebilirsiniz.':'Your growth path is built from this choice; you can change it later.'}</small>{COACH_GOALS.map((value,index)=><label key={value} className={answers.goal===value?'selected':''}><input type="radio" name="coach-goal" required={index===0} checked={answers.goal===value} onChange={()=>setAnswers({...answers,goal:value})}/><span>{goalChoices[value][idx]}<small>{goalChoices[value][idx+2]}</small></span></label>)}</fieldset>
            <label className="coach-field"><span>1. {tr?'Ne satıyorsunuz?':'What do you sell?'}</span><small>{tr?'Bir müşteriye anlatır gibi, tek cümleyle.':'In one sentence, as you would tell a customer.'}</small><textarea aria-label={tr?'Ne satıyorsunuz?':'What do you sell?'} required maxLength={300} rows={2} value={answers.offer} onChange={event=>setAnswers({...answers,offer:event.target.value})}/></label>
            <label className="coach-field"><span>2. {tr?'Kim satın alıyor?':'Who buys it?'}</span><small>{tr?'Rol, işletme türü veya yaşam durumu.':'Role, type of business or life situation.'}</small><textarea aria-label={tr?'Kim satın alıyor?':'Who buys it?'} required maxLength={300} rows={2} value={answers.customer} onChange={event=>setAnswers({...answers,customer:event.target.value})}/></label>
            {([['market',tr?'3. Müşterileriniz kim?':'3. Who are your customers?',COACH_MARKETS],['price',tr?'4. Fiyat düzeyi nasıl?':'4. What is the price point?',COACH_PRICES],['sales',tr?'5. Satış nerede gerçekleşiyor?':'5. Where does the sale happen?',COACH_SALES]] as const).map(([key,legend,list])=><fieldset key={key} className="coach-options"><legend>{legend}</legend>{list.map(value=><label key={value} className={answers[key]===value?'selected':''}><input type="radio" name={`coach-${key}`} checked={answers[key]===value} onChange={()=>setAnswers({...answers,[key]:value})}/>{(choices[key] as Record<string,Pair>)[value][idx]}</label>)}</fieldset>)}
            <fieldset className="coach-options"><legend>{tr?'6. Bugün hangi kanalları kullanıyorsunuz?':'6. Which channels do you use today?'}</legend>{COACH_CURRENT.map(value=><label key={value} className={answers.current.includes(value)?'selected':''}><input type="checkbox" checked={answers.current.includes(value)} onChange={()=>toggle('current',value)}/>{choices.current[value][idx]}</label>)}</fieldset>
            <fieldset className="coach-options"><legend>{tr?'7. Ekip olarak haftada ne kadar zaman ayırabilirsiniz?':'7. How much time can the team give each week?'}</legend>{COACH_HOURS.map(value=><label key={value} className={answers.hours===value?'selected':''}><input type="radio" name="coach-hours" checked={answers.hours===value} onChange={()=>setAnswers({...answers,hours:value})}/>{choices.hours[value][idx]}</label>)}</fieldset>
            <fieldset className="coach-options"><legend>{tr?'8. Aylık bir reklam bütçeniz var mı?':'8. Do you have a monthly ad budget?'}</legend><small>{tr?'Tutar gerekmez. Bütçe yoksa ücretli reklam önerilmez.':'No amount needed. Without a budget, paid ads aren’t suggested.'}</small>{COACH_BUDGETS.map(value=><label key={value} className={(answers.budget||'none')===value?'selected':''}><input type="radio" name="coach-budget" checked={(answers.budget||'none')===value} onChange={()=>setAnswers({...answers,budget:value})}/>{choices.budget[value][idx]}</label>)}</fieldset>
            <fieldset className="coach-options"><legend>{tr?'9. Ekipte hangi beceriler var?':'9. Which skills does the team have?'}</legend>{COACH_SKILLS.map(value=><label key={value} className={answers.skills.includes(value)?'selected':''}><input type="checkbox" checked={answers.skills.includes(value)} onChange={()=>toggle('skills',value)}/>{choices.skills[value][idx]}</label>)}</fieldset>
            <fieldset className="coach-options"><legend>{tr?'10. Şu anki en büyük engel ne?':'10. What is the main obstacle right now?'}</legend>{COACH_OBSTACLES.map(value=><label key={value} className={answers.obstacle===value?'selected':''}><input type="radio" name="coach-obstacle" checked={answers.obstacle===value} onChange={()=>setAnswers({...answers,obstacle:value})}/>{choices.obstacle[value][idx]}</label>)}</fieldset>
            <label className="coach-field"><span>11. {tr?'İyi bir ilk ay nasıl görünürdü? (isteğe bağlı)':'What would a good first month look like? (optional)'}</span><small>{tr?'Kendi kelimelerinizle; hedef rakam gerekmez.':'In your words; no target number needed.'}</small><textarea aria-label={tr?'İyi bir ilk ay nasıl görünürdü?':'What would a good first month look like?'} maxLength={300} rows={2} value={answers.success} onChange={event=>setAnswers({...answers,success:event.target.value})}/></label>
            <div className="compass-form-row"><label>{tr?'Brief dili':'Brief language'}<select value={language} onChange={event=>setLanguage(event.target.value as 'tr'|'en')}><option value="tr">Türkçe</option><option value="en">English</option></select></label></div>
          </fieldset>
          {!data.aiConfigured&&<p className="coach-note"><Sparkles size={14}/>{tr?'Bu platformda AI yapılandırılmadı. Yanıtlarınızdan kural tabanlı bir başlangıç taslağı hazırlanır; her satırı düzenleyebilirsiniz.':'AI isn’t configured on this platform. A rule-based starter is prepared from your answers; you can edit every line.'}</p>}
          <footer className="compass-actions"><button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>pending?openReview(pending):brief?setView('brief'):close()}>{pending||brief?(tr?'Vazgeç':'Cancel'):(tr?'Sonra':'Later')}</button>
            <div className="coach-footer-buttons">{data.aiConfigured&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>{const form=dialog.current?.querySelector('form');if(form?.reportValidity())void diagnose('template');}}>{busy==='template'?(tr?'Hazırlanıyor…':'Preparing…'):(tr?'Başlangıç şablonunu kullan':'Use the starter template')}</button>}
              <button className="studio-primary" disabled={Boolean(busy)}>{busy?(tr?'Taslak hazırlanıyor…':'Preparing the draft…'):data.aiConfigured?(tr?'AI ile taslak hazırla':'Prepare with AI'):(tr?'Başlangıç briefini hazırla':'Prepare the starter brief')}<ArrowRight size={16}/></button></div></footer>
        </form>}
        {data&&view==='review'&&edit&&<form className="coach-review" onSubmit={event=>{event.preventDefault();void saveBrief(data.canApprove?'approve':'save');}}>
          {brief&&(()=>{try{const lines=briefChangeLines(diffBriefs(brief,fromEdit(edit)),tr);return <div className="coach-changes" role="status"><strong>{tr?'Onaylı brief ile karşılaştırma':'Compared with the approved brief'}</strong><ul>{lines.map((line,index)=><li key={index}>{line}</li>)}</ul></div>;}catch{return null;}})()}
          <p className="coach-note"><Sparkles size={14}/>{data.draftSource==='ai'?(tr?'Bu bir AI önerisidir. Onaylamadan önce her satırı kontrol edin; müşterilerinizi sizden iyi bilmez.':'This is an AI suggestion. Check every line before approving; it doesn’t know your customers better than you do.'):(tr?'Yanıtlarınızdan kural tabanlı bir başlangıç. İşinize uyacak şekilde düzenleyin.':'A rule-based starter from your answers. Edit it to fit your business.')}</p>
          <fieldset disabled={Boolean(busy)}>
            <h3>{briefLabel('icp')}</h3>
            <label className="coach-field"><span>{tr?'Özet':'Summary'}</span><textarea required maxLength={800} rows={3} value={edit.icp.summary} onChange={event=>setEdit({...edit,icp:{...edit.icp,summary:event.target.value}})}/></label>
            <label className="coach-field"><span>{briefLabel('pains')}</span><small>{tr?'Her satıra bir madde, en fazla 5.':'One item per line, up to 5.'}</small><textarea required rows={3} value={edit.icp.pains} onChange={event=>setEdit({...edit,icp:{...edit.icp,pains:event.target.value}})}/></label>
            <h3>{briefLabel('positioning')}</h3>
            <label className="coach-field"><span className="sr-only">{briefLabel('positioning')}</span><textarea required maxLength={500} rows={2} value={edit.positioning} onChange={event=>setEdit({...edit,positioning:event.target.value})}/></label>
            <h3>{briefLabel('channels')}</h3>
            {edit.channels.map((channel,index)=><div key={index} className="coach-channel-row"><label className="coach-field"><span>{tr?'Kanal':'Channel'}</span><select value={channel.id} onChange={event=>setEdit({...edit,channels:edit.channels.map((item,i)=>i===index?{...item,id:event.target.value as CoachChannel}:item)})}>{COACH_CHANNELS.map(id=><option key={id} value={id} disabled={id!==channel.id&&edit.channels.some(item=>item.id===id)}>{channelNames[id][idx]}</option>)}</select></label><label className="coach-field"><span>{tr?'Gerekçe':'Rationale'}</span><textarea required maxLength={500} rows={3} value={channel.rationale} onChange={event=>setEdit({...edit,channels:edit.channels.map((item,i)=>i===index?{...item,rationale:event.target.value}:item)})}/></label><button type="button" className="icon-button" disabled={edit.channels.length<=1} aria-label={tr?'Kanalı kaldır':'Remove channel'} title={tr?'Kanalı kaldır':'Remove channel'} onClick={()=>setEdit({...edit,channels:edit.channels.filter((_,i)=>i!==index)})}><Trash2 size={16}/></button></div>)}
            {edit.channels.length<3&&<button type="button" className="studio-text-button" onClick={()=>{const id=COACH_CHANNELS.find(item=>!edit.channels.some(channel=>channel.id===item))!;setEdit({...edit,channels:[...edit.channels,{id,rationale:''}]});}}><Plus size={14}/>{tr?'Kanal ekle':'Add a channel'}</button>}
            <h3>{briefLabel('plan')}</h3>
            {[1,2,3,4].map(week=><section key={week} className="coach-plan-week"><h4>{tr?`${week}. hafta`:`Week ${week}`}</h4>
              {edit.plan.map((item,index)=>item.week!==week?null:<div key={index} className="coach-plan-item">
                <label className="coach-field coach-span"><span>{tr?'Eylem':'Action'}</span><input required maxLength={140} value={item.title} onChange={event=>updatePlan(index,{title:event.target.value})}/></label>
                <label className="coach-field coach-span"><span>{tr?'Neden':'Why'}</span><textarea required maxLength={400} rows={3} value={item.why} onChange={event=>updatePlan(index,{why:event.target.value})}/></label>
                <label className="coach-field coach-span"><span>{tr?'Nasıl':'How'}</span><textarea required maxLength={700} rows={3} value={item.how} onChange={event=>updatePlan(index,{how:event.target.value})}/></label>
                <label className="coach-field"><span>{tr?'Araç':'Tool'}</span><select value={item.tool} onChange={event=>updatePlan(index,{tool:event.target.value as CoachTool})}>{COACH_TOOLS.map(tool=><option key={tool} value={tool}>{toolNames[tool][idx]}</option>)}</select></label>
                <label className="coach-field"><span>{tr?'Kanal':'Channel'}</span><select value={item.channel||''} onChange={event=>updatePlan(index,{channel:(event.target.value||null) as CoachChannel|null})}><option value="">{tr?'Kanal yok':'No channel'}</option>{COACH_CHANNELS.map(id=><option key={id} value={id}>{channelNames[id][idx]}</option>)}</select></label>
                <label className="coach-field"><span>{tr?'Hafta':'Week'}</span><select value={item.week} onChange={event=>updatePlan(index,{week:Number(event.target.value)})}>{[1,2,3,4].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
                <label className="coach-field"><span>{tr?'Süre tahmini (dk)':'Time estimate (min)'}</span><input type="number" required min={5} max={480} step={5} value={item.minutes} onChange={event=>updatePlan(index,{minutes:Math.round(Number(event.target.value))})}/></label>
                <button type="button" className="studio-text-button coach-remove" disabled={edit.plan.length<=1} onClick={()=>setEdit({...edit,plan:edit.plan.filter((_,i)=>i!==index)})}><Trash2 size={14}/>{tr?'Eylemi kaldır':'Remove action'}</button>
              </div>)}
              {edit.plan.length<16&&<button type="button" className="studio-text-button" onClick={()=>setEdit({...edit,plan:[...edit.plan,{week,title:'',why:'',how:'',minutes:30,tool:'library',channel:edit.channels[0]?.id||null}]})}><Plus size={14}/>{tr?'Bu haftaya eylem ekle':'Add an action to this week'}</button>}
            </section>)}
          </fieldset>
          {!data.canApprove&&<p className="coach-note"><ShieldCheck size={14}/>{tr?'Briefi onay yetkisi olan bir ekip üyesi (sahip veya yönetici) onaylar. Taslağı kaydedebilirsiniz.':'A teammate with approval rights (owner or admin) approves the brief. You can save the draft.'}</p>}
          <footer className="compass-actions"><button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={openQuestions}><ChevronLeft size={15}/>{tr?'Yanıtlara dön':'Back to answers'}</button>
            <div className="coach-footer-buttons">{data.canWrite&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>{const form=dialog.current?.querySelector('form');if(form?.reportValidity())void saveBrief('save');}}>{busy==='save'?(tr?'Kaydediliyor…':'Saving…'):(tr?'Taslağı kaydet':'Save draft')}</button>}
              {data.canApprove&&<button className="studio-primary" disabled={Boolean(busy)}><Check size={16}/>{busy==='approve'?(tr?'Onaylanıyor…':'Approving…'):(tr?'Briefi onayla':'Approve the brief')}</button>}</div></footer>
        </form>}
        {data&&view==='brief'&&brief&&<div className="coach-brief-view">
          {data.previousBrief&&<div className="coach-changes"><strong>{tr?`Önceki sürüme göre değişenler (${data.versions} sürüm)`:`Changes since the previous version (${data.versions} versions)`}</strong><ul>{briefChangeLines(diffBriefs(data.previousBrief,brief),tr).map((line,index)=><li key={index}>{line}</li>)}</ul></div>}
          {data.approvedAt&&<p className="compass-intro">{tr?`Onay tarihi: ${date(data.approvedAt)}. AI içerik taslakları bu briefi ürün bağlamı olarak kullanır.`:`Approved on ${date(data.approvedAt)}. AI content drafts use this brief as product context.`}</p>}
          <section><h3>{briefLabel('icp')}</h3><p>{brief.icp.summary}</p><ul>{brief.icp.pains.map((item,index)=><li key={index}>{item}</li>)}</ul></section>
          <section><h3>{briefLabel('positioning')}</h3><p>{brief.positioning}</p></section>
          <section><h3>{briefLabel('channels')}</h3><ul className="coach-channel-list">{brief.channels.map(item=><li key={item.id}><strong>{channelNames[item.id][idx]}</strong><span>{item.rationale}</span></li>)}</ul></section>
          <section><h3>{briefLabel('plan')}</h3>{[1,2,3,4].map(week=>{const items=brief.plan.filter(item=>item.week===week);return items.length?<div key={week} className="coach-plan-week"><h4>{tr?`${week}. hafta`:`Week ${week}`}</h4><ul>{items.map((item,index)=><li key={index}><strong>{item.title}</strong><span>{toolNames[item.tool][idx]} · {minutes(item.minutes)}</span></li>)}</ul></div>:null;})}</section>
          <footer className="compass-actions"><span className="compass-safety"><ShieldCheck size={15}/>{tr?'Brief öneridir; yayın veya gönderim başlatmaz.':'The brief is guidance; it starts no publication or sending.'}</span>
            {data.canWrite&&<div className="coach-footer-buttons"><button type="button" className="studio-text-button" onClick={openQuestions}>{tr?'Yeni teşhis':'New diagnosis'}</button><button type="button" className="studio-secondary" onClick={()=>openReview(pending||brief)}>{tr?'Briefi düzenle':'Edit the brief'}</button></div>}</footer>
        </div>}
      </div>
    </dialog>
  </section>;
}
