const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {GrowthCompass}=load('guidance.ts');
const {compassFromBrief}=load('coach-compass.ts');
const KEY='56'.repeat(32);
const compass=(f,scope=f.scope)=>new GrowthCompass(f.db,scope,KEY);
const prefs=f=>f.db.prepare('SELECT user_id,preferences_json,deferred,revision FROM platform_compass_preferences').all();

test('compass knows whether the coach can start first and suggests nothing before a brief',coachRun(async f=>{
  const before=f.db.totalChanges,snapshot=compass(f).read();assert.equal(f.db.totalChanges,before,'reads stay side-effect free');
  assert.deepEqual(plain(snapshot.coach),{hasBrief:false,hasDraft:false,canDiagnose:true});assert.equal(snapshot.suggestion,null);
  const viewer=compass(f,f.member('viewer')).read();assert.equal(viewer.coach.canDiagnose,false,'viewers keep the personal Compass first run');
  await f.coach.diagnose({answers:f.answers,language:'en',mode:'template',expectedRevision:0});assert.equal(compass(f).read().coach.hasDraft,true);
}));
test('the approved brief suggests the Compass path',coachRun(async f=>{
  f.setGoals();const approved=await f.approve(),snapshot=compass(f,f.member('editor')).read();
  assert.equal(snapshot.coach.hasBrief,true);assert.equal(snapshot.suggestion.intent,'leads');assert.equal(snapshot.suggestion.goalId,'demo');
  assert.deepEqual(plain(snapshot.suggestion.channels),plain(approved.brief.channels.map(item=>item.id).filter(id=>id!=='seo').map(id=>id==='linkedin'?'linkedin_company':id)));
  const brief=approved.brief;
  assert.equal(compassFromBrief({...brief,channels:[{id:'seo',rationale:'r'},{id:'email',rationale:'r'}]},f.answers,[]).intent,'seo');
  assert.equal(compassFromBrief({...brief,channels:[{id:'instagram',rationale:'r'}]},{...f.answers,market:'b2c'},[]).intent,'social');
  assert.equal(compassFromBrief(brief,f.answers,[{id:'a'},{id:'b'}]).goalId,'','several goals are never guessed');
}));
test('approving seeds only the approver\'s own empty Compass path',coachRun(async f=>{
  f.setGoals();const editor=f.member('editor'),viewer=f.member('viewer');
  compass(f,viewer).save({intent:'retention',experience:'experienced',channels:['email'],obstacles:{},expectedRevision:0});
  await f.approve();
  const rows=prefs(f),owner=rows.find(row=>row.user_id===f.scope.subject),kept=rows.find(row=>row.user_id===viewer.subject);
  assert.ok(owner);assert.equal(owner.deferred,0);assert.deepEqual(plain(JSON.parse(owner.preferences_json).channels),['linkedin_company','email']);
  assert.equal(JSON.parse(kept.preferences_json).intent,'retention','another member\'s choice is untouched');
  assert.ok(!rows.some(row=>row.user_id===editor.subject),'members who did not approve are not seeded');
  assert.equal(compass(f).read().firstRun,false);assert.equal(compass(f,editor).read().firstRun,true);
}));
test('an empty first-run deferral is replaced, a real choice never is',coachRun(async f=>{
  compass(f).defer(0);await f.approve();let owner=prefs(f).find(row=>row.user_id===f.scope.subject);
  assert.equal(owner.deferred,0);assert.equal(owner.revision,2);assert.ok(JSON.parse(owner.preferences_json).channels.length>0);
  compass(f).save({intent:'seo',experience:'guided',channels:[],obstacles:{},expectedRevision:2});
  const drafted=await f.coach.diagnose({answers:f.answers,language:'en',mode:'template',expectedRevision:f.coach.read().revision});f.coach.approve({brief:drafted.draft,expectedRevision:drafted.revision});
  owner=prefs(f).find(row=>row.user_id===f.scope.subject);assert.equal(JSON.parse(owner.preferences_json).intent,'seo');assert.equal(owner.revision,3);
}));
