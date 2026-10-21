const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {ProjectWhatsApp,deliverWhatsAppBatches,normalizePhone,templateParams,whatsAppGraph}=load('whatsapp.ts');
const {ProjectMessaging}=load('messaging-sources.ts');
const KEY='56'.repeat(32),TOKEN='EAAFixtureWhatsAppTokenOnly_not_real';
// Disposable Graph API: answers by path, records each call. No network is used.
const fakeGraph=(overrides={})=>{const calls=[];const graph=async(method,path,token,params={},body)=>{calls.push({method,path,token,params,body});
  if(overrides[path])return overrides[path](body);
  if(path==='1234567890')return {status:200,payload:{display_phone_number:'+90 212 000 00 00',verified_name:'Ryzevo QA',quality_rating:'GREEN'}};
  if(path==='9988776655/phone_numbers')return {status:200,payload:{data:[{id:'1234567890'}]}};
  if(path==='9988776655/message_templates')return {status:200,payload:{data:[
    {name:'kampanya_duyuru',language:'tr',status:'APPROVED',category:'MARKETING',components:[{type:'HEADER',format:'TEXT',text:'Duyuru'},{type:'BODY',text:'Merhaba, {{1}} için yeni dönem {{2}} tarihinde başlıyor.'}]},
    {name:'bekleyen',language:'tr',status:'PENDING',category:'MARKETING',components:[{type:'BODY',text:'x'}]},
    {name:'gorselli',language:'tr',status:'APPROVED',category:'MARKETING',components:[{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'y'}]},
    {name:'giris_kodu',language:'tr',status:'APPROVED',category:'AUTHENTICATION',components:[{type:'BODY',text:'{{1}}'}]}]}};
  if(path==='1234567890/messages')return {status:200,payload:{messages:[{id:`wamid.${calls.length}FixtureOnly`}]}};
  return {status:404,payload:{}};};return {calls,graph};};
const setup=async(f,graph)=>{const wa=new ProjectWhatsApp(f.db,f.scope,KEY,graph);await wa.connect({phoneNumberId:'1234567890',wabaId:'9988776655',accessToken:TOKEN});await wa.refreshTemplates();
  wa.addContacts({phones:'+90 532 111 22 33\n+905321112234, 00905321112235',evidence:'QA form 2026-10',consentAt:'2026-10-01',acknowledged:true});return wa;};
const draft=(wa,patch={})=>{const s=wa.read();return wa.saveBatch({name:'Yeni dönem',templateName:'kampanya_duyuru',templateLanguage:'tr',params:['STCW kursu','3 Kasım'],contactIds:s.contacts.map(c=>c.id),...patch});};
const run=fn=>coachRun(async f=>{const saved={...process.env};try{process.env.PLATFORM_WHATSAPP_SEND_ENABLED='0';await fn(f);}finally{process.env.PLATFORM_WHATSAPP_SEND_ENABLED=saved.PLATFORM_WHATSAPP_SEND_ENABLED;}});

test('phone numbers need an international format and template variables are counted once',()=>{
  assert.equal(normalizePhone('+90 (532) 111-22-33'),'+905321112233');assert.equal(normalizePhone('0090 532 111 22 33'),'+905321112233');
  for(const bad of ['05321112233','532 111','+0123456789','+90abc'])assert.equal(normalizePhone(bad),null,bad);
  assert.equal(templateParams('{{1}} ve {{2}}, yine {{1}}'),2);
});
test('the Graph client only reaches the allowed WhatsApp paths with the token in the header',async()=>{
  const original=globalThis.fetch,seen=[];globalThis.fetch=async(url,options)=>{seen.push({url:String(url),options});return Response.json({ok:true});};
  try{await whatsAppGraph('GET','1234567890',TOKEN,{fields:'verified_name'});assert.match(seen[0].url,/^https:\/\/graph\.facebook\.com\/v\d+\.\d\/1234567890\?fields=verified_name$/);
    assert.equal(seen[0].options.headers.Authorization,`Bearer ${TOKEN}`);assert.doesNotMatch(seen[0].url,/access_token/);assert.equal(seen[0].options.redirect,'error');
    for(const bad of ['me/accounts','123/../me','1234567890/subscribed_apps'])await assert.rejects(whatsAppGraph('GET',bad,TOKEN),bad);
  }finally{globalThis.fetch=original;}
});
test('connect, templates and contacts: approved body-only templates, separate consent, encrypted numbers',run(async f=>{
  const {graph,calls}=fakeGraph();
  await assert.rejects(new ProjectWhatsApp(f.db,f.scope,KEY,fakeGraph({'9988776655/phone_numbers':()=>({status:200,payload:{data:[{id:'111'}]}})}).graph).connect({phoneNumberId:'1234567890',wabaId:'9988776655',accessToken:TOKEN}),error=>error.status===409,'the number must belong to the WABA');
  const wa=await setup(f,graph),snapshot=wa.read();
  assert.equal(snapshot.account.verifiedName,'Ryzevo QA');assert.deepEqual(plain(snapshot.templates.map(t=>t.name)),['kampanya_duyuru'],'pending, media-header and authentication templates are left out');assert.equal(snapshot.templates[0].params,2);
  assert.equal(snapshot.contacts.length,3);assert.ok(snapshot.contacts.every(c=>/^\+90•••\d{2}$/.test(c.hint)));
  const dump=JSON.stringify(f.db.prepare('SELECT * FROM platform_whatsapp_contacts').all())+JSON.stringify(f.db.prepare('SELECT * FROM platform_connections').all())+JSON.stringify(snapshot);
  assert.doesNotMatch(dump,/5321112233|EAAFixture/,'numbers and the token are stored only encrypted and never reach the browser');
  assert.equal(wa.addContacts({phones:'+905321112233',evidence:'again',consentAt:'2026-10-02',acknowledged:true}).existing,1,'the same number is not added twice');
  for(const bad of [{acknowledged:false},{evidence:''},{consentAt:'2999-01-01'},{phones:'05321112233'}])assert.throws(()=>wa.addContacts({phones:'+905321119999',evidence:'x',consentAt:'2026-10-01',acknowledged:true,...bad}),JSON.stringify(bad));
  const viewer=f.member('viewer');assert.equal(new ProjectWhatsApp(f.db,viewer,KEY,graph).read().contacts.length,0,'viewers see no contacts');assert.throws(()=>new ProjectWhatsApp(f.db,viewer,KEY,graph).addContacts({phones:'+905321119999',evidence:'x',consentAt:'2026-10-01',acknowledged:true}),error=>error.status===403);
  assert.equal(new ProjectWhatsApp(f.db,f.other,KEY,graph).read().account,null,'other projects see nothing');
  assert.ok(calls.every(call=>call.token===TOKEN));
}));
test('a batch is approved on its exact content; rehearsal never contacts WhatsApp',run(async f=>{
  const {graph,calls}=fakeGraph(),wa=await setup(f,graph);
  assert.throws(()=>draft(wa,{params:['tek']}),/2 değişken/);assert.throws(()=>draft(wa,{params:['satır\nkırılımı','x']}));assert.throws(()=>draft(wa,{templateName:'bekleyen'}),error=>error.status===409);
  let batch=draft(wa).batches[0];assert.equal(batch.preview,'Merhaba, STCW kursu için yeni dönem 3 Kasım tarihinde başlıyor.');
  assert.throws(()=>wa.queue({id:batch.id,expectedDigest:batch.digest,mode:'rehearsal'}),error=>error.status===409,'drafts are not queued');
  batch=wa.approve({id:batch.id,expectedDigest:batch.digest}).batches[0];assert.equal(batch.approved,true);
  batch=wa.saveBatch({id:batch.id,expectedRevision:batch.revision,name:'Yeni dönem',templateName:'kampanya_duyuru',templateLanguage:'tr',params:['STCW kursu','4 Kasım'],contactIds:batch.contactIds}).batches[0];assert.equal(batch.approved,false,'an edit clears the approval');
  batch=wa.approve({id:batch.id,expectedDigest:batch.digest}).batches[0];
  const before=calls.length;batch=wa.queue({id:batch.id,expectedDigest:batch.digest,mode:'rehearsal'}).batches[0];
  const done=await wa.process(batch.id);assert.equal(done.state,'done');assert.equal(done.counts.rehearsed,3);assert.equal(calls.length,before,'rehearsal made no call');
  const second=draft(wa).batches[0],approved=wa.approve({id:second.id,expectedDigest:second.digest}).batches.find(b=>b.id===second.id);
  assert.throws(()=>wa.queue({id:approved.id,expectedDigest:approved.digest,mode:'send',acknowledged:true}),error=>error.status===409,'the server switch is off by default');
}));
test('real sends need the switch, the publish duty and consent at the moment of sending; interrupted sends are never repeated',run(async f=>{
  const {graph,calls}=fakeGraph(),wa=await setup(f,graph);process.env.PLATFORM_WHATSAPP_SEND_ENABLED='1';
  const admin=f.member('admin'),asAdmin=new ProjectWhatsApp(f.db,admin,KEY,graph);
  let batch=draft(wa).batches[0];batch=wa.approve({id:batch.id,expectedDigest:batch.digest}).batches[0];
  assert.throws(()=>asAdmin.queue({id:batch.id,expectedDigest:batch.digest,mode:'send',acknowledged:true}),error=>error.status===403,'an admin without the publish duty cannot send');
  assert.throws(()=>wa.queue({id:batch.id,expectedDigest:batch.digest,mode:'send'}),error=>error.status===409,'an explicit acknowledgement is required');
  batch=wa.queue({id:batch.id,expectedDigest:batch.digest,mode:'send',acknowledged:true}).batches[0];
  const contacts=wa.read().contacts;wa.optOut({id:contacts[0].id});
  const done=await wa.process(batch.id);assert.equal(done.state,'done');assert.equal(done.counts.accepted,2);assert.equal(done.counts.skipped,1,'an opt-out after queueing is honoured');
  const sends=calls.filter(call=>call.path==='1234567890/messages');assert.equal(sends.length,2);
  assert.deepEqual(plain(sends[0].body.template),{name:'kampanya_duyuru',language:{code:'tr'},components:[{type:'body',parameters:[{type:'text',text:'STCW kursu'},{type:'text',text:'3 Kasım'}]}]});assert.match(sends[0].body.to,/^90532111223\d$/);
  assert.equal(new ProjectWhatsApp(f.db,f.scope,KEY,graph).read().sentToday,2);
  // A network failure is uncertain, a 4xx is rejected; neither is retried.
  const flaky=fakeGraph({'1234567890/messages':()=>{throw new Error('reset');}}),wa2=new ProjectWhatsApp(f.db,f.scope,KEY,flaky.graph);
  let next=draft(wa2,{contactIds:[contacts[1].id]}).batches[0];next=wa2.approve({id:next.id,expectedDigest:next.digest}).batches[0];next=wa2.queue({id:next.id,expectedDigest:next.digest,mode:'send',acknowledged:true}).batches[0];
  assert.equal((await wa2.process(next.id)).counts.uncertain,1);assert.equal((await wa2.process(next.id)).counts.uncertain,1);assert.equal(flaky.calls.filter(c=>c.path.endsWith('/messages')).length,1);
  // Queued by an admin who then loses the duty: the remaining messages are skipped.
  new ProjectMessaging(f.db,f.scope,KEY).setDuty({userId:admin.subject,duty:'publish',granted:true});
  let third=draft(wa,{contactIds:[contacts[1].id,contacts[2].id]}).batches[0];third=wa.approve({id:third.id,expectedDigest:third.digest}).batches[0];
  asAdmin.queue({id:third.id,expectedDigest:third.digest,mode:'send',acknowledged:true});new ProjectMessaging(f.db,f.scope,KEY).setDuty({userId:admin.subject,duty:'publish',granted:false});
  const before=calls.length;assert.equal(await deliverWhatsAppBatches(f.db,KEY,graph),1);assert.equal(calls.length,before,'nothing was sent after the duty was taken away');
  assert.ok(f.db.prepare("SELECT COUNT(*) n FROM platform_audit WHERE operation LIKE 'whatsapp.%'").get().n>=10);
}));
test('schema47 is additive and repeatable',coachRun(async f=>{
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'whatsapp-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeWhatsAppSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,46);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,47);assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='platform_whatsapp_messages'").get());db.close();
}));
