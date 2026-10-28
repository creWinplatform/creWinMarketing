const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
// "What would you like to do?": every job's steps come from the project's records for one member.
const {jobGuide}=load('job-guide.ts');
const ALL=['social_post','inbox','google','ai_answers','email','ads','results','team','repurpose'];
const job=(view,id)=>view.jobs.find(item=>item.id===id);
const states=item=>plain(item.steps.map(step=>[step.id,step.state]));
const save=(f,patch={})=>f.db.prepare('INSERT INTO platform_content_history VALUES(?,?,?,?,?)').run(patch.id||`h-${Math.random()}`,f.scope.organizationId,f.scope.projectId,JSON.stringify({platform:'instagram',language:'tr',content:'Kahve',prompt:'',timestamp:Date.now(),...patch}),new Date().toISOString());

test('the owner sees every job, each with real steps; none is dropped by a failing query',coachRun(async f=>{
  const view=jobGuide(f.db,f.scope);
  assert.deepEqual(plain(view.jobs.map(item=>item.id)).sort(),[...ALL].sort(),'a job whose records cannot be read would disappear silently');
  for(const item of view.jobs){assert.ok(item.steps.length>=2,item.id);assert.equal(item.total,item.steps.length);assert.equal(item.done,item.steps.filter(step=>step.state==='done').length);
    assert.equal(item.nextStepId,item.steps.find(step=>step.state!=='done')?.id||null);assert.ok(item.title.tr&&item.title.en&&item.outcome.tr);
    for(const step of item.steps)assert.match(step.href,/^\/\?tab=/,`${item.id}/${step.id} links to a screen`);}
  assert.deepEqual(states(job(view,'google')).slice(0,2),[['website','done'],['scan','todo']],'the website is set; the scan is next');
  assert.equal(job(view,'google').nextStepId,'scan');
}));

test('steps tick only from records, in order, and a later step can be done before an earlier one',coachRun(async f=>{
  let view=jobGuide(f.db,f.scope);assert.deepEqual(states(job(view,'repurpose')),[['draft','todo'],['adapt','todo']]);
  save(f,{starter:true});view=jobGuide(f.db,f.scope);assert.equal(job(view,'repurpose').steps[0].state,'todo','a starter draft the team has not rewritten does not count');
  save(f,{id:'mine'});save(f,{platform:'facebook',repurposedFrom:'mine'});view=jobGuide(f.db,f.scope);
  assert.deepEqual(states(job(view,'repurpose')),[['draft','done'],['adapt','done']]);assert.equal(job(view,'repurpose').complete,true);
  assert.equal(job(view,'social_post').steps.find(step=>step.id==='draft').state,'done','the same draft counts for publishing');
  assert.ok(view.jobs.indexOf(job(view,'repurpose'))>view.jobs.indexOf(job(view,'google')),'finished jobs go last');
  const now=new Date().toISOString();
  f.db.prepare("INSERT INTO platform_seo_scans(id,organization_id,project_id,origin,source,discovered,state,started_by,started_at,updated_at,finished_at) VALUES('s1',?,?,'https://example.com','sitemap',1,'completed',?,?,?,?)").run(f.scope.organizationId,f.scope.projectId,f.scope.subject,now,now,now);
  f.db.prepare("INSERT INTO platform_seo_findings(id,organization_id,project_id,finding_key,url,category,title,priority,detail,recommendation,evidence,state,first_seen_at,last_seen_at,last_scan_id,revision) VALUES('f1',?,?,'k1','https://example.com','AI arama (GEO)','llms.txt bulunamadı','low','d','r','e','open',?,?,'s1',1)").run(f.scope.organizationId,f.scope.projectId,now,now);
  view=jobGuide(f.db,f.scope);
  assert.deepEqual(states(job(view,'ai_answers')).slice(0,3),[['scan','done'],['access','done'],['llms','todo']]);
  assert.deepEqual(plain(job(view,'google').badge),{count:1,label:{tr:'açık SEO bulgusu',en:'open SEO finding(s)'}});
}));

test('a step the member cannot do names who can; jobs the member cannot move are hidden',coachRun(async f=>{
  const editor=f.member('editor'),viewer=f.member('viewer');
  const view=jobGuide(f.db,editor),connect=job(view,'social_post').steps.find(step=>step.id==='connect');
  assert.equal(connect.state,'blocked');assert.equal(connect.canAct,false);assert.match(connect.reason.tr,/proje sahibi veya yöneticisi/);
  assert.equal(job(view,'social_post').steps.find(step=>step.id==='draft').canAct,true,'editors still write the post');
  assert.equal(job(view,'team')?.complete??true,true,'an editor cannot invite: the team job is offered only as already done');
  const read=jobGuide(f.db,viewer);assert.ok(read.jobs.every(item=>item.complete||item.steps.some(step=>step.state!=='done'&&step.canAct)));
  assert.ok(!read.jobs.some(item=>item.id==='social_post'),'a viewer cannot move publishing forward');
  assert.throws(()=>jobGuide(f.db,{...f.other,subject:f.scope.subject}),error=>error.status===403,'no guide for a project the member is not in');
}));

test('server switches that only Ryzevo can turn on are named as such, not as missing rights',coachRun(async f=>{
  const saved={...process.env};delete process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED;delete process.env.PLATFORM_ADS_ENABLED;delete process.env.PLATFORM_GEMINI_API_KEY;
  try{const view=jobGuide(f.db,f.scope);
    for(const [id,stepId] of [['social_post','publish'],['ads','start'],['ai_answers','ask']]){const step=job(view,id).steps.find(item=>item.id===stepId);assert.equal(step.state,'blocked');assert.equal(step.canAct,false);assert.match(step.reason.tr,/Ryzevo yöneticisi/,`${id}/${stepId}`);}
    process.env.PLATFORM_ADS_ENABLED='1';assert.equal(job(jobGuide(f.db,f.scope),'ads').steps.find(item=>item.id==='start').state,'todo');
  }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
}));

test('the member’s own path and waiting work come first',coachRun(async f=>{
  const order=view=>plain(view.jobs.map(item=>item.id));
  f.db.prepare('INSERT INTO platform_compass_preferences(user_id,organization_id,project_id,revision,deferred,preferences_json,created_at,updated_at) VALUES(?,?,?,1,0,?,?,?)').run(f.scope.subject,f.scope.organizationId,f.scope.projectId,JSON.stringify({intent:'seo',experience:'guided',goalId:'',campaignId:'',appId:'',channels:[],obstacles:{}}),new Date().toISOString(),new Date().toISOString());
  let view=jobGuide(f.db,f.scope);assert.deepEqual(order(view).slice(0,2),['google','ai_answers'],'an SEO path puts search first');assert.equal(view.intent,'seo');
  f.db.prepare("UPDATE platform_compass_preferences SET preferences_json=json_set(preferences_json,'$.intent','retention')").run();
  view=jobGuide(f.db,f.scope);assert.equal(order(view)[0],'email');
  const admin=jobGuide(f.db,f.member('admin'));assert.equal(admin.intent,null,'another member keeps their own path');assert.notEqual(order(admin)[0],'email');
  assert.equal(order(admin)[0],'google','with no path, a job already under way comes first');
}));

test('mobile growth is listed only for projects that need it, and stays enabled for the others',coachRun(async f=>{
  const ws=()=>f.repo.workspace(f.scope.subject,f.scope.organizationId,f.scope.projectId);
  assert.deepEqual(plain(ws().hiddenNav),['mobile'],'a project without an app or a mobile goal does not list it');
  assert.ok(ws().modules.some(item=>item.id==='mobile'),'it stays enabled: links and search still reach it');
  f.db.prepare("INSERT INTO platform_compass_preferences(user_id,organization_id,project_id,revision,deferred,preferences_json,created_at,updated_at) VALUES(?,?,?,1,0,?,?,?)").run(f.scope.subject,f.scope.organizationId,f.scope.projectId,JSON.stringify({intent:'mobile'}),new Date().toISOString(),new Date().toISOString());
  assert.equal(ws().hiddenNav,undefined,'a mobile path lists it');
}));
