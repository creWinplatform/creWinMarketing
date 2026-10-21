'use client';
import { useCallback, useEffect, useState } from 'react';
import { EyeOff, RefreshCw, Save, Send, ShieldCheck, Sparkles, Undo2 } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { InboxItemView, InboxSnapshot } from '@/lib/platform/social-inbox-types';
import { onTabKeys } from './tab-keys';
import Msg from '@/components/Msg';

type State=InboxItemView['state'];
const STATES:Record<State,[string,string]>={new:['Yeni','New'],replied:['Yanıtlandı','Replied'],dismissed:['Gizlendi','Hidden']};
const REPLY:Record<string,[string,string]>={draft:['taslak','draft'],sending:['gönderiliyor','sending'],sent:['gönderildi','sent'],rejected:['reddedildi','rejected'],uncertain:['belirsiz','uncertain']};
const PLATFORM:Record<string,string>={facebook:'Facebook',instagram:'Instagram',linkedin:'LinkedIn'};

// Social inbox: comments on the project's own posts and Page/Instagram messages. The team writes each reply (AI can
// suggest one into the box), and a reply goes out only with the publish duty, the server switch and an acknowledgement.
export default function ProjectSocialInbox({lang}:{lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [data,setData]=useState<InboxSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[filter,setFilter]=useState<State>('new'),[drafts,setDrafts]=useState<Record<string,string>>({}),[ack,setAck]=useState<Record<string,boolean>>({});
  const load=useCallback(()=>{projectRequest<InboxSnapshot>('/api/platform/inbox').then(setData).catch(reason=>setError(reason.message));},[]);
  useEffect(()=>{load();},[load]);
  const post=async(key:string,body:object,message?:string)=>{if(busy)return false;setBusy(key);setError('');setNotice('');
    try{setData(await projectRequest<InboxSnapshot>('/api/platform/inbox',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)}));if(message)setNotice(message);return true;}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));load();return false;}finally{setBusy('');}};
  const aiReply=async(item:InboxItemView)=>{if(busy)return;setBusy(`ai:${item.id}`);setError('');setNotice('');
    try{const value=await projectRequest<{reply:string;snapshot:InboxSnapshot}>('/api/platform/inbox',{method:'POST',body:JSON.stringify({action:'aiReply',id:item.id}),signal:AbortSignal.timeout(45000)});setData(value.snapshot);setDrafts(old=>({...old,[item.id]:value.reply}));setNotice(tr?'AI yanıt önerisi metin kutusuna yazıldı; okuyup düzenleyin.':'The AI reply suggestion is in the text box; read and edit it.');}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}finally{setBusy('');}};
  if(!data)return error?<p className="studio-error" role="alert"><Msg text={error}/></p>:<div className="studio-skeleton" role="status">{tr?'Gelen kutusu yükleniyor…':'Loading the inbox…'}</div>;
  const when=(value:string)=>new Date(value).toLocaleString(locale,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const shown=data.items.filter(item=>item.state===filter);
  return <section className="ads-center messaging-center" aria-labelledby="inbox-title">
    <div className="studio-section-title"><h2 id="inbox-title">{tr?'Yorumlar ve mesajlar':'Comments and messages'}</h2>{data.me.read&&<span className="studio-badge">{tr?`Bugün ${data.syncsLeft} yenileme hakkı`:`${data.syncsLeft} refreshes left today`}</span>}</div>
    <p className="studio-note">{tr?'Yayınladığınız gönderilerin altındaki yorumlar ve Facebook sayfası ile Instagram mesajları. Metindeki e-posta, telefon ve kullanıcı adları gizlenir; yazar adı ve kimliği açık saklanmaz. Her yanıtı ekip yazar ve onaylar; mesajlara yalnız son 24 saat içinde yanıt verilebilir.':'Comments under your published posts plus Facebook Page and Instagram messages. Emails, phone numbers and handles are masked; author names and ids are not stored in clear. The team writes and approves every reply; messages can only be answered within 24 hours.'}</p>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}{notice&&<p className="coach-note" role="status">{notice}</p>}
    <div className="ads-account"><h3>{tr?'Hesaplar':'Accounts'}</h3>
      {data.accounts.length?<ul className="ads-list">{data.accounts.map(account=><li key={account.id} className="studio-draft-row"><div className="studio-draft-top"><div><strong>{account.name}</strong> <span className="coach-muted">· {PLATFORM[account.platform]} · {account.messages?(tr?'yorum ve mesaj':'comments and messages'):(tr?'yalnız yorum':'comments only')}{account.lastSyncAt?` · ${tr?'son kayıt':'last item'} ${when(account.lastSyncAt)}`:''}</span></div>
        {data.me.read&&<button type="button" className="studio-secondary" disabled={Boolean(busy)||data.syncsLeft<1} onClick={()=>void post(account.id,{action:'sync',connectionId:account.id},tr?'Yorum ve mesajlar getirildi.':'Comments and messages fetched.')}><RefreshCw size={14}/>{busy===account.id?(tr?'Getiriliyor…':'Fetching…'):(tr?'Yenile':'Refresh')}</button>}</div></li>)}</ul>
        :<p className="coach-muted">{tr?'Bağlı Facebook sayfası, Instagram hesabı veya LinkedIn şirket sayfası yok. X yanıtlarını okumak ücretli arama erişimi gerektirdiği için burada yer almaz.':'No connected Facebook Page, Instagram account or LinkedIn company page. Reading X replies needs paid search access, so X is not included.'}</p>}
      {!data.me.read&&<p className="coach-muted">{tr?'Okumak için "kaynak okuma" mesajlaşma görevi gerekir (Kampanyalar → Mesajlaşma → Mesajlaşma görevleri).':'Reading needs the "read sources" messaging duty (Campaigns → Messaging → Messaging duties).'}</p>}
    </div>
    {data.me.read&&<div className="ads-account"><div className="publication-view-tabs" role="tablist" aria-label={tr?'Kayıt durumu':'Item state'} onKeyDown={onTabKeys}>{(Object.keys(STATES) as State[]).map(state=><button key={state} role="tab" aria-selected={filter===state} tabIndex={filter===state?0:-1} onClick={()=>setFilter(state)}>{STATES[state][idx]} ({data.counts[state]})</button>)}</div>
      {shown.length?<ul className="ads-list">{shown.map(item=>{const value=drafts[item.id]??item.reply,locked=['sending','sent','uncertain'].includes(String(item.replyState));return <li key={item.id} className="studio-draft-row">
        <p className="coach-muted">{PLATFORM[item.platform]} · {item.accountName} · {item.kind==='comment'?(tr?'yorum':'comment'):(tr?'mesaj':'message')} · {when(item.receivedAt)}{item.postUrl&&<> · <a href={item.postUrl} target="_blank" rel="noreferrer">{tr?'Gönderiyi aç':'Open post'}</a></>}{item.replyState&&<> · <span className="coach-state">{tr?'yanıt':'reply'}: {REPLY[item.replyState][idx]}</span></>}</p>
        <p className="messaging-text">{item.text}</p>
        {!item.windowOpen&&!locked&&<p className="coach-muted">{tr?'Mesajlaşma penceresi kapandı (24 saat geçti); bu mesaja buradan yanıt gönderilemez.':'The messaging window has closed (24 hours passed); this message cannot be answered from here.'}</p>}
        {!item.windowOpen&&!locked&&data.me.suggest&&item.state==='new'&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'decide',id:item.id,expectedRevision:item.revision,state:'dismissed'})}><EyeOff size={14}/>{tr?'Gizle':'Hide'}</button>}
        {data.me.suggest&&!locked&&item.windowOpen&&item.state!=='dismissed'&&<div className="messaging-suggest"><label className="sr-only" htmlFor={`reply-${item.id}`}>{tr?'Yanıtınız':'Your reply'}</label>
          <textarea id={`reply-${item.id}`} rows={3} maxLength={1000} placeholder={tr?'Kısa ve nazik bir yanıt; e-posta, telefon veya bağlantı yazmayın.':'A short, polite reply; no emails, phone numbers or links.'} value={value} onChange={event=>setDrafts(old=>({...old,[item.id]:event.target.value}))}/>
          <div className="coach-action-buttons">
            {data.aiConfigured&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void aiReply(item)}><Sparkles size={14}/>{busy===`ai:${item.id}`?(tr?'AI yazıyor…':'AI is writing…'):(tr?'AI ile öner':'Suggest with AI')}</button>}
            <button type="button" className="studio-text-button" disabled={Boolean(busy)||!value.trim()} onClick={()=>void post(item.id,{action:'reply',id:item.id,expectedRevision:item.revision,reply:value},tr?'Yanıt taslağı kaydedildi.':'Reply draft saved.')}><Save size={14}/>{tr?'Taslağı kaydet':'Save draft'}</button>
            {item.state==='new'&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'decide',id:item.id,expectedRevision:item.revision,state:'dismissed'})}><EyeOff size={14}/>{tr?'Gizle':'Hide'}</button>}
          </div></div>}
        {item.state==='dismissed'&&data.me.suggest&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'decide',id:item.id,expectedRevision:item.revision,state:'new'})}><Undo2 size={14}/>{tr?'Geri al':'Restore'}</button>}
        {item.replyState==='draft'&&item.windowOpen&&data.me.publish&&data.sendEnabled&&<div className="automation-approve"><label className="automation-choice"><input type="checkbox" checked={Boolean(ack[item.id])} onChange={event=>setAck(old=>({...old,[item.id]:event.target.checked}))}/>{tr?'Bu yanıt herkese açık ya da kişiye doğrudan, şirket hesabı adına gönderilecek.':'This reply will go out publicly or directly to the person, on behalf of the company account.'}</label>
          <button type="button" className="studio-secondary" disabled={Boolean(busy)||!ack[item.id]} onClick={()=>void post(item.id,{action:'send',id:item.id,expectedRevision:item.revision,acknowledged:true},tr?'Yanıt gönderildi.':'Reply sent.')}><Send size={14}/>{tr?'Yanıtı gönder':'Send reply'}</button></div>}
        {item.replyState==='draft'&&(!data.me.publish||!data.sendEnabled)&&<p className="coach-muted">{!data.sendEnabled?(tr?'Gerçek gönderim bu sunucuda kapalı (PLATFORM_SOCIAL_PUBLISH_ENABLED).':'Real sending is off on this server (PLATFORM_SOCIAL_PUBLISH_ENABLED).'):(tr?'Göndermek için "yayın" mesajlaşma görevi gerekir.':'Sending needs the "publish" messaging duty.')}</p>}
      </li>;})}</ul>:<p className="coach-muted">{tr?'Bu görünümde kayıt yok.':'No items in this view.'}</p>}
    </div>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Hiçbir yanıt kendiliğinden gitmez. Gönderilen her yanıt bir kez denenir; sonucu belirsizse tekrar gönderilmez ve öyle işaretlenir.':'No reply goes out on its own. Each reply is attempted once; if the outcome is unclear it is not resent and is marked as such.'}</p>
  </section>;
}
