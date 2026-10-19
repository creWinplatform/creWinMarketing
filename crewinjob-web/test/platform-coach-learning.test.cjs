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
  const viewer=new CoachLearning(f.db,f.member('viewer')).read();assert.deepEqual(plain(viewer.measurements.map(item=>[item.stage.en,item.first,item.last,item.entries,item.source])),[['Visit',3,8,2,'manual']]);
  assert.throws(()=>new CoachLearning(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).read(),error=>error.status===403);
}));
test('schema35 backfills existing approved briefs and is repeatable',coachRun(async f=>{
  await f.approve();const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'coach-learning-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeBriefHistorySchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,34);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,45);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_growth_coach_briefs').get().n,1,'the approved brief is backfilled');assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));

// Phase 4 · outcomes week by week and the email bridge.
const {coachWeekKey,zonedInstant,zonedShiftDays}=load('coach.ts');
const campaign=(f,coachRef,extra={})=>{const now=new Date().toISOString(),id=`cmp_${++counter}`;return new ProjectMarketingStore(f.db,f.scope).saveCampaign({id,name:`Campaign ${counter}`,objective:'awareness',status:'draft',audience:{fillBuckets:[]},channels:{social:[],email:true,whatsapp:false,telegram:false,paidAds:[]},content:{text:'Hello',subject:'Hi'},budget:{currency:'USD',dailyByPlatform:{}},timezone:'UTC',utm:{campaign:'c'},deliveries:[],createdAt:now,updatedAt:now,...(coachRef?{coachRef}:{}),...extra},true);};
const pilot=(f,campaignId,mode,states)=>{
  const job=`job_${++counter}`,now=new Date().toISOString(),{organizationId,projectId,subject}=f.scope;
  f.db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,'r',?,'completed',?,?,?)").run(job,organizationId,projectId,subject,connection(f),job,now,now,mode==='send'?'email.pilot_send':'email.rehearsal');
  f.db.prepare("INSERT INTO platform_email_pilots(job_id,organization_id,project_id,campaign_id,campaign_name,review_id,encrypted_snapshot,outcome,mode) VALUES(?,?,?,?,'c',1,'{}','completed',?)").run(job,organizationId,projectId,campaignId,mode);
  states.forEach((state,index)=>f.db.prepare('INSERT INTO platform_email_pilot_recipients(job_id,organization_id,project_id,position,email_key,masked_email,state,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(job,organizationId,projectId,index+1,`k${index}`,'a***@example.com',state,now));
};
test('email campaigns opened from the coach report pilot results without opens or clicks',coachRun(async f=>{
  f.setGoals();await f.approve();
  const tracked=campaign(f,'setup:goal',{goalId:'demo'}),untracked=campaign(f,null);
  pilot(f,tracked.id,'rehearsal',['validated']);pilot(f,tracked.id,'send',['accepted','delivered','bounced']);pilot(f,untracked.id,'send',['delivered']);
  const snapshot=learning(f).read();
  assert.deepEqual(plain(snapshot.email),{campaigns:1,rehearsals:1,sends:1,recipients:{accepted:1,delivered:1,bounced:1,complained:0,rejected:0,uncertain:0}},'only coach campaigns count; untracked ones are ignored');
  const row=snapshot.drafts.find(item=>item.id===tracked.id);assert.equal(row.channel,'email');assert.equal(row.published,1);assert.equal(row.rehearsed,1);assert.equal(row.engagement.observed,0);
  const email=snapshot.byChannel.find(item=>item.key==='email');assert.equal(email.drafts,1);assert.equal(email.observed,0,'email never feeds the engagement leader');
  const week=snapshot.outcomes.activity.at(-1);assert.equal(week.campaigns,1);assert.equal(week.emailRecipients,3,'accepted, delivered and bounced were sent; validated rehearsal recipients were not');assert.equal(week.byGoal.demo,1);
}));
test('outcomes place each reading in exactly one week and keep manual and automatic sources apart',coachRun(async f=>{
  f.setGoals();await f.approve();const {ProjectOperations}=load('operations.ts'),operations=new ProjectOperations(f.db,f.scope),timeZone=f.coach.timeZone(),{organizationId,projectId}=f.scope;
  const ago=days=>new Date(Date.now()-days*86400000).toISOString();
  const twoWeeksAgo=zonedShiftDays(coachWeekKey(new Date(),timeZone),-14),inWeek=(day,hour)=>zonedInstant(zonedShiftDays(twoWeeksAgo,day),hour,timeZone);
  operations.saveMetric({goalId:'demo',stageIndex:1,value:5,observedAt:inWeek(1,9)});operations.saveMetric({goalId:'demo',stageIndex:1,value:4,observedAt:inWeek(3,9)});operations.saveMetric({goalId:'demo',stageIndex:1,value:2,observedAt:ago(30)});
  operations.saveMetric({goalId:'demo',stageIndex:1,value:9,observedAt:ago(80)});
  // An automatic reading fetched today for a period that ended ten days ago belongs to that earlier week.
  const periodTo=ago(10).slice(0,10),periodFrom=ago(16).slice(0,10);
  f.db.prepare("INSERT INTO platform_metric_entries(id,organization_id,project_id,goal_id,stage_index,value,observed_at,source,note,period_from,period_to) VALUES('auto_1',?,?,'demo',1,40,?,'ga4','',?,?)").run(organizationId,projectId,new Date().toISOString(),periodFrom,periodTo);
  draft(f,'setup:goal');f.db.prepare("INSERT INTO platform_growth_coach_actions(organization_id,project_id,action_id,state,week,actor_id,updated_at) VALUES(?,?,'plan:x','done','w',?,?)").run(organizationId,projectId,f.scope.subject,new Date().toISOString());
  const {outcomes}=learning(f).read(),manual=outcomes.rows.find(row=>row.source==='manual'),auto=outcomes.rows.find(row=>row.source==='ga4');
  assert.equal(outcomes.weeks.length,8);assert.equal(outcomes.weeks.at(-1),coachWeekKey(new Date(),timeZone));assert.equal(outcomes.timeZone,timeZone);
  assert.equal(outcomes.rows.length,2,'one row per goal stage and source');
  const at=iso=>outcomes.weeks.indexOf(coachWeekKey(new Date(iso),timeZone));
  const filled=manual.cells.map((cell,index)=>cell?[index,cell.value]:null).filter(Boolean);
  assert.equal(outcomes.weeks.indexOf(twoWeeksAgo),5);assert.equal(manual.cells[5].value,4,'the latest reading of a week wins; readings are never added up');
  assert.ok(filled.some(([index,value])=>index===at(ago(30))&&value===2));assert.equal(filled.length,2);
  assert.ok(!filled.some(([,value])=>value===9),'readings older than eight weeks are left out');
  const autoCell=auto.cells.find(Boolean);assert.equal(autoCell.value,40);assert.equal(autoCell.at,periodTo);assert.equal(autoCell.from,periodFrom);
  assert.equal(outcomes.activity.at(-1).drafts,1);assert.equal(outcomes.activity.at(-1).actionsDone,1);
  assert.equal(new CoachLearning(f.db,f.other).read().outcomes.rows.length,0,'other projects see nothing');
}));
