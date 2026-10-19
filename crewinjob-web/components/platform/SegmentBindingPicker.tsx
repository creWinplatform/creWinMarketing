'use client';
import {useEffect,useRef,useState} from 'react';
import {Eye} from 'lucide-react';
import type {Locale} from '@/lib/platform/catalog';
import type {SegmentSummary,SegmentPreview} from '@/lib/platform/segment-types';
import {projectRequest} from '@/lib/platform/client';
import {translateMessage} from '@/lib/i18n/messages';
import {localeTag} from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
export default function SegmentBindingPicker({id,version,lang,onChange}:{id:string;version:number;lang:Locale;onChange:(id:string,version:number,goalId?:string)=>void}){
  const tr=lang==='tr',[items,setItems]=useState<SegmentSummary[]>([]),[error,setError]=useState(''),[preview,setPreview]=useState<SegmentPreview|null>(null),[busy,setBusy]=useState(false);
  const fail=(reason:unknown)=>translateMessage(reason instanceof Error?reason.message:'',lang)||(tr?'İstek tamamlanamadı.':'Request failed.');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  useEffect(()=>{const controller=new AbortController();projectRequest<{items:SegmentSummary[]}>('/api/platform/segments',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setItems(value.items.filter(item=>!item.archived));}).catch(reason=>{if(!controller.signal.aborted)setError(fail(reason));});return()=>controller.abort();},[]);
  useEffect(()=>{request.current?.abort();setBusy(false);setPreview(null);setError('');},[id,version]);
  const key=id?`${id}:${version}`:'',present=items.some(item=>item.id===id&&item.version===version);
  const calculate=async()=>{
    const controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setError('');setPreview(null);
    try{const result=await projectRequest<SegmentPreview>('/api/platform/segments',{method:'POST',signal:controller.signal,body:JSON.stringify({action:'preview',id,version})});if(!controller.signal.aborted)setPreview(result);}
    catch(reason){if(!controller.signal.aborted)setError(fail(reason));}
    finally{if(!controller.signal.aborted)setBusy(false);}
  };
  return <div className="studio-form-full segment-binding-picker">
    <label>{tr?'Kitle sürümü':'Audience version'}<select value={key} disabled={busy} onChange={event=>{const [nextId,nextVersion]=event.target.value.split(':');const item=items.find(item=>item.id===nextId);onChange(nextId||'',Number(nextVersion)||0,item?.definition.goalId||undefined);}}>
      <option value="">{tr?'Kitle bağı yok':'No audience binding'}</option>
      {id&&!present&&<option value={key}>{tr?'Sabit kitle':'Pinned audience'} · v{version}</option>}
      {items.map(item=><option key={item.id} value={`${item.id}:${item.version}`}>{item.name} · v{item.version}</option>)}
    </select></label>
    {id&&<button type="button" className="studio-secondary" disabled={busy} onClick={()=>void calculate()}><Eye size={15}/>{busy?(tr?'Hesaplanıyor…':'Calculating…'):(tr?'Kitleyi önizle':'Preview audience')}</button>}
    {preview&&<p className="studio-success" role="status">{preview.matched.toLocaleString(localeTag(lang))} / {preview.total.toLocaleString(localeTag(lang))} · {tr?'eşleşen gözlenen kayıt':'matching observed records'}{preview.unknown?` · ${preview.unknown.toLocaleString(localeTag(lang))} ${tr?'belirsiz':'unknown'}`:''}</p>}
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}
  </div>;
}
