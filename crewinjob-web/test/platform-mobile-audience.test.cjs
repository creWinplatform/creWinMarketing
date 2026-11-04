const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
// Push and in-app beyond the five-contact pilot: every consented contact, or a segment's people. Rehearsal works with any
// audience; a live send needs the separate broadcast switch, and pushes per day follow PLATFORM_MOBILE_PUSH_PER_DAY.
const {MobileGrowth}=load('mobile-store.ts'),{MobileDelivery,MOBILE_AUDIENCE_MAX}=load('mobile-delivery.ts'),{registerMobileContact}=load('mobile-ingestion.ts');
const at=()=>new Date(Date.now()-60000).toISOString();
function mobile(){const f=fixture(),service=new MobileGrowth(f.db,f.scope,f.KEY),app=service.saveApp({name:'Dövme QA',platform:'both',appleId:'123456789',bundleId:'com.example.tattoo',packageName:'com.example.tattoo',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'tattoo',attributionProvider:'bridge',revenueProvider:'bridge',identityConfirmed:true});service.setSource(app.id,true);return {...f,service,app,delivery:new MobileDelivery(service)};}
function connection(f,provider='onesignal'){f.service.saveIntegration({appId:f.app.id,provider,config:{appId:'aaaaaaaa-bbbb-4ccc-addd-eeeeeeeeeeee',externalAppId:'provider-app'},credentials:provider==='onesignal'?{apiKey:'qa-private-api-key'}:{webhookSecret:'test-secret-only-'.repeat(3)}});return f.service.integrations(f.app.id).find(item=>item.provider===provider);}
const contact=(f,entityId,consent={push:true,inApp:true},provider='onesignal')=>registerMobileContact(f.service,f.app,{entityId,provider,destination:'private-device-token-'+entityId,recordedAt:at(),evidenceRef:'qa/explicit-opt-in',consent}).id;
const input=(f,conn,patch={})=>({appId:f.app.id,connectionId:conn.id,campaignId:f.campaign.id,channel:'push',mode:'rehearsal',path:'/welcome',audience:'all',expiresAt:new Date(Date.now()+86400000).toISOString(),...patch});
const withEnv=async(values,work)=>{const saved=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));Object.assign(process.env,values);try{await work();}finally{for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}};
const run=fn=>async()=>{const f=mobile();try{await fn(f);}finally{f.db.close();}};

test('all consented contacts: no pilot allowlist needed, consent and provider still are, one device per person',run(async f=>{
  const conn=connection(f);for(const id of ['u1','u2','u3','u4','u5','u6','u7'])contact(f,id);contact(f,'u8',{push:false,inApp:true});contact(f,'f1',{push:true,inApp:false},'firebase');
  const raw=input(f,conn),preview=f.delivery.preview(raw);
  assert.equal(preview.targetCount,7,'beyond five, without the allowlist; no push consent or another push provider is left out');assert.equal(preview.audience,'all');
  const job=f.delivery.enqueue({...raw,expectedDigest:preview.digest,idempotencyKey:'all-rehearsal'});
  assert.equal((await f.delivery.process(job.id,async()=>assert.fail('No sends in rehearsal'))).status,'rehearsed');
  assert.equal(f.delivery.preview(input(f,conn,{channel:'in_app',connectionId:connection(f,'bridge').id})).targetCount,8,'in-app uses its own consent');
  assert.equal(MOBILE_AUDIENCE_MAX,1000);
}));

test('a live send beyond the pilot needs the broadcast switch; pushes per day follow the setting',run(async f=>{
  const conn=connection(f);for(const id of ['u1','u2','u3'])contact(f,id);
  await withEnv({PLATFORM_MOBILE_SEND_ENABLED:'1'},async()=>{
    const raw=input(f,conn,{mode:'live'}),preview=f.delivery.preview(raw);assert.equal(preview.broadcastEnabled,false);
    assert.throws(()=>f.delivery.enqueue({...raw,expectedDigest:preview.digest,idempotencyKey:'blocked',acknowledged:true}),e=>e.status===409);
  });
  await withEnv({PLATFORM_MOBILE_SEND_ENABLED:'1',PLATFORM_MOBILE_BROADCAST_ENABLED:'1',PLATFORM_MOBILE_PUSH_PER_DAY:'2'},async()=>{
    const raw=input(f,conn,{mode:'live'}),preview=f.delivery.preview(raw),job=f.delivery.enqueue({...raw,expectedDigest:preview.digest,idempotencyKey:'live',acknowledged:true});
    let sends=0;const result=await f.delivery.process(job.id,async()=>{sends++;return {state:'accepted',providerId:`p${sends}`};});
    assert.equal(sends,2,'the third push waits for the daily limit');assert.equal(result.accepted,2);
  });
}));

test('a revoked consent after approval blocks only that recipient',run(async f=>{
  const conn=connection(f);for(const id of ['u1','u2'])contact(f,id);
  await withEnv({PLATFORM_MOBILE_SEND_ENABLED:'1',PLATFORM_MOBILE_BROADCAST_ENABLED:'1',PLATFORM_MOBILE_PUSH_PER_DAY:'50'},async()=>{
    const raw=input(f,conn,{mode:'live'}),preview=f.delivery.preview(raw),job=f.delivery.enqueue({...raw,expectedDigest:preview.digest,idempotencyKey:'revoke',acknowledged:true});
    registerMobileContact(f.service,f.app,{entityId:'u2',provider:'onesignal',destination:'private-device-token-u2',recordedAt:new Date().toISOString(),evidenceRef:'qa/opt-out',consent:{push:false,inApp:false}});
    const destinations=[];const result=await f.delivery.process(job.id,async value=>{destinations.push(value.destination);return {state:'accepted',providerId:'p'};});
    assert.deepEqual(destinations,['private-device-token-u1']);assert.equal(result.failed,1);
  });
}));

test('a segment audience and an explicit people list reach only their consented contacts',run(f=>{
  const conn=connection(f);for(const id of ['u1','u2','u3'])contact(f,id);
  assert.equal(f.delivery.preview(input(f,conn,{audience:'entities',entityIds:['u2','u3','nobody']})).targetCount,2);
  assert.throws(()=>f.delivery.preview(input(f,conn,{audience:'entities',entityIds:['nobody']})),e=>e.status===409);
  assert.throws(()=>f.delivery.preview(input(f,conn,{audience:'segment'})),e=>e.status===400,'a segment needs its id and version');
}));

test('a push automation sends the campaign draft to ready people with push consent, through the mobile flow',run(async f=>{
  const {ProjectAutomations}=load('automations.ts'),automations=new ProjectAutomations(f.db,f.scope,f.KEY),conn=connection(f);
  for(const id of ['private-0','private-1','private-2'])contact(f,id);contact(f,'private-3',{push:false,inApp:true});
  const rule={name:'Profilini tamamla',trigger:{kind:'segment',segmentId:f.segment.id,segmentVersion:1},waitDays:0,exitEvent:null,exitOnLeave:false,campaignId:f.campaign.id,capDays:7,channel:'push',appId:f.app.id,connectionId:conn.id};
  assert.throws(()=>automations.save({...rule,connectionId:connection(f,'bridge').id}),e=>e.status===409,'push needs a push connection');
  const saved=automations.save(rule).automations.at(-1);assert.equal(saved.channel,'push');assert.deepEqual(plainOf(saved.mobile),{appId:f.app.id,connectionId:conn.id});
  const active=automations.setState({id:saved.id,state:'active',expectedRevision:saved.revision}).automations.find(item=>item.id===saved.id);
  automations.evaluate({id:active.id});
  const rehearsal=automations.approve({id:active.id,mode:'rehearsal'});
  assert.equal(rehearsal.counts.rehearsed,3,'people with push consent');assert.equal(f.db.prepare("SELECT channel,mode FROM platform_mobile_messages").get().mode,'rehearsal');
  await withEnv({PLATFORM_MOBILE_SEND_ENABLED:'1',PLATFORM_MOBILE_BROADCAST_ENABLED:'1'},async()=>{
    const sent=automations.approve({id:active.id,mode:'send',sendAcknowledged:true});
    assert.equal(sent.counts.sent,3);assert.ok(sent.counts.notSendable>=1,'the others leave: no push registration or consent');
    const states=Object.fromEntries(f.db.prepare('SELECT entity_id,state FROM platform_automation_enrollments WHERE automation_id=?').all(active.id).map(row=>[row.entity_id,row.state]));
    assert.equal(states['private-0'],'sent');assert.equal(states['private-3'],'exited');
  });
  assert.equal(automations.read().mobile.apps[0].id,f.app.id);
}));
const plainOf=value=>JSON.parse(JSON.stringify(value));
