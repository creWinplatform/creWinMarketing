const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{operatorReadiness,operatorFunnel,probeGemini}=load('operator.ts');
// Operator console: readiness shows presence (never values) and the funnel shows counts (never people).
const KEYS=['AUTH_SECRET','ADMIN_PASSWORD','PLATFORM_ENCRYPTION_KEY','CRON_SECRET','NEXT_PUBLIC_APP_URL','PLATFORM_PUBLIC_ORIGIN','PLATFORM_GEMINI_API_KEY','PLATFORM_GEMINI_MODEL','PLATFORM_SOCIAL_PUBLISH_ENABLED','PLATFORM_META_APP_ID','PLATFORM_META_APP_SECRET','PLATFORM_META_REDIRECT_URI','PLATFORM_META_GRAPH_VERSION','PLATFORM_META_WEBHOOK_VERIFY_TOKEN','PLATFORM_PUBLIC_SIGNUP_ENABLED','PLATFORM_DATABASE_PATH'];
const withEnv=async(values,fn)=>{const saved=Object.fromEntries(KEYS.map(k=>[k,process.env[k]]));for(const k of KEYS)delete process.env[k];Object.assign(process.env,values);try{return await fn();}finally{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}};
function setup(){
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('operator-fixture');
  const make=(name,daysAgo)=>{const w=repo.provision('legacy-admin',{organizationName:name,projectName:name,website:'https://example.com',username:`${name.toLowerCase()}-owner`,password:'operator-fixture-only-123'});
    db.prepare('UPDATE platform_organizations SET created_at=? WHERE id=?').run(new Date(Date.now()-daysAgo*86400000).toISOString(),w.organizationId);return w;};
  return {db,make};
}
const now=()=>new Date().toISOString();

test('readiness reports presence and switches but never the values',()=>withEnv({AUTH_SECRET:'s'.repeat(40),ADMIN_PASSWORD:'short-pass',CRON_SECRET:'c'.repeat(24),NEXT_PUBLIC_APP_URL:'http://localhost:3033',PLATFORM_GEMINI_API_KEY:'fixture-gemini-key-only',PLATFORM_GEMINI_MODEL:'gemini-fixture',PLATFORM_SOCIAL_PUBLISH_ENABLED:'1',PLATFORM_DATABASE_PATH:path.join(require('node:os').tmpdir(),'operator-none','x.sqlite')},()=>{
  const {db}=setup(),snapshot=operatorReadiness(db),state=id=>snapshot.items.find(item=>item.id===id).state;
  assert.equal(state('auth-secret'),'ready');assert.equal(state('admin-password'),'warning','a short administrator password is flagged');
  assert.equal(state('encryption-key'),'missing');assert.equal(state('app-url'),'missing','http is not enough for production links');
  assert.equal(state('social-publish'),'ready');assert.equal(state('whatsapp-send'),'off');assert.equal(state('meta'),'missing');
  assert.equal(state('gemini'),'ready');assert.equal(snapshot.items.find(item=>item.id==='gemini').probe,'gemini');
  const json=JSON.stringify(snapshot);for(const secret of ['s'.repeat(40),'short-pass','c'.repeat(24),'fixture-gemini-key-only'])assert.equal(json.includes(secret),false,'no setting value is returned');
  assert.ok(snapshot.items.every(item=>item.label.tr&&item.label.en&&item.detail.tr&&item.detail.en),'every item is bilingual');
}));

test('the encryption key kept only in a file is flagged so it gets backed up',()=>{
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'operator-key-'));fs.writeFileSync(path.join(dir,'platform-credentials.key'),'a'.repeat(64));
  return withEnv({PLATFORM_DATABASE_PATH:path.join(dir,'platform.sqlite')},()=>{const {db}=setup();assert.equal(operatorReadiness(db).items.find(item=>item.id==='encryption-key').state,'warning');fs.rmSync(dir,{recursive:true,force:true});});
});

test('connection health counts only standard projects',()=>withEnv({},()=>{
  const {db,make}=setup(),a=make('Alpha',5),b=make('Beta',5);
  const conn=(w,id,provider)=>db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,?,?,?,?,1,?)").run(id,w.organizationId,w.projectId,provider,`${provider}:${id}`,'QA','x',now());
  conn(a,'c1','ses');conn(b,'c2','ses');conn(a,'c3','telegram');
  db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES('legacy1','crewin','crewinjob','ses','ses:legacy','Crewin','x',1,?)").run(now());
  const rows=operatorReadiness(db).connections,ses=rows.find(row=>row.provider==='ses');
  assert.equal(ses.active,2,'the legacy Crewin project is not counted');assert.equal(ses.projects,2);assert.equal(rows.find(row=>row.provider==='telegram').active,1);
}));

test('the funnel counts each milestone and the projects stalled at it',()=>withEnv({},()=>{
  const {db,make}=setup(),fresh=make('Fresh',1),stuck=make('Stuck',10),far=make('Far',20),old=make('Old',400);
  const coach=(w,approved)=>db.prepare('INSERT INTO platform_growth_coach(organization_id,project_id,answers_json,updated_by,created_at,updated_at,approved_at) VALUES(?,?,?,?,?,?,?)').run(w.organizationId,w.projectId,'{}','u',now(),now(),approved?now():null);
  coach(stuck,false);coach(far,true);
  db.prepare('INSERT INTO platform_compass_preferences(user_id,organization_id,project_id,preferences_json,deferred,created_at,updated_at) VALUES(?,?,?,?,0,?,?)').run(far.userId,far.organizationId,far.projectId,'{}',now(),now());
  db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES('f1',?,?,'ses','ses:f1','QA','x',1,?)").run(far.organizationId,far.projectId,now());
  const f=operatorFunnel(db,90,3),step=id=>f.steps.find(s=>s.id===id);
  assert.equal(step('created').reached,3,'the project opened 400 days ago is outside the period');
  assert.equal(step('diagnosis').reached,2);assert.equal(step('brief').reached,1);assert.equal(step('path').reached,1);assert.equal(step('connection').reached,1);assert.equal(step('rehearsal').reached,0);
  assert.equal(step('created').stalled,0,'the 1-day-old project is not stalled yet');
  assert.equal(step('diagnosis').stalled,1,'started the diagnosis 10 days ago and never approved');
  assert.equal(step('connection').stalled,1,'connected but never rehearsed');
  assert.equal(f.trials.active+f.trials.ended+f.trials.pilot,4);
  assert.equal(operatorFunnel(db,365).steps[0].reached,3);
  void fresh;void old;
}));

test('the AI check asks for the model description with the key in a header, never in the address',async()=>withEnv({PLATFORM_GEMINI_API_KEY:'fixture-gemini-key-only',PLATFORM_GEMINI_MODEL:'gemini-fixture'},async()=>{
  let seen;const result=await probeGemini(async(url,init)=>{seen={url,init};return {status:200};});
  assert.equal(result.ok,true);assert.equal(seen.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture');
  assert.doesNotMatch(seen.url,/key=|fixture-gemini-key/);assert.equal(seen.init.headers['x-goog-api-key'],'fixture-gemini-key-only');assert.equal(seen.init.method,undefined,'a GET, nothing is generated');
  assert.equal((await probeGemini(async()=>({status:403}))).ok,false);
  assert.equal((await probeGemini(async()=>{throw new Error('down');})).ok,false);
}));

test('the operator route is open only to the deployment administrator',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','app','api','platform','operator','route.ts'),'utf8');
  assert.match(source,/access\.subject === 'legacy-admin'/);
  assert.match(source,/hasSameRequestOrigin\(request\)/);
  assert.equal((source.match(/await operator\('members\.manage'\)/g)||[]).length,2,'both GET and POST check it');
});
