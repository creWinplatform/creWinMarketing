const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHmac,randomBytes}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {CoachLearning}=load('coach-learning.ts');
const {CoachContentPlan,coachMonthKey,coachContentPrompt}=load('coach-content.ts');
const {CoachWeeklyReview}=load('coach-review.ts');
const {coachStarterRefresh}=load('coach-refresh.ts');
const {normalizeCoachBrief,coachPrompt}=load('coach.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const {ProductWebhooks,authenticateProductWebhook}=load('product-webhooks.ts');
const {ProjectMeasurements}=load('measurements.ts');
const {linkTag}=load('link-tracking.ts');
const KEY='12'.repeat(32),SECRET=randomBytes(32).toString('hex');
let counter=0;
const ago=days=>new Date(Date.now()-days*86400000).toISOString();

// Product events (signup → demo request) mapped to the goal's two stages, and a helper that signs a batch.
function results(f){
 const hooks=new ProductWebhooks(f.db,f.scope),source=hooks.save({name:'App',config:{entityType:'user',attributes:[{key:'plan',type:'string'}],eventNames:['demo.requested','user.signed_up']},secret:SECRET},KEY);
 hooks.preview(source.id,{sourceVersion:1,events:[{id:'p',entityId:'p',eventName:'user.signed_up',occurredAt:ago(0),attributes:{plan:'x'}}]});hooks.state(source.id,1,'activate');
 const measure=new ProjectMeasurements(f.db,f.scope,KEY);
 measure.save({goalId:'demo',stageIndex:0,connectionId:source.id,metric:'unique_entities',eventName:'user.signed_up',enabled:false,expectedVersion:0});
 measure.save({goalId:'demo',stageIndex:1,connectionId:source.id,metric:'unique_entities',eventName:'demo.requested',enabled:false,expectedVersion:0});
 return events=>{const bytes=Buffer.from(JSON.stringify({sourceVersion:1,events})),timestamp=String(Math.floor(Date.now()/1000));
  return authenticateProductWebhook(f.db,source.id,new Headers({'x-ryzevo-timestamp':timestamp,'x-ryzevo-signature':'v1='+createHmac('sha256',Buffer.from(SECRET,'hex')).update(`${timestamp}.${source.id}.`).update(bytes).digest('hex')}),KEY)(bytes);};
}
const person=(tag,source,days,demo=false)=>{const entityId=`person-${++counter}`,at=ago(days);return [{id:`s-${counter}`,entityId,eventName:'user.signed_up',occurredAt:at,attributes:{plan:'free'},attribution:{campaign:tag,source,touchedAt:at}},...(demo?[{id:`d-${counter}`,entityId,eventName:'demo.requested',occurredAt:new Date(Date.parse(at)+3600000).toISOString(),attributes:{plan:'free'}}]:[])];};
const draft=(f,coachRef,platform)=>new ProjectMarketingStore(f.db,f.scope).saveContent({id:`hist_${++counter}`,platform,language:'en',content:'A real draft with https://example.com/a',prompt:'',headline:`Draft ${counter}`,timestamp:Date.now(),...(coachRef?{coachRef}:{})},true);
const connection=f=>{const id='qa-social';if(!f.db.prepare('SELECT 1 FROM platform_connections WHERE id=?').get(id))f.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,'social','linkedin:qa','QA','{}',1,?)").run(id,f.scope.organizationId,f.scope.projectId,new Date().toISOString());return id;};
// An accepted live post whose own-site link carried the draft's tag (or no tracked link at all).
const publish=(f,draftId,{tagged=true,days=20}={})=>{
 const job=`job_${++counter}`,at=ago(days),{organizationId,projectId,subject}=f.scope;
 f.db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,'r',?,'completed',?,?,'social.publish')").run(job,organizationId,projectId,subject,connection(f),job,at,at);
 f.db.prepare("INSERT INTO platform_social_publications(job_id,organization_id,project_id,source_kind,source_id,source_digest,body_digest,encrypted_snapshot,mode,state,scheduled_at,submitted_at,timezone,configuration_revision,link_tag) VALUES(?,?,?,'content',?,'d','b','{}','publish','accepted',?,?,'UTC','c',?)").run(job,organizationId,projectId,draftId,at,at,tagged?linkTag(f.scope,'content',draftId):null);
};

test('the coach learns from people its work brought and keeps a track record',coachRun(async f=>{
 f.setGoals();await f.approve();
 const plan=new CoachContentPlan(f.db,f.scope),month=coachMonthKey(new Date(),1),[a,b,c]=(await plan.generate({month,mode:'template'})).items;
 f.db.prepare("UPDATE platform_coach_content_items SET goal_id='demo',stage_index=1 WHERE id=?").run(a.id);
 const one=draft(f,`content:${a.id}`,'linkedin'),two=draft(f,`content:${a.id}`,'linkedin'),three=draft(f,`content:${b.id}`,'facebook'),four=draft(f,`content:${c.id}`,'facebook'),unused=draft(f,`content:${c.id}`,'linkedin');
 publish(f,one.id);publish(f,two.id);publish(f,three.id,{days:3});publish(f,four.id,{tagged:false});
 const other1=draft(f,null,'linkedin'),other2=draft(f,null,'facebook');publish(f,other1.id);publish(f,other2.id);
 const before=new CoachLearning(f.db,f.scope).read();assert.equal(before.results,null,'no product results yet');assert.equal(before.track,null);assert.notEqual(before.leader?.basis,'results');
 const send=results(f);
 send([...person(linkTag(f.scope,'content',one.id),'linkedin',10,true),...person(linkTag(f.scope,'content',one.id),'linkedin',9),...person(linkTag(f.scope,'content',two.id),'linkedin',8,true),...person(linkTag(f.scope,'content',other1.id),'linkedin',7)]);
 const snapshot=new CoachLearning(f.db,f.scope).read();
 assert.deepEqual(snapshot.results.stages.map(stage=>stage.en),['Visit','Request']);
 const linkedin=snapshot.byChannel.find(item=>item.key==='linkedin'),facebook=snapshot.byChannel.find(item=>item.key==='facebook');
 assert.equal(linkedin.measured,2,'the unpublished draft is not measured');assert.deepEqual(plain(linkedin.results),[3,2]);assert.equal(facebook.measured,1,'an untagged post is not measured');assert.deepEqual(plain(facebook.results),[0,0]);
 assert.equal(snapshot.leader.basis,'results');assert.equal(snapshot.leader.key,'linkedin');assert.equal(snapshot.leader.average,1.5);assert.equal(snapshot.leader.observed,2);assert.equal(snapshot.leader.stage.en,'Visit');
 const items=Object.fromEntries(snapshot.track.items.map(item=>[item.ref,item]));
 assert.deepEqual(plain(items[`content:${a.id}`].counts),[3,2]);assert.equal(items[`content:${a.id}`].state,'measured');assert.equal(items[`content:${a.id}`].expected.stage.en,'Request');
 assert.equal(items[`content:${b.id}`].state,'waiting','published 3 days ago and nobody yet');
 assert.equal(items[`content:${c.id}`].state,'no_link','the only published copy had no tracked link');
 assert.equal(snapshot.track.used,3);assert.equal(snapshot.track.published,3);assert.equal(snapshot.track.withResults,1);assert.deepEqual(plain(snapshot.track.people),[3,2]);
 assert.deepEqual(plain(snapshot.track.baseline),{items:2,average:0.5},'non-coach tagged posts: one person over two posts');
 assert.ok(!JSON.stringify(snapshot).includes('person-'),'no person id reaches the view');
 // The weekly review proposes more of the channel that brought people, and says how many.
 const facts=new CoachWeeklyReview(f.db,f.scope).facts();assert.equal(facts.results.byChannel.linkedin,4);assert.equal(facts.results.stage.en,'Visit');
 const review=new CoachWeeklyReview(f.db,f.scope).generate().review,repeat=review.adjustments.find(item=>item.id==='repeat:linkedin');
 assert.ok(repeat,'repeat proposal for the results channel');assert.match(repeat.why.en,/4 people who first came through LinkedIn reached “Visit”/);assert.match(repeat.why.en,/not proof of cause/);
}));

test('the renewal names the basis of its leader',()=>{
 const plan=[{week:1,title:'Draft for Instagram',why:'w',how:'h',minutes:30,tool:'library',channel:'instagram'},{week:2,title:'Post on LinkedIn',why:'w',how:'h',minutes:30,tool:'library',channel:'linkedin'}];
 const brief={language:'en',icp:{summary:'Shop owners',pains:['Time']},positioning:'Simple books',channels:[{id:'instagram',rationale:'r'},{id:'linkedin',rationale:'r'}],plan};
 const facts={from:ago(25),to:ago(0),planWeek:4,plan:plan.map(item=>({...item,state:'open'})),drafts:{instagram:2,linkedin:2},publications:2,emailRecipients:0,measurements:[],site:null,
  leader:{dimension:'channel',key:'linkedin',average:1.5,observed:2,basis:'results',stage:{tr:'Kayıt',en:'Signup'}}};
 const {brief:next,reasons}=coachStarterRefresh(brief,facts,null,'Acme',false);
 assert.equal(next.channels[0].id,'linkedin');assert.ok(reasons.some(item=>/brought the most people to “Signup” per measured item: 1.5 \(2 measured items\)/.test(item.why.en||item.why)));
});

test('a plan action or content item may name the goal stage it should move; unknown stages are dropped',coachRun(async f=>{
 f.setGoals();
 const goals=f.repo.workspace(f.scope.subject,f.a.organizationId,f.a.projectId).project.goals;
 const base={language:'en',icp:{summary:'Shop owners',pains:['Time']},positioning:'Simple books',channels:[{id:'linkedin',rationale:'r'}]};
 const action=extra=>({week:1,title:`Action ${++counter}`,why:'w',how:'h',minutes:30,tool:'library',channel:'linkedin',...extra});
 const brief=normalizeCoachBrief({...base,plan:[action({goalId:'demo',stage:1}),action({goalId:'missing',stage:0}),action({goalId:'demo',stage:5}),action({goalId:'demo'}),action({})]},'human',goals);
 assert.deepEqual(plain(brief.plan.map(item=>[item.goalId??null,item.stage??null])),[['demo',1],[null,null],[null,null],[null,null],[null,null]]);
 assert.ok(!('goalId' in brief.plan[4]),'an action without a target keeps its old shape');
 assert.match(coachPrompt(f.answers,'en',{name:'Acme',website:'https://example.com',goals}),/"goalId":string\|null,"stage":number\|null/);
 await f.approve();
 const plan=new CoachContentPlan(f.db,f.scope),month=coachMonthKey(new Date(),1);
 const added=plan.add({month,channel:'linkedin',theme:'Guides',title:'Setup guide',angle:'Why it matters.',goalId:'demo',stageIndex:1,plannedFor:`${month}-15`}).items.find(item=>item.title==='Setup guide');
 assert.equal(added.stageIndex,1);
 const odd=plan.add({month,channel:'linkedin',theme:'Guides',title:'Odd stage',angle:'Why it matters.',goalId:'demo',stageIndex:9,plannedFor:`${month}-16`}).items.find(item=>item.title==='Odd stage');
 assert.equal(odd.stageIndex,null);
 const noGoal=plan.add({month,channel:'linkedin',theme:'Guides',title:'No goal',angle:'Why it matters.',goalId:'',stageIndex:1,plannedFor:`${month}-17`}).items.find(item=>item.title==='No goal');
 assert.equal(noGoal.stageIndex,null,'a stage needs its goal');
 assert.match(coachContentPrompt(f.coach.approved().brief,null,month,goals,4),/"stage":number\|null/);
}));

test('Crewin keeps the engagement view: no product results, no track record',coachRun(async f=>{
 const crewin=new CoachLearning(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).read();
 assert.equal(crewin.results,null);assert.equal(crewin.track,null);
}));
