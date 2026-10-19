'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Pencil, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { COACH_PREFILL_KEY, SEO_INTENTS, type CoachSeoBrief, type CoachSeoSnapshot, type CoachSeoTopic, type SeoIntent } from '@/lib/platform/coach-types';
import Msg from '@/components/Msg';

type Edit={topicId:string;revision:number;title:string;targetKeyword:string;intent:SeoIntent;outline:string;questions:string;links:string;notes:string};
const intents:Record<SeoIntent,[string,string]>={informational:['Bilgi arayışı','Informational'],commercial:['Karşılaştırma','Commercial'],transactional:['Satın alma / eylem','Transactional'],navigational:['Marka / gezinme','Navigational']};
const lines=(value:string)=>value.split('\n').map(item=>item.trim()).filter(Boolean);
const toEdit=(topic:CoachSeoTopic,brief:CoachSeoBrief):Edit=>({topicId:topic.id,revision:topic.revision,title:brief.title,targetKeyword:brief.targetKeyword,intent:brief.intent,outline:brief.outline.join('\n'),questions:brief.questions.join('\n'),links:brief.internalLinks.map(item=>`${item.anchor} | ${item.target}`).join('\n'),notes:brief.notes});

export default function CoachSeo({lang}:{lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [data,setData]=useState<CoachSeoSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[edit,setEdit]=useState<Edit|null>(null);
  const request=useRef<AbortController|null>(null);
  const load=useCallback(()=>{request.current?.abort();const controller=new AbortController();request.current=controller;setError('');
    projectRequest<CoachSeoSnapshot>('/api/platform/coach/seo',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);});},[]);
  useEffect(()=>{load();return()=>request.current?.abort();},[load]);
  const run=async(key:string,body:object,message?:string)=>{if(busy)return false;setBusy(key);setError('');setNotice('');try{setData(await projectRequest<CoachSeoSnapshot>('/api/platform/coach/seo',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(55000)}));if(message)setNotice(message);return true;}catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));return false;}finally{setBusy('');}};
  const suggest=(mode:'ai'|'template')=>{if(data?.topics.some(topic=>!topic.brief)&&!window.confirm(tr?'Briefi olmayan konular yenileriyle değiştirilsin mi? Brief hazırlanmış konular korunur.':'Replace topics without a brief? Topics with a brief are kept.'))return;void run('topics',{action:'topics',mode},tr?'Konular hazır. Arama verisi yalnız Search Console satırlarından gösterilir.':'Topics are ready. Search numbers are shown only from Search Console rows.');};
  const save=async(event:FormEvent)=>{event.preventDefault();if(!edit)return;
    const brief={title:edit.title,targetKeyword:edit.targetKeyword,intent:edit.intent,outline:lines(edit.outline),questions:lines(edit.questions),internalLinks:lines(edit.links).map(item=>{const [anchor,...target]=item.split('|');return {anchor:anchor.trim(),target:(target.join('|')||anchor).trim()};}),notes:edit.notes};
    if(await run('save',{action:'save',topicId:edit.topicId,expectedRevision:edit.revision,brief},tr?'Brief kaydedildi; kullanmadan önce onaylayın.':'Brief saved; approve it before use.'))setEdit(null);};
  const handoff=(topic:CoachSeoTopic)=>{if(!topic.prefill)return;try{sessionStorage.setItem(COACH_PREFILL_KEY,JSON.stringify({...topic.prefill,tab:'library',at:Date.now()}));}catch{/* The studio still opens without a pre-filled brief. */}};
  const day=(value:string)=>new Date(`${value}T12:00:00Z`).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:'UTC'});
  const number=(value:number|null)=>value===null?'—':value.toLocaleString(locale);
  const gsc=data?.searchConsole;

  return <section className="coach-seo">
    <header className="studio-section-title"><h2><Search size={17}/>{tr?'Konular ve içerik briefleri':'Topics & content briefs'}</h2>
      {data?.hasBrief&&data.canWrite&&<div className="coach-footer-buttons">{data.aiConfigured&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>suggest('template')}>{tr?'Başlangıç şablonu':'Starter template'}</button>}<button type="button" className="studio-primary" disabled={Boolean(busy)} onClick={()=>suggest(data.aiConfigured?'ai':'template')}><Sparkles size={15}/>{busy==='topics'?(tr?'Hazırlanıyor…':'Preparing…'):(tr?'Konu öner':'Suggest topics')}</button></div>}
    </header>
    {error&&<div className="studio-error" role="alert"><Msg text={error}/><button type="button" className="icon-button" title={tr?'Yeniden dene':'Retry'} aria-label={tr?'Yeniden dene':'Retry'} onClick={load}><RefreshCw size={16}/></button></div>}
    {notice&&<p className="studio-success" role="status"><Msg text={notice}/></p>}
    {!data&&!error&&<p className="studio-skeleton" role="status">{tr?'SEO konuları yükleniyor…':'Loading SEO topics…'}</p>}
    {gsc&&<p className={`coach-source coach-source-${gsc.state}`} role="status">
      {gsc.state==='not_connected'?<>{tr?'Search Console bağlı değil, bu yüzden arama verisi yok. Konular doğrulanacak önerilerdir; arama hacmi, zorluk veya sıralama gösterilmez.':'Search Console isn’t connected, so there is no search data. Topics are suggestions to validate; no search volume, difficulty or ranking is shown.'} <a href="/?tab=project&settings=connections&guideProvider=search_console">{tr?'Search Console’u bağla':'Connect Search Console'}</a></>
      :gsc.state==='restricted'?(tr?'Search Console verisi yalnız bağlantıları yöneten ekip üyelerine açıktır. Konularınız ürün profilinizden ve briefinizden hazırlanır; arama hacmi, zorluk veya sıralama gösterilmez.':'Search Console data is available only to teammates who manage connections. Your topics are prepared from the product profile and brief; no search volume, difficulty or ranking is shown.')
      :gsc.state==='not_fetched'?(tr?'Search Console bağlı; sorgular konu önerirken okunur.':'Search Console is connected; queries are read when you suggest topics.')
      :gsc.state==='ready'?(tr?`Search Console · ${day(gsc.from!)}–${day(gsc.to!)} · ${gsc.queries} sorgu. Rakamlar Search Console’un bildirdiği gibidir.`:`Search Console · ${day(gsc.from!)}–${day(gsc.to!)} · ${gsc.queries} queries. Numbers are as reported by Search Console.`)
      :gsc.state==='no_data'?(tr?`Search Console ${day(gsc.from!)}–${day(gsc.to!)} için sorgu döndürmedi. Veri yok, sıfır demek değildir.`:`Search Console returned no queries for ${day(gsc.from!)}–${day(gsc.to!)}. No data is not zero.`)
      :(tr?'Search Console şu anda okunamadı; konular yalnız briefinizden hazırlandı.':'Search Console couldn’t be read right now; topics use your brief only.')}
      {gsc.canRefresh&&<> <button type="button" className="studio-text-button coach-inline-button" disabled={Boolean(busy)} onClick={()=>void run('refresh',{action:'refresh'},tr?'Search Console verisi yenilendi.':'Search Console data refreshed.')}><RefreshCw size={13}/>{busy==='refresh'?(tr?'Yenileniyor…':'Refreshing…'):(tr?'Veriyi yenile':'Refresh data')}</button></>}
    </p>}
    {data&&!data.hasBrief&&<div className="studio-empty"><Sparkles size={24}/><p>{tr?'SEO konuları onaylı strateji briefinden hazırlanır. Önce genel bakıştaki büyüme koçunda briefi onaylayın.':'SEO topics are prepared from an approved strategy brief. Approve a brief in the growth coach on the overview first.'}</p><a className="studio-text-button" href="/?tab=dashboard">{tr?'Büyüme koçuna git':'Go to the growth coach'}<ArrowRight size={14}/></a></div>}
    {data?.hasBrief&&data.topics.length===0&&<div className="studio-empty"><p>{tr?'Henüz konu yok. Ürün profilinizden ve briefinizden konu önerebilirsiniz.':'No topics yet. You can suggest topics from your product profile and brief.'}</p></div>}
    {data?.hasBrief&&data.topics.length>0&&<ol className="coach-seo-topics">{data.topics.map(topic=><li key={topic.id} className="coach-content-item">
      <div className="coach-action-meta"><span className="studio-badge">{tr?'Tahmini niyet: ':'Estimated intent: '}{intents[topic.intent][idx]}</span><span>{topic.source==='ai'?(tr?'AI önerisi':'AI suggestion'):(tr?'Başlangıç şablonu':'Starter template')}</span></div>
      <h4>{topic.cluster}</h4>
      <div className="studio-table-scroll"><table className="coach-keywords"><thead><tr><th>{tr?'İfade':'Phrase'}</th><th>{tr?'Kaynak':'Source'}</th><th>{tr?'Tıklama':'Clicks'}</th><th>{tr?'Gösterim':'Impressions'}</th><th>{tr?'Ort. konum':'Avg. position'}</th></tr></thead>
        <tbody>{topic.keywords.map(keyword=><tr key={keyword.phrase}><td>{keyword.phrase}</td><td><span className={`coach-state ${keyword.source==='search_console'?'done':''}`}>{keyword.source==='search_console'?'Search Console':(tr?'Öneri · veri yok':'Suggestion · no data')}</span></td><td data-label={tr?'Tıklama':'Clicks'}>{number(keyword.clicks)}</td><td data-label={tr?'Gösterim':'Impressions'}>{number(keyword.impressions)}</td><td data-label={tr?'Ort. konum':'Avg. position'}>{number(keyword.position)}</td></tr>)}</tbody></table></div>
      {edit?.topicId===topic.id?<form className="studio-form-grid coach-content-form" onSubmit={event=>void save(event)}>
        <label className="studio-form-full">{tr?'Başlık':'Title'}<input required maxLength={140} value={edit.title} onChange={event=>setEdit({...edit,title:event.target.value})}/></label>
        <label>{tr?'Hedef anahtar kelime':'Target keyword'}<input required maxLength={120} value={edit.targetKeyword} onChange={event=>setEdit({...edit,targetKeyword:event.target.value})}/></label>
        <label>{tr?'Arama niyeti':'Search intent'}<select value={edit.intent} onChange={event=>setEdit({...edit,intent:event.target.value as SeoIntent})}>{SEO_INTENTS.map(value=><option key={value} value={value}>{intents[value][idx]}</option>)}</select></label>
        <label className="studio-form-full">{tr?'Taslak yapı (her satıra bir başlık)':'Outline (one heading per line)'}<textarea required rows={5} value={edit.outline} onChange={event=>setEdit({...edit,outline:event.target.value})}/></label>
        <label className="studio-form-full">{tr?'Yanıtlanacak sorular (her satıra bir soru)':'Questions to answer (one per line)'}<textarea rows={3} value={edit.questions} onChange={event=>setEdit({...edit,questions:event.target.value})}/></label>
        <label className="studio-form-full">{tr?'İç bağlantılar (bağlantı metni | hedef)':'Internal links (anchor | target)'}<textarea rows={3} value={edit.links} onChange={event=>setEdit({...edit,links:event.target.value})}/></label>
        <label className="studio-form-full">{tr?'Notlar':'Notes'}<textarea maxLength={600} rows={2} value={edit.notes} onChange={event=>setEdit({...edit,notes:event.target.value})}/></label>
        <div className="studio-form-full coach-footer-buttons"><button type="button" className="studio-text-button" onClick={()=>setEdit(null)}><X size={14}/>{tr?'Vazgeç':'Cancel'}</button><button className="studio-primary" disabled={Boolean(busy)}>{busy==='save'?(tr?'Kaydediliyor…':'Saving…'):(tr?'Kaydet':'Save')}</button></div>
      </form>:topic.brief?<div className="coach-seo-brief">
        <div className="coach-action-meta"><span className={`coach-state ${topic.briefState==='approved'?'done':''}`}>{topic.briefState==='approved'?(tr?'Onaylı brief':'Approved brief'):(tr?'Brief taslağı':'Brief draft')}</span><span>{topic.briefSource==='ai'?(tr?'AI önerisi':'AI suggestion'):topic.briefSource==='human'?(tr?'Ekip düzenledi':'Edited by the team'):(tr?'Başlangıç şablonu':'Starter template')}</span></div>
        <h5>{topic.brief.title}</h5>
        <p><strong>{tr?'Hedef anahtar kelime: ':'Target keyword: '}</strong>{topic.brief.targetKeyword} · {intents[topic.brief.intent][idx]}</p>
        <details open={topic.briefState!=='approved'}><summary>{tr?'Taslak yapı, sorular ve bağlantılar':'Outline, questions and links'}</summary>
          <ol>{topic.brief.outline.map((item,index)=><li key={index}>{item}</li>)}</ol>
          {topic.brief.questions.length>0&&<><p><strong>{tr?'Yanıtlanacak sorular':'Questions to answer'}</strong></p><ul>{topic.brief.questions.map((item,index)=><li key={index}>{item}</li>)}</ul></>}
          {topic.brief.internalLinks.length>0&&<><p><strong>{tr?'İç bağlantı önerileri':'Internal link ideas'}</strong></p><ul>{topic.brief.internalLinks.map((item,index)=><li key={index}>{item.anchor} → {item.target}</li>)}</ul></>}
          {topic.brief.notes&&<p className="coach-muted">{topic.brief.notes}</p>}
        </details>
      </div>:null}
      {data.canWrite&&edit?.topicId!==topic.id&&<div className="coach-action-buttons">
        {topic.briefState==='approved'?<a className="studio-secondary" href="/?tab=library" onClick={()=>handoff(topic)}>{tr?'Blog taslağı oluştur':'Create a blog draft'}<ArrowRight size={15}/></a>
          :topic.brief?<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void run(topic.id,{action:'approve',topicId:topic.id,expectedRevision:topic.revision},tr?'Brief onaylandı; blog taslağına dönüştürebilirsiniz.':'Brief approved; you can turn it into a blog draft.')}><Check size={15}/>{tr?'Briefi onayla':'Approve the brief'}</button>
          :<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void run(topic.id,{action:'brief',topicId:topic.id,mode:data.aiConfigured?'ai':'template'})}><Sparkles size={15}/>{busy===topic.id?(tr?'Hazırlanıyor…':'Preparing…'):(tr?'İçerik briefi hazırla':'Prepare a content brief')}</button>}
        {topic.brief&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>setEdit(toEdit(topic,topic.brief!))}><Pencil size={14}/>{tr?'Briefi düzenle':'Edit the brief'}</button>}
        <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>{if(window.confirm(tr?'Bu konu kaldırılsın mı?':'Remove this topic?'))void run(topic.id,{action:'remove',topicId:topic.id});}}><Trash2 size={14}/>{tr?'Kaldır':'Remove'}</button>
      </div>}
    </li>)}</ol>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Arama hacmi, zorluk ve sıralama tahmin edilmez; rakamlar yalnız bağlı Search Console’dan gelir. Hiçbir içerik otomatik yayınlanmaz.':'Search volume, difficulty and rankings are never estimated; numbers come only from a connected Search Console. Nothing is published automatically.'}</p>
  </section>;
}
