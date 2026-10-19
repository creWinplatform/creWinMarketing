'use client';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { SeoOpportunitiesSnapshot } from '@/lib/platform/seo-operations-types';
import Msg from '@/components/Msg';

// Search Console opportunities from the stored query snapshot. Fixed rules, real numbers only, no forecasts.
export default function SeoOpportunities({lang}:{lang:Locale}){
  const tr=lang==='tr',locale=localeTag(lang);
  const [data,setData]=useState<SeoOpportunitiesSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=useCallback(()=>{projectRequest<SeoOpportunitiesSnapshot>('/api/platform/seo?view=opportunities').then(setData).catch(reason=>setError(reason.message));},[]);
  useEffect(()=>{load();},[load]);
  // Refreshing reuses the growth coach's Search Console snapshot (connection managers only).
  const refresh=async()=>{setBusy(true);setError('');try{await projectRequest('/api/platform/coach/seo',{method:'POST',body:JSON.stringify({action:'refresh'}),signal:AbortSignal.timeout(45000)});load();}catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}finally{setBusy(false);}};
  const n=(value:number,digits=0)=>value.toLocaleString(locale,{maximumFractionDigits:digits,minimumFractionDigits:digits});
  const day=(key:string)=>new Date(`${key}T12:00:00Z`).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:'UTC'});
  if(!data)return error?<p className="studio-error" role="alert"><Msg text={error}/></p>:<div className="studio-skeleton" role="status">{tr?'Fırsatlar yükleniyor…':'Loading opportunities…'}</div>;
  const message={not_connected:tr?'Search Console bağlı değil. Proje ayarları → Bağlantılar’dan sitenizin mülkünü bağlayın.':'Search Console is not connected. Connect your site property in Project settings → Connections.',
    restricted:tr?'Search Console sorgu verisini yalnız bağlantıları yöneten ekip üyeleri görebilir.':'Only teammates who manage connections can see Search Console query data.',
    not_fetched:tr?'Henüz sorgu verisi alınmadı.':'No query data has been fetched yet.',no_data:tr?'Bu dönem için Search Console sorgu verisi yok. Veri yok, sıfır demek değildir.':'Search Console has no query data for this period. No data is not zero.',
    unavailable:tr?'Search Console verisi şu anda alınamadı; bağlantıyı kontrol edip yeniden deneyin.':'Search Console data could not be fetched right now; check the connection and try again.',ready:''}[data.state];
  return <section className="seo-ops">
    <header className="studio-page-heading"><div><p className="studio-eyebrow">SEARCH CONSOLE</p><h1>{tr?'Arama fırsatları':'Search opportunities'}</h1>
      <p className="studio-subtitle">{tr?'Gerçek Search Console sorgularından, sabit kurallarla seçilmiş fırsatlar.':'Opportunities picked from real Search Console queries with fixed rules.'}</p></div>
      {data.canRefresh&&<div className="overview-header-actions"><button type="button" className="studio-secondary" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15} className={busy?'animate-spin':''}/>{tr?'Veriyi yenile':'Refresh the data'}</button></div>}
    </header>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}
    {message&&<div className="studio-empty"><p>{message}</p></div>}
    {data.state==='ready'&&<>
      <div className="studio-data-notice mt-4"><span className="status-dot"/>{tr?`${day(data.from!)} – ${day(data.to!)} · ${n(data.queries)} sorgu · Search Console`:`${day(data.from!)} – ${day(data.to!)} · ${n(data.queries)} queries · Search Console`}</div>
      {data.items.length?<div className="studio-table-scroll"><table className="coach-keywords seo-ops-table"><caption className="sr-only">{tr?'Arama fırsatları':'Search opportunities'}</caption>
        <thead><tr><th>{tr?'Sorgu':'Query'}</th><th>{tr?'Fırsat':'Opportunity'}</th><th>{tr?'Gösterim':'Impressions'}</th><th>{tr?'Tıklama':'Clicks'}</th><th>{tr?'Tıklama oranı':'CTR'}</th><th>{tr?'Ort. sıra':'Avg. position'}</th></tr></thead>
        <tbody>{data.items.map(item=><tr key={item.query}><td>{item.query}</td><td data-label={tr?'Fırsat':'Opportunity'}>{item.kind==='near_first_page'?(tr?'İlk sayfaya yakın':'Close to page one'):(tr?'Üst sırada ama az tıklanıyor':'Ranks high, few clicks')}</td>
          <td data-label={tr?'Gösterim':'Impressions'}>{n(item.impressions)}</td><td data-label={tr?'Tıklama':'Clicks'}>{n(item.clicks)}</td><td data-label={tr?'Tıklama oranı':'CTR'}>{n(item.ctr*100,1)}%</td><td data-label={tr?'Ort. sıra':'Avg. position'}>{n(item.position,1)}</td></tr>)}</tbody></table></div>
        :<div className="studio-empty"><p>{tr?'Kurallara uyan sorgu yok.':'No query matches the rules.'}</p></div>}
      <p className="coach-muted">{tr?'Kurallar: ortalama sırası 8–20 ve en az 20 gösterimi olan sorgular “ilk sayfaya yakın”; ilk 5 sırada, en az 50 gösterimli ve tıklama oranı %2’nin altında olanlar “üst sırada ama az tıklanıyor” sayılır. Bunlar sabit editoryal kurallardır; trafik, sıralama veya dönüşüm tahmini değildir.':'Rules: queries with an average position of 8–20 and at least 20 impressions are “close to page one”; those in the top 5 with at least 50 impressions and a CTR under 2% are “ranks high, few clicks”. These are fixed editorial rules, not traffic, ranking or conversion forecasts.'}</p>
    </>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Yalnız Search Console’un bildirdiği sayılar gösterilir; tahmin yapılmaz.':'Only the numbers Search Console reported are shown; nothing is estimated.'}</p>
  </section>;
}
