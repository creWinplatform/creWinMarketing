const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
// Server setup guide: what each server-side connection opens, what is wrong, and the values to register for this panel's
// address. Setting values never leave the server.
const {openPlatformDatabase}=load('database.ts');
const {serverSetup,META_INBOX_PERMISSIONS}=load('server-setup.ts');
const LOCAL='http://localhost:3033',LIVE='https://panel.example.com';
const plain=value=>JSON.parse(JSON.stringify(value)),section=(guide,id)=>guide.sections.find(item=>item.id===id);
const SECRETS={PLATFORM_GOOGLE_CLIENT_ID:'qa-google-client.apps.googleusercontent.com',PLATFORM_GOOGLE_CLIENT_SECRET:'qa-google-secret-never-shown',PLATFORM_META_APP_ID:'123456789',PLATFORM_META_APP_SECRET:'qa-meta-secret-never-shown',PLATFORM_GEMINI_API_KEY:'qa-gemini-key-never-shown',CRON_SECRET:'qa-cron-secret-never-shown-1234'};
const withDb=fn=>()=>{const db=openPlatformDatabase(':memory:');try{return fn(db);}finally{db.close();}};

test('nothing set: every card says what is missing and gives the values for this panel',withDb(db=>{
  const guide=serverSetup(db,LOCAL,{});
  assert.deepEqual(plain(guide.sections.filter(item=>item.group==='connections').map(item=>[item.id,item.state])),[['google','missing'],['meta','missing'],['gemini','missing'],['worker','missing']]);
  assert.equal(guide.local,true);
  const google=section(guide,'google'),meta=section(guide,'meta');
  assert.ok(google.steps.some(step=>step.copy?.value===`${LOCAL}/api/platform/google/callback`),'the exact Google callback to register');
  assert.match(google.env,/PLATFORM_GOOGLE_REDIRECT_URI=http:\/\/localhost:3033\/api\/platform\/google\/callback/);assert.match(google.env,/CLIENT_SECRET=</,'secrets are placeholders');
  assert.ok(meta.steps.some(step=>step.copy?.value===`${LOCAL}/api/platform/meta/callback`));
  const permissions=meta.steps.find(step=>step.copy?.label.en==='Permissions').copy.value;for(const name of META_INBOX_PERMISSIONS)assert.ok(permissions.includes(name),name);
  assert.match(section(guide,'worker').steps.map(step=>step.copy?.value||'').join(' '),/curl\.exe .*x-cron-secret: <CRON_SECRET>.*localhost:3033\/api\/platform\/worker/,'a one-off command for this machine');
  for(const item of guide.sections){assert.ok(item.unlocks.length&&item.steps.length&&item.verify.text.tr,item.id);if(!['later','decision','ready'].includes(item.state))assert.ok(item.problems.length,item.id);}
}));

test('wrong values are named precisely, and no setting value is ever returned',withDb(db=>{
  const env={...SECRETS,PLATFORM_GOOGLE_REDIRECT_URI:'http://panel.example.com/api/platform/google/callback',PLATFORM_META_REDIRECT_URI:`${LIVE}/api/platform/meta/cb`,PLATFORM_META_GRAPH_VERSION:'25',PLATFORM_GEMINI_MODEL:'gemini-1.5-pro'};
  const guide=serverSetup(db,LIVE,env),json=JSON.stringify(guide);
  for(const value of Object.values(SECRETS))assert.ok(!json.includes(value),'a setting value leaked into the guide');
  const google=section(guide,'google');assert.equal(google.state,'invalid');assert.ok(google.problems.some(item=>/https olmalı/.test(item.tr)));assert.ok(google.problems.some(item=>/eşleşmiyor/.test(item.tr)),'callback on another address');
  const meta=section(guide,'meta');assert.equal(meta.state,'invalid');assert.ok(meta.problems.some(item=>/\/api\/platform\/meta\/callback/.test(item.tr)));assert.ok(meta.problems.some(item=>/v25\.0/.test(item.tr)));
  assert.equal(section(guide,'gemini').state,'invalid','an older model cannot answer with Google Search');
  assert.match(section(guide,'worker').steps.map(step=>step.copy?.value||'').join(' '),/\*\/5 \* \* \* \* curl .*https:\/\/panel\.example\.com\/api\/platform\/worker/,'a crontab line on a live server');
  assert.equal(guide.local,false);
}));

test('valid settings are ready; the worker card follows its last successful run',withDb(db=>{
  const env={...SECRETS,PLATFORM_GOOGLE_REDIRECT_URI:`${LOCAL}/api/platform/google/callback`,PLATFORM_META_REDIRECT_URI:`${LOCAL}/api/platform/meta/callback`,PLATFORM_META_GRAPH_VERSION:'v25.0',PLATFORM_GEMINI_MODEL:'gemini-2.5-flash'};
  const now=Date.parse('2026-10-29T12:00:00Z'),run=at=>db.prepare("INSERT INTO platform_worker_observations(component,run_id,first_observed_at,started_at,finished_at,outcome,last_success_at) VALUES('platform-worker','r',?,?,?,'completed',?) ON CONFLICT(component) DO UPDATE SET last_success_at=excluded.last_success_at").run(at,at,at,at);
  let guide=serverSetup(db,LOCAL,env,now);
  assert.deepEqual(plain(guide.sections.filter(item=>item.group==='connections').map(item=>item.state)),['ready','ready','ready','missing']);for(const id of ['google','meta','gemini'])assert.deepEqual(plain(section(guide,id).problems),[]);
  run(new Date(now-5*60_000).toISOString());guide=serverSetup(db,LOCAL,env,now);assert.equal(section(guide,'worker').state,'ready');assert.equal(section(guide,'worker').env,null,'CRON_SECRET is set: no line to add');
  run(new Date(now-3*3600_000).toISOString());guide=serverSetup(db,LOCAL,env,now);assert.equal(section(guide,'worker').state,'stale');assert.match(section(guide,'worker').problems[0].tr,/180 dakika önce/);
}));

test('“Check” for Google and Meta reads the provider’s verdict without consent, and never echoes a secret',async()=>{
  const {probeGoogle,probeMeta}=load('server-setup.ts');
  const reply=(status,body)=>({status,json:async()=>body}),seen=[];
  const google=(status,body)=>async(url,init)=>{seen.push({url,body:String(init.body||'')});return reply(status,body);};
  const env={...SECRETS,PLATFORM_GOOGLE_REDIRECT_URI:`${LOCAL}/api/platform/google/callback`,PLATFORM_META_GRAPH_VERSION:'v25.0'};
  let result=await probeGoogle(env,google(400,{error:'invalid_grant'}));assert.equal(result.ok,true,'invalid_grant = the client was accepted');
  assert.equal(seen[0].url,'https://oauth2.googleapis.com/token');assert.match(seen[0].body,/code=ryzevo-setup-check/,'a code that cannot be valid: no token is ever issued');
  assert.equal((await probeGoogle(env,google(401,{error:'invalid_client'}))).ok,false);assert.match((await probeGoogle(env,google(401,{error:'invalid_client'}))).detail.tr,/tanımadı/);
  assert.match((await probeGoogle(env,google(400,{error:'redirect_uri_mismatch'}))).detail.tr,/Authorized redirect URIs/);
  assert.equal((await probeGoogle({},google(400,{error:'invalid_grant'}))).ok,false,'nothing is sent without settings');
  assert.equal((await probeGoogle(env,async()=>{throw new Error('offline');})).ok,false);
  const meta=(...replies)=>{let i=0;return async url=>{seen.push({url});return replies[i++];};};
  result=await probeMeta(env,meta(reply(200,{access_token:'app|token'}),reply(200,{name:'Ryzevo QA'})));
  assert.equal(result.ok,true);assert.match(result.detail.tr,/Ryzevo QA/);
  assert.equal((await probeMeta(env,meta(reply(400,{error:{code:1,message:'Error validating client secret.'}})))).ok,false);
  assert.equal((await probeMeta({...env,PLATFORM_META_APP_ID:'not-digits'},meta())).ok,false,'a malformed App ID is named before any request');
  for(const value of Object.values(SECRETS))assert.ok(!JSON.stringify(result).includes(value),'a secret leaked into a check result');
});

test('security, Crewin and go-live cards: weak or missing values are named, live-only ones wait on this machine',withDb(db=>{
  const extra={keyFile:{exists:true,path:'data/platform-credentials.key'},agentEnv:{TG_API_ID:'1',TG_API_HASH:'h'},files:[{label:'.claude/settings.local.json',text:'{"allow":["Bash(curl -u admin:crewin-backend-pass-123 …)"]}'}]};
  const env={ADMIN_PASSWORD:'short-pass',AUTH_SECRET:'x'.repeat(20),CREWINJOB_API_PASSWORD:'crewin-backend-pass-123',SMTP_HOST:'smtp.test',GA4_PROPERTY_ID:'abc',PLATFORM_WEB_PUSH_ENABLED:'1',PLATFORM_WEB_PUSH_PUBLIC_KEY:'bad',PLATFORM_WEB_PUSH_PRIVATE_KEY:'bad',PLATFORM_WEB_PUSH_SUBJECT:'me'};
  const guide=serverSetup(db,LOCAL,env,Date.now(),extra),card=id=>section(guide,id),json=JSON.stringify(guide);
  assert.equal(card('admin-password').state,'invalid');assert.match(card('admin-password').problems[0].tr,/16 karakterden kısa/);assert.ok(!json.includes('short-pass'),'the password itself never appears');
  assert.equal(card('auth-secret').state,'invalid');assert.equal(card('encryption-key').state,'invalid');assert.match(card('encryption-key').steps[0].text.tr,/YENİ bir anahtar üretmeyin/);
  const leak=card('plaintext-secrets');assert.equal(leak.state,'invalid');assert.match(leak.problems[0].tr,/CREWINJOB_API_PASSWORD/);assert.ok(!json.includes('crewin-backend-pass-123'),'a found secret is named, never shown');
  assert.equal(card('crewin-email').state,'missing');assert.match(card('crewin-email').problems[0].tr,/SMTP_USER/);
  assert.equal(card('crewin-telegram').state,'missing');assert.match(card('crewin-telegram').problems[0].tr,/TG_SESSION/);
  assert.equal(card('crewin-analytics').state,'missing','missing settings come first; the wrong format is still named');assert.ok(card('crewin-analytics').problems.some(item=>/yalnız rakamlardan/.test(item.tr)));
  assert.equal(card('push').state,'invalid');assert.ok(card('push').steps.some(step=>step.generate?.kind==='vapid'),'the key pair is generated in the browser');
  for(const id of ['public-address','ses-feedback','account-email'])assert.equal(card(id).state,'later',`${id} waits for the live server on this machine`);
  assert.equal(card('switches').state,'decision');assert.ok(card('switches').steps.every(step=>/=1$/.test(step.copy.value)));
  const live=serverSetup(db,LIVE,env,Date.now(),extra);assert.equal(section(live,'public-address').state,'missing');assert.ok(section(live,'ses-feedback').steps.some(step=>step.copy?.value===`${LIVE}/api/track/bounce`));
  // An old password that is no longer in .env.local: a curl login with -u and a JSON body, as a settings file stores them.
  const pasted=JSON.stringify({allow:['Bash(curl -u admin:old-crewin-pass https://example.test)','Bash(curl -d {"password":"old-crewin-pass"} https://example.test)','Bash(mkdir -p data)']});
  const old=serverSetup(db,LOCAL,{},Date.now(),{files:[{label:'x.json',text:pasted}]});
  assert.equal(section(old,'plaintext-secrets').state,'invalid','an old password that is no longer in .env.local is still found');assert.match(section(old,'plaintext-secrets').problems[0].tr,/şifreye benzeyen 2 ifade/);assert.ok(!JSON.stringify(old).includes('old-crewin-pass'));
  const good=serverSetup(db,LOCAL,{ADMIN_PASSWORD:'x'.repeat(24),AUTH_SECRET:'a'.repeat(64),PLATFORM_ENCRYPTION_KEY:'b'.repeat(64)},Date.now(),{files:[]});
  assert.deepEqual(plain(['admin-password','auth-secret','encryption-key','plaintext-secrets'].map(id=>section(good,id).state)),['ready','ready','ready','ready']);
}));

test('the go-live checklist keeps who ticked an item and when, and only known items',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {goLiveChecklist,setChecklistItem,CHECKLIST}=load('go-live-checklist.ts');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'go-live-')),file=path.join(dir,'go-live-checklist.json');
  try{
    assert.ok(goLiveChecklist(file).items.every(item=>item.done===null));assert.ok(CHECKLIST.some(item=>item.id==='iys'));
    const at=new Date('2026-10-29T12:00:00Z'),list=setChecklistItem(file,'backups',true,'legacy-admin',at);
    assert.deepEqual(plain(list.items.find(item=>item.id==='backups').done),{by:'legacy-admin',at:at.toISOString()});
    assert.equal(setChecklistItem(file,'backups',false,'legacy-admin').items.find(item=>item.id==='backups').done,null);
    assert.throws(()=>setChecklistItem(file,'made-up',true,'x'),error=>error.status===400);assert.throws(()=>setChecklistItem(file,'backups','yes','x'),error=>error.status===400);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

