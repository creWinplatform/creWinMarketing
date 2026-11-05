'use client';
import { useState,type FormEvent,type ReactNode } from 'react';
import { Plus,RefreshCw,Save,Trash2,Check,Send,Download,Pencil,Sparkles } from 'lucide-react';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/platform/catalog';
import type { MobileApp,MobileListingDraft,MobileWorkspace } from '@/lib/platform/mobile-types';

type Props={lang:Locale;data:MobileWorkspace;app:MobileApp;busy:boolean;run:(action:()=>Promise<unknown>,text?:string)=>Promise<void>;post:<T,>(input:Record<string,unknown>)=>Promise<T>};
const IOS_FIELDS=[['name',30],['subtitle',30],['keywords',100],['promotionalText',170],['description',4000],['whatsNew',4000]] as const;
const ANDROID_FIELDS=[['title',30],['shortDescription',80],['fullDescription',4000]] as const;
const LONG=new Set(['promotionalText','description','whatsNew','fullDescription']);
const length=(value='')=>[...value].length;
function Table({label,heads,children}:{label:string;heads:string[];children:ReactNode}){return <div className="studio-table-scroll" role="region" aria-label={label} tabIndex={0}><table className="studio-table"><thead><tr>{heads.map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}

// App Store search positions for the terms the team tracks.
export function MobileKeywords({lang,data,app,busy,run,post}:Props){
  const tr=lang==='tr',t=(a:string,b:string)=>tr?a:b,[term,setTerm]=useState(''),[country,setCountry]=useState(app.country),[rival,setRival]=useState('');
  const tracked=new Set(data.competitors.map(item=>item.id)),suggested=[...new Map(data.keywords.flatMap(item=>item.leaders).filter(item=>item.id&&item.id!==app.appleId&&!tracked.has(item.id)).map(item=>[item.id,item])).values()].slice(0,8);
  const addRival=(appleId:string)=>void run(async()=>{await post({action:'addCompetitor',appId:app.id,appleId});setRival('');},t('Rakip eklendi; sırası bir sonraki kontrolde görünür.','Competitor added; its positions appear after the next check.'));
  const add=(event:FormEvent)=>{event.preventDefault();void run(async()=>{await post({action:'addKeyword',appId:app.id,term,country});setTerm('');},t('Anahtar kelime eklendi; ilk sıra bir sonraki kontrolde görünür.','Keyword added; its first position appears after the next check.'));};
  const change=(rank:number|null,previous:number|null)=>{
    if(rank===null||previous===null)return <span className="mobile-rank-flat">—</span>;const diff=previous-rank;
    return diff>0?<span className="mobile-rank-up" aria-label={t(`${diff} sıra yükseldi`,`up ${diff}`)}>▲ {diff}</span>:diff<0?<span className="mobile-rank-down" aria-label={t(`${-diff} sıra düştü`,`down ${-diff}`)}>▼ {-diff}</span>:<span className="mobile-rank-flat">=</span>;
  };
  return <><section className="studio-band">
    <div className="studio-section-title"><h2>{t('Anahtar kelime sırası · App Store','Keyword positions · App Store')}</h2><span className="studio-badge">{data.keywords.length} / 30</span></div>
    <p className="studio-subtitle">{t('Apple’ın herkese açık arama API’sinde, seçilen ülkedeki ilk 200 uygulama sonucu içindeki sıra. App Store uygulamasındaki kişiselleştirilmiş sıradan farklı olabilir ve reklamları içermez. Her terim günde bir kez kontrol edilir.','The position among the first 200 app results of Apple’s public search API in the chosen country. It can differ from the personalised order in the App Store app and excludes ads. Each term is checked once a day.')}</p>
    {!app.appleId?<p className="studio-data-notice">{t('Sıra takibi için uygulamaya App Store kimliğini ekleyin.','Add the App Store ID to the app to track positions.')}</p>:data.canWrite&&<form className="mobile-inline-form" onSubmit={add}>
      <label>{t('Anahtar kelime','Keyword')}<input required maxLength={100} value={term} onChange={event=>setTerm(event.target.value)}/></label>
      <label className="mobile-country">{t('Ülke','Country')}<input required maxLength={2} value={country} onChange={event=>setCountry(event.target.value.toUpperCase())}/></label>
      <div className="mobile-actions"><button className="studio-primary" disabled={busy||data.keywords.length>=30}><Plus size={16}/>{t('Ekle','Add')}</button><button type="button" className="studio-secondary" disabled={busy||!data.keywords.length} onClick={()=>void run(()=>post({action:'checkRanks',appId:app.id}),t('Bugün kontrol edilmemiş terimler kontrol edildi (en çok 10).','Terms not checked today were checked (up to 10).'))}><RefreshCw size={16}/>{t('Şimdi kontrol et','Check now')}</button></div>
    </form>}
    {data.keywords.length?<Table label={t('Anahtar kelime sıraları','Keyword positions')} heads={[t('Terim','Term'),t('Ülke','Country'),t('Sıra','Position'),t('Değişim','Change'),...(data.competitors.length?[t('Rakipler','Competitors')]:[]),t('İlk üç','Top three'),t('Son 7 gün','Last 7 days'),'']}>{data.keywords.map(item=><tr key={item.id}>
      <td>{item.term}</td><td>{item.country}</td>
      <td>{item.checkedOn===null?<small>{t('Bekliyor','Waiting')}</small>:item.rank===null?<small>{item.resultCount===null?t('Okunamadı','Not read'):t('İlk 200’de yok','Not in top 200')}</small>:<strong>{item.rank}</strong>}</td>
      <td>{change(item.rank,item.previousRank)}</td>
      {data.competitors.length>0&&<td><small>{item.competitors.length?item.competitors.map(rival=>`${rival.name} ${rival.rank===null?'—':`#${rival.rank}`}`).join(' · '):'—'}</small></td>}
      <td><small>{item.leaders.map(leader=>leader.name).join(' · ')||'—'}</small></td>
      <td><small>{item.history.slice(-7).map(point=>point.rank??'–').join(' · ')||'—'}</small></td>
      <td>{data.canWrite&&<button className="studio-text-button" aria-label={`${t('Takipten çıkar','Stop tracking')}: ${item.term}`} disabled={busy} onClick={()=>void run(()=>post({action:'removeKeyword',appId:app.id,id:item.id}))}><Trash2 size={15}/></button>}</td>
    </tr>)}</Table>:<p className="studio-empty">{t('Henüz takip edilen anahtar kelime yok.','No tracked keywords yet.')}</p>}
    {app.appleId&&<div className="mobile-competitors">
      <h3>{t('Rakip uygulamalar','Competitor apps')} <small>{data.competitors.length} / 5</small></h3>
      {data.competitors.length>0&&<ul>{data.competitors.map(item=><li key={item.id}><span>{item.name} <small>#{item.id}</small>{item.latest&&<small className="mobile-competitor-meta">{item.latest.rating!==null?`★${item.latest.rating}`:''}{item.latest.ratingCount!==null?` (${item.latest.ratingCount.toLocaleString(tr?'tr-TR':'en-GB')})`:''}{item.latest.version?` · v${item.latest.version}`:''}</small>}{item.changes.slice(0,3).map((change,index)=><small key={index} className="mobile-competitor-change">{change.day.slice(5)} · {change.kind==='version'?t(`sürüm ${change.from} → ${change.to}`,`version ${change.from} → ${change.to}`):change.kind==='name'?t(`ad “${change.from}” → “${change.to}”`,`name “${change.from}” → “${change.to}”`):t(`puan ${change.from} → ${change.to}`,`rating ${change.from} → ${change.to}`)}{change.notes?` · ${change.notes.slice(0,120)}`:''}</small>)}</span>{data.canWrite&&<button className="studio-text-button" aria-label={`${t('Takipten çıkar','Stop tracking')}: ${item.name}`} disabled={busy} onClick={()=>void run(()=>post({action:'removeCompetitor',appId:app.id,appleId:item.id}))}><Trash2 size={15}/></button>}</li>)}</ul>}
      {data.canWrite&&data.competitors.length<5&&<>
        {suggested.length>0&&<div className="mobile-actions"><small>{t('Aramalarda üstte çıkanlar:','Ranking above in searches:')}</small>{suggested.map(item=><button key={item.id} className="studio-secondary" disabled={busy} onClick={()=>addRival(item.id)}><Plus size={14}/>{item.name}</button>)}</div>}
        <form className="mobile-inline-form" onSubmit={event=>{event.preventDefault();addRival(rival.trim());}}><label>{t('App Store kimliğiyle ekle','Add by App Store ID')}<input inputMode="numeric" required pattern="[0-9]{5,15}" value={rival} onChange={event=>setRival(event.target.value)}/></label><div className="mobile-actions"><button className="studio-secondary" disabled={busy}><Plus size={16}/>{t('Rakip ekle','Add competitor')}</button></div></form>
      </>}
      <p className="studio-note">{t('Rakiplerin sırası, sizin terimleriniz kontrol edilirken aynı arama sonuçlarından okunur. Puanları, sürümleri ve adları günde bir kez Apple’ın herkese açık kaydından okunur; değişiklikler ekip uyarısına düşer.','Competitor positions are read from the same search results when your terms are checked. Their ratings, versions and names are read once a day from Apple’s public listing; changes become a team alert.')}</p>
    </div>}
    <p className="studio-data-notice">{t('Google Play’in herkese açık bir arama API’si yok; sıra takibi yalnız App Store için yapılır. Google Play arama terimleri için Play Console raporunu aşağıdan yükleyin.','Google Play has no public search API; positions are tracked for the App Store only. For Google Play search terms, upload the Play Console report below.')}</p>
  </section>
  {app.packageName&&app.platform!=='ios'&&<PlayTerms lang={lang} data={data} app={app} busy={busy} run={run} post={post}/>}</>;
}

// Google Play search terms from the team's Play Console export: visitors and installs per term, against the previous upload.
function PlayTerms({lang,data,app,busy,run,post}:Props){
  const tr=lang==='tr',t=(a:string,b:string)=>tr?a:b,[period,setPeriod]=useState({from:'',to:''}),[csv,setCsv]=useState(''),[name,setName]=useState(''),view=data.playTerms;
  const read=async(file:File)=>{const bytes=new Uint8Array(await file.arrayBuffer());const utf16=bytes[0]===0xff&&bytes[1]===0xfe;setCsv(new TextDecoder(utf16?'utf-16le':'utf-8').decode(bytes));setName(file.name);};
  const delta=(now:number|null,before:number|null)=>now===null||before===null?'':now>before?` ▲${now-before}`:now<before?` ▼${before-now}`:'';
  return <section className="studio-band">
    <div className="studio-section-title"><h2>{t('Google Play arama terimleri','Google Play search terms')}</h2>{view&&<span className="studio-badge">{view.from} → {view.to}</span>}</div>
    <p className="studio-subtitle">{t('Play Console → Mağaza performansı → arama terimleri tablosunu CSV olarak indirip buraya yükleyin. Her terim için mağaza sayfası ziyaretçisi ve yükleme görünür; önceki yüklemeyle karşılaştırılır. Google Play sıra bilgisi vermez.','In Play Console → Store performance, download the search terms table as CSV and upload it here. Store listing visitors and installs per term are shown and compared with the previous upload. Google Play gives no positions.')}</p>
    {data.canWrite&&<form className="mobile-inline-form" onSubmit={event=>{event.preventDefault();void run(async()=>{await post({action:'importPlayTerms',appId:app.id,from:period.from,to:period.to,csv});setCsv('');setName('');},t('Arama terimleri yüklendi.','Search terms uploaded.'));}}>
      <label>{t('Dönem başı','Period from')}<input type="date" required value={period.from} onChange={event=>setPeriod({...period,from:event.target.value})}/></label>
      <label>{t('Dönem sonu','Period to')}<input type="date" required value={period.to} onChange={event=>setPeriod({...period,to:event.target.value})}/></label>
      <label>{t('CSV dosyası','CSV file')}<input type="file" accept=".csv,text/csv" required onChange={event=>{const file=event.target.files?.[0];if(file)void read(file);}}/></label>
      <div className="mobile-actions"><button className="studio-primary" disabled={busy||!csv}>{t('Yükle','Upload')}</button>{name&&<small>{name}</small>}</div>
    </form>}
    {view?<Table label={t('Google Play arama terimleri','Google Play search terms')} heads={[t('Terim','Term'),t('Ziyaretçi','Visitors'),t('Yükleme','Installs'),t('Dönüşüm','Conversion')]}>{view.terms.map(row=><tr key={row.term}><td>{row.term}</td><td>{row.visitors??'—'}<small>{delta(row.visitors,row.previousVisitors)}</small></td><td>{row.installs??'—'}<small>{delta(row.installs,row.previousInstalls)}</small></td><td>{row.conversion===null?'—':`${(row.conversion*100).toFixed(1)}%`}</td></tr>)}</Table>:<p className="studio-empty">{t('Henüz Play Console raporu yüklenmedi.','No Play Console report uploaded yet.')}</p>}
    {view?.previous&&<p className="studio-note">{t(`Değişim, ${view.previous.from} → ${view.previous.to} dönemine göre.`,`Change against ${view.previous.from} → ${view.previous.to}.`)}</p>}
  </section>;
}

const checkText=(code:string,evidence:string,t:(a:string,b:string)=>string)=>({
  'aso.keyword_repeats_title':t(`Ad veya alt başlıkta zaten geçen kelimeler anahtar kelime alanında tekrar ediyor: ${evidence}. Apple bunları zaten sayar; alanı başka kelimelere ayırın.`,`Words already in the name or subtitle repeat in the keyword field: ${evidence}. Apple already counts them; use the space for other words.`),
  'aso.keyword_space':t(`Anahtar kelime alanında ${evidence} karakter boş (sınır 100).`,`${evidence} characters of the keyword field are unused (limit 100).`),
  'aso.description_short':t(`Tam açıklama ${evidence} karakter; Google Play aramasında açıklama da okunur.`,`The full description is ${evidence} characters; Google Play search also reads it.`),
  'aso.short_repeats_title':t('Kısa açıklama yalnız başlıktaki kelimelerden oluşuyor.','The short description only repeats words from the title.'),
  'aso.title_short':t(`Ad ${evidence} karakter; 30 karaktere kadar ana anahtar kelimeyi de içerebilir.`,`The name is ${evidence} characters; up to 30 it can also carry the main keyword.`),
} as Record<string,string>)[code]||code;

// Store listing drafts: written by the team, approved on their exact text, then written to the store behind a switch.
export function MobileListings({lang,data,app,busy,run,post}:Props){
  const tr=lang==='tr',t=(a:string,b:string)=>tr?a:b;
  const stores=[...(app.appleId&&app.platform!=='android'?['ios' as const]:[]),...(app.packageName&&app.platform!=='ios'?['android' as const]:[])];
  const [store,setStore]=useState<'ios'|'android'>(stores[0]||'ios'),[locale,setLocale]=useState(app.locale),[fields,setFields]=useState<Record<string,string>>({}),[editing,setEditing]=useState<{id:string;revision:number}|null>(null),[ack,setAck]=useState<Record<string,boolean>>({});
  const label=(key:string)=>({name:t('Ad','Name'),subtitle:t('Alt başlık','Subtitle'),keywords:t('Anahtar kelimeler (virgülle)','Keywords (comma separated)'),promotionalText:t('Tanıtım metni','Promotional text'),description:t('Açıklama','Description'),whatsNew:t('Bu sürümdeki yenilikler','What’s new'),title:t('Başlık','Title'),shortDescription:t('Kısa açıklama','Short description'),fullDescription:t('Tam açıklama','Full description')} as Record<string,string>)[key]||key;
  const connected=data.integrations.some(item=>item.active&&item.provider===(store==='ios'?'app_store_connect':'google_play'));
  if(!stores.length)return null;
  const list=store==='ios'?IOS_FIELDS:ANDROID_FIELDS,reset=()=>{setFields({});setEditing(null);};
  const save=(event:FormEvent)=>{event.preventDefault();void run(async()=>{await post({action:'saveListing',appId:app.id,store,locale,fields,...(editing?{id:editing.id,expectedRevision:editing.revision}:{})});reset();},t('Taslak kaydedildi. Mağazaya yazmak için onay gerekir.','Draft saved. Writing it to the store needs approval.'));};
  const edit=(item:MobileListingDraft)=>{setStore(item.store);setLocale(item.locale);setFields(item.fields);setEditing({id:item.id,revision:item.revision});document.getElementById('mobile-listing-form')?.scrollIntoView({behavior:'smooth'});};
  const stateText=(item:MobileListingDraft)=>({draft:t('Taslak','Draft'),approved:t('Onaylı','Approved'),publishing:t('Yazılıyor','Writing'),published:t('Mağazaya yazıldı','Written to the store'),failed:t('Yazılamadı','Failed')})[item.state];
  return <>
    {data.canWrite&&<form id="mobile-listing-form" className="studio-band" onSubmit={save}>
      <div className="studio-section-title"><h2>{editing?t('Mağaza kaydı taslağını düzenle','Edit listing draft'):t('Mağaza kaydı taslağı','Listing draft')}</h2>{editing&&<button type="button" className="studio-text-button" onClick={reset}>{t('Vazgeç','Cancel')}</button>}</div>
      <p className="studio-subtitle">{t('Yalnız doldurduğunuz alanlar yazılır; boş alanlar mağazadaki metni değiştirmez. Taslak, metni aynen onaylandıktan sonra mağazaya yazılabilir.','Only the fields you fill in are written; empty fields leave the store text as it is. A draft can be written to the store after its exact text is approved.')}</p>
      <div className="studio-form-grid">
        <label>{t('Mağaza','Store')}<select value={store} disabled={Boolean(editing)} onChange={event=>{setStore(event.target.value as 'ios'|'android');setFields({});}}>{stores.map(item=><option key={item} value={item}>{item==='ios'?'App Store':'Google Play'}</option>)}</select></label>
        <label>{t('Dil','Language')}<input required maxLength={5} value={locale} onChange={event=>setLocale(event.target.value)}/></label>
      </div>
      <div className="mobile-actions"><button type="button" className="studio-secondary" disabled={busy||!connected} onClick={()=>void run(async()=>{const value=await post<{fields:Record<string,string>;locale:string;editable:boolean}>({action:'currentListing',appId:app.id,store,locale});setFields(value.fields);setLocale(value.locale);},t('Mağazadaki metin forma getirildi; kaydedilmedi.','The store’s text was loaded into the form; nothing was saved.'))}><Download size={16}/>{t('Mağazadaki metni getir','Load the store text')}</button><button type="button" className="studio-secondary" disabled={busy} onClick={()=>void run(async()=>{const value=await post<{fields:Record<string,string>}>({action:'suggestListing',appId:app.id,store,locale,current:fields});setFields({...fields,...value.fields});},t('AI önerisi forma yazıldı; kaydedilmedi. Gözden geçirip düzenleyin.','The AI proposal is in the form; nothing was saved. Review and edit it.'))}><Sparkles size={16}/>{t('AI ile öner','Suggest with AI')}</button>{!connected&&<small>{store==='ios'?t('App Store Connect bağlantısı gerekli (Entegrasyonlar).','Needs the App Store Connect connection (Integrations).'):t('Google Play bağlantısı gerekli (Entegrasyonlar).','Needs the Google Play connection (Integrations).')}</small>}</div>
      <div className="studio-form-grid mobile-listing-fields">{list.map(([key,limit])=><label key={key} className={LONG.has(key)?'studio-form-full':undefined}><span className="mobile-field-head"><span>{label(key)}</span><small className={length(fields[key])>limit?'mobile-over':undefined}>{length(fields[key])} / {limit}</small></span>
        {LONG.has(key)?<textarea rows={key==='promotionalText'?3:6} value={fields[key]||''} onChange={event=>setFields({...fields,[key]:event.target.value})}/>:<input value={fields[key]||''} onChange={event=>setFields({...fields,[key]:event.target.value})}/>}</label>)}</div>
      <div className="studio-form-actions"><button className="studio-primary" disabled={busy||list.some(([key,limit])=>length(fields[key])>limit)}><Save size={16}/>{editing?t('Taslağı güncelle','Update draft'):t('Taslağı kaydet','Save draft')}</button></div>
    </form>}
    <section className="studio-band">
      <div className="studio-section-title"><h2>{t('Mağaza kaydı taslakları','Listing drafts')}</h2><span className="studio-badge">{data.listings.length}</span></div>
      {!data.listings.length?<p className="studio-empty">{t('Henüz taslak yok.','No drafts yet.')}</p>:data.listings.map(item=><article className="mobile-listing" key={item.id}>
        <header><span className="studio-badge">{item.store==='ios'?'App Store':'Google Play'} · {item.locale}</span><span className={`studio-badge mobile-state-${item.state}`}>{stateText(item)}</span><small>{new Date(item.updatedAt).toLocaleString(localeTag(lang))}</small></header>
        <dl>{Object.entries(item.fields).map(([key,value])=><div key={key}><dt>{label(key)} <small>{length(value)}</small></dt><dd>{value}</dd></div>)}</dl>
        {item.checks.length>0&&<ul className="mobile-listing-checks">{item.checks.map(check=><li key={check.code}>{checkText(check.code,check.evidence,t)}</li>)}</ul>}
        {item.lastError&&<p className="studio-error" role="alert">{translateMessage(item.lastError,lang)}</p>}
        <div className="mobile-actions">
          {data.canWrite&&['draft','approved','failed'].includes(item.state)&&<button className="studio-secondary" disabled={busy} onClick={()=>edit(item)}><Pencil size={15}/>{t('Düzenle','Edit')}</button>}
          {data.canApprove&&item.state==='draft'&&<button className="studio-secondary" disabled={busy} onClick={()=>void run(()=>post({action:'approveListing',appId:app.id,id:item.id,expectedRevision:item.revision}),t('Taslak onaylandı.','Draft approved.'))}><Check size={15}/>{t('Onayla','Approve')}</button>}
          {data.canManage&&item.approved&&<><label className="mobile-check"><input type="checkbox" checked={Boolean(ack[item.id])} onChange={event=>setAck({...ack,[item.id]:event.target.checked})}/>{item.store==='ios'?t('App Store Connect’teki düzenlenebilir sürümün metninin değişmesini onaylıyorum.','I approve changing the text of the editable version in App Store Connect.'):t('Google Play mağaza kaydının değişmesini onaylıyorum.','I approve changing the Google Play listing.')}</label>
            <button className="studio-primary" disabled={busy||!data.listingPublishEnabled||!ack[item.id]} onClick={()=>void run(()=>post({action:'publishListing',appId:app.id,id:item.id,acknowledged:true}),t('Mağaza kaydı güncellendi.','Listing updated.'))}><Send size={15}/>{t('Mağazaya yaz','Write to the store')}</button></>}
          {data.canWrite&&item.state!=='publishing'&&<button className="studio-text-button" disabled={busy} onClick={()=>void run(()=>post({action:'deleteListing',appId:app.id,id:item.id}))}><Trash2 size={15}/>{t('Sil','Delete')}</button>}
        </div>
      </article>)}
      {!data.listingPublishEnabled&&<p className="studio-data-notice">{t('Mağaza kaydına yazma bu sunucuda kapalı (PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED). Taslaklar hazırlanıp onaylanabilir.','Writing to store listings is off on this server (PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED). Drafts can still be prepared and approved.')}</p>}
      <p className="studio-data-notice">{t('App Store’da değişiklik sürümle birlikte incelemeye ayrıca gönderilir; tanıtım metni canlı sürümde de değişebilir. Google Play kayıt değişiklikleri Google incelemesinden geçebilir. Ryzevo sıra veya yükleme artışı vaat etmez.','On the App Store the change goes to review with the version, submitted separately; promotional text can also change on the live version. Google Play listing changes may go through Google’s review. Ryzevo promises no ranking or install gain.')}</p>
    </section>
  </>;
}

// SKAdNetwork totals read from AppsFlyer: aggregated by Apple, delayed and thresholded for privacy.
export function MobileSkan({lang,data,app,busy,run,post}:Props){
  const tr=lang==='tr',t=(a:string,b:string)=>tr?a:b,[from,setFrom]=useState(''),[to,setTo]=useState('');
  const connected=data.integrations.some(item=>item.active&&item.provider==='appsflyer_skan'),skan=data.skan;
  if(!app.appleId||app.platform==='android')return null;
  const money=(value:number|null)=>value===null?'—':value.toLocaleString(localeTag(lang),{maximumFractionDigits:2});
  return <section className="studio-band">
    <div className="studio-section-title"><h2>{t('SKAN · App Store (AppsFlyer)','SKAN · App Store (AppsFlyer)')}</h2>{skan&&<span className="studio-badge">{skan.from} → {skan.to}</span>}</div>
    <p className="studio-subtitle">{t('Apple SKAdNetwork’ün toplu bildirdiği yüklemeler. Kişi düzeyinde değildir, birkaç gün gecikir ve düşük hacimde gizlilik eşiği nedeniyle eksik görünebilir. Yukarıdaki yükleme sayılarıyla toplanmamalıdır.','Installs Apple SKAdNetwork reports in aggregate. Not per person, delayed by a few days and possibly incomplete at low volume because of privacy thresholds. Do not add them to the install counts above.')}</p>
    {!connected?<p className="studio-data-notice">{t('AppsFlyer SKAN bağlantısını Entegrasyonlar bölümünden kurun.','Set up the AppsFlyer SKAN connection under Integrations.')}</p>:data.canWrite&&<form className="mobile-inline-form" onSubmit={event=>{event.preventDefault();void run(()=>post({action:'syncSkan',appId:app.id,...(from?{from}:{}),...(to?{to}:{})}),t('SKAN raporu çekildi.','SKAN report pulled.'));}}>
      <label>{t('Başlangıç (yükleme günü)','From (install day)')}<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label>
      <label>{t('Bitiş','To')}<input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label>
      <div className="mobile-actions"><button className="studio-primary" disabled={busy}><RefreshCw size={16}/>{t('AppsFlyer’dan çek','Pull from AppsFlyer')}</button></div>
      <small>{t('Boş bırakılırsa 3 gün öncesine kadar son 30 gün çekilir; en çok 90 gün.','Left empty, the last 30 days up to 3 days ago are pulled; at most 90 days.')}</small>
    </form>}
    {skan?<>
      <div className="mobile-metrics">{[[t('SKAN yükleme','SKAN installs'),skan.installs.toLocaleString(localeTag(lang))],[`${t('Gelir','Revenue')} (${skan.currency})`,money(skan.revenue)],[`${t('Maliyet','Cost')} (${skan.currency})`,money(skan.cost)],['eCPI',skan.cost!==null&&skan.installs>0?money(Math.round(skan.cost/skan.installs*100)/100):'—']].map(([name,value])=><div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
      <Table label={t('SKAN kaynakları','SKAN sources')} heads={[t('Kaynak','Media source'),t('Kampanya','Campaign'),t('Yükleme','Installs'),t('Tıklama','Clicks'),t('Gelir','Revenue'),t('Maliyet','Cost'),'eCPI']}>{skan.rows.map((row,index)=><tr key={index}><td>{row.mediaSource}</td><td>{row.campaign||'—'}</td><td>{row.installs}</td><td>{row.clicks??'—'}</td><td>{money(row.revenue)}</td><td>{money(row.cost)}</td><td>{money(row.ecpi)}</td></tr>)}</Table>
      {skan.syncedAt&&<p className="studio-note">{t('Son çekim','Last pull')}: {new Date(skan.syncedAt).toLocaleString(localeTag(lang))}</p>}
    </>:connected&&<p className="studio-empty">{t('Henüz SKAN verisi çekilmedi.','No SKAN data pulled yet.')}</p>}
  </section>;
}
