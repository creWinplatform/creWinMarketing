'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Users, BriefcaseBusiness, FolderOpen, Send, CircleCheck, Target, UserRoundCheck, RefreshCw, ArrowUpRight, Megaphone, ChartNoAxesCombined } from 'lucide-react';
import { getHistory as getContentHistory } from '@/lib/content-history';
import { getHistory as getPostHistory } from '@/lib/post-history';
import type { BreakdownItem, FillRateBuckets, SeafarerStats, JobStats } from '@/lib/types';
import type { ModuleId } from '@/lib/platform/catalog';
import { useLang } from '@/lib/lang';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';

interface DashboardData {
  seafarers?: SeafarerStats; jobs?: JobStats; fillRateBuckets?: FillRateBuckets;
  dailyRegistrations?: number[]; topCountries?: BreakdownItem[]; topPositions?: BreakdownItem[];
  isRealData?: boolean; partial?: boolean; apiErrors?: string[]; fetchedAt?: string; error?: string;
}
// focus: one line under the heading (what is waiting now); guide: the "What would you like to do?" panel, right after the
// figures so they stay in view on first sight.
export default function DashboardTab({ onNavigate, focus, guide }: { onNavigate?: (id: ModuleId) => void; focus?: ReactNode; guide?: ReactNode }) {
  const { lang } = useLang(), tr = lang === 'tr', locale = localeTag(lang);
  const [data,setData] = useState<DashboardData | null>(null), [loading,setLoading] = useState(true);
  const [contentCount,setContentCount] = useState<number | null>(null), [postCount,setPostCount] = useState<number | null>(null);
  const [recentPosts,setRecentPosts] = useState<Awaited<ReturnType<typeof getPostHistory>>>([]), [historyError,setHistoryError] = useState('');
  const [platforms,setPlatforms] = useState<Record<string,number>>({});
  const refresh = useCallback(() => {
    setLoading(true);
    fetch('/api/dashboard',{cache:'no-store',signal:AbortSignal.timeout(30000)}).then(async response => { if(!response.ok) throw new Error(); return response.json(); }).then(setData).catch(() => setData({error:tr?'Canlı veriler alınamadı.':"Couldn't load live data."})).finally(() => setLoading(false));
    setHistoryError('');
    Promise.all([getContentHistory(),getPostHistory()]).then(([content,posts]) => {
      setContentCount(content.length); setPostCount(posts.length); setRecentPosts(posts.slice(0,4));
      const counts:Record<string,number> = {};
      [...content,...posts].forEach(item => { counts[item.platform]=(counts[item.platform] || 0)+1; });
      setPlatforms(counts);
    }).catch(() => setHistoryError(tr?'İçerik ve yayın geçmişi yüklenemedi.':"Couldn't load content and publishing history."));
  },[tr]);
  useEffect(refresh,[refresh]);
  const trusted = data?.isRealData === true, buckets = trusted ? data.fillRateBuckets : undefined;
  const total = buckets ? buckets.zero+buckets.low+buckets.mid+buckets.high : undefined;
  const activated = trusted ? data.seafarers?.activatedSeafarers ?? buckets?.high : undefined;
  const below = trusted ? data.seafarers?.profilesBelow80 ?? (total !== undefined && activated !== undefined ? total-activated : undefined) : undefined;
  const rate = trusted ? data.seafarers?.activationRate ?? (total && activated !== undefined ? Math.round(activated/total*1000)/10 : undefined) : undefined;
  const number = (value:number | null | undefined) => value == null ? '—' : value.toLocaleString(locale);
  const daily = trusted ? data.dailyRegistrations || [] : [], maxDaily = Math.max(...daily,1);
  const anchor = data?.fetchedAt && Number.isFinite(Date.parse(data.fetchedAt)) ? new Date(data.fetchedAt) : new Date();
  const dateAt = (index:number) => { const date=new Date(anchor); date.setDate(date.getDate()-(daily.length-1-index)); return date; };
  const countries = trusted ? data.topCountries || [] : [], positions = trusted ? data.topPositions || [] : [];
  return (
    <section>
      <header className="studio-page-heading"><div><p className="studio-eyebrow">CREWINJOB / MARKETING</p><h1>{tr?'Pazarlama genel bakışı':'Marketing overview'}</h1><p className="studio-subtitle">{tr?'Aday kazanımı, profil aktivasyonu ve şirket büyümesi.':'Acquisition, profile activation and company growth.'}</p></div><div className="overview-header-actions"><button className="icon-button" onClick={refresh} disabled={loading} title={tr?'Yenile':'Refresh'} aria-label={tr?'Yenile':'Refresh'}><RefreshCw size={17} className={loading?'animate-spin':''} /></button>{onNavigate && <button className="studio-primary" onClick={() => onNavigate('campaigns')}><Megaphone size={16} />{tr?'Kampanya merkezi':'Campaign hub'}</button>}</div></header>
      {focus}
      <div role="status" className="studio-data-notice"><span aria-hidden="true" className={`status-dot ${!trusted || data?.partial ? 'status-dot-amber' : ''}`} /><span>{loading ? (tr?'Canlı veriler yükleniyor…':'Loading live data…') : trusted ? (data.partial ? (tr?'Kısmi canlı yanıt':'Partial live response') : (tr?'Gerçek API verisi':'Live API data')) : (tr?'Canlı veri doğrulanamadı':'Live data unavailable')}{data?.fetchedAt && ` · ${new Date(data.fetchedAt).toLocaleString(locale)}`}</span></div>
      {data?.error && <div role="alert" className="studio-error"><Msg text={data.error} /></div>}
      {historyError && <div role="alert" className="studio-error"><Msg text={historyError} /></div>}
      <div className="crewin-dashboard-stats">{[
        {Icon:Users,label:tr?'Gemi adamı':'Seafarers',value:number(trusted?data?.seafarers?.total:undefined),note:trusted && data?.seafarers?.newThisWeek!==undefined?`${number(data.seafarers.newThisWeek)} ${tr?'bu hafta kayıt':'registrations this week'}`:tr?'Canlı kullanıcı sayısı':'Live user count'},
        {Icon:BriefcaseBusiness,label:tr?'İlan':'Jobs',value:number(trusted?data?.jobs?.total:undefined),note:trusted && data?.jobs?.companies!==undefined?`${number(data.jobs.companies)} ${tr?'şirket':'companies'}`:tr?'Canlı ilan sayısı':'Live job count'},
        {Icon:CircleCheck,label:tr?'Aktif profil':'Activated profiles',value:number(activated),note:tr?'Profil doluluğu %80+':'Profile completion 80%+'},
        {Icon:ChartNoAxesCombined,label:tr?'Aktivasyon oranı':'Activation rate',value:rate===undefined?'—':`${number(rate)}%`,note:tr?'Aktif / toplam profil':'Activated / total profiles'},
        {Icon:FolderOpen,label:tr?'İçerik':'Content',value:number(contentCount),note:tr?'Sunucudaki içerik geçmişi':'Server content history'},
        {Icon:Send,label:tr?'Yayın':'Posts',value:number(postCount),note:tr?'Yayın geçmişi kayıtları':'Publishing history records'},
        {Icon:Target,label:tr?'Aktivasyon kitlesi':'Activation audience',value:number(below),note:tr?'Profil doluluğu %80 altı':'Profile completion below 80%'},
        {Icon:UserRoundCheck,label:tr?'Tam profil':'Complete profiles',value:number(trusted?data?.seafarers?.completeProfiles:undefined),note:tr?'Kesin %100 profil doluluğu':'Exact 100% profile completion'},
      ].map(item => <div key={item.label}><span><item.Icon size={15} />{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></div>)}</div>
      {guide}
      <div className="crewin-dashboard-grid"><div>
        <section className="studio-band"><div className="studio-section-title"><h2>{tr?'Son 7 gün kayıtları':'Registrations / last 7 days'}</h2><span className="studio-badge">{tr?'Günlük':'Daily'}</span></div>{daily.length ? <div className="crewin-daily-chart">{daily.map((value,index) => <div key={index} title={`${dateAt(index).toLocaleDateString(locale)}: ${value}`}><strong>{value}</strong><div className="bar-track"><div style={{height:`${value/maxDaily*100}%`}} /></div><span>{dateAt(index).toLocaleDateString(locale,{day:'numeric',month:'short'})}</span></div>)}</div> : <div className="studio-empty"><ChartNoAxesCombined size={25} /><p>{tr?'Günlük kayıt verisi henüz alınamadı.':'Daily registration data is unavailable.'}</p></div>}</section>
        <section className="studio-band"><div className="studio-section-title"><h2>{tr?'Profil aktivasyonu':'Profile activation'}</h2>{onNavigate && <button className="studio-text-button" onClick={() => onNavigate('retention')}>Retention<ArrowUpRight size={14} /></button>}</div>{buckets && total ? <><div className="crewin-segment-bar" aria-hidden="true">{[{key:'zero',color:'#e4757b'},{key:'low',color:'#c3ab72'},{key:'mid',color:'#9e92db'},{key:'high',color:'#549584'}].map(item => <div key={item.key} style={{width:`${buckets[item.key as keyof FillRateBuckets]/total*100}%`,background:item.color}} title={number(buckets[item.key as keyof FillRateBuckets])} />)}</div><div className="crewin-segments">{[{key:'zero',label:tr?'Boş profil':'Empty profile'},{key:'low',label:'1–49%'},{key:'mid',label:'50–79%'},{key:'high',label:tr?'80%+ aktif':'80%+ activated'}].map(item => <div key={item.key}><strong>{number(buckets[item.key as keyof FillRateBuckets])}</strong><span>{item.label}</span></div>)}</div></> : <p className="studio-note">{tr?'Profil dağılımı için doğrulanmış veri yok.':'No verified profile distribution data.'}</p>}</section>
        <section className="studio-band"><div className="studio-section-title"><h2>{tr?'Kanal çalışmaları':'Channel activity'}</h2><span className="studio-badge">{tr?'İçerik + yayın':'Content + posts'}</span></div>{Object.keys(platforms).length ? Object.entries(platforms).sort((a,b)=>b[1]-a[1]).map(([platform,count]) => <div className="crewin-data-bar" key={platform}><span>{platform}</span><div className="crewin-bar-track"><div style={{width:`${count/Math.max(...Object.values(platforms))*100}%`}} /></div><strong>{number(count)}</strong></div>) : <p className="studio-note">{historyError ? <Msg text={historyError} /> : (tr?'Henüz kanal kaydı yok.':'No channel records yet.')}</p>}</section>
      </div><div>
        {[{title:tr?'Ülke dağılımı':'Countries',items:countries},{title:tr?'Pozisyon dağılımı':'Positions',items:positions}].map(group => <section className="studio-band" key={group.title}><div className="studio-section-title"><h2>{group.title}</h2></div>{group.items.length ? group.items.slice(0,6).map(item => <div className="crewin-data-bar" key={item.id}><span title={item.name}>{item.name}</span><div className="crewin-bar-track"><div style={{width:`${item.count/Math.max(...group.items.map(row=>row.count),1)*100}%`}} /></div><strong>{number(item.count)}</strong></div>) : <p className="studio-note">{tr?'Dağılım verisi alınamadı.':'Distribution data is unavailable.'}</p>}</section>)}
        <section className="studio-band"><div className="studio-section-title"><h2>{tr?'Son yayınlar':'Recent posts'}</h2>{onNavigate && <button className="studio-text-button" onClick={() => onNavigate('social')}><ArrowUpRight size={16} /><span>{tr?'Sosyal medya':'Social media'}</span></button>}</div>{recentPosts.length ? recentPosts.map(post => <article className="crewin-latest-post" key={post.id}><span>{post.platform}</span><p className="line-clamp-2">{post.content}</p><small>{new Date(post.publishedAt).toLocaleDateString(locale)}</small>{post.postUrl && <a href={post.postUrl} rel="noreferrer" target="_blank" aria-label={tr?'Yayını görüntüle':'View post'} title={tr?'Yayını görüntüle':'View post'}><ArrowUpRight size={14} /></a>}</article>) : <p className="studio-note">{historyError ? <Msg text={historyError} /> : (tr?'Henüz yayınlanmış içerik yok.':'No posts yet.')}</p>}</section>
      </div></div>
    </section>
  );
}
