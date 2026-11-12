const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts');
const {PlatformRepository}=load('repository.ts');
const {PlatformAccounts,securityVersion}=load('account.ts');
const {PlatformIdentity}=load('identity.ts');
const {identityEmailConfiguration,normalizeAccountEmail,identityEmailMessage}=load('identity-email.ts');
const KEY='12'.repeat(32);
function configure(){process.env.PLATFORM_AUTH_EMAIL_ENABLED='1';process.env.PLATFORM_PUBLIC_SIGNUP_ENABLED='1';process.env.PLATFORM_AUTH_ORIGIN='https://ryzevo.example';process.env.PLATFORM_AUTH_FROM_EMAIL='accounts@ryzevo.example';process.env.PLATFORM_AUTH_SES_REGION='eu-west-1';process.env.PLATFORM_AUTH_SES_ACCESS_KEY_ID='AKIA'+'A'.repeat(16);process.env.PLATFORM_AUTH_SES_SECRET_ACCESS_KEY='b'.repeat(40);}
async function fixture(){configure();const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);await repo.bootstrapLegacy('admin');const a=await repo.provision('legacy-admin',{organizationName:'Alpha',projectName:'Product',website:'https://alpha.example',username:'alpha',password:'fixture-password-123'});return {db,repo,a,service:new PlatformIdentity(db,KEY)};}
async function proof(f,kind='verify',email='owner@alpha.example'){
  if(kind==='verify')await f.service.requestVerification(f.a.userId,email,'fixture-password-123','en');else await f.service.request(kind,email,'en');
  let mail;await f.service.deliverNext(async value=>{mail=value;});assert.ok(mail);return mail.token;
}
test('identity configuration is separate, explicit, disabled by default and never exposes secrets',()=>{
 configure();delete process.env.PLATFORM_AUTH_EMAIL_ENABLED;assert.equal(identityEmailConfiguration(),null);configure();delete process.env.PLATFORM_AUTH_SES_ACCESS_KEY_ID;process.env.AWS_ACCESS_KEY_ID='AKIA'+'C'.repeat(16);assert.equal(identityEmailConfiguration(),null);configure();process.env.PLATFORM_AUTH_ORIGIN='http://ryzevo.example';assert.equal(identityEmailConfiguration(),null);process.env.PLATFORM_AUTH_ORIGIN='https://ryzevo.example/?evil';assert.equal(identityEmailConfiguration(),null);configure();assert.equal(identityEmailConfiguration().origin,'https://ryzevo.example');
});
test('account email normalization rejects injection and ambiguous invalid mailbox input',()=>{
 assert.equal(normalizeAccountEmail(' OWNER+Pilot@Alpha.example '),'owner+pilot@alpha.example');for(const value of ['a@b','a..b@example.com','a@example.com\r\nBcc:x@example.com','<a@example.com>',null])assert.throws(()=>normalizeAccountEmail(value));
});
test('verification requires current password, excludes legacy and does not auto-trust email usernames',async()=>{
 const f=await fixture();try{assert.equal((await f.service.account(f.a.userId)).email,null);await assert.rejects(async ()=>await f.service.requestVerification('legacy-admin','legacy@example.com','fixture-password-123','en'));await assert.rejects(async ()=>await f.service.requestVerification(f.a.userId,'owner@alpha.example','wrong','en'));const token=await proof(f);assert.equal((await f.service.account(f.a.userId)).email,null);await f.service.verify(token);assert.equal((await f.service.account(f.a.userId)).email,'owner@alpha.example');assert.equal((await f.repo.authenticate('alpha','fixture-password-123')).id,f.a.userId);await assert.rejects(async ()=>await f.service.verify(token));}finally{f.db.close();}
});
test('challenge tokens and delivery payloads are never stored in plaintext',async()=>{
 const f=await fixture();try{let captured;await f.service.requestVerification(f.a.userId,'owner@alpha.example','fixture-password-123','en');const before=f.db.prepare('SELECT * FROM platform_identity_challenges').get();assert.ok(!JSON.stringify(before).includes('owner@alpha.example"kind'));await f.service.deliverNext(async mail=>{captured=mail;assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_identity_challenges').all()).includes(mail.token));});assert.ok(captured);assert.equal(f.db.prepare('SELECT encrypted_delivery FROM platform_identity_challenges').get().encrypted_delivery,'');}finally{f.db.close();}
});
test('verification cannot claim another login mailbox or rebind a verified address',async()=>{
 const f=await fixture();try{await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'reserved@alpha.example',password:'fixture-password-123',role:'viewer'});await assert.rejects(async ()=>await f.service.requestVerification(f.a.userId,'reserved@alpha.example','fixture-password-123','en'));const token=await proof(f);await f.service.verify(token);await assert.rejects(async ()=>await f.service.requestVerification(f.a.userId,'new@alpha.example','fixture-password-123','en'));}finally{f.db.close();}
});
test('reset only uses explicitly verified accounts, does not enumerate and never targets legacy',async ()=>{
 const f=await fixture();try{for(const email of ['unknown@alpha.example','admin@alpha.example'])assert.equal(await f.service.request('reset',email,'en'),undefined);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_identity_challenges').get().n,0);}finally{f.db.close();}
});
test('password reset is single-use, invalidates prior sessions and preserves project boundaries',async()=>{
 const f=await fixture();try{const verified=await proof(f);await f.service.verify(verified);const token=await proof(f,'reset');await f.service.reset(token,'new-password-fixture-123');assert.equal(await securityVersion(f.db,f.a.userId),1);assert.equal(await f.repo.authenticate('alpha','fixture-password-123'),null);assert.equal((await f.repo.authenticate('alpha','new-password-fixture-123')).id,f.a.userId);await assert.rejects(async ()=>await f.service.reset(token,'another-password-fixture'));assert.equal((await f.repo.workspaces(f.a.userId)).length,1);assert.equal(await f.repo.workspace(f.a.userId,'crewin','crewinjob'),null);}finally{f.db.close();}
});
test('expired, wrong-purpose and changed-security-version proofs fail closed',async()=>{
 const f=await fixture();try{const token=await proof(f);await assert.rejects(async ()=>await f.service.reset(token,'new-password-fixture-123'));f.db.prepare('UPDATE platform_identity_challenges SET expires_at=?').run(Date.now()-1);await assert.rejects(async ()=>await f.service.verify(token));const second=await proof(f);await new PlatformAccounts(f.db).changePassword({subject:f.a.userId,organizationId:f.a.organizationId,projectId:f.a.projectId},'fixture-password-123','changed-password-fixture');await assert.rejects(async ()=>await f.service.verify(second));}finally{f.db.close();}
});
test('configuration changes and disabled accounts invalidate proofs before use and before delivery',async()=>{
 const f=await fixture();try{const token=await proof(f);process.env.PLATFORM_AUTH_ORIGIN='https://other.example';await assert.rejects(async ()=>await f.service.verify(token));configure();f.db.prepare('UPDATE platform_users SET active=0 WHERE id=?').run(f.a.userId);await assert.rejects(async ()=>await f.service.verify(token));}finally{f.db.close();}
});
test('worker has one durable attempt, no automatic retries after timeout or crash',async()=>{
 const f=await fixture();try{await f.service.request('signup','new@example.com','en');let calls=0;await f.service.deliverNext(async()=>{calls++;throw new Error('timeout');});assert.equal(calls,1);assert.equal(f.db.prepare('SELECT delivery_state FROM platform_identity_challenges').get().delivery_state,'uncertain');assert.equal(await f.service.deliverNext(async()=>calls++),false);assert.equal(calls,1);}finally{f.db.close();}
});
test('outbox rechecks flag/configuration before delivering and expires encrypted payloads',async()=>{
 const f=await fixture();try{await f.service.request('signup','new@example.com','en');process.env.PLATFORM_AUTH_EMAIL_ENABLED='0';assert.equal(await f.service.deliverNext(async()=>assert.fail()),false);configure();process.env.PLATFORM_AUTH_FROM_EMAIL='changed@ryzevo.example';assert.equal(await f.service.deliverNext(async()=>assert.fail()),false);assert.equal(f.db.prepare('SELECT delivery_state FROM platform_identity_challenges').get().delivery_state,'blocked');f.db.prepare('UPDATE platform_identity_challenges SET expires_at=?').run(Date.now()-1);await f.service.prune();assert.equal(f.db.prepare('SELECT encrypted_delivery FROM platform_identity_challenges').get().encrypted_delivery,'');}finally{f.db.close();}
});
test('public signup remains off unless both explicit switches and complete sender configuration exist',async ()=>{
 const f=await fixture();try{process.env.PLATFORM_PUBLIC_SIGNUP_ENABLED='0';await f.service.request('signup','new@example.com','en');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_identity_challenges').get().n,0);assert.equal(f.service.capabilities().signupEnabled,false);}finally{f.db.close();}
});
test('verified signup creates exactly one isolated standard workspace with no Crewin tools or paid privileges',async()=>{
 const f=await fixture();try{const token=await proof(f,'signup','new@example.com');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_users').get().n,2);const created=await f.service.register(token,{organizationName:'Startup',projectName:'Independent',website:'https://startup.example',password:'new-signup-password-123',timezone:'UTC',productPack:'crewin',organizationId:'crewin'});assert.equal((await f.service.account(created.userId)).email,'new@example.com');const workspace=(await f.repo.workspaces(created.userId))[0];assert.equal(workspace.project.productPack,'standard');assert.equal(workspace.project.timezone,'UTC');assert.equal(await f.repo.workspace(created.userId,'crewin','crewinjob'),null);assert.equal(await f.repo.workspace(created.userId,f.a.organizationId,f.a.projectId),null);await assert.rejects(async ()=>await f.service.register(token,{organizationName:'Again',projectName:'Again',website:'https://startup.example',password:'new-signup-password-123'}));assert.equal((await f.repo.authenticate('new@example.com','new-signup-password-123')).id,created.userId);}finally{f.db.close();}
});
test('invalid registration rolls back without consuming proof or leaving orphaned tenants',async()=>{
 const f=await fixture();try{const token=await proof(f,'signup','new@example.com');await assert.rejects(async ()=>await f.service.register(token,{organizationName:'Startup',projectName:'Product',website:'javascript:evil',password:'new-signup-password-123'}));assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_organizations').get().n,2);assert.equal((await f.service.inspect(token,'signup')).valid,true);assert.equal(f.db.pragma('foreign_key_check').length,0);}finally{f.db.close();}
});
test('verified self-service signup atomically starts one trial, while administrator provision remains pilot',async()=>{
 const f=await fixture();try{const token=await proof(f,'signup','trial-owner@example.com');const created=await f.service.register(token,{organizationName:'Trial',projectName:'Trial',website:'https://trial.example',password:'trial-signup-password-123',mode:'pilot',paid:true});const {ProjectUsage}=load('project-usage.ts');const read=async project=>await new ProjectUsage(f.db,{subject:project.userId,organizationId:project.organizationId,projectId:project.projectId}).read();assert.equal((await read(created)).plan.id,'trial');assert.equal((await read(created)).deliveryAllowed,false);assert.equal((await read(f.a)).plan.id,'pilot');assert.equal(f.db.prepare('SELECT trial_owner_id FROM platform_project_entitlements WHERE project_id=?').get(created.projectId).trial_owner_id,created.userId);await assert.rejects(async ()=>await f.service.register(token,{organizationName:'Again',projectName:'Again',website:'https://trial.example',password:'trial-signup-password-123'}));assert.equal(f.db.pragma('foreign_key_check').length,0);}finally{f.db.close();}
});

test('same mailbox throttles across reset/signup, uses hashed limits and retains bounded records',async ()=>{
 const f=await fixture();try{for(let i=0;i<10;i++)await f.service.request('signup','new@example.com','en');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_identity_challenges').get().n,3);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_identity_challenges WHERE used_at IS NULL').get().n,1);assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_login_limits').all()).includes('new@example.com'));}finally{f.db.close();}
});
test('global anonymous cap cannot be bypassed by rotating mailbox or forwarding headers',async ()=>{
 const f=await fixture();try{for(let i=0;i<110;i++)await f.service.request('signup',`new${i}@example.com`,'en');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_identity_challenges').get().n,100);}finally{f.db.close();}
});
test('identity email uses trusted origin and secret fragment, has no tracking or marketing pixels',()=>{
 const message=identityEmailMessage({to:'new@example.com',kind:'reset',token:'a'.repeat(43),language:'en'},'https://ryzevo.example');assert.match(message.text,/https:\/\/ryzevo.example\/recover#token=/);assert.ok(!message.text.includes('?token='));assert.ok(!message.text.includes('<img'));assert.ok(!message.text.includes('unsubscribe'));
});
test('migration22 is additive and repeatable, retaining existing users, memberships and queued work',async()=>{
 const fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'identity-migration-')),'fixture.sqlite'),f=await fixture();
 let db;try{require('./schema-fixture.cjs').removeIdentitySchema(f.db);assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n,21);await f.db.backup(file);db=openPlatformDatabase(file);assert.equal((await new PlatformRepository(db).authenticate('alpha','fixture-password-123')).id,f.a.userId);assert.equal((await new PlatformRepository(db).workspaces(f.a.userId)).length,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_account_emails').get().n,0);db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n,79);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);}finally{db?.close();f.db.close();}
});
test('dedicated SES transport submits once with fixed endpoint, one recipient and tracking forcibly disabled',async()=>{
 configure();const {deliverIdentityEmail}=load('identity-email.ts');let called=0,destroyed=0,options,input;
 const client=configuration=>{options=configuration;return {send:async command=>{called++;input=command.input;return {MessageId:'fake-aws-receipt'};},destroy:()=>destroyed++};};
 await deliverIdentityEmail({to:'new@example.com',kind:'reset',token:'a'.repeat(43),language:'en'},identityEmailConfiguration(),client);
 assert.equal(called,1);assert.equal(destroyed,1);assert.equal(options.endpoint,'https://email.eu-west-1.amazonaws.com');assert.equal(options.maxAttempts,1);assert.equal(input.Destination.ToAddresses.length,1);assert.equal(input.ConfigurationOverrides.Tracking.ClickTrackingEnabled,'DISABLED');assert.equal(input.ConfigurationOverrides.Tracking.OpenTrackingEnabled,'DISABLED');assert.equal(input.ConfigurationSetName,undefined);assert.equal(input.FromEmailAddress,'accounts@ryzevo.example');
 await assert.rejects(()=>deliverIdentityEmail({to:'new@example.com',kind:'reset',token:'a'.repeat(43),language:'en'},identityEmailConfiguration(),()=>({send:async()=>({}),destroy:()=>destroyed++})));assert.equal(destroyed,2);
});
test('password reset cancels only actor outbound work, preserves accepted/uncertain receipts and other members',async()=>{
 configure();const f=await require('./email-pilot-fixture.cjs').fixture();try{
   const service=new PlatformIdentity(f.db,KEY),wrapped={...f,service};
   const token=await proof(wrapped);await service.verify(token);
   const job=await f.queue.enqueue(await f.input(await f.approve(),'reset-pending-mail'));
   f.db.prepare("UPDATE platform_jobs SET job_type='email.pilot_send',status='running' WHERE id=?").run(job.id);
   f.db.prepare("UPDATE platform_email_pilots SET mode='send' WHERE job_id=?").run(job.id);
   f.db.prepare("UPDATE platform_email_pilot_recipients SET state='accepted',provider_message_id='fake-accepted' WHERE job_id=? AND position=1").run(job.id);
   f.db.prepare("UPDATE platform_email_pilot_recipients SET state='submitting' WHERE job_id=? AND position=2").run(job.id);
   const {SocialPublications}=load('social-publications.ts');
   const connection=await f.store.saveConnection({provider:'social',integrationId:'reset-qa',accountName:'QA',accessToken:'fake',social:{platform:'linkedin',accountId:'qa_member'}},KEY);
   await f.store.saveContent({id:'reset-content',platform:'linkedin',language:'en',content:'Disposable QA',timestamp:Date.now()},true);
   const social=new SocialPublications(f.db,f.scope,KEY),view=await social.workspace(),source=view.sources[0],socialJob=await social.enqueue({sourceKind:'content',sourceId:source.id,expectedDigest:source.digest,expectedTargetRevision:view.targets.find(t=>t.id===connection.id).revision,connectionId:connection.id,mode:'rehearsal',idempotencyKey:'reset-social'});
   const reset=await proof(wrapped,'reset');await service.reset(reset,'recovery-fixture-password-123');
   assert.equal(f.db.prepare('SELECT status FROM platform_jobs WHERE id=?').get(job.id).status,'cancelled');
   const recipients=f.db.prepare('SELECT state,provider_message_id FROM platform_email_pilot_recipients WHERE job_id=? ORDER BY position').all(job.id);
   assert.equal(recipients[0].state,'accepted');assert.equal(recipients[0].provider_message_id,'fake-accepted');assert.equal(recipients[1].state,'uncertain');assert.ok(recipients.slice(2).every(r=>r.state==='cancelled'));
   assert.equal(f.db.prepare('SELECT state FROM platform_social_publications WHERE job_id=?').get(socialJob.id).state,'blocked');assert.equal(f.db.prepare('SELECT status FROM platform_jobs WHERE id=?').get(socialJob.id).status,'cancelled');
   assert.equal(await securityVersion(f.db,f.b.userId),0);assert.ok(await f.repo.authenticate('beta','fixture-password-123'));assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE operation='account.credentials_changed' AND actor_id=?").get(f.a.userId).n,1);
 }finally{f.db.close();}
});
