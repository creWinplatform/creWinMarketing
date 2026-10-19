'use client';
import {useState} from 'react';
import {Check,CheckCircle2,ArrowRight,Clock3} from 'lucide-react';
import type {Locale} from '@/lib/platform/catalog';
import type {PlanUsage} from '@/lib/platform/plan-types';
import {projectRequest} from '@/lib/platform/client';
import Msg from '@/components/Msg';

export default function PlanCatalog({data,lang,onSaved}:{data:PlanUsage;lang:Locale;onSaved:(data:PlanUsage)=>void}){
  const tr=lang==='tr', [busy,setBusy]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const select=async(planId:string)=>{
    setBusy(planId);setError('');setSaved(false);
    try{const next=await projectRequest<PlanUsage>('/api/platform/plan',{method:'POST',body:JSON.stringify({planId,catalogVersion:data.commercial.catalogVersion}),signal:AbortSignal.timeout(15000)});onSaved(next);setSaved(true);}
    catch{setError(tr?'Tercih kaydedilemedi. Yenileyerek güncel tercihi kontrol edin.':'Could not save your preference. Refresh to check its current state.');}
    finally{setBusy('');}
  };
  return <section className="plan-catalog" aria-label={tr?'Paketler':'Packages'}>
    <header className="plan-catalog-heading"><div><span className="studio-eyebrow">{tr?'SIRADAKİ ADIM':'YOUR NEXT STEP'}</span><h3>{tr?'Projenize uygun paketi belirleyin':'Find the right fit for your project'}</h3></div><span className="studio-badge"><Clock3 size={13}/>{tr?'Yakında':'Coming soon'}</span></header>
    <p className="studio-note">{tr?'Aylık USD fiyatları · 1 proje / marka. Tercih kaydı ödeme başlatmaz ve mevcut haklarınızı değiştirmez.':'Monthly USD prices · 1 project / brand. Saving a preference does not start a payment or change your current access.'}</p>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}
    {saved&&<p className="plan-preference-saved" role="status"><CheckCircle2 size={16}/>{tr?'Paket tercihiniz kaydedildi. Ödeme alınmadı.':'Package preference saved. No payment was taken.'}</p>}
    <div className="plan-package-grid">{data.commercial.catalog.map(plan=>{
      const selected=data.commercial.preference?.planId===plan.id,later=plan.availability==='later';
      return <article key={plan.id} className={'plan-package'+(selected?' is-selected':'')}>
        <header><h4>{plan.name}</h4><span className="plan-package-tag">{later?(tr?'Sonraki aşama':'Later'):selected?(tr?'Tercihiniz':'Your preference'):plan.id==='growth'?(tr?'Büyüyen ekipler':'Growing teams'):(tr?'İlk adım':'Getting started')}</span></header>
        <p className="plan-package-price">${plan.monthlyUsdMinor/100}<span> / {tr?'ay':'month'}</span></p>
        <ul>{[`${plan.seats} ${tr?'ekip üyesi':'team members'}`,`${plan.socialAccounts} ${tr?'sosyal hesap':'social accounts'}`,`${plan.ai} ${tr?'AI metin taslağı / ay':'AI text drafts / month'}`,`${plan.audits} ${tr?'tek URL denetimi / ay':'single-URL audits / month'}`].map(text=><li key={text}><Check size={15}/>{text}</li>)}</ul>
        <button className={selected?'studio-secondary':'studio-primary'} disabled={Boolean(busy)||later||selected||!data.commercial.canManage} onClick={()=>select(plan.id)}>{busy===plan.id?(tr?'Kaydediliyor…':'Saving…'):later?(tr?'Henüz açılmadı':'Not available yet'):selected?(tr?'Tercih kaydedildi':'Preference saved'):(tr?'Tercihimi kaydet':'Save preference')}{!selected&&!later&&<ArrowRight size={15}/>}</button>
      </article>;
    })}</div>
    <p className="studio-note">{tr?'Tüm paketlerde ortak kampanya, içerik ve ölçüm akışı. Güvenlik ve iletişim izni kontrolleri tüm planlarda korunur. Sağlayıcı, e-posta, reklam ve harici API maliyetleri ayrıdır. Yıllık ödeme henüz açık değildir.':'Shared campaign, content and measurement workflow across packages. Security and consent checks apply to every plan. Provider, email, advertising and external API costs are separate. Annual billing is not available yet.'}</p>
    {!data.commercial.canManage&&<p className="studio-note">{tr?'Paket tercihini yalnız proje sahibi kaydedebilir.':'Only the project owner can save a package preference.'}</p>}
  </section>;
}
