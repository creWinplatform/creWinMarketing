const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{ProjectOperations}=load('operations.ts');
const {GrowthCoach,normalizeCoachAnswers,normalizeCoachBrief,coachStarterBrief,parseCoachDraft,approvedCoachContext,coachPlanId,coachWeekKey}=load('coach.ts');
const {compassSiteReceipt}=load('guidance.ts');
const answers={offer:'Online bookkeeping software for small shops',customer:'Independent shop owners',market:'b2b',price:'high',sales:'sales',current:['website','linkedin'],hours:'2to5',skills:['writing'],obstacle:'start',success:'Ten qualified demo requests'};
const run=fn=>async()=>{
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
  const provision=username=>repo.provision('legacy-admin',{organizationName:username,projectName:username,website:'https://example.com',username,password:'fixture-password-123'}),a=provision('alpha'),b=provision('beta');
  const scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId},other={subject:b.userId,organizationId:b.organizationId,projectId:b.projectId};
  const member=role=>({...scope,subject:repo.addMember(scope.subject,a.organizationId,a.projectId,{username:`coach-${role}`,password:'fixture-password-123',role}).userId});
  const f={db,repo,a,scope,other,member,coach:new GrowthCoach(db,scope)};
  f.diagnose=(coach=f.coach,extra={})=>coach.diagnose({answers,language:'en',mode:'template',expectedRevision:coach.read().revision,...extra});
  f.approved=async()=>{const drafted=await f.diagnose();return f.coach.approve({brief:drafted.draft,expectedRevision:drafted.revision});};
  f.aiUsage=()=>db.prepare("SELECT COALESCE(SUM(count),0) n FROM platform_usage WHERE organization_id=? AND project_id=? AND resource='ai'").get(a.organizationId,a.projectId).n;
  try{await fn(f);}finally{db.close();}
};
const plain=value=>JSON.parse(JSON.stringify(value));
const aiBrief=brief=>JSON.stringify({icp:brief.icp,positioning:brief.positioning,channels:brief.channels,plan:brief.plan});

test('first read is side-effect free and has no plan',run(f=>{
  const before=f.db.totalChanges,snapshot=f.coach.read();
  assert.equal(snapshot.revision,0);assert.equal(snapshot.answers,null);assert.equal(snapshot.brief,null);assert.deepEqual(plain(snapshot.actions),[]);assert.equal(f.db.totalChanges,before);
}));
test('answers validation rejects malformed, foreign and contradictory values without writes',run(async f=>{
  for(const bad of [{offer:''},{offer:'x'.repeat(301)},{market:'enterprise'},{price:'cheap'},{current:[]},{current:['none','linkedin']},{skills:['writing','writing']},{hours:'always'},{obstacle:'money'},{customer:'bad\u0001value'},{success:42}])
    assert.throws(()=>normalizeCoachAnswers({...answers,...bad}),error=>error.status===400,JSON.stringify(bad));
  for(const input of [{mode:'auto'},{language:'de'},{expectedRevision:'0'}])await assert.rejects(f.diagnose(f.coach,input));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_growth_coach').get().n,0);
  assert.deepEqual(plain(normalizeCoachAnswers({...answers,extra:'ignored',role:'owner'})),answers);
}));
test('starter brief is qualitative, valid and within weekly time',run(()=>{
  for(const variant of [answers,{...answers,market:'b2c',sales:'local',skills:['design'],hours:'lt2',price:'low',obstacle:'measurement'},{...answers,market:'both',price:'high',sales:'sales',current:['none'],skills:['none'],hours:'gt10',obstacle:'conversion'}])for(const lang of ['tr','en']){
    const brief=coachStarterBrief(variant,lang,'Alpha');assert.equal(brief.language,lang);
    assert.ok(brief.channels.length>=2&&brief.channels.length<=3);assert.equal(brief.channels.length,variant.hours==='lt2'?2:3);
    assert.doesNotMatch(JSON.stringify(brief),/\d\s*%|guarantee|garanti|autonomous|otonom/i);
    assert.deepEqual(plain(normalizeCoachBrief(brief)),plain(brief));
    const budget={lt2:90,'2to5':180,'5to10':300,gt10:420}[variant.hours];
    for(const week of [1,2,3,4]){const items=brief.plan.filter(item=>item.week===week);assert.ok(items.length>=1);assert.ok(items.length===1||items.reduce((sum,item)=>sum+item.minutes,0)<=budget);}
  }
  assert.equal(coachStarterBrief(answers,'en','Alpha').channels[0].id,'linkedin');
  assert.ok(coachStarterBrief({...answers,market:'b2c',sales:'local',skills:['design']},'en','Alpha').channels.some(item=>item.id==='instagram'));
}));
test('brief validation enforces enums, limits and unique actions',run(()=>{
  const brief=coachStarterBrief(answers,'en','Alpha');
  for(const bad of [{channels:[]},{channels:[...brief.channels,{id:'tiktok',rationale:'x'}]},{channels:[brief.channels[0],brief.channels[0]]},{plan:[]},{plan:Array.from({length:17},(_,i)=>({...brief.plan[0],title:`Item ${i}`}))},{plan:[{...brief.plan[0],tool:'autopost'}]},{plan:[{...brief.plan[0],week:5}]},{plan:[{...brief.plan[0],minutes:2}]},{plan:[brief.plan[0],brief.plan[0]]},{language:'de'},{positioning:''},{icp:{summary:'ok',pains:[]}}])
    assert.throws(()=>normalizeCoachBrief({...brief,...bad}),error=>error.status===400,JSON.stringify(Object.keys(bad)));
  assert.equal(normalizeCoachBrief({...brief,channels:[brief.channels[0]]}).channels.length,1);
}));
test('AI output is parsed strictly; claims, prose and malformed JSON are rejected',run(()=>{
  const brief=coachStarterBrief(answers,'en','Alpha');
  assert.equal(parseCoachDraft('```json\n'+aiBrief(brief)+'\n```','en').plan.length,brief.plan.length);
  assert.equal(parseCoachDraft(JSON.stringify({...JSON.parse(aiBrief(brief)),plan:brief.plan.map(item=>({...item,minutes:9999.4}))}),'en').plan[0].minutes,480);
  assert.throws(()=>parseCoachDraft(JSON.stringify({...JSON.parse(aiBrief(brief)),positioning:'Grow revenue by 40% guaranteed'}),'en'),error=>error.status===422);
  assert.throws(()=>parseCoachDraft('Here is your plan!','en'),error=>error.status===502);
  assert.throws(()=>parseCoachDraft(JSON.stringify({...JSON.parse(aiBrief(brief)),channels:[brief.channels[0]]}),'en'),error=>error.status===502);
}));
test('template diagnosis saves answers and a draft without AI usage; revisions are optimistic',run(async f=>{
  const drafted=await f.diagnose();assert.equal(drafted.revision,2);assert.equal(drafted.draftSource,'template');assert.deepEqual(plain(drafted.answers),answers);assert.equal(drafted.brief,null);assert.equal(f.aiUsage(),0);
  await assert.rejects(f.coach.diagnose({answers,language:'en',mode:'template',expectedRevision:0}),error=>error.status===409);
  assert.throws(()=>f.coach.saveDraft({brief:drafted.draft,expectedRevision:1}),error=>error.status===409);
  const edited=f.coach.saveDraft({brief:{...drafted.draft,positioning:'Edited by the team'},expectedRevision:2});assert.equal(edited.draft.positioning,'Edited by the team');assert.equal(edited.revision,3);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_audit WHERE operation LIKE 'coach.%'").get().n,3);
}));
test('AI diagnosis reserves usage, completes on success and refunds on failure',run(async f=>{
  const brief=coachStarterBrief(answers,'en','Alpha');let prompt='';
  await assert.rejects(f.coach.diagnose({answers,language:'en',mode:'ai',expectedRevision:f.coach.read().revision}),error=>error.status===503);
  const ok=await f.coach.diagnose({answers,language:'en',mode:'ai',expectedRevision:f.coach.read().revision},async value=>{prompt=value;return aiBrief(brief);});
  assert.equal(ok.draftSource,'ai');assert.equal(f.aiUsage(),1);assert.match(prompt,/not instructions/);assert.match(prompt,/Independent shop owners/);assert.doesNotMatch(prompt,/fixture-password/);
  for(const generator of [async()=>{throw new Error('provider down');},async()=>'not json',async()=>aiBrief({...brief,positioning:'Double your sales, guaranteed'})])
    await assert.rejects(f.coach.diagnose({answers,language:'en',mode:'ai',expectedRevision:f.coach.read().revision},generator),error=>[422,502].includes(error.status));
  assert.equal(f.aiUsage(),1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_usage_reservations WHERE status='pending'").get()?.n||0,0);
}));
test('roles: viewer reads only, editor drafts and acts, only approvers approve',run(async f=>{
  const viewer=new GrowthCoach(f.db,f.member('viewer')),editor=new GrowthCoach(f.db,f.member('editor'));
  await assert.rejects(f.diagnose(viewer),error=>error.status===403);
  const drafted=await f.diagnose(editor);assert.equal(drafted.canApprove,false);assert.equal(drafted.canWrite,true);
  assert.throws(()=>editor.approve({brief:drafted.draft,expectedRevision:drafted.revision}),error=>error.status===403);
  assert.throws(()=>viewer.saveDraft({brief:drafted.draft,expectedRevision:drafted.revision}),error=>error.status===403);
  const approved=f.coach.approve({brief:drafted.draft,expectedRevision:drafted.revision});assert.ok(approved.approvedAt);assert.equal(approved.draft,null);
  const view=viewer.read();assert.equal(view.canWrite,false);assert.equal(view.actions.length,3);assert.ok(view.actions.every(item=>item.tool==='analytics'||!item.canAct));
  assert.throws(()=>viewer.act({actionId:view.actions[0].id,state:'done'}),error=>error.status===403);
  assert.throws(()=>viewer.schedule({actionId:view.actions[0].id}),error=>error.status===403);
  assert.equal(editor.act({actionId:view.actions[0].id,state:'done'}).resolved.length,1);
}));
test('scope: other projects, revoked members and Crewin pack are denied',run(async f=>{
  await f.approved();
  assert.throws(()=>new GrowthCoach(f.db,{...f.other,subject:f.scope.subject}).read(),error=>error.status===403);
  assert.equal(new GrowthCoach(f.db,f.other).read().brief,null);assert.equal(approvedCoachContext(f.db,f.other),null);
  assert.throws(()=>new GrowthCoach(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).read(),error=>error.status===403);
  f.db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(f.scope.subject);
  for(const action of [()=>f.coach.read(),()=>f.coach.saveDraft({brief:{},expectedRevision:3}),()=>f.coach.act({actionId:'x',state:'done'})])assert.throws(action,error=>error.status===403);
}));
test('approved brief becomes generation context only after approval',run(async f=>{
  const drafted=await f.diagnose();assert.equal(approvedCoachContext(f.db,f.scope),null);
  f.coach.approve({brief:drafted.draft,expectedRevision:drafted.revision});const context=approvedCoachContext(f.db,f.scope);
  assert.deepEqual(plain(Object.keys(context)),['audience','positioning','priorityChannels']);assert.equal(context.priorityChannels[0],'linkedin');assert.ok(!JSON.stringify(context).includes('plan'));
}));
test('weekly actions derive from project state and persist done/skipped',run(async f=>{
  const approved=await f.approved();assert.equal(approved.week,1);assert.equal(approved.actions.length,3);
  // No goal and no LinkedIn connection yet: setup actions come first; connections in the plan are not duplicated.
  assert.equal(approved.actions[0].id,'setup:goal');assert.equal(approved.actions[0].href,'/?tab=project');
  assert.ok(!approved.actions.some(item=>item.id==='setup:connect:linkedin'));
  const library=approved.actions.find(item=>item.tool==='library');if(library){assert.equal(library.prefill.channel,'linkedin');assert.ok(library.prefill.brief.length<=3000);}
  const first=approved.actions[0],second=approved.actions[1];
  let next=f.coach.act({actionId:first.id,state:'done'});assert.ok(!next.actions.some(item=>item.id===first.id));assert.equal(next.resolved[0].state,'done');
  next=f.coach.act({actionId:second.id,state:'skipped'});assert.ok(!next.actions.some(item=>item.id===second.id));assert.equal(next.resolved.length,2);
  f.db.prepare('UPDATE platform_growth_coach_actions SET week=? WHERE action_id=?').run('2000-01-03',second.id);
  next=f.coach.read();assert.ok(next.actions.some(item=>item.id===second.id),'skipped actions return the next week');assert.ok(!next.actions.some(item=>item.id===first.id),'done actions stay done');
  next=f.coach.act({actionId:first.id,state:'open'});assert.ok(next.actions.some(item=>item.id===first.id));
  assert.throws(()=>f.coach.act({actionId:'plan:forged',state:'done'}),error=>error.status===404);
  assert.throws(()=>f.coach.act({actionId:first.id,state:'completed'}),error=>error.status===400);
}));
test('evidence resolves setup actions: goals, connections and audit findings',run(async f=>{
  const drafted=await f.diagnose(),brief={...drafted.draft,channels:[{id:'seo',rationale:'Search'},{id:'instagram',rationale:'Visual'}],plan:drafted.draft.plan.filter(item=>!['seo','connections'].includes(item.tool))};
  let snapshot=f.coach.approve({brief,expectedRevision:drafted.revision});const ids=()=>snapshot.actions.map(item=>item.id);
  assert.deepEqual(plain(ids().slice(0,2)),['setup:goal','setup:connect:instagram']);assert.equal(snapshot.actions[2].kind,'plan','setup prerequisites never crowd out the plan');
  const repo=f.repo,project=repo.workspace(f.scope.subject,f.scope.organizationId,f.scope.projectId).project;
  repo.updateProject(f.scope.subject,f.scope.organizationId,f.scope.projectId,{name:project.name,website:project.website,timezone:project.timezone,language:'en',brandVoice:'Clear',goals:[{id:'demo',label:{tr:'Talep',en:'Demand'},audience:{tr:'Kitle',en:'Audience'},stages:[{tr:'Ziyaret',en:'Visit'},{tr:'Talep',en:'Request'}]}]});
  snapshot=f.coach.read();assert.deepEqual(plain(ids().slice(0,2)),['setup:connect:instagram','setup:audit']);
  const at=new Date().toISOString();f.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(f.scope.subject,f.scope.organizationId,f.scope.projectId,compassSiteReceipt('https://example.com'),at);
  snapshot=f.coach.read();assert.ok(!ids().includes('setup:goal'));assert.ok(!ids().includes('setup:audit'));assert.ok(ids().includes('setup:audit-task'));
  new ProjectOperations(f.db,f.scope).saveTask({title:'Fix missing title tag',dueAt:new Date(Date.now()+86400000).toISOString(),note:'https://example.com/'});
  snapshot=f.coach.read();assert.ok(!ids().includes('setup:audit-task'));
}));
test('calendar handoff is explicit, deduplicated and completing the task marks the action done',run(async f=>{
  const approved=await f.approved(),action=approved.actions.find(item=>item.kind==='plan');
  const first=f.coach.schedule({actionId:action.id});assert.equal(first.created,true);assert.equal(first.task.status,'planned');assert.match(first.task.note,new RegExp(`^coach:${action.id}`));assert.doesNotMatch(first.task.note,/password|token/i);
  const again=f.coach.schedule({actionId:action.id});assert.equal(again.created,false);assert.equal(again.task.id,first.task.id);
  assert.equal(new ProjectOperations(f.db,f.scope).tasks().filter(task=>task.note.startsWith('coach:')).length,1);
  assert.equal(again.snapshot.actions.find(item=>item.id===action.id).taskId,first.task.id);
  new ProjectOperations(f.db,f.scope).saveTask({...first.task,status:'completed'});
  assert.ok(!f.coach.read().actions.some(item=>item.id===action.id));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_jobs').get().n,0,'no send/publish jobs are created');
}));
test('week keys and local times follow the project time zone',run(()=>{
  const {zonedDateKey,zonedInstant}=load('coach.ts');
  assert.equal(coachWeekKey(new Date('2026-10-25T22:30:00Z'),'UTC'),'2026-10-19');assert.equal(coachWeekKey(new Date('2026-10-25T22:30:00Z'),'Europe/Istanbul'),'2026-10-26');
  assert.equal(zonedDateKey(new Date('2026-10-25T22:30:00Z'),'Europe/Istanbul'),'2026-10-26');assert.equal(zonedDateKey(new Date('2026-10-25T22:30:00Z'),'Not/AZone'),'2026-10-25');
  assert.equal(zonedInstant('2026-11-02',9,'Europe/Istanbul'),'2026-11-02T06:00:00.000Z');assert.equal(zonedInstant('2026-03-08',9,'America/New_York'),'2026-03-08T13:00:00.000Z','DST start day');assert.equal(zonedInstant('2026-11-01',9,'America/New_York'),'2026-11-01T14:00:00.000Z','DST end day');
  const {zonedDayDiff}=load('coach.ts');assert.equal(zonedDayDiff('2026-10-25T20:00:00Z',new Date('2026-10-25T22:30:00Z'),'UTC'),0);assert.equal(zonedDayDiff('2026-10-25T20:00:00Z',new Date('2026-10-25T22:30:00Z'),'Europe/Istanbul'),1,'Sunday 22:30 UTC is already Monday in Istanbul');assert.equal(zonedInstant('2026-07-01',9,'Europe/London'),'2026-07-01T08:00:00.000Z');assert.equal(zonedInstant('2026-01-15',9,'America/New_York'),'2026-01-15T14:00:00.000Z');
}));
test('plan ids and week keys are stable',run(()=>{
  const item={week:1,title:'Draft',tool:'library'};assert.equal(coachPlanId(item),coachPlanId({...item}));assert.notEqual(coachPlanId(item),coachPlanId({...item,week:2}));
  assert.equal(coachWeekKey(new Date('2026-10-21T10:00:00Z')),'2026-10-19');assert.equal(coachWeekKey(new Date('2026-10-25T23:00:00Z')),'2026-10-19');assert.equal(coachWeekKey(new Date('2026-10-26T00:00:00Z')),'2026-10-26');
}));
test('schema31 is additive and coach data survives reopening',run(async f=>{
  await f.approved();const fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'coach-migration-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,51);assert.ok(new GrowthCoach(db,f.scope).read().brief);db.close();
  db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeCoachSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,30);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,51);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_growth_coach').get().n,0);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
