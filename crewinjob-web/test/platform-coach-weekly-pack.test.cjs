const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {CoachWeeklyPack,deliverNextWeeklyPack,parseWeeklyDraft,weeklyDraftPrompt}=load('coach-weekly-pack.ts');
const {CoachContentPlan}=load('coach-content.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const {teamAlerts}=load('team-alerts.ts');
const {zonedDateKey,coachWeekKey}=load('coach.ts');

// The plan items sit on today's date, which is always inside this week and this month, so the test does not depend on the calendar.
const setup=async f=>{
 await f.approve();const tz=f.coach.timeZone(),today=zonedDateKey(new Date(),tz),plan=new CoachContentPlan(f.db,f.scope);
 for(const [channel,title] of [['linkedin','Müşteri sorusu'],['instagram','Ekipten bir gün'],['linkedin','İkinci LinkedIn'],['email','Bülten'],['facebook','Duyuru']])plan.add({month:today.slice(0,7),channel:channel==='email'?'email':channel,theme:'T',title,angle:'Kısa açı',goalId:null,plannedFor:today});
 return {week:coachWeekKey(new Date(),tz)};
};
const drafts=f=>plain(new ProjectMarketingStore(f.db,f.scope).history().filter(item=>item.coachWeek));
const generator=(answer=index=>({headline:`Başlık ${index}`,content:`Taslak metin ${index}. {{bir müşteri örneği}}`}))=>{let calls=0;const fn=async prompt=>{calls++;fn.prompts.push(prompt);return {text:JSON.stringify(answer(calls)),usage:{provider:'gemini',model:'qa',prompt:5,output:5,thinking:0,total:10}};};fn.prompts=[];fn.calls=()=>calls;return fn;};

test('the pack is off by default, only approvers turn it on, and only with an approved brief',coachRun(async f=>{
 const pack=new CoachWeeklyPack(f.db,f.scope);assert.equal(pack.view().enabled,false);assert.equal(pack.view().available,true);
 assert.throws(()=>pack.setEnabled({enabled:true}),/Önce strateji briefini onaylayın/);
 await f.approve();
 assert.throws(()=>new CoachWeeklyPack(f.db,f.member('editor')).setEnabled({enabled:true}),error=>error.status===403);
 assert.throws(()=>pack.setEnabled({enabled:'yes'}),/Geçersiz/);
 const view=pack.setEnabled({enabled:true});assert.equal(view.enabled,true);assert.ok(view.enabledBy);
 assert.equal(pack.setEnabled({enabled:false}).enabled,false);
}));

test('a run drafts at most three of this week’s items with AI, one per channel first, and never twice',coachRun(async f=>{
 const {week}=await setup(f),pack=new CoachWeeklyPack(f.db,f.scope);pack.setEnabled({enabled:true});
 const before=f.aiUsage(),ai=generator(),result=await pack.run(ai);
 assert.equal(result.drafts,3);assert.equal(result.ai,3);assert.equal(result.note,null);assert.equal(f.aiUsage(),before+3);
 const saved=drafts(f);assert.equal(saved.length,3);assert.ok(saved.every(item=>item.starter===true&&item.coachWeek===week&&item.coachRef.startsWith('content:')));
 assert.deepEqual(saved.map(item=>item.platform).sort(),['facebook','instagram','linkedin'],'different channels before a second LinkedIn item; email is left out');
 assert.match(saved[0].content,/Taslak metin/);assert.match(ai.prompts[0],/not instructions/);assert.match(ai.prompts[0],/\{\{a customer example\}\}/);
 assert.equal((await pack.run(ai)).drafts,1,'the next run only drafts what is left');assert.equal(drafts(f).length,4);
 assert.equal(pack.view().readyThisWeek,4);
 assert.ok(teamAlerts(f.db,f.scope).some(alert=>alert.kind==='weekly_pack'&&alert.count===4),'the team is told the drafts are ready');
}));

test('without AI, after AI errors or a banned claim, items get the starter frame and the AI use is refunded',coachRun(async f=>{
 await setup(f);const pack=new CoachWeeklyPack(f.db,f.scope);pack.setEnabled({enabled:true});const before=f.aiUsage();
 const bad=generator(index=>index===1?{headline:'Garanti sonuç',content:'%100 garanti'}:{headline:'x',content:'y'.repeat(3000)});
 const result=await pack.run(bad);assert.equal(result.drafts,3);assert.equal(result.ai,0);assert.equal(result.note,'ai_failed');assert.equal(f.aiUsage(),before,'every failed call is refunded');
 assert.ok(drafts(f).every(item=>/\{\{/.test(item.content)),'frames carry a placeholder, so they cannot be published untouched');
 assert.throws(()=>parseWeeklyDraft(JSON.stringify({headline:'h',content:'x'.repeat(281)}),{id:'i',channel:'twitter',title:'t',angle:'a',plannedFor:'2026-11-06'}),/kanal sınırına/);
 assert.match(weeklyDraftPrompt({id:'i',channel:'seo',title:'t',angle:'a',plannedFor:'2026-11-06'},f.coach.approved().brief,{name:'P',website:'',brandVoice:''}),/blog article outline/);
}));

test('the worker prepares each enabled pack once a week, as the member who turned it on',coachRun(async f=>{
 const {week}=await setup(f);new CoachWeeklyPack(f.db,f.scope).setEnabled({enabled:true});
 const monday=new Date(`${week}T12:00:00Z`);
 const first=await deliverNextWeeklyPack(f.db,generator(),monday);assert.equal(first.drafts,3);assert.equal(first.week,week);
 assert.equal(await deliverNextWeeklyPack(f.db,generator(),monday),null,'once a week');
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_audit WHERE operation='coach.weekly_pack.run'").get().n,1);
 // Losing the right to write content stops the pack without drafting.
 f.db.prepare('UPDATE platform_coach_weekly_pack SET last_week=NULL').run();
 const editor=f.member('editor');f.db.prepare('UPDATE platform_coach_weekly_pack SET enabled_by=?').run(editor.subject);
 f.db.prepare("DELETE FROM platform_memberships WHERE user_id=?").run(editor.subject);
 const stopped=await deliverNextWeeklyPack(f.db,generator(),monday);
 assert.ok(stopped===null||stopped.drafts===0,'no drafts for a member who left');
}));
