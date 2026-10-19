'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Save, ShieldCheck, Trash2 } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { paidScenario, paidSensitivity, requiredBudget, seoScenario, seoSensitivity, type Outcome, type PaidInputs, type Range, type Scenario, type SeoInputs } from '@/lib/platform/budget-math';
import type { BudgetSnapshot } from '@/lib/platform/budget-planner';
import Msg from '@/components/Msg';

type View='paid'|'seo'|'goal';
type Pair={low:string;high:string};
const pair=(low:number,high=low):Pair=>({low:String(low),high:String(high)});
const num=(value:string)=>Number(String(value).replace(',','.'));
const rate=(value:Pair):Range=>({low:num(value.low)/100,high:num(value.high)/100});
const money=(value:Pair):Range=>({low:num(value.low),high:num(value.high)});

// Budget and goal planner: every result comes from the team's own ranges or from values measured for this project,
// shown with their source. It is arithmetic, not a forecast.
export default function BudgetPlanner({lang}:{lang:Locale}){
  const tr=lang==='tr',locale=localeTag(lang);
  const [data,setData]=useState<BudgetSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[view,setView]=useState<View>('paid'),[currency,setCurrency]=useState('TRY'),[name,setName]=useState(''),[current,setCurrent]=useState<{id:string;revision:number;kind:'paid'|'seo'}|null>(null),[allSources,setAllSources]=useState<Record<View,Record<string,string>>>({paid:{},seo:{},goal:{}});
  const sources=allSources[view],setSources=(update:(old:Record<string,string>)=>Record<string,string>)=>setAllSources(old=>({...old,[view]:update(old[view])}));
  const [paid,setPaid]=useState({budget:'10000',cpc:pair(3,6),conversion:pair(1,3),close:pair(10,20),useClose:false,value:'',useValue:false});
  const [seo,setSeo]=useState({hours:'20',hourlyRate:'500',tools:'0',pieces:'4',pieceCost:'1500',clicks:'300',growth:pair(0,30),conversion:pair(1,3),close:pair(10,20),useClose:false,value:'',useValue:false});
  const [goal,setGoal]=useState({leads:'20',cpc:pair(3,6),conversion:pair(1,3)});
  const load=useCallback(()=>{projectRequest<BudgetSnapshot>('/api/platform/budget').then(value=>{setData(value);setCurrency(value.currency);}).catch(reason=>setError(reason.message));},[]);
  useEffect(()=>{load();},[load]);
  const fmt=(value:number|null,kind:'money'|'count'|'ratio'='count')=>value===null||!Number.isFinite(value)?'—':kind==='money'?value.toLocaleString(locale,{style:'currency',currency,maximumFractionDigits:Math.abs(value)<10?2:0}):kind==='ratio'?`${value.toLocaleString(locale,{maximumFractionDigits:2})}×`:value.toLocaleString(locale,{maximumFractionDigits:value<10?1:0});
  const pctText=(value:number)=>value.toLocaleString(locale,{style:'percent',maximumFractionDigits:2});
  const day=(key:string|null)=>key?new Date(`${key.slice(0,10)}T12:00:00Z`).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:'UTC'}):'';
  const paidInputs=useMemo(()=>({budget:num(paid.budget),cpc:money(paid.cpc),conversion:rate(paid.conversion),close:paid.useClose?rate(paid.close):null,value:paid.useClose&&paid.useValue&&paid.value?num(paid.value):null}),[paid]);
  const seoInputs=useMemo(()=>({hours:num(seo.hours),hourlyRate:num(seo.hourlyRate),tools:num(seo.tools),pieces:num(seo.pieces),pieceCost:num(seo.pieceCost),clicks:num(seo.clicks),growth:rate(seo.growth),conversion:rate(seo.conversion),close:seo.useClose?rate(seo.close):null,value:seo.useClose&&seo.useValue&&seo.value?num(seo.value):null}),[seo]);
  const valid=(range:Range,min=0,max=Infinity)=>Number.isFinite(range.low)&&Number.isFinite(range.high)&&range.low>=min&&range.high<=max&&range.low<=range.high;
  const paidOk=paidInputs.budget>=0&&valid(paidInputs.cpc)&&paidInputs.cpc.low>0&&valid(paidInputs.conversion,0,1)&&(!paidInputs.close||valid(paidInputs.close,0,1));
  const seoOk=[seoInputs.hours,seoInputs.hourlyRate,seoInputs.tools,seoInputs.pieces,seoInputs.pieceCost,seoInputs.clicks].every(value=>Number.isFinite(value)&&value>=0)&&valid(seoInputs.growth,-1,10)&&valid(seoInputs.conversion,0,1)&&(!seoInputs.close||valid(seoInputs.close,0,1));
  const scenario:Scenario|null=view==='paid'?(paidOk?paidScenario(paidInputs):null):view==='seo'?(seoOk?seoScenario(seoInputs):null):null;
  const swings=view==='paid'&&paidOk?paidSensitivity(paidInputs):view==='seo'&&seoOk?seoSensitivity(seoInputs):[];
  const goalNeed=valid(money(goal.cpc))&&money(goal.cpc).low>0&&valid(rate(goal.conversion),0,1)&&num(goal.leads)>0?requiredBudget(num(goal.leads),money(goal.cpc),rate(goal.conversion)):null;
  const swingNames:Record<string,string>={cpc:tr?'tıklama başı maliyet':'cost per click',conversion:tr?'dönüşüm oranı':'conversion rate',growth:tr?'organik tıklama artışı':'organic click growth'};
  // Saving an opened scenario of the same kind updates it (with its revision); otherwise a new scenario is added.
  const save=async(asNew:boolean)=>{setError('');setNotice('');if(view==='goal'||!name.trim())return;const target=!asNew&&current&&current.kind===view?current:null;
    try{const next=await projectRequest<BudgetSnapshot>('/api/platform/budget',{method:'POST',body:JSON.stringify({action:'save',name:name.trim(),kind:view,currency,inputs:view==='paid'?paidInputs:seoInputs,sources,...(target?{id:target.id,expectedRevision:target.revision}:{})})});
      setData(next);const saved=target?next.scenarios.find(item=>item.id===target.id):next.scenarios[0];if(saved)setCurrent({id:saved.id,revision:saved.revision,kind:saved.kind});setNotice(target?(tr?'Senaryo güncellendi.':'Scenario updated.'):(tr?'Senaryo kaydedildi.':'Scenario saved.'));}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}};
  const open=(item:BudgetSnapshot['scenarios'][number])=>{setCurrency(item.currency);setName(item.name);setNotice('');setCurrent({id:item.id,revision:item.revision,kind:item.kind});setAllSources(old=>({...old,[item.kind]:item.sources}));
    const pct=(range:Range):Pair=>pair(+(range.low*100).toFixed(4),+(range.high*100).toFixed(4)),cash=(range:Range):Pair=>pair(range.low,range.high);
    if(item.kind==='paid'){const value=item.inputs as PaidInputs;setView('paid');setPaid({budget:String(value.budget),cpc:cash(value.cpc),conversion:pct(value.conversion),close:value.close?pct(value.close):pair(10,20),useClose:Boolean(value.close),value:value.value!=null?String(value.value):'',useValue:value.value!=null});}
    else{const value=item.inputs as SeoInputs;setView('seo');setSeo({hours:String(value.hours),hourlyRate:String(value.hourlyRate),tools:String(value.tools),pieces:String(value.pieces),pieceCost:String(value.pieceCost),clicks:String(value.clicks),growth:pct(value.growth),conversion:pct(value.conversion),close:value.close?pct(value.close):pair(10,20),useClose:Boolean(value.close),value:value.value!=null?String(value.value):'',useValue:value.value!=null});}};
  const remove=async(id:string)=>{setError('');setNotice('');try{setData(await projectRequest<BudgetSnapshot>('/api/platform/budget',{method:'POST',body:JSON.stringify({action:'remove',id})}));if(current?.id===id)setCurrent(null);}catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}};
  if(!data)return error?<p className="studio-error" role="alert"><Msg text={error}/></p>:null;
  const m=data.measured,src=(label:string,from:string|null,to:string|null)=>`${label}${from?`, ${day(from)}–${day(to)}`:''}`;
  // Saved with the scenario, so the period stays in ISO dates and reads the same in either language.
  const stored=(label:string,from:string|null,to:string|null)=>`${label}${from?`, ${from.slice(0,10)}–${(to||from).slice(0,10)}`:''}`;
  // A measured value fills the field and keeps its source label until someone edits that field by hand.
  const use=(key:string,label:string,apply:()=>void)=>{apply();setSources(old=>({...old,[key]:label}));};
  const forget=(key:string)=>setSources(old=>{if(!(key in old))return old;const next={...old};delete next[key];return next;});
  const rangeField=(label:string,value:Pair,onChange:(next:Pair)=>void,suffix:string,key?:string)=><fieldset className="budget-range"><legend>{label}{suffix?` (${suffix})`:''}</legend>
    <label><span>{tr?'en az':'min'}</span><input inputMode="decimal" value={value.low} onChange={event=>{onChange({...value,low:event.target.value});if(key)forget(key);}}/></label>
    <label><span>{tr?'en çok':'max'}</span><input inputMode="decimal" value={value.high} onChange={event=>{onChange({...value,high:event.target.value});if(key)forget(key);}}/></label>
    {key&&sources[key]&&<small className="coach-muted">{tr?'Ölçülen: ':'Measured: '}{sources[key]}</small>}</fieldset>;
  const field=(label:string,value:string,onChange:(next:string)=>void,key?:string)=><label className="budget-field">{label}<input inputMode="decimal" value={value} onChange={event=>{onChange(event.target.value);if(key)forget(key);}}/>{key&&sources[key]&&<small className="coach-muted">{tr?'Ölçülen: ':'Measured: '}{sources[key]}</small>}</label>;
  const row=(label:string,pick:(item:Outcome)=>number|null,kind:'money'|'count'|'ratio'='count')=>scenario&&<tr><th scope="row">{label}</th><td>{fmt(pick(scenario.low),kind)}</td><td><strong>{fmt(pick(scenario.expected),kind)}</strong></td><td>{fmt(pick(scenario.high),kind)}</td></tr>;
  const ctr=m.ctr?m.ctr.value:null;
  return <section className="studio-band mt-6 budget-planner" aria-labelledby="budget-planner-title">
    <div className="studio-section-title"><h2 id="budget-planner-title"><Calculator size={16}/>{tr?'Bütçe ve hedef planlayıcı':'Budget and goal planner'}</h2>
      <label className="budget-currency">{tr?'Para birimi':'Currency'}<select value={currency} onChange={event=>setCurrency(event.target.value)}>{[...new Set([data.currency,'TRY','USD','EUR','GBP'])].map(item=><option key={item}>{item}</option>)}</select></label></div>
    <p className="studio-note">{tr?'Kendi varsayımlarınızı en az–en çok aralığı olarak girin; varsa bu projede ölçülen gerçek değerleri tek tıkla kullanın. Sonuç bir hesaptır, tahmin veya garanti değildir.':'Enter your own assumptions as a min–max range; where available, use values measured for this project with one click. The result is arithmetic, not a forecast or a guarantee.'}</p>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}{notice&&<p className="coach-note" role="status">{notice}</p>}
    <div className="publication-view-tabs" role="tablist" aria-label={tr?'Planlayıcı görünümü':'Planner view'}>{(['paid','seo','goal'] as const).map(item=><button key={item} role="tab" aria-selected={view===item} tabIndex={view===item?0:-1} onClick={()=>{setView(item);setNotice('');}}>{item==='paid'?(tr?'Reklam (Meta)':'Ads (Meta)'):item==='seo'?'SEO':(tr?'Hedeften bütçe':'Budget from a goal')}</button>)}</div>
    <div className="budget-measured"><h3>{tr?'Bu projede ölçülenler':'Measured for this project'}</h3>
      {!m.cpc&&!m.organicClicksPerDay&&!m.conversions.length?<p className="coach-muted">{tr?'Henüz ölçülmüş değer yok. Meta reklam harcaması, Search Console ve GA4 ölçümleri biriktikçe burada görünür; o zamana kadar hesap yalnız varsayımlarınızla yapılır.':'Nothing measured yet. Meta ad spend, Search Console and GA4 readings appear here as they accumulate; until then the calculation uses only your assumptions.'}</p>:<ul>
        {m.cpc&&<li>{tr?'Tıklama başı maliyet':'Cost per click'}: <strong>{m.cpc.value.toLocaleString(locale,{style:'currency',currency:data.currency,maximumFractionDigits:2})}</strong> <span className="coach-muted">({src('Meta',m.cpc.from,m.cpc.to)})</span>{view!=='seo'&&<button type="button" className="studio-text-button" onClick={()=>use('cpc',stored('Meta',m.cpc!.from,m.cpc!.to),()=>{const value=pair(+m.cpc!.value.toFixed(2));setCurrency(data.currency);if(view==='paid')setPaid(old=>({...old,cpc:value}));else setGoal(old=>({...old,cpc:value}));})}>{tr?'Kullan':'Use'}</button>}</li>}
        {ctr!==null&&<li>{tr?'Tıklama oranı':'Click-through rate'}: <strong>{pctText(ctr)}</strong> <span className="coach-muted">({src('Meta',m.ctr!.from,m.ctr!.to)})</span></li>}
        {m.organicClicksPerDay&&<li>{tr?'Organik tıklama, günlük ortalama':'Organic clicks, daily average'}: <strong>{fmt(m.organicClicksPerDay.value)}</strong> <span className="coach-muted">(Search Console, {day(m.organicClicksPerDay.from)}–{day(m.organicClicksPerDay.to)})</span>{view==='seo'&&<button type="button" className="studio-text-button" onClick={()=>use('clicks',`${stored('Search Console',m.organicClicksPerDay!.from,m.organicClicksPerDay!.to)} × 30`,()=>setSeo(old=>({...old,clicks:String(Math.round(m.organicClicksPerDay!.value*30))})))}>{tr?'× 30 gün olarak kullan':'Use × 30 days'}</button>}</li>}
        {m.conversions.map((item,index)=><li key={index}>{item.goal[lang]} · {item.label[lang]}: <strong>{pctText(item.value)}</strong> <span className="coach-muted">({item.source==='ga4'?'GA4':item.source==='product_event'?(tr?'ürün olayları':'product events'):item.source}, {day(item.from)}–{day(item.to)})</span>
          <button type="button" className="studio-text-button" onClick={()=>use('conversion',stored(item.label[lang],item.from,item.to),()=>{const value=pair(+(item.value*100).toFixed(2));if(view==='paid')setPaid(old=>({...old,conversion:value}));else if(view==='seo')setSeo(old=>({...old,conversion:value}));else setGoal(old=>({...old,conversion:value}));})}>{tr?'Dönüşüm olarak kullan':'Use as conversion'}</button></li>)}
      </ul>}</div>
    {view==='paid'&&<div className="budget-grid">
      {field(tr?`Bütçe (${currency})`:`Budget (${currency})`,paid.budget,value=>setPaid(old=>({...old,budget:value})))}
      {rangeField(tr?'Tıklama başı maliyet':'Cost per click',paid.cpc,value=>setPaid(old=>({...old,cpc:value})),currency,'cpc')}
      {rangeField(tr?'Tıklamadan lead’e dönüşüm':'Click-to-lead conversion',paid.conversion,value=>setPaid(old=>({...old,conversion:value})),'%','conversion')}
      <label className="automation-choice"><input type="checkbox" checked={paid.useClose} onChange={event=>setPaid(old=>({...old,useClose:event.target.checked}))}/>{tr?'Lead’den müşteriye oranını da hesaba kat':'Include the lead-to-customer rate'}</label>
      {paid.useClose&&rangeField(tr?'Lead’den müşteriye':'Lead to customer',paid.close,value=>setPaid(old=>({...old,close:value})),'%')}
      {paid.useClose&&<label className="automation-choice"><input type="checkbox" checked={paid.useValue} onChange={event=>setPaid(old=>({...old,useValue:event.target.checked}))}/>{tr?'Müşteri başı geliri biliyorum (ROAS için)':'I know the revenue per customer (for ROAS)'}</label>}
      {paid.useClose&&paid.useValue&&field(tr?`Müşteri başı gelir (${currency})`:`Revenue per customer (${currency})`,paid.value,value=>setPaid(old=>({...old,value})))}
    </div>}
    {view==='seo'&&<div className="budget-grid">
      {field(tr?'Aylık emek (saat)':'Monthly work (hours)',seo.hours,value=>setSeo(old=>({...old,hours:value})))}
      {field(tr?`Saat ücreti (${currency})`:`Hourly rate (${currency})`,seo.hourlyRate,value=>setSeo(old=>({...old,hourlyRate:value})))}
      {field(tr?`Araçlar, aylık (${currency})`:`Tools, monthly (${currency})`,seo.tools,value=>setSeo(old=>({...old,tools:value})))}
      {field(tr?'İçerik sayısı, aylık':'Content pieces, monthly',seo.pieces,value=>setSeo(old=>({...old,pieces:value})))}
      {field(tr?`İçerik başı maliyet (${currency})`:`Cost per piece (${currency})`,seo.pieceCost,value=>setSeo(old=>({...old,pieceCost:value})))}
      {field(tr?'Bugünkü aylık organik tıklama':'Today’s monthly organic clicks',seo.clicks,value=>setSeo(old=>({...old,clicks:value})),'clicks')}
      {rangeField(tr?'Organik tıklama değişimi':'Change in organic clicks',seo.growth,value=>setSeo(old=>({...old,growth:value})),'%')}
      {rangeField(tr?'Tıklamadan lead’e dönüşüm':'Click-to-lead conversion',seo.conversion,value=>setSeo(old=>({...old,conversion:value})),'%','conversion')}
      <label className="automation-choice"><input type="checkbox" checked={seo.useClose} onChange={event=>setSeo(old=>({...old,useClose:event.target.checked}))}/>{tr?'Lead’den müşteriye oranını da hesaba kat':'Include the lead-to-customer rate'}</label>
      {seo.useClose&&rangeField(tr?'Lead’den müşteriye':'Lead to customer',seo.close,value=>setSeo(old=>({...old,close:value})),'%')}
      {seo.useClose&&<label className="automation-choice"><input type="checkbox" checked={seo.useValue} onChange={event=>setSeo(old=>({...old,useValue:event.target.checked}))}/>{tr?'Müşteri başı geliri biliyorum (ROAS için)':'I know the revenue per customer (for ROAS)'}</label>}
      {seo.useClose&&seo.useValue&&field(tr?`Müşteri başı gelir (${currency})`:`Revenue per customer (${currency})`,seo.value,value=>setSeo(old=>({...old,value})))}
      <p className="coach-muted">{tr?'SEO etkisi genellikle aylar içinde ortaya çıkar; değişim aralığını kendi gözleminize göre girin. Ölçülen organik tıklama, Search Console’un bildirdiği dönemden alınır.':'SEO effects usually take months; enter the change range from your own observation. Measured organic clicks come from the period Search Console reported.'}</p>
    </div>}
    {view==='goal'&&<div className="budget-grid">
      {field(tr?'Hedef lead sayısı':'Target number of leads',goal.leads,value=>setGoal(old=>({...old,leads:value})))}
      {rangeField(tr?'Tıklama başı maliyet':'Cost per click',goal.cpc,value=>setGoal(old=>({...old,cpc:value})),currency,'cpc')}
      {rangeField(tr?'Tıklamadan lead’e dönüşüm':'Click-to-lead conversion',goal.conversion,value=>setGoal(old=>({...old,conversion:value})),'%','conversion')}
      {goalNeed?<div className="budget-result" role="status"><p>{tr?`${goal.leads} lead için gereken reklam bütçesi:`:`Ad budget needed for ${goal.leads} leads:`}</p><p><strong>{fmt(goalNeed.expected,'money')}</strong> <span className="coach-muted">{tr?`(en iyi ${fmt(goalNeed.low,'money')}, en kötü ${fmt(goalNeed.high,'money')})`:`(best ${fmt(goalNeed.low,'money')}, worst ${fmt(goalNeed.high,'money')})`}</span></p></div>:<p className="coach-muted">{tr?'Geçerli bir hedef, pozitif tıklama maliyeti ve 0’dan büyük dönüşüm aralığı girin.':'Enter a valid target, a positive cost per click and a conversion range above 0.'}</p>}
    </div>}
    {view!=='goal'&&(scenario?<>
      <div className="studio-table-scroll"><table className="coach-keywords budget-table"><caption className="sr-only">{tr?'Senaryo sonucu':'Scenario result'}</caption>
        <thead><tr><th>{tr?`Aylık maliyet: ${fmt(scenario.cost,'money')}`:`Monthly cost: ${fmt(scenario.cost,'money')}`}</th><th>{tr?'En kötü':'Worst'}</th><th>{tr?'Orta':'Middle'}</th><th>{tr?'En iyi':'Best'}</th></tr></thead>
        <tbody>{row(tr?'Tıklama':'Clicks',item=>item.clicks)}{row(tr?'Lead':'Leads',item=>item.leads)}{row(tr?'Lead başı maliyet':'Cost per lead',item=>item.costPerLead,'money')}
          {scenario.expected.customers!==null&&row(tr?'Müşteri':'Customers',item=>item.customers)}{scenario.expected.customers!==null&&row(tr?'Müşteri başı maliyet':'Cost per customer',item=>item.costPerCustomer,'money')}
          {scenario.expected.revenue!==null&&row(tr?'Gelir':'Revenue',item=>item.revenue,'money')}{scenario.expected.roas!==null&&row('ROAS',item=>item.roas,'ratio')}</tbody></table></div>
      {swings[0]&&swings[0].share>0&&<p className="coach-note">{tr?`Sonucu en çok etkileyen varsayım: ${swingNames[swings[0].input]} (orta lead sayısındaki oynamanın %${Math.round(swings[0].share*100)} kadarı). Önce bu değeri ölçerek daraltmak hesabı en çok netleştirir.`:`The assumption that moves the result most: ${swingNames[swings[0].input]} (${Math.round(swings[0].share*100)}% of the swing in the middle lead count). Narrowing it by measuring first sharpens the calculation most.`}</p>}
      {data.canWrite&&<div className="budget-save"><input aria-label={tr?'Senaryo adı':'Scenario name'} placeholder={tr?'Senaryo adı':'Scenario name'} maxLength={80} value={name} onChange={event=>setName(event.target.value)}/>{current&&current.kind===view?<><button type="button" className="studio-secondary" disabled={!name.trim()} onClick={()=>void save(false)}><Save size={14}/>{tr?'Senaryoyu güncelle':'Update scenario'}</button><button type="button" className="studio-text-button" disabled={!name.trim()} onClick={()=>void save(true)}>{tr?'Yeni olarak kaydet':'Save as new'}</button></>
        :<button type="button" className="studio-secondary" disabled={!name.trim()} onClick={()=>void save(true)}><Save size={14}/>{tr?'Senaryoyu kaydet':'Save scenario'}</button>}</div>}
    </>:<p className="studio-error" role="alert">{tr?'Değerleri kontrol edin: tutarlar 0 veya üzeri, yüzdeler 0–100 arası, tıklama maliyeti 0’dan büyük ve her aralıkta “en az” değer “en çok” değerden büyük olmamalı.':'Check the values: amounts 0 or more, percentages 0–100, cost per click above 0, and in each range “min” must not exceed “max”.'}</p>)}
    {data.scenarios.length>0&&<details className="coach-resolved"><summary>{tr?`Kayıtlı senaryolar (${data.scenarios.length})`:`Saved scenarios (${data.scenarios.length})`}</summary><ul>{data.scenarios.map(item=><li key={item.id}><span className="coach-state">{item.kind==='paid'?(tr?'Reklam':'Ads'):'SEO'}</span><span>{item.name} · {item.currency}</span><button type="button" className="studio-text-button" onClick={()=>open(item)}>{tr?'Aç':'Open'}</button>{data.canWrite&&<button type="button" className="studio-text-button" aria-label={tr?'Sil':'Delete'} onClick={()=>void remove(item.id)}><Trash2 size={14}/></button>}</li>)}</ul></details>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Sektör ortalaması veya garanti kullanılmaz: sayılar yalnız sizin varsayımlarınızdan ve bu projede ölçülen kayıtlardan gelir. Ölçülen değerin kaynağı ve dönemi her zaman yanında yazar.':'No industry averages or guarantees are used: numbers come only from your assumptions and this project’s measured records. Each measured value shows its source and period.'}</p>
  </section>;
}
