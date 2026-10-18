const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomBytes,createHmac}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts');
const {ProductDataSources}=load('product-data.ts'),{ConnectionJobs}=load('connection-jobs.ts');
const {ProductWebhooks,authenticateProductWebhook}=load('product-webhooks.ts');
const {ProductSegments}=load('segments.ts'),{evaluateSegment}=load('segment-engine.ts');
const {normalizeSegmentDefinition}=load('segment-types.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const KEY='12'.repeat(32),group=(...children)=>({kind:'group',op:'and',children}),attr=(field='progress',op='lt',value=50)=>({kind:'attribute',field,op,value});
const def=(source,rules=group(attr()),goalId='',stageIndex=null)=>({sourceId:source.id,sourceVersion:source.version,maxAgeHours:24,rules,goalId,stageIndex});
function fixture(){
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
 const provision=name=>repo.provision('legacy-admin',{organizationName:name,projectName:name,website:'https://example.com',username:name,password:'fixture-password-123'});
 const a=provision('education'),b=provision('marketplace'),scope=v=>({subject:v.userId,organizationId:v.organizationId,projectId:v.projectId});
 return {db,repo,a,b,scope,segments:new ProductSegments(db,scope(a)),other:new ProductSegments(db,scope(b))};
}
async function rest(f,v=f.a,key='progress'){
 const sources=new ProductDataSources(f.db,f.scope(v)),source=sources.save({name:'Fixture REST',token:'never-return-this-secret',config:{url:'https://api.example.com/users',auth:'bearer',itemsPath:'items',idPath:'id',updatedAtPath:'updatedAt',entityType:'user',attributes:[{key,path:key,type:'number'},{key:'country',path:'country',type:'string'}],nextCursorPath:'',cursorParam:''}},KEY);
 const loader=async()=>({items:[0,25,80].map((value,index)=>({id:`external-${index}`,updatedAt:new Date(Date.now()-60000).toISOString(),[key]:value,country:index?'EN':'TR'})),nextCursor:null});
 await sources.preview(source.id,KEY,loader);sources.setEnabled(source.id,1,true);const jobs=new ConnectionJobs(f.db,f.scope(v));await jobs.run(jobs.enqueue(source.id,'seed','product.sync').id,KEY,undefined,undefined,undefined,undefined,loader);
 return source;
}
function webhook(f){
 const hooks=new ProductWebhooks(f.db,f.scope(f.a)),secret=randomBytes(32).toString('hex');
 const source=hooks.save({name:'Fixture events',secret,config:{entityType:'user',attributes:[{key:'progress',type:'number'}],eventNames:['profile.updated','lesson.started']}},KEY);
 const body={sourceVersion:1,events:[0,25,80].map((value,index)=>({id:`event-${index}`,entityId:`external-${index}`,eventName:index===1?'lesson.started':'profile.updated',occurredAt:new Date(Date.now()-(index===2?2*86400000:60000)).toISOString(),attributes:{progress:value}}))};
 hooks.preview(source.id,body);hooks.state(source.id,1,'activate');const bytes=Buffer.from(JSON.stringify(body)),timestamp=String(Math.floor(Date.now()/1000));
 authenticateProductWebhook(f.db,source.id,new Headers({'X-Ryzevo-Timestamp':timestamp,'X-Ryzevo-Signature':'v1='+createHmac('sha256',Buffer.from(secret,'hex')).update(`${timestamp}.${source.id}.`).update(bytes).digest('hex')}),KEY)(bytes);
 return {source,hooks};
}
test('typed evaluator handles nested AND/OR, lists, empty fields and missing/wrong types without coercion',()=>{
 const now=Date.now(),entity={id:'u',attributes:{progress:25,country:'TR',empty:''},observedAt:new Date(now).toISOString()},types={progress:'number',country:'string',empty:'string'};
 const rules=group(attr(),{kind:'group',op:'or',children:[attr('country','eq','EN'),attr('country','in',['TR','GR'])]},{kind:'attribute',field:'empty',op:'empty'});
 assert.equal(evaluateSegment(rules,entity,[],now,null,types).match,true);
  assert.equal(evaluateSegment(rules,entity,[],now,null,types).reasons[0].expected,50);
 assert.equal(evaluateSegment(group(attr()),{...entity,attributes:{progress:'25'}},[],now,null,types).match,null);
 assert.equal(evaluateSegment(group(attr('missing','neq',1)),entity,[],now,null,types).match,null);
 assert.equal(evaluateSegment(group({kind:'attribute',field:'missing',op:'empty'}),entity,[],now,null,types).match,true);
});
test('one source/rule engine supports three sector configurations and denies cross-project references',async()=>{
 const f=fixture();try{
  const source=await rest(f),otherSource=await rest(f,f.b,'listings');
  const a=f.segments.save({name:'Incomplete profiles',definition:def(source)}),b=f.other.save({name:'No listings',definition:def(otherSource,group(attr('listings','eq',0)))});
  assert.equal(f.segments.preview({id:a.id,version:1}).matched,2);assert.equal(f.other.preview({id:b.id,version:1}).matched,1);
  const third=f.repo.provision('legacy-admin',{organizationName:'Maritime fixture',projectName:'Maritime fixture',website:'https://example.com',username:'maritime',password:'fixture-password-123'}),thirdSource=await rest(f,third,'completion');
  const thirdSegments=new ProductSegments(f.db,f.scope(third)),c=thirdSegments.save({name:'Profile activation',definition:def(thirdSource,group(attr('completion','lt',30)))});
  assert.equal(thirdSegments.preview({id:c.id,version:1}).matched,2);
  assert.throws(()=>f.other.preview({id:a.id,version:1}));assert.throws(()=>f.other.save({name:'Foreign',definition:def(source)}));assert.throws(()=>f.other.archive(a.id,1,true));
  assert.ok(!JSON.stringify(f.segments.sources()).includes('never-return-this-secret'));assert.ok(!JSON.stringify(f.segments.sources()).includes('api.example.com'));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_metric_entries').get().n,0);
 }finally{f.db.close();}
});
test('unsupported operators, fields, source version, event rules on REST and excessive trees are rejected',async()=>{
 const f=fixture();try{
  const source=await rest(f),schema=f.segments.sources()[0];
  for(const rules of [group({...attr(),op:'execute_sql'}),group(attr('unknown')),group(attr('progress','eq','25')),group(attr('country','gt',1)),group({kind:'event',eventName:'lesson.started',op:'absent',days:1}),group({kind:'group',op:'and',children:[]})])assert.throws(()=>normalizeSegmentDefinition(def(source,rules),schema,[]));
  assert.throws(()=>normalizeSegmentDefinition({...def(source),sourceVersion:2},schema,[]));
  assert.throws(()=>normalizeSegmentDefinition({...def(source),rawSql:'SELECT *'},schema,[]));
  assert.throws(()=>normalizeSegmentDefinition(def(source,group(...Array.from({length:10},()=>group(attr(),attr(),attr())))),schema,[]));
 }finally{f.db.close();}
});
test('event absence is unknown before observed coverage and pause resets the observation window',()=>{
 const f=fixture();try{
  const {source,hooks}=webhook(f),rule=group({kind:'event',eventName:'lesson.started',op:'absent',days:1}),segment=f.segments.save({name:'Not started',definition:def(source,rule)});
  let result=f.segments.preview({id:segment.id,version:1});assert.equal(result.matched,0);assert.equal(result.unknown,2);assert.equal(result.excluded,1);
  f.db.prepare('UPDATE platform_product_sources SET event_coverage_from=? WHERE connection_id=?').run(new Date(Date.now()-8*86400000).toISOString(),source.id);
  result=f.segments.preview({id:segment.id,version:1});assert.equal(result.matched,2);assert.equal(result.unknown,0);
  const inactive=f.segments.save({name:'Inactive',definition:def(source,group({kind:'activity',op:'not_within',days:1}))});assert.equal(f.segments.preview({id:inactive.id,version:1}).matched,1);
  hooks.state(source.id,1,'pause');assert.throws(()=>f.segments.preview({id:segment.id,version:1}));hooks.state(source.id,1,'activate');assert.equal(f.segments.preview({id:segment.id,version:1}).unknown,2);
 }finally{f.db.close();}
});
test('stale, partial, revoked and changed-version sources fail closed instead of reporting zero matches',async()=>{
 for(const mode of ['stale','partial','paused','schema']){
  const f=fixture();try{
   const source=await rest(f),segment=f.segments.save({name:'Bound',definition:def(source)});
   if(mode==='stale')f.db.prepare('UPDATE platform_product_sources SET last_synced_at=?').run('2000-01-01T00:00:00Z');
   if(mode==='partial')f.db.prepare("UPDATE platform_product_sources SET encrypted_checkpoint='pending'").run();
   if(mode==='paused')new ProductDataSources(f.db,f.scope(f.a)).setEnabled(source.id,1,false);
   if(mode==='schema')new ProductDataSources(f.db,f.scope(f.a)).save({id:source.id,version:1,name:'Changed',token:'new-token',config:{...source.config}},KEY);
   assert.throws(()=>f.segments.preview({id:segment.id,version:1}),mode);
  }finally{f.db.close();}
 }
});
test('goal-stage mapping reuses project goals and becomes invalid after stage changes',async()=>{
 const f=fixture();try{
  const project={name:'Education',website:'https://example.com',timezone:'America/New_York',language:'en',brandVoice:'Clear',goals:[{id:'activation',label:{tr:'Aktivasyon',en:'Activation'},audience:{tr:'Üyeler',en:'Members'},stages:[{tr:'Kayıt',en:'Registered'},{tr:'Başlama',en:'Started'}]}]};
  f.repo.updateProject(f.a.userId,f.a.organizationId,f.a.projectId,project);const source=await rest(f),segment=f.segments.save({name:'Activation stage',definition:def(source,group(attr()),'activation',1)});
  assert.equal(f.segments.preview({id:segment.id,version:1}).timezone,'America/New_York');
  f.repo.updateProject(f.a.userId,f.a.organizationId,f.a.projectId,{...project,goals:[{...project.goals[0],stages:[project.goals[0].stages[0],{tr:'Ödeme',en:'Paid'}]}]});
  assert.throws(()=>f.segments.preview({id:segment.id,version:1}));assert.throws(()=>f.segments.save({name:'Wrong goal',definition:def(source,group(attr()),'foreign',0)}));
 }finally{f.db.close();}
});
test('versioned campaign binding requires a current preview and cannot move to another project',async()=>{
 const f=fixture();try{
  const source=await rest(f),segment=f.segments.save({name:'Initial',definition:def(source)});assert.throws(()=>f.segments.binding(segment.id,1,''));
  const preview=f.segments.preview({id:segment.id,version:1}),binding=f.segments.binding(segment.id,1,'');assert.equal(preview.matched,2);
  const store=new ProjectMarketingStore(f.db,f.scope(f.a));store.saveCampaign({id:'cmp_fixture',status:'draft',updatedAt:new Date().toISOString(),segmentBinding:binding},true);
  const second=f.segments.save({id:segment.id,version:1,name:'Stricter',definition:def(source,group(attr('progress','eq',0)))});assert.equal(second.version,2);
  assert.equal(store.campaign('cmp_fixture').segmentBinding.segmentVersion,1);assert.equal(f.segments.versions(segment.id).length,2);
  assert.throws(()=>new ProjectMarketingStore(f.db,f.scope(f.b)).saveCampaign({id:'cmp_bad',status:'draft',updatedAt:new Date().toISOString(),segmentBinding:binding},true));
  f.db.prepare('UPDATE platform_segment_previews SET computed_at=?').run('2000-01-01T00:00:00Z');assert.throws(()=>f.segments.binding(segment.id,1,''));
  f.segments.preview({id:segment.id,version:1});f.db.prepare('UPDATE platform_product_records SET attributes_json=? WHERE external_id=?').run(JSON.stringify({progress:90,country:'TR'}),'external-0');assert.throws(()=>f.segments.binding(segment.id,1,''));
  f.segments.archive(segment.id,2,true);assert.throws(()=>f.segments.preview({id:segment.id,version:1}));assert.equal(f.segments.archive(segment.id,2,false).archived,false);
 }finally{f.db.close();}
});
test('read-only previews hide samples, writes require content permission and preview quota is persistent',async()=>{
 const f=fixture();try{
  const source=await rest(f),segment=f.segments.save({name:'Audience',definition:def(source)}),member=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'reader',password:'fixture-password-123',role:'viewer'});
  const reader=new ProductSegments(f.db,{...f.scope(f.a),subject:member.userId});assert.equal(reader.preview({id:segment.id,version:1}).samples.length,0);assert.throws(()=>reader.save({name:'Denied',definition:def(source)}));assert.throws(()=>reader.preview({definition:def(source)}));assert.throws(()=>reader.sources());
  const period=new Date().toISOString().slice(0,10);f.db.prepare("UPDATE platform_usage SET count=200 WHERE organization_id=? AND period=? AND resource='segment_preview'").run(f.a.organizationId,period);assert.throws(()=>f.segments.preview({id:segment.id,version:1}));
  assert.throws(()=>new ProductSegments(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).list());
 }finally{f.db.close();}
});
test('relative event windows use UTC durations across DST and include exact cutoff boundaries',()=>{
 const now=Date.parse('2026-11-01T12:00:00Z'),entity={id:'u',attributes:{progress:25},observedAt:'2026-11-01T12:00:00Z'},rules=group({kind:'event',eventName:'started',op:'exists',days:1});
 const event={entityId:'u',name:'started',occurredAt:'2026-10-31T12:00:00Z'};assert.equal(evaluateSegment(rules,entity,[event],now,'2026-10-01T00:00:00Z',{progress:'number'}).match,true);
 assert.equal(evaluateSegment(rules,entity,[{...event,occurredAt:'2026-10-31T11:59:59.999Z'}],now,'2026-10-01T00:00:00Z',{progress:'number'}).match,false);
});

test('large source projections fail at the bounded byte budget without truncating an audience',async()=>{
 const f=fixture();try{
  const source=await rest(f),segment=f.segments.save({name:'Bounded',definition:def(source)});
  f.db.prepare('UPDATE platform_product_records SET attributes_json=? WHERE external_id=?').run(JSON.stringify({progress:25,padding:'x'.repeat(8*1024*1024)}),'external-0');
  assert.throws(()=>f.segments.preview({id:segment.id,version:1}),error=>error.status===429);
 }finally{f.db.close();}
});

test('membership authority loss pauses delegated webhooks and never restores historical coverage automatically',()=>{
 const f=fixture();try{
  const member=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'operator',password:'fixture-password-123',role:'admin'});
  const delegated={...f,a:{...f.a,userId:member.userId}}, {source}=webhook(delegated);
  f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,member.userId,'viewer',true);
  let state=f.db.prepare('SELECT enabled,event_coverage_from FROM platform_product_sources WHERE connection_id=?').get(source.id);
  assert.equal(state.enabled,0);assert.equal(state.event_coverage_from,null);
  f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,member.userId,'admin',true);
  state=f.db.prepare('SELECT enabled,event_coverage_from FROM platform_product_sources WHERE connection_id=?').get(source.id);
  assert.equal(state.enabled,0);assert.equal(state.event_coverage_from,null);
 }finally{f.db.close();}
});

test('migration 13 preserves existing data and starts webhook coverage at migration time, once',async()=>{
 const fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'segments-migration-')),'fixture.sqlite');
 const f=fixture();let db;
 try{
  const source=await rest(f),{source:hook}=webhook(f),old='2000-01-01T00:00:00Z';
  f.db.prepare('UPDATE platform_product_sources SET event_coverage_from=? WHERE connection_id=?').run(old,hook.id);
  const counts=f.db.prepare('SELECT COUNT(*) AS n FROM platform_product_records').get().n;
  f.db.exec('DROP TABLE platform_segment_previews; DROP TABLE platform_segment_versions; DROP TABLE platform_segments; ALTER TABLE platform_product_sources DROP COLUMN event_coverage_from; DELETE FROM platform_migrations WHERE version=13;');
  await f.db.backup(file);const before=Date.now();db=openPlatformDatabase(file);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_product_records').get().n,counts);
  assert.equal(db.prepare('SELECT event_coverage_from FROM platform_product_sources WHERE connection_id=?').get(source.id).event_coverage_from,null);
  const coverage=db.prepare('SELECT event_coverage_from FROM platform_product_sources WHERE connection_id=?').get(hook.id).event_coverage_from;
  assert.ok(Date.parse(coverage)>=before);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  db.close();db=openPlatformDatabase(file);
  assert.equal(db.prepare('SELECT event_coverage_from FROM platform_product_sources WHERE connection_id=?').get(hook.id).event_coverage_from,coverage);
 }finally{db?.close();f.db.close();}
});
