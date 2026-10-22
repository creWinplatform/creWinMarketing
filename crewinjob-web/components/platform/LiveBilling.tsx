'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {CreditCard,ExternalLink,LockKeyhole,RefreshCw} from 'lucide-react';
import type {Locale} from '@/lib/platform/catalog';
import type {LiveBillingOrderState,LiveBillingView} from '@/lib/platform/billing-types';
import {projectRequest} from '@/lib/platform/client';
import {localeTag} from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
import {onTabKeys} from './tab-keys';

// Live plan purchase: prepaid monthly or yearly periods, no stored card and no automatic renewal. Paid rights start
// only after PayTR's signed confirmation; the page never treats a returning browser as proof of payment.
export default function LiveBilling({lang}:{lang:Locale}){
  const tr=lang==='tr',controller=useRef<AbortController|null>(null),key=useRef('');
  const [data,setData]=useState<LiveBillingView|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [cadence,setCadence]=useState<'monthly'|'yearly'>('monthly'),[planId,setPlanId]=useState<'launch'|'growth'>('launch');
  const [name,setName]=useState(''),[phone,setPhone]=useState(''),[address,setAddress]=useState(''),[terms,setTerms]=useState(false);
  const load=useCallback(async()=>{
    controller.current?.abort();const next=new AbortController();controller.current=next;setLoading(true);setError('');
    try{const result=await projectRequest<LiveBillingView>('/api/platform/billing/live',{signal:AbortSignal.any([next.signal,AbortSignal.timeout(15000)])});if(!next.signal.aborted){setData(result);if(result.current)setPlanId(result.current.planId);}}
    catch{if(!next.signal.aborted)setError(tr?'Plan ödeme bilgisi alınamadı. Yeniden deneyin.':'Could not load plan payments. Try again.');}
    finally{if(!next.signal.aborted)setLoading(false);}
  },[tr]);
  useEffect(()=>{void load();return()=>controller.current?.abort();},[load]);
  if(!data||!data.enabled)return null;
  const money=(amount:number)=>(amount/100).toLocaleString(tr?localeTag(lang):'en-US',{style:'currency',currency:'USD'});
  const day=(value:string)=>new Date(value).toLocaleDateString(localeTag(lang),{dateStyle:'long'});
  const states:Record<LiveBillingOrderState,string>={preparing:tr?'Hazırlanıyor':'Preparing',pending:tr?'Ödeme bekleniyor':'Awaiting payment',paid:tr?'Ödendi':'Paid',failed:tr?'Ödeme başarısız':'Payment failed',rejected:tr?'İstek reddedildi':'Request rejected',uncertain:tr?'Sonuç belirsiz':'Outcome unclear',review:tr?'İnceleniyor':'Under review'};
  const plans=data.plans.filter(plan=>plan.cadence===cadence),chosen=plans.find(plan=>plan.id===planId)||plans[0];
  const edit=()=>{key.current='';setTerms(false);};
  const start=async(event:React.FormEvent)=>{
    event.preventDefault();if(saving||!terms||!chosen)return;setSaving(true);setError('');const identity=controller.current;
    try{key.current||=crypto.randomUUID();
      await projectRequest('/api/platform/billing/live',{method:'POST',body:JSON.stringify({action:'start',planId:chosen.id,cadence:chosen.cadence,idempotencyKey:key.current,acceptTerms:true,language:lang,contact:{name,phone,address}}),signal:AbortSignal.timeout(20000)});
      if(identity?.signal.aborted)return;setTerms(false);await load();}
    catch(reason){if(!identity?.signal.aborted)setError(reason instanceof Error?reason.message:(tr?'Ödeme hazırlanamadı. Yenile ile durumu kontrol edin; aynı deneme ikinci kez tahsilat başlatmaz.':'The payment could not be prepared. Refresh to check; retrying the same attempt does not charge twice.'));}
    finally{setSaving(false);}
  };
  const current=data.current;
  return <section className="studio-band billing-section live-billing" aria-busy={loading||saving} aria-labelledby="live-billing-title">
    <header className="studio-section-title"><h3 id="live-billing-title"><CreditCard size={17}/>{tr?'Plan ve ödeme':'Plan and payment'}</h3>
      <button type="button" className="icon-button" disabled={loading||saving} onClick={()=>void load()} aria-label={tr?'Yenile':'Refresh'} title={tr?'Yenile':'Refresh'}><RefreshCw size={16}/></button></header>
    {error&&<p role="alert" className="studio-error"><Msg text={error}/></p>}
    {current?<p className={current.inGrace?'studio-error':'studio-note'} role="status">
      {current.inGrace
        ?(tr?`${data.plans.find(p=>p.id===current.planId)?.name} dönemi ${day(current.endsAt)} tarihinde bitti. ${day(current.graceEndsAt)} tarihine kadar her şey çalışmaya devam eder; sonra yeni üretim durur, kayıtlar korunur.`:`Your ${data.plans.find(p=>p.id===current.planId)?.name} period ended on ${day(current.endsAt)}. Everything keeps working until ${day(current.graceEndsAt)}; then new work stops and your records are kept.`)
        :(tr?`${data.plans.find(p=>p.id===current.planId)?.name} (${current.cadence==='monthly'?'aylık':'yıllık'}) ${day(current.endsAt)} tarihine kadar geçerli. Yenileme otomatik değildir.`:`${data.plans.find(p=>p.id===current.planId)?.name} (${current.cadence}) is valid until ${day(current.endsAt)}. Renewal is not automatic.`)}
    </p>:!data.pilotManaged&&<p className="studio-note">{tr?'Ücretli plan yok. Bir plan seçip peşin ödeyebilirsiniz; kart kaydedilmez ve dönem kendiliğinden yenilenmez.':'No paid plan. Choose a plan and pay in advance; no card is stored and the period does not renew on its own.'}</p>}
    {data.nextStartsAt&&current&&data.nextStartsAt!==current.endsAt&&<p className="studio-note">{tr?`Sonraki dönem ${day(data.nextStartsAt)} tarihine kadar ödendi.`:`Paid through ${day(data.nextStartsAt)}.`}</p>}
    {data.pilotManaged&&<p className="studio-note">{tr?'Bu proje pilot planında; pilot hakları ücretli planla değişmez. Ücretli plana geçiş için ekibimizle iletişime geçin.':'This project is on a pilot plan; a paid plan does not change pilot rights. Contact our team to move to a paid plan.'}</p>}
    {data.purchaseOpensAt&&<p className="studio-note">{tr?`Yenileme ${day(data.purchaseOpensAt)} tarihinde açılır (dönem bitmeden 14 gün önce).`:`Renewal opens on ${day(data.purchaseOpensAt)} (14 days before the period ends).`}</p>}
    {data.openOrder&&<p className="studio-note">{tr?'Sonucu beklenen bir ödeme var. PayTR onayı gelince plan kendiliğinden açılır; çelişkili bir sonuç incelemeye alınır ve plan açmaz.':'A payment is awaiting its outcome. The plan opens when PayTR confirms it; a contradictory result goes to review and opens nothing.'}</p>}
    {data.canPurchase&&<>
      <div className="publication-view-tabs" role="tablist" aria-label={tr?'Ödeme dönemi':'Billing period'} onKeyDown={onTabKeys}>{(['monthly','yearly'] as const).map(value=><button key={value} type="button" role="tab" aria-selected={cadence===value} tabIndex={cadence===value?0:-1} onClick={()=>{setCadence(value);edit();}}>{value==='monthly'?(tr?'Aylık':'Monthly'):(tr?'Yıllık · 2 ay hediye':'Yearly · 2 months free')}</button>)}</div>
      <fieldset className="live-billing-plans"><legend className="sr-only">{tr?'Plan':'Plan'}</legend>{plans.map(plan=><label key={plan.id} className={chosen?.id===plan.id?'selected':''}>
        <input type="radio" name="live-plan" checked={chosen?.id===plan.id} onChange={()=>{setPlanId(plan.id);edit();}}/>
        <span><strong>{plan.name}</strong><span>{money(plan.amountMinor)} / {plan.cadence==='monthly'?(tr?'ay':'month'):(tr?'yıl':'year')}</span>
          <small>{tr?`${plan.seats} ekip üyesi · ${plan.socialAccounts} sosyal hesap · ayda ${plan.ai} AI taslağı · ${plan.audits} site denetimi`:`${plan.seats} team members · ${plan.socialAccounts} social accounts · ${plan.ai} AI drafts a month · ${plan.audits} site audits`}</small></span></label>)}</fieldset>
      {!data.emailVerified?<a className="studio-text-button" href="/?tab=project&settings=team">{tr?'Önce hesap e-postanızı doğrulayın':'Verify your account email first'}<ExternalLink size={14}/></a>
      :<form className="billing-test-form" onSubmit={start}>
        <fieldset className="studio-form-grid" disabled={saving}>
          <label>{tr?'Ad soyad veya unvan':'Full name or company'}<input autoComplete="name" required minLength={2} maxLength={60} value={name} onChange={event=>{setName(event.target.value);edit();}}/></label>
          <label>{tr?'Telefon':'Phone'}<input autoComplete="tel" type="tel" required minLength={5} maxLength={20} value={phone} onChange={event=>{setPhone(event.target.value);edit();}}/></label>
          <label>{tr?'Fatura adresi':'Billing address'}<input autoComplete="street-address" required minLength={5} maxLength={400} value={address} onChange={event=>{setAddress(event.target.value);edit();}}/></label>
        </fieldset>
        <label className="billing-ack"><input type="checkbox" checked={terms} onChange={event=>setTerms(event.target.checked)} disabled={saving}/><span>{tr?<>{' '}<a href={data.termsUrl||'#'} target="_blank" rel="noreferrer">Satış sözleşmesini ve ön bilgilendirme metnini</a> okudum ve kabul ediyorum. Bilgilerim ödeme için PayTR’a gönderilir.</>:<>I have read and accept the <a href={data.termsUrl||'#'} target="_blank" rel="noreferrer">terms of sale and pre-contract information</a>. My details are sent to PayTR for the payment.</>}</span></label>
        <button className="studio-primary" disabled={saving||!terms||!chosen} type="submit">{saving?(tr?'Hazırlanıyor…':'Preparing…'):chosen?(tr?`${money(chosen.amountMinor)} öde`:`Pay ${money(chosen.amountMinor)}`):''}<ExternalLink size={15}/></button>
      </form>}
    </>}
    {data.orders.length>0&&<div className="billing-history"><h4>{tr?'Ödeme geçmişi':'Payment history'}</h4><div className="studio-table-scroll" tabIndex={0} aria-label={tr?'Ödeme geçmişi':'Payment history'}><table className="studio-table"><thead><tr><th scope="col">{tr?'Plan':'Plan'}</th><th scope="col">{tr?'Tutar':'Amount'}</th><th scope="col">{tr?'Durum':'Status'}</th><th scope="col"><span className="sr-only">{tr?'İşlem':'Action'}</span></th></tr></thead>
      <tbody>{data.orders.map(order=><tr key={order.id}><td>{data.plans.find(p=>p.id===order.planId)?.name} · {order.cadence==='monthly'?(tr?'aylık':'monthly'):(tr?'yıllık':'yearly')}<small>{order.id}</small><small>{day(order.createdAt)}</small></td><td>{money(order.amountMinor)}</td><td>{states[order.state]}{order.paidAt&&<small>{day(order.paidAt)}</small>}</td>
        <td>{order.checkoutUrl&&<a className="studio-text-button" target="_blank" rel="noreferrer" href={order.checkoutUrl}>{tr?'PayTR ödeme sayfası':'PayTR payment page'}<ExternalLink size={14}/></a>}</td></tr>)}</tbody></table></div></div>}
    <p className="plan-boundary"><LockKeyhole size={15}/>{tr?'Plan yalnız PayTR’ın imzalı onayıyla ve ödenen tutar siparişle tam eşleştiğinde açılır. Fatura muhasebe tarafından ayrıca düzenlenir; iade için bizimle iletişime geçin.':'A plan opens only on PayTR’s signed confirmation with an amount that exactly matches the order. Invoices are issued separately by accounting; contact us for refunds.'}</p>
  </section>;
}
