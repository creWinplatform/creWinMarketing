import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { auditPublicPage, discoverSiteUrls, type AuditFinding, type PageAudit } from '../site-audit';
import { translateMessage } from '../i18n/messages';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { ProjectOperations } from './operations';
import { compassSiteReceipt } from './guidance';
import { coachState } from './coach-compass';
import { developerTask, rankAuditFindings } from './seo-impact';
import { readSearchConsoleTotals, type SearchConsoleQuery, type SearchConsoleTotalsReader } from './search-console-queries';
import { decryptCredentials, encryptCredentials, type StoredCredentials } from './credential-envelope';
import { refreshGoogleCredentials } from './google-client';
import { searchDropped, SEO_SCAN_MAX_PAGES, SEO_SCHEDULE_DAYS, type SeoScheduleView, type SeoSearchWatchView, type SeoFindingEvent, type SeoFindingState, type SeoFindingView, type SeoOpportunitiesSnapshot, type SeoOpportunity, type SeoOperationsSnapshot, type SeoScanView } from './seo-operations-types';

type Scan={id:string;origin:string;source:'sitemap'|'homepage_links';discovered:number;state:'running'|'completed'|'cancelled';started_via:'manual'|'schedule';started_by:string;started_at:string;updated_at:string;finished_at:string|null};
type Page={scan_id:string;position:number;url:string;state:string;lease_token:string|null;lease_until:string|null;attempts:number};
type Finding={id:string;finding_key:string;url:string;category:string;title:string;priority:'high'|'medium'|'low';detail:string;recommendation:string;evidence:string;state:SeoFindingState;first_seen_at:string;last_seen_at:string;last_scan_id:string;fixed_at:string|null;task_id:string|null;revision:number};
export type SeoDependencies={audit?:(url:string)=>Promise<PageAudit>;discover?:typeof discoverSiteUrls};
const LEASE_MS=90000,MAX_ATTEMPTS=2,STALE_MS=120000;
// robots.txt and sitemap checks describe the whole site, so they are tracked once per origin, not once per page.
const SITE_WIDE=new Set(['robots.txt doğrulanamadı','Sitemap doğrulanamadı','AI arama botları engelli','llms.txt bulunamadı']);
const normalize=(value:string)=>{const url=new URL(value);url.hash='';return url.toString();};
const keyOf=(url:string,finding:Pick<AuditFinding,'category'|'title'>)=>createHash('sha256').update(`${url}\n${finding.category}\n${finding.title}`).digest('hex');

// SEO operations: multi-page scans of the project's own public site, findings kept across scans with their history.
// Scans read public HTML only; nothing on the site is changed and nothing is published.
export class SeoOperations{
  repo:PlatformRepository;audit:(url:string)=>Promise<PageAudit>;discover:typeof discoverSiteUrls;
  constructor(public db:Database.Database,public scope:MarketingScope,dependencies:SeoDependencies={}){this.repo=new PlatformRepository(db);this.audit=dependencies.audit||auditPublicPage;this.discover=dependencies.discover||discoverSiteUrls;}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private can(permission:'read'|'content.write'|'connections.manage'){return this.repo.can(this.scope.subject,...this.args(),permission);}
  private project(){return this.repo.workspace(this.scope.subject,...this.args())?.project;}
  authorize(permission:'read'|'content.write'='read'){
    if(!this.can('read')||this.project()?.productPack!=='standard')throw new MarketingStoreError('SEO operasyonu için standart proje erişimi gerekli.',403);
    if(!this.can(permission))throw new MarketingStoreError('Bu işlem için içerik yazma yetkisi gerekir.',403);
  }
  private origin(){const website=this.project()?.website;try{return website?new URL(website).origin:null;}catch{return null;}}
  private audit_(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  private running(){return this.db.prepare("SELECT * FROM platform_seo_scans WHERE organization_id=? AND project_id=? AND state='running' ORDER BY started_at DESC LIMIT 1").get(...this.args()) as Scan|undefined;}
  private latest(){return this.db.prepare('SELECT * FROM platform_seo_scans WHERE organization_id=? AND project_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(...this.args()) as Scan|undefined;}
  private event(findingId:string,kind:SeoFindingEvent['kind'],scanId:string|null,actor:string|null,at=new Date().toISOString()){this.db.prepare('INSERT INTO platform_seo_finding_events(finding_id,organization_id,project_id,kind,scan_id,actor_id,at) VALUES(?,?,?,?,?,?,?)').run(findingId,...this.args(),kind,scanId,actor,at);}
  // Starts a scan of up to SEO_SCAN_MAX_PAGES pages from the sitemap (or home-page links). One audit unit per scan.
  async start(via:'manual'|'schedule'='manual'){
    this.authorize('content.write');const origin=this.origin();if(!origin)throw new MarketingStoreError('Önce proje ayarlarında web sitesi adresini girin.',409);
    if(this.running())return this.read();
    const operations=new ProjectOperations(this.db,this.scope),reservation=operations.reserveAi('audits');let completed=false;
    try{
      let found:Awaited<ReturnType<typeof discoverSiteUrls>>;
      try{found=await this.discover(origin,SEO_SCAN_MAX_PAGES);}catch{throw new MarketingStoreError('Sitenin sayfaları bulunamadı. Adresin herkese açık olduğunu kontrol edin.',502);}
      const urls=[...new Set(found.urls.map(normalize).filter(url=>new URL(url).origin===origin))].slice(0,SEO_SCAN_MAX_PAGES);
      if(!urls.length)throw new MarketingStoreError('Sitenin sayfaları bulunamadı. Adresin herkese açık olduğunu kontrol edin.',502);
      this.db.transaction(()=>{
        this.authorize('content.write');if(this.running())throw new MarketingStoreError('Bu proje için zaten süren bir tarama var.',409);
        const id=`seoscan_${randomUUID()}`,now=new Date().toISOString();
        this.db.prepare("INSERT INTO platform_seo_scans(id,organization_id,project_id,origin,source,discovered,state,started_via,started_by,started_at,updated_at) VALUES(?,?,?,?,?,?,'running',?,?,?,?)").run(id,...this.args(),origin,found.source,found.discoveredCount,via,this.scope.subject,now,now);
        const insert=this.db.prepare("INSERT INTO platform_seo_scan_pages(scan_id,organization_id,project_id,position,url,state) VALUES(?,?,?,?,?,'pending')");
        urls.forEach((url,index)=>insert.run(id,...this.args(),index,url));
        operations.completeAi(reservation);completed=true;this.audit_(via==='schedule'?'seo.scan.scheduled':'seo.scan.start');
      }).immediate();
    }catch(error){if(!completed){try{operations.refundAi(reservation);}catch{console.error('platform_usage_release_failed');}}throw error;}
    return this.read();
  }
  // Audits the next page of the running scan. Safe to call from several tabs and from the worker: each page is leased.
  async step(){
    this.authorize('content.write');const token=randomUUID();
    const claimed=this.db.transaction(()=>{
      const scan=this.running();if(!scan)return null;
      if(scan.origin!==this.origin()){this.cancelScan(scan.id);return null;}
      const now=new Date(),page=this.db.prepare("SELECT * FROM platform_seo_scan_pages WHERE scan_id=? AND (state='pending' OR state='running' AND lease_until<?) ORDER BY position LIMIT 1").get(scan.id,now.toISOString()) as Page|undefined;
      if(!page){this.finalize(scan.id);return null;}
      if(page.attempts>=MAX_ATTEMPTS){this.db.prepare("UPDATE platform_seo_scan_pages SET state='failed',error='attempts',lease_token=NULL,lease_until=NULL,checked_at=? WHERE scan_id=? AND url=?").run(now.toISOString(),scan.id,page.url);return {scan,page:null};}
      this.db.prepare("UPDATE platform_seo_scan_pages SET state='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE scan_id=? AND url=?").run(token,new Date(now.getTime()+LEASE_MS).toISOString(),scan.id,page.url);
      this.db.prepare('UPDATE platform_seo_scans SET updated_at=? WHERE id=?').run(now.toISOString(),scan.id);
      return {scan,page};
    }).immediate();
    if(!claimed)return this.read();
    if(!claimed.page){this.db.transaction(()=>this.settle(claimed.scan.id)).immediate();return this.read();}
    let result:PageAudit|null=null,failure='';
    try{result=await this.audit(claimed.page.url);}catch(error){failure=(error instanceof Error?error.message:'audit').slice(0,200);}
    this.db.transaction(()=>{
      const page=this.db.prepare('SELECT * FROM platform_seo_scan_pages WHERE scan_id=? AND url=?').get(claimed.scan.id,claimed.page!.url) as Page|undefined,scan=this.db.prepare('SELECT * FROM platform_seo_scans WHERE id=?').get(claimed.scan.id) as Scan;
      if(!page||page.lease_token!==token||page.state!=='running'||scan.state!=='running')return;
      const now=new Date().toISOString();
      if(!result){this.db.prepare("UPDATE platform_seo_scan_pages SET state=?,error=?,lease_token=NULL,lease_until=NULL,checked_at=? WHERE scan_id=? AND url=?").run(page.attempts>=MAX_ATTEMPTS?'failed':'pending',failure,now,scan.id,page.url);}
      else{this.record(scan,page.url,result,now);this.db.prepare("UPDATE platform_seo_scan_pages SET state='done',http_status=?,findings=?,error=NULL,lease_token=NULL,lease_until=NULL,checked_at=? WHERE scan_id=? AND url=?").run(result.httpStatus,result.findings.length,now,scan.id,page.url);}
      this.db.prepare('UPDATE platform_seo_scans SET updated_at=? WHERE id=?').run(now,scan.id);
      this.settle(scan.id);
    }).immediate();
    return this.read();
  }
  private settle(scanId:string){const left=(this.db.prepare("SELECT COUNT(*) n FROM platform_seo_scan_pages WHERE scan_id=? AND state IN ('pending','running')").get(scanId) as {n:number}).n;if(!left)this.finalize(scanId);}
  // Upserts this page's findings: new ones are detected, fixed ones that came back are reopened, ignored ones stay ignored.
  private record(scan:Scan,pageUrl:string,result:PageAudit,now:string){
    const select=this.db.prepare('SELECT * FROM platform_seo_findings WHERE organization_id=? AND project_id=? AND finding_key=?');
    for(const finding of result.findings){
      const url=SITE_WIDE.has(finding.title)?scan.origin:pageUrl,key=keyOf(url,finding),old=select.get(...this.args(),key) as Finding|undefined;
      if(!old){const id=`seofinding_${randomUUID()}`;
        this.db.prepare("INSERT INTO platform_seo_findings(id,organization_id,project_id,finding_key,url,category,title,priority,detail,recommendation,evidence,state,first_seen_at,last_seen_at,last_scan_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)").run(id,...this.args(),key,url,finding.category,finding.title,finding.priority,finding.detail,finding.recommendation,finding.evidence,now,now,scan.id);
        this.event(id,'detected',scan.id,null,now);continue;}
      const reopened=old.state==='fixed';
      this.db.prepare('UPDATE platform_seo_findings SET priority=?,detail=?,recommendation=?,evidence=?,last_seen_at=?,last_scan_id=?,state=?,fixed_at=?,revision=revision+1 WHERE id=?').run(finding.priority,finding.detail,finding.recommendation,finding.evidence,now,scan.id,reopened?'open':old.state,reopened?null:old.fixed_at,old.id);
      if(reopened)this.event(old.id,'reopened',scan.id,null,now);
    }
  }
  // A finding counts as fixed only when its page was audited successfully in a completed scan and it no longer appears.
  private finalize(scanId:string){
    const scan=this.db.prepare('SELECT * FROM platform_seo_scans WHERE id=?').get(scanId) as Scan;if(scan.state!=='running')return;
    const now=new Date().toISOString(),done=new Set((this.db.prepare("SELECT url FROM platform_seo_scan_pages WHERE scan_id=? AND state='done'").all(scanId) as {url:string}[]).map(row=>row.url));
    if(done.size)done.add(scan.origin);
    for(const finding of this.db.prepare("SELECT * FROM platform_seo_findings WHERE organization_id=? AND project_id=? AND state='open' AND last_scan_id<>?").all(...this.args(),scanId) as Finding[]){
      if(!done.has(finding.url))continue;
      this.db.prepare("UPDATE platform_seo_findings SET state='fixed',fixed_at=?,revision=revision+1 WHERE id=?").run(now,finding.id);this.event(finding.id,'fixed',scanId,null,now);
    }
    this.db.prepare("UPDATE platform_seo_scans SET state='completed',finished_at=?,updated_at=? WHERE id=?").run(now,now,scanId);
    // Same receipts as the single-page audit, so the coach and the Compass see that the site was audited.
    if(done.size){const website=this.project()?.website||scan.origin,receipt=compassSiteReceipt(website),insert=this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)');
      insert.run(scan.started_by,...this.args(),receipt,now);
      if(!(this.db.prepare("SELECT COUNT(*) n FROM platform_seo_findings WHERE organization_id=? AND project_id=? AND state='open'").get(...this.args()) as {n:number}).n)insert.run(scan.started_by,...this.args(),receipt+':clean',now);}
    this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(scan.started_by,...this.args(),'seo.scan.complete',now);
  }
  private cancelScan(scanId:string){const now=new Date().toISOString();this.db.prepare("UPDATE platform_seo_scan_pages SET state='skipped',lease_token=NULL,lease_until=NULL WHERE scan_id=? AND state IN ('pending','running')").run(scanId);this.db.prepare("UPDATE platform_seo_scans SET state='cancelled',finished_at=?,updated_at=? WHERE id=? AND state='running'").run(now,now,scanId);}
  // Cancelling keeps what was found so far; nothing is marked fixed from an incomplete scan.
  cancel(){this.authorize('content.write');this.db.transaction(()=>{const scan=this.running();if(scan){this.cancelScan(scan.id);this.audit_('seo.scan.cancel');}}).immediate();return this.read();}
  private finding(id:unknown){const row=typeof id==='string'?this.db.prepare('SELECT * FROM platform_seo_findings WHERE id=? AND organization_id=? AND project_id=?').get(id,...this.args()) as Finding|undefined:undefined;if(!row)throw new MarketingStoreError('Bulgu bulunamadı.',404);return row;}
  decide(raw:Record<string,unknown>){
    this.authorize('content.write');if(raw.decision!=='ignore'&&raw.decision!=='restore')throw new MarketingStoreError('Geçersiz bulgu kararı.');
    return this.db.transaction(()=>{
      this.authorize('content.write');const row=this.finding(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Bulgu başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      if(raw.decision==='ignore'&&row.state!=='open'||raw.decision==='restore'&&row.state!=='ignored')throw new MarketingStoreError('Bu bulgu için bu karar verilemez.',409);
      this.db.prepare('UPDATE platform_seo_findings SET state=?,revision=revision+1 WHERE id=?').run(raw.decision==='ignore'?'ignored':'open',row.id);
      this.event(row.id,raw.decision==='ignore'?'ignored':'restored',null,this.scope.subject);this.audit_(`seo.finding.${raw.decision}`);return this.read();
    }).immediate();
  }
  // One work item per finding: while its task is open, planning again returns the same task. The site is not changed.
  plan(raw:Record<string,unknown>){
    this.authorize('content.write');
    return this.db.transaction(()=>{
      this.authorize('content.write');const row=this.finding(raw.id);if(row.state!=='open')throw new MarketingStoreError('Yalnız açık bulgular iş planına eklenebilir.',409);
      const operations=new ProjectOperations(this.db,this.scope),current=row.task_id?operations.tasks().find(task=>task.id===row.task_id&&!['completed','cancelled'].includes(task.status)):undefined;
      if(current)return {created:false,task:current,snapshot:this.read()};
      const lang=this.project()!.language==='en'?'en':'tr',[ranked]=rankAuditFindings([{id:row.id,priority:row.priority,category:row.category,title:row.title,detail:row.detail,recommendation:row.recommendation,evidence:row.evidence}]);
      const task=operations.saveTask({title:translateMessage(row.title,lang).slice(0,160),dueAt:new Date(Date.now()+86400000).toISOString(),status:'planned',note:[`seo-finding:${row.id}`,developerTask(ranked,row.url,lang,text=>translateMessage(text,lang))].join('\n').slice(0,2000)});
      this.db.prepare('UPDATE platform_seo_findings SET task_id=?,revision=revision+1 WHERE id=?').run(task.id,row.id);this.event(row.id,'planned',null,this.scope.subject);this.audit_('seo.finding.plan');
      return {created:true,task,snapshot:this.read()};
    }).immediate();
  }
  read():SeoOperationsSnapshot{
    this.authorize();const scan=this.running()||this.latest(),origin=this.origin();
    let view:SeoScanView|null=null;
    if(scan){const counts=Object.fromEntries((this.db.prepare('SELECT state,COUNT(*) n FROM platform_seo_scan_pages WHERE scan_id=? GROUP BY state').all(scan.id) as {state:string;n:number}[]).map(row=>[row.state,row.n]));
      view={id:scan.id,origin:scan.origin,source:scan.source,discovered:scan.discovered,state:scan.state,startedVia:scan.started_via||'manual',startedAt:scan.started_at,finishedAt:scan.finished_at,pages:{total:Object.values(counts).reduce((sum,value)=>sum+value,0),done:counts.done||0,failed:counts.failed||0,pending:(counts.pending||0)+(counts.running||0),skipped:counts.skipped||0}};}
    const rows=this.db.prepare("SELECT * FROM platform_seo_findings WHERE organization_id=? AND project_id=? ORDER BY CASE state WHEN 'open' THEN 0 WHEN 'fixed' THEN 1 ELSE 2 END,last_seen_at DESC,id LIMIT 400").all(...this.args()) as Finding[];
    const tasks=new Map(new ProjectOperations(this.db,this.scope).tasks().map(task=>[task.id,task.status]));
    const events=this.db.prepare('SELECT kind,at,scan_id FROM platform_seo_finding_events WHERE finding_id=? ORDER BY id DESC LIMIT 6');
    const ranked=new Map(rankAuditFindings(rows.map(row=>({id:row.id,priority:row.priority,category:row.category,title:row.title,detail:row.detail,recommendation:row.recommendation,evidence:row.evidence}))).map(item=>[item.id,item]));
    const order={high:0,medium:1,low:2};
    const findings=rows.map((row):SeoFindingView=>{const rank=ranked.get(row.id)!,status=row.task_id?tasks.get(row.task_id):undefined;
      return {id:row.id,url:row.url,siteWide:SITE_WIDE.has(row.title),category:row.category,title:row.title,priority:row.priority,impact:rank.impact,detail:row.detail,evidence:row.evidence,recommendation:row.recommendation,why:rank.why,how:rank.how,
        state:row.state,firstSeenAt:row.first_seen_at,lastSeenAt:row.last_seen_at,fixedAt:row.fixed_at,revision:row.revision,task:row.task_id&&status?{id:row.task_id,status}:null,
        events:(events.all(row.id) as {kind:SeoFindingEvent['kind'];at:string;scan_id:string|null}[]).map(item=>({kind:item.kind,at:item.at,scanId:item.scan_id}))};})
      .sort((a,b)=>Number(a.state!=='open')-Number(b.state!=='open')||order[a.impact]-order[b.impact]||a.url.localeCompare(b.url));
    const counts={open:0,fixed:0,ignored:0} as Record<SeoFindingState,number>;for(const row of rows)counts[row.state]++;
    return {origin,scan:view,counts,findings,maxPages:SEO_SCAN_MAX_PAGES,canWrite:this.can('content.write'),schedule:this.scheduleView()};
  }
  private scheduleRow(){return this.db.prepare('SELECT * FROM platform_seo_schedules WHERE organization_id=? AND project_id=?').get(...this.args()) as {cadence:'weekly'|'monthly';owner_id:string;next_at:string;last_started_at:string|null;last_error:string|null;search_checked_at:string|null}|undefined;}
  private scheduleView():SeoScheduleView{const row=this.scheduleRow();return row?{cadence:row.cadence,nextAt:row.next_at,lastStartedAt:row.last_started_at,lastError:row.last_error,ownedByYou:row.owner_id===this.scope.subject}:{cadence:null,nextAt:null,lastStartedAt:null,lastError:null,ownedByYou:false};}
  // Weekly or monthly scans of the same site, run as the member who sets them (their rights and the plan quota apply).
  // The first one follows the last scan by the chosen interval, or starts on the next worker tick when none is recent.
  schedule(raw:Record<string,unknown>){
    this.authorize('content.write');
    if(Object.keys(raw).some(key=>!['action','cadence'].includes(key))||!['weekly','monthly','off'].includes(raw.cadence as string))throw new MarketingStoreError('Geçersiz tarama sıklığı.');
    if(raw.cadence!=='off'&&!this.origin())throw new MarketingStoreError('Önce proje ayarlarında web sitesi adresini girin.',409);
    this.db.transaction(()=>{
      this.authorize('content.write');const now=new Date().toISOString();
      if(raw.cadence==='off'){this.db.prepare('DELETE FROM platform_seo_schedules WHERE organization_id=? AND project_id=?').run(...this.args());this.audit_('seo.schedule.off');return;}
      const cadence=raw.cadence as 'weekly'|'monthly',last=this.db.prepare("SELECT MAX(started_at) at FROM platform_seo_scans WHERE organization_id=? AND project_id=? AND state<>'cancelled'").get(...this.args()) as {at:string|null};
      const due=last.at?Date.parse(last.at)+SEO_SCHEDULE_DAYS[cadence]*86400000:Date.now(),nextAt=new Date(Math.max(due,Date.now())).toISOString();
      this.db.prepare('INSERT INTO platform_seo_schedules(organization_id,project_id,cadence,owner_id,next_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET cadence=excluded.cadence,owner_id=excluded.owner_id,next_at=excluded.next_at,last_error=NULL,updated_at=excluded.updated_at').run(...this.args(),cadence,this.scope.subject,nextAt,now,now);
      this.audit_(`seo.schedule.${cadence}`);
    }).immediate();
    return this.read();
  }
  // A starting llms.txt from what the project already knows: its name, the approved positioning and the pages the last
  // scan read. Nothing is invented and nothing is published; the team edits it and puts it on its own site.
  llmsDraft(){
    this.authorize();const project=this.project()!,origin=this.origin();if(!origin)throw new MarketingStoreError('Önce proje ayarlarında web sitesi adresini girin.',409);
    const brief=coachState(this.db,...this.args()).brief,tr=(brief?.language||project.language)!=='en';
    const scan=this.db.prepare("SELECT id FROM platform_seo_scans WHERE organization_id=? AND project_id=? AND state='completed' ORDER BY finished_at DESC LIMIT 1").get(...this.args()) as {id:string}|undefined;
    const pages=scan?(this.db.prepare("SELECT url FROM platform_seo_scan_pages WHERE scan_id=? AND state='done' ORDER BY position LIMIT 20").all(scan.id) as {url:string}[]).map(row=>row.url):[origin+'/'];
    const label=(url:string)=>{const path=new URL(url).pathname.replace(/\/$/,'');return path?decodeURIComponent(path.split('/').pop()!).replace(/[-_]+/g,' '):(tr?'Ana sayfa':'Home page');};
    // Only the approved positioning describes the business; the brand voice describes tone, so it is not used here.
    const summary=(brief?.positioning||'').replace(/\s+/g,' ').trim().slice(0,400);
    const lines=[`# ${project.name}`,'',`> ${summary||(tr?'Bu satıra işletmenizi bir cümleyle anlatın.':'Describe your business in one sentence on this line.')}`,''];
    if(brief?.icp.summary)lines.push(tr?`Kimler için: ${brief.icp.summary}`:`Who it is for: ${brief.icp.summary}`,'');
    lines.push(tr?'## Önemli sayfalar':'## Key pages',...pages.map(url=>`- [${label(url)}](${url})`),'',tr?'## İletişim':'## Contact',`- ${tr?'Web sitesi':'Website'}: ${origin}`);
    return {text:lines.join('\n'),pages:pages.length,fromScan:Boolean(scan),hasSummary:Boolean(summary)};
  }
  // Totals are shown only to members who manage connections, like the Search Console query rows.
  watchView():SeoSearchWatchView{
    const empty={currentFrom:null,currentTo:null,clicks:null,impressions:null,previousClicks:null,previousImpressions:null,checkedAt:null,drop:false};
    const connection=this.db.prepare("SELECT id FROM platform_connections WHERE organization_id=? AND project_id=? AND provider='search_console' AND active=1 ORDER BY updated_at DESC,id LIMIT 1").get(...this.args()) as {id:string}|undefined;
    if(!connection)return {state:'not_connected',...empty};
    if(!this.can('connections.manage'))return {state:'restricted',...empty};
    if(!this.scheduleRow())return {state:'not_scheduled',...empty};
    const row=this.db.prepare('SELECT * FROM platform_seo_search_watch WHERE organization_id=? AND project_id=? AND connection_id=?').get(...this.args(),connection.id) as {status:'ready'|'no_data'|'unavailable';current_from:string;current_to:string;clicks:number|null;impressions:number|null;previous_clicks:number|null;previous_impressions:number|null;checked_at:string}|undefined;
    if(!row)return {state:'not_checked',...empty};
    return {state:row.status,currentFrom:row.current_from,currentTo:row.current_to,clicks:row.clicks,impressions:row.impressions,previousClicks:row.previous_clicks,previousImpressions:row.previous_impressions,checkedAt:row.checked_at,drop:searchDropped(row.clicks,row.previous_clicks)};
  }
  // Fixed editorial rules over the stored Search Console snapshot; only members who manage connections see query rows.
  opportunities():SeoOpportunitiesSnapshot{
    this.authorize();
    const connection=this.db.prepare("SELECT id FROM platform_connections WHERE organization_id=? AND project_id=? AND provider='search_console' AND active=1 ORDER BY updated_at DESC,id LIMIT 1").get(...this.args()) as {id:string}|undefined;
    if(!connection)return {state:'not_connected',from:null,to:null,checkedAt:null,queries:0,items:[],canRefresh:false,watch:this.watchView()};
    if(!this.can('connections.manage'))return {state:'restricted',from:null,to:null,checkedAt:null,queries:0,items:[],canRefresh:false,watch:this.watchView()};
    const row=this.db.prepare('SELECT connection_id,status,date_from,date_to,rows_json,checked_at FROM platform_coach_seo_queries WHERE organization_id=? AND project_id=?').get(...this.args()) as {connection_id:string;status:'ready'|'no_data'|'unavailable';date_from:string;date_to:string;rows_json:string;checked_at:string}|undefined;
    const current=row&&row.connection_id===connection.id?row:undefined;
    if(!current)return {state:'not_fetched',from:null,to:null,checkedAt:null,queries:0,items:[],canRefresh:true,watch:this.watchView()};
    const queries=current.status==='ready'?JSON.parse(current.rows_json) as SearchConsoleQuery[]:[];
    const items:SeoOpportunity[]=[];
    for(const query of queries){
      if(!(query.impressions>0))continue;const ctr=query.clicks/query.impressions;
      if(query.position>=8&&query.position<=20&&query.impressions>=20)items.push({...query,ctr,kind:'near_first_page'});
      else if(query.position<=5&&query.impressions>=50&&ctr<0.02)items.push({...query,ctr,kind:'low_ctr'});
    }
    items.sort((a,b)=>b.impressions-a.impressions||a.query.localeCompare(b.query));
    return {state:current.status,from:current.date_from,to:current.date_to,checkedAt:current.checked_at,queries:queries.length,items:items.slice(0,25),canRefresh:true,watch:this.watchView()};
  }
}
// Worker step: continues scans whose tab was closed. One page per scan per tick; the starter's rights are re-checked.
export async function advanceSeoScans(db:Database.Database,dependencies:SeoDependencies={},limit=2){
  const stale=new Date(Date.now()-STALE_MS).toISOString(),rows=db.prepare("SELECT id,organization_id,project_id,started_by FROM platform_seo_scans WHERE state='running' AND updated_at<? ORDER BY updated_at LIMIT ?").all(stale,limit) as {id:string;organization_id:string;project_id:string;started_by:string}[];
  let advanced=0;
  for(const row of rows){
    const operations=new SeoOperations(db,{subject:row.started_by,organizationId:row.organization_id,projectId:row.project_id},dependencies);
    try{await operations.step();advanced++;}catch{db.prepare("UPDATE platform_seo_scan_pages SET state='skipped',lease_token=NULL,lease_until=NULL WHERE scan_id=? AND state IN ('pending','running')").run(row.id);db.prepare("UPDATE platform_seo_scans SET state='cancelled',finished_at=?,updated_at=? WHERE id=? AND state='running'").run(new Date().toISOString(),new Date().toISOString(),row.id);}
  }
  return advanced;
}
type ScheduleRow={organization_id:string;project_id:string;cadence:'weekly'|'monthly';owner_id:string;next_at:string;search_checked_at:string|null};
export type SeoScheduleDependencies=SeoDependencies&{totals?:SearchConsoleTotalsReader;refresh?:typeof refreshGoogleCredentials;now?:number};
// Worker step: starts due scheduled scans (the worker then continues them page by page) and, once a week per
// scheduled project, reads Search Console totals with the stored grant of a member who may use it.
export async function runSeoSchedules(db:Database.Database,key:string,dependencies:SeoScheduleDependencies={},limit=2){
  const now=dependencies.now??Date.now(),at=new Date(now).toISOString(),day=86400000;let started=0,checked=0;
  const stop=(row:ScheduleRow,reason:string)=>{db.prepare('DELETE FROM platform_seo_schedules WHERE organization_id=? AND project_id=?').run(row.organization_id,row.project_id);db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(row.owner_id,row.organization_id,row.project_id,`seo.schedule.stopped:${reason}`,at);};
  for(const row of db.prepare('SELECT * FROM platform_seo_schedules WHERE next_at<=? ORDER BY next_at LIMIT ?').all(at,limit) as ScheduleRow[]){
    const scope={subject:row.owner_id,organizationId:row.organization_id,projectId:row.project_id},repo=new PlatformRepository(db);
    // The member who set the schedule must still be able to scan; otherwise the schedule stops (it is never moved to someone else).
    if(!repo.can(row.owner_id,row.organization_id,row.project_id,'content.write')||repo.workspace(row.owner_id,row.organization_id,row.project_id)?.project.productPack!=='standard'){stop(row,'rights');continue;}
    try{await new SeoOperations(db,scope,dependencies).start('schedule');started++;
      db.prepare('UPDATE platform_seo_schedules SET next_at=?,last_started_at=?,last_error=NULL,updated_at=? WHERE organization_id=? AND project_id=?').run(new Date(now+SEO_SCHEDULE_DAYS[row.cadence]*day).toISOString(),at,at,row.organization_id,row.project_id);}
    catch(error){
      // Quota used up, site unreachable or similar: try again tomorrow and show why on the SEO screen.
      const message=error instanceof MarketingStoreError?error.message:'Planlı tarama başlatılamadı.';
      db.prepare('UPDATE platform_seo_schedules SET next_at=?,last_error=?,updated_at=? WHERE organization_id=? AND project_id=?').run(new Date(now+day).toISOString(),message.slice(0,300),at,row.organization_id,row.project_id);
    }
  }
  for(const row of db.prepare('SELECT * FROM platform_seo_schedules WHERE search_checked_at IS NULL OR search_checked_at<=? ORDER BY search_checked_at IS NOT NULL,search_checked_at LIMIT ?').all(new Date(now-7*day).toISOString(),limit) as ScheduleRow[]){
    db.prepare('UPDATE platform_seo_schedules SET search_checked_at=? WHERE organization_id=? AND project_id=?').run(at,row.organization_id,row.project_id);
    const repo=new PlatformRepository(db);if(!repo.can(row.owner_id,row.organization_id,row.project_id,'connections.manage'))continue;
    const connection=db.prepare("SELECT id,integration_id,encrypted_credentials FROM platform_connections WHERE organization_id=? AND project_id=? AND provider='search_console' AND active=1 ORDER BY updated_at DESC,id LIMIT 1").get(row.organization_id,row.project_id) as {id:string;integration_id:string;encrypted_credentials:string}|undefined;
    if(!connection)continue;
    // Search Console data settles after about three days; both weeks end before that.
    const end=now-3*day,iso=(value:number)=>new Date(value).toISOString().slice(0,10),current={from:iso(end-6*day),to:iso(end)},previous={from:iso(end-13*day),to:iso(end-7*day)};
    let status:'ready'|'no_data'|'unavailable'='unavailable',now_:Awaited<ReturnType<SearchConsoleTotalsReader>>=null,before:Awaited<ReturnType<SearchConsoleTotalsReader>>=null;
    try{
      const credentials=decryptCredentials<StoredCredentials>(connection.encrypted_credentials,key,row.organization_id,row.project_id,connection.id),fresh=await (dependencies.refresh||refreshGoogleCredentials)(credentials);
      if(fresh!==credentials)db.prepare('UPDATE platform_connections SET encrypted_credentials=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND active=1 AND encrypted_credentials=?').run(encryptCredentials(fresh,key,row.organization_id,row.project_id,connection.id),at,connection.id,row.organization_id,row.project_id,connection.encrypted_credentials);
      const read=dependencies.totals||readSearchConsoleTotals;
      now_=await read({resource:connection.integration_id,token:fresh.accessToken,...current});before=await read({resource:connection.integration_id,token:fresh.accessToken,...previous});
      status=now_||before?'ready':'no_data';
    }catch{status='unavailable';now_=null;before=null;}
    db.prepare('INSERT INTO platform_seo_search_watch(organization_id,project_id,connection_id,status,current_from,current_to,clicks,impressions,previous_clicks,previous_impressions,checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET connection_id=excluded.connection_id,status=excluded.status,current_from=excluded.current_from,current_to=excluded.current_to,clicks=excluded.clicks,impressions=excluded.impressions,previous_clicks=excluded.previous_clicks,previous_impressions=excluded.previous_impressions,checked_at=excluded.checked_at')
      .run(row.organization_id,row.project_id,connection.id,status,current.from,current.to,status==='ready'?Math.round(now_?.clicks||0):null,status==='ready'?Math.round(now_?.impressions||0):null,status==='ready'?Math.round(before?.clicks||0):null,status==='ready'?Math.round(before?.impressions||0):null,at);
    checked++;
  }
  return {started,checked};
}

