const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {CoachWeeklyReview}=load('coach-review.ts');
const {GrowthCoach,coachPlanId}=load('coach.ts');
const {ProjectOperations}=load('operations.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const review=f=>new CoachWeeklyReview(f.db,f.scope);
const days=n=>new Date(Date.now()-n*86400000).toISOString();
const draft=(f,platform='linkedin')=>new ProjectMarketingStore(f.db,f.scope).saveContent({id:`content-${Math.random().toString(36).slice(2)}`,platform,language:'en',content:'A real draft.',prompt:'',timestamp:Date.now()},true);

test('weekly review needs an approved brief; reads never write',coachRun(async f=>{
  const before=f.db.totalChanges;assert.equal(review(f).read().hasBrief,false);assert.equal(review(f).read().review,null);assert.equal(f.db.totalChanges,before);
  assert.throws(()=>review(f).generate(),error=>error.status===404);
}));
test('an empty week says so: no data, no invented numbers, honest proposals',coachRun(async f=>{
  f.setGoals();await f.approve();const snapshot=review(f).generate(),value=snapshot.review;
  assert.equal(value.hasData,false);assert.deepEqual(plain(value.facts.measurements),[]);assert.deepEqual(plain(value.facts.rose),[]);
  assert.equal(value.facts.content.drafts,0);assert.equal(value.facts.content.publications,0);assert.equal(value.facts.lastMeasuredAt,null);
  assert.deepEqual(plain(value.adjustments.map(item=>item.id)).sort(),['connect-data','measure']);
  assert.ok(value.adjustments.every(item=>item.state==='proposed'));assert.doesNotMatch(JSON.stringify(value),/\d\s*%|uplift|ROI|guarantee/i);
}));
test('facts come only from project records; a rise is reported without claiming cause',coachRun(async f=>{
  f.setGoals();const approved=await f.approve(),operations=new ProjectOperations(f.db,f.scope);
  operations.saveMetric({goalId:'demo',stageIndex:1,value:4,observedAt:days(10),note:'Before'});operations.saveMetric({goalId:'demo',stageIndex:1,value:7,observedAt:days(2),note:'After'});
  draft(f);draft(f);draft(f,'blog');
  const coach=new GrowthCoach(f.db,f.scope),[first]=coach.read().actions;coach.act({actionId:first.id,state:'done'});
  const value=review(f).generate().review;
  assert.equal(value.hasData,true);
  assert.deepEqual(plain(value.facts.measurements.map(item=>[item.stage.en,item.latest,item.previous,item.source])),[['Request',7,4,'manual']]);
  assert.equal(value.facts.content.drafts,3);assert.deepEqual(plain(value.facts.content.draftsByChannel),{linkedin:2,blog:1});assert.equal(value.facts.actions.done,1);
  assert.deepEqual(plain(value.facts.rose.map(item=>[item.from,item.to])),[[4,7]]);
  const repeat=value.adjustments.find(item=>item.id==='repeat:linkedin');assert.ok(repeat);assert.match(repeat.why.en,/not proof of cause/);assert.equal(repeat.item.week,2);assert.equal(repeat.item.channel,'linkedin');
  assert.ok(!value.adjustments.some(item=>item.id==='measure'),'a fresh measurement needs no measurement proposal');
  // Another project's records never leak in.
  assert.equal(new CoachWeeklyReview(f.db,f.other).read().review,null);void approved;
}));
test('accepted adjustments change the approved plan and feed next week; rejected ones change nothing',coachRun(async f=>{
  f.setGoals();const approved=await f.approve(),coach=new GrowthCoach(f.db,f.scope),week1=approved.brief.plan.filter(item=>item.week===1&&item.tool!=='connections');
  for(const item of week1.slice(0,2))coach.act({actionId:coachPlanId(item),state:'skipped'});
  let snapshot=review(f).generate();const move=snapshot.review.adjustments.find(item=>item.kind==='move'),measure=snapshot.review.adjustments.find(item=>item.id==='measure');
  assert.ok(move,'two skipped actions propose moving the longest open action');assert.equal(move.toWeek,2);
  assert.throws(()=>review(f).decide({reviewId:snapshot.review.id,adjustmentId:measure.id,decision:'accept',expectedRevision:snapshot.coachRevision-1}),error=>error.status===409);
  snapshot=review(f).decide({reviewId:snapshot.review.id,adjustmentId:measure.id,decision:'accept',expectedRevision:snapshot.coachRevision});
  let brief=coach.read().brief;assert.ok(brief.plan.some(item=>item.week===2&&item.tool==='analytics'&&item.title==='Record this week’s measurement for your goal'));
  snapshot=review(f).decide({reviewId:snapshot.review.id,adjustmentId:move.id,decision:'accept',expectedRevision:snapshot.coachRevision});
  brief=coach.read().brief;assert.equal(brief.plan.find(item=>coachPlanId({...item,week:1})===move.actionId).week,2);
  const connect=snapshot.review.adjustments.find(item=>item.id==='connect-data'),plan=JSON.stringify(brief.plan);
  snapshot=review(f).decide({reviewId:snapshot.review.id,adjustmentId:connect.id,decision:'reject'});assert.equal(JSON.stringify(coach.read().brief.plan),plan);
  assert.throws(()=>review(f).decide({reviewId:snapshot.review.id,adjustmentId:connect.id,decision:'accept',expectedRevision:snapshot.coachRevision}),error=>error.status===409);
  snapshot=review(f).generate();assert.deepEqual(plain(snapshot.review.adjustments.filter(item=>item.state!=='proposed').map(item=>[item.id,item.state])).sort(),[['connect-data','rejected'],[move.id,'accepted'],['measure','accepted']].sort(),'decisions survive a refresh');
}));
test('roles: viewers read, editors refresh and reject, only approvers change the plan',coachRun(async f=>{
  f.setGoals();await f.approve();const snapshot=review(f).generate(),id=snapshot.review.id,[first,second]=snapshot.review.adjustments;
  const viewer=new CoachWeeklyReview(f.db,f.member('viewer')),editor=new CoachWeeklyReview(f.db,f.member('editor'));
  assert.ok(viewer.read().review);assert.throws(()=>viewer.generate(),error=>error.status===403);assert.throws(()=>viewer.decide({reviewId:id,adjustmentId:first.id,decision:'reject'}),error=>error.status===403);
  assert.throws(()=>editor.decide({reviewId:id,adjustmentId:first.id,decision:'accept',expectedRevision:snapshot.coachRevision}),error=>error.status===403);
  assert.equal(editor.decide({reviewId:id,adjustmentId:second.id,decision:'reject'}).review.adjustments.find(item=>item.id===second.id).state,'rejected');
  assert.throws(()=>new CoachWeeklyReview(f.db,f.other).decide({reviewId:id,adjustmentId:first.id,decision:'reject'}),error=>error.status===404);
  assert.doesNotThrow(()=>new CoachWeeklyReview(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).read(),'the Crewin workspace has this Ryzevo feature (lib/platform/ryzevo-features.ts)');
  f.db.prepare('UPDATE platform_coach_reviews SET week=? WHERE id=?').run('2000-01-03',id);
  assert.throws(()=>review(f).decide({reviewId:id,adjustmentId:first.id,decision:'reject'}),error=>error.status===409,'old reviews are read-only');
}));
test('the review window is today plus the six previous local days in the project time zone',coachRun(async f=>{
  f.setGoals();await f.approve();const {zonedInstant,zonedDateKey}=load('coach.ts'),now=new Date('2026-10-25T22:30:00Z');
  const facts=review(f).facts(now);assert.equal(zonedDateKey(now,'Europe/Istanbul'),'2026-10-26');assert.equal(facts.from,zonedInstant('2026-10-20',0,'Europe/Istanbul'));assert.equal(facts.from,'2026-10-19T21:00:00.000Z');
  const operations=new ProjectOperations(f.db,f.scope);operations.saveMetric({goalId:'demo',stageIndex:0,value:5,observedAt:'2026-10-19T21:30:00Z',note:'Tuesday 00:30 local'});operations.saveMetric({goalId:'demo',stageIndex:1,value:3,observedAt:'2026-10-19T20:30:00Z',note:'Monday 23:30 local'});
  const measured=review(f).facts(now).measurements.map(item=>item.stage.en);assert.deepEqual(plain(measured),['Visit'],'Monday 23:30 local falls outside, Tuesday 00:30 local inside');
}));
test('schema34 is additive and repeatable',coachRun(async f=>{
  await f.approve();review(f).generate();
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'coach-review-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeReviewSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,33);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,64);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_coach_reviews').get().n,0);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
