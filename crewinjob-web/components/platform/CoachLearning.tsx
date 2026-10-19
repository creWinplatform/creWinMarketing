'use client';
import { useEffect, useState } from 'react';
import { History, Lightbulb, ShieldCheck } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { CoachLearningGroup, CoachLearningSnapshot } from '@/lib/platform/coach-types';
import { briefChangeLines } from './coach-changes';
import Msg from '@/components/Msg';

const channelNames:Record<string,[string,string]>={linkedin:['LinkedIn','LinkedIn'],instagram:['Instagram','Instagram'],facebook:['Facebook','Facebook'],twitter:['X','X'],email:['E-posta','Email'],blog:['Blog','Blog'],tiktok:['TikTok','TikTok'],seo:['Arama (SEO/blog)','Search (SEO/blog)']};
const kinds={approve:['Onaylandı','Approved'],adjust:['Plan ayarlandı','Plan adjusted'],positioning:['Konumlandırma güncellendi','Positioning updated']} as const;

// "What we learned": coach suggestions → drafts → accepted publications → provider-reported engagement.
export default function CoachLearning({workspace,lang}:{workspace:WorkspaceContext;lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [data,setData]=useState<CoachLearningSnapshot|null>(null),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();projectRequest<CoachLearningSnapshot>('/api/platform/coach/learning',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}).then(setData).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);});return()=>controller.abort();},[]);
  const n=(value:number)=>value.toLocaleString(locale),date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:workspace.project.timezone});
  const channel=(key:string)=>channelNames[key]?.[idx]||key;
  const theme=(key:string)=>({'@weekly':tr?'Haftalık eylem':'Weekly action','@content':tr?'İçerik planı':'Content plan','@seo':tr?'SEO konusu':'SEO topic'} as Record<string,string>)[key]||key;
  if(error)return <p className="studio-error" role="alert"><Msg text={error}/></p>;
  if(!data||!data.hasBrief&&!data.drafts.length&&!data.versions.length)return null;
  const table=(title:string,rows:CoachLearningGroup[],format:(key:string)=>string)=><div className="studio-table-scroll"><table className="coach-keywords coach-learning-table"><caption className="sr-only">{title}</caption><thead><tr><th>{title}</th><th>{tr?'Taslak':'Drafts'}</th><th>{tr?'Kabul edilen yayın':'Accepted publications'}</th><th>{tr?'Etkileşim verisi olan':'With engagement data'}</th><th>{tr?'Etkileşim':'Interactions'}</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.key}><td>{format(row.key)}</td><td data-label={tr?'Taslak':'Drafts'}>{n(row.drafts)}</td><td data-label={tr?'Kabul edilen yayın':'Accepted'}>{n(row.published)}</td><td data-label={tr?'Veri olan':'With data'}>{n(row.observed)}</td><td data-label={tr?'Etkileşim':'Interactions'}>{row.observed?n(row.interactions):(tr?'Veri yok':'No data')}</td></tr>)}</tbody></table></div>;
  return <section className="studio-band mt-6 coach-learning" aria-labelledby="coach-learning-title">
    <div className="studio-section-title"><h2 id="coach-learning-title"><Lightbulb size={16}/>{tr?'Büyüme koçu: ne öğrendik':'Growth coach: what we learned'}</h2></div>
    <p className="studio-note">{tr?'Koçtan açılan taslaklar, kabul edilen yayınları ve sağlayıcının bildirdiği etkileşim. Etkileşim; beğeni, yorum, paylaşım, tıklama, kaydetme ve alıntıların toplamıdır. Gösterim ve erişim ayrı tutulur.':'Drafts opened from the coach, their accepted publications and the engagement providers reported. Interactions are likes, comments, shares, clicks, bookmarks and quotes added up; impressions and reach are kept apart.'}</p>
    {data.leader?<p className="coach-note" role="status"><Lightbulb size={14}/>{tr?`Gözlenen en yüksek etkileşim: ${data.leader.dimension==='channel'?channel(data.leader.label):theme(data.leader.label)} — gözlenen yayın başına ortalama ${n(data.leader.average)} etkileşim (${n(data.leader.observed)} yayın). Bu bir gözlemdir, neden-sonuç kanıtı değildir.`:`Highest observed engagement: ${data.leader.dimension==='channel'?channel(data.leader.label):theme(data.leader.label)} — an average of ${n(data.leader.average)} interactions per observed publication (${n(data.leader.observed)} publications). This is an observation, not proof of cause.`}</p>
      :<p className="coach-muted">{tr?'Bir kanalı veya temayı öne çıkarmak için en az iki grupta sağlayıcı etkileşim verisi ve öndeki grupta en az iki yayın gerekir. Şimdilik yeterli veri yok.':'Naming a channel or theme needs provider engagement data in at least two groups and two publications in the leading one. There isn’t enough data yet.'}</p>}
    {data.drafts.length===0?<div className="studio-empty"><p>{tr?'Henüz koçtan açılmış bir taslak yok. Koç eylemlerinden, içerik planından veya SEO brieflerinden oluşturulan taslaklar burada izlenir.':'No drafts have been opened from the coach yet. Drafts created from coach actions, the content plan or SEO briefs are tracked here.'}</p></div>:<>
      <div className="coach-review-grid coach-learning-grid">
        <section><h3>{tr?'Kanala göre':'By channel'}</h3>{table(tr?'Kanal':'Channel',data.byChannel,channel)}</section>
        <section><h3>{tr?'Temaya göre':'By theme'}</h3>{table(tr?'Tema':'Theme',data.byTheme,theme)}</section>
      </div>
      <details className="coach-resolved"><summary>{tr?`Son taslaklar (${data.drafts.length})`:`Recent drafts (${data.drafts.length})`}</summary><ul>{data.drafts.slice(0,10).map(item=><li key={item.id}><span className="coach-state">{channel(item.channel)}</span><span>{item.title} · {theme(item.theme)}</span><span className="coach-muted">{date(item.createdAt)} · {item.published?(tr?`${n(item.published)} kabul edilen yayın`:`${n(item.published)} accepted`):item.rehearsed?(tr?'Prova edildi':'Rehearsed'):(tr?'Yayın yok':'Not published')} · {item.engagement.observed?(tr?`${n(item.engagement.interactions)} etkileşim`:`${n(item.engagement.interactions)} interactions`):(tr?'etkileşim verisi yok':'no engagement data')}</span></li>)}</ul></details>
    </>}
    <div className="coach-review-grid coach-learning-grid">
      <section><h3>{tr?'Ölçümler · son 8 hafta':'Measurements · last 8 weeks'}</h3>{data.measurements.length?<ul>{data.measurements.map((item,index)=><li key={index}><strong>{item.goal[lang]} · {item.stage[lang]}:</strong> {n(item.first)} ({date(item.firstAt)}) → {n(item.last)} ({date(item.lastAt)}) · {tr?`${item.entries} kayıt`:`${item.entries} record(s)`}</li>)}</ul>:<p>{tr?'Bu dönemde ölçüm yok. Veri yok, sıfır demek değildir.':'No measurements in this period. No data is not zero.'}</p>}</section>
      <section><h3><History size={14}/> {tr?'Brief sürümleri':'Brief versions'}</h3>{data.versions.length?<ul>{data.versions.map((item,index)=><li key={`${item.revision}-${index}`}>{date(item.approvedAt)} · {kinds[item.kind][idx]} · {item.channels.map(channel).join(', ')} · {tr?`${item.planItems} eylem`:`${item.planItems} actions`}</li>)}</ul>:<p>{tr?'Henüz onaylı brief yok.':'No approved brief yet.'}</p>}
        {data.changes&&<><p className="coach-muted">{tr?'Son sürümde değişenler:':'Changed in the latest version:'}</p><ul>{briefChangeLines(data.changes,tr).map((line,index)=><li key={index}>{line}</li>)}</ul></>}</section>
    </div>
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Yalnız kayıtlı yayınlar ve sağlayıcı verisi kullanılır; tahmin, atıf veya ROI yoktur.':'Only recorded publications and provider data are used; no estimates, attribution or ROI.'}</p>
  </section>;
}
