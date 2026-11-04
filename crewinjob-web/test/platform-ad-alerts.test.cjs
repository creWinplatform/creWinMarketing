const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {MobileGrowth}=load('mobile-store.ts'),{recordMobileEvents}=load('mobile-ingestion.ts');
const {adWarnings,adAlertSettings,saveAdAlertSettings}=load('ad-alerts.ts'),{refreshDueAdSpend}=load('ad-spend-refresh.ts'),{teamAlerts}=load('team-alerts.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10),ago=days=>new Date(Date.now()-days*86400000).toISOString();
function setup(){
  const f=fixture(),service=new MobileGrowth(f.db,f.scope,f.KEY);
  const app=service.saveApp({name:'Dövme QA',platform:'ios',appleId:'123456789',bundleId:'com.example.tattoo',packageName:'',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'tattoo',attributionProvider:'appsflyer',revenueProvider:'bridge',identityConfirmed:true});service.setSource(app.id,true);
  const now=new Date().toISOString();
  f.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES('qa-ads-meta',?,?,'meta_ads','qa-meta','QA ads · not real','{}',1,?)").run(f.scope.organizationId,f.scope.projectId,now);
  // A plan running for 5 days at 50.00 TRY a day, approved by the project owner.
  f.db.prepare("INSERT INTO platform_ad_plans(id,organization_id,project_id,connection_id,provider,name,objective,daily_budget_minor,currency,start_date,end_date,countries_json,link_url,state,digest,approved_by,created_by,created_at,updated_at,provider_campaign_id) VALUES('plan-1',?,?,'qa-ads-meta','meta','Yaz kampanyası','OUTCOME_APP_PROMOTION',5000,'TRY',?,?,'[\"TR\"]','https://example.com','active','d',?,?,?,?,'9001')")
    .run(f.scope.organizationId,f.scope.projectId,day(-4),day(10),f.scope.subject,f.scope.subject,now,now);
  return {...f,service,app:service.app(app.id)};
}
const run=fn=>async()=>{const f=setup();try{await fn(f);}finally{f.db.close();}};
const spend=(f,minor)=>f.db.prepare("UPDATE platform_ad_plans SET spend_minor=?,spend_checked_at=? WHERE id='plan-1'").run(minor,new Date().toISOString());

test('overspend: the reported spend against the days run so far, or one synced day, against the threshold',run(async f=>{
  assert.deepEqual(plain(adWarnings(f.db,f.scope)),[],'no spend read yet');
  spend(f,29000);assert.deepEqual(plain(adWarnings(f.db,f.scope)),[],'29.000 under 5 days × 50 × 120% = 300');
  spend(f,31000);let [warning]=plain(adWarnings(f.db,f.scope));assert.equal(warning.kind,'overspend');assert.equal(warning.limitMinor,30000);assert.equal(warning.spendMinor,31000);
  saveAdAlertSettings(f.db,f.scope,{overspendPercent:150,cpiCaps:{}});assert.deepEqual(plain(adWarnings(f.db,f.scope)),[],'the team raised the threshold');
  spend(f,20000);f.db.prepare('INSERT INTO platform_mobile_costs VALUES(?,?,?,?,?,?,?,?,?,?)').run(f.scope.organizationId,f.scope.projectId,f.app.id,'ad:meta:plan-1','Yaz kampanyası',day(-1),'TRY',80,f.scope.subject,new Date().toISOString());
  [warning]=plain(adWarnings(f.db,f.scope));assert.equal(warning.kind,'overspend');assert.equal(warning.day,day(-1));assert.equal(warning.spendMinor,8000);assert.equal(warning.limitMinor,7500,'one day above 50 × 150%');
  f.db.prepare("UPDATE platform_ad_plans SET state='paused' WHERE id='plan-1'").run();assert.deepEqual(plain(adWarnings(f.db,f.scope)),[],'paused plans are not warned about');
}));
test('CPI: synced spend of the last 7 closed days over the installs the attribution provider credited to the campaign',run(async f=>{
  const cost=(d,amount)=>f.db.prepare('INSERT INTO platform_mobile_costs VALUES(?,?,?,?,?,?,?,?,?,?)').run(f.scope.organizationId,f.scope.projectId,f.app.id,'ad:meta:plan-1','Yaz kampanyası',day(d),'TRY',amount,f.scope.subject,new Date().toISOString());
  cost(-2,40);cost(-1,40);
  assert.deepEqual(plain(adWarnings(f.db,f.scope)),[],'no cap, no CPI warning');
  assert.throws(()=>saveAdAlertSettings(f.db,f.scope,{overspendPercent:99,cpiCaps:{}}),/%100/);assert.throws(()=>saveAdAlertSettings(f.db,f.scope,{overspendPercent:120,cpiCaps:{try:5}}),/üç harfli/);
  const editor={...f.scope,subject:f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'alerts-editor',password:'fixture-password-123',role:'editor'}).userId};
  assert.throws(()=>saveAdAlertSettings(f.db,editor,{overspendPercent:120,cpiCaps:{TRY:2000}}),e=>e.status===403);
  saveAdAlertSettings(f.db,f.scope,{overspendPercent:120,cpiCaps:{TRY:2000}});assert.deepEqual(plain(adAlertSettings(f.db,f.scope).cpiCaps),{TRY:2000});
  let [warning]=plain(adWarnings(f.db,f.scope));assert.equal(warning.kind,'cpi');assert.equal(warning.installs,0);assert.equal(warning.cpiMinor,null,'spend above the cap and no install');
  const install=(id,campaign)=>({id,entityId:`user-${id}`,kind:'install',occurredAt:ago(2),platform:'ios',details:{identity:'customer',environment:'production',campaign,channel:'Facebook Ads',providerConfirmed:true}});
  recordMobileEvents(f.service,f.app,'appsflyer',[install('i1','Yaz kampanyası'),install('i2','Yaz kampanyası'),install('i3','Başka kampanya')]);
  [warning]=plain(adWarnings(f.db,f.scope));assert.equal(warning.installs,2);assert.equal(warning.cpiMinor,4000,'80.00 TRY / 2 installs = 40.00 > 20.00');
  recordMobileEvents(f.service,f.app,'appsflyer',[install('i4','Yaz kampanyası'),install('i5','Yaz kampanyası')]);
  assert.deepEqual(plain(adWarnings(f.db,f.scope)),[],'80.00 / 4 = 20.00 is not above the cap');
}));
test('the team sees the warnings with the plan names; the worker refreshes spend every 6 hours, at most 4 times a day',run(async f=>{
  spend(f,50000);const alert=plain(teamAlerts(f.db,f.scope)).find(item=>item.kind==='ad_overspend');
  assert.equal(alert.severity,'urgent');assert.deepEqual(alert.plans,['Yaz kampanyası']);assert.equal(alert.href,'/?tab=campaigns&campaignView=ads');
  const viewer={...f.scope,subject:f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'alerts-viewer',password:'fixture-password-123',role:'viewer'}).userId};
  assert.equal(plain(teamAlerts(f.db,viewer)).some(item=>item.kind==='ad_overspend'),false,'only ad managers');
  const calls=[];const make=(db,scope,key,provider)=>({refreshSpend:async raw=>{calls.push({scope,provider,raw});db.prepare("UPDATE platform_ad_plans SET spend_checked_at=? WHERE id=?").run(new Date().toISOString(),raw.id);}});
  f.db.prepare("UPDATE platform_ad_plans SET spend_checked_at=? WHERE id='plan-1'").run(ago(1));
  assert.equal(await refreshDueAdSpend(f.db,f.KEY,make),1);assert.equal(calls[0].scope.subject,f.scope.subject,'as the approver');assert.equal(calls[0].provider,'meta');
  assert.equal(await refreshDueAdSpend(f.db,f.KEY,make),0,'checked within 6 hours');
  const failing=()=>({refreshSpend:async()=>{throw new Error('provider down');}});
  for(let i=0;i<5;i++){f.db.prepare("UPDATE platform_ad_plans SET spend_checked_at=NULL WHERE id='plan-1'").run();await refreshDueAdSpend(f.db,f.KEY,failing);}
  assert.equal(f.db.prepare("SELECT count FROM platform_usage WHERE resource='ad_spend_auto:plan-1'").get().count,4,'at most 4 tries a day');
}));
