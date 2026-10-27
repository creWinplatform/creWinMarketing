'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BellRing, Clock3, ExternalLink } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { TeamAlert, TeamAlertsView } from '@/lib/platform/team-alerts-types';
import Msg from '@/components/Msg';

// "Needs attention": deadline-sensitive records the member can act on, with an opt-in email. Each row links to the
// screen where the work is done; nothing here sends anything to customers.
export default function TeamAlerts({lang}:{lang:Locale}){
  const tr=lang==='tr',locale=localeTag(lang);
  const [data,setData]=useState<TeamAlertsView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;const controller=new AbortController();
    projectRequest<TeamAlertsView>('/api/platform/alerts',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(value=>{if(mounted.current)setData(value);}).catch(reason=>{if(mounted.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:(tr?'Uyarılar alınamadı.':'Could not load alerts.'));});
    return()=>{mounted.current=false;controller.abort();};},[tr]);
  async function act(body:Record<string,unknown>){
    if(busy)return;setBusy(true);setError('');
    try{const value=await projectRequest<TeamAlertsView>('/api/platform/alerts',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(mounted.current)setData(value);}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}
    finally{if(mounted.current)setBusy(false);}
  }
  if(error&&!data)return <p role="alert" className="studio-error"><Msg text={error}/></p>;
  if(!data||!data.alerts.length&&!data.email.enabled)return null;
  const n=(value:number)=>value.toLocaleString(locale),time=(value:string|null)=>value?new Date(value).toLocaleString(locale,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:data.timezone}):'';
  const text=(alert:TeamAlert)=>{switch(alert.kind){
    case 'inbox_window':return tr?`${n(alert.count)} mesajın 24 saatlik cevap penceresi kapanmak üzere (${alert.count>1?'ilk kapanış':'kapanış'}: ${time(alert.at)}). Pencere kapanınca bu kanaldan cevap gönderilemez.`:`The 24-hour reply window of ${n(alert.count)} message(s) is about to close (${alert.count>1?'first closes':'closes'} ${time(alert.at)}). After it closes, no reply can be sent on that channel.`;
    case 'publication_failed':return tr?`${n(alert.count)} gerçek yayın reddedildi, durduruldu veya sonucu belirsiz. Tekrar yayınlamadan önce sosyal hesabı kontrol edin.`:`${n(alert.count)} live post(s) were rejected, stopped or have an unknown outcome. Check the social account before publishing again.`;
    case 'connection_expiring':return tr?`${n(alert.count)} sosyal hesap bağlantısının izni bitti veya 7 gün içinde bitiyor (${alert.count>1?'ilk bitiş':'bitiş'}: ${time(alert.at)}). Planlı yayınların gitmesi için yeniden bağlanın.`:`${n(alert.count)} social account grant(s) ended or end within 7 days (${alert.count>1?'first ends':'ends'} ${time(alert.at)}). Reconnect so scheduled posts can go out.`;
    case 'billing_period':return alert.phase==='grace'?(tr?`Ücretli dönem bitti; ek süre ${time(alert.at)} tarihinde sona eriyor. Sonra yeni üretim durur, kayıtlar korunur.`:`The paid period has ended; the grace period ends at ${time(alert.at)}. After that, new work stops and records are kept.`)
      :alert.phase==='trial_ending'?(tr?`Deneme süresi ${time(alert.at)} tarihinde bitiyor.`:`The trial ends at ${time(alert.at)}.`)
      :(tr?`Ücretli dönem ${time(alert.at)} tarihinde bitiyor. Yenileme otomatik değildir.`:`The paid period ends at ${time(alert.at)}. Renewal is not automatic.`);
    case 'ad_error':return tr?`${n(alert.count)} reklam planında sağlayıcı hatası var. Harcamanın durumunu reklam hesabından kontrol edin.`:`${n(alert.count)} ad plan(s) have a provider error. Check the spend status in the ad account.`;
  }};
  const open={inbox_window:tr?'Gelen kutusu':'Inbox',publication_failed:tr?'Yayın kuyruğu':'Publication queue',connection_expiring:tr?'Bağlantılar':'Connections',billing_period:tr?'Plan ve ödeme':'Plan and payment',ad_error:tr?'Reklamlar':'Ads'};
  return <section className="studio-band team-alerts" aria-labelledby="team-alerts-title" aria-busy={busy}>
    <div className="studio-section-title"><h2 id="team-alerts-title"><BellRing size={16}/>{tr?'Dikkat gerekenler':'Needs attention'}</h2>{data.alerts.length>0&&<span className="studio-badge">{n(data.alerts.length)}</span>}</div>
    {error&&<p role="alert" className="studio-error"><Msg text={error}/></p>}
    {data.alerts.length?<ul className="team-alert-list">{data.alerts.map(alert=><li key={alert.kind} className={`team-alert team-alert-${alert.severity}`}>
      {alert.severity==='urgent'?<AlertTriangle size={16} aria-hidden="true"/>:<Clock3 size={16} aria-hidden="true"/>}
      <span><span className="sr-only">{alert.severity==='urgent'?(tr?'Acil: ':'Urgent: '):(tr?'Uyarı: ':'Warning: ')}</span>{text(alert)}</span>
      <a className="studio-text-button" href={alert.href}>{open[alert.kind]}<ExternalLink size={14}/></a></li>)}</ul>
      :<p className="studio-note">{tr?'Şu an süresi dolmak üzere olan bir iş yok.':'Nothing is close to a deadline right now.'}</p>}
    {data.email.enabled?<div className="team-alert-email">
      {data.email.subscribed?<><p className="studio-note">{tr?'Yeni bir konu çıktığında e-postayla haber veriyoruz (en fazla 3 saatte bir). E-postada mesaj metni veya kişi bilgisi yer almaz.':'We email you when something new comes up (at most every 3 hours). The email contains no message text or personal details.'}</p>
        <button type="button" className="studio-secondary" disabled={busy} onClick={()=>void act({action:'unsubscribe'})}>{tr?'E-posta uyarılarını kapat':'Turn off email alerts'}</button></>
      :data.email.hasVerifiedEmail?<button type="button" className="studio-secondary" disabled={busy} onClick={()=>void act({action:'subscribe',language:lang})}><BellRing size={15}/>{tr?'Yeni konularda bana e-postayla haber ver':'Email me when something new comes up'}</button>
      :<a className="studio-text-button" href="/?tab=project&settings=team">{tr?'E-posta uyarıları için hesap e-postanızı doğrulayın':'Verify your account email to get email alerts'}<ExternalLink size={14}/></a>}
    </div>:<p className="studio-note">{tr?'E-posta uyarıları bu sunucuda kapalı; uyarılar burada görünür.':'Email alerts are off on this server; alerts are shown here.'}</p>}
  </section>;
}
