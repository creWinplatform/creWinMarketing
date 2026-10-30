const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {SeoOperations,advanceSeoScans,runSeoSchedules}=load('seo-operations.ts');
const {teamAlerts}=load('team-alerts.ts');
const {encryptCredentials}=load('credential-envelope.ts');
const {openPlatformDatabase}=load('database.ts');
// Scheduled site scans and the weekly Search Console totals. The site, the provider and the clock are stubs.
const KEY='56'.repeat(32),DAY=86400000,iso=value=>new Date(value).toISOString();
const finding=(title,priority='medium')=>({id:'x',priority,category:'İçerik',title,detail:'d',recommendation:'r',evidence:'e'});
const site=()=>{const state={pages:{}};return {state,deps:{discover:async origin=>({baseUrl:origin,urls:['https://example.com/','https://example.com/menu'],source:'sitemap',discoveredCount:2}),audit:async url=>({ok:true,httpStatus:200,findings:state.pages[url]||[]})}};};
const seo=(f,deps,scope=f.scope)=>new SeoOperations(f.db,scope,deps);
const finish=async(f,deps,scope=f.scope)=>{let snapshot=seo(f,deps,scope).read();for(let i=0;i<10&&snapshot.scan?.state==='running';i++)snapshot=await seo(f,deps,scope).step();return snapshot;};
const schedule=f=>f.db.prepare('SELECT * FROM platform_seo_schedules WHERE organization_id=? AND project_id=?').get(f.scope.organizationId,f.scope.projectId);
const kinds=(f,scope=f.scope,now)=>plain(teamAlerts(f.db,scope,now).map(item=>item.kind));

test('a weekly or monthly schedule is set by a writer; the first scan follows the last one by the interval',coachRun(async f=>{
  const {deps}=site();
  assert.throws(()=>seo(f,deps).schedule({action:'schedule',cadence:'daily'}),error=>error.status===400);
  assert.throws(()=>seo(f,deps,f.member('viewer')).schedule({action:'schedule',cadence:'weekly'}),error=>error.status===403);
  let snapshot=seo(f,deps).schedule({action:'schedule',cadence:'weekly'});
  assert.equal(snapshot.schedule.cadence,'weekly');assert.equal(snapshot.schedule.ownedByYou,true);
  assert.ok(Math.abs(Date.parse(snapshot.schedule.nextAt)-Date.now())<5000,'no earlier scan: the first one starts on the next worker tick');
  await seo(f,deps).start();await finish(f,deps);
  snapshot=seo(f,deps).schedule({action:'schedule',cadence:'monthly'});
  assert.ok(Math.abs(Date.parse(snapshot.schedule.nextAt)-(Date.now()+30*DAY))<60000,'a recent scan pushes the first scheduled one by the interval');
  assert.equal(seo(f,deps,f.member('editor')).read().schedule.ownedByYou,false);
  assert.equal(seo(f,deps).schedule({action:'schedule',cadence:'off'}).schedule.cadence,null);assert.equal(schedule(f),undefined);
}));

test('the worker starts due scans as the member who set them; only scheduled findings become alerts',coachRun(async f=>{
  const {state,deps}=site();state.pages={'https://example.com/':[finding('Meta açıklaması eksik')]};
  await seo(f,deps).start();await finish(f,deps);
  assert.deepEqual(kinds(f),[],'a scan someone started by hand raises no alert');
  seo(f,deps).schedule({action:'schedule',cadence:'weekly'});
  const now=Date.now()+8*DAY;state.pages['https://example.com/menu']=[finding('H1 başlığı eksik','high')];
  assert.deepEqual(plain(await runSeoSchedules(f.db,KEY,{...deps,now})),{started:1,checked:0});
  const scan=f.db.prepare("SELECT * FROM platform_seo_scans WHERE started_via='schedule'").get();assert.equal(scan.started_by,f.scope.subject);
  assert.ok(Math.abs(Date.parse(schedule(f).next_at)-(now+7*DAY))<1000,'the next one is a week later');
  assert.deepEqual(plain(await runSeoSchedules(f.db,KEY,{...deps,now:now+1000})),{started:0,checked:0},'not due again');
  f.db.prepare("UPDATE platform_seo_scans SET updated_at=? WHERE id=?").run(iso(Date.now()-10*60000),scan.id);
  for(let i=0;i<3;i++){await advanceSeoScans(f.db,deps);f.db.prepare("UPDATE platform_seo_scans SET updated_at=? WHERE id=?").run(iso(Date.now()-10*60000),scan.id);}
  assert.equal(f.db.prepare('SELECT state FROM platform_seo_scans WHERE id=?').get(scan.id).state,'completed');
  const [alert]=teamAlerts(f.db,f.scope);assert.equal(alert.kind,'seo_findings');assert.equal(alert.count,1,'only the new finding, not the one already known');assert.equal(alert.href,'/?tab=seo');
  assert.deepEqual(kinds(f,f.member('viewer')),[],'viewers cannot act on findings');
  assert.deepEqual(kinds(f,f.other),[]);
}));

test('a schedule stops when its owner loses the right to scan, and waits a day when the quota is used up',coachRun(async f=>{
  const {deps}=site();const editor=f.member('editor');
  seo(f,deps,editor).schedule({action:'schedule',cadence:'weekly'});
  f.db.prepare("UPDATE platform_memberships SET role='viewer' WHERE user_id=?").run(editor.subject);
  await runSeoSchedules(f.db,KEY,{...deps,now:Date.now()+1000});
  assert.equal(schedule(f),undefined,'the schedule is never handed to someone else');
  assert.ok(f.db.prepare("SELECT 1 FROM platform_audit WHERE operation='seo.schedule.stopped:rights'").get());
  seo(f,deps).schedule({action:'schedule',cadence:'weekly'});
  const period=f.db.prepare("SELECT period FROM platform_usage WHERE resource='audits' LIMIT 1").get();
  f.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'audits',100000) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=100000").run(f.scope.organizationId,f.scope.projectId,period?.period||new Date().toISOString().slice(0,7));
  const now=Date.now()+1000;await runSeoSchedules(f.db,KEY,{...deps,now});
  const row=schedule(f);assert.ok(row.last_error,'the reason is shown on the SEO screen');assert.ok(Math.abs(Date.parse(row.next_at)-(now+DAY))<1000);
  assert.equal(seo(f,deps).read().schedule.lastError,row.last_error);
}));

test('the weekly Search Console check compares two complete weeks; a drop alerts connection managers only',coachRun(async f=>{
  const {deps}=site(),id='gsc-1';
  f.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,'search_console','sc-domain:example.com','QA GSC',?,1,?)").run(id,f.scope.organizationId,f.scope.projectId,encryptCredentials({accessToken:'gsc-token',refreshToken:'r',googleOAuth:true,expiresAt:Date.now()+3600000},KEY,f.scope.organizationId,f.scope.projectId,id),iso(Date.now()));
  assert.equal(seo(f,deps).opportunities().watch.state,'not_scheduled');
  seo(f,deps).schedule({action:'schedule',cadence:'monthly'});
  const asked=[];let answers=[{clicks:12,impressions:900},{clicks:40,impressions:1100}];
  const totals=async input=>{asked.push(input);assert.equal(input.token,'gsc-token');return answers.shift();};
  const now=Date.now();await runSeoSchedules(f.db,KEY,{...deps,totals,refresh:async c=>c,now});
  assert.equal(asked.length,2);assert.equal(asked[0].resource,'sc-domain:example.com');
  assert.equal(asked[0].to,iso(now-3*DAY).slice(0,10),'the last three days are left out until Search Console settles');
  assert.equal(asked[1].to,iso(now-10*DAY).slice(0,10));
  const watch=seo(f,deps).opportunities().watch;assert.equal(watch.state,'ready');assert.equal(watch.clicks,12);assert.equal(watch.previousClicks,40);assert.equal(watch.drop,true);
  const alert=teamAlerts(f.db,f.scope,now).find(item=>item.kind==='search_drop');assert.deepEqual(plain(alert.clicks),{current:12,previous:40});
  const editor=f.member('editor');assert.ok(!kinds(f,editor,now).includes('search_drop'),'editors do not see Search Console figures');
  assert.equal(seo(f,deps,editor).opportunities().watch.state,'restricted');
  await runSeoSchedules(f.db,KEY,{...deps,totals,refresh:async c=>c,now:now+DAY});assert.equal(asked.length,2,'checked once a week');
  answers=[{clicks:35,impressions:1000},{clicks:40,impressions:1000}];
  await runSeoSchedules(f.db,KEY,{...deps,totals,refresh:async c=>c,now:now+8*DAY});
  assert.equal(seo(f,deps).opportunities().watch.drop,false,'a small change is not a drop');
  answers=[{clicks:2,impressions:10},{clicks:10,impressions:30}];
  await runSeoSchedules(f.db,KEY,{...deps,totals,refresh:async c=>c,now:now+16*DAY});
  assert.equal(seo(f,deps).opportunities().watch.drop,false,'too few clicks before to call it a drop');
  await runSeoSchedules(f.db,KEY,{...deps,totals:async()=>{throw new Error('403');},refresh:async c=>c,now:now+24*DAY});
  assert.equal(seo(f,deps).opportunities().watch.state,'unavailable','a failure is "unavailable", never zero');
}));

test('migration 63 is additive and repeatable',async()=>{
  const file=require('node:path').join(require('node:os').tmpdir(),`ryzevo-m63-${process.pid}.db`);
  for(const suffix of ['','-wal','-shm'])try{require('node:fs').unlinkSync(file+suffix);}catch{}
  let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeSeoScheduleSchema(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('platform_seo_schedules','platform_seo_search_watch')").get().n,0);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,67);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pragma_table_info('platform_seo_scans') WHERE name='started_via'").get().n,1);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_migrations WHERE version=63').get().n,1);db.close();
  for(const suffix of ['','-wal','-shm'])try{require('node:fs').unlinkSync(file+suffix);}catch{}
});
