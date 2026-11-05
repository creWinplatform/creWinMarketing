'use client';
import { useCallback,useEffect,useState } from 'react';
import { CheckCircle2,AlertCircle,PowerOff,MinusCircle,ShieldCheck,ArrowRight,RefreshCw } from 'lucide-react';
import { projectRequest } from '@/lib/platform/client';
import type { Locale } from '@/lib/platform/catalog';
import type { GoLiveItem,GoLiveView } from '@/lib/platform/go-live-types';
import Msg from '@/components/Msg';

const GROUPS:Record<GoLiveItem['group'],[string,string]>={social:['Sosyal kanallar','Social channels'],ads:['Reklamlar','Ads'],mobile:['Mobil uygulama','Mobile app'],messages:['Mesajlar','Messages'],measurement:['Ölçüm','Measurement']};
const STATE:Record<GoLiveItem['state'],[string,string]>={ready:['Hazır','Ready'],action:['Yapılacak','To do'],off:['Anahtar kapalı','Switch off'],optional:['Kullanılmıyor','Not used']};

// What is left before live use, per channel and connection, with read-only checks. Switches are changed on the server.
export default function GoLivePanel({lang}:{lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,t=(a:string,b:string)=>tr?a:b;
  const [data,setData]=useState<GoLiveView|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[showOptional,setShowOptional]=useState(false);
  const load=useCallback(()=>{setError('');projectRequest<GoLiveView>('/api/platform/go-live').then(setData).catch(reason=>setError(reason instanceof Error?reason.message:t('Durum yüklenemedi.','Status could not be loaded.')));},[]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{load();},[load]);
  const verify=async(item:GoLiveItem)=>{if(!item.verify||busy)return;setBusy(item.id);setError('');setNotice('');
    try{const value=await projectRequest<{result:{ok:boolean;name?:string;currency?:string};status:GoLiveView}>('/api/platform/go-live',{method:'POST',body:JSON.stringify(item.verify.kind==='ads'?{action:'verifyAds',provider:item.verify.provider}:{action:'verifyMobile',id:item.verify.id}),signal:AbortSignal.timeout(45000)});
      setData(value.status);setNotice(value.result.name?t(`${item.label.tr}: hesap okundu (${value.result.name}${value.result.currency?` · ${value.result.currency}`:''}).`,`${item.label.en}: the account was read (${value.result.name}${value.result.currency?` · ${value.result.currency}`:''}).`):t(`${item.label.tr}: test tamamlandı.`,`${item.label.en}: check finished.`));}
    catch(reason){setError(reason instanceof Error?reason.message:t('Test tamamlanamadı.','The check could not be finished.'));}finally{setBusy('');}};
  if(!data)return <section className="studio-band golive">{error?<p className="studio-error" role="alert"><Msg text={error}/></p>:<div className="studio-skeleton" role="status">{t('Durum yükleniyor…','Loading status…')}</div>}</section>;
  const icon=(state:GoLiveItem['state'])=>state==='ready'?<CheckCircle2 size={18} aria-hidden="true"/>:state==='action'?<AlertCircle size={18} aria-hidden="true"/>:state==='off'?<PowerOff size={18} aria-hidden="true"/>:<MinusCircle size={18} aria-hidden="true"/>;
  return <section className="studio-band golive">
    <div className="studio-section-title"><div><h2>{t('Canlıya geçiş','Go-live')}</h2><p className="studio-subtitle">{t('Her kanal ve bağlantı için eksik olan, kapalı anahtarlar ve sıradaki adım. “Doğrula” yalnız okuma yapar; harcama veya gönderim olmaz.','What is missing for each channel and connection, the switches that are off and the next step. “Verify” only reads; nothing is spent or sent.')}</p></div>
      <button type="button" className="studio-secondary" onClick={load}><RefreshCw size={15}/>{t('Yenile','Refresh')}</button></div>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}{notice&&<p className="golive-notice" role="status">{notice}</p>}
    <div className="golive-summary">{data.summary.filter(item=>item.total).map(item=><div key={item.group}><span>{GROUPS[item.group][idx]}</span><strong>{item.ready}/{item.total}</strong>{item.action>0&&<small>{t(`${item.action} yapılacak`,`${item.action} to do`)}</small>}</div>)}</div>
    <label className="golive-toggle"><input type="checkbox" checked={showOptional} onChange={event=>setShowOptional(event.target.checked)}/>{t('Kullanılmayan kanalları da göster','Also show channels not in use')}</label>
    {(Object.keys(GROUPS) as GoLiveItem['group'][]).map(group=>{const list=data.items.filter(item=>item.group===group&&(showOptional||item.state!=='optional'));if(!list.length)return null;
      return <div className="golive-group" key={group}><h3>{GROUPS[group][idx]}</h3><ul>{list.map(item=><li key={item.id} className={`golive-item golive-${item.state}`}>
        <span className="golive-icon">{icon(item.state)}</span>
        <div><strong>{item.label[lang]}</strong><span className="golive-state">{STATE[item.state][idx]}</span><p>{item.detail[lang]}</p></div>
        <div className="golive-actions">{item.verify&&<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void verify(item)}><ShieldCheck size={14}/>{busy===item.id?t('Kontrol ediliyor…','Checking…'):t('Doğrula','Verify')}</button>}
          {item.href&&<a className="studio-text-button" href={item.href}>{t('Git','Open')}<ArrowRight size={14}/></a>}</div>
      </li>)}</ul></div>;})}
    <p className="studio-data-notice">{t('Anahtarlar sunucunun ortam ayarlarında açılır (yöneticinin işi); bu sayfa yalnız açık mı kapalı mı olduğunu gösterir. Gizli bilgi gösterilmez.','Switches are turned on in the server’s environment settings (an administrator task); this page only shows whether each is on or off. No secret is shown.')}</p>
  </section>;
}
