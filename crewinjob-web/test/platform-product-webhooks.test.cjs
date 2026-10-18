const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHmac,randomBytes}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts');
const {PlatformRepository}=load('repository.ts');
const {ProductWebhooks,authenticateProductWebhook,pruneProductEvents}=load('product-webhooks.ts');
const {ProductDataSources}=load('product-data.ts');
const {ConnectionJobs}=load('connection-jobs.ts');
const {WEBHOOK_LIMITS}=load('product-webhook-types.ts');
const KEY='12'.repeat(32),SECRET=randomBytes(32).toString('hex');
const config=(key='progress')=>({entityType:'user',attributes:[{key,type:'number'}],eventNames:['profile.updated']});
const event=(id='event-1',progress=25,occurredAt=new Date(Date.now()-1000).toISOString())=>({id,entityId:'person-1',eventName:'profile.updated',occurredAt,attributes:{progress}});
const payload=(events=[event()],sourceVersion=1)=>({sourceVersion,events});
function fixture(){
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
 const provision=name=>repo.provision('legacy-admin',{organizationName:name,projectName:name,website:'https://example.com',username:name,password:'fixture-password-123'});
 const a=provision('education'),b=provision('marketplace'),scope=v=>({subject:v.userId,organizationId:v.organizationId,projectId:v.projectId});
 return {db,repo,a,b,scope,hooks:new ProductWebhooks(db,scope(a)),other:new ProductWebhooks(db,scope(b))};
}
const save=(hooks,patch={})=>hooks.save({name:'Product events',config:config(),secret:SECRET,...patch},KEY);
function enable(hooks,source,body=payload()){hooks.preview(source.id,body);return hooks.state(source.id,source.version,'activate');}
function delivery(db,source,body=payload(),patch={}){
 const bytes=Buffer.from(JSON.stringify(body)),timestamp=patch.timestamp||String(Math.floor(Date.now()/1000)),id=patch.id||source.id;
 const signature='v1='+createHmac('sha256',Buffer.from(patch.secret||SECRET,'hex')).update(`${timestamp}.${id}.`).update(bytes).digest('hex');
 return {bytes,headers:new Headers({'x-ryzevo-timestamp':timestamp,'x-ryzevo-signature':signature,...patch.headers}),receive:()=>authenticateProductWebhook(db,id,new Headers({'x-ryzevo-timestamp':timestamp,'x-ryzevo-signature':signature,...patch.headers}),KEY)(patch.bytes||bytes)};
}
test('webhooks reuse source/credentials and deny legacy, viewers and cross-project mutations',()=>{
 const {db,repo,a,scope,hooks,other}=fixture();try{
  const source=save(hooks);assert.equal(source.state,'draft');assert.equal(other.list().length,0);
  assert.throws(()=>other.events(source.id));assert.throws(()=>other.state(source.id,1,'activate'));
  assert.ok(!JSON.stringify(hooks.list()).includes(SECRET));assert.ok(!db.prepare('SELECT encrypted_credentials FROM platform_connections').get().encrypted_credentials.includes(SECRET));
  assert.equal(new ProductDataSources(db,scope(a)).list().length,0);
  assert.throws(()=>new ConnectionJobs(db,scope(a)).enqueue(source.id,'not-a-verification'));
  assert.throws(()=>new ProductWebhooks(db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).list());
  const viewer=repo.addMember(a.userId,a.organizationId,a.projectId,{username:'viewer',password:'fixture-password-123',role:'viewer'});
  assert.throws(()=>new ProductWebhooks(db,{...scope(a),subject:viewer.userId}).list());
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
});
test('dry-run has no side effects and invalid schema/date cannot activate',()=>{
 const {db,hooks}=fixture();try{
  const source=save(hooks);assert.throws(()=>hooks.state(source.id,1,'activate'));
  assert.throws(()=>hooks.preview(source.id,payload([event('bad','25')])));
  assert.throws(()=>hooks.preview(source.id,payload([event('bad',25,'2026-02-31T10:00:00Z')])));
  assert.throws(()=>hooks.preview(source.id,payload([event('old',25,new Date(Date.now()-31*86400000).toISOString())])));
  const now=new Date().toISOString();assert.throws(()=>hooks.preview(source.id,payload([event('same1',20,now),event('same2',30,now)])));
  assert.equal(hooks.preview(source.id,payload()).canActivate,true);assert.equal(hooks.list()[0].state,'ready');assert.equal(hooks.events(source.id).total,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_product_records').get().n,0);
  assert.throws(()=>hooks.preview(source.id,payload([event('bad','25')])));assert.throws(()=>hooks.state(source.id,1,'activate'));
 }finally{db.close();}
});
test('HMAC binds exact bytes, source, timestamp and key before any writes',()=>{
 const {db,hooks,other}=fixture();try{
  const source=save(hooks),second=save(other);enable(hooks,source);enable(other,second);
  assert.throws(()=>delivery(db,source,payload(),{secret:randomBytes(32).toString('hex')}).receive());
  assert.throws(()=>delivery(db,source,payload(),{bytes:Buffer.from('tampered')}).receive());
  assert.throws(()=>delivery(db,source,payload(),{timestamp:'1000000000'}).receive());
  assert.throws(()=>delivery(db,source,payload(),{timestamp:String(Math.floor(Date.now()/1000)+600)}).receive());
  const request=delivery(db,source);assert.throws(()=>authenticateProductWebhook(db,second.id,request.headers,KEY)(request.bytes));
  assert.throws(()=>authenticateProductWebhook(db,source.id,new Headers(),KEY)(request.bytes));
  assert.equal(hooks.events(source.id).total,0);
 }finally{db.close();}
});
test('two-sector events are isolated and identical retries do not grow records, events or usage',()=>{
 const {db,a,b,scope,hooks,other}=fixture();try{
  const source=save(hooks),second=save(other,{config:config('listings')});const body=payload(),market=payload([{...event(),attributes:{listings:0}}]);
  enable(hooks,source,body);enable(other,second,market);
  assert.equal(delivery(db,source,body).receive().accepted,1);
  assert.deepEqual(Object.values(delivery(db,source,body).receive()).slice(0,3),[0,1,0]);
  assert.equal(delivery(db,second,market).receive().accepted,1);
  assert.equal(hooks.events(source.id).items[0].attributes.progress,25);assert.equal(other.events(second.id).items[0].attributes.listings,0);
  assert.equal(db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND resource='product_events'").get(a.organizationId).count,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_product_records WHERE organization_id=?").get(b.organizationId).n,1);
  assert.ok(!JSON.stringify(hooks.events(source.id)).includes('person-1'));
 }finally{db.close();}
});
test('event conflicts and conflicting projections roll back the entire batch and quota',()=>{
 const {db,hooks}=fixture();try{
  const source=save(hooks),first=event();enable(hooks,source);delivery(db,source,payload([first])).receive();
  assert.throws(()=>delivery(db,source,payload([event('new'),{...first,attributes:{progress:99}}])).receive());
  assert.equal(hooks.events(source.id).total,1);
  const now=new Date().toISOString();assert.throws(()=>delivery(db,source,payload([event('same-time-1',20,now),event('same-time-2',30,now)])).receive());
  assert.equal(hooks.events(source.id).total,1);assert.equal(db.prepare("SELECT count FROM platform_usage WHERE resource='product_events'").get().count,1);
 }finally{db.close();}
});
test('late events are retained but cannot regress projection; consent remains a reported claim',()=>{
 const {db,hooks}=fixture();try{
  const source=save(hooks),newer=event('newer',90),older=event('older',10,new Date(Date.now()-86400000).toISOString());enable(hooks,source);
  newer.consent={channel:'email',status:'opted_out',evidenceRef:'consent-record-001',recordedAt:newer.occurredAt};
  delivery(db,source,payload([newer])).receive();assert.equal(delivery(db,source,payload([older])).receive().recordsUpdated,0);
  assert.equal(JSON.parse(db.prepare('SELECT attributes_json FROM platform_product_records').get().attributes_json).progress,90);
  assert.ok(hooks.events(source.id).items.some(item=>item.consentStatus==='reported_opted_out'));
  assert.ok(!JSON.stringify(hooks.events(source.id)).includes('consent-record-001'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_metric_entries').get().n,0);
 }finally{db.close();}
});
test('pause, revoke, schema rotation and live membership loss stop signed delivery',()=>{
 for(const mode of ['pause','revoke','schema','member']){
  const {db,a,hooks}=fixture();try{
   const source=save(hooks);enable(hooks,source);const request=delivery(db,source),receive=authenticateProductWebhook(db,source.id,request.headers,KEY);
   if(mode==='pause')hooks.state(source.id,1,'pause');if(mode==='revoke')hooks.state(source.id,1,'revoke');
   if(mode==='schema')save(hooks,{id:source.id,version:1,secret:''});if(mode==='member')db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(a.userId);
   assert.throws(()=>receive(request.bytes),mode);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_product_events').get().n,0,mode);
  }finally{db.close();}
 }
});
test('rate, batch, body and daily quotas are bounded; a duplicate at daily quota still acknowledges',()=>{
 const {db,hooks}=fixture();try{
  const source=save(hooks),body=payload();enable(hooks,source);delivery(db,source,body).receive();
  db.prepare("UPDATE platform_usage SET count=? WHERE resource='product_events'").run(WEBHOOK_LIMITS.eventsPerDay);
  assert.equal(delivery(db,source,body).receive().duplicates,1);assert.throws(()=>delivery(db,source,payload([event('new')])).receive());
  assert.throws(()=>delivery(db,source,payload(Array.from({length:21},(_,i)=>event('big-'+i)))).receive());
  const request=delivery(db,source);assert.throws(()=>authenticateProductWebhook(db,source.id,request.headers,KEY)(new Uint8Array(65537)));
  db.prepare('UPDATE platform_login_limits SET count=?').run(WEBHOOK_LIMITS.requestsPerMinute);assert.throws(()=>delivery(db,source,body).receive());
 }finally{db.close();}
});
test('retention prunes payload/projection after 30 days while receipt prevents replay for 90 days',()=>{
 const {db,hooks}=fixture();try{
  const source=save(hooks),body=payload();enable(hooks,source);delivery(db,source,body).receive();
  const old=new Date(Date.now()-31*86400000).toISOString();db.prepare('UPDATE platform_product_events SET received_at=?').run(old);db.prepare('UPDATE platform_product_records SET received_at=?').run(old);
  assert.equal(hooks.events(source.id).total,0);assert.equal(pruneProductEvents(db).events,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_product_records').get().n,0);
  assert.equal(delivery(db,source,body).receive().duplicates,1);
  db.prepare('UPDATE platform_product_event_receipts SET received_at=?').run(new Date(Date.now()-91*86400000).toISOString());assert.equal(pruneProductEvents(db).receipts,1);
 }finally{db.close();}
});
test('migration 12 keeps REST versions, encrypted credentials and queued sync jobs intact',async()=>{
 const fs=require('node:fs'),path=require('node:path');const file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'webhook-migration-')),'test.sqlite');
 let db=openPlatformDatabase(file);try{
  const repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');const a=repo.provision('legacy-admin',{organizationName:'Existing',projectName:'Existing',website:'https://example.com',username:'existing',password:'fixture-password-123'});
  const scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId},sources=new ProductDataSources(db,scope);
  const source=sources.save({name:'Existing REST',token:'old-secret',config:{url:'https://api.example.com/users',auth:'bearer',itemsPath:'items',idPath:'id',updatedAtPath:'updatedAt',entityType:'user',attributes:[{key:'progress',path:'progress',type:'number'}],nextCursorPath:'',cursorParam:''}},KEY);
  await sources.preview(source.id,KEY,async()=>({items:[{id:'u1',updatedAt:new Date().toISOString(),progress:25}],nextCursor:null}));sources.setEnabled(source.id,1,true);
  const job=new ConnectionJobs(db,scope).enqueue(source.id,'pending','product.sync'),envelope=db.prepare('SELECT encrypted_credentials FROM platform_connections').get().encrypted_credentials;
  require('./schema-fixture.cjs').removeMobileSchema(db);
  db.exec('DROP TABLE platform_segment_previews; DROP TABLE platform_segment_versions; DROP TABLE platform_segments; ALTER TABLE platform_product_sources DROP COLUMN event_coverage_from; DELETE FROM platform_migrations WHERE version=13; DROP TABLE platform_product_events; DROP TABLE platform_product_event_receipts; DROP INDEX platform_product_record_age; ALTER TABLE platform_product_sources DROP COLUMN webhook_actor_id; DELETE FROM platform_migrations WHERE version=12;');db.close();db=openPlatformDatabase(file);
  assert.equal(new ProductDataSources(db,scope).list()[0].state,'active');assert.equal(new ConnectionJobs(db,scope).list(job.id).status,'queued');assert.equal(db.prepare('SELECT encrypted_credentials FROM platform_connections').get().encrypted_credentials,envelope);
  const hooks=new ProductWebhooks(db,scope);assert.equal(save(hooks).state,'draft');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
});
