'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Database, Plus, Pencil, Trash2, Eye, RefreshCw, X, Check, Square, Play, Unplug } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { PRODUCT_SOURCE_LIMITS, type ProductAttributeType, type ProductPreview, type ProductSource, type ProductSourceConfig } from '@/lib/platform/product-data-types';
import ProductWebhooksPanel from './ProductWebhooksPanel';

type Job = {id:string;connectionId:string;status:string;attempts:number;message:string};
type RecordItem = ProductPreview['samples'][number] & {receivedAt:string};
type Data = {items:ProductSource[];sourceCount:number;jobs:Job[];records:RecordItem[]};
const endpoint='/api/platform/data-sources';
const initialConfig=():ProductSourceConfig=>({url:'',auth:'bearer',itemsPath:'result.items',idPath:'id',updatedAtPath:'updatedAt',entityType:'user',attributes:[{key:'progress',path:'progress',type:'number'}],nextCursorPath:'',cursorParam:''});
export default function ProductDataSources({lang}:{lang:Locale}) {
  const [mode,setMode]=useState<'rest'|'webhook'>('rest');
  return <div><div className="product-data-modes" role="tablist" aria-label={lang==='tr'?'Veri kaynağı türü':'Source type'}>{(['rest','webhook'] as const).map(value=><button key={value} role="tab" aria-selected={mode===value} onClick={()=>setMode(value)}>{value==='rest'?'REST API':lang==='tr'?'İmzalı webhook':'Signed webhook'}</button>)}</div>{mode==='rest'?<RestDataSources lang={lang}/>:<ProductWebhooksPanel lang={lang}/>}</div>;
}
function RestDataSources({lang}:{lang:Locale}) {
  const tr=lang==='tr',locale=tr?'tr-TR':'en-GB';
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [editor,setEditor]=useState(false),[editing,setEditing]=useState<ProductSource|null>(null),[name,setName]=useState(''),[token,setToken]=useState(''),[config,setConfig]=useState(initialConfig);
  const [selected,setSelected]=useState(''),[preview,setPreview]=useState<{id:string;value:ProductPreview}|null>(null);
  const selectedRef=useRef(selected); selectedRef.current=selected;
  const alive=useRef(true),running=useRef(new Set<string>()),requests=useRef(new Set<AbortController>());
  const load=useCallback(async()=>{
    const controller=new AbortController();requests.current.add(controller);
    try {
      const value=await projectRequest<Data>(`${endpoint}${selected?`?sourceId=${encodeURIComponent(selected)}`:''}`,{signal:controller.signal});
      if(alive.current&&!controller.signal.aborted&&selectedRef.current===selected)setData(value);
    }catch(reason){if(alive.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Request failed.');}
    finally{requests.current.delete(controller);}
  },[selected]);
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;requests.current.forEach(controller=>controller.abort());};},[load]);
  const activeJobs=data?.jobs.some(job=>['queued','running'].includes(job.status));
  useEffect(()=>{if(!activeJobs)return;const interval=setInterval(()=>void load(),2500);return()=>clearInterval(interval);},[activeJobs,load]);
  const send=<T,>(input:object,signal?:AbortSignal)=>projectRequest<T>(endpoint,{method:'POST',body:JSON.stringify(input),...(signal?{signal}:{})});
  const action=async(input:object)=>{
    setBusy(true);setError('');setNotice('');
    try{const result=await send(input);await load();return result;}
    catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'Request failed.');return null;}
    finally{if(alive.current)setBusy(false);}
  };
  const run=async(id:string)=>{
    if(running.current.has(id))return;
    running.current.add(id);
    const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),60000);requests.current.add(controller);
    try{await send({action:'run',id},controller.signal);}
    catch{if(alive.current)setNotice(tr?'İşin son durumu kuyrukta izleniyor.':'The latest job state is tracked in the queue.');}
    finally{clearTimeout(deadline);running.current.delete(id);requests.current.delete(controller);if(alive.current)void load();}
  };
  const start=async(source:ProductSource)=>{
    const result=await action({action:'sync',id:source.id,idempotencyKey:`product-sync:${crypto.randomUUID()}`}) as Job|null;
    if(result)void run(result.id);
  };
  const open=(source:ProductSource|null)=>{setEditing(source);setName(source?.name||'');setConfig(source?structuredClone(source.config):initialConfig());setToken('');setEditor(true);setError('');setPreview(null);};
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    const saved=await action({action:'save',...(editing?{id:editing.id,version:editing.version}:{}),name,token,config}) as ProductSource|null;
    if(saved){setEditor(false);setToken('');setSelected(saved.id);setNotice(tr?'Kaynak kaydedildi. Etkinleştirmeden önce önizleyin.':'Source saved. Preview before activating.');}
  };
  const check=async(source:ProductSource)=>{
    setSelected(source.id);setPreview(null);
    const value=await action({action:'preview',id:source.id}) as ProductPreview|null;
    if(value&&alive.current)setPreview({id:source.id,value});
    else if(alive.current)void load();
  };
  const revoke=(source:ProductSource)=>{
    if(window.confirm(tr?'Bu kaynağın erişim anahtarı kaldırılacak ve aktarım işleri iptal edilecek. Kayıtlar korunur; yeniden bağlamak için kaynak ayarlarını kaydedebilirsiniz. Devam edilsin mi?':'Remove this source credential and cancel sync jobs? Records are retained. You can reconnect by saving the source settings.'))void action({action:'revoke',id:source.id,version:source.version});
  };
  const updateAttribute=(index:number,patch:Partial<ProductSourceConfig['attributes'][number]>)=>setConfig(current=>({...current,attributes:current.attributes.map((field,i)=>i===index?{...field,...patch}:field)}));
  const stateLabel=(state:string)=>({draft:tr?'Önizleme gerekli':'Preview needed',ready:tr?'Etkinleştirmeye hazır':'Ready to activate',active:tr?'Etkin':'Active',paused:tr?'Duraklatıldı':'Paused',revoked:tr?'Bağlantı iptal':'Connection revoked',queued:tr?'Kuyrukta':'Queued',running:tr?'Çalışıyor':'Running',completed:tr?'Tamamlandı':'Completed',cancelled:tr?'İptal edildi':'Cancelled',failed:tr?'Başarısız':'Failed'}[state]||state);
  const date=(value:string|null)=>value?new Date(value).toLocaleString(locale):'—';
  return <section className="product-data-section">
    <div className="studio-section-title"><div><h2>{tr?'Ürün veri kaynakları':'Product data sources'}</h2><p className="studio-note">{data?`${data.sourceCount} / ${PRODUCT_SOURCE_LIMITS.sources}`:''} · {tr?'Toplam kaynak':'Total sources'}</p></div><div className="flex items-center gap-2"><button className="icon-button" title={tr?'Yenile':'Refresh'} aria-label={tr?'Yenile':'Refresh'} onClick={()=>{setError('');void load();}}><RefreshCw size={16}/></button><button className="studio-primary" disabled={busy||Boolean(data&&data.sourceCount>=PRODUCT_SOURCE_LIMITS.sources)} onClick={()=>open(null)}><Plus size={16}/>{tr?'Kaynak ekle':'Add source'}</button></div></div>
    {error&&<div className="studio-error" role="alert">{error}</div>}
    {notice&&<p className="studio-success" role="status">{notice}</p>}
    {!data&&!error&&<p role="status" className="studio-skeleton">{tr?'Kaynaklar yükleniyor…':'Loading sources…'}</p>}
    {editor&&<form className="studio-editor product-data-editor" onSubmit={save}>
      <div className="studio-section-title"><h2>{editing?(tr?'Kaynağı düzenle':'Edit source'):(tr?'Yeni REST kaynağı':'New REST source')}</h2><button type="button" className="icon-button" title={tr?'Kapat':'Close'} aria-label={tr?'Kapat':'Close'} onClick={()=>{setEditor(false);setToken('');}}><X size={18}/></button></div>
      <fieldset disabled={busy}><legend className="studio-eyebrow">01 / {tr?'KAYNAK':'SOURCE'}</legend><div className="studio-form-grid">
        <label>{tr?'Kaynak adı':'Source name'}<input required maxLength={160} value={name} onChange={event=>setName(event.target.value)}/></label>
        <label>{tr?'Kayıt türü':'Entity type'}<select value={config.entityType} onChange={event=>setConfig({...config,entityType:event.target.value as ProductSourceConfig['entityType']})}>{[['user',tr?'Kullanıcı':'User'],['company',tr?'Şirket':'Company'],['account',tr?'Hesap':'Account'],['other',tr?'Diğer':'Other']].map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
        <label className="studio-form-full">{tr?'HTTPS API adresi':'HTTPS API URL'}<input type="url" required maxLength={2048} value={config.url} placeholder="https://api.example.com/users" onChange={event=>setConfig({...config,url:event.target.value})}/></label>
        <label>{tr?'Kimlik doğrulama':'Authentication'}<select value={config.auth} onChange={event=>setConfig({...config,auth:event.target.value as ProductSourceConfig['auth']})}><option value="bearer">Bearer token</option><option value="none">{tr?'Kimlik doğrulamasız':'No authentication'}</option></select></label>
        {config.auth==='bearer'&&<label>{tr?'Erişim anahtarı':'Access token'}<input type="password" autoComplete="off" value={token} required={!editing||editing.state==='revoked'} maxLength={16000} placeholder={editing?(tr?'Değiştirmiyorsanız boş bırakın':'Leave blank to keep existing token'):''} onChange={event=>setToken(event.target.value)}/></label>}
      </div></fieldset>
      <fieldset disabled={busy}><legend className="studio-eyebrow">02 / {tr?'ALAN EŞLEŞTİRME':'FIELD MAPPING'}</legend><div className="studio-form-grid">
        <label>{tr?'Kayıt dizisinin JSON yolu':'Records JSON path'}<input value={config.itemsPath} placeholder="result.items" maxLength={160} onChange={event=>setConfig({...config,itemsPath:event.target.value})}/><small>{tr?'Yanıt doğrudan bir dizi ise boş bırakın.':'Leave blank for a root array.'}</small></label>
        <label>{tr?'Benzersiz kayıt kimliği yolu':'Unique record ID path'}<input required value={config.idPath} maxLength={160} onChange={event=>setConfig({...config,idPath:event.target.value})}/></label>
        <label className="studio-form-full">{tr?'Kaynak güncelleme zamanı yolu':'Source updated-at path'}<input required value={config.updatedAtPath} maxLength={160} onChange={event=>setConfig({...config,updatedAtPath:event.target.value})}/><small>ISO 8601 · 2026-10-15T10:00:00Z</small></label>
      </div>
      <div className="product-mapping-list">{config.attributes.map((field,index)=><div className="product-mapping-row" key={index}>
        <label>{tr?'Özellik adı':'Attribute name'} {index+1}<input required value={field.key} maxLength={64} onChange={event=>updateAttribute(index,{key:event.target.value})}/></label>
        <label>{tr?'Kaynak alan yolu':'Source field path'} {index+1}<input required value={field.path} maxLength={160} onChange={event=>updateAttribute(index,{path:event.target.value})}/></label>
        <label>{tr?'Tür':'Type'} {index+1}<select value={field.type} onChange={event=>updateAttribute(index,{type:event.target.value as ProductAttributeType})}><option value="number">{tr?'Sayı':'Number'}</option><option value="string">{tr?'Metin':'Text'}</option><option value="boolean">{tr?'Evet / Hayır':'Boolean'}</option></select></label>
        <button type="button" className="icon-button" disabled={config.attributes.length===1} title={tr?'Özelliği kaldır':'Remove attribute'} aria-label={`${tr?'Özelliği kaldır':'Remove attribute'} ${index+1}`} onClick={()=>setConfig({...config,attributes:config.attributes.filter((_,i)=>i!==index)})}><Trash2 size={16}/></button>
      </div>)}</div>
      <button type="button" className="studio-text-button" disabled={config.attributes.length>=PRODUCT_SOURCE_LIMITS.attributes} onClick={()=>setConfig({...config,attributes:[...config.attributes,{key:'',path:'',type:'string'}]})}><Plus size={15}/>{tr?'Özellik ekle':'Add attribute'}</button>
      <details className="product-pagination-fields"><summary>{tr?'Cursor sayfalaması':'Cursor pagination'}</summary><div className="studio-form-grid"><label>{tr?'Sonraki cursor JSON yolu':'Next cursor JSON path'}<input maxLength={160} value={config.nextCursorPath} onChange={event=>setConfig({...config,nextCursorPath:event.target.value})}/></label><label>{tr?'Cursor sorgu parametresi':'Cursor query parameter'}<input maxLength={40} value={config.cursorParam} onChange={event=>setConfig({...config,cursorParam:event.target.value})}/></label></div></details>
      </fieldset>
      <div className="product-data-form-actions"><span className="studio-note">{tr?'Kayıt, aktarımı başlatmaz.':'Saving does not start ingestion.'}</span><button className="studio-primary" disabled={busy}><Check size={16}/>{busy?(tr?'Kaydediliyor…':'Saving…'):(tr?'Kaynağı kaydet':'Save source')}</button></div>
    </form>}
    {data?.items.length===0&&!editor&&<div className="studio-empty"><Database size={28}/><h3>{tr?'Henüz veri kaynağı yok':'No data sources yet'}</h3><button className="studio-text-button" onClick={()=>open(null)}><Plus size={15}/>{tr?'İlk kaynağı ekle':'Add first source'}</button></div>}
    <div className="product-source-list">{data?.items.map(source=><article className="product-source-row" key={source.id}>
      <div className="product-source-heading"><div><button className="product-source-name" onClick={()=>setSelected(source.id)}>{source.name}</button><p>{new URL(source.config.url).hostname} · v{source.version} · {source.config.entityType}</p></div><span className={`studio-badge ${source.state==='active'?'product-source-active':''}`}>{stateLabel(source.state)}</span><button className="icon-button" title={tr?'Kaynağı düzenle':'Edit source'} aria-label={`${tr?'Kaynağı düzenle':'Edit source'} ${source.name}`} disabled={busy} onClick={()=>open(source)}><Pencil size={16}/></button></div>
      <dl className="product-source-facts"><div><dt>{tr?'Güncel sürümdeki kayıt':'Current-version records'}</dt><dd>{source.recordCount.toLocaleString(locale)}</dd></div><div><dt>{tr?'Son önizleme':'Last preview'}</dt><dd>{date(source.previewAt)}</dd></div><div><dt>{tr?'Son aktarım':'Last sync'}</dt><dd>{date(source.lastSyncedAt)}</dd></div></dl>
      <div className="product-source-actions"><button className="studio-secondary" disabled={busy||source.state==='revoked'} onClick={()=>void check(source)}><Eye size={15}/>{tr?'Önizle':'Preview'}</button><label className="product-source-toggle"><input role="switch" type="checkbox" aria-label={`${tr?'Kaynağı etkinleştir':'Activate source'} ${source.name}`} checked={source.state==='active'} disabled={busy||source.state==='revoked'||(!source.previewAt&&source.state!=='active')} onChange={event=>void action({action:event.target.checked?'activate':'pause',id:source.id,version:source.version})}/>{tr?'Etkin':'Active'}</label><button className="icon-button" title={tr?'Bağlantıyı iptal et':'Revoke connection'} aria-label={`${tr?'Bağlantıyı iptal et':'Revoke connection'} ${source.name}`} disabled={busy||source.state==='revoked'} onClick={()=>revoke(source)}><Unplug size={16}/></button><button className="studio-primary" disabled={busy||source.state!=='active'||data.jobs.some(job=>job.connectionId===source.id&&['queued','running'].includes(job.status))} onClick={()=>void start(source)}><RefreshCw size={15}/>{source.hasMore?(tr?'Sonraki sayfaları al':'Continue sync'):(tr?'Senkronize et':'Sync')}</button></div>
    </article>)}</div>
    {preview&&<section className="studio-band" aria-live="polite"><div className="studio-section-title"><h3>{tr?'Önizleme sonucu':'Preview result'}</h3><span className="studio-badge">{preview.value.valid} / {preview.value.total}</span></div>{preview.value.canActivate?<p className="studio-success">{tr?'Eşleştirme geçerli. Kaynak etkinleştirilebilir.':'Mapping is valid. The source can be activated.'}</p>:<p className="studio-error">{tr?'Kaynak etkinleştirilemez. En az bir geçerli kayıt ve hatasız eşleştirme gerekli.':'Activation requires at least one record and no mapping errors.'}</p>}{preview.value.errors.map((item,index)=><p className="studio-note" key={index}>{tr?'Satır':'Row'} {item.row}: {item.field}</p>)}<SampleTable items={preview.value.samples} tr={tr}/></section>}
    {selected&&data&&<section className="studio-band"><div className="studio-section-title"><h3>{tr?'Aktarılan kayıt örnekleri':'Imported record samples'}</h3><span className="studio-note">{data.items.find(item=>item.id===selected)?.name}</span></div>{data.records.length?<SampleTable items={data.records} tr={tr}/>:<p className="studio-note">{tr?'Bu sürümde henüz aktarılmış kayıt yok.':'No imported records for this version yet.'}</p>}</section>}
    {Boolean(data?.jobs.length)&&<section className="studio-band"><div className="studio-section-title"><h3>{tr?'Aktarım işleri':'Sync jobs'}</h3></div>{data!.jobs.slice(0,10).map(job=><div className="product-job-row" key={job.id}><div><strong>{data!.items.find(item=>item.id===job.connectionId)?.name||job.connectionId}</strong><p>{job.message||stateLabel(job.status)}</p></div><span className="studio-badge">{stateLabel(job.status)}</span>{job.status==='queued'&&<button className="icon-button" title={tr?'İşi çalıştır':'Run job'} aria-label={tr?'İşi çalıştır':'Run job'} onClick={()=>void run(job.id)}><Play size={16}/></button>}{['queued','running'].includes(job.status)&&<button className="icon-button" title={tr?'İşi iptal et':'Cancel job'} aria-label={tr?'İşi iptal et':'Cancel job'} onClick={()=>void action({action:'cancel',id:job.id})}><Square size={15}/></button>}</div>)}</section>}
    <p className="product-data-boundary">{tr?'İletişim izni bu aktarımla belirlenmez. Gönderim ve otomatik kampanya kapalıdır.':'This import does not establish communication consent. Sending and automatic campaigns remain disabled.'}</p>
  </section>;
}
function SampleTable({items,tr}:{items:ProductPreview['samples'];tr:boolean}) {
  return <div className="product-data-table"><table><thead><tr><th>{tr?'Kimlik':'ID'}</th><th>{tr?'Özellikler':'Attributes'}</th><th>{tr?'Kaynak zamanı':'Source time'}</th></tr></thead><tbody>{items.map((item,index)=><tr key={index}><td><code>{item.externalId}</code></td><td>{Object.entries(item.attributes).map(([key,value])=><span className="product-sample-field" key={key}><strong>{key}:</strong> {String(value)}</span>)}</td><td>{new Date(item.observedAt).toLocaleString(tr?'tr-TR':'en-GB')}</td></tr>)}</tbody></table></div>;
}
