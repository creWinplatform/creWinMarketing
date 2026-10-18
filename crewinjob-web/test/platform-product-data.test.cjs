const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts');
const {PlatformRepository}=load('repository.ts');
const {ProductDataSources}=load('product-data.ts');
const {ConnectionJobs}=load('connection-jobs.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const {normalizeProductSource,PRODUCT_SOURCE_LIMITS}=load('product-data-types.ts');
const {readProductPage}=load('product-rest.ts');
const KEY='12'.repeat(32);
const config=(patch={})=>({url:'https://api.example.com/users',auth:'bearer',itemsPath:'result.items',idPath:'id',updatedAtPath:'updatedAt',entityType:'user',attributes:[{key:'progress',path:'progress',type:'number'}],nextCursorPath:'',cursorParam:'',...patch});
const entity=(id='learner-1',progress=25,date='2026-01-01T10:00:00Z')=>({id,progress,updatedAt:date,password:'never-import-this',token:'also-never-import'});
const one=async()=>({items:[entity()],nextCursor:null});
function fixture(){
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('fixture-admin');
  const provision=name=>repo.provision('legacy-admin',{organizationName:name,projectName:name,website:'https://example.com',username:name,password:'fixture-password-123'});
  const a=provision('education'),b=provision('marketplace');
  const scope=value=>({subject:value.userId,organizationId:value.organizationId,projectId:value.projectId});
  return {db,repo,a,b,scope,sources:new ProductDataSources(db,scope(a)),other:new ProductDataSources(db,scope(b)),jobs:new ConnectionJobs(db,scope(a))};
}
const save=(sources,patch={})=>sources.save({name:'Product API',config:config(),token:'project-only-token',...patch},KEY);
async function enable(sources,source,loader=one){const preview=await sources.preview(source.id,KEY,loader);assert.equal(preview.canActivate,true);return sources.setEnabled(source.id,source.version,true);}
const run=(jobs,id,loader=one)=>jobs.run(id,KEY,undefined,undefined,undefined,undefined,loader);

test('product sources reuse encrypted connections and deny cross-project/legacy access',async()=>{
 const {db,repo,a,b,scope,sources,other}=fixture();try{
   const source=save(sources);assert.equal(source.state,'draft');assert.equal(source.version,1);
   assert.equal(other.list().length,0);assert.throws(()=>other.records(source.id));assert.throws(()=>other.save({...source,id:source.id,config:config(),token:'x'},KEY));
   await assert.rejects(()=>other.preview(source.id,KEY,one));
   assert.ok(!JSON.stringify(sources.list()).includes('project-only-token'));
   const encrypted=db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(source.id).encrypted_credentials;assert.ok(!encrypted.includes('project-only-token'));
   const viewer=repo.addMember(a.userId,a.organizationId,a.projectId,{username:'reader',password:'fixture-password-123',role:'viewer'});
   assert.throws(()=>new ProductDataSources(db,{...scope(a),subject:viewer.userId}).list());
   assert.throws(()=>new ProductDataSources(db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).list());
   assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
});
test('source dry-run never writes records, and schema errors cannot activate a source',async()=>{
 const {db,sources,jobs}=fixture();try{
   const source=save(sources);assert.throws(()=>sources.setEnabled(source.id,1,true));assert.throws(()=>jobs.enqueue(source.id,'not-active','product.sync'));
   const bad=await sources.preview(source.id,KEY,async()=>({items:[entity('x','25')],nextCursor:null}));assert.equal(bad.canActivate,false);assert.equal(bad.errors[0].field,'progress');
   assert.equal(sources.records(source.id).length,0);
   const preview=await sources.preview(source.id,KEY,one);assert.equal(preview.canActivate,true);assert.equal(preview.samples[0].consentStatus,'unknown');assert.equal(preview.samples[0].externalId,'...er-1');
   assert.ok(!JSON.stringify(preview).includes('never-import'));
   assert.equal(sources.records(source.id).length,0);assert.equal(sources.list()[0].state,'ready');
   db.prepare("UPDATE platform_product_sources SET preview_at='2000-01-01T00:00:00Z'").run();assert.throws(()=>sources.setEnabled(source.id,1,true));
 }finally{db.close();}
});
test('same source engine ingests two sectors with independent scopes and idempotent replay',async()=>{
 const {db,sources,other,jobs,scope,b}=fixture();try{
   const a=save(sources),market=save(other,{name:'Marketplace accounts',config:config({entityType:'company',attributes:[{key:'listings',path:'listingCount',type:'number'}]})});
   await enable(sources,a);const loader=async()=>({items:[{id:'seller-1',listingCount:0,updatedAt:'2026-01-01T10:00:00Z'}],nextCursor:null});await enable(other,market,loader);
   const job=jobs.enqueue(a.id,'same-key','product.sync');assert.equal(jobs.enqueue(a.id,'same-key','product.sync').id,job.id);assert.equal(jobs.enqueue(a.id,'other-key','product.sync').id,job.id);
   assert.equal((await run(jobs,job.id)).status,'completed');assert.equal(sources.list()[0].recordCount,1);assert.equal(sources.records(a.id)[0].attributes.progress,25);
   assert.equal((await run(jobs,job.id)).status,'completed');assert.equal(sources.list()[0].recordCount,1);
   const again=jobs.enqueue(a.id,'repeat','product.sync');await run(jobs,again.id);assert.equal(sources.list()[0].recordCount,1);
   const bj=new ConnectionJobs(db,scope(b)),bjob=bj.enqueue(market.id,'same-key','product.sync');await run(bj,bjob.id,loader);assert.equal(other.records(market.id)[0].attributes.listings,0);
   assert.throws(()=>jobs.list(bjob.id));assert.throws(()=>other.records(a.id));
 }finally{db.close();}
});
test('source changes invalidate preview/jobs and preserve versioned history without mixing records',async()=>{
 const {db,sources,jobs,other}=fixture();try{
   const source=save(sources);await enable(sources,source);await run(jobs,jobs.enqueue(source.id,'initial','product.sync').id);
   const pending=jobs.enqueue(source.id,'pending','product.sync');const changed=save(sources,{id:source.id,version:1,name:'New mapping',config:config({attributes:[{key:'completion',path:'progress',type:'number'}]}),token:''});
   assert.equal(changed.version,2);assert.equal(changed.state,'draft');assert.equal(changed.recordCount,0);assert.equal(jobs.list(pending.id).status,'cancelled');
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_product_records').get().n,1);
   assert.throws(()=>save(sources,{id:source.id,version:1}));
   await enable(sources,changed);await run(jobs,jobs.enqueue(changed.id,'v2','product.sync').id);assert.equal(sources.records(changed.id)[0].attributes.completion,25);
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_product_records').get().n,2);
   const queued=jobs.enqueue(changed.id,'retire','product.sync');
   assert.throws(()=>other.revoke(changed.id,2));assert.throws(()=>sources.revoke(changed.id,1));
   assert.equal(sources.revoke(changed.id,2).state,'revoked');
   assert.equal(jobs.list(queued.id).status,'cancelled');assert.equal(sources.records(changed.id).length,1);
   assert.equal(db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(changed.id).encrypted_credentials,'');
   await assert.rejects(()=>sources.preview(changed.id,KEY,one));
 }finally{db.close();}
});
test('cancel, pause, credential revoke and actor revocation prevent in-flight imports',async()=>{
 for(const scenario of ['cancel','pause','revoke','member','edit']){
  const {db,repo,a,scope,sources,jobs}=fixture();try{
   const source=save(sources);await enable(sources,source);const job=jobs.enqueue(source.id,scenario,'product.sync');
   const loader=async()=>{
    if(scenario==='cancel')jobs.cancel(job.id);
    if(scenario==='pause')sources.setEnabled(source.id,source.version,false);
    if(scenario==='revoke')sources.revoke(source.id,source.version);
    if(scenario==='member')db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(a.userId);
    if(scenario==='edit')save(sources,{id:source.id,version:1,name:'edited'});
    return one();
   };
   const result=await run(jobs,job.id,loader);assert.notEqual(result.status,'completed',scenario);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_product_records').get().n,0,scenario);
   if(scenario==='pause')assert.equal(sources.list()[0].state,'paused');
  }finally{db.close();}
 }
});
test('REST sync is bounded, resumes cursors and rejects cursor cycles atomically',async()=>{
 const {db,sources,jobs}=fixture();try{
   const source=save(sources,{config:config({nextCursorPath:'result.nextCursor',cursorParam:'cursor'})});
   const visited=[],loader=async(_config,_token,cursor)=>{visited.push(cursor);const page=cursor?Number(cursor):1;return{items:[entity('learner-'+page)],nextCursor:page<4?String(page+1):null};};
   await enable(sources,source,loader);visited.length=0;
   await run(jobs,jobs.enqueue(source.id,'batch-1','product.sync').id,loader);assert.deepEqual(visited,[null,'2','3']);assert.equal(sources.list()[0].recordCount,3);assert.equal(sources.list()[0].hasMore,true);
   await run(jobs,jobs.enqueue(source.id,'batch-2','product.sync').id,loader);assert.equal(sources.list()[0].recordCount,4);assert.equal(sources.list()[0].hasMore,false);
   const cycle=jobs.enqueue(source.id,'cycle','product.sync');assert.equal((await run(jobs,cycle.id,async()=>({items:[entity('bad')],nextCursor:'same'}))).status,'failed');assert.equal(sources.list()[0].recordCount,4);
 }finally{db.close();}
});
test('late snapshots cannot overwrite newer data and conflicting versions roll back a batch',async()=>{
 const {db,sources,jobs}=fixture();try{
   const source=save(sources);await enable(sources,source);await run(jobs,jobs.enqueue(source.id,'new','product.sync').id,async()=>({items:[entity('x',80,'2026-02-01T10:00:00Z')],nextCursor:null}));
   await run(jobs,jobs.enqueue(source.id,'old','product.sync').id,async()=>({items:[entity('x',20)],nextCursor:null}));assert.equal(sources.records(source.id)[0].attributes.progress,80);
   const conflict=jobs.enqueue(source.id,'conflict','product.sync');assert.equal((await run(jobs,conflict.id,async()=>({items:[entity('y'),entity('x',99,'2026-02-01T10:00:00Z')],nextCursor:null}))).status,'failed');assert.equal(sources.list()[0].recordCount,1);
 }finally{db.close();}
});
test('REST adapter pins public IP, forwards only explicit auth and never follows redirects',async()=>{
 let calls=0;
 const transport={resolve:async()=>({address:'8.8.8.8',family:4}),request:async(url,pinned,accept,headers)=>{calls++;assert.equal(url.href,'https://api.example.com/users');assert.equal(pinned.address,'8.8.8.8');assert.equal(headers.Authorization,'Bearer safe-token');return new Response(JSON.stringify({result:{items:[entity()]}}),{headers:{'content-type':'application/json'}});}};
 assert.equal((await readProductPage(config(),'safe-token',null,transport)).items.length,1);assert.equal(calls,1);
 await assert.rejects(()=>readProductPage(config({url:'https://127.0.0.1/users'}),'x',null));
 await assert.rejects(()=>readProductPage(config(),'x',null,{...transport,request:async()=>new Response('',{status:302,headers:{location:'https://127.0.0.1/'}})}));
 await assert.rejects(()=>readProductPage(config(),'x',null,{...transport,request:async()=>new Response('x'.repeat(PRODUCT_SOURCE_LIMITS.responseBytes+1),{headers:{'content-type':'application/json'}})}));
 await assert.rejects(()=>readProductPage(config(),'x',null,{...transport,request:async()=>new Response('<html/>',{headers:{'content-type':'text/html'}})}));
});
test('product source configuration rejects unsafe mappings, arbitrary URLs and implicit type conversion',()=>{
 for(const url of ['http://example.com','https://u:p@example.com','https://example.com:8443','https://example.com?token=secret','https://example.com#fragment'])assert.throws(()=>normalizeProductSource(config({url})));
 for(const path of ['__proto__.polluted','constructor.name','credentials.token','password','a[0].field'])assert.throws(()=>normalizeProductSource(config({attributes:[{key:'safe',path,type:'string'}]})));
 assert.throws(()=>normalizeProductSource(config({attributes:[{key:'consent',path:'status',type:'string'}]})));
 assert.throws(()=>normalizeProductSource(config({attributes:[{key:'x',path:'a',type:'string'},{key:'x',path:'b',type:'string'}]})));
});
test('source quotas are scoped and idempotent jobs do not consume another daily slot',async()=>{
 const {db,sources,jobs,a,b,other}=fixture();try{
   const source=save(sources);await enable(sources,source);
   const job=jobs.enqueue(source.id,'quota-key','product.sync');
   const day=new Date().toISOString().slice(0,10);
   db.prepare("UPDATE platform_usage SET count=100 WHERE organization_id=? AND project_id=? AND period=? AND resource='product_sync'").run(a.organizationId,a.projectId,day);
   assert.equal(jobs.enqueue(source.id,'quota-key','product.sync').id,job.id);
   await run(jobs,job.id);
   assert.throws(()=>jobs.enqueue(source.id,'over-quota','product.sync'),error=>error.status===429);
   db.prepare("UPDATE platform_usage SET count=50 WHERE organization_id=? AND project_id=? AND period=? AND resource='product_preview'").run(a.organizationId,a.projectId,day);
   await assert.rejects(()=>sources.preview(source.id,KEY,one),error=>error.status===429);
   const otherSource=save(other);assert.equal((await other.preview(otherSource.id,KEY,one)).canActivate,true);
 }finally{db.close();}
});
test('a different source origin requires a new explicit credential',()=>{
 const {db,sources}=fixture();try{
   const source=save(sources);
   assert.throws(()=>save(sources,{id:source.id,version:source.version,token:'',config:config({url:'https://different.example.com/users'})}));
   assert.equal(sources.list()[0].version,1);
 }finally{db.close();}
});
test('expired workers cannot commit; lease recovery safely replays the bounded batch',async()=>{
 const {db,sources,jobs}=fixture();try{
   const source=save(sources);await enable(sources,source);const job=jobs.enqueue(source.id,'lease','product.sync');
   await run(jobs,job.id,async()=>{db.prepare("UPDATE platform_jobs SET lease_until='2000-01-01' WHERE id=?").run(job.id);return one();});
   assert.equal(sources.list()[0].recordCount,0);
   assert.equal((await run(jobs,job.id)).status,'completed');assert.equal(sources.list()[0].recordCount,1);assert.equal(jobs.list(job.id).attempts,2);
 }finally{db.close();}
});
test('migration 11 preserves previously queued connection jobs and encrypted connections',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'product-migration-')),'test.sqlite');
 let db=openPlatformDatabase(file);try{
   const repo=new PlatformRepository(db);repo.bootstrapLegacy('fixture-admin');
   const a=repo.provision('legacy-admin',{organizationName:'Old',projectName:'Old',website:'https://example.com',username:'old',password:'fixture-password-123'});
   const scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId};
   const connection=new ProjectMarketingStore(db,scope).saveConnection({provider:'ga4',integrationId:'123',accountName:'Existing analytics',accessToken:'old-secret'},KEY);
   const jobs=new ConnectionJobs(db,scope),job=jobs.enqueue(connection.id,'old-job');
   const envelope=db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(connection.id).encrypted_credentials;
   require('./schema-fixture.cjs').removeMobileSchema(db);
   db.exec('DROP TABLE platform_segment_previews; DROP TABLE platform_segment_versions; DROP TABLE platform_segments; DELETE FROM platform_migrations WHERE version=13; DROP TABLE platform_product_events; DROP TABLE platform_product_event_receipts; DELETE FROM platform_migrations WHERE version=12; DROP TABLE platform_product_records; DROP TABLE platform_product_source_versions; DROP TABLE platform_product_sources; DROP INDEX platform_connection_scope_id; ALTER TABLE platform_jobs DROP COLUMN job_type; DELETE FROM platform_migrations WHERE version=11;');
   db.close();db=openPlatformDatabase(file);
   assert.equal(new ConnectionJobs(db,scope).list(job.id).jobType,'connection.verify');assert.equal(new ConnectionJobs(db,scope).list(job.id).status,'queued');
   assert.equal(db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(connection.id).encrypted_credentials,envelope);
   assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
});
