'use client';
import type { Publication } from '@/lib/platform/social-publication-types';
import { localeTag } from '@/lib/i18n/shared';

// Visits to the team's own site that arrived through this post's tagged link, as Google Analytics reported them.
export default function PublicationSite({item,tr}:{item:Publication;tr:boolean}){
  const site=item.site;if(!site)return null;
  const n=(value:number)=>value.toLocaleString(localeTag(tr?'tr':'en'),{maximumFractionDigits:1});
  const day=(value:string)=>new Date(`${value}T12:00:00Z`).toLocaleDateString(localeTag(tr?'tr':'en'),{day:'numeric',month:'short',timeZone:'UTC'});
  const period=site.from&&site.to?` · ${day(site.from)}–${day(site.to)}`:'';
  return <section className="publication-engagement publication-site" aria-label={tr?'Sitenize gelen ziyaretler':'Visits to your site'}><header><h4>{tr?'Sitenize gelen (Google Analytics)':'Visits to your site (Google Analytics)'}</h4></header>
    {site.status==='ready'||site.status==='partial'&&site.sessions!==null?<>
      <dl className="publication-metrics"><div><dt>{tr?'Oturum':'Sessions'}</dt><dd>{n(site.sessions!)}</dd></div><div><dt>{tr?'Önemli olay':'Key events'}</dt><dd>{n(site.keyEvents!)}</dd></div></dl>
      <small>{tr?'Bu paylaşımdaki etiketli bağlantıdan gelen':'Arrived through this post’s tagged link'}{period}{site.status==='partial'?(tr?' · veri eksik olabilir':' · data may be incomplete'):''}</small></>
    :<p className="studio-note">{site.status==='none'?(tr?`Bu dönemde etiketli bağlantıdan gelen oturum görülmedi${period}.`:`No session arrived through the tagged link in this period${period}.`)
      :site.status==='partial'?(tr?'Google Analytics bu dönem için eksik veri bildirdi; bu paylaşımın sonucu belirsiz.':'Google Analytics reported incomplete data for this period; this post’s result is unknown.')
      :site.status==='pending'?(tr?'Ölçüm bekleniyor. Google Analytics verisi bir gün gecikmeli okunur.':'Waiting for measurement. Google Analytics data is read a day later.')
      :site.status==='failed'?(tr?'Google Analytics sonucu okunamadı.':'The Google Analytics result could not be read.')
      :(tr?'Sonuçları görmek için yukarıda bir Google Analytics mülkü seçin.':'Choose a Google Analytics property above to see results.')}</p>}
  </section>;
}
