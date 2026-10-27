const assert=require('node:assert/strict'),{test}=require('node:test'),{createHmac}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{ProjectBilling,receivePaytrNotification}=load('billing.ts'),{ProjectUsage}=load('project-usage.ts');
const {paytrConfiguration}=load('paytr.ts'),{paytrStatusForm,paytrMajorToMinor,requestPaytrStatus}=load('paytr-status.ts');
const KEY='12'.repeat(32),env={PLATFORM_PAYTR_MERCHANT_ID:'123456',PLATFORM_PAYTR_MERCHANT_KEY:'fixture-key-not-real-1234',PLATFORM_PAYTR_MERCHANT_SALT:'fixture-salt-not-real-1234',PLATFORM_PAYTR_SANDBOX_ENABLED:'1',PLATFORM_PAYTR_USD_ENABLED:'1',PLATFORM_PAYTR_ORIGIN:'https://ryzevo.example',PLATFORM_PAYTR_TEST_CATALOG:JSON.stringify([{id:'fixture',name:'Fixture only',amountMinor:2900,currency:'USD',cadence:'monthly'}])};
async function withFixture(run){
 const saved=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('fixture-admin');
 const create=name=>repo.provision('legacy-admin',{organizationName:name,projectName:name,website:'https://example.com',username:name,password:'fixture-password-123'}),a=create('alpha'),b=create('beta'),scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId};
 db.prepare('INSERT INTO platform_account_emails VALUES(?,?,?)').run(a.userId,'fixture@example.com',new Date().toISOString());
 const f={db,repo,a,b,scope,service:new ProjectBilling(db,scope,KEY)};
 f.start=(key='fixture-checkout-0001',transport=async()=>({state:'accepted',token:'fixturecheckouttoken123456789'}))=>f.service.start({planId:'fixture',idempotencyKey:key,contact:{name:'Fixture User',phone:'123456789',address:'Disposable fixture address'}},'203.0.113.5',transport);
 f.checkInput=(id,key='fixture-status-check-0001')=>({action:'check',orderId:id,idempotencyKey:key});
 f.oldChecks=()=>db.prepare('UPDATE platform_billing_checks SET created_at=?').run(new Date(Date.now()-61000).toISOString());
 try{await run(f);}finally{db.close();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
const found=patch=>({status:'payment_found',amountMinor:2900,totalMinor:2900,currency:'USD',testMode:true,card:true,installments:false,hasRefunds:false,...patch});
function notice(id,patch={}){const fields={merchant_oid:id,status:'success',total_amount:'2900',payment_amount:'2900',currency:'USD',test_mode:'1',payment_type:'card',...patch};fields.hash=createHmac('sha256',env.PLATFORM_PAYTR_MERCHANT_KEY).update(fields.merchant_oid+env.PLATFORM_PAYTR_MERCHANT_SALT+fields.status+fields.total_amount).digest('base64');return new URLSearchParams(fields).toString();}

test('status inquiry uses documented field order and only opaque sandbox IDs',()=>withFixture(f=>{
 const config=paytrConfiguration(),id='RZTEST'+'a'.repeat(32),form=paytrStatusForm(config,id);assert.equal(form.get('paytr_token'),createHmac('sha256',config.merchantKey).update(config.merchantId+id+config.merchantSalt).digest('base64'));assert.equal(Array.from(form.keys()).sort().join(','),'merchant_id,merchant_oid,paytr_token');assert.throws(()=>paytrStatusForm(config,'live-order'));process.env.PLATFORM_PAYTR_SANDBOX_ENABLED='0';assert.throws(()=>paytrStatusForm(paytrConfiguration(),id));
}));
test('major-unit parser is exact for dot/comma amounts and rejects ambiguous numeric formats',()=>{
 for(const [input,expected]of [['29',2900],['29.00',2900],['29,0',2900],['0.01',1],['10,8',1080],['10000.00',1000000]])assert.equal(paytrMajorToMinor(input),expected);
 for(const value of [29,'1e2','-1','1,000.00','01.00','29.001','10000.01',' 29','29 ','NaN','',null])assert.equal(paytrMajorToMinor(value),null);
});
test('positive exact inquiry settles only the sandbox order, removes checkout and does not change project rights',()=>withFixture(async f=>{
 const before=JSON.stringify(new ProjectUsage(f.db,f.scope).read()),order=await f.start();const result=await f.service.check(f.checkInput(order.id),async()=>found());assert.equal(result.state,'test_paid');assert.equal(result.settlementSource,'status_inquiry');assert.equal(result.checkoutUrl,null);assert.equal(result.latestCheck.outcome,'confirmed');assert.equal(result.latestCheck.reason,'matched');assert.equal(JSON.stringify(new ProjectUsage(f.db,f.scope).read()),before);assert.equal(f.db.prepare('SELECT notification_digest FROM platform_billing_orders').get().notification_digest,null);assert.equal(f.service.read().readiness.liveEnabled,false);
}));
test('a confirmed sandbox inquiry never upgrades a trial, extends its expiry or enables live delivery',()=>withFixture(async f=>{
 const start=new Date().toISOString(),end=new Date(Date.parse(start)+14*86400000).toISOString();f.db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE project_id=?").run(f.a.userId,start,end,f.a.projectId);const usage=new ProjectUsage(f.db,f.scope),before=JSON.stringify(usage.read());const order=await f.start();await f.service.check(f.checkInput(order.id),async()=>found());assert.equal(JSON.stringify(usage.read()),before);assert.equal(usage.read().deliveryAllowed,false);assert.equal(usage.read().period.endsAt,end);
}));

test('an uncertain token response can be reconciled without repeating token preparation',()=>withFixture(async f=>{
 let requests=0;const order=await f.start('uncertain-checkout-01',async()=>{requests++;throw new Error('private');});assert.equal(order.state,'uncertain');await f.service.check(f.checkInput(order.id),async()=>found());assert.equal(requests,1);assert.equal(f.service.read().orders[0].state,'test_paid');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_billing_orders').get().n,1);
}));
test('not-found, unavailable and malformed responses never mean failed payment or unlock another checkout',()=>withFixture(async f=>{
 const order=await f.start();for(const status of ['not_confirmed','unavailable','invalid_response']){f.oldChecks();const result=await f.service.check(f.checkInput(order.id,'check-response-'+status),async()=>({status}));assert.equal(result.state,'pending');assert.equal(result.latestCheck.outcome,status==='not_confirmed'?'not_confirmed':'unavailable');await assert.rejects(()=>f.start('blocked-next-checkout'),e=>e.status===409);}
}));
test('amount, currency, mode, payment type, installments and refund mismatches require review',()=>withFixture(async f=>{
 for(const [i,patch]of [{amountMinor:1},{totalMinor:1},{currency:'TRY'},{testMode:false},{card:false},{installments:true},{hasRefunds:true}].entries()){
   f.db.prepare("UPDATE platform_billing_orders SET state='test_failed' WHERE state='review'").run();const order=await f.start('mismatch-checkout-'+i);const result=await f.service.check(f.checkInput(order.id,'mismatch-check-key-'+i),async()=>found(patch));assert.equal(result.state,'review');assert.equal(result.checkoutUrl,null);assert.equal(result.latestCheck.reason,patch.hasRefunds?'refund_observed':'details_mismatch');
 }
}));
test('same key is idempotent and cannot change actor or selected order',()=>withFixture(async f=>{
 const order=await f.start();let calls=0;const check=()=>f.service.check(f.checkInput(order.id),async()=>{calls++;return found();});await check();await check();assert.equal(calls,1);const owner=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'second-owner',password:'fixture-password-123',role:'owner'});await assert.rejects(()=>new ProjectBilling(f.db,{...f.scope,subject:owner.userId},KEY).check(f.checkInput(order.id),async()=>assert.fail()),e=>e.status===409);const second=await f.start('second-checkout-after-paid');await assert.rejects(()=>f.service.check(f.checkInput(second.id),async()=>assert.fail()),e=>e.status===409);
}));
test('only current standard-project owner may query; all foreign scope and client flags are denied before network',()=>withFixture(async f=>{
 const order=await f.start();for(const role of ['admin','editor','analyst','viewer']){const member=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'check-'+role,password:'fixture-password-123',role});await assert.rejects(()=>new ProjectBilling(f.db,{...f.scope,subject:member.userId},KEY).check(f.checkInput(order.id),async()=>assert.fail()),e=>e.status===403);}
 await assert.rejects(()=>new ProjectBilling(f.db,{subject:f.b.userId,organizationId:f.b.organizationId,projectId:f.b.projectId},KEY).check(f.checkInput(order.id),async()=>assert.fail()),e=>e.status===404);
 for(const patch of [{paid:true},{testMode:false},{amountMinor:1},{organizationId:f.b.organizationId}])await assert.rejects(()=>f.service.check({...f.checkInput(order.id),...patch},async()=>assert.fail()),e=>e.status===400);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_billing_checks').get().n,0);
}));
test('merchant gate and key revision are checked while catalog/origin edits do not lose historical inquiry access',()=>withFixture(async f=>{
 const order=await f.start();process.env.PLATFORM_PAYTR_SANDBOX_ENABLED='0';await assert.rejects(()=>f.service.check(f.checkInput(order.id),async()=>assert.fail()),e=>e.status===503);Object.assign(process.env,env);process.env.PLATFORM_PAYTR_MERCHANT_KEY='rotated-key-not-real-1234';assert.equal(f.service.read().orders[0].canCheck,false);await assert.rejects(()=>f.service.check(f.checkInput(order.id),async()=>assert.fail()),e=>e.status===409);Object.assign(process.env,env,{PLATFORM_PAYTR_TEST_CATALOG:'[]',PLATFORM_PAYTR_ORIGIN:''});assert.equal(f.service.read().readiness.ready,false);assert.equal(f.service.read().statusCheckEnabled,true);assert.equal((await f.service.check(f.checkInput(order.id),async()=>found())).state,'test_paid');
}));
test('configuration changes in flight prevent applying a provider result',()=>withFixture(async f=>{
 const order=await f.start();const result=await f.service.check(f.checkInput(order.id),async()=>{process.env.PLATFORM_PAYTR_SANDBOX_ENABLED='0';return found();});assert.equal(result.state,'pending');assert.equal(result.latestCheck.reason,'configuration_changed');assert.equal(result.latestCheck.outcome,'changed');
}));
test('owner revocation in flight hides the result and cannot settle an order',()=>withFixture(async f=>{
 const order=await f.start();await assert.rejects(()=>f.service.check(f.checkInput(order.id),async()=>{f.db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(f.a.userId);return found();}),e=>e.status===403);assert.equal(f.db.prepare('SELECT state FROM platform_billing_orders').get().state,'pending');assert.equal(f.db.prepare('SELECT reason FROM platform_billing_checks').get().reason,'authority_lost');
}));
test('callback racing inquiry wins; stale response cannot overwrite signed failure',()=>withFixture(async f=>{
 const order=await f.start();const result=await f.service.check(f.checkInput(order.id),async()=>{receivePaytrNotification(f.db,notice(order.id,{status:'failed',total_amount:'0',payment_amount:'0'}));return found();});assert.equal(result.state,'test_failed');assert.equal(result.settlementSource,'notification');assert.equal(result.latestCheck.reason,'order_changed');
}));
test('matching late notification strengthens inquiry result; contradictory late failure stays in review',()=>withFixture(async f=>{
 const order=await f.start();await f.service.check(f.checkInput(order.id),async()=>found());receivePaytrNotification(f.db,notice(order.id));assert.equal(f.service.read().orders[0].state,'test_paid');assert.equal(f.service.read().orders[0].settlementSource,'notification');receivePaytrNotification(f.db,notice(order.id,{status:'failed',total_amount:'0',payment_amount:'0'}));assert.equal(f.service.read().orders[0].state,'review');f.oldChecks();const result=await f.service.check(f.checkInput(order.id,'review-status-check-02'),async()=>found());assert.equal(result.state,'review');assert.equal(result.latestCheck.reason,'review_required');
}));
test('inquiry-only settlement followed by a first conflicting callback cannot become ordinary test failure',()=>withFixture(async f=>{
 const order=await f.start();await f.service.check(f.checkInput(order.id),async()=>found());receivePaytrNotification(f.db,notice(order.id,{status:'failed',total_amount:'0',payment_amount:'0'}));assert.equal(f.service.read().orders[0].state,'review');
}));
test('concurrent identical query makes one request; new keys are throttled and GET never queries provider',()=>withFixture(async f=>{
 const order=await f.start();let finish,calls=0;const pending=f.service.check(f.checkInput(order.id),()=>{calls++;return new Promise(resolve=>finish=resolve);});const repeated=await f.service.check(f.checkInput(order.id),async()=>assert.fail());assert.equal(repeated.latestCheck.outcome,'checking');assert.equal(repeated.canCheck,false);await assert.rejects(()=>f.service.check(f.checkInput(order.id,'concurrent-other-key'),async()=>assert.fail()),e=>e.status===429);assert.equal(f.service.read().orders[0].latestCheck.outcome,'checking');finish(found());await pending;assert.equal(calls,1);
}));
test('abandoned checks remain unconfirmed on read and bounded recovery does not apply their late response',()=>withFixture(async f=>{
 const order=await f.start();let finish;const pending=f.service.check(f.checkInput(order.id),()=>new Promise(resolve=>finish=resolve));f.oldChecks();assert.equal(f.service.read().orders[0].latestCheck.interrupted,true);const next=await f.service.check(f.checkInput(order.id,'recover-status-check-02'),async()=>({status:'not_confirmed'}));assert.equal(next.state,'pending');finish(found());const old=await pending;assert.equal(old.state,'pending');assert.equal(f.db.prepare("SELECT reason FROM platform_billing_checks WHERE reason='interrupted'").get().reason,'interrupted');
}));
test('an expired inquiry lease cannot apply a late result even without another worker',()=>withFixture(async f=>{
 const order=await f.start();const result=await f.service.check(f.checkInput(order.id),async()=>{f.db.prepare('UPDATE platform_billing_checks SET created_at=?').run(new Date(Date.now()-16000).toISOString());return found();});assert.equal(result.state,'pending');assert.equal(result.latestCheck.outcome,'changed');assert.equal(result.latestCheck.reason,'interrupted');
}));

test('persistent 40/day query limit counts unavailable outcomes and exact replays do not add attempts',()=>withFixture(async f=>{
 const order=await f.start();let calls=0;for(let i=0;i<40;i++){f.oldChecks();await f.service.check(f.checkInput(order.id,'daily-status-query-'+i),async()=>{calls++;return {status:'unavailable'};});}f.oldChecks();await assert.rejects(()=>f.service.check(f.checkInput(order.id,'daily-status-query-41'),async()=>assert.fail()),e=>e.status===429);await f.service.check(f.checkInput(order.id,'daily-status-query-0'),async()=>assert.fail());assert.equal(calls,40);
}));
test('adapter pins HTTPS endpoint, signs only required form data and drops private provider fields',()=>withFixture(async f=>{
 const original=globalThis.fetch,form=paytrStatusForm(paytrConfiguration(),'RZTEST'+'a'.repeat(32));try{let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://www.paytr.com/odeme/durum-sorgu');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal);assert.equal(new URLSearchParams(options.body).get('merchant_key'),null);return Response.json({status:'success',payment_amount:'29,00',payment_total:'29.00',currency:'USD',test_mode:'1',odeme_tipi:'KART',taksit:'0',returns:[],masked_pan:'PRIVATE-CARD-DATA',auth_code:'PRIVATE-CODE',customer:'PRIVATE-CUSTOMER'});};const result=await requestPaytrStatus(form);assert.equal(result.status,'payment_found');assert.equal(result.amountMinor,2900);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);assert.equal(calls,1);await requestPaytrStatus(new URLSearchParams({merchant_oid:'live'}));assert.equal(calls,1);}
 finally{globalThis.fetch=original;}
}));
test('error 004 is not a definitive failure, and bounded invalid responses fail closed without retry',()=>withFixture(async()=>{
 const original=globalThis.fetch,form=paytrStatusForm(paytrConfiguration(),'RZTEST'+'a'.repeat(32));try{globalThis.fetch=async()=>Response.json({status:'error',err_no:'004',err_msg:'PRIVATE-ERROR'});assert.equal((await requestPaytrStatus(form)).status,'not_confirmed');for(const response of [new Response('x'.repeat(16385)),new Response('<html>error</html>'),new Response('',{status:503}),Response.json({status:'success',payment_amount:29,payment_total:'29.00',currency:'USD',test_mode:'1',odeme_tipi:'KART',taksit:'0',returns:[]})]){let calls=0;globalThis.fetch=async()=>{calls++;return response;};assert.ok(['unavailable','invalid_response'].includes((await requestPaytrStatus(form)).status));assert.equal(calls,1);}}
 finally{globalThis.fetch=original;}
}));
test('inquiry metadata cannot expose credentials, card data or contact information',()=>withFixture(async f=>{
 const order=await f.start();await f.service.check(f.checkInput(order.id),async()=>found());const rows=JSON.stringify(f.db.prepare('SELECT * FROM platform_billing_checks').all()),view=JSON.stringify(f.service.read());assert.doesNotMatch(rows+view,/fixture-key|fixture-salt|Fixture User|fixture@example|Disposable fixture address|masked_pan|auth_code/);assert.equal(f.db.pragma('foreign_key_check').length,0);
}));
test('schema26 migration preserves schema25 trial/pilot rights and pending test orders across restarts',()=>withFixture(async f=>{
 const fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'billing-check-migration-')),'test.sqlite');const order=await f.start();let db;
 try{require('./schema-fixture.cjs').removeBillingCheckSchema(f.db);assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n,25);await f.db.backup(file);db=openPlatformDatabase(file);assert.equal(new ProjectBilling(db,f.scope,KEY).read().orders[0].id,order.id);assert.equal(new ProjectUsage(db,f.scope).read().plan.id,'pilot');assert.equal(db.prepare('SELECT revision FROM platform_billing_orders').get().revision,0);db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n,59);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);}finally{db?.close();}
}));
