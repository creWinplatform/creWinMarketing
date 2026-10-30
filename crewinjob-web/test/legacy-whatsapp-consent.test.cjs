const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {load}=require('./platform-loader.cjs');
// Legacy Crewin WhatsApp: consent and opt-out records, the send gate and the STOP webhook. Temporary files and a fake
// sender only: no network, no real WhatsApp message, no Crewin backend. The numbers are fixtures (+90 555 000 00 xx).
const KEYS=['AUTH_SECRET','TRACKING_SECRET','WHATSAPP_APP_SECRET','WHATSAPP_WEBHOOK_VERIFY_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_ACCESS_TOKEN'];
const saved=Object.fromEntries(KEYS.map(key=>[key,process.env[key]]));
for(const key of KEYS)delete process.env[key];
process.env.AUTH_SECRET='legacy-whatsapp-fixture-secret-only';
const APP_SECRET='fixture-app-secret-0123456789abcdef',VERIFY='fixture_verify_token_0123',PHONE_ID='1234567890';
const m=load('../legacy-whatsapp-consent.ts');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-wa-'));
let files=0;const fresh=()=>path.join(dir,`whatsapp-consents-${++files}.json`);
// Consent dates are Turkish calendar days.
const day=offset=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul'}).format(new Date(Date.now()+offset*86400000)),today=day(0);
const [A,B,C,D,E,F,G,H]=[11,22,33,44,55,66,77,88].map(n=>`+9055500000${n}`);
// The module runs in its own context; its objects are compared as plain JSON.
const plain=value=>JSON.parse(JSON.stringify(value));
const consent=async(file,numbers,consentAt=today,evidence='Kayıt formu F-1 (fixture)')=>plain(await m.recordLegacyWhatsAppConsent({numbers,evidence,consentAt},'fixture-admin',file));
const optOut=async(file,numbers,source='team')=>plain(await m.recordLegacyWhatsAppOptOut(numbers,source,file));
const states=(file,numbers)=>plain(m.legacyWhatsAppStatus(numbers,file).map(item=>item.optOutSource?`${item.state}:${item.optOutSource}`:item.state));
function fakeSender(codes={}){
  const calls=[],one=to=>codes[to]?{success:false,error:'fixture refusal',code:codes[to]}:{success:true,messageId:`wamid.fixture.${calls.length}`};
  return {calls,sender:{
    async sendWhatsAppMessage(to,text){calls.push({kind:'text',to,text});return one(to);},
    async sendWhatsAppTemplate(to,name,lang,components){calls.push({kind:'template',to,name,lang,components});return one(to);},
    async broadcastWhatsApp(numbers,text){
      const results=numbers.map(to=>{calls.push({kind:'text',to,text});const result=one(to);return {to,success:result.success,...(result.code?{code:result.code}:{})};});
      return {sent:results.filter(item=>item.success).length,failed:results.filter(item=>!item.success).length,errors:[],results};
    },
  }};
}
const setHook=()=>Object.assign(process.env,{WHATSAPP_APP_SECRET:APP_SECRET,WHATSAPP_WEBHOOK_VERIFY_TOKEN:VERIFY,WHATSAPP_PHONE_NUMBER_ID:PHONE_ID});
const clearHook=()=>{for(const key of ['WHATSAPP_APP_SECRET','WHATSAPP_WEBHOOK_VERIFY_TOKEN','WHATSAPP_PHONE_NUMBER_ID'])delete process.env[key];};
const sign=body=>`sha256=${crypto.createHmac('sha256',APP_SECRET).update(body).digest('hex')}`;
const event=changes=>Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'9988776655',changes}]}));
const meta=(phoneId=PHONE_ID)=>({display_phone_number:'15550001111',phone_number_id:phoneId});
const wa=phone=>phone.slice(1);
const receive=async(body,signature,file)=>plain(await m.receiveLegacyWhatsAppHook(body,signature,file));

test('numbers are normalised to E.164 and the record keeps only a one-way key and a short hint',async()=>{
  assert.equal(m.normalizeWhatsAppNumber('+90 532 123 45 67'),'+905321234567');
  assert.equal(m.normalizeWhatsAppNumber('0090 (532) 123-4567'),'+905321234567');
  for(const bad of ['05321234567','905321234567','+0123456789','abc','',null])assert.equal(m.normalizeWhatsAppNumber(bad),null,String(bad));
  const file=fresh();
  assert.deepEqual(await consent(file,[A,'+90 555 000 00 11']),{added:1,renewed:0,existing:0},'the same number twice is one record');
  const raw=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(raw,/5550000011|905550/,'no full number in the file');
  assert.match(raw,/\+90•••11/);assert.match(raw,/fixture-admin/,'who recorded it is kept');
  assert.deepEqual(states(file,[A,B,'abc']),['consented','none','invalid']);
  assert.deepEqual(await consent(file,[A]),{added:0,renewed:0,existing:1},'recording it again changes nothing');
});

test('a consent needs evidence and a real date that is not in the future; one bad number refuses the list',async()=>{
  const file=fresh();
  await assert.rejects(consent(file,[A],today,'  '),/İzin kanıtı/);
  for(const date of ['2026-02-31','30.10.2026','',day(1),day(2)])await assert.rejects(consent(file,[A],date),/izin tarihi/,date);
  await assert.rejects(consent(file,[A,'0532 123 45 67']),/ülke koduyla/);
  assert.equal(fs.existsSync(file),false,'nothing was written for a refused list');
  await assert.rejects(consent(file,Array.from({length:501},(_,i)=>`+90555${String(i).padStart(7,'0')}`)),/en fazla 500/);
  await assert.rejects(consent(file,[]),/En az bir numara/);
  assert.deepEqual(await consent(file,[A],day(-30)),{added:1,renewed:0,existing:0});
});

test('the gate lets through only consented numbers, once each; opted-out, unknown and invalid ones are skipped',async()=>{
  const file=fresh();
  await consent(file,[A,B]);await optOut(file,[B]);
  const {allowed,skipped}=m.legacyWhatsAppGate([A,' +90 555 000 00 11',B,C,'x12345'],file);
  assert.deepEqual(plain(allowed),[A]);
  assert.deepEqual(plain(skipped.map(item=>item.reason)),['opted_out','no_consent','invalid']);
  assert.ok(skipped.every(item=>!/5550000022|5550000033/.test(item.hint)),'skipped numbers are reported masked');
});

test('single, template and broadcast never reach a number without consent or after an opt-out',async()=>{
  const file=fresh(),{calls,sender}=fakeSender();
  await consent(file,[A,B]);await optOut(file,[B]);
  let out=await m.sendLegacyWhatsApp({mode:'single',to:C,text:'Merhaba'},sender,file);
  assert.equal(out.status,409);assert.match(out.body.error,/kayıtlı WhatsApp izni yok/);
  out=await m.sendLegacyWhatsApp({mode:'template',to:B,templateName:'crewin_fixture',langCode:'tr'},sender,file);
  assert.equal(out.status,409);assert.match(out.body.error,/çıktı/);
  out=await m.sendLegacyWhatsApp({mode:'single',to:'0555 000 00 11',text:'Merhaba'},sender,file);
  assert.equal(out.status,400);
  out=await m.sendLegacyWhatsApp({mode:'broadcast',numbers:[B,C],text:'Merhaba'},sender,file);
  assert.equal(out.status,409);assert.deepEqual(plain(out.body.skipped),{invalid:0,no_consent:1,opted_out:1});
  assert.equal(calls.length,0,'nothing reached the sender so far');
  out=await m.sendLegacyWhatsApp({mode:'single',to:'+90 555 000 00 11',text:'Merhaba'},sender,file);
  assert.equal(out.status,200);assert.equal(out.body.success,true);assert.match(out.body.notice,/24 saat/);
  out=await m.sendLegacyWhatsApp({mode:'template',to:A,templateName:'crewin_fixture',langCode:'tr',components:[{type:'body'}]},sender,file);
  assert.equal(out.status,200);assert.equal(out.body.notice,undefined,'templates need no free-text notice');
  out=await m.sendLegacyWhatsApp({mode:'broadcast',numbers:[A,B,C,A,'bad'],text:'Merhaba'},sender,file);
  assert.equal(out.status,200);assert.equal(out.body.sent,1);assert.equal(out.body.results,undefined,'per-number results stay on the server');
  assert.deepEqual(plain(out.body.skipped),{invalid:1,no_consent:1,opted_out:1});
  assert.deepEqual(calls.map(call=>[call.kind,call.to]),[['text',A],['template',A],['text',A]],'only the consented number, normalised, once per send');
  assert.equal((await m.sendLegacyWhatsApp({mode:'broadcast',numbers:[A],text:''},sender,file)).status,400);
  assert.equal((await m.sendLegacyWhatsApp({mode:'broadcast',numbers:Array(501).fill(A),text:'x'},sender,file)).status,400);
  assert.equal((await m.sendLegacyWhatsApp({mode:'other'},sender,file)).status,400);
  const keep=process.env.AUTH_SECRET;delete process.env.AUTH_SECRET;
  try{assert.equal((await m.sendLegacyWhatsApp({mode:'single',to:A,text:'x'},sender,file)).status,503,'no signing secret, no send');}finally{process.env.AUTH_SECRET=keep;}
  assert.equal(calls.length,3);
});

test('an opt-out wins until a consent obtained after the opt-out day is recorded',async()=>{
  const file=fresh();
  await consent(file,[A],day(-10));
  assert.deepEqual(await optOut(file,[A]),{optedOut:1,already:0});
  const first=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.deepEqual(await optOut(file,[A],'reply'),{optedOut:0,already:1});
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),first,'the first opt-out time and source are kept');
  assert.deepEqual(states(file,[A]),['opted_out:team']);
  for(const date of [day(-11),today])await assert.rejects(consent(file,[A],date),err=>err.status===409&&/çıkıştan sonraki/.test(err.message),date);
  const [key]=Object.keys(first);first[key].optedOutAt=new Date(Date.now()-3*86400000).toISOString();fs.writeFileSync(file,JSON.stringify(first));
  assert.deepEqual(await consent(file,[A],day(-1),'Yeni form F-2 (fixture)'),{added:0,renewed:1,existing:0});
  assert.deepEqual(plain(m.legacyWhatsAppGate([A],file).allowed),[A]);
  const summary=plain(m.legacyWhatsAppSummary(file));
  assert.equal(summary.consented,1);assert.equal(summary.optedOut,0);assert.equal(summary.recent[0].evidence,'Yeni form F-2 (fixture)');
  await assert.rejects(optOut(file,['053']),/ülke koduyla/,'the panel refuses a bad number');
});

test('Meta refusing a message with 131050 records the number as opted out',async()=>{
  const file=fresh();
  await consent(file,[A,B,C]);
  const {sender}=fakeSender({[B]:131050,[C]:131047});
  const out=await m.sendLegacyWhatsApp({mode:'broadcast',numbers:[A,B,C],text:'Merhaba'},sender,file);
  assert.equal(out.body.sent,1);assert.equal(out.body.failed,2);assert.equal(out.body.optedOutByMeta,1);
  assert.deepEqual(states(file,[A,B,C]),['consented','opted_out:meta','consented'],'131047 (24-hour window) is not an opt-out');
  const single=await m.sendLegacyWhatsApp({mode:'single',to:A,text:'x'},fakeSender({[A]:131050}).sender,file);
  assert.equal(single.body.optedOutByMeta,1);assert.deepEqual(states(file,[A]),['opted_out:meta']);
});

test('the webhook stays closed until it is set up and accepts only Meta-signed events',async()=>{
  const file=fresh(),body=event([]);
  const query=(mode,token,challenge='1158201444')=>new URLSearchParams({'hub.mode':mode,'hub.verify_token':token,'hub.challenge':challenge});
  clearHook();
  assert.equal(m.verifyLegacyWhatsAppHook(query('subscribe',VERIFY)),null);
  await assert.rejects(receive(body,sign(body),file),err=>err.status===503);
  assert.equal(m.legacyWhatsAppSummary(file).hook,false);
  setHook();
  try{
    assert.equal(m.legacyWhatsAppSummary(file).hook,true);
    assert.equal(m.verifyLegacyWhatsAppHook(query('subscribe',VERIFY)),'1158201444');
    for(const bad of [query('subscribe','wrong_token_0123456789'),query('unsubscribe',VERIFY),query('subscribe',VERIFY,'<script>')])assert.equal(m.verifyLegacyWhatsAppHook(bad),null);
    for(const signature of [null,'sha256=00',sign(Buffer.from('other'))])await assert.rejects(receive(body,signature,file),err=>err.status===401);
    const broken=Buffer.from('{not json');
    await assert.rejects(receive(broken,sign(broken),file),err=>err.status===400);
    assert.deepEqual(await receive(body,sign(body),file),{optOuts:0});
    assert.equal(fs.existsSync(file),false,'an empty event writes nothing');
  }finally{clearHook();}
});

test('STOP replies, the stop-marketing choice and 131050 statuses opt numbers out; nothing else is kept',async()=>{
  const file=fresh();
  await consent(file,[A,B,C,D,E,G,H]);
  const body=event([
    {field:'messages',value:{messaging_product:'whatsapp',metadata:meta(),contacts:[{wa_id:wa(D),profile:{name:'Fixture Kişi'}}],messages:[
      {from:wa(A),id:'wamid.1',type:'text',text:{body:'STOP'}},
      {from:wa(B),id:'wamid.2',type:'button',button:{text:'Stop promotions',payload:'stop'}},
      {from:wa(C),id:'wamid.3',type:'text',text:{body:' İPTAL. '}},
      {from:wa(D),id:'wamid.4',type:'text',text:{body:'Merhaba, ilan var mı?'}},
    ],statuses:[
      {id:'wamid.5',status:'failed',recipient_id:wa(G),errors:[{code:131050,title:'fixture'}]},
      {id:'wamid.6',status:'failed',recipient_id:wa(H),errors:[{code:131047,title:'fixture'}]},
      {id:'wamid.7',status:'delivered',recipient_id:wa(A)},
    ]}},
    {field:'messages',value:{messaging_product:'whatsapp',metadata:meta('5555555555'),messages:[{from:wa(E),id:'wamid.8',type:'text',text:{body:'STOP'}}]}},
    {field:'user_preferences',value:{messaging_product:'whatsapp',metadata:meta(),user_preferences:[{wa_id:wa(F),detail:'User requested to stop marketing messages',category:'marketing_messages',value:'stop',timestamp:1793318400}]}},
  ]);
  setHook();
  try{
    assert.deepEqual(await receive(body,sign(body),file),{optOuts:5});
    assert.deepEqual(await receive(body,sign(body),file),{optOuts:0},'a repeated event changes nothing');
  }finally{clearHook();}
  assert.deepEqual(states(file,[A,B,C,D,E,F,G,H]),['opted_out:reply','opted_out:reply','opted_out:reply','consented','consented','opted_out:reply','opted_out:meta','consented']);
  const raw=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(raw,/Merhaba|ilan|Fixture Kişi|wamid|90555000/,'no message text, sender or message id is stored');
  await assert.rejects(consent(file,[F]),err=>err.status===409,'an opt-out from someone without a consent still blocks a same-day consent');
});

test('the agent sender reports per-number results for the gate (no network without WhatsApp settings)',async()=>{
  const send=require('../../crewinjob-agent/modules/messaging-send.js');
  const out=await send.broadcastWhatsApp([A,B],'x');
  assert.equal(out.sent,0);assert.deepEqual(out.results,[{to:A,success:false},{to:B,success:false}]);
});

test('the setup guide shows the STOP webhook address and its two settings',()=>{
  const {serverSetup}=load('server-setup.ts'),noDb={prepare(){throw new Error('no database in this test');}};
  const card=origin=>serverSetup(noDb,origin,{}).sections.find(section=>section.id==='crewin-whatsapp');
  const live=card('https://panel.example.com'),local=card('http://localhost:3033');
  assert.ok(live.steps.some(step=>step.copy?.value==='https://panel.example.com/api/messaging/whatsapp/hook'));
  assert.ok(local.steps.some(step=>step.copy?.value==='https://<alan-adınız>/api/messaging/whatsapp/hook'),'Meta cannot call this machine');
  assert.match(live.env,/WHATSAPP_APP_SECRET=<[^>]+>\nWHATSAPP_WEBHOOK_VERIFY_TOKEN=/);
  assert.match(live.verify.text.tr,/izni/);
});

test('every legacy WhatsApp path goes through the gate; only the exact webhook path skips the session',()=>{
  const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const route=read('app/api/messaging/whatsapp/send/route.ts');
  assert.match(route,/sendLegacyWhatsApp\(/);assert.doesNotMatch(route,/\.(sendWhatsAppMessage|broadcastWhatsApp|sendWhatsAppTemplate)\(/,'the route never calls the sender directly');
  const executor=read('lib/campaign-executor.ts');
  assert.match(executor,/callApi\('\/api\/messaging\/whatsapp\/send'/);assert.match(executor,/data\.skipped/);assert.match(executor,/sentCount: Number\(data\.sent/);
  const middleware=read('middleware.ts');
  assert.match(middleware,/pathname === '\/api\/messaging\/whatsapp\/hook'\) return NextResponse\.next\(\)/);
  assert.doesNotMatch(middleware,/'\/api\/messaging(?:\/whatsapp)?'/,'no wider public prefix');
  assert.match(read('app/api/messaging/whatsapp/hook/route.ts'),/receiveLegacyWhatsAppHook\([\s\S]*verifyLegacyWhatsAppHook|verifyLegacyWhatsAppHook\([\s\S]*receiveLegacyWhatsAppHook/);
  assert.match(read('app/api/messaging/whatsapp/consents/route.ts'),/getSessionFromRequest\(request\)/);
});

test.after(()=>{fs.rmSync(dir,{recursive:true,force:true});for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
