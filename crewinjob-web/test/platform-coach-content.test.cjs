const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {CoachContentPlan,coachMonthKey,coachPlanDates,coachStarterContent}=load('coach-content.ts');
const {ProjectOperations}=load('operations.ts');
const plan=f=>new CoachContentPlan(f.db,f.scope);
const month=coachMonthKey(),next=coachMonthKey(new Date(),1);
const aiItems=(brief,overrides={})=>JSON.stringify({items:brief.channels.map((channel,i)=>({theme:'Questions',title:`Idea ${i}`,angle:'Answer a real customer question.',channel:channel.id,goalId:'demo',date:`${next}-1${i}`,...overrides}))});

test('content plan needs an approved brief; reads are side-effect free',coachRun(async f=>{
  const before=f.db.totalChanges,snapshot=plan(f).read();assert.equal(snapshot.hasBrief,false);assert.equal(snapshot.items.length,0);assert.equal(f.db.totalChanges,before);
  await assert.rejects(plan(f).generate({month,mode:'template'}),error=>error.status===404);
  await f.coach.diagnose({answers:f.answers,language:'en',mode:'template',expectedRevision:0});
  await assert.rejects(plan(f).generate({month,mode:'template'}),error=>error.status===404,'a pending draft is not an approved brief');
}));
test('starter plan follows the brief channels, weekly time and the month',coachRun(async f=>{
  f.setGoals();const approved=await f.approve();
  const snapshot=await plan(f).generate({month:next,mode:'template'});
  assert.equal(snapshot.items.length,8);assert.equal(f.aiUsage(),0);
  assert.deepEqual(plain([...new Set(snapshot.items.map(item=>item.channel))]).sort(),plain(approved.brief.channels.map(item=>item.id)).sort());
  for(const item of snapshot.items){assert.ok(item.plannedFor.startsWith(next+'-'));assert.ok([2,4].includes(new Date(item.plannedFor+'T00:00:00Z').getUTCDay()));assert.equal(item.state,'suggested');assert.equal(item.source,'template');assert.equal(item.goalId,'demo');assert.equal(item.prefill,null);}
  assert.doesNotMatch(JSON.stringify(snapshot.items),/\d\s*%|guarantee|autonomous/i);
  assert.equal(coachStarterContent(approved.brief,{...f.answers,hours:'lt2'},next,null).length,4);
  assert.equal(coachStarterContent(approved.brief,{...f.answers,hours:'gt10'},next,null).length,16);
  for(const bad of ['2020-01',coachMonthKey(new Date(),3),'next'])await assert.rejects(plan(f).generate({month:bad,mode:'template'}),error=>error.status===400);
  assert.ok(coachPlanDates(month,5,new Date()).every(date=>date.startsWith(month)));
}));
test('items are approved one by one; edits need re-approval; regeneration keeps decisions',coachRun(async f=>{
  await f.approve();let snapshot=await plan(f).generate({month:next,mode:'template'});const [first,second,third]=snapshot.items;
  snapshot=plan(f).decide({id:first.id,expectedRevision:first.revision,decision:'approve'});const approved=snapshot.items.find(item=>item.id===first.id);
  assert.equal(approved.state,'approved');assert.ok(approved.approvedAt);assert.equal(approved.prefill.channel,first.channel==='seo'?'blog':first.channel);assert.ok(approved.prefill.brief.includes(first.angle));
  assert.throws(()=>plan(f).decide({id:first.id,expectedRevision:first.revision,decision:'dismiss'}),error=>error.status===409);
  plan(f).decide({id:second.id,expectedRevision:second.revision,decision:'dismiss'});
  snapshot=plan(f).update({id:third.id,expectedRevision:third.revision,channel:'email',theme:'Team',title:'Edited by us',angle:'Our own angle.',goalId:null,plannedFor:`${next}-03`});
  const edited=snapshot.items.find(item=>item.id===third.id);assert.equal(edited.source,'human');assert.equal(edited.title,'Edited by us');
  const reapproved=plan(f).decide({id:third.id,expectedRevision:edited.revision,decision:'approve'}).items.find(item=>item.id===third.id);
  const back=plan(f).update({id:third.id,expectedRevision:reapproved.revision,channel:'email',theme:'Team',title:'Edited again',angle:'Changed.',goalId:null,plannedFor:`${next}-04`}).items.find(item=>item.id===third.id);
  assert.equal(back.state,'suggested','a changed approved item needs approval again');
  snapshot=await plan(f).generate({month:next,mode:'template'});
  for(const id of [first.id,second.id,third.id])assert.ok(snapshot.items.some(item=>item.id===id),'decided and hand-edited items survive regeneration');
  for(const bad of [{plannedFor:'1999-01-05'},{plannedFor:`${next}-40`},{channel:'tiktok'},{goalId:'foreign'},{title:''},{angle:'x'.repeat(401)}])assert.throws(()=>plan(f).add({month:next,channel:'linkedin',theme:'T',title:'Title',angle:'Angle',goalId:null,plannedFor:`${next}-05`,...bad}),JSON.stringify(bad));
  assert.ok(plan(f).add({month:next,channel:'linkedin',theme:'T',title:'Hand-written',angle:'Angle',goalId:null,plannedFor:`${next}-05`}).items.some(item=>item.source==='human'&&item.title==='Hand-written'));
}));
test('calendar handoff needs approval, is deduplicated and sends nothing',coachRun(async f=>{
  await f.approve();const [item]=(await plan(f).generate({month:next,mode:'template'})).items;
  assert.throws(()=>plan(f).schedule({id:item.id}),error=>error.status===409);
  plan(f).decide({id:item.id,expectedRevision:item.revision,decision:'approve'});
  const first=plan(f).schedule({id:item.id});assert.equal(first.created,true);assert.equal(first.task.dueAt,`${item.plannedFor}T06:00:00.000Z`,'09:00 in the project time zone (Europe/Istanbul)');assert.match(first.task.note,new RegExp(`^coach-content:${item.id}`));
  const again=plan(f).schedule({id:item.id});assert.equal(again.created,false);assert.equal(again.task.id,first.task.id);assert.equal(again.snapshot.items.find(value=>value.id===item.id).taskId,first.task.id);
  assert.equal(new ProjectOperations(f.db,f.scope).tasks().filter(task=>task.note.startsWith('coach-content:')).length,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_jobs').get().n,0);
}));
test('AI suggestions reserve usage, validate strictly and refund on failure',coachRun(async f=>{
  f.setGoals();const {brief}=await f.approve();let prompt='';
  await assert.rejects(plan(f).generate({month:next,mode:'ai'}),error=>error.status===503);
  const ok=await plan(f).generate({month:next,mode:'ai'},async value=>{prompt=value;return aiItems(brief);});
  assert.equal(ok.items.length,brief.channels.length);assert.ok(ok.items.every(item=>item.source==='ai'));assert.equal(f.aiUsage(),1);assert.match(prompt,/not instructions/);assert.match(prompt,new RegExp(next));
  for(const output of ['no json',aiItems(brief,{channel:'tiktok'}),aiItems(brief,{date:'1999-01-10'}),aiItems(brief,{goalId:'foreign'}),JSON.stringify({items:[]}),aiItems(brief,{angle:'Grows sales 30% guaranteed'})])
    await assert.rejects(plan(f).generate({month:next,mode:'ai'},async()=>output),error=>[422,502].includes(error.status),output.slice(0,60));
  await assert.rejects(plan(f).generate({month:next,mode:'ai'},async()=>{throw new Error('down');}),error=>error.status===502);
  assert.equal(f.aiUsage(),1);assert.equal(f.reserved(),0);assert.equal(plan(f).read(next).items.length,brief.channels.length,'failed calls leave the plan unchanged');
}));
test('roles and scope: viewers read only; items never cross projects',coachRun(async f=>{
  await f.approve();const [item]=(await plan(f).generate({month:next,mode:'template'})).items;
  const viewer=new CoachContentPlan(f.db,f.member('viewer')),editor=new CoachContentPlan(f.db,f.member('editor'));
  assert.equal(viewer.read(next).items.length,8);assert.equal(viewer.read(next).canWrite,false);
  for(const action of [()=>viewer.decide({id:item.id,expectedRevision:1,decision:'approve'}),()=>viewer.schedule({id:item.id}),()=>viewer.add({month:next,channel:'linkedin',theme:'T',title:'T',angle:'A',plannedFor:`${next}-05`})])assert.throws(action,error=>error.status===403);
  await assert.rejects(viewer.generate({month:next,mode:'template'}),error=>error.status===403);
  assert.equal(editor.decide({id:item.id,expectedRevision:1,decision:'approve'}).items.find(value=>value.id===item.id).state,'approved');
  const foreign=new CoachContentPlan(f.db,f.other);assert.equal(foreign.read(next).items.length,0);
  assert.throws(()=>foreign.decide({id:item.id,expectedRevision:2,decision:'dismiss'}),error=>error.status===404);
  assert.throws(()=>new CoachContentPlan(f.db,{...f.other,subject:f.scope.subject}).read(),error=>error.status===403);
  assert.doesNotThrow(()=>new CoachContentPlan(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).read(),'the Crewin workspace has this Ryzevo feature (lib/platform/ryzevo-features.ts)');
}));
test('months and "today" follow the project time zone',coachRun(async f=>{
  await f.approve();const late=new Date('2026-10-31T22:30:00Z');
  assert.equal(coachMonthKey(late,0,'UTC'),'2026-10');assert.equal(coachMonthKey(late,0,'Europe/Istanbul'),'2026-11');assert.equal(coachMonthKey(late,1,'Europe/Istanbul'),'2026-12');
  assert.ok(coachPlanDates('2026-11',3,late,'Europe/Istanbul').every(date=>date>='2026-11-03'));
  const snapshot=plan(f).read();assert.equal(snapshot.today.length,10);assert.equal(snapshot.months[0],coachMonthKey(new Date(),0,'Europe/Istanbul'));
}));
test('schema32 is additive and repeatable',coachRun(async f=>{
  await f.approve();await plan(f).generate({month:next,mode:'template'});
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'coach-content-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeContentPlanSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,31);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_coach_content_items').get().n,0);assert.ok(db.prepare('SELECT brief_json FROM platform_growth_coach').get().brief_json);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
