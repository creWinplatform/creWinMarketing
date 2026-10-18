'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {MailCheck,Save,RefreshCw,Copy,Plus,Trash2,ShieldCheck,LockKeyhole,Globe,UsersRound,ExternalLink} from 'lucide-react';
import type {Locale} from '@/lib/platform/catalog';
import {projectRequest} from '@/lib/platform/client';
import {OWNERSHIP_LABELS,SENDER_ERROR_LABELS,type SenderWorkspace} from '@/lib/platform/email-sender-types';
import SesConnectionPanel from './SesConnectionPanel';
const endpoint='/api/platform/email-sender';
export default function ProjectEmailSender({lang,canManage}:{lang:Locale;canManage:boolean}){
  const tr=lang==='tr',[data,setData]=useState<SenderWorkspace|null>(null),[busy,setBusy]=useState(false),[pending,setPending]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [connectionId,setConnectionId]=useState(''),[maximum,setMaximum]=useState(5),[email,setEmail]=useState(''),[ack,setAck]=useState(false),[copyNotice,setCopyNotice]=useState('');
  const request=useRef<AbortController|null>(null),messages=useRef<HTMLDivElement>(null),mounted=useRef(true);
  const accept=useCallback((value:SenderWorkspace)=>{setData(value);setConnectionId(value.readiness.connectionId||'');setMaximum(value.readiness.maxRecipients||5);setAck(false);},[]);
  const load=useCallback(async()=>{
    const controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setPending('load');setError('');setNotice('');
    try{const value=await projectRequest<SenderWorkspace>(endpoint,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});if(mounted.current&&!controller.signal.aborted)accept(value);}
    catch(reason){if(mounted.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Request failed.');}
    finally{if(mounted.current&&!controller.signal.aborted){setBusy(false);setPending('');}}
  },[accept]);
  useEffect(()=>{mounted.current=true;if(canManage)void load();return()=>{mounted.current=false;request.current?.abort();};},[load,canManage]);
  useEffect(()=>{if(error||notice)messages.current?.scrollIntoView({block:'start',behavior:'instant'});},[error,notice]);
  useEffect(()=>{setError('');setNotice('');setCopyNotice('');},[lang]);
  async function action(action:string,extra:object={}){
    if(busy)return;const controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setPending(action);setError('');setNotice('');setCopyNotice('');
    try{
      const value=await projectRequest<SenderWorkspace>(endpoint,{method:'POST',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]),body:JSON.stringify({action,expectedRevision:data?.readiness.revision||0,...extra})});
      if(!mounted.current||controller.signal.aborted)return;accept(value);if(action==='allow')setEmail('');
      if(action==='verify'&&value.readiness.ownership!=='verified'){setError(SENDER_ERROR_LABELS[value.lastError]?.[tr?0:1]||(tr?'DNS kaydı henüz doğrulanmadı.':'DNS record is not verified yet.'));return;}
      setNotice(action==='verify'?(tr?'Alan adı sahipliği doğrulandı.':'Domain ownership verified.'):action==='allow'?(tr?'Test adresi eklendi. İletişim izni ayrıca kontrol edilir.':'Test address added. Communication consent is checked separately.'):action==='remove'?(tr?'Adres pilot listesinden çıkarıldı.':'Address removed from the pilot allowlist.'):action==='renew'?(tr?'Yeni DNS değeri oluşturuldu; önceki doğrulama geçersiz.':'New DNS value created; previous verification is invalid.'):(tr?'Gönderen ve pilot sınırı kaydedildi.':'Sender and pilot cap saved.'));
    }catch(reason){if(mounted.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Request failed.');}
    finally{if(mounted.current&&!controller.signal.aborted){setBusy(false);setPending('');}}
  }
  async function copy(value:string){try{await navigator.clipboard.writeText(value);setCopyNotice(tr?'DNS alanı kopyalandı.':'DNS field copied.');}catch{setCopyNotice(tr?'Kopyalanamadı. DNS alanını seçerek kopyalayın.':'Could not copy. Select the DNS field to copy it.');}}
  const readiness=data?.readiness,selected=data?.connections.find(item=>item.id===connectionId),date=(value:string)=>new Date(value).toLocaleString(tr?'tr-TR':'en-GB');
  function save(event:FormEvent){event.preventDefault();void action('select',{connectionId,maxRecipients:maximum});}
  return <section className="email-sender-workspace"><header className="studio-page-heading"><div><p className="studio-eyebrow">{tr?'E-POSTA OPERASYONU':'EMAIL OPERATIONS'}</p><h1>{tr?'Gönderen ve pilot':'Sender & pilot'}</h1></div>{canManage&&<button className="icon-button" disabled={busy} title={tr?'Gönderen ekranını yenile':'Refresh sender settings'} aria-label={tr?'Gönderen ekranını yenile':'Refresh sender settings'} onClick={()=>void load()}><RefreshCw size={17}/></button>}</header>
    {!canManage?<p className="studio-data-notice"><LockKeyhole size={16}/>{tr?'Gönderen ve pilot listesini proje sahibi veya yöneticisi yönetebilir.':'Only project owners and administrators can manage sender and pilot settings.'}</p>:<>
      <div ref={messages} className="sender-messages">{error&&<p role="alert" className="studio-error">{error}</p>}{notice&&<p role="status" className="studio-success">{notice}</p>}</div>
      {!data&&busy&&<p role="status" className="studio-skeleton">{tr?'Gönderen ayarları yükleniyor…':'Loading sender settings…'}</p>}
      {data&&<>
        <dl className="sender-check-strip"><div><MailCheck size={19}/><dt>{tr?'Seçili SMTP erişimi':'Selected SMTP access'}</dt><dd>{readiness?.smtpReady?(tr?'Doğrulandı':'Verified'):(tr?'Bekliyor':'Pending')}</dd></div><div><Globe size={19}/><dt>{tr?'Alan adı sahipliği':'Domain ownership'}</dt><dd>{OWNERSHIP_LABELS[readiness!.ownership][tr?0:1]}</dd></div><div><UsersRound size={19}/><dt>{tr?'Pilot listesi':'Pilot allowlist'}</dt><dd>{data.allowlist.length} <span>/ {data.limits.activeAddresses}</span></dd></div></dl>
        <form className="studio-band sender-form" onSubmit={save}><div className="studio-section-title"><h2><MailCheck size={18}/>{tr?'Gönderen hesabı':'Sender account'}</h2><a className="studio-text-button" href="/?tab=project&settings=connections">{tr?'Bağlantılar':'Connections'}<ExternalLink size={14}/></a></div>
          {data.connections.length===0?<div className="studio-empty"><MailCheck size={27}/><h3>{tr?'Etkin SMTP bağlantısı yok':'No active SMTP connection'}</h3><a href="/?tab=project&settings=connections" className="studio-text-button">{tr?'SMTP bağlantısı ekle':'Add an SMTP connection'}</a></div>:<fieldset className="sender-selection" disabled={busy}><label>{tr?'Proje SMTP bağlantısı':'Project SMTP connection'}<select required value={connectionId} onChange={event=>setConnectionId(event.target.value)}><option value="">{tr?'Gönderen seçin':'Choose sender'}</option>{data.connections.map(item=><option key={item.id} value={item.id} disabled={!item.configured}>{item.name} · {item.maskedSender||(tr?'SMTP ayarları eksik':'SMTP settings missing')}</option>)}</select></label><label>{tr?'Pilot başına maksimum alıcı':'Maximum recipients per pilot'}<input required type="number" min={1} max={data.limits.maxRecipients} step={1} value={maximum} onChange={event=>setMaximum(Number(event.target.value))}/></label><button className="studio-primary" disabled={busy||!selected?.configured}><Save size={16}/>{pending==='select'?(tr?'Kaydediliyor…':'Saving…'):(tr?'Göndereni kaydet':'Save sender')}</button></fieldset>}
          {readiness?.connectionId&&<p className="studio-note">{readiness.maskedSender} · {readiness.domain} · {tr?'Kayıtlı pilot sınırı':'Saved pilot cap'}: {readiness.maxRecipients}</p>}
        </form>
        {readiness?.connectionId&&<section className="studio-band sender-domain"><div className="studio-section-title"><h2><Globe size={18}/>{tr?'DNS sahiplik kontrolü':'DNS ownership check'}</h2><span className={`studio-badge ${readiness.ownership==='verified'?'sender-verified':''}`}>{OWNERSHIP_LABELS[readiness.ownership][tr?0:1]}</span></div>
          {data.dnsRecord?<><dl className="sender-dns-fields"><div><dt>{tr?'Kayıt türü':'Record type'}</dt><dd>TXT</dd></div><DnsField label={tr?'DNS adı':'DNS name'} value={data.dnsRecord.name} tr={tr} copy={copy}/><DnsField label={tr?'DNS değeri':'DNS value'} value={data.dnsRecord.value} tr={tr} copy={copy}/></dl><p className="studio-note">{tr?'DNS değerinin son geçerliliği':'DNS challenge expires'}: {date(data.dnsRecord.expiresAt)}</p></>:<p className="studio-data-notice">{tr?'Güncel DNS kaydı için göndereni yeniden kaydedin veya DNS değerini yenileyin.':'Save the current sender again or renew the DNS challenge.'}</p>}
          {copyNotice&&<p className="studio-note" role="status">{copyNotice}</p>}
          {readiness.ownershipExpiresAt&&<p className="studio-note">{tr?'Sahiplik kontrolünün geçerliliği':'Ownership check valid until'}: {date(readiness.ownershipExpiresAt)}</p>}
          {data.lastError&&<p className="sender-warning">{SENDER_ERROR_LABELS[data.lastError]?.[tr?0:1]||(tr?'DNS kontrolü tamamlanamadı.':'DNS check could not complete.')}</p>}
          {data.lastCheckedAt&&<p className="studio-note">{tr?'Son DNS kontrolü':'Last DNS check'}: {date(data.lastCheckedAt)}</p>}
          <div className="studio-form-actions"><button className="studio-secondary" disabled={busy} onClick={()=>{if(window.confirm(tr?'Yeni DNS değeri oluşturulsun mu? Mevcut sahiplik doğrulaması geçersiz olur.':'Create a new DNS value? Current ownership verification will be invalidated.'))void action('renew');}}><RefreshCw size={16}/>{tr?'DNS değerini yenile':'Renew DNS value'}</button><button className="studio-primary" disabled={busy||!data.dnsRecord||Date.parse(data.dnsRecord.expiresAt)<=Date.now()} onClick={()=>void action('verify')}><ShieldCheck size={16}/>{pending==='verify'?(tr?'DNS kontrol ediliyor…':'Checking DNS…'):(tr?'DNS kaydını kontrol et':'Check DNS record')}</button></div>
        </section>}
        <section className="studio-band sender-pilot"><div className="studio-section-title"><h2><UsersRound size={18}/>{tr?'Pilot test adresleri':'Pilot test addresses'} <span className="recipient-total">{data.allowlist.length} / {data.limits.activeAddresses}</span></h2></div>
          <form onSubmit={event=>{event.preventDefault();void action('allow',{email,acknowledged:ack});}}><fieldset className="sender-pilot-fields" disabled={busy||!readiness?.connectionId}><label>{tr?'Test e-posta adresi':'Test email address'}<input type="email" required maxLength={254} autoComplete="off" value={email} onChange={event=>setEmail(event.target.value)}/></label><button className="studio-secondary" disabled={busy||!readiness?.connectionId||!ack||!email||data.allowlist.length>=data.limits.activeAddresses}><Plus size={16}/>{tr?'Test adresi ekle':'Add test address'}</button><label className="campaign-review-ack"><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)}/>{tr?'Bu adresin proje pilot testine katılmasını onaylıyorum.':'I authorize this address to participate in this project’s pilot test.'}</label></fieldset></form>
          {!readiness?.connectionId&&<p className="studio-note">{tr?'Önce bir gönderen hesabı kaydedin.':'Save a sender account first.'}</p>}
          {data.allowlist.length===0?<p className="studio-note">{tr?'Pilot listesinde adres yok.':'The pilot allowlist is empty.'}</p>:<div className="product-data-table sender-allowlist" tabIndex={0} aria-label={tr?'Pilot adresleri':'Pilot addresses'}><table><thead><tr><th>{tr?'Test adresi':'Test address'}</th><th>{tr?'Eklendi':'Added'}</th><th>{tr?'İşlem':'Action'}</th></tr></thead><tbody>{data.allowlist.map(item=><tr key={item.id}><td><strong>{item.maskedEmail}</strong><small>…{item.id.slice(-6)}</small></td><td>{date(item.updatedAt)}</td><td><button className="icon-button" disabled={busy} title={tr?'Pilot listesinden çıkar':'Remove from pilot allowlist'} aria-label={`${tr?'Pilot listesinden çıkar':'Remove from pilot allowlist'} …${item.id.slice(-6)}`} onClick={()=>void action('remove',{id:item.id})}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>}
        </section>
        <SesConnectionPanel lang={lang}/>
        <p className="product-data-boundary">{tr?'Pilot listesi iletişim izni vermez ve engelleme kayıtlarını kaldıramaz.':'The pilot allowlist does not grant communication consent or remove suppression.'}</p>
      </>}
    </>}
  </section>;
}
function DnsField({label,value,tr,copy}:{label:string;value:string;tr:boolean;copy:(value:string)=>Promise<void>}){return <div><dt>{label}</dt><dd><code>{value}</code><button className="icon-button" title={tr?'DNS alanını kopyala':'Copy DNS field'} aria-label={`${tr?'Kopyala':'Copy'} ${label}`} onClick={()=>void copy(value)}><Copy size={15}/></button></dd></div>;}
