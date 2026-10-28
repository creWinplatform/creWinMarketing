'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, CalendarPlus, Copy, EyeOff, History, Play, RefreshCw, ShieldCheck, Square, Undo2 } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';
import { developerTask } from '@/lib/platform/seo-impact';
import type { SeoFindingState, SeoFindingView, SeoOperationsSnapshot } from '@/lib/platform/seo-operations-types';
import Msg from '@/components/Msg';
import { onTabKeys } from './tab-keys';

const IMPACT:Record<string,[string,string]>={high:['Olası etki: yüksek','Likely impact: high'],medium:['Olası etki: orta','Likely impact: medium'],low:['Olası etki: düşük','Likely impact: low']};
const STATES:Record<SeoFindingState,[string,string]>={open:['Açık','Open'],fixed:['Düzeldi','Fixed'],ignored:['Yok sayıldı','Ignored']};
const EVENTS:Record<string,[string,string]>={detected:['İlk bulundu','First found'],fixed:['Düzeldi','Fixed'],reopened:['Yeniden görüldü','Seen again'],ignored:['Yok sayıldı','Ignored'],restored:['Geri alındı','Restored'],planned:['İş planına eklendi','Added to the work plan']};

// Site scan: up to N pages of the project's own public site, findings kept across scans with their history.
// The page drives the scan one page at a time; if the tab closes, the worker continues it.
export default function SeoOperations({workspace,lang}:{workspace:WorkspaceContext;lang:Locale}){
  const tr=lang==='tr',idx=tr?0:1,locale=localeTag(lang);
  const [llms,setLlms]=useState<{text:string;pages:number;fromScan:boolean;hasSummary:boolean}|null>(null);
  const [data,setData]=useState<SeoOperationsSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[filter,setFilter]=useState<SeoFindingState>('open'),[copied,setCopied]=useState('');
  const live=useRef(true),driving=useRef(false);
  const load=useCallback(()=>projectRequest<SeoOperationsSnapshot>('/api/platform/seo').then(value=>{if(live.current)setData(value);return value;}).catch(reason=>{if(live.current)setError(reason.message);return null;}),[]);
  useEffect(()=>{live.current=true;void load();return()=>{live.current=false;};},[load]);
  const post=useCallback((body:object,timeout=58000)=>projectRequest<SeoOperationsSnapshot>('/api/platform/seo',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)}),[]);
  // Drive a running scan page by page while this view is open.
  useEffect(()=>{
    if(!data?.canWrite||data.scan?.state!=='running'||driving.current)return;
    driving.current=true;
    void (async()=>{try{let value:SeoOperationsSnapshot=data;while(live.current&&value.scan?.state==='running'){value=await post({action:'step'});if(live.current)setData(value);}
      if(live.current&&value.scan?.state==='completed')setNotice(tr?'Tarama tamamlandı. Bulgular önceki taramalarla karşılaştırıldı.':'Scan completed. Findings were compared with earlier scans.');}
      catch(reason){if(live.current)setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));}finally{driving.current=false;}})();
  },[data?.scan?.id,data?.scan?.state,data?.canWrite]);
  const act=async(key:string,body:object,message?:string)=>{if(busy)return;setBusy(key);setError('');setNotice('');
    try{const value=await post(body);const snapshot='snapshot' in value?(value as unknown as {snapshot:SeoOperationsSnapshot}).snapshot:value;setData(snapshot);if(message)setNotice(message);}
    catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));void load();}finally{setBusy('');}};
  const date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'short',year:'numeric',timeZone:workspace.project.timezone});
  const path=(url:string)=>{try{const value=new URL(url);return value.pathname+value.search||'/';}catch{return url;}};
  if(!data)return error?<p className="studio-error" role="alert"><Msg text={error}/></p>:<div className="studio-skeleton" role="status">{tr?'Site taraması yükleniyor…':'Loading site scan…'}</div>;
  const scan=data.scan,running=scan?.state==='running',shown=data.findings.filter(item=>item.state===filter);
  const task=(item:SeoFindingView)=>developerTask({...item,id:item.id,rank:0},item.url,lang,text=>translateMessage(text,lang));
  return <section className="seo-ops">
    <header className="studio-page-heading"><div><p className="studio-eyebrow">{tr?`GENEL HTML · EN FAZLA ${data.maxPages} SAYFA`:`PUBLIC HTML · UP TO ${data.maxPages} PAGES`}</p><h1>{tr?'Site taraması':'Site scan'}</h1>
      <p className="studio-subtitle">{tr?'Sitenizin sayfalarını tarar, bulguları taramalar arasında izler: neyin düzeldiğini, neyin yeniden çıktığını görürsünüz.':'Scans your site’s pages and tracks findings across scans, so you can see what got fixed and what came back.'}</p></div>
      {data.canWrite&&<div className="overview-header-actions">{running?<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void act('cancel',{action:'cancel'},tr?'Tarama durduruldu; o ana kadarki bulgular korundu.':'Scan stopped; findings so far are kept.')}><Square size={15}/>{tr?'Taramayı durdur':'Stop the scan'}</button>
        :<button type="button" className="studio-primary" title={scan?(tr?'Yeniden tara':'Scan again'):(tr?'Taramayı başlat':'Start the scan')} disabled={Boolean(busy)||!data.origin} onClick={()=>void act('start',{action:'start'})}><Play size={15}/>{scan?(tr?'Yeniden tara':'Scan again'):(tr?'Taramayı başlat':'Start the scan')}</button>}</div>}
    </header>
    {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}
    {notice&&<p className="coach-note" role="status">{notice}</p>}
    {!scan?<div className="studio-empty"><p>{data.origin?(tr?`${data.origin} için henüz tarama yok. Tarama; sitemap’ten (yoksa ana sayfa bağlantılarından) en fazla ${data.maxPages} sayfayı denetler ve bir denetim hakkı kullanır.`:`No scan yet for ${data.origin}. A scan audits up to ${data.maxPages} pages from the sitemap (or home-page links) and uses one audit credit.`):(tr?'Önce proje ayarlarında web sitesi adresini girin.':'Enter the website address in project settings first.')}</p></div>
      :<div className="studio-data-notice mt-4" role="status"><span className="status-dot"/>
        {running?(tr?`Taranıyor: ${scan.pages.done+scan.pages.failed}/${scan.pages.total} sayfa`:`Scanning: ${scan.pages.done+scan.pages.failed}/${scan.pages.total} pages`):scan.state==='cancelled'?(tr?`Durduruldu · ${date(scan.startedAt)}`:`Stopped · ${date(scan.startedAt)}`):(tr?`Son tarama ${date(scan.finishedAt||scan.startedAt)}`:`Last scan ${date(scan.finishedAt||scan.startedAt)}`)}
        {' · '}{tr?`${scan.pages.done} sayfa denetlendi`:`${scan.pages.done} page(s) audited`}{scan.pages.failed?(tr?` · ${scan.pages.failed} sayfa alınamadı`:` · ${scan.pages.failed} page(s) could not be fetched`):''}
        {' · '}{scan.source==='sitemap'?(tr?'kaynak: sitemap':'source: sitemap'):(tr?'kaynak: ana sayfa bağlantıları':'source: home-page links')}
        {running&&<progress className="seo-ops-progress" max={scan.pages.total} value={scan.pages.done+scan.pages.failed} aria-label={tr?'Tarama ilerlemesi':'Scan progress'}/>}
      </div>}
    {data.origin&&<div className="seo-schedule" role="group" aria-label={tr?'Otomatik tarama':'Automatic scan'}>
      <CalendarClock size={16} aria-hidden="true"/>
      <div><strong>{tr?'Otomatik tarama':'Automatic scan'}</strong>
        <small>{data.schedule.cadence?(tr?`Sıradaki: ${date(data.schedule.nextAt!)} · yeni veya yeniden görülen bulgular “Dikkat gerekenler”e düşer. Her tarama bir denetim hakkı kullanır${data.schedule.ownedByYou?'':' ve onu ayarlayan ekip üyesinin yetkisiyle çalışır'}.`:`Next: ${date(data.schedule.nextAt!)} · new or returning findings appear in “Needs attention”. Each scan uses one audit credit${data.schedule.ownedByYou?'':' and runs with the rights of the teammate who set it'}.`):(tr?'Siteniz belirli aralıklarla kendiliğinden taranır; yeni bir sorun çıkınca haber verilir.':'Your site is scanned on its own at a set interval; you hear about new issues.')}</small>
        {data.schedule.lastError&&<small className="seo-schedule-error" role="status"><Msg text={data.schedule.lastError}/> {tr?'Yarın yeniden denenecek.':'It is retried tomorrow.'}</small>}
      </div>
      {data.canWrite?<select aria-label={tr?'Tarama sıklığı':'Scan frequency'} value={data.schedule.cadence||'off'} disabled={Boolean(busy)} onChange={event=>void act('schedule',{action:'schedule',cadence:event.target.value},event.target.value==='off'?(tr?'Otomatik tarama kapatıldı.':'Automatic scan turned off.'):(tr?'Otomatik tarama açıldı.':'Automatic scan turned on.'))}>
        <option value="off">{tr?'Kapalı':'Off'}</option><option value="weekly">{tr?'Haftada bir':'Weekly'}</option><option value="monthly">{tr?'Ayda bir':'Monthly'}</option>
      </select>:<span className="studio-badge">{data.schedule.cadence==='weekly'?(tr?'Haftada bir':'Weekly'):data.schedule.cadence==='monthly'?(tr?'Ayda bir':'Monthly'):(tr?'Kapalı':'Off')}</span>}
    </div>}
    {data.findings.some(item=>item.state==='open'&&item.title==='llms.txt bulunamadı')&&<div className="seo-llms">
      <p><strong>{tr?'llms.txt taslağı':'llms.txt draft'}</strong> · {tr?'Proje adınızdan, onaylı stratejinizden ve son taramada okunan sayfalardan hazırlanır. Düzenleyip sitenizin köküne /llms.txt olarak koyun; Ryzevo sitenizi değiştirmez.':'Built from your project name, approved strategy and the pages the last scan read. Edit it and put it at your site root as /llms.txt; Ryzevo does not change your site.'}</p>
      {llms?<><textarea readOnly rows={Math.min(18,llms.text.split('\n').length+1)} value={llms.text} aria-label={tr?'llms.txt taslağı':'llms.txt draft'}/>{!llms.hasSummary&&<p className="coach-muted">{tr?'Özet satırını siz doldurun; strateji onaylandıysa konumlandırmanız buraya gelir.':'Fill in the summary line yourself; once the strategy is approved your positioning appears here.'}</p>}
        <button type="button" className="studio-text-button" onClick={()=>{void navigator.clipboard?.writeText(llms.text).then(()=>setCopied('llms')).catch(()=>setCopied(''));}}><Copy size={14}/>{copied==='llms'?(tr?'Kopyalandı':'Copied'):(tr?'Taslağı kopyala':'Copy the draft')}</button></>
        :<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>{setBusy('llms');projectRequest<{text:string;pages:number;fromScan:boolean;hasSummary:boolean}>('/api/platform/seo?view=llms').then(setLlms).catch(reason=>setError(reason.message)).finally(()=>setBusy(''));}}>{tr?'Taslağı hazırla':'Prepare the draft'}</button>}
    </div>}
    {running&&!data.canWrite&&<p className="coach-muted">{tr?'Tarama süreniyor; sayfa kapatılsa da arka planda tamamlanır.':'The scan is running; it finishes in the background even if this page is closed.'}</p>}
    <div className="publication-view-tabs seo-ops-filter" role="tablist" onKeyDown={onTabKeys} aria-label={tr?'Bulgu durumu':'Finding state'}>
      {(['open','fixed','ignored'] as const).map(state=><button key={state} role="tab" aria-selected={filter===state} tabIndex={filter===state?0:-1} onClick={()=>setFilter(state)}>{STATES[state][idx]} ({data.counts[state]})</button>)}
    </div>
    {shown.length===0?<div className="studio-empty"><p>{filter==='open'?(scan&&!running?(tr?'Açık bulgu yok. Bu, kontrol edilen kurallarda sorun bulunmadığı anlamına gelir; indeks veya hız başarısı değildir.':'No open findings. This means the checked rules found no issue; it is not indexing or speed success.'):(tr?'Henüz açık bulgu yok.':'No open findings yet.')):filter==='fixed'?(tr?'Henüz düzelen bulgu yok. Bir bulgu, sayfası başarıyla yeniden tarandığında görünmüyorsa düzeldi sayılır.':'Nothing fixed yet. A finding counts as fixed when its page is scanned again successfully and the finding is gone.'):(tr?'Yok sayılan bulgu yok.':'No ignored findings.')}</p></div>
      :<ul className="seo-ops-list">{shown.map(item=><li key={item.id} className="studio-draft-row">
        <div className="studio-draft-top"><div>
          <span className="studio-badge">{IMPACT[item.impact]?.[idx]} · {translateMessage(item.category,lang)}</span>
          <h2 className="mt-2">{translateMessage(item.title,lang)}</h2>
          <p className="coach-muted">{item.siteWide?(tr?'Tüm site':'Whole site'):<a href={item.url} target="_blank" rel="noreferrer">{path(item.url)}</a>} · {tr?`ilk ${date(item.firstSeenAt)}, son ${date(item.lastSeenAt)}`:`first ${date(item.firstSeenAt)}, last ${date(item.lastSeenAt)}`}{item.fixedAt?(tr?` · düzeldi ${date(item.fixedAt)}`:` · fixed ${date(item.fixedAt)}`):''}</p>
        </div>
        {data.canWrite&&<div className="coach-action-buttons">
          {item.state==='open'&&(item.task&&!['completed','cancelled'].includes(item.task.status)?<a className="studio-text-button" href="/?tab=calendar"><CalendarPlus size={15}/>{tr?'İş planında':'In the work plan'}</a>
            :<button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={()=>void act(item.id,{action:'plan',id:item.id},tr?'İş planına eklendi. Siteniz değiştirilmedi.':'Added to the work plan. Your site was not changed.')}><CalendarPlus size={15}/>{tr?'İş planına ekle':'Add to work plan'}</button>)}
          {item.state==='open'&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void act(item.id,{action:'decide',id:item.id,decision:'ignore',expectedRevision:item.revision})}><EyeOff size={14}/>{tr?'Yok say':'Ignore'}</button>}
          {item.state==='ignored'&&<button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={()=>void act(item.id,{action:'decide',id:item.id,decision:'restore',expectedRevision:item.revision})}><Undo2 size={14}/>{tr?'Geri al':'Restore'}</button>}
        </div>}</div>
        <p className="studio-draft-content">{translateMessage(item.detail,lang)}</p>
        <p className="studio-note">{translateMessage(item.evidence,lang)}</p>
        <p className="mt-2 text-xs"><strong>{tr?'Nasıl düzeltilir: ':'How to fix: '}</strong>{item.how[lang]}</p>
        {item.state==='fixed'&&item.task&&!['completed','cancelled'].includes(item.task.status)&&<p className="coach-note">{tr?'Bu bulgu düzeldi; Takvim’deki işini tamamlandı olarak işaretleyebilirsiniz.':'This finding is fixed; you can mark its Calendar task as completed.'}</p>}
        <details className="coach-dev-task"><summary><History size={13}/> {tr?'Geçmiş ve geliştirici görevi':'History and developer task'}</summary>
          <ul className="seo-ops-history">{item.events.map((event,index)=><li key={index}><span className="coach-state">{EVENTS[event.kind]?.[idx]||event.kind}</span>{date(event.at)}</li>)}</ul>
          <pre>{task(item)}</pre><button type="button" className="studio-text-button" onClick={()=>{void navigator.clipboard?.writeText(task(item)).then(()=>setCopied(item.id)).catch(()=>setCopied(''));}}><Copy size={14}/>{copied===item.id?(tr?'Kopyalandı':'Copied'):(tr?'Metni kopyala':'Copy the text')}</button></details>
      </li>)}</ul>}
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Yalnız herkese açık HTML okunur; siteniz değiştirilmez, hiçbir şey yayınlanmaz. Google indeks durumu ve Core Web Vitals ölçülmez.':'Only public HTML is read; your site is not changed and nothing is published. Google indexing and Core Web Vitals are not measured.'}</p>
    {running&&data.canWrite&&<p className="coach-muted"><RefreshCw size={12} className="animate-spin"/> {tr?'Sayfayı kapatırsanız tarama arka planda sürer.':'If you close the page, the scan continues in the background.'}</p>}
  </section>;
}
