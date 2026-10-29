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
  assert.deepEqual(plain(guide.sections.map(item=>[item.id,item.state])),[['google','missing'],['meta','missing'],['gemini','missing'],['worker','missing']]);
  assert.equal(guide.local,true);
  const google=section(guide,'google'),meta=section(guide,'meta');
  assert.ok(google.steps.some(step=>step.copy?.value===`${LOCAL}/api/platform/google/callback`),'the exact Google callback to register');
  assert.match(google.env,/PLATFORM_GOOGLE_REDIRECT_URI=http:\/\/localhost:3033\/api\/platform\/google\/callback/);assert.match(google.env,/CLIENT_SECRET=</,'secrets are placeholders');
  assert.ok(meta.steps.some(step=>step.copy?.value===`${LOCAL}/api/platform/meta/callback`));
  const permissions=meta.steps.find(step=>step.copy?.label.en==='Permissions').copy.value;for(const name of META_INBOX_PERMISSIONS)assert.ok(permissions.includes(name),name);
  assert.match(section(guide,'worker').steps.map(step=>step.copy?.value||'').join(' '),/curl\.exe .*x-cron-secret: <CRON_SECRET>.*localhost:3033\/api\/platform\/worker/,'a one-off command for this machine');
  for(const item of guide.sections){assert.ok(item.unlocks.length&&item.steps.length&&item.verify.text.tr,item.id);assert.ok(item.problems.length,item.id);}
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
  assert.deepEqual(plain(guide.sections.map(item=>item.state)),['ready','ready','ready','missing']);for(const id of ['google','meta','gemini'])assert.deepEqual(plain(section(guide,id).problems),[]);
  run(new Date(now-5*60_000).toISOString());guide=serverSetup(db,LOCAL,env,now);assert.equal(section(guide,'worker').state,'ready');assert.equal(section(guide,'worker').env,null,'CRON_SECRET is set: no line to add');
  run(new Date(now-3*3600_000).toISOString());guide=serverSetup(db,LOCAL,env,now);assert.equal(section(guide,'worker').state,'stale');assert.match(section(guide,'worker').problems[0].tr,/180 dakika önce/);
}));
