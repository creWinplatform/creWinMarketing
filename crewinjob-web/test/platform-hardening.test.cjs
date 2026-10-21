const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {ProjectAds}=load('ad-manager.ts');
const {ProjectMessaging}=load('messaging-sources.ts');
const KEY='9a'.repeat(32),TOKEN='EAAFixtureMetaAdsTokenOnly';
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
// Disposable Meta Graph that can hold its answer until released, to run two requests at the same time.
const graph=()=>{const calls=[];let next=900,hold=null;const fn=async(method,path,token,params={})=>{calls.push({method,path,params});
  if(hold&&method==='POST')await hold.promise;
  if(/^act_\d+$/.test(path)&&method==='GET')return {id:'act_123456',name:'QA ads',currency:'USD',account_status:1,timezone_name:'UTC'};
  if(/^act_\d+\//.test(path))return {id:String(++next)};return {success:true};};
  fn.calls=calls;fn.hold=()=>{let release;hold={promise:new Promise(r=>{release=r;})};return ()=>{const h=hold;hold=null;release();return h;};};return fn;};
const ads=(f,g,scope=f.scope)=>new ProjectAds(f.db,scope,KEY,g);
const plan=(extra={})=>({name:'Spring',objective:'OUTCOME_TRAFFIC',dailyBudgetMinor:3000,startDate:day(1),endDate:day(10),countries:['TR'],linkUrl:'https://example.com/s',...extra});
const ready=async(f,g,monthly=40000)=>{await ads(f,g).connect({adAccountId:'123456',accessToken:TOKEN});ads(f,g).setPolicy({dailyCapMinor:5000,monthlyCapMinor:monthly,expectedRevision:0});};
const approved=(f,g,extra)=>{let item=ads(f,g).savePlan(plan(extra)).plans.find(p=>p.name===(extra?.name||'Spring'));return ads(f,g).approve({id:item.id,expectedRevision:item.revision}).plans.find(p=>p.id===item.id);};

test('two simultaneous creates make one campaign; the plan is claimed before the provider call',coachRun(async f=>{
  const g=graph();await ready(f,g);const item=approved(f,g);
  const release=g.hold();const first=ads(f,g).create({id:item.id});await new Promise(r=>setTimeout(r,20));
  await assert.rejects(ads(f,g).create({id:item.id}),error=>error.status===409,'the second click is refused');
  assert.equal(ads(f,g).read().plans[0].state,'creating');assert.throws(()=>ads(f,g).savePlan({...plan(),id:item.id,expectedRevision:item.revision}),error=>error.status===409,'a creating plan cannot be edited');
  release();await first;assert.equal(ads(f,g).read().plans[0].state,'created');
  assert.equal(g.calls.filter(c=>c.path.endsWith('/campaigns')).length,1,'exactly one campaign on Meta');
}));
test('two simultaneous starts cannot pass the monthly cap together; pause waits for a start',coachRun(async f=>{
  process.env.PLATFORM_ADS_ENABLED='1';
  try{
    const g=graph();await ready(f,g,40000);
    const a=approved(f,g,{name:'A'}),b=approved(f,g,{name:'B'});await ads(f,g).create({id:a.id});await ads(f,g).create({id:b.id});
    const release=g.hold();const first=ads(f,g).start({id:a.id,acknowledged:true});await new Promise(r=>setTimeout(r,20));
    await assert.rejects(ads(f,g).start({id:b.id,acknowledged:true}),/aylık tavan/,'a starting plan counts against the cap');
    await assert.rejects(ads(f,g).pause({id:a.id}),error=>error.status===409,'pause waits until the start finished');
    release();await first;const plans=ads(f,g).read().plans;
    assert.equal(plans.find(p=>p.id===a.id).state,'active');assert.equal(plans.find(p=>p.id===b.id).state,'created');
    assert.equal((await ads(f,g).pause({id:a.id})).plans.find(p=>p.id===a.id).state,'paused');
  }finally{process.env.PLATFORM_ADS_ENABLED='0';}
}));
test('a claim left by an interrupted request is settled safely after ten minutes',coachRun(async f=>{
  const g=graph();await ready(f,g);const item=approved(f,g);const old=new Date(Date.now()-11*60000).toISOString();
  f.db.prepare("UPDATE platform_ad_plans SET state='starting',provider_campaign_id='901',provider_adset_id='902',updated_at=? WHERE id=?").run(old,item.id);
  const settled=ads(f,g).read().plans[0];assert.equal(settled.state,'active','an interrupted start is treated as running, so it can be paused');assert.match(settled.lastError,/yarıda/);
  f.db.prepare("UPDATE platform_ad_plans SET state='creating',updated_at=? WHERE id=?").run(old,item.id);assert.equal(ads(f,g).read().plans[0].state,'failed');
}));
test('a plan is paused on its own account even after another account is connected',coachRun(async f=>{
  process.env.PLATFORM_ADS_ENABLED='1';
  try{const g=graph();await ready(f,g);const item=approved(f,g);await ads(f,g).create({id:item.id});await ads(f,g).start({id:item.id,acknowledged:true});
    await ads(f,g).connect({adAccountId:'999999',accessToken:TOKEN});
    await assert.rejects(ads(f,g).pause({id:item.id}),/artık bağlı değil/,'the old account was replaced, so the app says where to stop it instead of calling another account');
  }finally{process.env.PLATFORM_ADS_ENABLED='0';}
}));
test('nobody changes their own duties, and only an owner gives the publish duty',coachRun(async f=>{
  const owner=new ProjectMessaging(f.db,f.scope,KEY);
  const admin=f.member('admin');
  assert.throws(()=>owner.setDuty({userId:f.scope.subject,duty:'suggest',granted:true}),/Kendi görevlerinizi/);
  assert.throws(()=>new ProjectMessaging(f.db,admin,KEY).setDuty({userId:admin.subject,duty:'publish',granted:true}),error=>error.status===403);
  const second=f.repo.addMember(f.scope.subject,f.scope.organizationId,f.scope.projectId,{username:'second-admin',password:'fixture-password-123',role:'admin'}).userId;
  assert.throws(()=>new ProjectMessaging(f.db,admin,KEY).setDuty({userId:second,duty:'publish',granted:true}),/yalnız proje sahibi/);
  owner.setDuty({userId:second,duty:'publish',granted:true});
  new ProjectMessaging(f.db,admin,KEY).setDuty({userId:second,duty:'publish',granted:false});
}));
test('schema52 keeps every ad plan and is repeatable',coachRun(async f=>{
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'ad-claims-')),'fixture.sqlite');
  const g=graph();await ready(f,g);approved(f,g);await f.db.backup(file);
  let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeAdClaimSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,51);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,53);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_ad_plans').get().n,1);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
