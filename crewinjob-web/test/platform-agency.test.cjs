const assert=require('node:assert/strict'),{test}=require('node:test'),{createHmac}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{ProjectLiveBilling,receivePaytrLiveNotification}=load('billing-live.ts');
const {projectEntitlement}=load('entitlements.ts'),{AgencyPackage,AgencyClient,agencyHomes}=load('agency.ts'),{approvalQueue}=load('approvals.ts'),{portfolio}=load('portfolio.ts');
// Disposable merchant values only; no request ever reaches PayTR.
const KEY='56'.repeat(32),keys=['PLATFORM_PAYTR_MERCHANT_ID','PLATFORM_PAYTR_MERCHANT_KEY','PLATFORM_PAYTR_MERCHANT_SALT','PLATFORM_PAYTR_ORIGIN','PLATFORM_PAYTR_TEST_CATALOG','PLATFORM_PAYTR_SANDBOX_ENABLED','PLATFORM_PAYTR_USD_ENABLED','PLATFORM_PAYTR_LIVE_ENABLED','PLATFORM_BILLING_TERMS_URL'];
const env={PLATFORM_PAYTR_MERCHANT_ID:'123456',PLATFORM_PAYTR_MERCHANT_KEY:'agency-key-fixture-only-1234',PLATFORM_PAYTR_MERCHANT_SALT:'agency-salt-fixture-only-1234',PLATFORM_PAYTR_ORIGIN:'https://ryzevo.example',PLATFORM_PAYTR_USD_ENABLED:'1',PLATFORM_PAYTR_LIVE_ENABLED:'1',PLATFORM_BILLING_TERMS_URL:'https://ryzevo.example/satis-sozlesmesi'};
function withConfig(run){const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));for(const key of keys)delete process.env[key];Object.assign(process.env,env);return Promise.resolve().then(run).finally(()=>{for(const key of keys){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}});}
function notice(id,total){const value={merchant_oid:id,status:'success',total_amount:String(total),currency:'USD',test_mode:'0',payment_amount:String(total),payment_type:'card'};value.hash=createHmac('sha256',env.PLATFORM_PAYTR_MERCHANT_KEY).update(value.merchant_oid+env.PLATFORM_PAYTR_MERCHANT_SALT+value.status+value.total_amount).digest('base64');return new URLSearchParams(value).toString();}
const DAY=86400000,iso=value=>new Date(value).toISOString(),plain=value=>JSON.parse(JSON.stringify(value)),IP='203.0.113.9';
function fixture(){
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
 const create=name=>repo.provision('legacy-admin',{organizationName:name,projectName:name,website:`https://${name}.example`,username:name,password:'fixture-password-123'});
 const agency=create('agency'),client=create('client'),pilot=create('pilot');
 // One clock reading: a trial must last exactly 14 days, so its start and end may not fall a millisecond apart.
 const now=Date.now();for(const w of [agency,client])db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE organization_id=? AND project_id=?").run(w.userId,iso(now),iso(now+14*DAY),w.organizationId,w.projectId);
 db.prepare('INSERT INTO platform_account_emails VALUES(?,?,?)').run(agency.userId,'owner@agency.example',iso(Date.now()));
 const scope=w=>({subject:w.userId,organizationId:w.organizationId,projectId:w.projectId}),home=scope(agency);
 // A running agency package without going through PayTR (the purchase itself is covered by its own test).
 const grant=(starts=Date.now()-DAY,ends=Date.now()+29*DAY)=>{const id='RZLIVE'+require('node:crypto').randomBytes(16).toString('hex');
  db.prepare("INSERT INTO platform_billing_live_orders(id,organization_id,project_id,actor_id,idempotency_key,request_digest,merchant_revision,catalog_version,plan_id,cadence,amount_minor,state,terms_url,created_at,expires_at,updated_at,package) VALUES(?,?,?,?,?,'d','m','v','growth','monthly',29900,'paid','https://ryzevo.example/terms',?,?,?,'agency')").run(id,agency.organizationId,agency.projectId,agency.userId,id,iso(starts),iso(starts),iso(starts));
  db.prepare("INSERT INTO platform_project_subscriptions(order_id,organization_id,project_id,plan_id,cadence,starts_at,ends_at,grace_ends_at,created_at,package) VALUES(?,?,?,'growth','monthly',?,?,?,?,'agency')").run(id,agency.organizationId,agency.projectId,iso(starts),iso(ends),iso(ends+7*DAY),iso(starts));};
 const member=(w,role)=>db.prepare('INSERT INTO platform_memberships VALUES(?,?,?,?,1)').run(agency.userId,w.organizationId,w.projectId,role);
 return {db,repo,agency,client,pilot,home,scope,grant,member,service:new AgencyPackage(db,home)};
}
const project=(patch={})=>({action:'create',homeOrganizationId:'x',homeProjectId:'y',organizationName:'Deniz Mobilya',projectName:'Deniz Mobilya',website:'https://deniz.example',...patch});

test('the agency package is bought like any live plan, as a Growth period marked agency, and gives the home project Growth rights',()=>withConfig(async()=>{
 const f=fixture(),billing=new ProjectLiveBilling(f.db,f.home,KEY);
 const order=await billing.start({planId:'agency',cadence:'monthly',idempotencyKey:'agency-attempt-000001',acceptTerms:true,language:'tr',contact:{name:'Ajans Ltd',phone:'+90 555 000 0000',address:'Fixture address only'}},IP,async()=>({state:'accepted',token:'agencycheckouttoken12345'}));
 assert.equal(order.planId,'agency');assert.equal(order.amountMinor,29900);
 assert.deepEqual(plain(f.db.prepare('SELECT plan_id,package,amount_minor FROM platform_billing_live_orders WHERE id=?').get(order.id)),{plan_id:'growth',package:'agency',amount_minor:29900});
 assert.equal(receivePaytrLiveNotification(f.db,notice(order.id,29900)).state,'paid');
 const rights=projectEntitlement(f.db,f.home);assert.equal(rights.id,'paid');assert.equal(rights.plan,'growth');assert.equal(rights.agency,'home');assert.equal(rights.seats,5);
 assert.equal(billing.read().current.planId,'agency');assert.equal(agencyHomes(f.db,f.agency.userId)[0].limit,10);
}));

test('an agency opens client projects it owns, each covered with Growth rights, up to ten',()=>{
 const f=fixture();assert.throws(()=>f.service.createProject(project()),error=>error.status===403,'no package bought yet');
 f.grant();const created=f.service.createProject(project());
 assert.equal(f.repo.can(f.agency.userId,created.organizationId,created.projectId,'billing.manage'),true,'the agency owns the new project');
 const rights=projectEntitlement(f.db,{organizationId:created.organizationId,projectId:created.projectId});assert.equal(rights.id,'paid');assert.equal(rights.agency,'linked');
 assert.equal(f.db.prepare('SELECT mode FROM platform_project_entitlements WHERE project_id=?').get(created.projectId).mode,'agency','no rights of its own and no trial used up');
 for(let i=1;i<10;i++)f.service.createProject(project({projectName:`Müşteri ${i}`}));
 assert.throws(()=>f.service.createProject(project({projectName:'On birinci'})),error=>error.status===429);assert.equal(f.service.view().used,10);
 for(const bad of [{website:'ftp://x.example'},{organizationName:''},{timezone:'Mars/Base'},{extra:'x'}])assert.throws(()=>new AgencyPackage(f.db,f.home).createProject(project(bad)));
});

test('a client project joins the package only with its owner’s consent, and the owner can end it at any time',()=>{
 const f=fixture();f.grant();f.member(f.client,'editor');
 assert.equal(f.service.requestLink({organizationId:f.client.organizationId,projectId:f.client.projectId}).state,'requested');
 assert.equal(projectEntitlement(f.db,f.scope(f.client)).id,'trial','nothing changes before consent');
 assert.deepEqual(plain(approvalQueue(f.db,f.scope(f.client)).map(item=>item.kind)),['agency_link']);
 const owner=new AgencyClient(f.db,f.scope(f.client)),[request]=owner.list();assert.equal(request.agencyName,'agency');assert.equal(request.requestedBy,'agency');
 assert.throws(()=>new AgencyClient(f.db,{subject:f.agency.userId,organizationId:f.client.organizationId,projectId:f.client.projectId}).decide({id:request.id,decision:'approve'}),error=>error.status===403,'the agency cannot approve for the client');
 owner.decide({id:request.id,decision:'approve'});const rights=projectEntitlement(f.db,f.scope(f.client));assert.equal(rights.id,'paid');assert.equal(rights.agency,'linked');
 assert.throws(()=>new AgencyPackage(f.db,f.home).requestLink({organizationId:f.client.organizationId,projectId:f.client.projectId}),error=>error.status===409,'already linked');
 owner.remove({id:request.id});assert.equal(projectEntitlement(f.db,f.scope(f.client)).id,'trial','removing ends the coverage at once');
 f.service.requestLink({organizationId:f.client.organizationId,projectId:f.client.projectId});const [again]=owner.list().filter(item=>item.state==='requested');owner.decide({id:again.id,decision:'decline'});
 assert.equal(projectEntitlement(f.db,f.scope(f.client)).id,'trial');
});

test('links need membership, a standard non-pilot project and a running package; the home project’s editors cannot manage it',()=>{
 const f=fixture();f.grant();
 assert.throws(()=>f.service.requestLink({organizationId:f.client.organizationId,projectId:f.client.projectId}),error=>error.status===403,'not a member');
 f.member(f.pilot,'editor');assert.throws(()=>f.service.requestLink({organizationId:f.pilot.organizationId,projectId:f.pilot.projectId}),error=>error.status===409,'pilots keep pilot rights');
 assert.throws(()=>f.service.requestLink({organizationId:f.agency.organizationId,projectId:f.agency.projectId}),error=>error.status===409,'the home project is already covered');
 const editor=f.repo.addMember(f.agency.userId,f.agency.organizationId,f.agency.projectId,{username:'agency-editor',password:'fixture-password-123',role:'editor'});
 assert.throws(()=>new AgencyPackage(f.db,{...f.home,subject:editor.userId}).view(),error=>error.status===403);
 f.member(f.client,'owner');assert.equal(f.service.requestLink({organizationId:f.client.organizationId,projectId:f.client.projectId}).state,'linked','an owner of both sides links at once');
});

test('when the package and its grace end, linked projects fall back to their own plan and nothing new can be linked',()=>{
 const f=fixture();f.grant(Date.now()-40*DAY,Date.now()-10*DAY);const created=(()=>{f.grant();const value=f.service.createProject(project());f.db.prepare("DELETE FROM platform_project_subscriptions WHERE ends_at>?").run(iso(Date.now()));return value;})();
 const lapsed=projectEntitlement(f.db,{organizationId:created.organizationId,projectId:created.projectId});assert.equal(lapsed.active,false);assert.equal(lapsed.agency,'lapsed');assert.equal(lapsed.liveDeliveryAllowed,false);
 assert.equal(projectEntitlement(f.db,f.home).id,'trial');
 assert.throws(()=>f.service.createProject(project({projectName:'Yeni'})),error=>error.status===409,'a lapsed package opens nothing');
 assert.equal(agencyHomes(f.db,f.agency.userId)[0].period,null);
});

test('the portfolio shows the package and what it means for each project, read with the person’s rights',()=>{
 const f=fixture();f.grant();f.member(f.client,'editor');const created=f.service.createProject(project());f.service.requestLink({organizationId:f.client.organizationId,projectId:f.client.projectId});
 const view=portfolio(f.db,f.agency.userId,{organizationId:f.agency.organizationId,projectId:f.agency.projectId});
 assert.equal(view.agencies.length,1);assert.equal(view.agencies[0].used,2);
 const states=Object.fromEntries(view.projects.map(item=>[item.projectName,item.agency?.state||null]));assert.deepEqual(states,{agency:null,'Deniz Mobilya':'linked',client:'requested'});
 assert.equal(portfolio(f.db,f.client.userId,{organizationId:f.client.organizationId,projectId:f.client.projectId}).agencies.length,0,'the client is not an agency');
 assert.equal(created.projectId.length,36);
});

test('the contract email names the agency package and the sales terms list its price and coverage',()=>{
 const {contractEmailMessage}=load('billing-contract.ts'),{salesTermsPlainText}=load('sales-terms-document.ts');
 const mail=contractEmailMessage({id:'RZLIVE'+'b'.repeat(32),plan_id:'growth',package:'agency',cadence:'monthly',amount_minor:29900,paid_at:'2026-10-27T10:00:00.000Z',terms_version:'2026-10-27',terms_language:'en',terms_text:'x'},{starts_at:'2026-10-27T10:00:00.000Z',ends_at:'2026-11-27T10:00:00.000Z'});
 assert.match(mail.text,/Ryzevo Agency \(monthly\)/);assert.match(mail.text,/\$299/);
 const terms=salesTermsPlainText('tr','https://ryzevo.example');assert.match(terms,/Agency \(ajans paketi\)/);assert.match(terms,/\$299/);assert.match(terms,/\$2,?990/);assert.match(terms,/en fazla 10 müşteri projesini/);
});

test('migration 61 is additive and repeatable',async()=>{
 const fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'agency-')),'fixture.sqlite');
 let db=openPlatformDatabase(file);const seed=new PlatformRepository(db);seed.bootstrapLegacy('admin');const kept=['pilot-row','trial-row'].map(name=>seed.provision('legacy-admin',{organizationName:name,projectName:name,website:'https://kept.example',username:name,password:'fixture-password-123'}));
 const start=Date.now();db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE project_id=?").run(kept[1].userId,iso(start),iso(start+14*DAY),kept[1].projectId);const rows=JSON.stringify(db.prepare('SELECT * FROM platform_project_entitlements ORDER BY project_id').all());
 require('./schema-fixture.cjs').removeAgencySchema(db);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='platform_agency_links'").get().n,0);db.close();
 db=openPlatformDatabase(file);assert.equal(JSON.stringify(db.prepare('SELECT * FROM platform_project_entitlements ORDER BY project_id').all()),rows,'pilot and trial rows survive the rebuild');assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,64);assert.ok(db.prepare("SELECT name FROM pragma_table_info('platform_project_subscriptions')").all().some(item=>item.name==='package'));assert.equal(db.pragma('foreign_key_check').length,0);
 assert.throws(()=>db.prepare("INSERT INTO platform_project_subscriptions(order_id,organization_id,project_id,plan_id,cadence,starts_at,ends_at,grace_ends_at,created_at,package) VALUES('x','o','p','launch','monthly','a','b','c','d','agency')").run(),'the agency marker only goes with Growth');db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_migrations WHERE version=61').get().n,1);db.close();
});
