const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {CoachDigest,deliverNextCoachDigest,deliverCoachDigest,digestMessage,digestConfiguration}=load('coach-digest.ts');
const {CoachWeeklyReview}=load('coach-review.ts');
const ENV={PLATFORM_COACH_DIGEST_ENABLED:'1',PLATFORM_AUTH_EMAIL_ENABLED:'1',PLATFORM_AUTH_ORIGIN:'http://localhost:3033',PLATFORM_AUTH_SES_REGION:'eu-west-1',PLATFORM_AUTH_FROM_EMAIL:'coach@ryzevo.example',PLATFORM_AUTH_SES_ACCESS_KEY_ID:'AKIA'+'B'.repeat(16),PLATFORM_AUTH_SES_SECRET_ACCESS_KEY:'c'.repeat(40)};
const withEnv=async fn=>{const saved=Object.fromEntries(Object.keys(ENV).map(key=>[key,process.env[key]]));Object.assign(process.env,ENV);try{await fn();}finally{for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}};
const verify=(f,scope,email)=>f.db.prepare('INSERT INTO platform_account_emails VALUES(?,?,?)').run(scope.subject,email,new Date().toISOString());
const digest=(f,scope=f.scope)=>new CoachDigest(f.db,scope);
const setup=async f=>{f.setGoals();await f.approve();const review=new CoachWeeklyReview(f.db,f.scope).generate().review;verify(f,f.scope,'owner@ryzevo.example');return review;};

test('subscribing is personal and needs a verified account email',coachRun(async f=>{
  await setup(f);const viewer=f.member('viewer');
  assert.throws(()=>digest(f,viewer).subscribe({language:'en'}),error=>error.status===409);
  verify(f,viewer,'viewer@ryzevo.example');let snapshot=digest(f,viewer).subscribe({language:'en'});assert.equal(snapshot.subscribed,true);assert.equal(snapshot.canSend,false);assert.equal(snapshot.recipients,null,'non-approvers do not see the subscriber count');
  assert.throws(()=>digest(f,viewer).subscribe({language:'de'}),error=>error.status===400);
  snapshot=digest(f,viewer).unsubscribe();assert.equal(snapshot.subscribed,false);
  assert.equal(digest(f).read().subscribed,false,'one member\'s subscription is not another\'s');
}));
test('sending is off unless the platform enables it, and only approvers can queue',coachRun(async f=>{
  const review=await setup(f);digest(f).subscribe({language:'tr'});
  assert.equal(digestConfiguration(),null);assert.equal(digest(f).read().enabled,false);assert.ok(digest(f).read().preview.text.length>20,'the preview works while sending is off');
  assert.throws(()=>digest(f).send({reviewId:review.id}),error=>error.status===503);
  await withEnv(async()=>{
    const editor=f.member('editor');assert.throws(()=>digest(f,editor).send({reviewId:review.id}),error=>error.status===403&&/özeti yalnız onay/.test(error.message));
    assert.throws(()=>digest(f).send({reviewId:'review_other'}),error=>error.status===409);
    const first=digest(f).send({reviewId:review.id});assert.equal(first.queued,1);assert.equal(first.snapshot.deliveries.queued,1);
    assert.equal(digest(f).send({reviewId:review.id}).queued,0,'the same review never goes to the same person twice');
  });
}));
test('the worker delivers once, re-checks the recipient and records uncertain results',coachRun(async f=>{
  const review=await setup(f),viewer=f.member('viewer'),editor=f.member('editor');verify(f,viewer,'viewer@ryzevo.example');verify(f,editor,'editor@ryzevo.example');
  for(const [scope,language] of [[f.scope,'en'],[viewer,'tr'],[editor,'en']])digest(f,scope).subscribe({language});
  await withEnv(async()=>{
    assert.equal(digest(f).send({reviewId:review.id}).queued,3);
    digest(f,viewer).unsubscribe();
    const mails=[];const deliver=async mail=>{mails.push(mail);if(mail.to.startsWith('editor'))throw new Error('provider timeout');};
    while(await deliverNextCoachDigest(f.db,deliver));
    const states=Object.fromEntries(f.db.prepare('SELECT user_id,state,reason FROM platform_coach_digest_deliveries').all().map(row=>[row.user_id,`${row.state}${row.reason?':'+row.reason:''}`]));
    assert.equal(states[f.scope.subject],'sent');assert.equal(states[viewer.subject],'skipped:unsubscribed');assert.equal(states[editor.subject],'uncertain','a failed provider call is never retried');
    assert.equal(mails.length,2);const mail=mails.find(item=>item.to==='owner@ryzevo.example');
    assert.match(mail.subject,/weekly review/);assert.match(mail.text,/alpha · weekly review/);assert.match(mail.text,/http:\/\/localhost:3033\/\?tab=dashboard/);assert.doesNotMatch(mail.text,/uplift \d|ROI \d|guarantee|\d+\s*%/i);
    assert.equal(await deliverNextCoachDigest(f.db,deliver),false,'nothing left to send');
  });
  assert.equal(await deliverNextCoachDigest(f.db,async()=>{throw new Error('should not run');}),false,'no configuration, no delivery');
}));
test('removed members and other projects are never mailed',coachRun(async f=>{
  const review=await setup(f),viewer=f.member('viewer');verify(f,viewer,'viewer@ryzevo.example');digest(f,viewer).subscribe({language:'en'});
  await withEnv(async()=>{
    digest(f).send({reviewId:review.id});f.db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(viewer.subject);
    const mails=[];while(await deliverNextCoachDigest(f.db,async mail=>{mails.push(mail);}));assert.equal(mails.length,0);
    assert.equal(f.db.prepare('SELECT reason FROM platform_coach_digest_deliveries').get().reason,'membership');
    assert.throws(()=>digest(f,{...f.other,subject:f.scope.subject}).read(),error=>error.status===403);
    assert.equal(digest(f,f.other).read().reviewId,null);
  });
}));
test('the message states missing data plainly and uses the SES client without tracking',coachRun(async f=>{
  const review=await setup(f),facts=JSON.parse(f.db.prepare('SELECT facts_json FROM platform_coach_reviews WHERE id=?').get(review.id).facts_json);
  const tr=digestMessage({...facts,measurements:[],rose:[]},[],'tr',{name:'Alfa',timezone:'Europe/Istanbul'},'https://app.ryzevo.example');
  assert.match(tr.text,/Veri yok, sıfır demek değildir/);assert.match(tr.subject,/Alfa · haftalık özet/);
  let command;await deliverCoachDigest({to:'a@ryzevo.example',subject:'S',text:'T'},{region:'eu-west-1',from:'coach@ryzevo.example',accessKeyId:'AKIA'+'B'.repeat(16),secretAccessKey:'c'.repeat(40),origin:'https://x',revision:'r'},()=>({send:async value=>{command=value;return {MessageId:'m-1'};},destroy(){}}));
  assert.equal(command.input.ConfigurationOverrides.Tracking.OpenTrackingEnabled,'DISABLED');assert.deepEqual([...command.input.Destination.ToAddresses],['a@ryzevo.example']);
  await assert.rejects(deliverCoachDigest({to:'a@ryzevo.example',subject:'S',text:'T'},{region:'eu-west-1',from:'c@r.example',accessKeyId:'x',secretAccessKey:'y',origin:'o',revision:'r'},()=>({send:async()=>({}),destroy(){}})));
}));
test('schema36 is additive and repeatable',coachRun(async f=>{
  await setup(f);digest(f).subscribe({language:'en'});
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'coach-digest-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeDigestSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,35);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,45);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_coach_digest_subscriptions').get().n,0);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
