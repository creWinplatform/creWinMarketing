'use client';
import { RefreshCw } from 'lucide-react';
import type { Publication } from '@/lib/platform/social-publication-types';

export default function PublicationEngagement({item,tr,busy,canManage,refresh,date}:{item:Publication;tr:boolean;busy:boolean;canManage:boolean;refresh:()=>void;date:(value:string)=>string}){
  const data=item.engagement;if(item.mode!=='publish'||item.state!=='accepted'||!data)return null;
  const labels:Record<string,string>={likes:item.platform==='facebook'?(tr?'Tepki':'Reactions'):(tr?'Beğeni':'Likes'),comments:tr?'Yorum / Yanıt':'Comments / Replies',shares:tr?'Paylaşım':'Shares',impressions:tr?'Gösterim':'Impressions',clicks:tr?'Tıklama':'Clicks',reach:tr?'Tekil erişim':'Unique reach',bookmarks:tr?'Yer imi':'Bookmarks',quotes:tr?'Alıntı':'Quotes'};
  const fields=item.platform==='instagram'?['likes','comments']:item.platform==='facebook'?['likes','comments','shares']:item.platform==='twitter'?['likes','comments','shares','quotes','bookmarks','impressions']:['likes','comments','shares','impressions','clicks','reach'];
  return <section className="publication-engagement" aria-label={tr?'Yayın etkileşimi':'Publication engagement'}><header><h4>{tr?'Etkileşim':'Engagement'}</h4>{canManage&&data.status!=='unsupported'&&<button className="icon-button" type="button" title={tr?'Etkileşimi yenile (dakikada bir)':'Refresh engagement (once per minute)'} aria-label={`${tr?'Etkileşimi yenile':'Refresh engagement'} ${item.title}`} disabled={busy||data.status==='refreshing'} onClick={refresh}><RefreshCw size={16}/></button>}</header>
    {data.status==='unsupported'?<p className="studio-note">{tr?'Bu hesap türü için ölçüm erişimi etkin değil.':'Measurement access is not enabled for this account type.'}</p>:<>
      <dl className="publication-metrics">{fields.map(name=><div key={name}><dt>{labels[name]}</dt><dd>{data.counts[name as keyof typeof data.counts]===undefined?'—':data.counts[name as keyof typeof data.counts]!.toLocaleString(tr?'tr-TR':'en-GB')}</dd></div>)}</dl>
      {data.observedAt&&<small>{tr?'Sağlayıcıdan alındı':'Retrieved from provider'}: {date(data.observedAt)}</small>}
      {data.status==='not_requested'&&<p className="studio-note">{tr?'Henüz ölçüm alınmadı.':'Metrics have not been retrieved yet.'}</p>}
      {data.status==='refreshing'&&<p role="status" className="studio-note">{tr?'Sağlayıcıdan ölçüm alınıyor…':'Retrieving provider metrics…'}</p>}
      {data.status==='unavailable'&&<p role="status" className="studio-note">{tr?'Son yenileme başarısız. İzinleri ve sağlayıcı erişimini kontrol edin. Varsa son başarılı ölçüm gösteriliyor.':'Last refresh failed. Check permissions and provider access. The last successful measurement is shown when available.'}</p>}
    </>}
  </section>;
}
