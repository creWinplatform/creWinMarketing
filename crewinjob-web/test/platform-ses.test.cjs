const assert=require('node:assert/strict'),{test}=require('node:test'),{createHash,generateKeyPairSync,sign,randomUUID}=require('node:crypto');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SesProvider,sesSmtpPassword,verifySes}=load('ses-provider.ts'),{EmailSendJobs}=load('email-send-jobs.ts'),{decryptCredentials}=load('credential-envelope.ts'),{validateSnsNotification,receiveSesFeedback}=load('ses-feedback.ts'),{preparePilotMail,submitSmtpPilot}=load('email-delivery.ts');
const accessKeyId='AKIA'+'A'.repeat(16),secretAccessKey='a'.repeat(40),region='eu-west-1',topicArn=`arn:aws:sns:${region}:123456789012:ryzevo-qa`,configurationSet='ryzevo-qa';
const proof={identity:true,dkim:true,account:true,events:true,sandbox:true,mailFrom:'provider_managed'};
async function withSes(work){
 const origin=process.env.PLATFORM_PUBLIC_ORIGIN,enabled=process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED;process.env.PLATFORM_PUBLIC_ORIGIN='https://ryzevo.example';process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED='1';const f=fixture();
 try{
  f.smtp={host:`email-smtp.${region}.amazonaws.com`,port:587,user:accessKeyId,fromEmail:'hello@example.com',fromName:'Fixture'};
  f.store.saveConnection({id:f.connection.id,provider:'email',integrationId:'fixture-smtp',accountName:'SES fixture',accessToken:sesSmtpPassword(secretAccessKey,region),smtp:f.smtp},KEY);f.senders.select({connectionId:f.connection.id,maxRecipients:5,expectedRevision:f.senders.get().readiness.revision});await f.senders.verify(f.senders.get().readiness.revision,async()=>({verified:true,error:''}));
  const row=f.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(f.connection.id);f.db.prepare('INSERT INTO platform_connection_checks VALUES(?,?,?,?,?)').run(f.connection.id,createHash('sha256').update(row.encrypted_credentials).digest('hex'),'verified',new Date().toISOString(),'Isolated fixture access check.');
  f.ses=new SesProvider(f.db,f.scope,KEY);f.sesInput={accessKeyId,secretAccessKey,configurationSet,topicArn,expectedRevision:0};f.ses.save(f.sesInput);await f.ses.verify(1,async()=>proof);f.db.prepare('UPDATE platform_email_ses SET feedback_observed_at=?').run(new Date().toISOString());
  f.enqueue=(key='actual-fixture-key')=>f.queue.enqueue({...f.input(f.approve(),key),sendAcknowledged:true},'send');f.sends=new EmailSendJobs(f.db,f.scope,KEY);
  f.mail=(id,position=1)=>decryptCredentials(f.db.prepare('SELECT encrypted_message FROM platform_email_pilot_recipients WHERE job_id=? AND position=?').get(id,position).encrypted_message,KEY,f.scope.organizationId,f.scope.projectId,`${id}:${position}`);
  f.snapshot=id=>decryptCredentials(f.db.prepare('SELECT encrypted_snapshot FROM platform_email_pilots WHERE job_id=?').get(id).encrypted_snapshot,KEY,f.scope.organizationId,f.scope.projectId,id);
  f.clearRate=()=>f.db.prepare('UPDATE platform_email_ses SET last_submit_at=NULL').run();
  f.feedback=async(id,position,kind='Delivery',messageId=randomUUID())=>{const reservation=f.db.prepare('SELECT attempt_id FROM platform_email_send_reservations WHERE job_id=? AND position=?').get(id,position),email=f.snapshot(id).recipients[position-1].email;
   const event={eventType:kind,mail:{sendingAccountId:'123456789012',source:'hello@example.com',messageId:'ses-provider-id',tags:{ryzevoJob:[id],ryzevoPosition:[String(position)],ryzevoAttempt:[reservation.attempt_id]}},...(kind==='Delivery'?{delivery:{recipients:[email]}}:kind==='Bounce'?{bounce:{bounceType:'Permanent',bouncedRecipients:[{emailAddress:email}]}}:{complaint:{complainedRecipients:[{emailAddress:email}]}})};
   const body={Type:'Notification',TopicArn:topicArn,MessageId:messageId,Message:JSON.stringify(event)};return {body,result:await receiveSesFeedback(f.db,f.connection.id,body,KEY,async value=>value)};
  };await work(f);
 }finally{f.db.close();if(origin===undefined)delete process.env.PLATFORM_PUBLIC_ORIGIN;else process.env.PLATFORM_PUBLIC_ORIGIN=origin;if(enabled===undefined)delete process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED;else process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED=enabled;}
}

test('SES configuration is encrypted, matches this exact SMTP credential and fails closed on role/scope/change',()=>withSes(async f=>{
 const state=f.ses.get();assert.equal(state.verified,true);assert.equal(state.ready,true);assert.ok(!JSON.stringify(state).includes(accessKeyId));assert.ok(!JSON.stringify(state).includes(secretAccessKey));assert.ok(!JSON.stringify(f.db.prepare('SELECT encrypted_credentials FROM platform_email_ses').get()).includes(secretAccessKey));
 assert.notEqual(sesSmtpPassword(secretAccessKey,'us-east-1'),sesSmtpPassword(secretAccessKey,region));
 assert.throws(()=>f.ses.save({...f.sesInput,expectedRevision:1,secretAccessKey:'b'.repeat(40)}));assert.throws(()=>f.ses.save({...f.sesInput,expectedRevision:1,topicArn:'arn:aws:sns:us-east-1:123456789012:wrong-region'}));
 assert.throws(()=>new SesProvider(f.db,f.other,KEY).save(f.sesInput),e=>e.status===409);
 const viewer=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'ses-viewer',password:'fixture-password-123',role:'viewer'});assert.throws(()=>new SesProvider(f.db,{...f.scope,subject:viewer.userId},KEY).get(),e=>e.status===403);
 f.db.prepare("UPDATE platform_email_ses SET checked_at='2000-01-01T00:00:00Z'").run();assert.equal(f.ses.state().ready,false);await f.ses.verify(1,async()=>({...proof,dkim:false}));assert.equal(f.ses.state().verified,false);
}));

test('official SES adapter issues only fixed read commands and extracts real provider evidence',async()=>{
 const sdk=require('@aws-sdk/client-sesv2'),original=sdk.SESv2Client.prototype.send,calls=[];
 sdk.SESv2Client.prototype.send=async function(command,options){calls.push(command.constructor.name);assert.ok(options.abortSignal);assert.equal(await this.config.region(),region);assert.equal(await this.config.maxAttempts(),1);assert.equal((await this.config.credentials()).accessKeyId,accessKeyId);
  if(command.constructor.name==='GetEmailIdentityCommand'){assert.equal(command.input.EmailIdentity,'example.com');return {IdentityType:'DOMAIN',VerifiedForSendingStatus:true,DkimAttributes:{SigningEnabled:true,Status:'SUCCESS'}};}
  if(command.constructor.name==='GetAccountCommand')return {SendingEnabled:true,EnforcementStatus:'HEALTHY',ProductionAccessEnabled:false,SendQuota:{MaxSendRate:1}};
  assert.equal(command.input.ConfigurationSetName,configurationSet);return {EventDestinations:[{Enabled:true,MatchingEventTypes:['DELIVERY','BOUNCE','COMPLAINT'],SnsDestination:{TopicArn:topicArn}}]};
 };
 try{const result=await verifySes({region,domain:'example.com',accessKeyId,secretAccessKey,configurationSet,topicArn});assert.equal(result.identity,true);assert.equal(result.dkim,true);assert.equal(result.account,true);assert.equal(result.events,true);assert.equal(result.sandbox,true);assert.deepEqual(calls,['GetEmailIdentityCommand','GetAccountCommand','GetConfigurationSetEventDestinationsCommand']);}finally{sdk.SESv2Client.prototype.send=original;}
});

test('SES checks cannot commit after credential edits and fail closed on provider errors',()=>withSes(async f=>{
 await assert.rejects(()=>f.ses.verify(1,async()=>{f.ses.save({...f.sesInput,expectedRevision:1});return proof;}),e=>e.status===409);assert.equal(f.ses.state().verified,false);await f.ses.verify(2,async()=>{throw new Error('private-provider-error');});assert.equal(f.ses.state().lastError,'provider_unavailable');assert.ok(!JSON.stringify(f.ses.get()).includes('private-provider-error'));
}));

test('SNS notification cryptography rejects tampering, wrong topics, stale data and certificate SSRF',async()=>{
 const pair=generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=pair.publicKey.export({type:'spki',format:'pem'});
 const make=(version='2')=>{const body={Type:'Notification',TopicArn:topicArn,Message:'{"eventType":"RyzevoFeedbackCheck"}',MessageId:randomUUID(),Timestamp:new Date().toISOString(),SignatureVersion:version,SigningCertURL:`https://sns.${region}.amazonaws.com/SimpleNotificationService-fixture.pem`,Subject:'Fixture subject'};const canonical=['Message','MessageId','Subject','Timestamp','TopicArn','Type'].map(field=>`${field}\n${body[field]}\n`).join('');return {...body,Signature:sign(version==='2'?'RSA-SHA256':'RSA-SHA1',Buffer.from(canonical),pair.privateKey).toString('base64')};};
 for(const version of ['1','2'])assert.equal((await validateSnsNotification(make(version),topicArn,async()=>publicKey)).Type,'Notification');const body=make();
 for(const patch of [{Message:'tampered'},{TopicArn:topicArn+'-other'},{SignatureVersion:'3'},{Timestamp:'2000-01-01T00:00:00Z'},{SigningCertURL:'https://127.0.0.1/private.pem'},{SigningCertURL:`https://sns.${region}.amazonaws.com.evil.example/SimpleNotificationService-fixture.pem`},{SigningCertURL:`https://sns.${region}.amazonaws.com/SimpleNotificationService-fixture.pem?x=1`}])await assert.rejects(()=>validateSnsNotification({...body,...patch},topicArn,async()=>publicKey));
});

test('real enqueue requires every gate and explicit acknowledgement; reservation/MIME is private and idempotent',()=>withSes(async f=>{
 const review=f.approve(),input={...f.input(review),sendAcknowledged:true};process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED='0';assert.throws(()=>f.queue.enqueue(input,'send'),e=>e.status===409);process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED='1';assert.throws(()=>f.queue.enqueue({...input,sendAcknowledged:false},'send'),e=>e.status===409);
 const job=f.queue.enqueue(input,'send');assert.equal(job.mode,'send');assert.equal(job.total,5);assert.equal(job.accepted,0);assert.equal(f.queue.list(job.campaignId).jobs.length,0);assert.equal(f.queue.list(job.campaignId,'send').jobs.length,1);assert.equal(f.queue.enqueue(input,'send').id,job.id);
 const mail=f.mail(job.id);assert.match(mail.headers['List-Unsubscribe'],/^<https:\/\/ryzevo\.example\/unsubscribe\?token=rzv1_/);assert.equal(mail.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.ok(mail.html.includes('href="https://example.com"'));assert.ok(!mail.html.includes('Preview only'));assert.ok(!JSON.stringify(job).includes('rzv1_'));assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_email_pilot_recipients WHERE job_id=?').get(job.id)).includes(mail.to));assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_unsubscribe').get().n,5);
 f.queue.cancel(job.id);assert.throws(()=>f.queue.enqueue({...input,idempotencyKey:'different-intent'},'send'),e=>e.status===409);
}));

test('one SMTP attempt per claim records acceptance but not delivery and cannot resubmit a completed recipient',()=>withSes(async f=>{
 const job=f.enqueue();let submissions=0;const deliver=async(smtp,password,mail,reserve)=>{assert.equal(reserve(),true);submissions++;return {state:'accepted',providerMessageId:'ses-provider-id'};};
 await f.sends.process(job.id,deliver);assert.equal(f.queue.get(job.id).accepted,1);assert.equal(f.queue.get(job.id).delivered,0);assert.equal(f.queue.get(job.id).status,'queued');await f.sends.process(job.id,deliver);assert.equal(submissions,1);
 for(let i=0;i<4;i++){f.clearRate();await f.sends.process(job.id,deliver);}const done=f.queue.get(job.id);assert.equal(done.accepted,5);assert.equal(done.status,'completed');assert.equal(done.delivered,0);assert.equal(done.attempts,5);await f.sends.process(job.id,deliver);assert.equal(submissions,5);
}));

test('trial rights are rechecked at the final SMTP submission gate, not just enqueue',()=>withSes(async f=>{
 const job=f.enqueue('trial-rights-fence');let submitted=0;await f.sends.process(job.id,async(_,__,___,reserve)=>{const start=new Date().toISOString(),end=new Date(Date.parse(start)+14*86400000).toISOString();f.db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE project_id=?").run(f.a.userId,start,end,f.a.projectId);if(reserve())submitted++;return {state:'blocked'};});assert.equal(submitted,0);assert.equal(f.queue.get(job.id).accepted,0);
}));

test('ambiguous SMTP outcome is terminal and stops the rest of the pilot without retry',()=>withSes(async f=>{
 const job=f.enqueue();let submissions=0;await f.sends.process(job.id,async(_,__,___,reserve)=>{assert.equal(reserve(),true);submissions++;throw new Error('private SMTP payload');});const failed=f.queue.get(job.id);assert.equal(failed.uncertain,1);assert.equal(failed.skipped,4);assert.equal(failed.status,'failed');assert.ok(!JSON.stringify(failed).includes('private SMTP payload'));await f.sends.process(job.id,async()=>{submissions++;});assert.equal(submissions,1);
}));

test('cancellation during SMTP is not called unsent and late signed delivery can reconcile it',()=>withSes(async f=>{
 const job=f.enqueue();let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);const running=f.sends.process(job.id,async(_,__,___,reserve)=>{assert.equal(reserve(),true);entered();await gate;return {state:'accepted',providerMessageId:'ses-provider-id'};});await started;f.queue.cancel(job.id);release();await running;assert.equal(f.queue.get(job.id).uncertain,1);assert.equal(f.queue.get(job.id).cancelled,4);await f.feedback(job.id,1);assert.equal(f.queue.get(job.id).delivered,1);assert.equal(f.queue.get(job.id).uncertain,0);assert.equal(f.queue.get(job.id).status,'cancelled');
}));

test('live consent, deployment and manual runner changes are rechecked immediately before SMTP submission',()=>withSes(async f=>{
 const job=f.enqueue();let sent=false;await f.sends.process(job.id,async(_,__,mail,reserve)=>{f.recipients.suppress({email:mail.to,acknowledged:true});sent=reserve();return {state:'blocked',providerMessageId:null};});assert.equal(sent,false);assert.equal(f.queue.get(job.id).accepted,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_send_reservations WHERE submitted_at IS NOT NULL').get().n,0);
}));

test('signed permanent bounce/complaint suppresses address and source identity, cancels unsent rows and never downgrades',()=>withSes(async f=>{
 const job=f.enqueue();await f.sends.process(job.id,async(_,__,___,reserve)=>{assert.equal(reserve(),true);return {state:'accepted',providerMessageId:'ses-provider-id'};});const {body}=await f.feedback(job.id,1,'Complaint');assert.equal(f.queue.get(job.id).complained,1);assert.equal(f.queue.get(job.id).cancelled,4);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_blocks').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_entity_blocks').get().n,1);const duplicate=await receiveSesFeedback(f.db,f.connection.id,body,KEY,async value=>value);assert.equal(duplicate.duplicate,true);await f.feedback(job.id,1,'Delivery');assert.equal(f.queue.get(job.id).complained,1);assert.equal(f.queue.get(job.id).delivered,0);
}));

test('historical topic bindings retain old negative feedback after settings change and manager revocation',()=>withSes(async f=>{
 const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'ses-admin',password:'fixture-password-123',role:'admin'}),provider=new SesProvider(f.db,{...f.scope,subject:admin.userId},KEY);provider.save({...f.sesInput,expectedRevision:1});await provider.verify(2,async()=>proof);f.db.prepare('UPDATE platform_email_ses SET feedback_observed_at=?').run(new Date().toISOString());
 const job=f.enqueue();await f.sends.process(job.id,async(_,__,___,reserve)=>{assert.equal(reserve(),true);return {state:'accepted',providerMessageId:'ses-provider-id'};});f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'viewer',true);assert.equal(f.ses.state().ready,false);f.ses.save({...f.sesInput,expectedRevision:f.ses.state().revision,topicArn:topicArn+'-new'});await f.feedback(job.id,1,'Bounce');assert.equal(f.queue.get(job.id).bounced,1);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_blocks').get().n,1);
}));

test('SMTP adapter pins public IP, enforces TLS and rechecks before send without leaking protocol responses',async()=>{
 const smtp={host:`email-smtp.${region}.amazonaws.com`,port:587,user:accessKeyId,fromEmail:'hello@example.com',fromName:'Fixture'},mail=preparePilotMail({fromEmail:smtp.fromEmail,fromName:smtp.fromName,to:'pilot@example.com',subject:'Fixture <test>',text:'<script>not executable</script>',ctaUrl:'https://example.com',brand:'Example',language:'en',unsubscribeUrl:'https://ryzevo.example/unsubscribe?token=rzv1_fixture',configurationSet,jobId:randomUUID(),position:1,attemptId:randomUUID(),createdAt:new Date().toISOString()});let calls=0,closed=0,options;
 const connect=async()=>({destroy(){closed++;}}),create=value=>{options=value;return {sendMail:async value=>{calls++;assert.deepEqual(Array.from(value.envelope.to),[mail.to]);assert.equal(value.disableFileAccess,true);assert.equal(value.disableUrlAccess,true);return {accepted:[mail.to],rejected:[],response:'250 Ok ses-provider-id'};},close(){closed++;}};};
 const result=await submitSmtpPilot(smtp,'fixture-password',mail,()=>true,async()=>({address:'93.184.216.34'}),create,connect);assert.equal(result.state,'accepted');assert.equal(result.providerMessageId,'ses-provider-id');assert.equal(options.host,'93.184.216.34');assert.equal(options.tls.servername,smtp.host);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.requireTLS,true);assert.equal(calls,1);assert.ok(closed>0);assert.ok(!mail.html.includes('<script>'));await submitSmtpPilot(smtp,'fixture-password',mail,()=>false,async()=>({address:'93.184.216.34'}),create,connect);assert.equal(calls,1);
});

test('MIME can be rendered offline with unsubscribe headers and no duplicate recipients',async()=>{
 const transport=require('nodemailer').createTransport({streamTransport:true,buffer:true,newline:'unix'}),mail=preparePilotMail({fromEmail:'hello@example.com',fromName:'Example',to:'pilot@example.com',subject:'Fixture',text:'Hello',ctaUrl:'https://example.com',brand:'Example',language:'en',unsubscribeUrl:'https://ryzevo.example/unsubscribe?token=rzv1_fixture',configurationSet,jobId:randomUUID(),position:1,attemptId:randomUUID(),createdAt:new Date().toISOString()});const result=await transport.sendMail({...mail,date:new Date(mail.date)}),text=result.message.toString();assert.match(text,/List-Unsubscribe:/);assert.match(text,/List-Unsubscribe-Post: List-Unsubscribe=One-Click/);assert.match(text,/X-SES-CONFIGURATION-SET: ryzevo-qa/i);assert.match(text,/X-SES-MESSAGE-TAGS:/i);assert.equal((text.match(/^To:/gm)||[]).length,1);assert.ok(!/^Bcc:/im.test(text));transport.close();
});

test('deployment permission, SMTP rotation and manual runner revocation close the final submission gate',async()=>{
 for(const change of ['deployment','credentials','runner'])await withSes(async f=>{
  const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'final-runner',password:'fixture-password-123',role:'admin'}),job=f.enqueue();let reserved=true;
  await f.sends.process(job.id,async(_,__,___,reserve)=>{
   if(change==='deployment')process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED='0';
   if(change==='credentials')f.store.saveConnection({id:f.connection.id,provider:'email',integrationId:'fixture-smtp',accountName:'Rotated',accessToken:'different-password',smtp:f.smtp},KEY);
   if(change==='runner')f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'viewer',true);
   reserved=reserve();return {state:'accepted',providerMessageId:'must-not-commit'};
  },change==='runner'?admin.userId:undefined);
  assert.equal(reserved,false,change);assert.equal(f.queue.get(job.id).accepted,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_send_reservations WHERE submitted_at IS NOT NULL').get().n,0);
 });
});

test('real pilot lease excludes concurrent writers and expired submissions are never sent again',()=>withSes(async f=>{
 const job=f.enqueue();let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const running=f.sends.process(job.id,async(_,__,___,reserve)=>{assert.equal(reserve(),true);entered();await gate;return {state:'accepted',providerMessageId:'late'};});await started;
 await f.sends.process(job.id,async()=>assert.fail('Second worker claimed live lease'));assert.equal(f.queue.get(job.id).attempts,1);
 f.db.prepare("UPDATE platform_jobs SET lease_until='2000-01-01T00:00:00Z' WHERE id=?").run(job.id);
 await new EmailSendJobs(f.db,f.scope,KEY).process(job.id,async()=>assert.fail('Expired submission was retried'));
 release();await running;assert.equal(f.queue.get(job.id).uncertain,1);assert.equal(f.queue.get(job.id).skipped,4);assert.equal(f.queue.get(job.id).accepted,0);
}));

test('SNS correlation rejects wrong attempts, recipients, account, connection and conflicting receipt IDs',()=>withSes(async f=>{
 const job=f.enqueue();await f.sends.process(job.id,async(_,__,___,reserve)=>{reserve();return {state:'accepted',providerMessageId:'ses-provider-id'};});
 const attempt=f.db.prepare('SELECT attempt_id FROM platform_email_send_reservations WHERE job_id=? AND position=1').get(job.id).attempt_id,email=f.snapshot(job.id).recipients[0].email;
 const base={eventType:'Delivery',mail:{source:'hello@example.com',sendingAccountId:'123456789012',messageId:'ses-provider-id',tags:{ryzevoJob:[job.id],ryzevoPosition:['1'],ryzevoAttempt:[attempt]}},delivery:{recipients:[email]}};
 for(const change of ['attempt','recipient','account','message']){
  const event=structuredClone(base);if(change==='attempt')event.mail.tags.ryzevoAttempt=[randomUUID()];if(change==='recipient')event.delivery.recipients=['someone-else@example.com'];if(change==='account')event.mail.sendingAccountId='000000000000';if(change==='message')event.mail.messageId='different-provider-id';
  const result=await receiveSesFeedback(f.db,f.connection.id,{Type:'Notification',TopicArn:topicArn,MessageId:randomUUID(),Message:JSON.stringify(event)},KEY,async value=>value);assert.equal(result.ignored,true);assert.equal(f.queue.get(job.id).delivered,0);
 }
 await assert.rejects(()=>receiveSesFeedback(f.db,randomUUID(),{TopicArn:topicArn},KEY,async value=>value),e=>e.status===404);
 const {body}=await f.feedback(job.id,1);await assert.rejects(()=>receiveSesFeedback(f.db,f.connection.id,{...body,Message:JSON.stringify({...base,eventType:'Complaint'})},KEY,async value=>value),e=>e.status===409);
 for(const value of ['null','[]','not-json'])await assert.rejects(()=>receiveSesFeedback(f.db,f.connection.id,{Type:'Notification',TopicArn:topicArn,MessageId:randomUUID(),Message:value},KEY,async value=>value),e=>e.status===400);
}));

test('native signed SNS check records endpoint evidence without sending or exposing raw messages',()=>withSes(async f=>{
 f.db.prepare('UPDATE platform_email_ses SET feedback_observed_at=NULL').run();assert.equal(f.ses.state().ready,false);
 const pair=generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=pair.publicKey.export({type:'spki',format:'pem'}),body={Type:'Notification',TopicArn:topicArn,Message:'{"eventType":"RyzevoFeedbackCheck"}',MessageId:randomUUID(),Timestamp:new Date().toISOString(),SignatureVersion:'2',SigningCertURL:`https://sns.${region}.amazonaws.com/SimpleNotificationService-fixture.pem`};
 const canonical=['Message','MessageId','Timestamp','TopicArn','Type'].map(field=>`${field}\n${body[field]}\n`).join('');body.Signature=sign('RSA-SHA256',Buffer.from(canonical),pair.privateKey).toString('base64');
 const result=await receiveSesFeedback(f.db,f.connection.id,body,KEY,(raw,topic)=>validateSnsNotification(raw,topic,async()=>publicKey));assert.equal(result.observed,true);assert.equal(f.ses.state().ready,true);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_send_reservations').get().n,0);
 assert.deepEqual(Object.keys(f.db.prepare('SELECT * FROM platform_email_ses_receipts').get()).sort(),['digest','event_type','message_id','organization_id','project_id','received_at']);
}));

test('transient bounce does not permanently suppress while permanent bounce does',()=>withSes(async f=>{
 const job=f.enqueue();await f.sends.process(job.id,async(_,__,___,reserve)=>{reserve();return {state:'accepted',providerMessageId:'ses-provider-id'};});
 const attempt=f.db.prepare('SELECT attempt_id FROM platform_email_send_reservations WHERE job_id=? AND position=1').get(job.id).attempt_id,email=f.snapshot(job.id).recipients[0].email;
 const event={eventType:'Bounce',mail:{source:'hello@example.com',sendingAccountId:'123456789012',messageId:'ses-provider-id',tags:{ryzevoJob:[job.id],ryzevoPosition:['1'],ryzevoAttempt:[attempt]}},bounce:{bounceType:'Transient',bouncedRecipients:[{emailAddress:email}]}};
 const result=await receiveSesFeedback(f.db,f.connection.id,{Type:'Notification',TopicArn:topicArn,MessageId:randomUUID(),Message:JSON.stringify(event)},KEY,async value=>value);assert.equal(result.ignored,true);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_blocks').get().n,0);await f.feedback(job.id,1,'Bounce');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_blocks').get().n,1);
}));

test('SMTP classifies explicit rejection versus ambiguity and cannot connect after its deadline',async()=>{
 const smtp={host:`email-smtp.${region}.amazonaws.com`,port:587,user:accessKeyId,fromEmail:'hello@example.com',fromName:'Fixture'},mail=preparePilotMail({fromEmail:smtp.fromEmail,fromName:'Fixture',to:'pilot@example.com',subject:'Fixture',text:'Hello',ctaUrl:'https://example.com',brand:'Example',language:'en',unsubscribeUrl:'https://ryzevo.example/unsubscribe?token=fixture',configurationSet,jobId:randomUUID(),position:1,attemptId:randomUUID(),createdAt:new Date().toISOString()});
 for(const [failure,state] of [[{code:'EAUTH'},'rejected'],[{responseCode:550},'rejected'],[{code:'ETIMEDOUT'},'uncertain']]){
  const result=await submitSmtpPilot(smtp,'password',mail,()=>true,async()=>({address:'93.184.216.34'}),()=>({sendMail:async()=>{throw failure;},close(){}}),async()=>({destroy(){}}));assert.equal(result.state,state);
 }
 let finish,connected=false;const dns=new Promise(resolve=>finish=resolve),pending=submitSmtpPilot(smtp,'password',mail,()=>assert.fail('Reserved after deadline'),()=>dns,()=>assert.fail('Created transport after deadline'),async()=>{connected=true;return {destroy(){}};});
 assert.equal((await pending).state,'blocked');finish({address:'93.184.216.34'});await new Promise(resolve=>setImmediate(resolve));assert.equal(connected,false);
});

test('schema17 migration preserves rehearsal recipients and snapshots exactly across two opens',async()=>{
 const f=fixture(),fs=require('node:fs'),path=require('node:path'),dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'ses-schema17-')),file=path.join(dir,'fixture.sqlite'),{openPlatformDatabase}=load('database.ts');let db;
 try{
  const job=f.queue.enqueue(f.input(f.approve())),before=f.db.prepare('SELECT encrypted_snapshot FROM platform_email_pilots WHERE job_id=?').get(job.id).encrypted_snapshot;
  require('./schema-fixture.cjs').removeMeasurementSchema(f.db);
  f.db.exec(`DROP TABLE platform_email_send_reservations; DROP TABLE platform_email_ses_receipts; DROP TABLE platform_email_ses_topics; DROP TABLE platform_email_ses;
   CREATE TABLE old_recipients(job_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 5),email_key TEXT NOT NULL,masked_email TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('queued','checking','validated','skipped','uncertain','cancelled')),reason TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(job_id,position),UNIQUE(job_id,email_key),FOREIGN KEY(job_id,organization_id,project_id) REFERENCES platform_email_pilots(job_id,organization_id,project_id));
   INSERT INTO old_recipients SELECT job_id,organization_id,project_id,position,email_key,masked_email,state,reason,updated_at FROM platform_email_pilot_recipients;
   DROP TABLE platform_email_pilot_recipients; ALTER TABLE old_recipients RENAME TO platform_email_pilot_recipients; ALTER TABLE platform_email_pilots DROP COLUMN mode; DELETE FROM platform_migrations WHERE version=18;`);
  await f.db.backup(file);db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT encrypted_snapshot FROM platform_email_pilots WHERE job_id=?').get(job.id).encrypted_snapshot,before);const queue=new f.EmailPilotQueue(db,f.scope,KEY);assert.equal(queue.get(job.id).mode,'rehearsal');assert.equal(queue.get(job.id).total,5);await queue.process(job.id);assert.equal(queue.get(job.id).checked,5);db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_migrations WHERE version=18').get().n,1);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);
 }finally{db?.close();f.db.close();}
});
