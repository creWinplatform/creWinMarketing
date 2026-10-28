const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs');
const {load}=require('./platform-loader.cjs');
const {ProjectAutomations,evaluateDueAutomations}=load('automations.ts');
const DAY=86400000;
const plain=value=>JSON.parse(JSON.stringify(value));
const automations=(f,scope=f.scope)=>new ProjectAutomations(f.db,scope,KEY);
const segmentRule=(f,extra={})=>({name:'Finish your profile',trigger:{kind:'segment',segmentId:f.segment.id,segmentVersion:1},waitDays:0,exitEvent:null,exitOnLeave:false,campaignId:f.campaign.id,capDays:7,...extra});
const create=(f,extra,scope=f.scope)=>{const snapshot=automations(f,scope).save(segmentRule(f,extra));return snapshot.automations.at(-1);};
const activate=(f,item)=>automations(f).setState({id:item.id,state:'active',expectedRevision:item.revision}).automations.find(row=>row.id===item.id);
const event=(f,entityId,eventName,offsetMs=0)=>f.db.prepare("INSERT INTO platform_product_events(connection_id,event_id,version,organization_id,project_id,entity_id,event_name,attributes_json,consent_json,occurred_at,received_at) VALUES(?,?,1,?,?,?,?,'{}','{}',?,?)").run(f.source.id,`ev-${Math.random()}`,f.scope.organizationId,f.scope.projectId,entityId,eventName,new Date(Date.now()+offsetMs).toISOString(),new Date(Date.now()+offsetMs).toISOString());
const states=(f,id)=>Object.fromEntries(f.db.prepare('SELECT entity_id,state,reason FROM platform_automation_enrollments WHERE automation_id=? ORDER BY entity_id').all(id).map(row=>[row.entity_id,row.reason?`${row.state}:${row.reason}`:row.state]));

test('rules use this project’s segment, source and email campaign; activation needs the approval right',()=>{
 const f=fixture();try{
  const editor={...f.scope,subject:f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'editor',password:'fixture-password-123',role:'editor'}).userId};
  for(const bad of [{waitDays:31},{capDays:0},{name:''},{exitEvent:'bad event'},{trigger:{kind:'segment',segmentId:'missing',segmentVersion:1}},{trigger:{kind:'event',sourceId:f.source.id,eventName:'1bad'}},{campaignId:'missing'}])assert.throws(()=>automations(f).save(segmentRule(f,bad)),bad.name===''?/1–80/:undefined,JSON.stringify(bad));
  const draft=create(f,{},editor);assert.equal(draft.state,'draft');assert.equal(draft.sourceId,f.source.id);
  assert.throws(()=>automations(f,editor).setState({id:draft.id,state:'active',expectedRevision:draft.revision}),error=>error.status===403);
  const active=activate(f,draft);assert.equal(active.state,'active');
  assert.throws(()=>automations(f).save({...segmentRule(f),id:active.id,expectedRevision:active.revision}),error=>error.status===409,'pause before editing');
  const paused=automations(f,editor).setState({id:active.id,state:'paused',expectedRevision:active.revision}).automations[0];assert.equal(paused.state,'paused','any writer can pause');
  assert.equal(automations(f,f.other).read().automations.length,0,'other projects see nothing');
  const event=automations(f).save(segmentRule(f,{trigger:{kind:'event',sourceId:f.source.id,eventName:'profile.updated'},exitOnLeave:true})).automations.at(-1);assert.equal(event.exitOnLeave,false,'leaving a segment only applies to segment triggers');
 }finally{f.db.close();}
});
test('contacts enroll once, wait, and exit on the goal event or when they leave the segment',()=>{
 const f=fixture();try{
  const rule=activate(f,create(f,{waitDays:2,exitEvent:'goal.done',exitOnLeave:true}));
  let result=automations(f).evaluate({id:rule.id});assert.equal(result.counts.entered,7);assert.equal(result.counts.ready,0,'everyone waits two days');
  assert.equal(automations(f).evaluate({id:rule.id}).counts.entered,0,'one enrollment per contact per rule');
  event(f,'private-1','goal.done',1000);
  f.db.prepare("UPDATE platform_product_records SET attributes_json=? WHERE external_id='private-2'").run(JSON.stringify({email:'pilot2@example.com',completion:90}));
  result=automations(f).evaluate({id:rule.id},new Date(Date.now()+3*DAY));
  const now=states(f,rule.id);assert.equal(now['private-1'],'exited:goal_reached');assert.equal(now['private-2'],'exited:left_segment');assert.equal(result.counts.ready,5);
  const view=automations(f).read().automations[0];assert.deepEqual(plain(view.counts),{waiting:0,ready:5,sent:0,exited:2});assert.equal(view.reasons.goal_reached,1);assert.equal(view.runs[0].kind,'evaluate');
 }finally{f.db.close();}
});
test('event triggers enroll the contacts the event happened to; the frequency cap spans all rules',()=>{
 const f=fixture();try{
  const rule=activate(f,create(f,{trigger:{kind:'event',sourceId:f.source.id,eventName:'trial.started'},capDays:10}));
  event(f,'private-3','trial.started',1000);event(f,'private-4','trial.started',1000);
  // private-4 was emailed by another rule three days ago: it waits until the cap has passed.
  const other=create(f,{name:'Other rule'});f.db.prepare("INSERT INTO platform_automation_enrollments(automation_id,organization_id,project_id,source_id,entity_id,entered_at,due_at,state,updated_at) VALUES(?,?,?,?,'private-4',?,?,'sent',?)").run(other.id,f.scope.organizationId,f.scope.projectId,f.source.id,new Date(Date.now()-3*DAY).toISOString(),new Date(Date.now()-3*DAY).toISOString(),new Date(Date.now()-3*DAY).toISOString());
  const result=automations(f).evaluate({id:rule.id},new Date(Date.now()+5000));
  assert.equal(result.counts.entered,2);assert.equal(result.counts.ready,1);assert.equal(result.counts.deferred,1);
  const capped=f.db.prepare("SELECT due_at,reason FROM platform_automation_enrollments WHERE automation_id=? AND entity_id='private-4'").get(rule.id);assert.equal(capped.reason,'frequency_cap');assert.ok(Date.parse(capped.due_at)>Date.now()+6*DAY);
  assert.equal(automations(f).evaluate({id:rule.id},new Date(Date.now()+6000)).counts.entered,0,'events already seen are not counted again');
 }finally{f.db.close();}
});
test('approval goes through the email pilot gates and only to ready contacts; nothing is sent without SES',()=>{
 const f=fixture();try{
  f.approve();const rule=activate(f,create(f));automations(f).evaluate({id:rule.id});
  // Only two contacts stay ready; the rest have already left.
  f.db.prepare("UPDATE platform_automation_enrollments SET state='exited',reason='left_segment' WHERE automation_id=? AND entity_id NOT IN ('private-0','private-5')").run(rule.id);
  const editor={...f.scope,subject:f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'editor',password:'fixture-password-123',role:'editor'}).userId};
  assert.throws(()=>automations(f,editor).approve({id:rule.id,mode:'rehearsal'}),error=>error.status===403);
  const rehearsal=automations(f).approve({id:rule.id,mode:'rehearsal'});
  assert.equal(rehearsal.job.mode,'rehearsal');assert.equal(rehearsal.job.total,2,'the pilot is narrowed to the ready contacts');assert.equal(rehearsal.counts.rehearsed,2);
  assert.equal(states(f,rule.id)['private-0'],'ready','a rehearsal sends nothing and keeps contacts ready');
  f.queue.cancel(rehearsal.job.id);
  const before=JSON.stringify(states(f,rule.id));
  assert.throws(()=>automations(f).approve({id:rule.id,mode:'send',sendAcknowledged:true}),error=>error.status===409,'real sends need SES and the deployment switch');
  assert.equal(JSON.stringify(states(f,rule.id)),before,'a refused send changes nothing');
  // Consent withdrawn before the next approval: that contact is no longer part of the pilot.
  const contact=f.recipients.list(f.source.id).contacts.find(item=>item.maskedId==='...te-0');
  f.recipients.review({sourceId:f.source.id,contactKey:contact.key,expectedDecisionId:contact.decisionId,decision:'withdrawn',evidenceRef:'qa/withdrawn',recordedAt:new Date().toISOString(),note:'Disposable fixture.',acknowledged:true});
  const second=automations(f).approve({id:rule.id,mode:'rehearsal'});assert.equal(second.job.total,1,'withdrawn consent is excluded by the existing recipient checks');
  assert.equal(automations(f).read().automations[0].runs[0].mode,'rehearsal');
 }finally{f.db.close();}
});
test('the worker keeps active rules current and pauses them when the activator loses the right',()=>{
 const f=fixture();try{
  const admin={...f.scope,subject:f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'second-admin',password:'fixture-password-123',role:'admin'}).userId};
  const item=automations(f,admin).save(segmentRule(f)).automations[0];automations(f,admin).setState({id:item.id,state:'active',expectedRevision:item.revision});
  assert.equal(evaluateDueAutomations(f.db,KEY),1);assert.equal(automations(f).read().automations[0].counts.ready,7);
  assert.equal(evaluateDueAutomations(f.db,KEY),0,'evaluated at most every six hours');
  f.db.prepare("UPDATE platform_memberships SET role='viewer' WHERE user_id=?").run(admin.subject);f.db.prepare('UPDATE platform_automations SET last_evaluated_at=NULL').run();
  evaluateDueAutomations(f.db,KEY);assert.equal(automations(f).read().automations[0].state,'paused');
 }finally{f.db.close();}
});
test('schema41 is additive and repeatable',async()=>{
 const f=fixture();try{
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'automation-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeAutomationSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,40);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,64);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_automations').get().n,0);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
 }finally{f.db.close();}
});
