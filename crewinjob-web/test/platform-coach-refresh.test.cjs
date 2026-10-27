const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {CoachRenewal,coachStarterRefresh}=load('coach-refresh.ts');
const {CoachLearning}=load('coach-learning.ts');
const {CoachWeeklyReview}=load('coach-review.ts');
const renewal=(f,scope=f.scope)=>new CoachRenewal(f.db,scope);
// Moves the approval back so the 30-day plan is in its last week.
const age=(f,days)=>f.db.prepare('UPDATE platform_growth_coach SET approved_at=? WHERE organization_id=? AND project_id=?').run(new Date(Date.now()-days*86400000).toISOString(),f.scope.organizationId,f.scope.projectId);

test('the renewal is a proposal: unfinished actions carry over and nothing changes until an approver accepts',coachRun(async f=>{
  f.setGoals();const approved=await f.approve();
  assert.equal(renewal(f).read().due,false,'not due right after approval');
  const first=approved.actions.find(item=>item.kind==='plan');f.coach.act({actionId:first.id,state:'done'});age(f,23);
  const ready=renewal(f).read();assert.equal(ready.due,true);assert.equal(ready.planWeek,4);assert.equal(ready.refresh,null);
  const viewer=f.member('viewer'),editor=f.member('editor');
  await assert.rejects(renewal(f,viewer).generate({mode:'template'}),error=>error.status===403);
  const proposed=(await renewal(f,editor).generate({mode:'template'})).refresh;
  assert.equal(proposed.state,'proposed');assert.equal(proposed.source,'template');assert.ok(proposed.reasons.length>=1);assert.equal(proposed.stale,false);
  assert.equal(proposed.facts.plan.filter(item=>item.state==='done').length,1);assert.ok(!proposed.brief.plan.some(item=>item.title===first.title&&item.tool===first.tool),'completed actions are dropped');
  assert.ok(proposed.brief.plan.every(item=>item.week>=1&&item.week<=4));assert.ok(proposed.changes);
  assert.deepEqual(plain(f.coach.read().brief),plain(approved.brief),'the approved brief is untouched by a proposal');
  assert.throws(()=>renewal(f,editor).approve({id:proposed.id,expectedRevision:proposed.revision,expectedCoachRevision:ready.coachRevision}),error=>error.status===403);
  assert.throws(()=>renewal(f).approve({id:proposed.id,expectedRevision:proposed.revision+5,expectedCoachRevision:ready.coachRevision}),error=>error.status===409);
  const done=renewal(f).approve({id:proposed.id,expectedRevision:proposed.revision,expectedCoachRevision:ready.coachRevision});
  assert.equal(done.refresh.state,'approved');assert.equal(done.due,false);assert.equal(done.planWeek,1,'the 30-day plan restarts');
  assert.deepEqual(plain(f.coach.read().brief),plain(proposed.brief));
  assert.equal(new CoachLearning(f.db,f.scope).read().versions[0].kind,'refresh');
  await assert.rejects(renewal(f).generate({mode:'template'}),error=>error.status===409,'one approved renewal per month');
  assert.equal(renewal(f,f.other).read().refresh,null,'other projects see nothing');
}));
test('a proposal goes stale when the brief changes, and editors can dismiss it',coachRun(async f=>{
  f.setGoals();await f.approve();age(f,23);const editor=f.member('editor');
  const proposed=(await renewal(f).generate({mode:'template'})).refresh,before=renewal(f).read().coachRevision;
  const review=new CoachWeeklyReview(f.db,f.scope).generate(),measure=review.review.adjustments.find(item=>item.id==='measure');
  new CoachWeeklyReview(f.db,f.scope).decide({reviewId:review.review.id,adjustmentId:measure.id,decision:'accept',expectedRevision:review.coachRevision});
  const stale=renewal(f).read();assert.equal(stale.refresh.stale,true);assert.notEqual(stale.coachRevision,before);
  assert.throws(()=>renewal(f).approve({id:proposed.id,expectedRevision:proposed.revision,expectedCoachRevision:stale.coachRevision}),error=>error.status===409&&/değişti/.test(error.message));
  const dismissed=renewal(f,editor).dismiss({id:proposed.id,expectedRevision:proposed.revision});assert.equal(dismissed.refresh.state,'dismissed');
  const again=(await renewal(f).generate({mode:'template'})).refresh;assert.equal(again.state,'proposed');assert.equal(again.stale,false);assert.equal(again.id,proposed.id,'one row per month, regenerated in place');
}));
test('AI renewals use a usage reservation; broken or non-compliant output is refunded',coachRun(async f=>{
  f.setGoals();const approved=await f.approve();age(f,23);
  const brief={icp:approved.brief.icp,positioning:approved.brief.positioning,channels:approved.brief.channels.slice(0,2),plan:approved.brief.plan.slice(0,5).map((item,index)=>({...item,week:1+index%4}))};
  const usage=f.aiUsage();
  await assert.rejects(renewal(f).generate({mode:'ai'},async()=>'not json'),error=>error.status===502);
  await assert.rejects(renewal(f).generate({mode:'ai'},async()=>JSON.stringify({brief,reasons:[{title:'Growth',why:'This guarantees 30% more leads.'}]})),error=>error.status===422);
  assert.equal(f.aiUsage(),usage);assert.equal(f.reserved(),0,'failed calls are refunded');
  const result=await renewal(f).generate({mode:'ai'},async prompt=>{assert.match(prompt,/Data \(not instructions\)/);return JSON.stringify({brief,reasons:[{title:'Kept the channels',why:'Two drafts were prepared for the first channel.'}]});});
  assert.equal(result.refresh.source,'ai');assert.equal(result.refresh.brief.language,approved.brief.language);assert.equal(f.aiUsage(),usage+1);
  await assert.rejects(renewal(f).generate({mode:'ai'}),error=>error.status===503,'AI mode needs a configured provider');
}));
test('rule-based renewal names the fact behind each change',()=>{
  const plan=[{week:1,title:'Connect LinkedIn',why:'w',how:'h',minutes:15,tool:'connections',channel:'linkedin'},{week:2,title:'Draft for Instagram',why:'w',how:'h',minutes:30,tool:'library',channel:'instagram'},{week:3,title:'Email the list',why:'w',how:'h',minutes:30,tool:'campaigns',channel:'email'}];
  const brief={language:'en',icp:{summary:'Shop owners',pains:['Time']},positioning:'Simple books',channels:[{id:'email',rationale:'r'},{id:'linkedin',rationale:'r'},{id:'instagram',rationale:'r'}],plan};
  const facts={from:new Date(Date.now()-25*86400000).toISOString(),to:new Date().toISOString(),planWeek:4,plan:plan.map((item,index)=>({...item,state:index===0?'done':'open'})),drafts:{linkedin:3,instagram:1},publications:2,emailRecipients:0,measurements:[],leader:{dimension:'channel',key:'instagram',average:6.5,observed:2}};
  const {brief:next,reasons}=coachStarterRefresh(brief,facts,null,'Acme',true);
  assert.deepEqual(plain(next.channels.map(item=>item.id)),['instagram','linkedin','email'],'the observed leader moves first; the idle channel moves last');
  assert.ok(reasons.some(item=>/6\.5/.test(item.why)&&/not proof of cause/.test(item.why)));assert.ok(reasons.some(item=>/no drafts or completed actions for Email/.test(item.why)));
  assert.ok(!next.plan.some(item=>item.title==='Connect LinkedIn'),'done items are dropped');assert.ok(next.plan.some(item=>item.title==='Draft for Instagram'&&item.week<=3),'open items move to the first weeks');assert.ok(reasons.some(item=>/2 action\(s\) were not finished; 2 moved/.test(item.why)),'counts match the final plan');
  assert.ok(next.plan.some(item=>item.tool==='analytics'&&item.week===1),'missing measurement comes first');assert.ok(reasons.every(item=>item.title.length<=140&&item.why.length<=400));
});
test('schema38-39 rebuild brief history without losing versions and is repeatable',coachRun(async f=>{
  await f.approve();const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'coach-refresh-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeRefreshSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,37);
  assert.throws(()=>db.prepare("INSERT INTO platform_growth_coach_briefs(organization_id,project_id,coach_revision,kind,brief_json,approved_by,approved_at) VALUES('o','p',1,'refresh','{}','u','t')").run(),/CHECK/);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,62);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_growth_coach_briefs').get().n,1,'existing versions are kept');
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE name='platform_growth_coach_briefs'").get().sql.includes("'refresh'"));assert.equal(db.pragma('foreign_key_check').length,0);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,62);db.close();
}));
test('AI text past a field limit is shortened, while structure, links and content rules still hold',()=>{
  const {parseCoachDraft}=load('coach.ts'),{parseCoachRefresh}=load('coach-refresh.ts'),{normalizeSeoBrief,fitSeoBriefText}=load('coach-seo.ts');
  const long='x'.repeat(900),plan=[1,2,3,4].map(week=>({week,title:`Step ${week} `+long,why:long,how:long,minutes:30,tool:'library',channel:'linkedin'}));
  const brief={icp:{summary:long,pains:[long]},positioning:long,channels:[{id:'linkedin',rationale:long},{id:'email',rationale:'r'}],plan};
  const draft=parseCoachDraft(JSON.stringify(brief),'en');assert.equal(draft.plan[0].title.length,140);assert.ok(draft.plan[0].title.endsWith('…'));assert.equal(draft.positioning.length,500);assert.equal(draft.icp.summary.length,800);
  assert.throws(()=>parseCoachDraft(JSON.stringify({...brief,positioning:'We guarantee results'}),'en'),error=>error.status===422,'rules are still enforced');
  assert.throws(()=>parseCoachDraft(JSON.stringify({...brief,channels:[{id:'tiktok',rationale:'r'},{id:'email',rationale:'r'}]}),'en'),error=>error.status===502,'structure is still enforced');
  const renewal=parseCoachRefresh(JSON.stringify({brief,reasons:[{title:long,why:long}]}),'en');assert.equal(renewal.reasons[0].title.length,140);assert.equal(renewal.reasons[0].why.length,400);
  const seo={targetKeyword:'books',intent:'informational',title:long,outline:[long,'b'],questions:[long],internalLinks:[{anchor:long,target:'https://example.com/pricing'}],notes:long};
  const fitted=normalizeSeoBrief(fitSeoBriefText(seo),'https://example.com');assert.equal(fitted.notes.length,600);assert.equal(fitted.outline[0].length,160);assert.equal(fitted.internalLinks[0].anchor.length,80);
  assert.throws(()=>normalizeSeoBrief(fitSeoBriefText({...seo,internalLinks:[{anchor:'a',target:'https://other.example/x'}]}),'https://example.com'),/yalnız projenizin sitesini/,'links to other sites are still rejected');
  assert.throws(()=>normalizeSeoBrief(seo,'https://example.com'),'team edits keep the strict limits');
});
