const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {load}=require('./platform-loader.cjs');
// Crewin İYS phase 2: the email gate (measure and enforce), the nationality and merchant rules, the queue of unknown
// recipients and the worker's checks. A fake İYS transport and temporary files only: no network, no email.
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts');
const {ProjectIys,pullIysChanges}=load('iys.ts');
const e=load('../crewin-iys-email.ts');
const KEY='9a'.repeat(32),PASSWORD='crewin-iys-email-fixture-password',CREWIN={subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crewin-iys-email-'));let n=0;
const paths=()=>{n++;return {mode:path.join(dir,`mode-${n}.json`),pending:path.join(dir,`pending-${n}.json`)};};
const plain=value=>JSON.parse(JSON.stringify(value));
const TR={email:'Ayse.Kaya@example.com',nationality:'TR'},UNKNOWN={email:'mehmet@example.com'},PH={email:'juan@example.com',nationality:'PH'},FIRM={email:'ops@shipco.example',business:true};
function fakeIys(){
 const state={requests:[],register:new Map(),changes:[]};
 const transport=async request=>{
  const url=new URL(request.url),body=request.body?JSON.parse(request.body):null;state.requests.push({path:url.pathname,body});
  if(url.pathname==='/oauth2/token')return body.password===PASSWORD?{status:200,body:{access_token:'fake-token',expires_in:7200}}:{status:401,body:{}};
  if(request.headers.Authorization!=='Bearer fake-token')return {status:401,body:{}};
  if(url.pathname==='/sps/123456/brands')return {status:200,body:[{brandCode:'654321'}]};
  if(url.pathname==='/sps/123456/brands/654321/consents/status'){const item=state.register.get(`${body.type}\n${body.recipient}`);return item?{status:200,body:item}:{status:404,body:{}};}
  if(url.pathname==='/sps/123456/brands/654321/consents/changes'){const after=url.searchParams.get('after');return {status:200,body:{after:after||'cursor-1',list:after?[]:state.changes}};}
  return {status:404,body:{}};
 };
 return {state,transport};
}
function setup(){
 const db=openPlatformDatabase(':memory:');new PlatformRepository(db).bootstrapLegacy('admin');
 const fake=fakeIys(),panel=new ProjectIys(db,CREWIN,KEY,fake.transport);
 return {db,fake,panel,connect:()=>panel.connect({username:'qa-api-user',password:PASSWORD,iysCode:'123456',brandCode:'654321',environment:'sandbox'})};
}
const onay=(fake,email)=>fake.state.register.set(`EPOSTA\n${email}`,{status:'ONAY',consentDate:'2026-10-01 10:00:00',source:'HS_WEB'});

test('İYS applies to recipients whose nationality is TR or unknown, never to company audiences',()=>{
 assert.equal(e.iysAppliesToEmail(TR),true);assert.equal(e.iysAppliesToEmail({...TR,nationality:' tr '}),true);
 assert.equal(e.iysAppliesToEmail(UNKNOWN),true);assert.equal(e.iysAppliesToEmail({email:'x@example.com',nationality:''}),true);
 assert.equal(e.iysAppliesToEmail(PH),false);assert.equal(e.iysAppliesToEmail(FIRM),false);assert.equal(e.iysAppliesToEmail({...TR,business:true}),false);
});

test('measure mode: everyone gets the email; the result says who İYS would stop and unknown recipients are queued encrypted',async()=>{
 const f=setup(),p=paths();try{
  assert.equal(e.crewinEmailMode(p.mode).mode,'measure','measure is the default');
  let gate=await e.crewinEmailGate(f.db,KEY,[TR,UNKNOWN,PH,FIRM],p);
  assert.equal(gate.block,null);assert.equal(gate.allowed.size,4);assert.deepEqual(plain(gate.counts),{total:2,reasons:{iys_scope_missing:2},queued:0});
  f.panel.declare({scope:'tr'});
  gate=await e.crewinEmailGate(f.db,KEY,[TR,UNKNOWN,PH,FIRM],p);
  assert.equal(gate.allowed.size,4);assert.deepEqual(plain(gate.counts),{total:2,reasons:{iys_not_connected:2},queued:2});
  const raw=fs.readFileSync(p.pending,'utf8');assert.doesNotMatch(raw,/ayse|mehmet|example\.com/i,'queued addresses are encrypted');
  assert.equal(e.crewinPendingCount(p.pending),2);
  assert.equal((await e.crewinEmailGate(f.db,KEY,[TR],p)).counts.queued,0,'an address is queued once');
  f.panel.declare({scope:'none'});assert.deepEqual(plain((await e.crewinEmailGate(f.db,KEY,[TR,UNKNOWN],p)).counts),{total:0,reasons:{},queued:0},'"no": no İYS check');
 }finally{f.db.close();}
});

test('enforce mode: nothing goes before a declaration; recipients without a fresh İYS consent are skipped',async()=>{
 const f=setup(),p=paths();try{
  assert.deepEqual(plain(await e.setCrewinEmailMode('enforce','legacy-admin',p.mode)).mode,'enforce');
  assert.match((await e.crewinEmailGate(f.db,KEY,[TR,PH],p)).block,/İYS beyanını yapın/);
  f.panel.declare({scope:'tr'});await f.connect();
  onay(f.fake,'ayse.kaya@example.com');await new ProjectIys(f.db,CREWIN,KEY,f.fake.transport).query([{channel:'EPOSTA',value:'ayse.kaya@example.com'}]);
  let gate=await e.crewinEmailGate(f.db,KEY,[TR,UNKNOWN,PH,FIRM],p);
  assert.deepEqual([...gate.allowed].sort(),['ayse.kaya@example.com','juan@example.com','ops@shipco.example']);
  assert.deepEqual(plain(gate.skipped),[{email:'mehmet@example.com',reason:'iys_no_consent'}]);
  f.fake.state.changes.push({recipient:'ayse.kaya@example.com',type:'EPOSTA',status:'RET',consentDate:'2026-10-30 10:00:00'});await pullIysChanges(f.db,KEY,f.fake.transport);
  gate=await e.crewinEmailGate(f.db,KEY,[TR],p);
  assert.deepEqual(plain(gate.skipped),[{email:'ayse.kaya@example.com',reason:'iys_rejected'}]);assert.equal(gate.counts.queued,0,'a rejection is not queued for a check');
  await assert.rejects(e.setCrewinEmailMode('maybe','legacy-admin',p.mode));
 }finally{f.db.close();}
});

test('the worker asks İYS about up to 50 queued addresses once Crewin is connected, then drops them from the queue',async()=>{
 const f=setup(),p=paths();try{
  f.panel.declare({scope:'tr'});
  const many=Array.from({length:60},(_,i)=>({email:`seafarer${i}@example.com`}));
  assert.equal((await e.crewinEmailGate(f.db,KEY,many,p)).counts.queued,60);
  assert.deepEqual(plain(await e.crewinIysEmailBackfill(f.db,KEY,f.fake.transport,p.pending)),{checked:0},'not connected: nothing is asked');
  await f.connect();onay(f.fake,'seafarer0@example.com');
  assert.deepEqual(plain(await e.crewinIysEmailBackfill(f.db,KEY,f.fake.transport,p.pending)),{checked:50});
  assert.equal(e.crewinPendingCount(p.pending),10);assert.equal(f.fake.state.requests.filter(item=>item.path.endsWith('/consents/status')).length,50);
  await e.setCrewinEmailMode('enforce','legacy-admin',p.mode);
  const gate=await e.crewinEmailGate(f.db,KEY,[{email:'seafarer0@example.com'},{email:'seafarer1@example.com'}],p);
  assert.deepEqual([...gate.allowed],['seafarer0@example.com'],'the consent İYS reported now lets the email go');
  assert.deepEqual(plain(await e.crewinIysEmailBackfill(f.db,KEY,f.fake.transport,p.pending)),{checked:11},'the 10 left and seafarer1, queued again by the send after İYS had no record');assert.equal(e.crewinPendingCount(p.pending),0);
 }finally{f.db.close();}
});

test('every legacy email path goes through the gate; company campaigns use the merchant exemption',()=>{
 const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 for(const file of ['app/api/messaging/email/send/route.ts','app/api/messaging/email/send-job-match/route.ts'])assert.match(read(file),/crewinEmailGate\(platformDatabase\(\), credentialEncryptionKey\(\)/,file);
 assert.match(read('lib/campaign-executor.ts'),/business: BUSINESS_AUDIENCES\.includes/);
 assert.match(read('app/api/platform/worker/route.ts'),/crewinIysEmailBackfill\(db,credentialEncryptionKey\(\)\)/);
 assert.match(read('app/api/platform/iys/route.ts'),/crewin_email_mode[\s\S]*'connections\.manage'/);
});

test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
