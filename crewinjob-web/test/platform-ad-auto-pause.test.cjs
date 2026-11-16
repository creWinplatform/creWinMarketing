const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {adAutoPause,saveAdAutoPause,runAdAutoPause}=load('ad-auto-pause.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
// One running Meta plan (5 days at 50.00 TRY a day); a stand-in pauser does what ProjectAds.pause does to the row,
// so nothing reaches a provider.
async function setup(){
  const f=await fixture(),now=new Date().toISOString();
  f.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES('qa-ads-meta',?,?,'meta_ads','qa-meta','QA ads · not real','{}',1,?)").run(f.scope.organizationId,f.scope.projectId,now);
  f.db.prepare("INSERT INTO platform_ad_plans(id,organization_id,project_id,connection_id,provider,name,objective,daily_budget_minor,currency,start_date,end_date,countries_json,link_url,state,digest,approved_by,created_by,created_at,updated_at,provider_campaign_id) VALUES('plan-1',?,?,'qa-ads-meta','meta','Yaz kampanyası','OUTCOME_APP_PROMOTION',5000,'TRY',?,?,'[\"TR\"]','https://example.com','active','d',?,?,?,?,'9001')")
    .run(f.scope.organizationId,f.scope.projectId,day(-4),day(10),f.scope.subject,f.scope.subject,now,now);
  f.calls=[];
  f.make=(fail=false)=>(db,scope)=>({pause:async raw=>{f.calls.push({id:raw.id,subject:scope.subject});if(fail){db.prepare("UPDATE platform_ad_plans SET last_error='Meta duraklatma isteğini doğrulamadı.' WHERE id=?").run(raw.id);return;}db.prepare("UPDATE platform_ad_plans SET state='paused' WHERE id=?").run(raw.id);}});
  f.spend=minor=>f.db.prepare("UPDATE platform_ad_plans SET spend_minor=?,spend_checked_at=? WHERE id='plan-1'").run(minor,new Date().toISOString());
  f.state=()=>f.db.prepare("SELECT state FROM platform_ad_plans WHERE id='plan-1'").get().state;
  f.later=minutes=>Date.now()+minutes*60000;
  return f;
}
const run=fn=>async()=>{const f=await setup();try{await fn(f);}finally{f.db.close();}};

test('off by default; turning it on needs the ad rights, a threshold and an explicit acknowledgement',run(async f=>{
  assert.equal((await adAutoPause(f.db,f.scope)).enabled,false);
  f.spend(31000);
  assert.equal(await runAdAutoPause(f.db,f.KEY,Date.now(),f.make()),0);assert.equal(f.state(),'active','nothing happens while it is off');
  await assert.rejects(saveAdAutoPause(f.db,f.scope,{enabled:true,kinds:['overspend']}),/onay kutusunu/);
  await assert.rejects(saveAdAutoPause(f.db,f.scope,{enabled:true,kinds:[],acknowledged:true}),/En az bir eşik/);
  const editor={...f.scope,subject:(await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'auto-editor',password:'fixture-password-123',role:'editor'})).userId};
  await assert.rejects(saveAdAutoPause(f.db,editor,{enabled:true,kinds:['overspend'],acknowledged:true}),error=>error.status===403);
  const view=await saveAdAutoPause(f.db,f.scope,{enabled:true,kinds:['overspend','bogus'],acknowledged:true});
  assert.equal(view.enabled,true);assert.deepEqual(plain(view.kinds),['overspend']);assert.equal(view.enabledByMe,true);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_audit WHERE operation='ads.auto_pause.on'").get().n,1);
}));

test('a plan past the threshold is paused once, as the person who turned it on, and the attempt is logged',run(async f=>{
  await saveAdAutoPause(f.db,f.scope,{enabled:true,kinds:['overspend'],acknowledged:true});
  f.spend(29000);
  assert.equal(await runAdAutoPause(f.db,f.KEY,Date.now(),f.make()),0,'under 5 days × 50 × 120%');assert.equal(f.state(),'active');
  f.spend(31000);
  assert.equal(await runAdAutoPause(f.db,f.KEY,Date.now(),f.make()),0,'checked less than 15 minutes ago: waits for the next round');
  assert.equal(await runAdAutoPause(f.db,f.KEY,f.later(16),f.make()),1);
  assert.equal(f.state(),'paused');assert.deepEqual(plain(f.calls),[{id:'plan-1',subject:f.scope.subject}]);
  const [entry]=(await adAutoPause(f.db,f.scope)).recent;assert.equal(entry.outcome,'paused');assert.equal(entry.spendMinor,31000);assert.equal(entry.limitMinor,30000);assert.equal(entry.kind,'overspend');
  assert.equal(await runAdAutoPause(f.db,f.KEY,f.later(40),f.make()),0,'a paused plan is not warned about again');assert.equal(f.calls.length,1);
}));

test('a failed pause is logged and not retried for six hours; the rule switches off when its owner loses the rights',run(async f=>{
  await saveAdAutoPause(f.db,f.scope,{enabled:true,kinds:['overspend'],acknowledged:true});f.spend(31000);
  assert.equal(await runAdAutoPause(f.db,f.KEY,f.later(16),f.make(true)),0);
  assert.equal(f.state(),'active');assert.equal((await adAutoPause(f.db,f.scope)).recent[0].outcome,'failed');
  await runAdAutoPause(f.db,f.KEY,f.later(40),f.make(true));assert.equal(f.calls.length,1,'no retry within six hours');
  await runAdAutoPause(f.db,f.KEY,f.later(7*60),f.make());assert.equal(f.state(),'paused','retried after six hours');
  // A second project member turns it on, then is demoted: the rule switches itself off and pauses nothing.
  f.db.prepare("UPDATE platform_ad_plans SET state='active' WHERE id='plan-1'").run();
  const admin={...f.scope,subject:(await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'auto-admin',password:'fixture-password-123',role:'admin'})).userId};
  await saveAdAutoPause(f.db,admin,{enabled:true,kinds:['overspend'],acknowledged:true});
  f.db.prepare('UPDATE platform_memberships SET role=? WHERE user_id=?').run('viewer',admin.subject);
  f.calls.length=0;assert.equal(await runAdAutoPause(f.db,f.KEY,f.later(8*60),f.make()),0);
  assert.equal(f.calls.length,0);assert.equal((await adAutoPause(f.db,f.scope)).enabled,false);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_audit WHERE operation='ads.auto_pause.off_rights'").get().n,1);
}));
