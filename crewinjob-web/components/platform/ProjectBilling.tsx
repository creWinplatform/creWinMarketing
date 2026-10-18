'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Check,Clock3,ExternalLink,LockKeyhole,RefreshCw,ShieldCheck,SearchCheck} from 'lucide-react';
import type {Locale} from '@/lib/platform/catalog';
import type {BillingOrderState,BillingCheckReason,ProjectBillingView} from '@/lib/platform/billing-types';
import {projectRequest} from '@/lib/platform/client';

export default function ProjectBilling({lang}:{lang:Locale}){
  const tr=lang==='tr',controller=useRef<AbortController|null>(null),key=useRef(''),checkKeys=useRef<Record<string,string>>({});
  const [data,setData]=useState<ProjectBillingView|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [planId,setPlanId]=useState(''),[name,setName]=useState(''),[phone,setPhone]=useState(''),[address,setAddress]=useState(''),[ack,setAck]=useState(false);
  const [checking,setChecking]=useState(''),[notice,setNotice]=useState('');
  const load=useCallback(async()=>{
    controller.current?.abort();const next=new AbortController();controller.current=next;setLoading(true);setError('');
    try{const result=await projectRequest<ProjectBillingView>('/api/platform/billing',{signal:AbortSignal.any([next.signal,AbortSignal.timeout(15000)])});if(!next.signal.aborted){setData(result);setPlanId(current=>result.plans.some(plan=>plan.id===current)?current:result.plans[0]?.id||'');}}
    catch{if(!next.signal.aborted)setError(tr?'Ödeme test durumu alınamadı. Yeniden deneyin.':'Could not load payment test status. Try again.');}
    finally{if(!next.signal.aborted)setLoading(false);}
  },[tr]);
  useEffect(()=>{void load();return()=>controller.current?.abort();},[load]);
  const money=(amount:number)=>(amount/100).toLocaleString(tr?'tr-TR':'en-US',{style:'currency',currency:'USD'});
  const date=(value:string)=>new Date(value).toLocaleString(tr?'tr-TR':'en-GB',{dateStyle:'short',timeStyle:'short'});
  const labels:Record<BillingOrderState,string>={preparing:tr?'Hazırlanıyor':'Preparing',pending:tr?'Bildirim bekleniyor':'Awaiting notification',test_paid:tr?'Test başarılı':'Test passed',test_failed:tr?'Test başarısız':'Test failed',rejected:tr?'İstek reddedildi':'Request rejected',uncertain:tr?'Sonuç doğrulanmadı':'Outcome unconfirmed',review:tr?'Kontrol gerekli':'Review required'};
  const blocked=Boolean(data?.orders.some(order=>['preparing','pending','uncertain','review'].includes(order.state)));
  const checkReasons:Record<BillingCheckReason,string>={matched:tr?'Test ödemesi doğrulandı':'Test payment confirmed',no_confirmed_payment:tr?'Başarılı ödeme doğrulanamadı; mevcut durum korundu':'Successful payment not confirmed; current state preserved',provider_unavailable:tr?'PayTR yanıtı alınamadı':'PayTR response unavailable',invalid_response:tr?'PayTR yanıtı doğrulanamadı':'PayTR response could not be verified',details_mismatch:tr?'Tutar, para birimi veya test modu uyuşmuyor':'Amount, currency or test mode differs',refund_observed:tr?'İade kaydı var; yönetici kontrolü gerekli':'Refund observed; administrator review required',configuration_changed:tr?'Mağaza ayarları değişti; sonuç uygulanmadı':'Merchant configuration changed; result not applied',authority_lost:tr?'İşlem yetkisi değişti':'Permission changed',order_changed:tr?'Ödeme kaydı değişti; eski sorgu uygulanmadı':'Order changed; stale query not applied',interrupted:tr?'Sorgu kesildi; sonuç doğrulanmadı':'Inquiry interrupted; outcome unconfirmed',review_required:tr?'Test ödemesi gözlendi; önceki uyuşmazlık için yönetici kontrolü gerekiyor':'Test payment observed; previous conflict still requires review',contradicting_result:tr?'Önceki sonuçla çelişiyor; yönetici kontrolü gerekli':'Conflicts with the previous result; administrator review required'};
  const check=async(orderId:string)=>{
    if(checking||saving)return;setChecking(orderId);setError('');setNotice('');const identity=controller.current;
    try{
      checkKeys.current[orderId] ||= crypto.randomUUID();
      await projectRequest('/api/platform/billing',{method:'POST',body:JSON.stringify({action:'check',orderId,idempotencyKey:checkKeys.current[orderId]}),signal:AbortSignal.timeout(20000)});
      if(identity?.signal.aborted)return;delete checkKeys.current[orderId];await load();
      setNotice(tr?'Durum sorgusu kaydedildi. Güncel sonuç test ödeme geçmişinde.':'Status inquiry recorded. See the latest result in test payment history.');
    }catch{if(!identity?.signal.aborted)setError(tr?'Sorgu tamamlanamadı. Yenile ile kayıtlı sonucu kontrol edin; yeniden sorgulamalar arasında en az bir dakika bekleyin.':'The inquiry did not complete. Refresh to check the recorded result; allow at least one minute between new inquiries.');}
    finally{setChecking('');}
  };
  const start=async(event:React.FormEvent)=>{
    event.preventDefault();if(saving||checking||!ack)return;setSaving(true);setError('');setNotice('');
    const identity=controller.current;
    try{
      key.current ||= crypto.randomUUID();
      await projectRequest('/api/platform/billing',{method:'POST',body:JSON.stringify({action:'start',planId,idempotencyKey:key.current,language:lang,contact:{name,phone,address}}),signal:AbortSignal.timeout(20000)});
      if(identity?.signal.aborted)return;
      setAck(false);await load();
    }catch{if(!identity?.signal.aborted){setError(tr?'Test isteği tamamlanamadı. Yenile ile mevcut durumu kontrol edin; aynı deneme tekrar tahsilat başlatmaz.':'The test request did not complete. Refresh to check its status; retrying this attempt does not start another charge.');}}
    finally{setSaving(false);}
  };
  const edit=()=>{key.current='';setAck(false);};
  return <section className="studio-band billing-section" aria-busy={loading||saving||Boolean(checking)}>
    <header className="studio-section-title"><h3><ShieldCheck size={17}/>{tr?'PayTR test ortamı':'PayTR test environment'}</h3><button className="icon-button" disabled={loading||saving||Boolean(checking)} title={tr?'Ödeme durumunu yenile':'Refresh payment status'} aria-label={tr?'Ödeme durumunu yenile':'Refresh payment status'} onClick={load}><RefreshCw size={17} className={loading?'animate-spin':''}/></button></header>
    {error&&<p role="alert" className="studio-error">{error}</p>}
    {notice&&<p role="status" className="studio-note">{notice}</p>}
    {loading&&!data&&<p role="status" className="studio-note">{tr?'Test ortamı kontrol ediliyor…':'Checking test environment…'}</p>}
    {data&&<>
      <div className="billing-status"><strong><LockKeyhole size={16}/>{tr?'Gerçek tahsilat kapalı':'Live payments disabled'}</strong><span className="studio-badge">USD · {tr?'Yalnız test':'Test only'}</span></div>
      <ul className="billing-checks">{[
        [data.readiness.checks.gate,tr?'Test erişimi':'Test access'],
        [data.readiness.checks.credentials,tr?'Mağaza bilgileri':'Merchant credentials'],
        [data.readiness.checks.usdAcknowledged,tr?'USD yetkisi teyidi':'USD access acknowledgement'],
        [data.readiness.checks.origin,tr?'HTTPS dönüş adresi':'HTTPS return origin'],
        [data.readiness.checks.catalog,tr?'Test fiyat kataloğu':'Test price catalog'],
        [data.emailVerified,tr?'Doğrulanmış hesap e-postası':'Verified account email'],
      ].map(([ready,label])=><li key={String(label)}><span className={ready?'billing-check-ready':'billing-check-pending'}>{ready?<Check size={14}/>:<Clock3 size={14}/>}</span><span>{label}</span><small>{ready?(tr?'Tanımlı':'Configured'):(tr?'Bekliyor':'Pending')}</small></li>)}</ul>
      {!data.readiness.ready&&<p className="studio-note">{tr?'PayTR test kurulumu tamamlanmadı. Yukarıdaki eksik yapılandırmaları kontrol edin.':'PayTR test setup is incomplete. Check the pending configuration above.'}</p>}
      {data.readiness.ready&&!data.emailVerified&&<a className="studio-text-button" href="/?tab=project&settings=team">{tr?'Hesap e-postasını doğrula':'Verify account email'}<ExternalLink size={14}/></a>}
      {data.readiness.ready&&data.emailVerified&&!blocked&&<form className="billing-test-form" onSubmit={start}>
        <fieldset className="studio-form-grid" disabled={saving||Boolean(checking)}>
          <label>{tr?'Test paketi':'Test plan'}<select value={planId} onChange={event=>{setPlanId(event.target.value);edit();}}>{data.plans.map(plan=><option key={plan.id} value={plan.id}>{plan.name} · {money(plan.amountMinor)} · {plan.cadence==='monthly'?(tr?'Aylık':'Monthly'):(tr?'Yıllık':'Yearly')}</option>)}</select></label>
          <label>{tr?'Ad soyad':'Full name'}<input autoComplete="name" required minLength={2} maxLength={60} value={name} onChange={event=>{setName(event.target.value);edit();}}/></label>
          <label>{tr?'Telefon':'Phone'}<input autoComplete="tel" type="tel" required minLength={5} maxLength={20} value={phone} onChange={event=>{setPhone(event.target.value);edit();}}/></label>
          <label>{tr?'Fatura adresi':'Billing address'}<input autoComplete="street-address" required minLength={5} maxLength={400} value={address} onChange={event=>{setAddress(event.target.value);edit();}}/></label>
        </fieldset>
        <label className="billing-ack"><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)} disabled={saving||Boolean(checking)}/><span>{tr?'Ad, telefon, adres ve doğrulanmış hesap e-postamın test ödemesi için PayTR’a gönderilmesini onaylıyorum.':'I approve sending my name, phone, address and verified account email to PayTR for this test payment.'}</span></label>
        <button className="studio-secondary" disabled={saving||Boolean(checking)||!ack||!planId} type="submit">{saving?(tr?'Test hazırlanıyor…':'Preparing test…'):(tr?'PayTR test ödemesini hazırla':'Prepare PayTR test payment')}<ExternalLink size={15}/></button>
      </form>}
      {blocked&&<p className="studio-note">{tr?'Sonucu beklenen test var. Mağaza test kurulumu hazır olduğunda “PayTR’dan sorgula” ile kontrol edin. Belirsiz veya çelişkili sonuç yeni ödeme açmaz.':'A test is awaiting a confirmed outcome. Use “Check with PayTR” once merchant test setup is ready. Uncertain or conflicting results do not enable another payment.'}</p>}
      <div className="billing-history"><h4>{tr?'Test ödeme geçmişi':'Test payment history'}</h4>{data.orders.length===0?<p className="studio-note">{tr?'Henüz test ödeme kaydı yok.':'No test payments yet.'}</p>:<div className="studio-table-scroll" tabIndex={0} role="region" aria-label={tr?'Test ödeme geçmişi tablosu':'Test payment history table'}><table className="studio-table billing-inquiry-table"><thead><tr><th>{tr?'Test paketi':'Test plan'}</th><th>{tr?'Tutar':'Amount'}</th><th>{tr?'Durum / kaynak':'Status / source'}</th><th>{tr?'Son PayTR sorgusu':'Latest PayTR inquiry'}</th><th>{tr?'İşlem':'Action'}</th></tr></thead><tbody>{data.orders.map(order=><tr key={order.id}>
        <td>{order.planName}<small>{order.id}</small><small>{date(order.createdAt)}</small></td><td>{money(order.amountMinor)}</td>
        <td>{labels[order.state]}{order.settlementSource&&<small>{order.settlementSource==='notification'?(tr?'İmzalı bildirim':'Signed notification'):(tr?'PayTR durum sorgusu':'PayTR status inquiry')}</small>}</td>
        <td className="billing-check-result">{order.latestCheck?<><span>{order.latestCheck.interrupted?checkReasons.interrupted:order.latestCheck.reason?checkReasons[order.latestCheck.reason]:(tr?'Sorgulanıyor…':'Checking…')}</span><small>{date(order.latestCheck.completedAt||order.latestCheck.createdAt)}</small></>:<span>{tr?'Henüz sorgulanmadı':'Not checked yet'}</span>}</td>
        <td><div className="billing-order-actions">{order.checkoutUrl?<a className="studio-text-button" target="_blank" rel="noreferrer" href={order.checkoutUrl}>{tr?'PayTR test formu':'PayTR test form'}<ExternalLink size={14}/></a>:order.state==='pending'&&Date.parse(order.expiresAt)<Date.now()?<small>{tr?'Bağlantı süresi doldu':'Link expired'}</small>:null}<button className="studio-secondary" disabled={!order.canCheck||Boolean(checking)||saving||loading} title={!data.statusCheckEnabled?(tr?'PayTR mağaza test kurulumu gerekli':'PayTR merchant test setup required'):!order.canCheck?(tr?'Sorgu aralığını veya mağaza bilgilerini kontrol edin':'Check the inquiry interval or merchant settings'):(tr?'PayTR’daki test sonucunu kontrol et':'Check this test result with PayTR')} onClick={()=>check(order.id)}><SearchCheck size={15}/>{checking===order.id?(tr?'Sorgulanıyor…':'Checking…'):(tr?'PayTR’dan sorgula':'Check with PayTR')}</button></div></td>
      </tr>)}</tbody></table></div>}</div>
      <p className="plan-boundary"><LockKeyhole size={15}/>{tr?'Test ödemeleri abonelik başlatmaz, kota değiştirmez ve fatura oluşturmaz.':'Test payments do not start a subscription, change quotas or create invoices.'}</p>
    </>}
  </section>;
}
