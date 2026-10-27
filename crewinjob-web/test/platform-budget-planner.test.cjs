const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {paidScenario,seoScenario,requiredBudget,paidSensitivity,seoSensitivity,validRange}=load('budget-math.ts');
const {BudgetPlanner}=load('budget-planner.ts');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} ≈ ${b}`);

test('paid scenarios use only the given ranges: worst case, middle and best case',()=>{
  const s=paidScenario({budget:10000,cpc:{low:4,high:8},conversion:{low:0.02,high:0.04}});
  assert.equal(s.cost,10000);
  close(s.low.clicks,1250);close(s.low.leads,25);close(s.low.costPerLead,400);
  close(s.expected.clicks,10000/6);close(s.expected.leads,10000/6*0.03);
  close(s.high.clicks,2500);close(s.high.leads,100);close(s.high.costPerLead,100);
  assert.equal(s.expected.customers,null,'no close rate, no customers');assert.equal(s.expected.roas,null,'no customer value, no ROAS');
  const full=paidScenario({budget:10000,cpc:{low:5,high:5},conversion:{low:0.02,high:0.02},close:{low:0.1,high:0.1},value:3000});
  close(full.expected.customers,4);close(full.expected.costPerCustomer,2500);close(full.expected.revenue,12000);close(full.expected.roas,1.2);
  const none=paidScenario({budget:500,cpc:{low:5,high:5},conversion:{low:0,high:0}});assert.equal(none.expected.costPerLead,null,'zero leads never divides');
});
test('SEO scenarios cost work and content, and start from today’s organic clicks',()=>{
  const s=seoScenario({hours:20,hourlyRate:500,tools:1000,pieces:4,pieceCost:1500,clicks:600,growth:{low:0,high:0.3},conversion:{low:0.01,high:0.03}});
  assert.equal(s.cost,17000);close(s.low.leads,6);close(s.high.clicks,780);close(s.high.leads,23.4);close(s.expected.leads,600*1.15*0.02);
});
test('the goal solver and sensitivity explain the ranges without inventing numbers',()=>{
  const need=requiredBudget(50,{low:4,high:8},{low:0.02,high:0.04});close(need.low,5000);close(need.expected,50/0.03*6);close(need.high,20000);
  assert.equal(requiredBudget(10,{low:1,high:2},{low:0,high:0}).high,null);
  const swings=paidSensitivity({budget:10000,cpc:{low:5,high:5.5},conversion:{low:0.01,high:0.05}});assert.equal(swings[0].input,'conversion','the widest range drives the result');close(swings.reduce((sum,item)=>sum+item.share,0),1);
  assert.equal(seoSensitivity({hours:1,hourlyRate:1,tools:0,pieces:0,pieceCost:0,clicks:0,growth:{low:0,high:1},conversion:{low:0.01,high:0.02}}).every(item=>item.share===0),true,'no clicks, no swing');
  assert.equal(validRange({low:2,high:1},0,10),false);assert.equal(validRange({low:0,high:1},0,1),true);
});
test('published reference values carry their source and date, stay in USD and only widen a range',()=>{
  const {BENCHMARKS,BENCHMARK_SOURCES,benchmarkSource,includeValue}=load('budget-benchmarks.ts');
  for(const item of BENCHMARKS){const source=benchmarkSource(item);assert.match(source.url,/^https:\/\/localiq\.com\/blog\//);assert.match(source.updated,/^\d{4}-\d{2}-\d{2}$/);assert.ok(['USD','ratio'].includes(item.unit));assert.ok(item.value>0&&(item.unit==='USD'||item.value<1));}
  assert.equal(BENCHMARKS.find(item=>item.id==='search-cpc').value,5.42);assert.equal(BENCHMARKS.find(item=>item.id==='meta-leads-conversion').value,0.0854);
  for(const source of Object.values(BENCHMARK_SOURCES))assert.match(source.scope.en,/not stated/,'the missing region and period are said, not hidden');
  assert.deepEqual(plain(includeValue({low:3,high:4},5.42)),{low:3,high:5.42});assert.deepEqual(plain(includeValue({low:3,high:6},5.42)),{low:3,high:6},'a range that already covers the value is unchanged');
});
test('measured values come from this project’s records with source and period; scenarios are saved per project',coachRun(async f=>{
  f.setGoals([{id:'demo',label:{tr:'Talep',en:'Demand'},audience:{tr:'K',en:'A'},stages:[{tr:'Ziyaret',en:'Visit'},{tr:'Talep',en:'Request'},{tr:'Organik',en:'Organic'}]}]);
  let snapshot=new BudgetPlanner(f.db,f.scope).read();
  assert.equal(snapshot.measured.cpc,null);assert.equal(snapshot.measured.organicClicksPerDay,null);assert.equal(snapshot.measured.conversions.length,0,'no data, nothing measured');
  const {organizationId,projectId}=f.scope,now=new Date().toISOString();
  f.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES('c-ads',?,?,'meta_ads','act_1','QA','{}',1,?),('c-ga4',?,?,'ga4','123','QA','{}',1,?),('c-gsc',?,?,'search_console','https://example.com/','QA','{}',1,?)").run(organizationId,projectId,now,organizationId,projectId,now,organizationId,projectId,now);
  f.db.prepare("INSERT INTO platform_ad_plans(id,organization_id,project_id,connection_id,name,objective,daily_budget_minor,currency,start_date,end_date,countries_json,link_url,state,digest,spend_minor,impressions,clicks,spend_checked_at,created_by,created_at,updated_at) VALUES('p1',?,?,'c-ads','A','OUTCOME_TRAFFIC',1000,'TRY','2026-10-01','2026-10-10','[]','https://example.com','paused','d',123400,20000,400,?,?,?,?)").run(organizationId,projectId,now,f.scope.subject,now,now);
  const {PlatformRepository}=load('repository.ts'),goal=new PlatformRepository(f.db).workspace(f.scope.subject,organizationId,projectId).project.goals.find(item=>item.id==='demo'),signature=require('node:crypto').createHash('sha256').update(JSON.stringify(goal)).digest('hex');
  const binding=(id,connection,provider,metric,stage,goalSignature=signature)=>f.db.prepare("INSERT INTO platform_measurement_bindings(id,organization_id,project_id,goal_id,stage_index,goal_signature,connection_id,provider,definition_json,version,enabled,manager_id,updated_at) VALUES(?,?,?,'demo',?,?,?,?,?,1,0,?,?)").run(id,organizationId,projectId,stage,goalSignature,connection,provider,JSON.stringify({metric,eventName:''}),f.scope.subject,now);
  binding('b-sessions','c-ga4','ga4','sessions',0);binding('b-key','c-ga4','ga4','keyEvents',1);binding('b-gsc','c-gsc','search_console','clicks',2);
  const entry=(id,stage,value,source,bindingId,from,to)=>f.db.prepare("INSERT INTO platform_metric_entries(id,organization_id,project_id,goal_id,stage_index,value,observed_at,source,note,binding_id,binding_version,period_from,period_to) VALUES(?,?,?,'demo',?,?,?,?,'',?,1,?,?)").run(id,organizationId,projectId,stage,value,now,source,bindingId,from,to);
  entry('e1',0,800,'ga4','b-sessions','2026-10-03','2026-10-09');entry('e2',1,20,'ga4','b-key','2026-10-03','2026-10-09');entry('e3',2,70,'search_console','b-gsc','2026-10-10','2026-10-16');
  entry('e4',1,99,'ga4','b-key','2026-09-01','2026-09-07');
  snapshot=new BudgetPlanner(f.db,f.scope).read();
  assert.equal(snapshot.currency,'TRY');close(snapshot.measured.cpc.value,1234/400);close(snapshot.measured.ctr.value,400/20000);assert.equal(snapshot.measured.cpc.source,'meta');
  close(snapshot.measured.organicClicksPerDay.value,10);assert.equal(snapshot.measured.organicClicksPerDay.from,'2026-10-10');
  assert.equal(snapshot.measured.conversions.length,1,'only same goal, source and period pair up');close(snapshot.measured.conversions[0].value,20/800);assert.equal(snapshot.measured.conversions[0].to,'2026-10-09');
  // A mapping made for an older version of the goal no longer pairs up: its stages may mean something else now.
  f.db.prepare("UPDATE platform_measurement_bindings SET goal_signature='old-goal' WHERE id='b-key'").run();assert.equal(new BudgetPlanner(f.db,f.scope).read().measured.conversions.length,0);
  f.db.prepare("UPDATE platform_measurement_bindings SET goal_signature=? WHERE id='b-key'").run(signature);
  const planner=new BudgetPlanner(f.db,f.scope),input={name:'Meta deneme',kind:'paid',currency:'TRY',inputs:{budget:10000,cpc:{low:3,high:5},conversion:{low:0.02,high:0.03},close:null,value:null},sources:{cpc:'Meta, 1–10 Eki'}};
  for(const bad of [{inputs:{...input.inputs,cpc:{low:0,high:5}}},{inputs:{...input.inputs,conversion:{low:0.5,high:0.2}}},{inputs:{...input.inputs,budget:-1}},{currency:'lira'},{kind:'tv'}])assert.throws(()=>planner.save({...input,...bad}),JSON.stringify(bad));
  snapshot=planner.save(input);assert.equal(snapshot.scenarios.length,1);assert.deepEqual(plain(snapshot.scenarios[0].sources),{cpc:'Meta, 1–10 Eki'});
  const saved=snapshot.scenarios[0];assert.throws(()=>planner.save({...input,id:saved.id,expectedRevision:saved.revision+1}),error=>error.status===409);
  assert.equal(planner.save({...input,name:'v2',id:saved.id,expectedRevision:saved.revision}).scenarios[0].name,'v2');
  const viewer=f.member('viewer');assert.equal(new BudgetPlanner(f.db,viewer).read().scenarios.length,1);assert.throws(()=>new BudgetPlanner(f.db,viewer).save(input),error=>error.status===403);
  assert.equal(new BudgetPlanner(f.db,f.other).read().scenarios.length,0,'other projects see nothing');
  assert.equal(planner.remove({id:saved.id}).scenarios.length,0);
}));
test('schema45 is additive and repeatable',coachRun(async f=>{
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'budget-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeBudgetSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,44);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,57);assert.ok(db.prepare('PRAGMA table_info(platform_ad_plans)').all().some(column=>column.name==='clicks'));db.close();
}));
