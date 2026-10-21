const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {CoachAssignments}=load('coach-assignments.ts');
const {CoachContentPlan,coachMonthKey}=load('coach-content.ts');
const {digestMessage}=load('coach-digest.ts');
const {zonedDateKey,zonedShiftDays}=load('coach.ts');
const assignments=(f,scope=f.scope)=>new CoachAssignments(f.db,scope);

test('teammates with content rights assign owners and due dates; viewers and outsiders cannot',coachRun(async f=>{
  f.setGoals();const approved=await f.approve(),editor=f.member('editor'),viewer=f.member('viewer'),action=approved.actions.find(item=>item.kind==='plan'),today=zonedDateKey(new Date(),f.coach.timeZone());
  const team=assignments(f).read();assert.deepEqual(plain(team.members.map(item=>item.name).sort()),['alpha','coach-editor'],'viewers cannot be owners');
  assert.deepEqual(plain(assignments(f,viewer).read().members),[],'viewers get no picker');
  assert.throws(()=>assignments(f,viewer).assign({kind:'action',itemId:action.id,assigneeId:viewer.subject,expectedRevision:0}),error=>error.status===403);
  assert.throws(()=>assignments(f,editor).assign({kind:'action',itemId:action.id,assigneeId:viewer.subject,expectedRevision:0}),error=>error.status===403&&/içerik yazma/.test(error.message));
  assert.throws(()=>assignments(f,editor).assign({kind:'action',itemId:action.id,assigneeId:f.other.subject,expectedRevision:0}),error=>error.status===403,'people outside the project are rejected');
  for(const dueOn of ['2026-02-30','tomorrow',zonedShiftDays(today,400),zonedShiftDays(today,-40)])assert.throws(()=>assignments(f,editor).assign({kind:'action',itemId:action.id,assigneeId:editor.subject,dueOn,expectedRevision:0}),error=>error.status===400,dueOn);
  assert.throws(()=>assignments(f,editor).assign({kind:'action',itemId:'plan:missing',assigneeId:editor.subject,expectedRevision:0}),error=>error.status===404);
  const yesterday=zonedShiftDays(today,-1),mine=assignments(f,editor).assign({kind:'action',itemId:action.id,assigneeId:editor.subject,dueOn:yesterday,expectedRevision:0});
  assert.equal(mine.mine.length,1);assert.equal(mine.mine[0].overdue,true);assert.equal(mine.mine[0].assigneeName,'coach-editor');assert.equal(mine.mine[0].href,action.href);
  assert.equal(assignments(f).read().mine.length,0,'the owner sees it in the team list, not in their own');
  const listed=f.coach.read().actions.find(item=>item.id===action.id).assignment;assert.equal(listed.assigneeId,editor.subject);assert.equal(listed.overdue,true);assert.equal(listed.mine,false);
  assert.throws(()=>assignments(f).assign({kind:'action',itemId:action.id,assigneeId:f.scope.subject,expectedRevision:0}),error=>error.status===409,'stale revision');
  const moved=assignments(f).assign({kind:'action',itemId:action.id,assigneeId:f.scope.subject,dueOn:null,expectedRevision:1});assert.equal(moved.mine[0].revision,2);assert.equal(moved.mine[0].dueOn,null);
  f.coach.act({actionId:action.id,state:'done'});const done=assignments(f).read();assert.equal(done.mine.length,0,'done work leaves "assigned to me"');assert.equal(done.all[0].state,'done');assert.equal(done.all[0].overdue,false);
  assignments(f).assign({kind:'action',itemId:action.id,assigneeId:null,expectedRevision:2});assert.equal(assignments(f).read().all.length,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_audit WHERE operation IN ('coach.assign','coach.unassign')").get().n,3);
  assert.equal(assignments(f,f.other).read().all.length,0,'other projects see nothing');
}));
test('content plan items can be assigned; a draft opened from the item marks it done; inactive members drop out',coachRun(async f=>{
  await f.approve();const editor=f.member('editor'),plan=new CoachContentPlan(f.db,f.scope),month=coachMonthKey(new Date(),1),[item]=(await plan.generate({month,mode:'template'})).items;
  const assigned=assignments(f).assign({kind:'content',itemId:item.id,assigneeId:editor.subject,expectedRevision:0}).all[0];assert.equal(assigned.kind,'content');assert.equal(assigned.state,'open');
  assert.equal(plan.read(month).items.find(row=>row.id===item.id).assignment.assigneeId,editor.subject);
  const {ProjectMarketingStore}=load('marketing-store.ts');new ProjectMarketingStore(f.db,f.scope).saveContent({id:'hist_assign',platform:'linkedin',language:'en',content:'Draft',prompt:'',headline:'H',timestamp:Date.now(),coachRef:`content:${item.id}`},true);
  assert.equal(assignments(f).read().all[0].state,'done');
  f.db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(editor.subject);
  assert.ok(!assignments(f).read().members.some(member=>member.id===editor.subject),'inactive members cannot be picked');
  assert.throws(()=>assignments(f).assign({kind:'content',itemId:'content_missing',assigneeId:f.scope.subject,expectedRevision:0}),error=>error.status===404);
}));
test('the weekly email lists only the recipient’s own open assignments',()=>{
  const facts={from:'2026-10-12T00:00:00Z',to:'2026-10-18T00:00:00Z',measurements:[],lastMeasuredAt:null,connections:{ga4:false,searchConsole:false},actions:{done:0,skipped:0,open:2,doneTitles:[]},content:{drafts:0,draftsByChannel:{},campaigns:0,publications:0,planApproved:0},seo:{audits:0,briefsApproved:0},rose:[]};
  const message=digestMessage(facts,[],'en',{name:'Acme',timezone:'UTC'},'https://ryzevo.com',[{title:'Draft the first post',dueOn:'2026-10-16',overdue:true},{title:'Record a measurement',dueOn:null,overdue:false}]);
  assert.match(message.text,/Open work assigned to you\n- Draft the first post · due 16 Oct \(overdue\)\n- Record a measurement/);
  assert.doesNotMatch(digestMessage(facts,[],'tr',{name:'Acme',timezone:'UTC'},'https://ryzevo.com').text,/Size atanan/,'no section without assignments');
});
test('schema39 is additive and repeatable',coachRun(async f=>{
  await f.approve();const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'coach-assign-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeAssignmentSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,38);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,46);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_coach_assignments').get().n,0);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
