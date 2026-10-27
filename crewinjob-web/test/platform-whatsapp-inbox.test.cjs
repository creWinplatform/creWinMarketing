const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHmac}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {ProjectWhatsApp,receiveWhatsAppHook}=load('whatsapp.ts');
const {ProjectSocialInbox,whatsAppInboundFrom}=load('social-inbox.ts');
// Inbound WhatsApp messages in the project inbox (schema 55). Disposable stubs only; no network is used.
const KEY='56'.repeat(32),TOKEN='EAAFixtureWhatsAppTokenOnly_not_real',SECRET='ab'.repeat(16);
const graph=async(method,path)=>{
  if(path==='1234567890')return {status:200,payload:{display_phone_number:'+90 212 000 00 00',verified_name:'Ryzevo QA',quality_rating:'GREEN'}};
  if(path==='9988776655/phone_numbers')return {status:200,payload:{data:[{id:'1234567890'}]}};
  if(path==='9988776655/message_templates')return {status:200,payload:{data:[]}};
  return {status:404,payload:{}};
};
const fakeHttp=()=>{const calls=[];const http=async request=>{calls.push({...request,path:new URL(request.url).pathname});
  if(new URL(request.url).pathname.endsWith('/1234567890/messages'))return {status:200,header:()=>null,payload:{messaging_product:'whatsapp',contacts:[{wa_id:request.json.to}],messages:[{id:'wamid.ReplyFixture=='}]}};
  return {status:404,header:()=>null,payload:{}};};return {calls,http};};
const event=(messages,phone='1234567890')=>Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'9988776655',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:phone},contacts:[{wa_id:'905321112234',profile:{name:'Private Name'}}],messages}}]}]}));
const sign=body=>`sha256=${createHmac('sha256',SECRET).update(body).digest('hex')}`;
const seconds=(hoursAgo=0)=>String(Math.floor((Date.now()-hoursAgo*3600000)/1000));
const run=fn=>coachRun(async f=>{
  const saved={...process.env};
  try{
    Object.assign(process.env,{PLATFORM_WHATSAPP_SEND_ENABLED:'0',PLATFORM_SOCIAL_PUBLISH_ENABLED:'0'});
    const wa=new ProjectWhatsApp(f.db,f.scope,KEY,graph);await wa.connect({phoneNumberId:'1234567890',wabaId:'9988776655',accessToken:TOKEN});
    const hookId=wa.setupHooks({appSecret:SECRET}).snapshot.hook.callbackPath.split('/').pop();
    const {calls,http}=fakeHttp();
    await fn({...f,wa,hookId,calls,inbox:(scope=f.scope)=>new ProjectSocialInbox(f.db,scope,KEY,http),hook:messages=>{const body=event(messages);return receiveWhatsAppHook(f.db,KEY,hookId,body,sign(body));}});
  }finally{for(const key of ['PLATFORM_WHATSAPP_SEND_ENABLED','PLATFORM_SOCIAL_PUBLISH_ENABLED'])if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
});

test('message parsing keeps words of text, buttons and list answers; other types become a label; reactions are skipped',()=>{
  const at=seconds();
  assert.equal(whatsAppInboundFrom({from:'905321112234',id:'wamid.A==',type:'text',timestamp:at,text:{body:' Merhaba '}}).text,'Merhaba');
  assert.equal(whatsAppInboundFrom({from:'905321112234',id:'wamid.B',type:'button',timestamp:at,button:{text:'Bilgi'}}).text,'Bilgi');
  assert.equal(whatsAppInboundFrom({from:'905321112234',id:'wamid.C',type:'interactive',timestamp:at,interactive:{list_reply:{title:'Hafta sonu'}}}).text,'Hafta sonu');
  assert.equal(whatsAppInboundFrom({from:'905321112234',id:'wamid.D',type:'image',timestamp:at,image:{id:'media-1'}}).text,'[image]');
  assert.equal(whatsAppInboundFrom({from:'905321112234',id:'wamid.E',type:'reaction',timestamp:at,reaction:{emoji:'👍'}}),null);
  for(const bad of [{from:'abc'},{from:'0532'},{id:'bad id with spaces'},{timestamp:'never'}])assert.equal(whatsAppInboundFrom({from:'905321112234',id:'wamid.F',type:'text',timestamp:at,text:{body:'x'},...bad}),null,JSON.stringify(bad));
});

test('inbound messages land in the inbox masked and hashed; STOP opts out and is not stored; duplicates are ignored',run(async f=>{
  const messages=[{from:'905321112234',id:'wamid.in1==',type:'text',timestamp:seconds(1),text:{body:'Merhaba, fiyat nedir? Numaram 0532 111 22 34'}},
    {from:'905321112235',id:'wamid.in2',type:'image',timestamp:seconds(1),image:{id:'m1'}},{from:'905321112236',id:'wamid.in3',type:'text',timestamp:seconds(),text:{body:'STOP'}},
    {from:'905321112234',id:'wamid.in4',type:'reaction',timestamp:seconds(),reaction:{emoji:'👍'}}];
  assert.equal(f.hook(messages).inbound,2);assert.equal(f.hook(messages).inbound,0,'the same messages are not stored twice');
  const snapshot=f.inbox().read(),account=snapshot.accounts.find(item=>item.platform==='whatsapp');
  assert.deepEqual(plain({comments:account.comments,messages:account.messages,autoReadAllowed:account.autoReadAllowed,live:account.live}),{comments:false,messages:true,autoReadAllowed:false,live:false});
  assert.ok(account.liveEventAt,'the last webhook time is shown');
  const items=snapshot.items.filter(item=>item.platform==='whatsapp');assert.equal(items.length,2);
  assert.ok(items.every(item=>item.kind==='message'&&item.windowOpen));assert.ok(items.some(item=>item.text==='[image]'));
  assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM platform_social_inbox').all())+JSON.stringify(f.db.prepare('SELECT * FROM platform_audit').all()),/905321112234|0532 111 22 34|Private Name|STOP/,'no numbers, names or stop words are stored in clear');
  assert.ok(f.db.prepare("SELECT 1 FROM platform_audit WHERE operation='whatsapp.hook.inbound'").get());
  await assert.rejects(f.inbox().sync({connectionId:account.id}),error=>error.status===409,'there is no pull API for WhatsApp messages');
  assert.throws(()=>f.inbox().setAutoRead({connectionId:account.id,autoRead:true}),error=>error.status===409);
  assert.equal(f.calls.length,0,'reading the inbox makes no provider call');
}));

test('a reply goes to the sender once, behind the WhatsApp switch, the publish duty and the 24-hour window',run(async f=>{
  f.hook([{from:'905321112234',id:'wamid.new',type:'text',timestamp:seconds(2),text:{body:'Yarın açık mısınız?'}},{from:'905321112237',id:'wamid.old',type:'text',timestamp:seconds(30),text:{body:'Eski soru'}}]);
  const find=text=>f.inbox().read().items.find(item=>item.text===text);
  let item=find('Yarın açık mısınız?');f.inbox().saveReply({id:item.id,expectedRevision:item.revision,reply:'Evet, 10:00–18:00 arası açığız.'});item=find('Yarın açık mısınız?');
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';
  await assert.rejects(f.inbox().send({id:item.id,expectedRevision:item.revision,acknowledged:true}),error=>error.status===409,'the social switch does not open WhatsApp replies');
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';process.env.PLATFORM_WHATSAPP_SEND_ENABLED='1';
  assert.equal(f.inbox().read().whatsappSendEnabled,true);
  await assert.rejects(f.inbox().send({id:item.id,expectedRevision:item.revision,acknowledged:false}),error=>error.status===409,'an explicit acknowledgement is required');
  const editor=f.member('editor');await assert.rejects(f.inbox(editor).send({id:item.id,expectedRevision:item.revision,acknowledged:true}),error=>error.status===403);
  const sent=await f.inbox().send({id:item.id,expectedRevision:item.revision,acknowledged:true}),after=sent.items.find(other=>other.id===item.id);
  assert.equal(after.replyState,'sent');assert.equal(after.state,'replied');
  assert.equal(f.calls.length,1);const call=f.calls[0];
  assert.equal(call.path,'/v25.0/1234567890/messages');assert.equal(call.token,TOKEN);
  assert.deepEqual(plain(call.json),{messaging_product:'whatsapp',recipient_type:'individual',to:'905321112234',type:'text',text:{preview_url:false,body:'Evet, 10:00–18:00 arası açığız.'}});
  await assert.rejects(f.inbox().send({id:item.id,expectedRevision:after.revision,acknowledged:true}),error=>error.status===409,'a reply is sent once');
  const old=find('Eski soru');assert.equal(old.windowOpen,false);
  f.inbox().saveReply({id:old.id,expectedRevision:old.revision,reply:'Merhaba'});const stale=find('Eski soru');
  await assert.rejects(f.inbox().send({id:stale.id,expectedRevision:stale.revision,acknowledged:true}),error=>error.status===409&&/24/.test(error.message),'outside the window nothing is sent');
  assert.equal(f.calls.length,1);
}));

test('events for another number are ignored and an unsigned call is refused',run(async f=>{
  const body=event([{from:'905321112234',id:'wamid.x',type:'text',timestamp:seconds(),text:{body:'Merhaba'}}],'111');
  assert.equal(receiveWhatsAppHook(f.db,KEY,f.hookId,body,sign(body)).inbound,0);
  assert.throws(()=>receiveWhatsAppHook(f.db,KEY,f.hookId,body,'sha256='+'0'.repeat(64)),error=>error.status===401);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_social_inbox WHERE platform='whatsapp'").get().n,0);
}));

test('offline recovery authenticates WhatsApp phone numbers, the webhook secret and inbox reply addresses',run(async f=>{
  f.wa.addContacts({phones:'+905321112233',evidence:'QA form',consentAt:'2026-10-01',acknowledged:true});
  f.hook([{from:'905321112234',id:'wamid.rec',type:'text',timestamp:seconds(),text:{body:'Merhaba'}}]);
  const fs=require('node:fs'),path=require('node:path'),folder=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'wa-recovery-')),file=path.join(folder,'snapshot.sqlite');
  try{
    await f.db.backup(file);const {inspectSnapshot}=await import('../scripts/lib/platform-recovery.mjs');
    const counts=['platform_whatsapp_contacts','platform_whatsapp_hooks','platform_social_inbox'].map(table=>f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
    assert.ok(counts.every(n=>n>0),JSON.stringify(counts));
    const others=f.db.prepare("SELECT COUNT(*) n FROM platform_connections WHERE encrypted_credentials<>''").get().n;
    const report=inspectSnapshot(file,KEY,62);assert.equal(report.credentialCheck,'authenticated');
    assert.equal(report.encryptedRecords,others+counts.reduce((a,b)=>a+b,0),'every WhatsApp and inbox envelope is checked, not only the connection');
    // A WhatsApp phone number sealed for another resource is refused even though every connection still opens.
    const copy=new (require('better-sqlite3'))(file);const contact=copy.prepare('SELECT id FROM platform_whatsapp_contacts LIMIT 1').get();
    copy.prepare('UPDATE platform_whatsapp_contacts SET phone_encrypted=(SELECT secret_encrypted FROM platform_whatsapp_hooks LIMIT 1) WHERE id=?').run(contact.id);copy.close();
    assert.throws(()=>inspectSnapshot(file,KEY,62),/credential_authentication_failed/);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
}));
