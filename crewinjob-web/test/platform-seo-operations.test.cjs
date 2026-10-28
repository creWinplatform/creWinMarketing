const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {SeoOperations,advanceSeoScans}=load('seo-operations.ts');
const {ProjectOperations}=load('operations.ts');
const {compassSiteReceipt}=load('guidance.ts');
const finding=(title,category='İçerik',priority='medium')=>({id:'x',priority,category,title,detail:'d',recommendation:'r',evidence:'e'});
const ROBOTS=finding('robots.txt doğrulanamadı','Tarama','low');
// Disposable site: what each page reports in the current "scan"; a thrown value means the page could not be audited.
const site=()=>{const state={pages:{},urls:['https://example.com/','https://example.com/pricing','https://other.example/x','https://example.com/blog#top']};
  return {state,deps:{discover:async(origin,limit)=>({baseUrl:origin,urls:state.urls.slice(0,limit),source:'sitemap',discoveredCount:state.urls.length}),
    audit:async url=>{const value=state.pages[url];if(value instanceof Error)throw value;return {ok:true,httpStatus:200,findings:value||[]};}}};};
const seo=(f,deps,scope=f.scope)=>new SeoOperations(f.db,scope,deps);
const run=async(f,deps,scope)=>{let snapshot=await seo(f,deps,scope).start();for(let i=0;i<10&&snapshot.scan.state==='running';i++)snapshot=await seo(f,deps,scope).step();return snapshot;};
const audits=f=>f.db.prepare("SELECT COALESCE(SUM(count),0) n FROM platform_usage WHERE organization_id=? AND project_id=? AND resource='audits'").get(f.scope.organizationId,f.scope.projectId).n;

test('a scan audits only the project site, page by page, and keeps findings once per page or per site',coachRun(async f=>{
  const {state,deps}=site();state.pages={'https://example.com/':[finding('Meta açıklaması eksik'),ROBOTS],'https://example.com/pricing':[finding('H1 başlığı eksik','İçerik','high'),ROBOTS],'https://example.com/blog':[ROBOTS]};
  let snapshot=await seo(f,deps).start();
  assert.equal(snapshot.scan.state,'running');assert.equal(snapshot.scan.pages.total,3,'other origins are dropped and #fragments are removed');assert.equal(audits(f),1,'one audit unit per scan');
  assert.equal((await seo(f,deps).start()).scan.id,snapshot.scan.id,'a second start returns the running scan');assert.equal(audits(f),1);
  for(let i=0;i<3;i++)snapshot=await seo(f,deps).step();
  assert.equal(snapshot.scan.state,'completed');assert.equal(snapshot.scan.pages.done,3);
  assert.equal(snapshot.counts.open,3,'robots.txt is one site-wide finding, not one per page');
  const robots=snapshot.findings.find(item=>item.siteWide);assert.equal(robots.url,'https://example.com');assert.deepEqual(plain(robots.events.map(item=>item.kind)),['detected']);
  assert.equal(snapshot.findings[0].impact,'high','open findings are ordered by impact');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_audit WHERE operation=?').get(compassSiteReceipt('https://example.com')).n,1,'the coach and Compass see the audit');
  assert.equal(seo(f,deps,f.other).read().findings.length,0,'other projects see nothing');
}));
test('fixed, reopened and ignored findings follow the evidence; failed pages never mark anything fixed',coachRun(async f=>{
  const {state,deps}=site();state.urls=['https://example.com/','https://example.com/pricing'];
  state.pages={'https://example.com/':[finding('Meta açıklaması eksik'),finding('Alt metni olmayan görseller var','Erişilebilirlik','low')],'https://example.com/pricing':[finding('H1 başlığı eksik')]};
  let snapshot=await run(f,deps);const ids=Object.fromEntries(snapshot.findings.map(item=>[item.title,item]));
  seo(f,deps).decide({id:ids['Alt metni olmayan görseller var'].id,decision:'ignore',expectedRevision:ids['Alt metni olmayan görseller var'].revision});
  // Second scan: the meta description is fixed; the pricing page cannot be fetched, so its finding stays open.
  state.pages={'https://example.com/':[finding('Alt metni olmayan görseller var','Erişilebilirlik','low')],'https://example.com/pricing':new Error('timeout')};
  snapshot=await run(f,deps);const second=Object.fromEntries(snapshot.findings.map(item=>[item.title,item]));
  assert.equal(second['Meta açıklaması eksik'].state,'fixed');assert.ok(second['Meta açıklaması eksik'].fixedAt);assert.equal(second['Meta açıklaması eksik'].events[0].kind,'fixed');
  assert.equal(second['H1 başlığı eksik'].state,'open','a page that failed to load is not evidence of a fix');assert.equal(snapshot.scan.pages.failed,1);
  assert.equal(second['Alt metni olmayan görseller var'].state,'ignored','ignored findings stay ignored when seen again');
  // Third scan: the meta description comes back.
  state.pages={'https://example.com/':[finding('Meta açıklaması eksik')],'https://example.com/pricing':[finding('H1 başlığı eksik')]};
  snapshot=await run(f,deps);const third=Object.fromEntries(snapshot.findings.map(item=>[item.title,item]));
  assert.equal(third['Meta açıklaması eksik'].state,'open');assert.deepEqual(plain(third['Meta açıklaması eksik'].events.map(item=>item.kind)),['reopened','fixed','detected']);
  const restored=seo(f,deps).decide({id:third['Alt metni olmayan görseller var'].id,decision:'restore',expectedRevision:third['Alt metni olmayan görseller var'].revision});
  assert.equal(restored.findings.find(item=>item.title==='Alt metni olmayan görseller var').state,'open');
  assert.throws(()=>seo(f,deps).decide({id:third['H1 başlığı eksik'].id,decision:'ignore',expectedRevision:0}),error=>error.status===409,'stale revision');
}));
test('a finding gets one work item while its task is open; cancelling keeps findings without fixing anything',coachRun(async f=>{
  const {state,deps}=site();state.urls=['https://example.com/','https://example.com/pricing'];state.pages={'https://example.com/':[finding('Meta açıklaması eksik')],'https://example.com/pricing':[finding('H1 başlığı eksik')]};
  let snapshot=await run(f,deps);const meta=snapshot.findings.find(item=>item.title==='Meta açıklaması eksik');
  const first=seo(f,deps).plan({id:meta.id}),again=seo(f,deps).plan({id:meta.id});
  assert.equal(first.created,true);assert.equal(again.created,false);assert.equal(again.task.id,first.task.id);assert.match(first.task.note,/^seo-finding:/);
  assert.equal(new ProjectOperations(f.db,f.scope).tasks().filter(task=>task.note.includes(meta.id)).length,1,'no duplicate work items');
  new ProjectOperations(f.db,f.scope).saveTask({...first.task,status:'completed'});assert.equal(seo(f,deps).plan({id:meta.id}).created,true,'a new task after the previous one is completed');
  state.pages={'https://example.com/':[],'https://example.com/pricing':[]};snapshot=await seo(f,deps).start();snapshot=await seo(f,deps).step();snapshot=seo(f,deps).cancel();
  assert.equal(snapshot.scan.state,'cancelled');assert.equal(snapshot.counts.fixed,0,'an incomplete scan fixes nothing');assert.equal(snapshot.counts.open,2);
}));
test('viewers read only; changing the website cancels a running scan; the worker continues abandoned scans',coachRun(async f=>{
  const {state,deps}=site();state.urls=['https://example.com/','https://example.com/a','https://example.com/b'];state.pages={'https://example.com/':[finding('Meta açıklaması eksik')]};
  const viewer=f.member('viewer');
  await assert.rejects(seo(f,deps,viewer).start(),error=>error.status===403);
  let snapshot=await seo(f,deps).start();
  await assert.rejects(seo(f,deps,viewer).step(),error=>error.status===403);assert.equal(seo(f,deps,viewer).read().scan.id,snapshot.scan.id);
  // An abandoned scan (no step for over two minutes) is advanced by the worker, one page per tick.
  f.db.prepare('UPDATE platform_seo_scans SET updated_at=?').run(new Date(Date.now()-300000).toISOString());
  assert.equal(await advanceSeoScans(f.db,deps),1);assert.equal(seo(f,deps).read().scan.pages.done,1);
  // The starter loses content rights: the worker cancels instead of acting without authority.
  const editor=f.member('editor');f.db.prepare("UPDATE platform_seo_scans SET started_by=?,updated_at=?").run(editor.subject,new Date(Date.now()-300000).toISOString());
  f.db.prepare("UPDATE platform_memberships SET role='viewer' WHERE user_id=?").run(editor.subject);
  await advanceSeoScans(f.db,deps);assert.equal(seo(f,deps).read().scan.state,'cancelled');
  snapshot=await seo(f,deps).start();const project=f.repo.workspace(f.scope.subject,f.a.organizationId,f.a.projectId).project;
  f.repo.updateProject(f.scope.subject,f.a.organizationId,f.a.projectId,{name:project.name,website:'https://changed.example',timezone:project.timezone,language:project.language,brandVoice:project.brandVoice||'',goals:project.goals});
  assert.equal((await seo(f,deps).step()).scan.state,'cancelled','a scan never continues on a different site');
}));
test('Search Console opportunities follow fixed rules and are visible only to connection managers',coachRun(async f=>{
  const {deps}=site(),{organizationId,projectId}=f.scope,now=new Date().toISOString();
  assert.equal(seo(f,deps).opportunities().state,'not_connected');
  f.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES('qa-gsc',?,?,'search_console','https://example.com/','QA','{}',1,?)").run(organizationId,projectId,now);
  assert.equal(seo(f,deps).opportunities().state,'not_fetched');
  const rows=[{query:'near',clicks:1,impressions:120,position:11.4},{query:'low ctr',clicks:0,impressions:300,position:3.1},{query:'fine',clicks:40,impressions:200,position:2},{query:'tiny',clicks:0,impressions:5,position:12}];
  f.db.prepare("INSERT INTO platform_coach_seo_queries(organization_id,project_id,connection_id,status,date_from,date_to,rows_json,checked_at) VALUES(?,?,'qa-gsc','ready','2026-09-19','2026-10-16',?,?)").run(organizationId,projectId,JSON.stringify(rows),now);
  const snapshot=seo(f,deps).opportunities();
  assert.equal(snapshot.state,'ready');assert.equal(snapshot.queries,4);assert.deepEqual(plain(snapshot.items.map(item=>[item.query,item.kind])),[['low ctr','low_ctr'],['near','near_first_page']]);
  assert.equal(snapshot.items[1].ctr,1/120,'CTR is computed from the stored clicks and impressions only');
  const editor=f.member('editor');assert.deepEqual(plain(seo(f,deps,editor).opportunities()),{state:'restricted',from:null,to:null,checkedAt:null,queries:0,items:[],canRefresh:false,watch:{state:'restricted',currentFrom:null,currentTo:null,clicks:null,impressions:null,previousClicks:null,previousImpressions:null,checkedAt:null,drop:false}});
}));
test('schema40 is additive and repeatable',coachRun(async f=>{
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'seo-ops-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeSeoOperationsSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,39);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,64);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_seo_findings').get().n,0);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
