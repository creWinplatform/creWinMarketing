'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { MemberInvite } from '@/lib/platform/member-invites-types';
import Msg from '@/components/Msg';

// Invite someone who already has a Ryzevo account (an agency, a consultant) by their verified email. They accept it on
// their own "All projects" page; the answer never reveals whether such an account exists.
export default function ProjectAccountInvites({lang,isOwner}:{lang:Locale;isOwner:boolean}){
  const tr=lang==='tr',locale=localeTag(lang);
  const [items,setItems]=useState<MemberInvite[]|null>(null),[email,setEmail]=useState(''),[role,setRole]=useState<MemberInvite['role']>('editor'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;projectRequest<{items:MemberInvite[]}>('/api/platform/member-invites',{signal:AbortSignal.timeout(15000)}).then(value=>{if(mounted.current)setItems(value.items);}).catch(()=>{if(mounted.current)setItems([]);});return()=>{mounted.current=false;};},[]);
  async function act(body:Record<string,unknown>,success:string){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{const value=await projectRequest<{items:MemberInvite[]}>('/api/platform/member-invites',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(mounted.current){setItems(value.items);setNotice(success);if(body.action==='invite')setEmail('');}}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}
    finally{if(mounted.current)setBusy(false);}
  }
  const roles:Record<MemberInvite['role'],string>=tr?{admin:'Yönetici',editor:'Editör',analyst:'Analist',viewer:'Görüntüleyici'}:{admin:'Admin',editor:'Editor',analyst:'Analyst',viewer:'Viewer'};
  const states:Record<MemberInvite['state'],string>=tr?{pending:'Bekliyor',accepted:'Kabul edildi',declined:'Reddedildi',revoked:'Geri alındı',expired:'Süresi doldu'}:{pending:'Pending',accepted:'Accepted',declined:'Declined',revoked:'Revoked',expired:'Expired'};
  const date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'short',year:'numeric'});
  const submit=(event:FormEvent)=>{event.preventDefault();void act({action:'invite',email,role},tr?'Davet kaydedildi. Bu e-postayla doğrulanmış bir Ryzevo hesabı varsa davet o hesabın Tüm projeler sayfasında görünür.':'Invitation saved. If a Ryzevo account with this verified email exists, the invitation appears on its All projects page.');};
  return <section className="studio-band account-invites" aria-labelledby="account-invites-title" aria-busy={busy}>
    <div className="studio-section-title"><h2 id="account-invites-title"><UserPlus size={16}/>{tr?'Var olan bir hesabı davet et':'Invite an existing account'}</h2></div>
    <p className="studio-note">{tr?'Ajansınız veya danışmanınız zaten Ryzevo kullanıyorsa, doğrulanmış e-postasıyla davet edin. Kendi hesabıyla kabul eder ve projeniz onun Tüm projeler sayfasına eklenir. Erişimi aşağıdaki ekip listesinden istediğiniz an kapatabilirsiniz. Davet 14 gün geçerlidir.':'If your agency or consultant already uses Ryzevo, invite them by their verified email. They accept with their own account and your project is added to their All projects page. You can remove their access from the team list at any time. Invitations last 14 days.'}</p>
    {error&&<p role="alert" className="studio-error"><Msg text={error}/></p>}{notice&&<p role="status" className="studio-success">{notice}</p>}
    <form className="studio-form-grid" onSubmit={submit}>
      <label>{tr?'E-posta':'Email'}<input type="email" required maxLength={160} autoComplete="off" value={email} disabled={busy} onChange={event=>setEmail(event.target.value)}/></label>
      <label>{tr?'Rol':'Role'}<select value={role} disabled={busy} onChange={event=>setRole(event.target.value as MemberInvite['role'])}>{(['editor','analyst','viewer',...(isOwner?['admin' as const]:[])] as MemberInvite['role'][]).map(value=><option key={value} value={value}>{roles[value]}</option>)}</select></label>
      <div className="studio-form-actions studio-form-full"><button className="studio-primary" disabled={busy||!email}>{tr?'Davet et':'Invite'}</button></div>
    </form>
    {items&&items.length>0&&<div className="studio-table-scroll" tabIndex={0} role="region" aria-label={tr?'Davetler':'Invitations'}><table className="studio-table"><thead><tr><th scope="col">{tr?'E-posta':'Email'}</th><th scope="col">{tr?'Rol':'Role'}</th><th scope="col">{tr?'Durum':'Status'}</th><th scope="col">{tr?'Bitiş':'Expires'}</th><th scope="col"><span className="sr-only">{tr?'İşlem':'Action'}</span></th></tr></thead>
      <tbody>{items.map(item=><tr key={item.id}><td>{item.maskedEmail}</td><td>{roles[item.role]}</td><td>{states[item.state]}</td><td>{date(item.expiresAt)}</td><td>{item.state==='pending'&&<button type="button" className="studio-text-button" disabled={busy} onClick={()=>void act({action:'revoke',id:item.id},tr?'Davet geri alındı.':'Invitation revoked.')}>{tr?'Geri al':'Revoke'}</button>}</td></tr>)}</tbody></table></div>}
  </section>;
}
