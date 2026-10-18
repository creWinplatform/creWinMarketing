const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs');
const {load}=require('./platform-loader.cjs'),{decryptCredentials}=load('credential-envelope.ts');
const snapshot=(f,id)=>decryptCredentials(f.db.prepare('SELECT encrypted_snapshot FROM platform_email_pilots WHERE job_id=?').get(id).encrypted_snapshot,KEY,f.scope.organizationId,f.scope.projectId,id);

test('rehearsal requires current approval, fresh preflight, acknowledgement, selected sender and scoped pilot audience',()=>{
 const f=fixture();try{
  const before=f.reviews.check(f.campaign.id,f.reviews.get(f.campaign.id).digest);
  assert.throws(()=>f.queue.enqueue({campaignId:f.campaign.id,expectedDigest:before.digest,expectedReviewId:1,idempotencyKey:'unapproved-fixture',acknowledged:true}),e=>e.status===409);
  const input=f.input(f.approve());assert.throws(()=>f.queue.enqueue({...input,acknowledged:false}));
  const job=f.queue.enqueue(input);assert.equal(job.total,5);assert.equal(job.mode,'rehearsal');assert.equal(job.sendingEnabled,false);assert.equal(job.gates.authentication,false);
  const visible=JSON.stringify(job);for(const secret of ['private-smtp-password','pilot0@example.com','fixture-user','hello@example.com'])assert.ok(!visible.includes(secret));
  const stored=f.db.prepare('SELECT * FROM platform_email_pilots').get();assert.ok(!JSON.stringify(stored).includes('pilot0@example.com'));assert.equal(snapshot(f,job.id).recipients.length,5);
  const keys=Array.from(snapshot(f,job.id).recipients,r=>r.emailKey);assert.deepEqual(keys,[...keys].sort());
  const viewer=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'viewer',password:'fixture-password-123',role:'viewer'}),q=new f.EmailPilotQueue(f.db,{...f.scope,subject:viewer.userId},KEY);assert.equal(q.get(job.id).canManage,false);assert.equal(q.get(job.id).recipients.length,0);assert.equal(q.get(job.id).sender.maskedSender,null);assert.equal(q.get(job.id).total,5);assert.throws(()=>q.enqueue(input),e=>e.status===403);assert.throws(()=>q.cancel(job.id),e=>e.status===403);
  assert.throws(()=>new f.EmailPilotQueue(f.db,f.other,KEY).get(job.id),e=>e.status===404);
 }finally{f.db.close();}
});

test('idempotency survives cancellation and cannot change the campaign revision; connection queue stays independent',async()=>{
 const f=fixture();try{
  const input=f.input(f.approve()),job=f.queue.enqueue(input);assert.equal(f.queue.enqueue(input).id,job.id);
  assert.throws(()=>f.queue.enqueue({...input,idempotencyKey:'second-active-job'}),e=>e.status===409);assert.throws(()=>f.queue.enqueue({...input,expectedDigest:'a'.repeat(64)}),e=>e.status===409);
  const connections=new f.ConnectionJobs(f.db,f.scope);assert.equal(connections.list().length,0);assert.throws(()=>connections.cancel(job.id),e=>e.status===404);await assert.rejects(()=>connections.run(job.id,KEY),e=>e.status===404);
  assert.equal(connections.enqueue(f.connection.id,'parallel-verification').status,'queued');
  f.queue.cancel(job.id);assert.equal(f.queue.enqueue(input).status,'cancelled');assert.equal(f.db.prepare("SELECT count FROM platform_usage WHERE resource='email_rehearsal'").get().count,1);
 }finally{f.db.close();}
});

test('bounded worker validates each unique recipient once, never sends and never marks sender authentication verified',async()=>{
 const f=fixture();try{
  const job=f.queue.enqueue(f.input(f.approve()));let calls=0;await f.queue.process(job.id,async()=>{calls++;});
  const done=f.queue.get(job.id);assert.equal(done.status,'completed');assert.equal(done.checked,5);assert.equal(done.outcome,'blocked');assert.equal(done.sendingEnabled,false);assert.equal(done.gates.authentication,false);assert.equal(done.attempts,1);assert.equal(calls,5);
  await f.queue.process(job.id,async()=>{calls++;});assert.equal(calls,5);assert.equal(f.queue.get(job.id).attempts,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_connection_checks').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_unsubscribe').get().n,0);
 }finally{f.db.close();}
});

test('suppression and allowlist removal during an in-flight check block that recipient before finalization',async()=>{
 const f=fixture();try{
  const job=f.queue.enqueue(f.input(f.approve())),frozen=snapshot(f,job.id);
  await f.queue.process(job.id,async position=>{if(position===1)f.recipients.suppress({email:frozen.recipients[0].email,acknowledged:true});if(position===2){const sender=f.senders.get();f.senders.remove({id:frozen.recipients[1].emailKey,expectedRevision:sender.readiness.revision});}});
  const done=f.queue.get(job.id);assert.equal(done.checked,3);assert.equal(done.skipped,2);assert.equal(done.recipients[0].reason,'recipient_ineligible');assert.equal(done.recipients[1].reason,'recipient_ineligible');assert.equal(done.outcome,'partial');
 }finally{f.db.close();}
});

test('content, sender and source changes stop old snapshot checks instead of silently refreshing a message',async()=>{
 for(const change of ['content','sender','source']){
  const f=fixture();try{
   const job=f.queue.enqueue(f.input(f.approve()));await f.queue.process(job.id,async position=>{if(position!==1)return;if(change==='content')f.store.saveCampaign({...f.campaign,content:{...f.campaign.content,text:'New content'},updatedAt:new Date().toISOString()},false);if(change==='sender')f.senders.select({connectionId:f.connection.id,maxRecipients:3,expectedRevision:f.senders.get().readiness.revision});if(change==='source')f.hooks.state(f.source.id,1,'pause');});
   assert.equal(f.queue.get(job.id).checked,0);assert.equal(f.queue.get(job.id).skipped,5);assert.ok(f.queue.get(job.id).recipients.every(r=>r.reason==='changed'));
  }finally{f.db.close();}
 }
});

test('worker finalizes revoked initiator work without requiring a stale session or restoring authority',async()=>{
 const f=fixture();try{
  const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'manager',password:'fixture-password-123',role:'admin'}),scope={...f.scope,subject:admin.userId},reviews=new f.CampaignReviews(f.db,scope,KEY),queue=new f.EmailPilotQueue(f.db,scope,KEY),job=queue.enqueue(f.input(f.approve(reviews)));
  await queue.process(job.id,async position=>{if(position===1)f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'viewer',true);});
  const done=f.queue.get(job.id);assert.equal(done.checked,0);assert.ok(done.recipients.every(r=>r.reason==='authority_lost'));assert.equal(done.status,'failed');
 }finally{f.db.close();}
});

test('concurrent workers and in-flight cancellation cannot overwrite terminal recipient results',async()=>{
 const f=fixture();try{
  const job=f.queue.enqueue(f.input(f.approve()));let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const running=f.queue.process(job.id,async()=>{entered();await gate;});await started;
  await f.queue.process(job.id,async()=>assert.fail('Second worker claimed a live lease'));assert.equal(f.queue.get(job.id).attempts,1);
  const cancelled=f.queue.cancel(job.id);assert.equal(cancelled.uncertain,1);assert.equal(cancelled.cancelled,4);release();await running;
  const final=f.queue.get(job.id);assert.equal(final.status,'cancelled');assert.equal(final.checked,0);assert.equal(final.uncertain,1);await f.queue.process(job.id);assert.equal(f.queue.get(job.id).attempts,1);
 }finally{f.db.close();}
});

test('expired lease recovery never retries an interrupted recipient and safely resumes only untouched rows',async()=>{
 const f=fixture();try{
  const job=f.queue.enqueue(f.input(f.approve()));f.db.prepare("UPDATE platform_jobs SET status='running',attempts=1,lease_token='old',lease_until='2000-01-01T00:00:00Z' WHERE id=?").run(job.id);f.db.prepare("UPDATE platform_email_pilot_recipients SET state='checking' WHERE job_id=? AND position=1").run(job.id);
  const visited=[];await f.queue.process(job.id,async position=>visited.push(position));assert.deepEqual(visited,[2,3,4,5]);const done=f.queue.get(job.id);assert.equal(done.uncertain,1);assert.equal(done.checked,4);assert.equal(done.status,'failed');assert.equal(done.outcome,'interrupted');
 }finally{f.db.close();}
});

test('failed checks are redacted, terminal and not blindly retried',async()=>{
 const f=fixture();try{
  const job=f.queue.enqueue(f.input(f.approve()));await f.queue.process(job.id,async position=>{if(position===1)throw new Error('private-provider-payload');});const done=f.queue.get(job.id);assert.equal(done.uncertain,1);assert.equal(done.recipients[0].reason,'interrupted');assert.ok(!JSON.stringify(done).includes('private-provider-payload'));await f.queue.process(job.id);assert.equal(f.queue.get(job.id).attempts,1);
 }finally{f.db.close();}
});

test('expiry and durable quotas fail closed and repeated key does not reserve a second quota',async()=>{
 const f=fixture();try{
  const input=f.input(f.approve()),job=f.queue.enqueue(input);f.db.prepare("UPDATE platform_usage SET count=20 WHERE resource='email_rehearsal'").run();assert.equal(f.queue.enqueue(input).id,job.id);f.queue.cancel(job.id);assert.throws(()=>f.queue.enqueue({...input,idempotencyKey:'quota-new-intent'}),e=>e.status===429);
  f.db.prepare("UPDATE platform_usage SET count=1 WHERE resource='email_rehearsal'").run();const fresh=f.queue.enqueue({...input,idempotencyKey:'expiry-new-intent'});f.db.prepare("UPDATE platform_jobs SET created_at='2000-01-01T00:00:00Z' WHERE id=?").run(fresh.id);await f.queue.process(fresh.id);assert.ok(f.queue.get(fresh.id).recipients.every(r=>r.reason==='expired'));
 }finally{f.db.close();}
});

test('schema17 restart preserves queue, encrypted snapshot and legacy connection work',async()=>{
 const f=fixture(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pilot-restart-')),'fixture.sqlite'),{openPlatformDatabase}=load('database.ts');let db;
 try{
  const job=f.queue.enqueue(f.input(f.approve())),connectionJob=new f.ConnectionJobs(f.db,f.scope).enqueue(f.connection.id,'preserved-verify');await f.db.backup(file);db=openPlatformDatabase(file);
  const queue=new f.EmailPilotQueue(db,f.scope,KEY);assert.equal(queue.get(job.id).status,'queued');assert.equal(new f.ConnectionJobs(db,f.scope).list(connectionJob.id).status,'queued');await queue.process(job.id);assert.equal(queue.get(job.id).checked,5);db.close();db=openPlatformDatabase(file);assert.equal(new f.EmailPilotQueue(db,f.scope,KEY).get(job.id).checked,5);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_migrations WHERE version=17').get().n,1);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);
 }finally{db?.close();f.db.close();}
});

test('manual runner authority is rechecked independently of the job initiator',async()=>{
 const f=fixture();try{
  const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'runner',password:'fixture-password-123',role:'admin'}),scope={...f.scope,subject:admin.userId},queue=new f.EmailPilotQueue(f.db,scope,KEY),job=f.queue.enqueue(f.input(f.approve()));
  const process=queue.process.bind(queue);queue.process=(id,_,runner)=>{assert.equal(runner,admin.userId);return process(id,async position=>{if(position===1)f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'viewer',true);},runner);};
  const result=await queue.run(job.id);assert.equal(result.canManage,false);assert.equal(result.recipients.length,0);assert.equal(f.queue.get(job.id).checked,0);assert.ok(f.queue.get(job.id).recipients.every(r=>r.reason==='authority_lost'));
 }finally{f.db.close();}
});

test('lease expiry during a synchronous live check cannot commit a validated result',async()=>{
 const f=fixture();try{
  const job=f.queue.enqueue(f.input(f.approve())),reason=f.queue.liveReason.bind(f.queue);let calls=0;
  f.queue.liveReason=(...args)=>{const result=reason(...args);if(++calls===2)f.db.prepare("UPDATE platform_jobs SET lease_until='2000-01-01T00:00:00Z' WHERE id=?").run(job.id);return result;};
  await f.queue.process(job.id);assert.equal(f.queue.get(job.id).checked,0);assert.equal(f.queue.get(job.id).recipients[0].state,'checking');f.queue.liveReason=reason;await f.queue.process(job.id);assert.equal(f.queue.get(job.id).recipients[0].state,'uncertain');assert.equal(f.queue.get(job.id).checked,4);
 }finally{f.db.close();}
});

test('trusted worker settles revoked legacy jobs and null-lease recovery agrees with its claim predicate',async()=>{
 const f=fixture();try{
  const {settleUnauthorizedConnectionJob}=load('connection-jobs.ts'),admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'old-manager',password:'fixture-password-123',role:'admin'}),scope={...f.scope,subject:admin.userId},jobs=new f.ConnectionJobs(f.db,scope),job=jobs.enqueue(f.connection.id,'revoked-connection-job');
  f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'viewer',true);assert.equal(settleUnauthorizedConnectionJob(f.db,scope,job.id),true);assert.equal(new f.ConnectionJobs(f.db,f.scope).list(job.id).status,'failed');assert.equal(settleUnauthorizedConnectionJob(f.db,scope,job.id),false);
  const live=new f.ConnectionJobs(f.db,f.scope),recover=live.enqueue(f.connection.id,'null-lease-job');f.db.prepare("UPDATE platform_jobs SET status='running',lease_until=NULL WHERE id=?").run(recover.id);
  const done=await live.run(recover.id,KEY,undefined,undefined,async()=>({status:'verified',message:'Isolated access fixture; never sends.'}));assert.equal(done.status,'completed');assert.equal(done.attempts,1);
 }finally{f.db.close();}
});

test('independent SQLite connections cannot claim the same rehearsal concurrently',async()=>{
 const f=fixture(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pilot-two-workers-')),'fixture.sqlite'),{openPlatformDatabase}=load('database.ts');let db1,db2;
 try{
  const job=f.queue.enqueue(f.input(f.approve()));await f.db.backup(file);db1=openPlatformDatabase(file);db2=openPlatformDatabase(file);const q1=new f.EmailPilotQueue(db1,f.scope,KEY),q2=new f.EmailPilotQueue(db2,f.scope,KEY);let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const running=q1.process(job.id,async position=>{if(position===1){entered();await gate;}});await started;await q2.process(job.id,async()=>assert.fail('Second SQLite connection claimed job'));assert.equal(q2.get(job.id).attempts,1);release();await running;assert.equal(q2.get(job.id).checked,5);assert.equal(q2.get(job.id).attempts,1);
 }finally{db1?.close();db2?.close();f.db.close();}
});

test('migration from schema16 adds rehearsal tables once and preserves existing connection work',async()=>{
 const f=fixture(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pilot-migrate16-')),'fixture.sqlite'),{openPlatformDatabase}=load('database.ts');let db;
 try{
  const job=new f.ConnectionJobs(f.db,f.scope).enqueue(f.connection.id,'schema16-job');require('./schema-fixture.cjs').removeMeasurementSchema(f.db);f.db.exec('DROP TABLE platform_email_send_reservations; DROP TABLE platform_email_ses_receipts; DROP TABLE platform_email_ses_topics; DROP TABLE platform_email_ses; DROP TABLE platform_email_pilot_recipients; DROP TABLE platform_email_pilots; DROP INDEX platform_job_scoped_identity; DELETE FROM platform_migrations WHERE version>=17;');assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n,16);await f.db.backup(file);db=openPlatformDatabase(file);assert.equal(new f.ConnectionJobs(db,f.scope).list(job.id).status,'queued');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_email_pilots').get().n,0);db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_migrations WHERE version=17').get().n,1);assert.equal(db.pragma('foreign_key_check').length,0);
 }finally{db?.close();f.db.close();}
});
