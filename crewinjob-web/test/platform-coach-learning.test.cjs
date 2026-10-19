const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {CoachLearning}=load('coach-learning.ts');
const {CoachContentPlan,coachMonthKey}=load('coach-content.ts');
const {CoachWeeklyReview}=load('coach-review.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const {COACH_REF,diffBriefs}=load('coach-types.ts');
const learning=f=>new CoachLearning(f.db,f.scope);
let counter=0;
const draft=(f,coachRef,platform='linkedin',headline='Draft')=>new ProjectMarketingStore(f.db,f.scope).saveContent({id:`hist_${++counter}`,platform,language:'en',content:'A real draft.',prompt:'',headline,timestamp:Date.now(),...(coachRef?{coachRef}:{})},true);
const connection=f=>{const id='qa-social';if(!f.db.prepare('SELECT 1 FROM platform_connections WHERE id=?').get(id))f.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,'social','linkedin:qa','QA','{}',1,?)").run(id,f.scope.organizationId,f.scope.projectId,new Date().toISOString());return id;};
const publish=(f,sourceId,{mode='publish',state='accepted',counts=null,engagement='ready'}={})=>{
  const job=`job_${++counter}`,now=new Date().toISOString(),{organizationId,projectId,subject}=f.scope;
  f.db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,'r',?,'completed',?,?,'social.publish')").run(job,organizationId,projectId,subject,connection(f),job,now,now);
  f.db.prepare("INSERT INTO platform_social_publications(job_id,organization_id,project_id,source_kind,source_id,source_digest,body_digest,encrypted_snapshot,mode,state,scheduled_at,timezone,configuration_revision) VALUES(?,?,?,'content',?,'d','b','{}',?,?,?,'UTC','c')").run(job,organizationId,projectId,sourceId,mode,state,now);
  if(counts)f.db.prepare('INSERT INTO platform_social_engagement(job_id,organization_id,project_id,counts_json,observed_at,attempted_at,state) VALUES(?,?,?,?,?,?,?)').run(job,organizationId,projectId,JSON.stringify(counts),engagement==='ready'?now:null,now,engagement);
};

test('coach references are validated and only coach drafts are tracked',coachRun(async f=>{
  for(const ok of ['plan:abc123','setup:goal','content:content_x-1','seo:seo_1'])assert.ok(COACH_REF.test(ok),ok);
  for(const bad of ['plan:','other:x','plan:<script>','content:'+'x'.repeat(200)])assert.ok(!COACH_REF.test(bad),bad);
  await f.approve();draft(f,null);draft(f,'setup:goal');
  const before=f.db.totalChanges,snapshot=learning(f).read();assert.equal(f.db.totalChanges,before,'reads never write');
  assert.equal(snapshot.drafts.length,1);assert.equal(snapshot.drafts[0].source,'setup');assert.equal(snapshot.drafts[0].published,0);assert.equal(snapshot.drafts[0].engagement.observed,0);
}));
test('drafts, accepted publications and reported engagement roll up by channel and theme',coachRun(async f=>{
  await f.approve();const plan=new CoachContentPlan(f.db,f.scope),next=coachMonthKey(new Date(),1),[a,b]=(await plan.generate({month:next,mode:'template'})).items;
  const one=draft(f,`content:${a.id}`,'linkedin'),two=draft(f,`content:${b.id}`,'email'),three=draft(f,`content:${a.id}`,'linkedin');
  publish(f,one.id,{counts:{likes:10,comments:2,impressions:900}});publish(f,three.id,{counts:{likes:4,shares:1}});
  publish(f,two.id,{mode:'rehearsal',state:'rehearsed'});publish(f,two.id,{counts:{likes:99},engagement:'unavailable'});
  publish(f,one.id,{mode:'publish',state:'rejected',counts:{likes:500}});
  const snapshot=learning(f).read(),linkedin=snapshot.byChannel.find(item=>item.key==='linkedin'),email=snapshot.byChannel.find(item=>item.key==='email');
  assert.equal(linkedin.drafts,2);assert.equal(linkedin.published,2);assert.equal(linkedin.observed,2);assert.equal(linkedin.interactions,17,'likes+comments+shares; impressions excluded; rejected ignored');assert.equal(linkedin.totals.impressions,900);
  assert.equal(email.published,1);assert.equal(email.observed,0,'unavailable engagement is not data');assert.equal(email.interactions,0);
  assert.ok(snapshot.byTheme.some(item=>item.key===a.theme));
  assert.equal(snapshot.leader?.dimension,undefined,'one group with data is not enough to name a leader');
  assert.equal(snapshot.drafts.find(item=>item.id===two.id).rehearsed,1);
  // A second channel with observed data allows naming the leader, with a stated average.
  const four=draft(f,`content:${b.id}`,'email');publish(f,four.id,{counts:{likes:1}});
  const leader=learning(f).read().leader;assert.equal(leader.dimension,'channel');assert.equal(leader.key,'linkedin');assert.equal(leader.average,8.5);assert.equal(leader.observed,2);
  assert.equal(new CoachLearning(f.db,f.other).read().drafts.length,0,'other projects see nothing');
}));
test('brief versions are recorded on approval and approved plan changes, with a diff',coachRun(async f=>{
  f.setGoals();const approved=await f.approve();let snapshot=learning(f).read();
  assert.equal(snapshot.versions.length,1);assert.equal(snapshot.versions[0].kind,'approve');assert.equal(snapshot.changes,null);assert.equal(f.coach.read().previousBrief,null);
  const review=new CoachWeeklyReview(f.db,f.scope).generate(),measure=review.review.adjustments.find(item=>item.id==='measure');
  new CoachWeeklyReview(f.db,f.scope).decide({reviewId:review.review.id,adjustmentId:measure.id,decision:'accept',expectedRevision:review.coachRevision});
  snapshot=learning(f).read();assert.equal(snapshot.versions.length,2);assert.equal(snapshot.versions[0].kind,'adjust');assert.equal(snapshot.changes.planAdded,1);
  assert.equal(f.coach.read().versions,2);assert.ok(f.coach.read().previousBrief);
  const changed=diffBriefs(approved.brief,{...approved.brief,positioning:'New',channels:[...approved.brief.channels.slice(1),{id:'instagram',rationale:'x'}],plan:approved.brief.plan.map((item,i)=>i===0?{...item,week:2}:item)});
  assert.deepEqual(plain(changed.channelsAdded),['instagram']);assert.deepEqual(plain(changed.channelsRemoved),[approved.brief.channels[0].id]);assert.equal(changed.positioning,true);assert.equal(changed.planMoved,1);
}));
test('measurement trend uses dated records only; viewers can read; Crewin is excluded',coachRun(async f=>{
  f.setGoals();await f.approve();const {ProjectOperations}=load('operations.ts'),operations=new ProjectOperations(f.db,f.scope);
  operations.saveMetric({goalId:'demo',stageIndex:0,value:3,observedAt:new Date(Date.now()-20*86400000).toISOString()});operations.saveMetric({goalId:'demo',stageIndex:0,value:8,observedAt:new Date(Date.now()-86400000).toISOString()});
  operations.saveMetric({goalId:'demo',stageIndex:1,value:1,observedAt:new Date(Date.now()-90*86400000).toISOString()});
  const viewer=new CoachLearning(f.db,f.member('viewer')).read();assert.deepEqual(plain(viewer.measurements.map(item=>[item.stage.en,item.first,item.last,item.entries])),[['Visit',3,8,2]]);
  assert.throws(()=>new CoachLearning(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).read(),error=>error.status===403);
}));
test('schema35 backfills existing approved briefs and is repeatable',coachRun(async f=>{
  await f.approve();const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'coach-learning-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeBriefHistorySchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,34);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,37);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_growth_coach_briefs').get().n,1,'the approved brief is backfilled');assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
