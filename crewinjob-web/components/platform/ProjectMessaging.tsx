'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BookText, EyeOff, FilePlus2, Plus, RefreshCw, Save, ShieldCheck, Trash2, Undo2, UserCog } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { MESSAGING_DUTIES, type MessagingDuty, type MessagingPostView, type MessagingSnapshot, type MessagingTopic } from '@/lib/platform/messaging-types';
import Msg from '@/components/Msg';

type State=MessagingPostView['state'];
const STATES:Record<State,[string,string]>={new:['Yeni','New'],suggested:['Önerildi','Suggested'],dismissed:['Gizlendi','Hidden']};
const DUTIES:Record<MessagingDuty,[string,string]>={'source.read':['Kaynak okuma','Read sources'],suggest:['İçerik önerisi','Suggest content'],publish:['Yayın','Publish']};
type Topic={id:string;label:string;terms:string};

// Messaging sources: Telegram channels the project's own bot was added to, read into the team's content suggestions.
// Reading, suggesting and publishing are separate duties. Nothing here posts or messages anyone.
export default function ProjectMessaging({lang}:{lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [data,setData]=useState<MessagingSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[filter,setFilter]=useState<State>('new'),[topic,setTopic]=useState('');
  const [source,setSource]=useState({connectionId:'',channel:''}),[topics,setTopics]=useState<Topic[]|null>(null),[drafts,setDrafts]=useState<Record<string,string>>({});
  const load=useCallback(()=>{projectRequest<MessagingSnapshot>('/api/platform/messaging').then(setData).catch(reason=>setError(reason.message));},[]);
  useEffect(()=>{load();},[load]);
  const post=async(key:string,body:object,message?:string)=>{if(busy)return false;setBusy(key);setError('');setNotice('');
    try{setData(await projectRequest<MessagingSnapshot>('/api/platform/messaging',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)}));if(message)setNotice(message);return true;}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));load();return false;}finally{setBusy('');}};
  if(!data)return error?<p className="studio-error" role="alert"><Msg text={error}/></p>:<div className="studio-skeleton" role="status">{tr?'Mesajlaşma kaynakları yükleniyor…':'Loading messaging sources…'}</div>;
  const when=(value:string)=>new Date(value).toLocaleString(locale,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const topicName=(id:string)=>data.dictionary.find(item=>item.id===id)?.label||id;
  const addSource=async(event:FormEvent)=>{event.preventDefault();const connectionId=source.connectionId||data.bots[0]?.id||'';if(await post('source',{action:'addSource',connectionId,channel:source.channel.trim()},tr?'Kaynak kanal eklendi.':'Source channel added.'))setSource({connectionId,channel:''});};
  const editTopics=()=>setTopics(data.dictionary.length?data.dictionary.map(item=>({id:item.id,label:item.label,terms:item.terms.join(', ')})):[{id:'',label:'',terms:''}]);
  const saveTopics=async()=>{if(!topics)return;const dictionary:Partial<MessagingTopic>[]=topics.filter(item=>item.label.trim()||item.terms.trim()).map(item=>({...(item.id?{id:item.id}:{}),label:item.label.trim(),terms:item.terms.split(',').map(term=>term.trim()).filter(Boolean)}));
    if(await post('dictionary',{action:'dictionary',dictionary,expectedRevision:data.dictionaryRevision},tr?'Sözlük kaydedildi; gönderiler yeniden etiketlendi.':'Dictionary saved; posts were tagged again.'))setTopics(null);};
  const shown=data.posts.filter(item=>item.state===filter&&(!topic||item.topics.includes(topic)));
  const sourceError=(code:string|null)=>code==='webhook'?(tr?'Bu botta webhook tanımlı; Telegram aynı anda okuma izni vermiyor. Webhook kaldırılmalı.':'This bot has a webhook set; Telegram does not allow reading at the same time. Remove the webhook.'):code?(tr?'Son okuma başarısız oldu. Bot belirtecini ve bağlantıyı kontrol edin.':'The last read failed. Check the bot token and the connection.'):null;
  return <section className="ads-center messaging-center" aria-labelledby="messaging-title">
    <div className="studio-section-title"><h2 id="messaging-title">{tr?'Mesajlaşma kaynakları':'Messaging sources'}</h2>{data.me['source.read']&&<span className="studio-badge">{tr?`Bugün ${data.readsLeft} okuma hakkı`:`${data.readsLeft} reads left today`}</span>}</div>
    <p className="studio-note">{tr?'Projenin Telegram botu, yalnız kanal yöneticisinin botu eklediği kanallardaki gönderileri okuyabilir. Gruplar ve özel sohbetler okunmaz; e-posta, telefon ve @kullanıcı adları saklanmadan önce gizlenir. Okunan gönderiler ekibin kendi içerik önerilerine dönüşür; buradan hiçbir şey yayınlanmaz.':'The project’s Telegram bot can only read posts in channels whose administrator added the bot. Groups and private chats are never read; emails, phone numbers and @handles are masked before anything is stored. Posts become the team’s own content suggestions; nothing is published from here.'}</p>
    <p className="coach-muted">{tr?'Görevleriniz: ':'Your duties: '}{MESSAGING_DUTIES.filter(duty=>data.me[duty]).map(duty=>DUTIES[duty][idx]).join(', ')||(tr?'yok':'none')}</p>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}{notice&&<p className="coach-note" role="status">{notice}</p>}

    <div className="ads-account"><h3>{tr?'Kaynak kanallar':'Source channels'}</h3>
      {data.sources.length?<ul className="ads-list">{data.sources.map(item=><li key={item.id} className="studio-draft-row">
        <div className="studio-draft-top"><div><strong>{item.title}</strong>{item.username&&<span className="coach-muted"> · @{item.username}</span>}<p className="coach-muted">{tr?'Bot':'Bot'}: {item.botName} · {item.lastReadAt?(tr?`son okuma ${when(item.lastReadAt)}`:`last read ${when(item.lastReadAt)}`):(tr?'henüz okunmadı':'not read yet')}</p>
          {sourceError(item.lastError)&&<p className="studio-error">{sourceError(item.lastError)}</p>}</div>
          {data.canConnect&&<div className="coach-action-buttons">
            <label className="automation-choice"><input type="checkbox" checked={item.autoRead} disabled={Boolean(busy)||!item.autoRead&&!data.me['source.read']} onChange={event=>void post(item.id,{action:'autoRead',id:item.id,expectedRevision:item.revision,autoRead:event.target.checked})}/>{tr?'30 dakikada bir otomatik oku':'Read automatically every 30 minutes'}</label>
            <button type="button" className="studio-text-button" aria-label={tr?`${item.title} kaynağını kaldır`:`Remove ${item.title}`} disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'removeSource',id:item.id},tr?'Kaynak ve okunan gönderileri kaldırıldı.':'Source and its posts removed.')}><Trash2 size={14}/></button>
          </div>}</div></li>)}</ul>:<p className="coach-muted">{tr?'Henüz kaynak kanal yok.':'No source channels yet.'}</p>}
      {data.canConnect&&(data.bots.length?<form className="ads-form-row" onSubmit={event=>void addSource(event)}>
        <label>{tr?'Bot':'Bot'}<select value={source.connectionId||data.bots[0].id} onChange={event=>setSource(old=>({...old,connectionId:event.target.value}))}>{data.bots.map(bot=><option key={bot.id} value={bot.id}>{bot.name} ({bot.channel})</option>)}</select></label>
        <label>{tr?'Kaynak kanal':'Source channel'}<input value={source.channel} placeholder="@kanal_adi" maxLength={40} onChange={event=>setSource(old=>({...old,channel:event.target.value}))}/></label>
        <button type="submit" className="studio-secondary" disabled={Boolean(busy)||!source.channel.trim()}><Plus size={14}/>{tr?'Kanal ekle':'Add channel'}</button>
      </form>:<p className="coach-muted">{tr?'Önce Proje ayarları → Bağlantılar bölümünden bir Telegram botu bağlayın. Ardından botu, okumak istediğiniz kanala o kanalın yöneticisi eklemelidir.':'First connect a Telegram bot under Project settings → Connections. Then that channel’s administrator must add the bot to the channel you want to read.'}</p>)}
      {data.me['source.read']&&data.sources.length>0&&<div><button type="button" className="studio-secondary" disabled={Boolean(busy)||data.readsLeft<1} onClick={()=>void post('read',{action:'read'},tr?'Kanallar okundu.':'Channels read.')}><RefreshCw size={14}/>{busy==='read'?(tr?'Okunuyor…':'Reading…'):(tr?'Şimdi oku':'Read now')}</button>
        <p className="coach-muted">{tr?'Telegram bekleyen kanal gönderilerini yaklaşık 24 saat tutar; düzenli okumak için otomatik okumayı açın. Gönderiler 90 gün sonra silinir.':'Telegram keeps waiting channel posts for about 24 hours; turn on automatic reading to read regularly. Posts are deleted after 90 days.'}</p></div>}
    </div>

    <div className="ads-account"><div className="studio-section-title"><h3><BookText size={14}/> {tr?'Sektör sözlüğü':'Sector dictionary'}</h3>{data.me.suggest&&!topics&&<button type="button" className="studio-text-button" onClick={editTopics}>{tr?'Düzenle':'Edit'}</button>}</div>
      {topics?<div className="messaging-topics">{topics.map((item,index)=><div key={index} className="ads-form-row">
          <label>{tr?'Konu':'Topic'}<input value={item.label} maxLength={60} onChange={event=>setTopics(old=>old!.map((row,i)=>i===index?{...row,label:event.target.value}:row))}/></label>
          <label>{tr?'Terimler (virgülle)':'Terms (comma separated)'}<input value={item.terms} onChange={event=>setTopics(old=>old!.map((row,i)=>i===index?{...row,terms:event.target.value}:row))}/></label>
          <button type="button" className="studio-text-button" aria-label={tr?'Konuyu sil':'Delete topic'} onClick={()=>setTopics(old=>old!.filter((_,i)=>i!==index))}><Trash2 size={14}/></button></div>)}
        <div className="coach-action-buttons"><button type="button" className="studio-text-button" disabled={topics.length>=20} onClick={()=>setTopics(old=>[...old!,{id:'',label:'',terms:''}])}><Plus size={14}/>{tr?'Konu ekle':'Add topic'}</button>
          <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void saveTopics()}><Save size={14}/>{tr?'Sözlüğü kaydet':'Save dictionary'}</button><button type="button" className="studio-text-button" onClick={()=>setTopics(null)}>{tr?'Vazgeç':'Cancel'}</button></div></div>
        :data.dictionary.length?<ul className="messaging-dictionary">{data.dictionary.map(item=><li key={item.id}><strong>{item.label}</strong>: {item.terms.join(', ')}</li>)}</ul>:<p className="coach-muted">{tr?'Sözlük boş. Konuları ve onları belirleyen kelimeleri ekleyin; okunan gönderiler bu konularla etiketlenir.':'The dictionary is empty. Add topics and the words that mark them; posts read are tagged with these topics.'}</p>}
    </div>

    {data.me['source.read']&&<div className="ads-account"><h3>{tr?'Okunan gönderiler':'Posts read'}</h3>
      <div className="publication-view-tabs" role="tablist" aria-label={tr?'Gönderi durumu':'Post state'}>{(Object.keys(STATES) as State[]).map(state=><button key={state} role="tab" aria-selected={filter===state} tabIndex={filter===state?0:-1} onClick={()=>setFilter(state)}>{STATES[state][idx]} ({data.counts[state]})</button>)}</div>
      {data.dictionary.length>0&&<label className="budget-currency">{tr?'Konu':'Topic'}<select value={topic} onChange={event=>setTopic(event.target.value)}><option value="">{tr?'Tümü':'All'}</option>{data.dictionary.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {shown.length?<ul className="ads-list">{shown.map(item=><li key={item.id} className="studio-draft-row">
        <p className="coach-muted">{item.sourceTitle} · {when(item.postedAt)}{item.link&&<> · <a href={item.link} target="_blank" rel="noreferrer">{tr?'Telegram’da aç':'Open in Telegram'}</a></>}</p>
        {item.topics.length>0&&<p>{item.topics.map(id=><span key={id} className="coach-state">{topicName(id)}</span>)}</p>}
        <p className="messaging-text">{item.text}</p>
        {item.suggestion&&<p className="coach-note">{tr?'Ekibin önerisi: ':'Team suggestion: '}{item.suggestion}{item.contentId&&<> · <a href="/?tab=library">{tr?'Taslak içerik kütüphanesinde':'Draft is in the content library'}</a></>}</p>}
        {data.me.suggest&&<div className="messaging-suggest">
          {item.state!=='dismissed'&&!item.contentId&&<><label className="sr-only" htmlFor={`suggest-${item.id}`}>{tr?'Kendi öneriniz':'Your suggestion'}</label>
            <textarea id={`suggest-${item.id}`} rows={3} maxLength={1000} placeholder={tr?'Bu gönderiden esinlenen kendi içerik fikriniz (kopya değil).':'Your own content idea inspired by this post (not a copy).'} value={drafts[item.id]??item.suggestion} onChange={event=>setDrafts(old=>({...old,[item.id]:event.target.value}))}/>
            <div className="coach-action-buttons">
              <button type="button" className="studio-text-button" disabled={Boolean(busy)||!(drafts[item.id]??item.suggestion).trim()} onClick={()=>void post(item.id,{action:'suggest',id:item.id,expectedRevision:item.revision,suggestion:drafts[item.id]??item.suggestion},tr?'Öneri kaydedildi.':'Suggestion saved.')}><Save size={14}/>{tr?'Öneri olarak kaydet':'Save as suggestion'}</button>
              <button type="button" className="studio-secondary" disabled={Boolean(busy)||!(drafts[item.id]??item.suggestion).trim()} onClick={()=>void post(item.id,{action:'suggest',id:item.id,expectedRevision:item.revision,suggestion:drafts[item.id]??item.suggestion,draft:true},tr?'Telegram içerik taslağı oluşturuldu. Yayın, yayın görevi olan kişinin onayıyla yapılır.':'Telegram content draft created. Publishing needs someone with the publish duty.')}><FilePlus2 size={14}/>{tr?'Telegram taslağı oluştur':'Create Telegram draft'}</button>
            </div></>}
          <div className="coach-action-buttons">{item.state==='dismissed'?<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'decide',id:item.id,expectedRevision:item.revision,state:'new'})}><Undo2 size={14}/>{tr?'Geri al':'Restore'}</button>
            :item.state==='new'&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void post(item.id,{action:'decide',id:item.id,expectedRevision:item.revision,state:'dismissed'})}><EyeOff size={14}/>{tr?'Gizle':'Hide'}</button>}</div>
        </div>}
      </li>)}</ul>:<p className="coach-muted">{tr?'Bu görünümde gönderi yok.':'No posts in this view.'}</p>}
    </div>}

    {data.members&&<div className="ads-account"><h3><UserCog size={14}/> {tr?'Mesajlaşma görevleri':'Messaging duties'}</h3>
      <p className="coach-muted">{tr?'Her görev ayrıca verilir ve üyenin rolünün yettiği görevlerle sınırlıdır: okuma için okuma, öneri için içerik yazma, yayın için bağlantı, onay ve gönderim yetkileri. Proje sahipleri tüm görevlere sahiptir.':'Each duty is given separately and only where the member’s role allows it: reading needs read access, suggesting needs content writing, publishing needs connection, approval and dispatch rights. Project owners hold every duty.'}</p>
      <div className="studio-table-scroll"><table className="coach-keywords messaging-duties"><caption className="sr-only">{tr?'Mesajlaşma görevleri':'Messaging duties'}</caption>
        <thead><tr><th>{tr?'Üye':'Member'}</th>{MESSAGING_DUTIES.map(duty=><th key={duty}>{DUTIES[duty][idx]}</th>)}</tr></thead>
        <tbody>{data.members.map(member=><tr key={member.userId}><th scope="row">{member.name} <span className="coach-muted">({member.role})</span></th>{MESSAGING_DUTIES.map(duty=><td key={duty}>
          <input type="checkbox" aria-label={`${member.name}: ${DUTIES[duty][idx]}`} checked={member.duties.includes(duty)} disabled={Boolean(busy)||member.implicit||!member.eligible[duty]} onChange={event=>void post(`${member.userId}:${duty}`,{action:'duty',userId:member.userId,duty,granted:event.target.checked})}/></td>)}</tr>)}</tbody></table></div>
    </div>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Kaynak okuma, öneri ve yayın ayrı kararlardır. Başkasının gönderisi kopyalanıp yayınlanmaz; taslak her zaman ekibin kendi metnidir ve Telegram’a yalnız yayın görevi olan kişinin onayıyla gider.':'Reading, suggesting and publishing are separate decisions. Nobody else’s post is copied and published; a draft is always the team’s own text and goes to Telegram only with approval from someone holding the publish duty.'}</p>
  </section>;
}
