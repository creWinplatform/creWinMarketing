const assert=require('node:assert/strict'),{test}=require('node:test'),{createHash,randomBytes,createHmac}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{ProjectMarketingStore}=load('marketing-store.ts'),{ConnectionJobs}=load('connection-jobs.ts');
const {EmailSenders,emailSenderReadiness,emailPilotCounts}=load('email-sender.ts'),{checkSenderDomain,domainRecordName,senderDomain}=load('email-domain.ts');
const {emailIdentity,blockEmail}=load('email-safety.ts'),{EmailRecipients}=load('email-recipients.ts'),{ProductWebhooks,authenticateProductWebhook}=load('product-webhooks.ts'),{ProductSegments}=load('segments.ts'),{CampaignReviews}=load('campaign-review.ts');
const KEY='12'.repeat(32),hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
 const provision=username=>repo.provision('legacy-admin',{organizationName:username,projectName:username,website:'https://example.com',username,password:'fixture-password-123'}),a=provision('alpha'),b=provision('beta'),scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId},other={subject:b.userId,organizationId:b.organizationId,projectId:b.projectId};
 const store=new ProjectMarketingStore(db,scope),senders=new EmailSenders(db,scope,KEY),smtp={host:'smtp.sendgrid.net',port:587,user:'fixture-smtp-user',fromEmail:'hello@example.com',fromName:'Fixture'};
 const connection=store.saveConnection({provider:'email',integrationId:'fixture-smtp',accountName:'QA SMTP',accessToken:'private-smtp-password',smtp},KEY);
 const select=(who=senders,maximum=5)=>who.select({connectionId:connection.id,maxRecipients:maximum,expectedRevision:who.get().readiness.revision});
 const allow=(email,who=senders)=>who.allow({email,acknowledged:true,expectedRevision:who.get().readiness.revision});
 const access=id=>{const row=db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(id);db.prepare('INSERT INTO platform_connection_checks VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,checked_at=excluded.checked_at').run(id,hash(row.encrypted_credentials),'verified',new Date().toISOString(),'Fixture access check; never sent.');};
 const verify=(who=senders)=>{const current=who.get(),value=current.dnsRecord.value;return who.verify(current.readiness.revision,(domain,digest)=>checkSenderDomain(domain,digest,()=>({resolveTxt:async()=>[[value.slice(0,18),value.slice(18)]],cancel(){}})));};
 return {db,repo,a,b,scope,other,store,senders,smtp,connection,select,allow,access,verify};
}
test('sender DNS adapter constrains names, compares exact chunked TXT and never infers SPF/DKIM or delivery',async()=>{
 const token='ryzevo-verify=v1.'+'a'.repeat(43);let cancelled=0,queried='';
 const result=await checkSenderDomain('Example.COM',hash(token),()=>({resolveTxt:async name=>{queried=name;return [['unrelated'],[token.slice(0,10),token.slice(10)]];},cancel(){cancelled++;}}));
 assert.equal(result.verified,true);assert.equal(queried,'_ryzevo-verification.example.com');assert.equal(cancelled,1);assert.ok(!JSON.stringify(result).includes(token));
 assert.equal((await checkSenderDomain('example.com',hash(token),()=>({resolveTxt:async()=>[[token+' ']],cancel(){}}))).error,'not_found');
 assert.equal((await checkSenderDomain('example.com',hash(token),()=>({resolveTxt:async()=>{throw {code:'ENODATA'};},cancel(){}}))).error,'not_found');
 assert.equal((await checkSenderDomain('example.com',hash(token),()=>({resolveTxt:async()=>{throw {code:'ETIMEOUT'};},cancel(){}}))).error,'unavailable');
 assert.equal((await checkSenderDomain('example.com',hash(token),()=>({resolveTxt:async()=>Array.from({length:65},()=>['x']),cancel(){}}))).error,'too_large');
 for(const domain of ['localhost','127.0.0.1','example.local','user@example.com','example.com/path','-bad.example.com','x..example.com',`${'a'.repeat(64)}.com`])assert.throws(()=>senderDomain(domain));
 assert.ok(domainRecordName('example.com').length<=253);
});
test('DNS lookup cancels a non-responsive resolver within its hard deadline', {timeout:7000},async()=>{
 let cancelled=0;const start=Date.now(),value=await checkSenderDomain('example.com','a'.repeat(64),()=>({resolveTxt:()=>new Promise(()=>{}),cancel(){cancelled++;}}));assert.equal(value.error,'unavailable');assert.ok(cancelled>0);assert.ok(Date.now()-start<6000);
});
test('sender selection is scoped, explicit, revision-bound and masks credentials and sender address',()=>{
 const f=fixture();try{
  const initial=f.senders.get();assert.equal(initial.readiness.ownership,'not_configured');assert.equal(initial.readiness.smtpReady,false);
  for(const maximum of [0,6,1.5,'5',true])assert.throws(()=>f.senders.select({connectionId:f.connection.id,maxRecipients:maximum,expectedRevision:0}));
  assert.throws(()=>new EmailSenders(f.db,f.other,KEY).select({connectionId:f.connection.id,maxRecipients:5,expectedRevision:0}),error=>error.status===404);
  const selected=f.select();assert.equal(selected.readiness.ownership,'pending');assert.equal(selected.readiness.maxRecipients,5);assert.equal(selected.authentication,'not_verified');assert.equal(selected.sendingEnabled,false);
  const visible=JSON.stringify(selected);for(const secret of ['private-smtp-password','fixture-smtp-user','hello@example.com'])assert.ok(!visible.includes(secret));
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_email_sender').get()).includes(selected.dnsRecord.value));
  assert.throws(()=>f.senders.select({connectionId:f.connection.id,maxRecipients:2,expectedRevision:0}),error=>error.status===409);
  const editor=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'editor',password:'fixture-password-123',role:'editor'});assert.throws(()=>new EmailSenders(f.db,{...f.scope,subject:editor.userId},KEY).get(),error=>error.status===403);
  assert.throws(()=>new EmailSenders(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'},KEY).get(),error=>error.status===403);
 }finally{f.db.close();}
});
test('only selected SMTP access counts and changed credentials/revocation fail closed',async()=>{
 const f=fixture();try{
  f.select();const second=f.store.saveConnection({provider:'email',integrationId:'other',accountName:'Other SMTP',accessToken:'other-secret',smtp:f.smtp},KEY);f.access(second.id);assert.equal(f.senders.get().readiness.smtpReady,false);
  f.access(f.connection.id);assert.equal(f.senders.get().readiness.smtpReady,true);await f.verify();assert.equal(f.senders.get().readiness.ownership,'verified');
  f.store.saveConnection({id:f.connection.id,provider:'email',integrationId:'fixture-smtp',accountName:'Changed SMTP',accessToken:'changed-password',smtp:f.smtp},KEY);assert.equal(f.senders.get().readiness.ownership,'connection_changed');assert.equal(f.senders.get().dnsRecord,null);assert.equal(f.senders.get().readiness.smtpReady,false);
  f.select();assert.equal(f.senders.get().readiness.ownership,'pending');f.store.revokeConnection(f.connection.id);assert.equal(f.senders.get().readiness.ownership,'inactive');
 }finally{f.db.close();}
});
test('DNS ownership is independent of authentication, expires, and is invalidated by failed rechecks/rotation',async()=>{
 const f=fixture();try{
  f.select();const value=(await f.verify());assert.equal(value.readiness.ownership,'verified');assert.equal(value.authentication,'not_verified');assert.equal(value.readiness.smtpReady,false);assert.equal(value.sendingEnabled,false);
  f.db.prepare('UPDATE platform_email_sender SET verified_at=?').run('2000-01-01T00:00:00Z');assert.equal(f.senders.get().readiness.ownership,'expired');await f.verify();
  const before=f.senders.get();const failed=await f.senders.verify(before.readiness.revision,async()=>({verified:false,error:'not_found'}));assert.equal(failed.readiness.ownership,'pending');assert.equal(failed.readiness.verifiedAt,null);assert.equal(failed.lastError,'not_found');
  await f.verify();const prior=f.senders.get(),renewed=f.senders.renew(prior.readiness.revision);assert.notEqual(renewed.dnsRecord.value,prior.dnsRecord.value);assert.equal(renewed.readiness.ownership,'pending');
  assert.equal((await f.senders.verify(renewed.readiness.revision,(domain,digest)=>checkSenderDomain(domain,digest,()=>({resolveTxt:async()=>[[prior.dnsRecord.value]],cancel(){}})))).readiness.ownership,'pending');
 }finally{f.db.close();}
});
test('concurrent sender changes and role revocation prevent stale DNS results from committing',async()=>{
 const f=fixture();try{
  f.select();const before=f.senders.get();await assert.rejects(()=>f.senders.verify(before.readiness.revision,async()=>{f.senders.renew(before.readiness.revision);return {verified:true,error:''};}),error=>error.status===409);assert.equal(f.senders.get().readiness.ownership,'pending');
  const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'sender-manager',password:'fixture-password-123',role:'admin'}),sender=new EmailSenders(f.db,{...f.scope,subject:admin.userId},KEY);
  // Re-select under this actor by explicitly rotating the challenge.
  sender.renew(sender.get().readiness.revision);const revision=sender.get().readiness.revision;
  await assert.rejects(()=>sender.verify(revision,async()=>{f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'editor',true);return {verified:true,error:''};}),error=>error.status===403);assert.notEqual(f.senders.get().readiness.ownership,'verified');
 }finally{f.db.close();}
});
test('allowlist is project-owned, bounded, idempotent, optimistic and cannot override suppression',()=>{
 const f=fixture();try{
  assert.throws(()=>f.allow('pilot@example.com'),error=>error.status===409);f.select();f.allow('Pilot@example.com');const current=f.senders.get();assert.equal(current.allowlist.length,1);f.allow('pilot@example.com');assert.equal(f.senders.get().readiness.revision,current.readiness.revision);
  const key=emailIdentity(f.scope,KEY,'email',['pilot@example.com']);assert.equal(current.allowlist[0].id,key);assert.ok(!JSON.stringify(current).includes('pilot@example.com'));
  assert.equal(emailPilotCounts(f.db,f.other,[key]).allowed,0);assert.throws(()=>new EmailSenders(f.db,f.other,KEY).remove({id:key,expectedRevision:0}),error=>error.status===404);
  assert.throws(()=>f.senders.remove({id:key,expectedRevision:current.readiness.revision-1}),error=>error.status===409);
  f.senders.remove({id:key,expectedRevision:current.readiness.revision});assert.equal(f.senders.get().allowlist.length,0);assert.equal(f.db.prepare('SELECT active FROM platform_email_pilot_allowlist').get().active,0);
  blockEmail(f.db,f.scope,key,'p***@e***','unsubscribe');assert.throws(()=>f.allow('pilot@example.com'),error=>error.status===409);
  for(let i=0;i<20;i++)f.allow(`pilot${i}@example.com`);assert.equal(f.senders.get().allowlist.length,20);assert.throws(()=>f.allow('extra@example.com'),error=>error.status===429);
 }finally{f.db.close();}
});
test('restoring an administrator never resurrects their domain proof or allowlist grants',async()=>{
 const f=fixture();try{
  f.select();const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'manager',password:'fixture-password-123',role:'admin'}),sender=new EmailSenders(f.db,{...f.scope,subject:admin.userId},KEY);sender.renew(sender.get().readiness.revision);await f.verify(sender);f.allow('pilot@example.com',sender);
  f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'editor',true);assert.equal(f.senders.get().readiness.ownership,'authority_lost');assert.equal(f.senders.get().allowlist.length,0);
  f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'admin',true);assert.equal(f.senders.get().readiness.ownership,'pending');assert.equal(f.senders.get().dnsRecord,null);assert.equal(f.senders.get().allowlist.length,0);
  const renewed=f.select();assert.ok(renewed.dnsRecord);assert.equal(renewed.readiness.ownership,'pending');
 }finally{f.db.close();}
});
test('pilot preflight intersects the existing consent engine with allowlist, deduplicates, caps and invalidates stale checks',async()=>{
 const f=fixture();try{
  f.select();f.access(f.connection.id);await f.verify();const hooks=new ProductWebhooks(f.db,f.scope),secret=randomBytes(32).toString('hex'),source=hooks.save({name:'Pilot contacts',secret,config:{entityType:'user',attributes:[{key:'email',type:'string'},{key:'completion',type:'number'}],eventNames:['profile.updated']}},KEY),at=new Date(Date.now()-10000).toISOString();
  const events=Array.from({length:7},(_,i)=>({id:`event-${i}`,entityId:`private-${i}`,eventName:'profile.updated',occurredAt:at,attributes:{email:`pilot${i}@example.com`,completion:20}})),body={sourceVersion:1,events};hooks.preview(source.id,body);hooks.state(source.id,1,'activate');const bytes=Buffer.from(JSON.stringify(body)),timestamp=String(Math.floor(Date.now()/1000)),headers=new Headers({'X-Ryzevo-Timestamp':timestamp,'X-Ryzevo-Signature':'v1='+createHmac('sha256',Buffer.from(secret,'hex')).update(`${timestamp}.${source.id}.`).update(bytes).digest('hex')});authenticateProductWebhook(f.db,source.id,headers,KEY)(bytes);
  const recipients=new EmailRecipients(f.db,f.scope,KEY);recipients.saveMapping({sourceId:source.id,sourceVersion:1,field:'email',expectedRevision:null});for(let i=0;i<6;i++)f.allow(`pilot${i}@example.com`);
  const members=events.map(event=>({id:event.entityId,attributes:event.attributes,observedAt:at})),none=[];assert.equal(recipients.eligibility(source.id,1,members,none).eligible,0);assert.equal(emailPilotCounts(f.db,f.scope,none).planned,0);
  for(const contact of recipients.list(source.id).contacts)recipients.review({sourceId:source.id,contactKey:contact.key,expectedDecisionId:null,decision:'reviewed',evidenceRef:'qa/consent',recordedAt:at,note:'Disposable fixture proof.',acknowledged:true});
  const segments=new ProductSegments(f.db,f.scope),segment=segments.save({name:'Pilot audience',definition:{sourceId:source.id,sourceVersion:1,maxAgeHours:24,goalId:'',stageIndex:null,rules:{kind:'group',op:'and',children:[{kind:'attribute',field:'completion',op:'lt',value:50}]}}});segments.preview({id:segment.id,version:1});const binding=segments.binding(segment.id,1,''),id='pilot-campaign';f.store.saveCampaign({id,name:'Pilot',status:'draft',updatedAt:new Date().toISOString(),content:{subject:'QA pilot',text:'Only a fixture.',ctaUrl:'https://example.com'},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]},segmentBinding:binding},true);
  const reviews=new CampaignReviews(f.db,f.scope,KEY),view=reviews.check(id,reviews.get(id).digest);assert.equal(view.eligibleRecipients,7);assert.deepEqual(JSON.parse(JSON.stringify(view.pilot)),{allowed:6,planned:5,notAllowlisted:1,maxRecipients:5});assert.equal(view.checks.find(c=>c.code==='smtp').state,'pass');assert.equal(view.checks.find(c=>c.code==='sender_domain').state,'pass');assert.equal(view.checks.find(c=>c.code==='sender_auth').state,'blocked');assert.equal(view.sendingEnabled,false);assert.ok(!JSON.stringify(view).includes('pilot0@example.com'));
  const approved=reviews.decide(id,{decision:'approved',expectedDigest:view.digest,expectedReviewId:null,note:'Fixture only.'});assert.equal(approved.approval,'approved');const current=f.senders.get();f.senders.remove({id:current.allowlist[0].id,expectedRevision:current.readiness.revision});assert.equal(reviews.get(id).approval,'approved');assert.equal(reviews.get(id).audience.fresh,false);assert.equal(reviews.get(id).pilot,null);
  f.select(f.senders,2);assert.equal(reviews.get(id).approval,'outdated');assert.equal(reviews.check(id,reviews.get(id).digest).pilot.planned,2);
 }finally{f.db.close();}
});
test('domain quotas persist, expired challenges cannot verify, and GET does not mutate policy',async()=>{
 const f=fixture();try{
  f.select();const before=f.senders.get().readiness.revision;f.senders.get();assert.equal(f.senders.get().readiness.revision,before);
  await f.senders.verify(before,async()=>({verified:false,error:'not_found'}));f.db.prepare("UPDATE platform_usage SET count=20 WHERE resource='email_domain_check'").run();await assert.rejects(()=>f.verify(),error=>error.status===429);
  f.db.prepare("UPDATE platform_usage SET count=0 WHERE resource='email_domain_check'").run();f.db.prepare('UPDATE platform_email_sender SET challenge_expires_at=?').run('2000-01-01T00:00:00Z');await assert.rejects(()=>f.verify(),error=>error.status===409);
  assert.equal(f.db.pragma('integrity_check',{simple:true}),'ok');assert.equal(f.db.pragma('foreign_key_check').length,0);
 }finally{f.db.close();}
});
test('migration 16 preserves encrypted SMTP settings and existing queued jobs and is repeatable',async()=>{
 const f=fixture(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'sender-migration-')),'fixture.sqlite');let db;
 try{
  const job=new ConnectionJobs(f.db,f.scope).enqueue(f.connection.id,'migration-fixture');const encrypted=f.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(f.connection.id).encrypted_credentials;
  f.db.exec('DROP TABLE platform_email_pilot_allowlist; DROP TABLE platform_email_sender; DELETE FROM platform_migrations WHERE version=16;');await f.db.backup(file);db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(f.connection.id).encrypted_credentials,encrypted);assert.equal(new ConnectionJobs(db,f.scope).list(job.id).status,'queued');db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_migrations WHERE version=16').get().n,1);assert.equal(db.pragma('foreign_key_check').length,0);
 }finally{db?.close();f.db.close();}
});
