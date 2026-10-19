'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {MailCheck,ArrowRight,RefreshCw} from 'lucide-react';
import {projectRequest} from '@/lib/platform/client';
import Msg from '@/components/Msg';

type State={emailEnabled:boolean;email:string|null;verifiedAt:string|null};
export default function AccountEmail({tr}:{tr:boolean}){
  const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[email,setEmail]=useState(''),[password,setPassword]=useState('');
  const load=async()=>{setError('');try{setState(await projectRequest<State>('/api/platform/identity'));}catch{setError(tr?'Hesap bilgisi alınamadı.':'Could not load account details.');}};
  useEffect(()=>{void load();},[]); // Account identity is independent of project selection.
  const submit=async(e:FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await projectRequest('/api/platform/identity',{method:'POST',body:JSON.stringify({email,currentPassword:password,language:tr?'tr':'en'})});setPassword('');setDone(true);}catch{setError(tr?'İşlem tamamlanamadı. Mevcut şifreyi ve adresi kontrol edin; çok sayıda istekte bir saat bekleyin.':'Could not start verification. Check the current password and email; wait an hour after repeated requests.');}finally{setBusy(false);}};
  return <section className="studio-editor"><h3 className="flex items-center gap-2 text-sm font-semibold"><MailCheck size={17}/>{tr?'Kurtarma e-postası':'Recovery email'}</h3>
    {error&&<p role="alert" className="studio-error"><Msg text={error}/> {!state&&<button type="button" className="icon-button" onClick={load} title={tr?'Tekrar dene':'Retry'} aria-label={tr?'Tekrar dene':'Retry'}><RefreshCw size={16}/></button>}</p>}
    {!state&&!error?<p role="status">{tr?'Yükleniyor…':'Loading…'}</p>:state?.email?<><p className="studio-success"><MailCheck size={16}/> {state.email}</p><p className="studio-note">{tr?'Doğrulandı. Giriş ekranından şifre kurtarma isteyebilirsiniz; kullanıcı adınız değişmedi.':'Verified. You can request password recovery from sign in; your username is unchanged.'}</p></>:!state?.emailEnabled?<p className="studio-note">{tr?'Ryzevo hesap e-postası gönderimi henüz etkin değil. Mevcut giriş ve davetler çalışmaya devam eder.':'Ryzevo account email delivery is not enabled yet. Existing sign-in and invitations still work.'}</p>:done?<p role="status" className="studio-success">{tr?'Doğrulama bağlantısı kuyruğa alındı. E-postadaki bağlantıyı açıp onaylayın; ardından bu sayfayı yenileyin.':'Verification link queued. Open the email link and confirm, then refresh this page.'}</p>:<form onSubmit={submit}><div className="studio-form-grid"><label>{tr?'Kurtarma e-posta adresi':'Recovery email address'}<input type="email" required maxLength={160} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label><label>{tr?'Mevcut şifre':'Current password'}<input type="password" required maxLength={256} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label></div><div className="studio-form-actions"><button className="studio-primary" disabled={busy}><ArrowRight size={16}/>{busy?(tr?'Hazırlanıyor…':'Preparing…'):(tr?'E-postayı doğrula':'Verify email')}</button></div></form>}
  </section>;
}
