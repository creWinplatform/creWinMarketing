'use client';
import { ExternalLink } from 'lucide-react';
import type { MonthlyReportFacts } from '@/lib/platform/monthly-report-types';

const CHANNELS:Record<string,string>={linkedin:'LinkedIn',facebook:'Facebook',instagram:'Instagram',twitter:'X',telegram:'Telegram',social:'Sosyal / Social'};
const SOURCES:Record<string,[string,string]>={manual:['Manuel kayıt','Manual record'],ga4:['Google Analytics','Google Analytics'],search_console:['Search Console','Search Console'],product_event:['Ürün olayları','Product events']};
const PROVIDERS:Record<string,string>={meta:'Meta',google:'Google Ads',linkedin:'LinkedIn'};

// The report itself, in the report's own language: the same markup is previewed by the team and opened by a link.
export default function MonthlyReportDocument({facts,note,approvedAt,draft}:{facts:MonthlyReportFacts;note:string;approvedAt:string|null;draft?:boolean}){
  const tr=facts.language==='tr',locale=tr?'tr-TR':'en-GB',n=(value:number)=>value.toLocaleString(locale,{maximumFractionDigits:1});
  const date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'short',year:'numeric',timeZone:facts.timezone});
  const day=(value:string)=>new Date(`${value.slice(0,10)}T12:00:00Z`).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:'UTC'});
  const month=new Date(`${facts.month}-15T12:00:00Z`).toLocaleDateString(locale,{month:'long',year:'numeric',timeZone:'UTC'});
  const lastDay=new Date(Date.parse(facts.to)-1);
  const money=(minor:number,currency:string)=>{try{const format=new Intl.NumberFormat(locale,{style:'currency',currency});return format.format(minor/10**(format.resolvedOptions().maximumFractionDigits??2));}catch{return `${n(minor)} ${currency}`;}};
  const channel=(key:string)=>CHANNELS[key]||key,dash=tr?'Veri yok':'No data';
  const tiles=[
    {label:tr?'Yayınlanan paylaşım':'Posts published',value:n(facts.publications.total)},
    {label:tr?'Paylaşımlardan siteye gelen oturum':'Site sessions from posts',value:facts.site?n(facts.site.sessions):dash},
    {label:tr?'Önemli olay (Google Analytics)':'Key events (Google Analytics)',value:facts.site?n(facts.site.keyEvents):dash},
    {label:tr?'Cevaplanan yorum ve mesaj':'Comments and messages answered',value:facts.inbox?n(facts.inbox.replied):dash},
    {label:tr?'Pilot e-posta gönderimi':'Pilot email sends',value:facts.email?n(facts.email.sends):dash},
    {label:tr?'Tamamlanan iş':'Work completed',value:n(facts.work.coachActionsDone+facts.work.tasksCompleted)},
  ];
  return <article className="monthly-report" lang={facts.language}>
    <header className="monthly-report-head">
      <p className="studio-eyebrow">{tr?'AYLIK SONUÇ RAPORU':'MONTHLY RESULTS REPORT'}{draft?(tr?' · TASLAK':' · DRAFT'):''}</p>
      <h1>{facts.project.name} · {month}</h1>
      <p>{date(facts.from)} – {date(lastDay.toISOString())} · {facts.timezone}{approvedAt?(tr?` · onaylandı ${date(approvedAt)}`:` · approved ${date(approvedAt)}`):''}</p>
    </header>
    {note&&<section className="monthly-report-note"><h2>{tr?'Ekipten not':'A note from the team'}</h2><p>{note}</p></section>}
    <dl className="monthly-report-tiles">{tiles.map(tile=><div key={tile.label}><dt>{tile.label}</dt><dd>{tile.value}</dd></div>)}</dl>
    <section><h2>{tr?'Paylaşımlar':'Posts'}</h2>
      {facts.publications.total?<>
        <p>{facts.publications.byChannel.map(item=>`${channel(item.channel)}: ${n(item.count)}`).join(' · ')}{facts.engagement?(tr?` · sağlayıcının bildirdiği ${n(facts.engagement.interactions)} etkileşim (${n(facts.engagement.observed)} paylaşımda ölçüldü)`:` · ${n(facts.engagement.interactions)} interactions reported by providers (measured on ${n(facts.engagement.observed)} posts)`):''}</p>
        <div className="studio-table-scroll" tabIndex={0} role="region" aria-label={tr?'Öne çıkan paylaşımlar':'Top posts'}><table className="studio-table"><thead><tr><th scope="col">{tr?'Paylaşım':'Post'}</th><th scope="col">{tr?'Kanal':'Channel'}</th><th scope="col">{tr?'Tarih':'Date'}</th><th scope="col">{tr?'Siteye oturum':'Site sessions'}</th><th scope="col">{tr?'Önemli olay':'Key events'}</th><th scope="col">{tr?'Etkileşim':'Interactions'}</th></tr></thead>
          <tbody>{facts.publications.top.map((post,index)=><tr key={index}><td>{post.url?<a href={post.url} target="_blank" rel="noopener noreferrer">{post.title}<ExternalLink size={12} aria-hidden="true"/></a>:post.title}</td><td>{channel(post.channel)}</td><td>{date(post.publishedAt)}</td><td>{post.sessions===null?'—':n(post.sessions)}</td><td>{post.keyEvents===null?'—':n(post.keyEvents)}</td><td>{post.interactions===null?'—':n(post.interactions)}</td></tr>)}</tbody></table></div>
        {facts.site&&<p className="monthly-report-muted">{tr?`Siteye gelen oturumlar, bu ayın paylaşımlarındaki etiketli bağlantılardan gelenlerdir; Google Analytics ${day(facts.site.from)}–${day(facts.site.to)} dönemi için bildirdi (son okuma ${date(facts.site.checkedAt)}).${facts.site.state==='partial'?' Google Analytics eksik veya örneklenmiş veri bildirdi.':''}`:`Site sessions arrived through tagged links in this month’s posts, as Google Analytics reported them for ${day(facts.site.from)}–${day(facts.site.to)} (last read ${date(facts.site.checkedAt)}).${facts.site.state==='partial'?' Google Analytics reported thresholded or sampled data.':''}`}</p>}
      </>:<p>{tr?'Bu ay yayınlanan paylaşım yok.':'No posts were published this month.'}</p>}
    </section>
    {facts.inbox&&<section><h2>{tr?'Yorumlar ve mesajlar':'Comments and messages'}</h2>
      <p>{tr?`${n(facts.inbox.received)} yeni kayıt (${n(facts.inbox.comments)} yorum, ${n(facts.inbox.messages)} mesaj) · ${n(facts.inbox.replied)} cevaplandı · ${n(facts.inbox.messagesInWindow)} mesaj 24 saat içinde cevaplandı · ${n(facts.inbox.open)} açık · ${n(facts.inbox.dismissed)} kapatıldı.`:`${n(facts.inbox.received)} new (${n(facts.inbox.comments)} comments, ${n(facts.inbox.messages)} messages) · ${n(facts.inbox.replied)} answered · ${n(facts.inbox.messagesInWindow)} messages answered within 24 hours · ${n(facts.inbox.open)} open · ${n(facts.inbox.dismissed)} dismissed.`}</p></section>}
    {facts.email&&<section><h2>{tr?'E-posta':'Email'}</h2>
      <p>{tr?`${n(facts.email.sends)} pilot gönderim · ${n(facts.email.accepted)} sağlayıcı kabul etti · ${n(facts.email.delivered)} teslim edildi · ${n(facts.email.bounced)} geri döndü · ${n(facts.email.complained)} şikâyet. Kabul, teslim demek değildir; açılma ve tıklama izlenmez.`:`${n(facts.email.sends)} pilot send(s) · ${n(facts.email.accepted)} accepted by the provider · ${n(facts.email.delivered)} delivered · ${n(facts.email.bounced)} bounced · ${n(facts.email.complained)} complaints. Acceptance is not delivery; opens and clicks are not tracked.`}</p></section>}
    {facts.ads.length>0&&<section><h2>{tr?'Reklamlar':'Ads'}</h2>
      <div className="studio-table-scroll" tabIndex={0} role="region" aria-label={tr?'Reklam planları':'Ad plans'}><table className="studio-table"><thead><tr><th scope="col">{tr?'Plan':'Plan'}</th><th scope="col">{tr?'Sağlayıcı':'Provider'}</th><th scope="col">{tr?'Harcama':'Spend'}</th><th scope="col">{tr?'Gösterim':'Impressions'}</th><th scope="col">{tr?'Tıklama':'Clicks'}</th></tr></thead>
        <tbody>{facts.ads.map((plan,index)=><tr key={index}><td>{plan.name}</td><td>{PROVIDERS[plan.provider]||plan.provider}</td><td>{plan.spendMinor===null?'—':money(plan.spendMinor,plan.currency)}</td><td>{plan.impressions===null?'—':n(plan.impressions)}</td><td>{plan.clicks===null?'—':n(plan.clicks)}</td></tr>)}</tbody></table></div>
      <p className="monthly-report-muted">{tr?'Harcama, gösterim ve tıklama planın başından son okumaya kadar sağlayıcının bildirdiği toplamdır; yalnız bu aya ait değildir.':'Spend, impressions and clicks are the provider-reported totals from the start of each plan to the last reading, not this month alone.'}</p></section>}
    <section><h2>{tr?'Hedef ölçümleri':'Goal measurements'}</h2>
      {facts.measurements.length?<ul>{facts.measurements.map((item,index)=><li key={index}><strong>{item.goal[facts.language]} · {item.stage[facts.language]}:</strong> {n(item.first)} ({date(item.firstAt)}) → {n(item.last)} ({date(item.lastAt)}) · {SOURCES[item.source]?.[tr?0:1]||item.source}</li>)}</ul>
      :<p>{tr?'Bu ay ölçüm kaydedilmedi. Veri yok, sıfır demek değildir.':'No measurement was recorded this month. No data is not zero.'}</p>}</section>
    <section><h2>{tr?'Yapılan işler':'Work done'}</h2>
      <p>{tr?`${n(facts.work.drafts)} içerik taslağı · ${n(facts.work.coachActionsDone)} koç eylemi tamamlandı · ${n(facts.work.contentPlanApproved)} içerik planı maddesi onaylandı · ${n(facts.work.tasksCompleted)} iş tamamlandı.`:`${n(facts.work.drafts)} content draft(s) · ${n(facts.work.coachActionsDone)} coach action(s) done · ${n(facts.work.contentPlanApproved)} content plan item(s) approved · ${n(facts.work.tasksCompleted)} task(s) completed.`}</p></section>
    <footer className="monthly-report-muted">{tr?'Sayılar ekibin Ryzevo kayıtlarından ve sağlayıcıların bildirdiği verilerden alınmıştır. Aynı dönemde olmaları neden-sonuç kanıtı değildir; tahmin veya ROI hesaplanmaz. Rapor kişisel veri ve müşteri mesajı içermez.':'Figures come from the team’s Ryzevo records and provider-reported data. Appearing in the same period is not proof of cause; no estimates or ROI are calculated. The report contains no personal data or customer messages.'}</footer>
  </article>;
}
