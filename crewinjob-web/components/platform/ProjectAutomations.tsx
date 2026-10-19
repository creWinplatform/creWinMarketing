'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Pause, Pencil, Play, Plus, RefreshCw, Send, ShieldCheck, TestTube2, Workflow } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { AutomationsSnapshot, AutomationView } from '@/lib/platform/automation-types';
import Msg from '@/components/Msg';

type Form={id?:string;revision?:number;name:string;kind:'segment'|'event';segment:string;sourceId:string;eventName:string;waitDays:number;exitEvent:string;exitOnLeave:boolean;campaignId:string;capDays:number};
const empty:Form={name:'',kind:'segment',segment:'',sourceId:'',eventName:'',waitDays:3,exitEvent:'',exitOnLeave:true,campaignId:'',capDays:7};
const REASONS:Record<string,[string,string]>={goal_reached:['Hedefe ulaştı','Reached the goal'],left_segment:['Kitleden çıktı','Left the segment'],not_sendable:['E-posta gönderilemez (izin/engel)','Cannot be emailed (consent/suppression)'],frequency_cap:['Sıklık sınırı nedeniyle bekliyor','Waiting for the frequency cap'],pilot_limit:['Pilot listesinde değil veya sınır doldu','Not in the pilot list or limit reached']};

// Lifecycle automations: trigger → wait → checks → a person approves → the approved campaign goes out through the
// email pilot (same consent, suppression, allowlist and limits). The rule never sends on its own.
export default function ProjectAutomations({lang}:{lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [data,setData]=useState<AutomationsSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[form,setForm]=useState<Form|null>(null),[confirm,setConfirm]=useState<string|null>(null),[ack,setAck]=useState(false);
  const load=useCallback(()=>{projectRequest<AutomationsSnapshot>('/api/platform/automations').then(setData).catch(reason=>setError(reason.message));},[]);
  useEffect(()=>{load();},[load]);
  const post=async(key:string,body:object,message:(value:Record<string,unknown>)=>string)=>{if(busy)return false;setBusy(key);setError('');setNotice('');
    try{const value=await projectRequest<Record<string,unknown>>('/api/platform/automations',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(58000)});setData(('snapshot' in value?value.snapshot:value) as AutomationsSnapshot);setNotice(message(value));return true;}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));load();return false;}finally{setBusy('');}};
  if(!data)return error?<p className="studio-error" role="alert"><Msg text={error}/></p>:<div className="studio-skeleton" role="status">{tr?'Otomasyonlar yükleniyor…':'Loading automations…'}</div>;
  const date=(value:string)=>new Date(value).toLocaleString(locale,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const sourceOf=(item:Form)=>item.kind==='segment'?data.segments.find(segment=>`${segment.id}:${segment.version}`===item.segment)?.sourceId||'':item.sourceId;
  const eventNames=(sourceId:string)=>data.sources.find(source=>source.id===sourceId)?.eventNames||[];
  const edit=(item:AutomationView)=>setForm({id:item.id,revision:item.revision,name:item.name,kind:item.trigger.kind,segment:item.trigger.kind==='segment'?`${item.trigger.segmentId}:${item.trigger.segmentVersion}`:'',sourceId:item.trigger.kind==='event'?item.trigger.sourceId:'',eventName:item.trigger.kind==='event'?item.trigger.eventName:'',waitDays:item.waitDays,exitEvent:item.exitEvent||'',exitOnLeave:item.exitOnLeave,campaignId:item.campaignId,capDays:item.capDays});
  const save=async(event:FormEvent)=>{event.preventDefault();if(!form)return;const [segmentId,version]=form.segment.split(':');
    const body={action:'save',...(form.id?{id:form.id,expectedRevision:form.revision}:{}),name:form.name,trigger:form.kind==='segment'?{kind:'segment',segmentId,segmentVersion:Number(version)}:{kind:'event',sourceId:form.sourceId,eventName:form.eventName},waitDays:Number(form.waitDays),exitEvent:form.exitEvent||null,exitOnLeave:form.exitOnLeave,campaignId:form.campaignId,capDays:Number(form.capDays)};
    if(await post('save',body,()=>tr?'Otomasyon taslak olarak kaydedildi. Etkinleştirilene kadar çalışmaz.':'Automation saved as a draft. It does nothing until it is activated.'))setForm(null);};
  const set=<K extends keyof Form>(key:K,value:Form[K])=>setForm(old=>old?{...old,[key]:value}:old);
  const trigger=(item:AutomationView)=>item.trigger.kind==='segment'?(tr?`Kitleye girince: ${item.segmentName||'—'}`:`On joining: ${item.segmentName||'—'}`):(tr?`Olay gelince: ${item.trigger.eventName}`:`On event: ${item.trigger.eventName}`);
  const formSource=form?sourceOf(form):'',campaigns=data.campaigns.filter(item=>!formSource||item.sourceId===formSource);
  return <section className="automation-center">
    <header className="studio-page-heading"><div><p className="studio-eyebrow">{tr?'YAŞAM DÖNGÜSÜ':'LIFECYCLE'}</p><h1>{tr?'Otomasyonlar':'Automations'}</h1>
      <p className="studio-subtitle">{tr?'Tetikleyici → bekleme → kontroller → onay → e-posta → çıkış. Kural kendi başına hiçbir şey göndermez; her gönderimi bir onaylayıcı başlatır.':'Trigger → wait → checks → approval → email → exit. A rule never sends on its own; an approver starts every send.'}</p></div>
      {data.canWrite&&!form&&<div className="overview-header-actions"><button type="button" className="studio-primary" title={tr?'Yeni otomasyon':'New automation'} onClick={()=>setForm({...empty})}><Plus size={15}/>{tr?'Yeni otomasyon':'New automation'}</button></div>}
    </header>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}
    {notice&&<p className="coach-note" role="status">{notice}</p>}
    {form&&<form className="studio-band automation-form" onSubmit={event=>void save(event)}>
      <h2>{form.id?(tr?'Otomasyonu düzenle':'Edit automation'):(tr?'Yeni otomasyon':'New automation')}</h2>
      <label>{tr?'Ad':'Name'}<input required maxLength={80} value={form.name} onChange={event=>set('name',event.target.value)}/></label>
      <fieldset><legend>{tr?'Tetikleyici':'Trigger'}</legend>
        <label className="automation-choice"><input type="radio" checked={form.kind==='segment'} onChange={()=>set('kind','segment')}/>{tr?'Kişi bir kitleye girdiğinde':'When a contact joins a segment'}</label>
        <label className="automation-choice"><input type="radio" checked={form.kind==='event'} onChange={()=>set('kind','event')}/>{tr?'Bir ürün olayı geldiğinde':'When a product event arrives'}</label>
      </fieldset>
      {form.kind==='segment'?<label>{tr?'Kitle':'Segment'}<select required value={form.segment} onChange={event=>set('segment',event.target.value)}><option value="">{tr?'Kitle seçin':'Choose a segment'}</option>{data.segments.map(item=><option key={item.id} value={`${item.id}:${item.version}`}>{item.name} · v{item.version}</option>)}</select></label>
        :<><label>{tr?'Veri kaynağı':'Data source'}<select required value={form.sourceId} onChange={event=>set('sourceId',event.target.value)}><option value="">{tr?'Kaynak seçin':'Choose a source'}</option>{data.sources.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>{tr?'Olay':'Event'}<select required value={form.eventName} onChange={event=>set('eventName',event.target.value)}><option value="">{tr?'Olay seçin':'Choose an event'}</option>{eventNames(form.sourceId).map(name=><option key={name}>{name}</option>)}</select></label></>}
      <label>{tr?'Bekleme (gün, 0–30)':'Wait (days, 0–30)'}<input type="number" min={0} max={30} required value={form.waitDays} onChange={event=>set('waitDays',Number(event.target.value))}/></label>
      <label>{tr?'Hedef olayı gelince çık (isteğe bağlı)':'Exit when this goal event arrives (optional)'}<select value={form.exitEvent} onChange={event=>set('exitEvent',event.target.value)}><option value="">{tr?'Yok':'None'}</option>{eventNames(formSource).map(name=><option key={name}>{name}</option>)}</select></label>
      {form.kind==='segment'&&<label className="automation-choice"><input type="checkbox" checked={form.exitOnLeave} onChange={event=>set('exitOnLeave',event.target.checked)}/>{tr?'Kişi kitleden çıkarsa otomasyondan da çıksın':'Exit when the contact leaves the segment'}</label>}
      <label>{tr?'Gönderilecek onaylı kampanya':'Approved campaign to send'}<select required value={form.campaignId} onChange={event=>set('campaignId',event.target.value)}><option value="">{tr?'Kampanya seçin':'Choose a campaign'}</option>{campaigns.map(item=><option key={item.id} value={item.id}>{item.name}{item.approval==='approved'?'':tr?' (onay bekliyor)':' (not approved yet)'}</option>)}</select></label>
      <label>{tr?'Sıklık sınırı: aynı kişiye en çok her … günde bir (1–90)':'Frequency cap: at most once every … days per contact (1–90)'}<input type="number" min={1} max={90} required value={form.capDays} onChange={event=>set('capDays',Number(event.target.value))}/></label>
      <p className="coach-muted">{tr?'Her kişi bir otomasyona yalnız bir kez girer (döngü yok). Sıklık sınırı projenin tüm otomasyonları için geçerlidir.':'Each contact enters an automation only once (no loops). The frequency cap applies across all of the project’s automations.'}</p>
      <div className="coach-action-buttons"><button type="submit" className="studio-primary" disabled={Boolean(busy)}>{tr?'Taslağı kaydet':'Save draft'}</button><button type="button" className="studio-text-button" onClick={()=>setForm(null)}>{tr?'Vazgeç':'Cancel'}</button></div>
    </form>}
    {data.automations.length===0&&!form?<div className="studio-empty"><Workflow size={26}/><p>{tr?'Henüz otomasyon yok. Önce bir kitle, e-posta eşleştirmesi ve onaylı bir e-posta kampanyası hazırlayın; sonra kişileri bu kampanyaya yönlendiren bir kural kurun.':'No automations yet. Prepare a segment, the email mapping and an approved email campaign first; then set up a rule that leads contacts to that campaign.'}</p></div>
      :<ul className="automation-list">{data.automations.map(item=><li key={item.id} className="studio-draft-row">
        <div className="studio-draft-top"><div><span className={`coach-state ${item.state==='active'?'done':''}`}>{item.state==='active'?(tr?'Etkin':'Active'):item.state==='paused'?(tr?'Duraklatıldı':'Paused'):(tr?'Taslak':'Draft')}</span><h2 className="mt-2">{item.name}</h2>
          <p className="coach-muted">{trigger(item)} · {tr?`${item.waitDays} gün bekle`:`wait ${item.waitDays} day(s)`}{item.exitEvent?(tr?` · çıkış: ${item.exitEvent}`:` · exit: ${item.exitEvent}`):''}{item.exitOnLeave?(tr?' · kitleden çıkınca biter':' · ends on leaving'):''} · {tr?`en çok ${item.capDays} günde bir`:`at most every ${item.capDays} day(s)`} · {item.campaignName||'—'}</p></div>
          <div className="coach-action-buttons">
            {item.state!=='active'&&data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>edit(item)}><Pencil size={14}/>{tr?'Düzenle':'Edit'}</button>}
            {item.state!=='active'&&data.canActivate&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'state',id:item.id,state:'active',expectedRevision:item.revision},()=>tr?'Otomasyon etkin. Kişiler kaydediliyor; gönderim yine onayınızı bekler.':'Automation is active. Contacts are being enrolled; sending still waits for your approval.')}><Play size={14}/>{tr?'Etkinleştir':'Activate'}</button>}
            {item.state==='active'&&data.canWrite&&<><button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'evaluate',id:item.id},value=>{const counts=(value.counts||{}) as Record<string,number>;return tr?`${counts.entered||0} yeni kişi, ${counts.ready||0} kişi onaya hazır, ${counts.exited||0} çıkış.`:`${counts.entered||0} new contact(s), ${counts.ready||0} ready for approval, ${counts.exited||0} exit(s).`;})}><RefreshCw size={14}/>{tr?'Şimdi değerlendir':'Evaluate now'}</button>
              <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'state',id:item.id,state:'paused',expectedRevision:item.revision},()=>tr?'Otomasyon duraklatıldı.':'Automation paused.')}><Pause size={14}/>{tr?'Duraklat':'Pause'}</button></>}
          </div></div>
        <ul className="automation-counts">{([['waiting','Bekliyor','Waiting'],['ready','Onaya hazır','Ready for approval'],['sent','Gönderildi','Sent'],['exited','Çıktı','Exited']] as const).map(([key,a,b])=><li key={key}><span>{tr?a:b}</span><strong>{item.counts[key].toLocaleString(locale)}</strong></li>)}</ul>
        {Object.keys(item.reasons).length>0&&<p className="coach-muted">{Object.entries(item.reasons).map(([key,value])=>`${REASONS[key]?.[idx]||key}: ${value}`).join(' · ')}</p>}
        {item.state==='active'&&item.counts.ready>0&&data.canApprove&&<div className="automation-approve">
          {confirm===item.id?<>
            <label className="automation-choice"><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)}/>{tr?'Onaylı kampanyanın, onaya hazır ve pilot listesindeki kişilere (en çok 5) gerçekten gönderileceğini anlıyorum.':'I understand the approved campaign will really be sent to ready contacts on the pilot list (at most 5).'}</label>
            <div className="coach-action-buttons"><button type="button" className="studio-primary" disabled={!ack||Boolean(busy)} onClick={()=>void post(item.id,{action:'approve',id:item.id,mode:'send',sendAcknowledged:true},value=>{const counts=(value.counts||{}) as Record<string,number>;return tr?`${counts.sent||0} kişi gönderim kuyruğuna alındı. ${counts.notSendable||0} kişi gönderilemez olduğu için çıktı.`:`${counts.sent||0} contact(s) queued. ${counts.notSendable||0} left because they can’t be emailed.`;}).then(()=>{setConfirm(null);setAck(false);})}><Send size={14}/>{tr?'Gönder':'Send'}</button><button type="button" className="studio-text-button" onClick={()=>{setConfirm(null);setAck(false);}}>{tr?'Vazgeç':'Cancel'}</button></div></>
          :<div className="coach-action-buttons">
            <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'approve',id:item.id,mode:'rehearsal'},value=>{const counts=(value.counts||{}) as Record<string,number>;return tr?`Prova kuyruğa alındı: ${counts.rehearsed||0} alıcı denetlenecek, e-posta gönderilmez.`:`Rehearsal queued: ${counts.rehearsed||0} recipient(s) will be checked; no email is sent.`;})}><TestTube2 size={14}/>{tr?'Prova (gönderimsiz)':'Rehearse (no send)'}</button>
            <button type="button" className="studio-secondary" disabled={Boolean(busy)||!data.sendingEnabled} title={data.sendingEnabled?undefined:(tr?'Gerçek gönderim bu projede açık değil.':'Real sending is not enabled for this project.')} onClick={()=>setConfirm(item.id)}><Send size={14}/>{tr?'Onayla ve gönder':'Approve and send'}</button>
          </div>}
          {!data.sendingEnabled&&<p className="coach-muted">{tr?'Gerçek gönderim kapalı: SES, alan adı doğrulaması ve sunucu izni tamamlanınca açılır. Prova her zaman kullanılabilir.':'Real sending is off: it opens once SES, domain verification and the server switch are complete. Rehearsal is always available.'}</p>}
        </div>}
        {item.runs.length>0&&<details className="coach-resolved"><summary>{tr?'Son çalışmalar':'Recent runs'}</summary><ul>{item.runs.map((run,index)=><li key={index}><span className="coach-state">{run.kind==='evaluate'?(tr?'Değerlendirme':'Evaluation'):run.mode==='send'?(tr?'Gönderim':'Send'):(tr?'Prova':'Rehearsal')}</span><span>{Object.entries(run.counts).map(([key,value])=>`${key}: ${value}`).join(' · ')}</span><span className="coach-muted">{date(run.createdAt)}</span></li>)}</ul></details>}
      </li>)}</ul>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'İzni geri alınan, abonelikten çıkan veya engellenen kişiye gönderilmez. Gerçek gönderim pilot sınırlarıyla (izin listesi, en çok 5 alıcı, kişi başına günde bir) çalışır.':'Contacts who withdrew consent, unsubscribed or are suppressed are never emailed. Real sending runs within pilot limits (allowlist, at most 5 recipients, once per contact per day).'}</p>
  </section>;
}
