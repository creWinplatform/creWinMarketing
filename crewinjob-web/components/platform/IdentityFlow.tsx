'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowLeft,ArrowRight,Check,LoaderCircle,Mail,ShieldCheck} from 'lucide-react';
import {useLang} from '@/lib/lang';
import Brand from './Brand';

type Kind='verify'|'reset'|'signup';
async function send(body:object,signal?:AbortSignal){
  const response=await fetch('/api/auth/identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal||AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('request');
}
export default function IdentityFlow({kind}:{kind:Kind}){
  const {lang}=useLang(),tr=lang==='tr',started=useRef(false);
  const [token,setToken]=useState(''),[checking,setChecking]=useState(true),[invalid,setInvalid]=useState(false),[enabled,setEnabled]=useState(false),[unavailable,setUnavailable]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false),[requested,setRequested]=useState(false);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[organizationName,setOrganizationName]=useState(''),[projectName,setProjectName]=useState(''),[website,setWebsite]=useState('');
  useEffect(()=>{
    if(started.current)return;started.current=true;
    const value=new URLSearchParams(window.location.hash.slice(1)).get('token')||'';
    window.history.replaceState({},'',window.location.pathname);
    setToken(value);
    (async()=>{
      try{
        const response=await fetch('/api/auth/identity',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();
        const caps=await response.json();setEnabled(kind==='signup'?caps.signupEnabled:caps.emailEnabled);
        if(value){try{await send({action:'inspect',kind,token:value});}catch{setInvalid(true);}}
      }catch{setUnavailable(true);}finally{setChecking(false);}
    })();
  },[kind]);
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;setError('');
    if(token&&kind!=='verify'&&password!==confirm){setError(tr?'Şifreler eşleşmiyor.':'Passwords do not match.');return;}
    setBusy(true);
    try{
      if(!token){await send({action:kind==='signup'?'request-signup':'request-reset',email,language:lang});setRequested(true);}
      else{
        await send({action:kind==='verify'?'verify':kind==='reset'?'reset':'register',token,password,organizationName,projectName,website,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});
        setToken('');setPassword('');setConfirm('');setDone(true);
      }
    }catch{setError(tr?'İşlem tamamlanamadı. Bağlantı süresi dolmuş olabilir; yeni bağlantı isteyin veya tekrar deneyin.':'Could not complete the request. The link may have expired; request a new link or try again.');}
    finally{setBusy(false);}
  };
  const title=kind==='verify'?(tr?'E-postanızı doğrulayın':'Verify your email'):kind==='reset'?(tr?'Hesabınıza geri dönün':'Get back to your account'):(tr?'Çalışma alanınızı oluşturun':'Create your workspace');
  return <main className="auth-page ryz-join identity-page" lang={lang}>
    <a className="identity-brand" href="/welcome" aria-label="Ryzevo"><Brand /></a>
    <section className="auth-form-surface">
      <div className="identity-symbol">{done?<Check size={22}/>:kind==='verify'?<ShieldCheck size={22}/>:<Mail size={22}/>}</div>
      <h1>{done?(tr?'Tamamlandı':'All set'):title}</h1>
      {checking?<p role="status"><LoaderCircle size={16} className="animate-spin"/> {tr?'Kontrol ediliyor…':'Checking…'}</p>:done?<>
        <p role="status">{kind==='verify'?(tr?'E-posta doğrulandı. Hesap ayarlarınıza geri dönebilirsiniz.':'Email verified. You can return to account settings.'):kind==='reset'?(tr?'Şifreniz güncellendi. Tüm eski oturumlar kapatıldı.':'Password updated. All previous sessions are invalidated.'):(tr?'Çalışma alanınız hazır. E-posta adresinizle giriş yapın.':'Your workspace is ready. Sign in with your email.')}</p>
        <a className="studio-primary identity-link" href={kind==='verify'?'/':kind==='reset'?'/login?updated=1':'/login'}><ArrowRight size={16}/>{tr?'Devam et':'Continue'}</a>
      </>:invalid?<><p role="alert" className="studio-error">{tr?'Bu bağlantı kullanılmış, geçersiz veya süresi dolmuş.':'This link is invalid, expired or already used.'}</p><a className="studio-text-button" href={kind==='verify'?'/':kind==='signup'?'/register':'/recover'}>{tr?'Yeni bağlantı iste':'Request a new link'}<ArrowRight size={15}/></a></>:unavailable||!enabled?<p role="status">{unavailable?(tr?'Sunucuya ulaşılamadı. Sayfayı yenileyerek tekrar deneyin.':'The server is unavailable. Reload to try again.'):kind==='signup'?(tr?'Kayıt şu an davetle açık. Ekibinizden davet bağlantısı isteyin.':'Registration is invitation-only. Ask your team for an invitation link.'):(tr?'Hesap e-postaları henüz etkin değil. Çalışma alanı yöneticinizle iletişime geçin.':'Account emails are not enabled yet. Contact your workspace administrator.')}</p>:requested?<p role="status" className="identity-message">{tr?'Adres uygunsa devam bağlantısı gönderim kuyruğuna alındı. Gelen kutunuzu ve spam klasörünü kontrol edin. Yeni istek için en az bir saat bekleyin.':'If the address is eligible, a link has been queued. Check your inbox and spam folder. Wait at least one hour before requesting another link.'}</p>:kind==='verify'&&!token?<p>{tr?'Doğrulama bağlantısını hesap ayarlarınızdan isteyin.':'Request a verification link from account settings.'}</p>:<>
        <p>{token?(kind==='verify'?(tr?'E-posta adresini hesabınıza bağlamak için onaylayın.':'Confirm to link this email to your account.'):(tr?'En az 12 karakterden oluşan bir şifre belirleyin.':'Choose a password with at least 12 characters.')):kind==='signup'?(tr?'Önce e-posta adresinizi doğrulayalım.':'First, verify your email address.'):(tr?'Hesabınıza bağlı doğrulanmış e-posta adresini girin. Kullanıcı adınız değişmez.':'Enter the verified email linked to your account. Your username stays the same.')}</p>
        <form onSubmit={submit}><fieldset disabled={busy} className="identity-fields">
          {!token?<label>{tr?'E-posta adresi':'Email address'}<input type="email" required maxLength={160} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>:<>
            {kind==='signup'&&<><label>{tr?'Organizasyon adı':'Organization name'}<input required maxLength={160} autoComplete="organization" value={organizationName} onChange={e=>setOrganizationName(e.target.value)}/></label><label>{tr?'Proje adı':'Project name'}<input required maxLength={160} value={projectName} onChange={e=>setProjectName(e.target.value)}/></label><label>{tr?'Web sitesi':'Website'}<input type="url" required maxLength={2000} placeholder="https://" value={website} onChange={e=>setWebsite(e.target.value)}/></label></>}
            {kind!=='verify'&&<><label>{tr?'Yeni şifre':'New password'}<input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>{tr?'Şifre tekrar':'Repeat password'}<input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label></>}
          </>}
          {error&&<p role="alert" className="studio-error">{error}</p>}
          <button className="studio-primary">{busy?<LoaderCircle size={16} className="animate-spin"/>:<ArrowRight size={16}/>} {busy?(tr?'İşleniyor…':'Working…'):token?(tr?'Onayla ve devam et':'Confirm and continue'):(tr?'Bağlantı gönder':'Send link')}</button>
        </fieldset></form>
      </>}
      <a className="studio-text-button identity-back" href="/login"><ArrowLeft size={14}/>{tr?'Girişe dön':'Back to sign in'}</a>
    </section>
  </main>;
}
