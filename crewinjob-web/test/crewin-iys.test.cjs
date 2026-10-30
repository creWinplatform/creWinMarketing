const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {load}=require('./platform-loader.cjs');
// Crewin's İYS for its own WhatsApp sender: declaration and connection on the Crewin project, the gate on Turkish numbers,
// and consents and opt-outs queued for İYS. A fake İYS transport, a fake sender and temporary files: no network.
const saved={AUTH_SECRET:process.env.AUTH_SECRET,TRACKING_SECRET:process.env.TRACKING_SECRET};
process.env.AUTH_SECRET='crewin-iys-fixture-secret-only';delete process.env.TRACKING_SECRET;
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts');
const {ProjectIys,deliverIysOutbox,pullIysChanges}=load('iys.ts');
const {crewinIys,crewinKnownIysPhones}=load('../crewin-iys.ts');
const m=load('../legacy-whatsapp-consent.ts');
const KEY='78'.repeat(32),PASSWORD='crewin-iys-fixture-password',CREWIN={subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crewin-iys-'));let files=0;const fresh=()=>path.join(dir,`consents-${++files}.json`);
const plain=value=>JSON.parse(JSON.stringify(value));
const day=offset=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul'}).format(new Date(Date.now()+offset*86400000)),today=day(0);
// Fixture numbers: two Turkish, one Philippine.
const A='+905550000011',B='+905550000022',P='+639170000011';
// A stand-in for İYS: answers from a small in-memory register.
function fakeIys(){
 const state={requests:[],register:new Map(),changes:[]};
 const transport=async request=>{
  const url=new URL(request.url),body=request.body?JSON.parse(request.body):null;state.requests.push({path:url.pathname,body});
  if(url.pathname==='/oauth2/token')return body.password===PASSWORD?{status:200,body:{access_token:'fake-token',expires_in:7200}}:{status:401,body:{}};
  if(request.headers.Authorization!=='Bearer fake-token')return {status:401,body:{}};
  if(url.pathname==='/sps/123456/brands')return {status:200,body:[{brandCode:'654321'}]};
  if(url.pathname==='/sps/123456/brands/654321/consents'){state.register.set(`${body.type}\n${body.recipient}`,body);return {status:200,body:{transactionId:`tx-${state.requests.length}`}};}
  if(url.pathname==='/sps/123456/brands/654321/consents/status'){const item=state.register.get(`${body.type}\n${body.recipient}`);return item?{status:200,body:{status:item.status,consentDate:item.consentDate,source:item.source}}:{status:404,body:{}};}
  if(url.pathname==='/sps/123456/brands/654321/consents/changes'){const after=url.searchParams.get('after');return {status:200,body:{after:after||'cursor-1',list:after?[]:state.changes}};}
  return {status:404,body:{}};
 };
 return {state,transport};
}
function setup(){
 const db=openPlatformDatabase(':memory:');new PlatformRepository(db).bootstrapLegacy('admin');
 const fake=fakeIys(),panel=new ProjectIys(db,CREWIN,KEY,fake.transport);
 const connect=()=>panel.connect({username:'qa-api-user',password:PASSWORD,iysCode:'123456',brandCode:'654321',environment:'sandbox'});
 return {db,fake,panel,connect,iys:crewinIys(db,KEY,fake.transport)};
}
function fakeSender(codes={}){
 const calls=[],one=to=>codes[to]?{success:false,error:'fixture refusal',code:codes[to]}:{success:true,messageId:`wamid.fixture.${calls.length}`};
 return {calls,sender:{
  async sendWhatsAppMessage(to,text){calls.push(to);return one(to);},
  async sendWhatsAppTemplate(to){calls.push(to);return one(to);},
  async broadcastWhatsApp(numbers){const results=numbers.map(to=>{calls.push(to);const r=one(to);return {to,success:r.success,...(r.code?{code:r.code}:{})};});return {sent:results.filter(r=>r.success).length,failed:results.filter(r=>!r.success).length,errors:[],results};},
 }};
}
const consent=(file,numbers,iys,extra={})=>m.recordLegacyWhatsAppConsent({numbers,evidence:'Kayıt formu F-1 (fixture)',consentAt:today,...extra},'fixture-admin',file,iys);
const outbox=db=>plain(db.prepare("SELECT status,source,state FROM platform_iys_outbox WHERE organization_id='crewin' ORDER BY created_at").all());

test('Crewin declares and connects İYS on its own project; the password is never shown',async()=>{
 const f=setup();try{
  assert.equal(f.panel.view().scope,null,'Crewin can open the İYS settings');
  assert.match(f.iys.block(),/İYS beyanını yapın/);
  f.panel.declare({scope:'none'});assert.equal(f.iys.block(),null);assert.equal(f.iys.gate(A),null,'"no": no İYS check');
  f.panel.declare({scope:'tr'});assert.equal(f.iys.connected(),false);assert.equal(f.iys.gate(A),'iys_not_connected');
  const view=await f.connect();assert.equal(view.connection.brandCode,'654321');assert.ok(!JSON.stringify(view).includes(PASSWORD));
  assert.equal(f.iys.connected(),true);assert.equal(f.iys.gate(P),null,'İYS is about Turkish numbers only');
 }finally{f.db.close();}
});

test('without a declaration nothing is sent; after "Turkey" a +90 number needs İYS, others only the local consent',async()=>{
 const f=setup(),file=fresh();try{
  await consent(file,[A,B,P]);const {calls,sender}=fakeSender();
  let out=await m.sendLegacyWhatsApp({mode:'broadcast',numbers:[A,P],text:'Merhaba'},sender,file,f.iys);
  assert.equal(out.status,409);assert.match(out.body.error,/İYS beyanını yapın/);assert.equal(calls.length,0);
  f.panel.declare({scope:'none'});
  out=await m.sendLegacyWhatsApp({mode:'broadcast',numbers:[A,P],text:'Merhaba'},sender,file,f.iys);assert.equal(out.body.sent,2);
  calls.length=0;f.panel.declare({scope:'tr'});
  out=await m.sendLegacyWhatsApp({mode:'broadcast',numbers:[A,P],text:'Merhaba'},sender,file,f.iys);
  assert.deepEqual(calls,[P]);assert.deepEqual(plain(out.body.skipped),{invalid:0,no_consent:0,opted_out:0,iys:1});assert.equal(out.body.skippedNumbers[0].iys,'iys_not_connected');
  await f.connect();calls.length=0;
  out=await m.sendLegacyWhatsApp({mode:'single',to:A,text:'Merhaba'},sender,file,f.iys);
  assert.equal(out.status,409);assert.match(out.body.error,/İYS/);assert.equal(out.body.skippedNumbers[0].iys,'iys_no_consent');assert.equal(calls.length,0);
  // A consent İYS confirms (here: one we queued and the worker uploaded) lets the message go.
  f.fake.state.register.set(`MESAJ\n${A}`,{status:'ONAY',consentDate:'2026-10-01 10:00:00',source:'HS_WEB'});
  assert.deepEqual(plain(await f.iys.query([A,P])),{checked:1,onay:1,ret:0,none:0},'only the Turkish number is asked');
  out=await m.sendLegacyWhatsApp({mode:'single',to:A,text:'Merhaba'},sender,file,f.iys);assert.equal(out.status,200);assert.deepEqual(calls,[A]);
  // A rejection made on İYS's side (change feed) stops it again, although the local consent stays.
  f.fake.state.changes.push({recipient:A,type:'MESAJ',status:'RET',consentDate:'2026-10-30 10:00:00'});await pullIysChanges(f.db,KEY,f.fake.transport);
  out=await m.sendLegacyWhatsApp({mode:'broadcast',numbers:[A,B],text:'Merhaba'},sender,file,f.iys);
  assert.equal(out.status,409);assert.match(out.body.error,/İYS kontrolü/);assert.deepEqual(plain(out.body.skippedNumbers.map(item=>item.iys)),['iys_rejected','iys_no_consent']);
  assert.deepEqual(crewinKnownIysPhones(f.db,KEY),[A],'the settings check re-asks numbers İYS reported on');
 }finally{f.db.close();}
});

test('after "Turkey", consents of Turkish numbers need their İYS source and are queued; old ones are not',async()=>{
 const f=setup(),file=fresh();try{
  f.panel.declare({scope:'tr'});await f.connect();
  await assert.rejects(consent(file,[A],f.iys),/izin nasıl alındı/);
  assert.deepEqual(plain(await consent(file,[P],f.iys)),{added:1,renewed:0,existing:0,iys:{queued:0,tooOld:0,failed:0}},'a non-Turkish number needs no source');
  assert.deepEqual(plain((await consent(file,[A,P],f.iys,{source:'HS_WEB'})).iys),{queued:1,tooOld:0,failed:0});
  assert.deepEqual(outbox(f.db),[{status:'ONAY',source:'HS_WEB',state:'queued'}]);
  assert.deepEqual(plain(await deliverIysOutbox(f.db,KEY,f.fake.transport)),{sent:1,failed:0});assert.equal(f.iys.gate(A),null,'uploaded consent opens the gate');
  assert.deepEqual(plain((await consent(file,[B],f.iys,{source:'HS_ISLAK_IMZA',consentAt:day(-30)})).iys),{queued:0,tooOld:1,failed:0},'older than 3 business days: query İYS instead');
  f.panel.declare({scope:'none'});assert.deepEqual(plain((await consent(fresh(),[A],f.iys)).iys),{queued:0,tooOld:0,failed:0},'"no": nothing is reported');
 }finally{f.db.close();}
});

test('opt-outs of Turkish numbers go to İYS as RET from the panel, STOP replies and Meta 131050',async()=>{
 const f=setup(),file=fresh(),env={...process.env};try{
  f.panel.declare({scope:'tr'});await f.connect();
  await consent(file,[A,B,P,'+905550000033'],f.iys,{source:'HS_WEB'});f.db.prepare("DELETE FROM platform_iys_outbox").run();
  assert.deepEqual(plain((await m.recordLegacyWhatsAppOptOut([A,P],'team',file,f.iys,'fixture-admin')).iys),{queued:1,tooOld:0,failed:0});
  Object.assign(process.env,{WHATSAPP_APP_SECRET:'fixture-app-secret-0123456789',WHATSAPP_WEBHOOK_VERIFY_TOKEN:'fixture_verify_token_0123',WHATSAPP_PHONE_NUMBER_ID:'1234567890'});
  const body=Buffer.from(JSON.stringify({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'1234567890'},messages:[{from:B.slice(1),text:{body:'STOP'}}]}}]}]}));
  const signature=`sha256=${require('node:crypto').createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(body).digest('hex')}`;
  assert.deepEqual(plain(await m.receiveLegacyWhatsAppHook(body,signature,file,f.iys)),{optOuts:1});
  f.fake.state.register.set('MESAJ\n+905550000033',{status:'ONAY',consentDate:'2026-10-01 10:00:00',source:'HS_WEB'});await f.iys.query(['+905550000033']);
  const out=await m.sendLegacyWhatsApp({mode:'single',to:'+905550000033',text:'x'},fakeSender({'+905550000033':131050}).sender,file,f.iys);assert.equal(out.body.optedOutByMeta,1);
  assert.deepEqual(outbox(f.db).map(item=>item.status),['RET','RET','RET']);
  assert.equal(f.iys.gate(A),'iys_rejected','an opt-out blocks at once, before İYS is told');
 }finally{f.db.close();for(const key of ['WHATSAPP_APP_SECRET','WHATSAPP_WEBHOOK_VERIFY_TOKEN','WHATSAPP_PHONE_NUMBER_ID'])if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}
});

test('the routes pass Crewin İYS to every legacy WhatsApp path; the İYS settings open for the Crewin workspace',()=>{
 const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 for(const file of ['app/api/messaging/whatsapp/send/route.ts','app/api/messaging/whatsapp/hook/route.ts','app/api/messaging/whatsapp/consents/route.ts'])assert.match(read(file),/crewinIys\(platformDatabase\(\), credentialEncryptionKey\(\)\)/,file);
 assert.match(read('app/api/platform/iys/route.ts'),/getRyzevoAccess\(\)/);
 assert.match(read('components/platform/ProjectSettings.tsx'),/ryzevoFeature\(project\.productPack, 'iys'\)/);
});

test.after(()=>{fs.rmSync(dir,{recursive:true,force:true});for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
