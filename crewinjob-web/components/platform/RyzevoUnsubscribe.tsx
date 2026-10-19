'use client';
import {useEffect,useState} from 'react';
import {Check,MailX,LoaderCircle} from 'lucide-react';
import {LangToggle,useT,useLang} from '@/lib/lang';
import Brand from './Brand';
const LANG_TOGGLE_CLASS='absolute right-4 top-4 z-10 inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-md border border-[#cfd7c6] bg-white px-3 text-[11px] font-bold tracking-[.04em] text-[#3f5a28] hover:bg-[#f1f5ea] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#789f17]';
export default function RyzevoUnsubscribe({token}:{token:string}){
  const {lang}=useLang(),t=useT();
  const [state,setState]=useState<'loading'|'ready'|'saving'|'success'|'invalid'|'error'|'unavailable'>('loading'),[project,setProject]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState('loading');
    fetch('/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action:'inspect'}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),referrerPolicy:'no-referrer',cache:'no-store'}).then(async response=>{if(!response.ok){if(!controller.signal.aborted)setState(response.status===400?'invalid':'unavailable');return;}const value=await response.json();if(!controller.signal.aborted){setProject(value.projectName);setState(value.unsubscribed?'success':'ready');}}).catch(()=>{if(!controller.signal.aborted)setState('unavailable');});return()=>controller.abort();
  },[token,attempt]);
  async function confirm(){setState('saving');try{const response=await fetch('/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action:'process'}),signal:AbortSignal.timeout(15000),referrerPolicy:'no-referrer',cache:'no-store'});setState(response.ok?'success':'error');}catch{setState('error');}}
  const title=state==='success'?t('Aboneliğiniz iptal edildi','You have been unsubscribed'):state==='invalid'?t('Bağlantı geçersiz veya süresi dolmuş','This link is invalid or has expired'):state==='loading'?t('Bağlantı kontrol ediliyor…','Checking your link…'):state==='unavailable'?t('Bağlantı kontrol edilemedi','We could not check your link'):t('Pazarlama e-postalarını durdur','Stop marketing emails');
  const detail=state==='success'?t('Bu projenin pazarlama e-postaları adresinize artık gönderilmez.','This project’s marketing emails will no longer be sent to your address.'):state==='invalid'?t('E-posta içindeki bağlantıyı tekrar kullanmayı deneyin.','Try the link in the email again.'):state==='loading'?'':state==='unavailable'?t('Hizmete şu anda ulaşılamıyor. Lütfen tekrar deneyin.','The service is unavailable. Please try again.'):t('Bu projenin pazarlama e-postalarından çıkın.','Unsubscribe from this project’s marketing emails.');
  return <main className="ryzevo-unsubscribe relative" lang={lang}><LangToggle className={LANG_TOGGLE_CLASS}/><Brand/><section aria-live="polite"><div className="unsubscribe-symbol">{state==='success'?<Check size={28}/>:state==='loading'||state==='saving'?<LoaderCircle size={28} className="animate-spin"/>:<MailX size={28}/>}</div><p>{project}</p><h1>{title}</h1>{detail&&<p className="unsubscribe-english">{detail}</p>}{state==='error'&&<p role="alert">{t('İşlem tamamlanamadı. Tekrar deneyin.','Could not complete the request. Please try again.')}</p>}{state==='unavailable'&&<button className="unsubscribe-confirm" onClick={()=>setAttempt(attempt+1)}>{t('Tekrar dene','Try again')}</button>}{['ready','saving','error'].includes(state)&&<button className="unsubscribe-confirm" disabled={state==='saving'} onClick={()=>void confirm()}>{state==='saving'?t('İşleniyor…','Processing…'):t('Aboneliği iptal et','Unsubscribe')}</button>}</section></main>;
}
