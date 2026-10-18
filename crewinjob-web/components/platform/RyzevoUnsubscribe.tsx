'use client';
import {useEffect,useState} from 'react';
import {Check,MailX,LoaderCircle} from 'lucide-react';
import Brand from './Brand';
export default function RyzevoUnsubscribe({token}:{token:string}){
  const [state,setState]=useState<'loading'|'ready'|'saving'|'success'|'invalid'|'error'|'unavailable'>('loading'),[project,setProject]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState('loading');
    fetch('/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action:'inspect'}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),referrerPolicy:'no-referrer',cache:'no-store'}).then(async response=>{if(!response.ok){if(!controller.signal.aborted)setState(response.status===400?'invalid':'unavailable');return;}const value=await response.json();if(!controller.signal.aborted){setProject(value.projectName);setState(value.unsubscribed?'success':'ready');}}).catch(()=>{if(!controller.signal.aborted)setState('unavailable');});return()=>controller.abort();
  },[token,attempt]);
  async function confirm(){setState('saving');try{const response=await fetch('/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action:'process'}),signal:AbortSignal.timeout(15000),referrerPolicy:'no-referrer',cache:'no-store'});setState(response.ok?'success':'error');}catch{setState('error');}}
  return <main className="ryzevo-unsubscribe"><Brand/><section aria-live="polite"><div className="unsubscribe-symbol">{state==='success'?<Check size={28}/>:state==='loading'||state==='saving'?<LoaderCircle size={28} className="animate-spin"/>:<MailX size={28}/>}</div><p>{project}</p><h1>{state==='success'?'Aboneliğiniz iptal edildi':state==='invalid'?'Bağlantı geçersiz veya süresi dolmuş':state==='loading'?'Bağlantı kontrol ediliyor…':state==='unavailable'?'Bağlantı kontrol edilemedi':'Pazarlama e-postalarını durdur'}</h1><p className="unsubscribe-english">{state==='success'?'You have been unsubscribed.':state==='invalid'?'This link is invalid or has expired.':state==='loading'?'Checking your link…':state==='unavailable'?'The service is unavailable. Please try again.':'Unsubscribe from this project’s marketing emails.'}</p>{state==='error'&&<p role="alert">İşlem tamamlanamadı. Tekrar deneyin. / Please try again.</p>}{state==='unavailable'&&<button className="unsubscribe-confirm" onClick={()=>setAttempt(attempt+1)}>Tekrar dene / Try again</button>}{['ready','saving','error'].includes(state)&&<button className="unsubscribe-confirm" disabled={state==='saving'} onClick={()=>void confirm()}>{state==='saving'?'İşleniyor… / Processing…':'Aboneliği iptal et / Unsubscribe'}</button>}</section></main>;
}
