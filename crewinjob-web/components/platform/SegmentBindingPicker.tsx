'use client';
import {useEffect,useRef,useState} from 'react';
import {Eye} from 'lucide-react';
import type {Locale} from '@/lib/platform/catalog';
import type {SegmentSummary,SegmentPreview} from '@/lib/platform/segment-types';
import {projectRequest} from '@/lib/platform/client';
export default function SegmentBindingPicker({id,version,lang,onChange}:{id:string;version:number;lang:Locale;onChange:(id:string,version:number,goalId?:string)=>void}){
  const tr=lang==='tr',[items,setItems]=useState<SegmentSummary[]>([]),[error,setError]=useState(''),[preview,setPreview]=useState<SegmentPreview|null>(null),[busy,setBusy]=useState(false);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  useEffect(()=>{const controller=new AbortController();projectRequest<{items:SegmentSummary[]}>('/api/platform/segments',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setItems(value.items.filter(item=>!item.archived));}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);});return()=>controller.abort();},[]);
  useEffect(()=>{request.current?.abort();setBusy(false);setPreview(null);setError('');},[id,version]);
  const key=id?`${id}:${version}`:'',present=items.some(item=>item.id===id&&item.version===version);
  const calculate=async()=>{
    const controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setError('');setPreview(null);
    try{const result=await projectRequest<SegmentPreview>('/api/platform/segments',{method:'POST',signal:controller.signal,body:JSON.stringify({action:'preview',id,version})});if(!controller.signal.aborted)setPreview(result);}
    catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Request failed.');}
    finally{if(!controller.signal.aborted)setBusy(false);}
  };
  return <div className="studio-form-full segment-binding-picker">
    <label>{tr?'Kitle sürümü':'Audience version'}<select value={key} disabled={busy} onChange={event=>{const [nextId,nextVersion]=event.target.value.split(':');const item=items.find(item=>item.id===nextId);onChange(nextId||'',Number(nextVersion)||0,item?.definition.goalId||undefined);}}>
      <option value="">{tr?'Kitle bağı yok':'No audience binding'}</option>
      {id&&!present&&<option value={key}>{tr?'Sabit kitle':'Pinned audience'} · v{version}</option>}
      {items.map(item=><option key={item.id} value={`${item.id}:${item.version}`}>{item.name} · v{item.version}</option>)}
    </select></label>
    {id&&<button type="button" className="studio-secondary" disabled={busy} onClick={()=>void calculate()}><Eye size={15}/>{busy?(tr?'Hesaplanıyor…':'Calculating…'):(tr?'Kitleyi önizle':'Preview audience')}</button>}
    {preview&&<p className="studio-success" role="status">{preview.matched} / {preview.total} · {tr?'eşleşen gözlenen kayıt':'matching observed records'}{preview.unknown?` · ${preview.unknown} ${tr?'belirsiz':'unknown'}`:''}</p>}
    {error&&<p className="studio-error" role="alert">{error}</p>}
  </div>;
}
