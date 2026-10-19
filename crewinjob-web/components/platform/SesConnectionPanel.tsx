'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Cloud,Copy,RefreshCw,Save,ShieldCheck,LockKeyhole} from 'lucide-react';
import type {Locale} from '@/lib/platform/catalog';
import type {SesSettings} from '@/lib/platform/ses-types';
import {projectRequest} from '@/lib/platform/client';
import {translateMessage} from '@/lib/i18n/messages';
import {localeTag} from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
export default function SesConnectionPanel({lang}:{lang:Locale}){
  const tr=lang==='tr',[data,setData]=useState<SesSettings|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[key,setKey]=useState(''),[secret,setSecret]=useState(''),[configurationSet,setSet]=useState(''),[topicArn,setTopic]=useState('');
  const request=useRef<AbortController|null>(null),mounted=useRef(false);
  const act=useCallback(async(action='load',body:Record<string,unknown>={})=>{
    if(!mounted.current)return;const controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setError('');setNotice('');
    try{const value=await projectRequest<SesSettings>('/api/platform/ses',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]),...(action==='load'?{}:{method:'POST',body:JSON.stringify({action,...body})})});if(!mounted.current||controller.signal.aborted)return;setData(value);setSet(value.configurationSet);setTopic(value.topicArn);if(action==='save'){setKey('');setSecret('');setNotice(tr?'SES ayarları kaydedildi.':'SES settings saved.');}if(action==='verify')setNotice(value.verified?(tr?'SES kimlik ve olay ayarları doğrulandı.':'SES identity and event settings verified.'):(tr?'SES kontrolü tamamlandı; eksik kapılar aşağıda.':'SES check completed; missing gates are listed below.'));}
    catch(reason){if(mounted.current&&!controller.signal.aborted)setError(translateMessage(reason instanceof Error?reason.message:'',lang)||(tr?'İstek tamamlanamadı.':'Request failed.'));}finally{if(mounted.current&&!controller.signal.aborted)setBusy(false);}
  },[tr,lang]);
  useEffect(()=>{mounted.current=true;void act();return()=>{mounted.current=false;request.current?.abort();};},[act]);
  const date=(value:string|null)=>value?new Date(value).toLocaleString(localeTag(lang)):'—';
  return <section className="studio-band ses-connection" aria-labelledby="ses-heading"><div className="studio-section-title"><h2 id="ses-heading"><Cloud size={18}/>{tr?'Amazon SES':'Amazon SES'}</h2><button type="button" className="icon-button" disabled={busy} aria-label={tr?'SES ayarlarını yenile':'Refresh SES settings'} title={tr?'SES ayarlarını yenile':'Refresh SES settings'} onClick={()=>void act()}><RefreshCw size={16}/></button></div>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}{notice&&<p className="studio-success" role="status"><Msg text={notice}/></p>}
    {!data&&busy&&<p role="status">{tr?'SES ayarları yükleniyor…':'Loading SES settings…'}</p>}
    {data&&<><dl className="recipient-counts">{([[tr?'SES kimliği':'SES identity',data.verified],[tr?'İmzalı SNS bildirimi':'Signed SNS notification',Boolean(data.feedbackObservedAt)],[tr?'Gerçek pilot':'Real pilot',data.ready]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value?<ShieldCheck size={16}/>:<LockKeyhole size={16}/>} {value?(tr?'Hazır':'Ready'):(tr?'Bekliyor':'Pending')}</dd></div>)}</dl>
      <form onSubmit={event=>{event.preventDefault();void act('save',{accessKeyId:key,secretAccessKey:secret,configurationSet,topicArn,expectedRevision:data.revision});}}><fieldset className="ses-fields" disabled={busy}>
        <label>AWS Access Key ID<input required autoComplete="off" spellCheck={false} value={key} maxLength={20} onChange={event=>setKey(event.target.value)}/></label>
        <label>AWS Secret Access Key<input required type="password" autoComplete="new-password" value={secret} maxLength={40} onChange={event=>setSecret(event.target.value)}/></label>
        <label>{tr?'Configuration set adı':'Configuration set name'}<input required value={configurationSet} maxLength={64} onChange={event=>setSet(event.target.value)}/></label>
        <label>SNS Topic ARN<input required value={topicArn} maxLength={300} spellCheck={false} onChange={event=>setTopic(event.target.value)}/></label>
        <p className="studio-note">{tr?'AWS anahtarı, seçili SES SMTP kullanıcısına ait olmalı. SMTP parolası bu alana girilmez.':'The AWS key must belong to the selected SES SMTP user. Do not enter the SMTP password here.'}</p>
        <button className="studio-secondary" disabled={busy}><Save size={16}/>{tr?'SES ayarlarını kaydet':'Save SES settings'}</button>
      </fieldset></form>
      <div className="studio-form-actions"><button className="studio-secondary" disabled={busy||!data.configured} onClick={()=>void act('verify',{expectedRevision:data.revision})}><ShieldCheck size={16}/>{tr?'SES kimliğini kontrol et':'Check SES identity'}</button></div>
      {data.proof&&<dl className="recipient-counts"><div><dt>{tr?'Alan adı / DKIM':'Domain / DKIM'}</dt><dd>{data.proof.identity&&data.proof.dkim?(tr?'SES doğruladı':'Verified by SES'):(tr?'Doğrulanmadı':'Not verified')}</dd></div><div><dt>{tr?'SES hesap erişimi':'SES sending account'}</dt><dd>{data.proof.account?(tr?'Etkin':'Enabled'):(tr?'Kapalı':'Blocked')}</dd></div><div><dt>{tr?'Teslimat / bounce / şikâyet':'Delivery / bounce / complaint'}</dt><dd>{data.proof.events?(tr?'Olay hedefi hazır':'Event destination ready'):(tr?'Yapılandırılmadı':'Not configured')}</dd></div><div><dt>MAIL FROM</dt><dd>{data.proof.mailFrom==='custom_verified'?(tr?'SES doğruladı':'Verified by SES'):data.proof.mailFrom==='provider_managed'?(tr?'SES yönetiyor':'Managed by SES'):(tr?'Doğrulanmadı':'Not verified')}</dd></div></dl>}
      <p className="studio-note">{tr?'Son SES kontrolü':'Last SES check'}: {date(data.checkedAt)} · {tr?'Son imzalı bildirim':'Last signed notification'}: {date(data.feedbackObservedAt)}{data.proof?.sandbox?' · Sandbox':''}</p>
      {data.endpoint?<div className="ses-endpoint"><code>{data.endpoint}</code><button className="icon-button" title={tr?'SNS adresini kopyala':'Copy SNS endpoint'} aria-label={tr?'SNS adresini kopyala':'Copy SNS endpoint'} onClick={()=>void navigator.clipboard.writeText(data.endpoint!).then(()=>setNotice(tr?'SNS adresi kopyalandı.':'SNS endpoint copied.')).catch(()=>setError(tr?'Kopyalanamadı.':'Could not copy.'))}><Copy size={16}/></button></div>:<p className="studio-data-notice">{tr?'Genel HTTPS adresi sunucuda henüz tanımlanmadı.':'The public HTTPS origin has not been configured on the server.'}</p>}
      {data.lastError&&<p className="studio-error">{tr?'SES yanıtı alınamadı. IAM izinlerini ve hesap ayarlarını kontrol edin.':'SES could not be checked. Review IAM permissions and account settings.'}</p>}
      {!data.deploymentEnabled&&<p className="studio-data-notice"><LockKeyhole size={15}/> {tr?'Gerçek gönderim sunucuda kapalı.':'Real sending is disabled on the server.'}</p>}
      <p className="studio-note">{tr?'SPF/DKIM alıcı tarafındaki sonucu ve gelen kutusuna düşme henüz test edilmedi.':'Receiver-side SPF/DKIM results and inbox placement have not been tested.'}</p>
    </>}
  </section>;
}
