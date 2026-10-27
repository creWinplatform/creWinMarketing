const assert=require('node:assert/strict'),{test}=require('node:test'),{createHmac}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{ProjectLiveBilling,receivePaytrLiveNotification,isLiveNotification,livePlans,addPeriod}=load('billing-live.ts');
const {paytrConfiguration,paytrLiveReadiness,paytrLiveCheckoutForm,requestPaytrLiveToken,verifyPaytrLiveNotification,verifyPaytrNotification}=load('paytr.ts'),{projectEntitlement}=load('entitlements.ts'),{operatorReadiness}=load('operator.ts');
// Live billing with disposable merchant values only; no request ever reaches PayTR.
const KEY='34'.repeat(32),keys=['PLATFORM_PAYTR_MERCHANT_ID','PLATFORM_PAYTR_MERCHANT_KEY','PLATFORM_PAYTR_MERCHANT_SALT','PLATFORM_PAYTR_ORIGIN','PLATFORM_PAYTR_TEST_CATALOG','PLATFORM_PAYTR_SANDBOX_ENABLED','PLATFORM_PAYTR_USD_ENABLED','PLATFORM_PAYTR_LIVE_ENABLED','PLATFORM_BILLING_TERMS_URL'];
const env={PLATFORM_PAYTR_MERCHANT_ID:'123456',PLATFORM_PAYTR_MERCHANT_KEY:'live-key-fixture-only-1234',PLATFORM_PAYTR_MERCHANT_SALT:'live-salt-fixture-only-1234',PLATFORM_PAYTR_ORIGIN:'https://ryzevo.example',PLATFORM_PAYTR_USD_ENABLED:'1',PLATFORM_PAYTR_LIVE_ENABLED:'1',PLATFORM_BILLING_TERMS_URL:'https://ryzevo.example/satis-sozlesmesi'};
function withConfig(run,patch={}){const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));for(const key of keys)delete process.env[key];Object.assign(process.env,env,patch);return Promise.resolve().then(run).finally(()=>{for(const key of keys){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}});}
function fixture(){
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
  const create=username=>repo.provision('legacy-admin',{organizationName:username,projectName:username,website:'https://example.com',username,password:'fixture-password-123'}),a=create('alpha'),b=create('beta');
  const scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId};db.prepare('INSERT INTO platform_account_emails VALUES(?,?,?)').run(a.userId,'owner@alpha.example',new Date().toISOString());
  // Self-service accounts start on a 14-day trial (operator-provisioned ones are pilots and keep pilot rights).
  const start=new Date(),end=new Date(start.getTime()+14*86400000);
  for(const w of [a,b])db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE organization_id=? AND project_id=?").run(w.userId,start.toISOString(),end.toISOString(),w.organizationId,w.projectId);
  return {db,repo,a,b,scope,service:new ProjectLiveBilling(db,scope,KEY)};
}
const input=patch=>({planId:'launch',cadence:'monthly',idempotencyKey:'live-attempt-0000001',acceptTerms:true,language:'tr',contact:{name:'Fixture Ltd',phone:'+90 555 000 0000',address:'Fixture address only'},...patch});
const accepted=async()=>({state:'accepted',token:'livecheckouttoken1234567890'});
function notice(id,patch={}){const value={merchant_oid:id,status:'success',total_amount:'2900',currency:'USD',test_mode:'0',payment_amount:'2900',payment_type:'card',...patch};value.hash=createHmac('sha256',env.PLATFORM_PAYTR_MERCHANT_KEY).update(value.merchant_oid+env.PLATFORM_PAYTR_MERCHANT_SALT+value.status+value.total_amount).digest('base64');return new URLSearchParams(value).toString();}
const subs=f=>f.db.prepare('SELECT * FROM platform_project_subscriptions ORDER BY starts_at').all();
const IP='203.0.113.5';

test('live billing is off by default and never contacts PayTR while off',()=>withConfig(async()=>{
  const f=fixture();assert.equal(f.service.read().enabled,false);await assert.rejects(()=>f.service.start(input(),IP,accepted),e=>e.status===503);
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({});};
  try{assert.deepEqual(JSON.parse(JSON.stringify(await requestPaytrLiveToken(new URLSearchParams({test_mode:'0',currency:'USD',merchant_oid:'RZLIVE'+'a'.repeat(32)})))),{state:'rejected'});assert.equal(calls,0);}finally{globalThis.fetch=original;}
},{PLATFORM_PAYTR_LIVE_ENABLED:'0'}));

test('every live gate is required: switch, merchant, USD approval, https origin and an https terms page',()=>withConfig(()=>{
  assert.equal(paytrLiveReadiness(paytrConfiguration()).ready,true);
  // Our own /legal/sales page is still a draft (seller details and legal review pending), so it cannot open live payment.
  for(const patch of [{PLATFORM_PAYTR_LIVE_ENABLED:'0'},{PLATFORM_PAYTR_MERCHANT_KEY:''},{PLATFORM_PAYTR_USD_ENABLED:'0'},{PLATFORM_PAYTR_ORIGIN:'http://localhost:3033'},{PLATFORM_BILLING_TERMS_URL:''},{PLATFORM_BILLING_TERMS_URL:'http://ryzevo.example/terms'},{PLATFORM_BILLING_TERMS_URL:'https://ryzevo.example/legal/sales'},{PLATFORM_BILLING_TERMS_URL:'https://ryzevo.example/legal/sales/'}]){
    const saved={...process.env};Object.assign(process.env,patch);try{assert.equal(paytrLiveReadiness(paytrConfiguration()).ready,false,JSON.stringify(patch));}finally{Object.assign(process.env,saved);for(const k of Object.keys(patch))if(saved[k]===undefined)delete process.env[k];}}
}));

test('Launch and Growth are sold monthly and yearly (a year costs ten months); Team is not',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(livePlans().map(p=>[p.id,p.cadence,p.amountMinor]))),[['launch','monthly',2900],['launch','yearly',29000],['growth','monthly',7900],['growth','yearly',79000]]);
});

test('the server picks the price; the owner must accept the terms and have a verified email; the checkout is live USD',()=>withConfig(async()=>{
  const f=fixture();
  for(const patch of [{acceptTerms:false},{planId:'team'},{cadence:'weekly'},{amountMinor:1},{currency:'TRY'}])await assert.rejects(()=>f.service.start(input(patch),IP,accepted),JSON.stringify(patch));
  for(const role of ['admin','editor','viewer']){const g=fixture();const user=g.repo.addMember(g.a.userId,g.a.organizationId,g.a.projectId,{username:'live-'+role,password:'fixture-password-123',role});
    assert.throws(()=>new ProjectLiveBilling(g.db,{...g.scope,subject:user.userId},KEY).read(),e=>e.status===403,role);}
  let form;const order=await f.service.start(input({cadence:'yearly',planId:'growth'}),IP,async value=>{form=value;return accepted();});
  assert.match(order.id,/^RZLIVE[a-f0-9]{32}$/);assert.equal(order.amountMinor,79000);assert.equal(order.state,'pending');assert.match(order.checkoutUrl,/^https:\/\/www\.paytr\.com\/odeme\/guvenli\//);
  assert.equal(form.get('test_mode'),'0');assert.equal(form.get('currency'),'USD');assert.equal(form.get('payment_amount'),'79000');assert.equal(form.get('no_installment'),'1');
  const stored=JSON.stringify(f.db.prepare('SELECT * FROM platform_billing_live_orders').all());assert.doesNotMatch(stored,/livecheckouttoken|Fixture Ltd|555 000/,'the token is encrypted and contact details are not stored');
  assert.equal((await f.service.start(input({cadence:'yearly',planId:'growth'}),IP,()=>assert.fail('no second request'))).id,order.id,'the same attempt is idempotent');
  await assert.rejects(()=>f.service.start(input({idempotencyKey:'live-attempt-0000002'}),IP,accepted),e=>e.status===409,'one open payment at a time');
  const db2=fixture();db2.db.prepare('DELETE FROM platform_account_emails').run();await assert.rejects(()=>db2.service.start(input(),IP,accepted),e=>e.status===409);
}));

test('a signed, amount-matching success opens a paid period with the plan’s limits; repeats change nothing',()=>withConfig(async()=>{
  const f=fixture();assert.equal(projectEntitlement(f.db,f.scope).id,'trial');assert.equal(projectEntitlement(f.db,f.scope).liveDeliveryAllowed,false);
  const order=await f.service.start(input(),IP,accepted),body=notice(order.id);assert.equal(isLiveNotification(body),true);
  receivePaytrLiveNotification(f.db,body);receivePaytrLiveNotification(f.db,body);
  const [period]=subs(f);assert.equal(subs(f).length,1);assert.equal(period.plan_id,'launch');assert.equal(period.ends_at,addPeriod(period.starts_at,'monthly'));
  assert.equal(Date.parse(period.grace_ends_at)-Date.parse(period.ends_at),7*86400000);
  const rights=projectEntitlement(f.db,f.scope);assert.equal(rights.id,'paid');assert.equal(rights.plan,'launch');assert.equal(rights.liveDeliveryAllowed,true);assert.equal(rights.seats,2);assert.equal(rights.socialAccounts,3);assert.equal(rights.limits.ai,50);assert.equal(rights.inGrace,false);
  const view=f.service.read();assert.equal(view.current.planId,'launch');assert.equal(view.orders[0].state,'paid');assert.equal(view.orders[0].checkoutUrl,null);assert.equal(view.canPurchase,false,'renewal is not open a month ahead');
  assert.equal(projectEntitlement(f.db,{organizationId:f.b.organizationId,projectId:f.b.projectId}).id,'trial','another project is untouched');
}));

test('a wrong amount, sandbox or foreign metadata, a failed payment or a second different notice grants nothing',()=>withConfig(async()=>{
  for(const patch of [{total_amount:'2800',payment_amount:'2800'},{test_mode:'1'},{currency:'TRY'},{payment_type:'eft'}]){const f=fixture();const order=await f.service.start(input(),IP,accepted);
    receivePaytrLiveNotification(f.db,notice(order.id,patch));assert.equal(f.service.read().orders[0].state,'review',JSON.stringify(patch));assert.equal(subs(f).length,0);assert.equal(projectEntitlement(f.db,f.scope).id,'trial');}
  const f=fixture();const order=await f.service.start(input(),IP,accepted);receivePaytrLiveNotification(f.db,notice(order.id,{status:'failed'}));assert.equal(f.service.read().orders[0].state,'failed');assert.equal(subs(f).length,0);
  receivePaytrLiveNotification(f.db,notice(order.id));assert.equal(f.service.read().orders[0].state,'review','success after failure is contradictory');assert.equal(subs(f).length,0);
  assert.throws(()=>receivePaytrLiveNotification(f.db,notice(order.id).replace('total_amount=2900','total_amount=2901')),'a tampered amount breaks the signature');
  assert.throws(()=>receivePaytrLiveNotification(f.db,notice('RZLIVE'+'b'.repeat(32))),'an unknown order is not settled');
}));

test('sandbox and live never mix: each verifier refuses the other prefix and sandbox notices are not routed to live',()=>withConfig(()=>{
  const config=paytrConfiguration(),test=notice('RZTEST'+'c'.repeat(32),{test_mode:'1'}),live=notice('RZLIVE'+'c'.repeat(32));
  assert.equal(isLiveNotification(test),false);assert.throws(()=>verifyPaytrLiveNotification(config,test));assert.throws(()=>verifyPaytrNotification(config,live));
  assert.throws(()=>paytrLiveCheckoutForm(config,{orderId:'RZTEST'+'a'.repeat(32),amountMinor:2900,name:'x',email:'a@b.co',phone:'12345',address:'xxxxx',ip:IP,planName:'x',language:'en'}));
}));

test('renewal opens in the last 14 days and the new period starts where the current one ends',()=>withConfig(async()=>{
  const f=fixture();const first=await f.service.start(input(),IP,accepted);receivePaytrLiveNotification(f.db,notice(first.id));
  await assert.rejects(()=>f.service.start(input({idempotencyKey:'live-attempt-0000002'}),IP,accepted),e=>e.status===409);
  const ends=new Date(Date.now()+10*86400000).toISOString();f.db.prepare('UPDATE platform_project_subscriptions SET ends_at=?,grace_ends_at=?').run(ends,new Date(Date.parse(ends)+7*86400000).toISOString());
  assert.equal(f.service.read().canPurchase,true);
  const second=await f.service.start(input({idempotencyKey:'live-attempt-0000002',cadence:'yearly'}),IP,accepted);receivePaytrLiveNotification(f.db,notice(second.id,{total_amount:'29000',payment_amount:'29000'}));
  const [a,b]=subs(f);assert.equal(b.starts_at,a.ends_at,'no gap and no overlap');assert.equal(b.ends_at,addPeriod(a.ends_at,'yearly'));
  assert.equal(projectEntitlement(f.db,f.scope).endsAt,a.ends_at,'the running period stays current until it ends');
}));

test('after the period the project keeps working for 7 days, then falls back to its trial state',()=>withConfig(async()=>{
  const f=fixture();const order=await f.service.start(input(),IP,accepted);receivePaytrLiveNotification(f.db,notice(order.id));
  const set=(endsDaysAgo)=>{const ends=new Date(Date.now()-endsDaysAgo*86400000),start=new Date(ends.getTime()-30*86400000);f.db.prepare('UPDATE platform_project_subscriptions SET starts_at=?,ends_at=?,grace_ends_at=?').run(start.toISOString(),ends.toISOString(),new Date(ends.getTime()+7*86400000).toISOString());};
  set(3);let rights=projectEntitlement(f.db,f.scope);assert.equal(rights.id,'paid');assert.equal(rights.inGrace,true);assert.equal(rights.active,true);assert.equal(f.service.read().current.inGrace,true);assert.equal(f.service.read().canPurchase,true);
  set(8);rights=projectEntitlement(f.db,f.scope);assert.equal(rights.id,'trial','the grace is over');
}));

test('calendar periods: a month from 31 January ends at the end of February; a year from 29 February ends on 28 February',()=>{
  assert.equal(addPeriod('2027-01-31T10:00:00.000Z','monthly'),'2027-02-28T10:00:00.000Z');
  assert.equal(addPeriod('2028-01-31T10:00:00.000Z','monthly'),'2028-02-29T10:00:00.000Z');
  assert.equal(addPeriod('2028-02-29T10:00:00.000Z','yearly'),'2029-02-28T10:00:00.000Z');
  assert.equal(addPeriod('2026-10-22T08:30:00.000Z','monthly'),'2026-11-22T08:30:00.000Z');
});

test('a pilot project keeps its pilot rights even with a paid period',()=>withConfig(async()=>{
  const f=fixture();const order=await f.service.start(input(),IP,accepted);receivePaytrLiveNotification(f.db,notice(order.id));
  f.db.prepare("UPDATE platform_project_entitlements SET mode='pilot',ends_at=NULL,trial_owner_id=NULL WHERE organization_id=? AND project_id=?").run(f.a.organizationId,f.a.projectId);
  assert.equal(projectEntitlement(f.db,f.scope).id,'pilot');
  const view=f.service.read();assert.equal(view.pilotManaged,true);assert.equal(view.canPurchase,false);
  await assert.rejects(f.service.start(input({idempotencyKey:'pilot-attempt-key-0001'}),IP,accepted),/Pilot/);
}));

test('the operator console reports live billing readiness without values',()=>withConfig(()=>{
  const f=fixture();let item=operatorReadiness(f.db).items.find(i=>i.id==='paytr');assert.equal(item.state,'ready');assert.doesNotMatch(JSON.stringify(item),/live-key-fixture|live-salt-fixture/);
  delete process.env.PLATFORM_BILLING_TERMS_URL;item=operatorReadiness(f.db).items.find(i=>i.id==='paytr');assert.equal(item.state,'missing');assert.match(item.detail.en,/terms/);
}));

test('migration 54 is additive and repeatable',async()=>{
  const fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'live-billing-')),'fixture.sqlite');
  let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeLiveBillingSchema(db);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='platform_project_subscriptions'").get().n,0);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,58);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('platform_project_subscriptions','platform_billing_live_orders')").get().n,2);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_migrations WHERE version=54').get().n,1);db.close();
});
