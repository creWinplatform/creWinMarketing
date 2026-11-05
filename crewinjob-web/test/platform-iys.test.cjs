const assert=require('node:assert/strict');
// İYS is switched off by default (NEXT_PUBLIC_IYS_ENABLED); these tests cover it switched on.
process.env.NEXT_PUBLIC_IYS_ENABLED='1';
const {test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs');
const {load}=require('./platform-loader.cjs');
const {ProjectIys,iysGate,iysSendBlock,queueIysConsent,deliverIysOutbox,pullIysChanges,iysEmailKey,iysPhoneKey,iysAttention}=load('iys.ts');
const {iysDueAt,iysDate}=load('iys-types.ts');
const {EmailRecipients,queueIysUnsubscribe}=load('email-recipients.ts');
const {processRyzevoUnsubscribe,newUnsubscribeToken,emailIdentity}=load('email-safety.ts');
const {ProjectWhatsApp}=load('whatsapp.ts');
const {teamAlerts}=load('team-alerts.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const PASSWORD='iys-fixture-password-not-real';

// A stand-in for İYS: records every request and answers from a small in-memory register. No network.
function fakeIys(){
 const state={requests:[],register:new Map(),changes:[],brands:[{brandCode:'654321'}],failAdd:false};
 const transport=async request=>{
  const url=new URL(request.url),body=request.body?JSON.parse(request.body):null;state.requests.push({method:request.method,path:url.pathname+url.search,body,auth:request.headers.Authorization||null});
  if(url.pathname==='/oauth2/token')return body.password===PASSWORD?{status:200,body:{access_token:'fake-token',expires_in:7200}}:{status:401,body:{}};
  if(request.headers.Authorization!=='Bearer fake-token')return {status:401,body:{}};
  if(url.pathname==='/sps/123456/brands')return {status:200,body:state.brands};
  if(url.pathname==='/sps/123456/brands/654321/consents'){if(state.failAdd)return {status:422,body:{errors:[{code:'H174',message:'late'}]}};state.register.set(`${body.type}\n${body.recipient}`,body);return {status:200,body:{transactionId:`tx-${state.requests.length}`}};}
  if(url.pathname==='/sps/123456/brands/654321/consents/status'){const item=state.register.get(`${body.type}\n${body.recipient}`);return item?{status:200,body:{status:item.status,consentDate:item.consentDate,source:item.source}}:{status:404,body:{}};}
  if(url.pathname==='/sps/123456/brands/654321/consents/changes'){const after=url.searchParams.get('after');const list=after?[]:state.changes;return {status:200,body:{after:after||'cursor-1',list}};}
  return {status:404,body:{}};
 };
 return {state,transport};
}
const connectInput={username:'qa-api-user',password:PASSWORD,iysCode:'123456',brandCode:'654321',environment:'sandbox'};
async function connected(f,scope='tr'){const fake=fakeIys(),iys=new ProjectIys(f.db,f.scope,KEY,fake.transport);iys.declare({scope});if(scope==='tr')await iys.connect(connectInput);return {fake,iys};}

test('declaration gates live sends: missing blocks, "no" passes, "yes" needs a connection',async()=>{
 const f=fixture({iys:null});try{
  assert.match(iysSendBlock(f.db,f.scope),/İYS beyanını yapın/);assert.equal(iysGate(f.db,f.scope,'EPOSTA','a'.repeat(64)),'iys_scope_missing');
  const iys=new ProjectIys(f.db,f.scope,KEY,fakeIys().transport);
  assert.throws(()=>iys.declare({scope:'maybe'}));
  iys.declare({scope:'none'});assert.equal(iysSendBlock(f.db,f.scope),null);assert.equal(iysGate(f.db,f.scope,'EPOSTA','a'.repeat(64)),null);
  const view=iys.declare({scope:'tr'});assert.equal(view.scope,'tr');assert.ok(view.declaredAt);
  assert.match(iysSendBlock(f.db,f.scope),/İYS bağlantısı gerekli/);assert.equal(iysGate(f.db,f.scope,'EPOSTA','a'.repeat(64)),'iys_not_connected');
  const viewer=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'iys-viewer',password:'fixture-password-123',role:'viewer'});
  assert.throws(()=>new ProjectIys(f.db,{...f.scope,subject:viewer.userId},KEY).declare({scope:'none'}),error=>error.status===403);
  assert.equal(new ProjectIys(f.db,{...f.scope,subject:viewer.userId},KEY).view().scope,'tr','viewers can read the declaration');
  // Crewin has its own declaration for its WhatsApp sender (test/crewin-iys.test.cjs); a project's declaration is not Crewin's.
  assert.equal(new ProjectIys(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'},KEY).view().scope,null);
  assert.throws(()=>new ProjectIys(f.db,{subject:f.a.userId,organizationId:'crewin',projectId:'crewinjob'},KEY).view(),error=>error.status===403,'only Crewin’s own account');
 }finally{f.db.close();}
});

test('connecting verifies the user and brand and never shows the password',async()=>{
 const f=fixture();try{
  const fake=fakeIys(),iys=new ProjectIys(f.db,f.scope,KEY,fake.transport);iys.declare({scope:'tr'});
  await assert.rejects(iys.connect({...connectInput,password:'wrong'}),/kullanıcı adı veya şifresi/);
  await assert.rejects(iys.connect({...connectInput,brandCode:'999999'}),/Marka kodu/);
  await assert.rejects(iys.connect({...connectInput,iysCode:'abc'}),/yalnız rakam/);
  const view=await iys.connect(connectInput);
  assert.equal(view.connection.brandCode,'654321');assert.equal(view.connection.environment,'sandbox');
  assert.ok(!JSON.stringify(view).includes(PASSWORD));assert.ok(!JSON.stringify(f.db.prepare("SELECT * FROM platform_connections WHERE provider='iys'").all()).includes(PASSWORD),'stored encrypted');
  assert.equal(iysSendBlock(f.db,f.scope),null);
  assert.equal(new ProjectIys(f.db,f.scope,KEY).revoke().connection,null);assert.match(iysSendBlock(f.db,f.scope),/bağlantısı gerekli/);
 }finally{f.db.close();}
});

test('consents are queued within three business days, uploaded by the worker and then pass the gate',async()=>{
 const f=fixture();try{
  const {fake}=await connected(f),email='pilot0@example.com',key=iysEmailKey(f.scope,KEY,email);
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),'iys_no_consent');
  assert.equal(queueIysConsent(f.db,f.scope,KEY,{channel:'EPOSTA',recipient:email,status:'ONAY',source:'HS_WEB',consentDate:new Date(Date.now()-86400000*10).toISOString(),actor:f.scope.subject}),'too_old','older than 3 business days: İYS should already hold it');
  assert.equal(queueIysConsent(f.db,f.scope,KEY,{channel:'EPOSTA',recipient:email,status:'ONAY',source:'HS_WEB',consentDate:new Date(Date.now()-3600000).toISOString(),actor:f.scope.subject}),'queued');
  const row=f.db.prepare('SELECT * FROM platform_iys_outbox').get();assert.ok(!JSON.stringify(row).includes(email),'the address is stored encrypted');assert.equal(row.masked,'p***@e***');
  assert.deepEqual(plain(await deliverIysOutbox(f.db,KEY,fake.transport)),{sent:1,failed:0});
  const upload=fake.state.requests.find(item=>item.path==='/sps/123456/brands/654321/consents');
  assert.deepEqual(plain({...upload.body,consentDate:undefined}),{recipient:email,type:'EPOSTA',status:'ONAY',source:'HS_WEB',recipientType:'BIREYSEL'});assert.match(upload.body.consentDate,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),null,'accepted by İYS and fresh');
  f.db.prepare("UPDATE platform_iys_recipients SET checked_at=?").run(new Date(Date.now()-25*3600000).toISOString());
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),'iys_stale','older than 24 hours without a change feed');
  await pullIysChanges(f.db,KEY,fake.transport);assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),null,'a healthy change feed keeps it current');
  assert.equal(new ProjectIys(f.db,f.scope,KEY).view().outbox.sent,1);
 }finally{f.db.close();}
});

test('opt-outs stop sending at once and reach İYS: review withdrawal, unsubscribe link and İYS-side rejection',async()=>{
 const f=fixture();try{
  const {fake}=await connected(f),recipients=new EmailRecipients(f.db,f.scope,KEY),contact=recipients.list(f.source.id).contacts.find(item=>item.maskedEmail.startsWith('p'));
  assert.throws(()=>recipients.review({sourceId:f.source.id,contactKey:contact.key,expectedDecisionId:contact.decisionId,decision:'reviewed',evidenceRef:'qa/consent-2',recordedAt:new Date().toISOString(),note:'Fixture.',acknowledged:true}),/İYS için iznin nasıl alındığını seçin/);
  recipients.review({sourceId:f.source.id,contactKey:contact.key,expectedDecisionId:contact.decisionId,decision:'withdrawn',evidenceRef:'',recordedAt:'',note:'Fixture withdrawal.',acknowledged:true});
  const ret=f.db.prepare("SELECT status,state FROM platform_iys_outbox").all();assert.deepEqual(plain(ret),[{status:'RET',state:'queued'}]);
  const withdrawnKey=f.db.prepare('SELECT recipient_key FROM platform_iys_outbox').get().recipient_key;assert.equal(iysGate(f.db,f.scope,'EPOSTA',withdrawnKey),'iys_rejected','blocked before İYS is even told');
  await deliverIysOutbox(f.db,KEY,fake.transport);assert.equal([...fake.state.register.values()][0].status,'RET');
  // An unsubscribe link: the address is found in the mapped source and the opt-out queued in the same transaction.
  const record=f.db.prepare('SELECT external_id,attributes_json FROM platform_product_records WHERE connection_id=? ORDER BY external_id').all(f.source.id).find(row=>emailIdentity(f.scope,KEY,'email',[JSON.parse(row.attributes_json).email])!==withdrawnKey);
  const email=JSON.parse(record.attributes_json).email,entityKey=emailIdentity(f.scope,KEY,'entity',[f.source.id,record.external_id]),emailKey=emailIdentity(f.scope,KEY,'email',[email]);
  const link=newUnsubscribeToken(f.db,f.scope,{sourceId:f.source.id,entityKey,emailKey,maskedEmail:'x'}),token=decodeURIComponent(link.path.split('token=')[1]);
  processRyzevoUnsubscribe(f.db,token,false,item=>{queueIysUnsubscribe(f.db,item.scope,KEY,item.sourceId,item.entityKey,item.emailKey);});
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',emailKey),'iys_rejected');
  const queued=f.db.prepare("SELECT state,encrypted_recipient FROM platform_iys_outbox WHERE recipient_key=?").get(emailKey);assert.equal(queued.state,'queued');assert.ok(queued.encrypted_recipient);
  // A record that is gone: the opt-out still blocks and waits for a person to report it.
  assert.equal(queueIysUnsubscribe(f.db,f.scope,KEY,f.source.id,'f'.repeat(64),'e'.repeat(64)),'queued');
  assert.equal(f.db.prepare("SELECT state FROM platform_iys_outbox WHERE recipient_key=?").get('e'.repeat(64)).state,'failed');
  // İYS-side rejection through the change feed.
  const third='pilot5@example.com';fake.state.changes.push({recipient:third,type:'EPOSTA',status:'RET',consentDate:'2026-10-01 10:00:00'});
  await pullIysChanges(f.db,KEY,fake.transport);assert.equal(iysGate(f.db,f.scope,'EPOSTA',iysEmailKey(f.scope,KEY,third)),'iys_rejected');
  const view=new ProjectIys(f.db,f.scope,KEY).view();assert.equal(view.pull.state,'ok');assert.ok(view.attention.some(item=>item.state==='failed'));
  assert.ok(teamAlerts(f.db,f.scope).some(item=>item.kind==='iys_deadline'),'the failed record is a team alert');
 }finally{f.db.close();}
});

test('the email pilot refuses a live send without a declaration and skips recipients without İYS consent',async()=>{
 const f=fixture({iys:null});try{
  const review=f.approve();
  assert.throws(()=>f.queue.enqueue(f.input(review,'iys-live-1'),'send'),/İYS beyanını yapın/);
  const review2=f.reviews.get(f.campaign.id);assert.equal(review2.checks.find(item=>item.code==='iys').state,'blocked');
  new ProjectIys(f.db,f.scope,KEY).declare({scope:'none'});assert.equal(f.reviews.get(f.campaign.id).checks.find(item=>item.code==='iys').state,'pass');
  await connected(f);
  assert.equal(f.queue.list(f.campaign.id,'send').jobs.length,0,'nothing was queued');
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',iysEmailKey(f.scope,KEY,'pilot0@example.com')),'iys_no_consent','a live send would skip this recipient');
 }finally{f.db.close();}
});

test('WhatsApp: a Turkey project names the consent source, opt-outs are reported, removed opt-outs stay blocked',async()=>{
 const f=fixture();try{
  const {fake}=await connected(f),graph=async()=>({status:200,payload:{}}),wa=new ProjectWhatsApp(f.db,f.scope,KEY,graph),today=new Date().toISOString().slice(0,10);
  assert.throws(()=>wa.addContacts({phones:'+905321234567',evidence:'form-1',consentAt:today,acknowledged:true}),/İYS için iznin nasıl alındığını seçin/);
  wa.addContacts({phones:'+905321234567',evidence:'form-1',consentAt:today,iysSource:'HS_WEB',acknowledged:true});
  const queued=f.db.prepare("SELECT channel,status,state FROM platform_iys_outbox").all();assert.deepEqual(plain(queued),[{channel:'MESAJ',status:'ONAY',state:'queued'}]);
  const phoneKey=iysPhoneKey(f.scope,KEY,'+905321234567');assert.equal(f.db.prepare('SELECT phone_hash FROM platform_whatsapp_contacts').get().phone_hash,phoneKey,'the same key the WhatsApp store uses');
  assert.equal(iysGate(f.db,f.scope,'MESAJ',phoneKey),'iys_no_consent');
  await deliverIysOutbox(f.db,KEY,fake.transport);assert.equal(iysGate(f.db,f.scope,'MESAJ',phoneKey),null);
  const id=f.db.prepare('SELECT id FROM platform_whatsapp_contacts').get().id;wa.optOut({id});
  assert.equal(iysGate(f.db,f.scope,'MESAJ',phoneKey),'iys_rejected');assert.equal(f.db.prepare("SELECT status FROM platform_iys_outbox WHERE state='queued'").get().status,'RET');
  wa.removeContact({id});
  assert.throws(()=>wa.addContacts({phones:'+905321234567',evidence:'form-2',consentAt:today,iysSource:'HS_WEB',acknowledged:true}),/daha önce izinden çıktı/,'a removed opt-out cannot come back with an older consent');
  // Live batches need the declaration before queueing (checked before the send switch is even read).
  const none=fixture({iys:null});try{assert.match(iysSendBlock(none.db,none.scope),/İYS beyanını yapın/);}finally{none.db.close();}
 }finally{f.db.close();}
});

test('status queries are bounded and report what İYS holds; business-day deadlines skip weekends',async()=>{
 const f=fixture();try{
  const {fake,iys}=await connected(f);fake.state.register.set('EPOSTA\npilot1@example.com',{status:'ONAY',consentDate:'2026-09-01 10:00:00',source:'HS_WEB'});
  const result=await iys.query([{channel:'EPOSTA',value:'pilot1@example.com'},{channel:'EPOSTA',value:'pilot2@example.com'},{channel:'EPOSTA',value:'not-an-address'}]);
  assert.deepEqual(plain({checked:result.checked,onay:result.onay,ret:result.ret,none:result.none}),{checked:2,onay:1,ret:0,none:1});
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',iysEmailKey(f.scope,KEY,'pilot1@example.com')),null);
  assert.equal(iysDueAt('2026-10-30T09:00:00Z'),'2026-11-04T20:59:59.000Z','Friday + 3 business days = Wednesday 23:59:59 Istanbul');
  assert.equal(iysDueAt('2026-10-28T09:00:00Z'),'2026-11-03T20:59:59.000Z','29 October is skipped; the half day before it counts');
  assert.equal(iysDueAt('2026-05-25T09:00:00Z'),'2026-06-02T20:59:59.000Z','the eve counts, the four days of Kurban Bayramı do not');
  assert.equal(iysDueAt('2029-04-20T09:00:00Z'),'2029-04-26T20:59:59.000Z','fixed holidays apply in any year');
  assert.equal(iysDueAt('2028-02-24T09:00:00Z'),'2028-02-29T20:59:59.000Z','a year without published religious dates is never extended');
  assert.equal(iysDate('2026-10-30T09:00:00Z'),'2026-10-30 12:00:00');
  fake.state.failAdd=true;queueIysConsent(f.db,f.scope,KEY,{channel:'EPOSTA',recipient:'pilot3@example.com',status:'ONAY',source:'HS_WEB',consentDate:new Date().toISOString(),actor:f.scope.subject});
  await deliverIysOutbox(f.db,KEY,fake.transport);const failed=f.db.prepare("SELECT state,last_error FROM platform_iys_outbox WHERE state='failed'").get();
  assert.equal(failed.state,'failed','a rejection by İYS is final');assert.match(failed.last_error,/H174/);assert.ok(!failed.last_error.includes(PASSWORD));
  assert.ok(iysAttention(f.db,f.scope).items.length>=1);
 }finally{f.db.close();}
});

test('switched off, İYS checks, queues and screens do nothing and stored records stay',async()=>{
 const f=fixture({iys:null});try{
  const {fake}=await connected(f);queueIysConsent(f.db,f.scope,KEY,{channel:'EPOSTA',recipient:'pilot0@example.com',status:'RET',source:'HS_WEB',consentDate:new Date().toISOString(),actor:f.scope.subject});
  const key=iysEmailKey(f.scope,KEY,'pilot0@example.com');assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),'iys_rejected');
  delete process.env.NEXT_PUBLIC_IYS_ENABLED;
  try{
   assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),null,'no gate');assert.equal(iysSendBlock(f.db,f.scope),null,'live sends are not held back');
   assert.equal(queueIysConsent(f.db,f.scope,KEY,{channel:'EPOSTA',recipient:'pilot1@example.com',status:'RET',source:'HS_WEB',consentDate:new Date().toISOString(),actor:f.scope.subject}),'not_required');
   assert.deepEqual(plain(await deliverIysOutbox(f.db,KEY,fake.transport)),{sent:0,failed:0});assert.equal(fake.state.requests.filter(item=>item.path.endsWith('/consents')).length,0,'nothing reaches İYS');
   assert.equal(iysAttention(f.db,f.scope),null);assert.ok(!teamAlerts(f.db,f.scope).some(item=>item.kind.startsWith('iys')));
   assert.throws(()=>new ProjectIys(f.db,f.scope,KEY).view(),error=>error.status===404);
   assert.equal(f.reviews.get(f.campaign.id).checks.some(item=>item.code==='iys'),false,'no İYS check in the review');
   assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_iys_outbox').get().n,1,'stored records are kept');
  }finally{process.env.NEXT_PUBLIC_IYS_ENABLED='1';}
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),'iys_rejected','switching back on restores the gate');
 }finally{f.db.close();}
});

test('the merchant exemption: off by default, opt-in with an acknowledgement, a rejection check instead of a consent',async()=>{
 const f=fixture();try{
  const {fake,iys}=await connected(f),shop='shop@example.com',key=iysEmailKey(f.scope,KEY,shop),other=iysEmailKey(f.scope,KEY,'b@example.com');
  assert.equal(iys.view().merchants.enabled,false);
  assert.throws(()=>iys.addMerchants({channel:'EPOSTA',recipients:shop,evidence:'QA Ltd'}),/Tacir/i,'marking needs the exemption on');
  assert.throws(()=>iys.setMerchantExemption({enabled:true}),/açık onay/);
  let view=iys.setMerchantExemption({enabled:true,acknowledged:true});assert.equal(view.merchants.enabled,true);assert.ok(view.merchants.at);
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),'iys_no_consent','an unmarked recipient still needs a consent');
  for(const bad of [{channel:'SMS',recipients:shop,evidence:'QA Ltd'},{channel:'EPOSTA',recipients:shop,evidence:'x'},{channel:'EPOSTA',recipients:'not-an-email',evidence:'QA Ltd'},{channel:'EPOSTA',recipients:'',evidence:'QA Ltd'}])assert.throws(()=>iys.addMerchants(bad),JSON.stringify(bad));
  view=iys.addMerchants({channel:'EPOSTA',recipients:`${shop}\nb@example.com`,evidence:'Ticari unvan: QA Ltd'});
  assert.equal(view.merchants.total,2);assert.ok(!JSON.stringify(view).includes(shop),'addresses are masked');
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),'iys_stale','a merchant must be checked in IYS once');
  const viewer=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'iys-merchant-viewer',password:'fixture-password-123',role:'viewer'});
  const outsider=new ProjectIys(f.db,{...f.scope,subject:viewer.userId},KEY,fake.transport);
  assert.throws(()=>outsider.addMerchants({channel:'EPOSTA',recipients:'c@example.com',evidence:'QA Ltd'}),error=>error.status===403);
  assert.throws(()=>outsider.setMerchantExemption({enabled:false}),error=>error.status===403);assert.deepEqual(plain(outsider.view().merchants.list),[],'viewers see the count, not the list');
  const result=await iys.query([{channel:'EPOSTA',value:shop},{channel:'EPOSTA',value:'b@example.com'}]);
  assert.equal(result.none,2);assert.ok(fake.state.requests.filter(item=>item.path.endsWith('/consents/status')).every(item=>item.body.recipientType==='TACIR'),'merchants are checked as TACIR');
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),null,'no rejection: the merchant may be sent to');
  // A rejection through IYS stops sending; the merchant's opt-out is reported as TACIR.
  fake.state.register.set(`EPOSTA\n${shop}`,{status:'RET',consentDate:'2026-11-01 10:00:00',source:'HS_WEB'});
  await iys.query([{channel:'EPOSTA',value:shop}]);assert.equal(iysGate(f.db,f.scope,'EPOSTA',key),'iys_rejected');
  assert.equal(queueIysConsent(f.db,f.scope,KEY,{channel:'EPOSTA',recipient:'b@example.com',status:'RET',source:'HS_WEB',consentDate:new Date().toISOString(),actor:f.a.userId}),'queued');
  assert.equal(f.db.prepare("SELECT recipient_type FROM platform_iys_outbox WHERE state='queued'").get().recipient_type,'TACIR');
  await deliverIysOutbox(f.db,KEY,fake.transport);
  assert.equal(fake.state.requests.filter(item=>item.path.endsWith('/consents')).at(-1).body.recipientType,'TACIR');
  assert.equal(iysGate(f.db,f.scope,'EPOSTA',other),'iys_rejected');
  // Off again: marked recipients need a consent like everyone else.
  view=iys.addMerchants({channel:'MESAJ',recipients:'+90 532 111 22 99',evidence:'Esnaf: QA Kırtasiye'});
  await iys.query([{channel:'MESAJ',value:'+905321112299'}]);const phone=iysPhoneKey(f.scope,KEY,'+905321112299');assert.equal(iysGate(f.db,f.scope,'MESAJ',phone),null);
  iys.setMerchantExemption({enabled:false});assert.equal(iysGate(f.db,f.scope,'MESAJ',phone),'iys_no_consent');
  assert.equal(iys.removeMerchant({channel:'MESAJ',key:phone}).merchants.total,2);assert.throws(()=>iys.removeMerchant({channel:'MESAJ',key:phone}),error=>error.status===404);
 }finally{f.db.close();}
});
