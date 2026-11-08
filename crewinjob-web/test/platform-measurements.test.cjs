const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {ProjectMeasurements,measurementPeriod,scheduleMeasurements}=load('measurements.ts'),{readGoogleMeasurement}=load('measurement-google.ts'),{defaultMeasurementPeriod}=load('measurement-types.ts'),{ProjectOperations}=load('operations.ts');
async function setup(){
 const f=await fixture();await f.repo.updateProject(f.a.userId,f.a.organizationId,f.a.projectId,{name:'Measurement QA',website:'https://example.com',timezone:'Europe/Istanbul',language:'tr',brandVoice:'Fixture',goals:[{id:'growth',label:{tr:'Büyüme',en:'Growth'},audience:{tr:'İşletmeler',en:'Businesses'},stages:[{tr:'Kayıt',en:'Signup'},{tr:'Aktif',en:'Active'}]}]});
 f.measure=new ProjectMeasurements(f.db,f.scope,KEY);f.operations=new ProjectOperations(f.db,f.scope);f.google=await f.store.saveConnection({provider:'ga4',integrationId:'12345',accountName:'Fixture GA4',accessToken:'fixture-report-token'},KEY);
 f.mapping={goalId:'growth',stageIndex:0,connectionId:f.google.id,metric:'eventCount',eventName:'sign_up',enabled:false,expectedVersion:0};
 f.bind=async (input={})=>await f.measure.save({...f.mapping,...input});f.enqueue=async (binding,key='measurement-fixture-key',period=defaultMeasurementPeriod())=>await f.measure.enqueue({bindingId:binding.id,expectedVersion:binding.version,...period,idempotencyKey:key});
 return f;
}
const result=(value=9)=>({status:'ready',value,reason:null,timezone:'Europe/Istanbul',rows:1,checkedAt:new Date().toISOString()});
const close=async work=>{const f=await setup();try{await work(f);}finally{f.db.close();}};

test('measurement periods validate real calendar dates, closed days and bounded windows',()=>{
 const period=defaultMeasurementPeriod();assert.equal(JSON.stringify(measurementPeriod(period.from,period.to)),JSON.stringify(period));
 for(const pair of [['2026-02-30','2026-03-01'],[period.to,period.from],['2000-01-01','2000-01-02'],[period.from,new Date().toISOString().slice(0,10)],[null,period.to]])assert.throws(()=>measurementPeriod(...pair));
 assert.notEqual(defaultMeasurementPeriod('product_webhook').to,period.to);
});

test('one versioned mapping per goal-stage is scoped, optimistic and cannot trust client provider or source',()=>close(async f=>{
 const binding=await f.bind({provider:'search_console',sourceVersion:999});assert.equal((await f.measure.workspace()).bindings[0].provider,'ga4');assert.equal((await f.measure.workspace()).bindings[0].version,1);await assert.rejects(async ()=>await f.bind(),e=>e.status===409);
 await assert.rejects(async ()=>await new ProjectMeasurements(f.db,f.other,KEY).save(f.mapping),e=>e.status===409);await assert.rejects(async ()=>await f.bind({expectedVersion:1,stageIndex:5}),e=>e.status===409);
 await assert.rejects(async ()=>await f.bind({expectedVersion:1,metric:'totalUsers',eventName:'sign_up'}));await assert.rejects(async ()=>await f.bind({expectedVersion:1,metric:'arbitrary-costly-report'}));
 await assert.rejects(async ()=>await f.bind({expectedVersion:1,eventName:'private@example.com'}));const saved=await f.bind({expectedVersion:1,eventName:'purchase',enabled:true});assert.equal(saved.id,binding.id);assert.equal((await f.measure.workspace()).bindings.length,1);assert.equal(saved.version,2);
 const viewer=await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'measurement-viewer',password:'fixture-password-123',role:'viewer'}),service=new ProjectMeasurements(f.db,{...f.scope,subject:viewer.userId},KEY);
 assert.equal((await service.workspace()).sources.length,0);assert.equal((await service.workspace()).canManage,false);await assert.rejects(async ()=>await service.save(f.mapping),e=>e.status===403);assert.ok(!JSON.stringify(await f.measure.workspace()).includes('fixture-report-token'));
}));

test('GA4 adapter requests one aggregate with a strict event filter and never sums daily unique users',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});const body=JSON.parse(options.body);return Response.json({metricHeaders:[{name:body.metrics[0].name}],rows:[{metricValues:[{value:'17'}]}],rowCount:1,metadata:{timeZone:'America/New_York'}});};
 try{
  const input={provider:'ga4',resource:'12345',definition:{metric:'eventCount',eventName:'sign_up'},...defaultMeasurementPeriod(),token:'fixture-only'};
  const measured=await readGoogleMeasurement(input);assert.equal(measured.value,17);assert.equal(measured.timezone,'America/New_York');assert.equal(measured.status,'ready');const body=JSON.parse(calls[0].options.body);assert.equal(calls[0].url,'https://analyticsdata.googleapis.com/v1beta/properties/12345:runReport');assert.equal(calls[0].options.redirect,'error');assert.equal(body.dimensionFilter.filter.stringFilter.matchType,'EXACT');assert.equal(body.dimensionFilter.filter.stringFilter.caseSensitive,true);assert.equal(body.dimensions,undefined);
  await readGoogleMeasurement({...input,definition:{metric:'totalUsers',eventName:''}});assert.equal(JSON.parse(calls[1].options.body).dimensions,undefined);assert.equal(JSON.parse(calls[1].options.body).dimensionFilter,undefined);
 }finally{globalThis.fetch=original;}
});

test('GA4 missing rows, thresholding, sampling and malformed metrics are not fabricated zeros',async()=>{
 const original=globalThis.fetch,input={provider:'ga4',resource:'123',definition:{metric:'eventCount',eventName:''},...defaultMeasurementPeriod(),token:'fixture'};
 const payload={metricHeaders:[{name:'eventCount'}],rows:[{metricValues:[{value:'0'}]}],rowCount:1,metadata:{timeZone:'UTC'}};
 try{
  globalThis.fetch=async()=>Response.json(payload);assert.equal((await readGoogleMeasurement(input)).value,0);
  globalThis.fetch=async()=>Response.json({...payload,rows:[],rowCount:0});assert.equal((await readGoogleMeasurement(input)).status,'no_data');assert.equal((await readGoogleMeasurement(input)).value,null);
  // Real GA4 answer for an event filter with no match: no rows and no metric headers. That is no data, not zero and not a failure.
  globalThis.fetch=async()=>Response.json({metadata:{timeZone:'Europe/Istanbul'},kind:'analyticsData#runReport'});const unmatched=await readGoogleMeasurement({...input,definition:{metric:'eventCount',eventName:'never_fired'}});assert.equal(unmatched.status,'no_data');assert.equal(unmatched.value,null);assert.equal(unmatched.timezone,'Europe/Istanbul');
  globalThis.fetch=async()=>Response.json({rows:payload.rows,rowCount:1,metadata:{timeZone:'UTC'}});await assert.rejects(()=>readGoogleMeasurement(input),'rows without metric headers are still rejected');
  for(const patch of [{subjectToThresholding:true},{dataLossFromOtherRow:true},{samplingMetadatas:[{}]}]){globalThis.fetch=async()=>Response.json({...payload,metadata:{timeZone:'UTC',...patch}});const value=await readGoogleMeasurement(input);assert.equal(value.status,'partial');assert.equal(value.value,null);}
  for(const patch of [{metricHeaders:[{name:'wrong'}]},{rowCount:2},{rows:[{metricValues:[{value:'NaN'}]}]},{metadata:{timeZone:'invalid-zone'}}]){globalThis.fetch=async()=>Response.json({...payload,...patch});await assert.rejects(()=>readGoogleMeasurement(input));}
 }finally{globalThis.fetch=original;}
});

test('Search Console uses finalized PT daily rows; missing days and empty responses remain unknown',async()=>{
 const original=globalThis.fetch,period=defaultMeasurementPeriod(),input={provider:'search_console',resource:'sc-domain:example.com',definition:{metric:'clicks',eventName:''},...period,token:'fixture'};
 const days=Array.from({length:7},(_,i)=>new Date(Date.parse(period.from)+i*86400000).toISOString().slice(0,10)),payload={rows:days.map(day=>({keys:[day],clicks:2,impressions:20})),responseAggregationType:'byProperty'};
 try{
  globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).host,'www.googleapis.com');const body=JSON.parse(options.body);assert.deepEqual(body.dimensions,['date']);assert.equal(body.dataState,'final');return Response.json(payload);};
  const measured=await readGoogleMeasurement(input);assert.equal(measured.value,14);assert.equal(measured.timezone,'America/Los_Angeles');
  globalThis.fetch=async()=>Response.json({...payload,rows:payload.rows.slice(1)});assert.equal((await readGoogleMeasurement(input)).status,'partial');assert.equal((await readGoogleMeasurement(input)).value,null);
  globalThis.fetch=async()=>Response.json({});assert.equal((await readGoogleMeasurement(input)).status,'no_data');
  globalThis.fetch=async()=>Response.json({...payload,rows:[payload.rows[0],payload.rows[0]]});await assert.rejects(()=>readGoogleMeasurement(input));
 }finally{globalThis.fetch=original;}
});

test('Google reader bounds provider responses and errors without reading arbitrary URLs',async()=>{
 const original=globalThis.fetch,input={provider:'ga4',resource:'123',definition:{metric:'eventCount',eventName:''},...defaultMeasurementPeriod(),token:'fixture'};
 try{
  for(const response of [()=>new Response('private-token-provider-error',{status:403}),()=>new Response('{}',{headers:{'content-length':'999999'}}),()=>new Response('x'.repeat(131073))]){globalThis.fetch=async()=>response();await assert.rejects(()=>readGoogleMeasurement(input));}
  globalThis.fetch=async()=>assert.fail('Unsafe resource reached fetch');await assert.rejects(()=>readGoogleMeasurement({...input,resource:'http://127.0.0.1'}));await assert.rejects(()=>readGoogleMeasurement({...input,definition:{metric:'unknown',eventName:''}}));
 }finally{globalThis.fetch=original;}
});

test('queued reads are idempotent and update existing automatic observations without mixing manual entries',()=>close(async f=>{
 await f.operations.saveMetric({goalId:'growth',stageIndex:0,value:100,observedAt:new Date().toISOString(),note:'Manual CRM total'});
 const binding=await f.bind(),job=await f.enqueue(binding);assert.equal((await f.enqueue(binding)).id,job.id);await assert.rejects(async ()=>await new ProjectMeasurements(f.db,f.other,KEY).get(job.id),e=>e.status===404);
 await f.measure.process(job.id,async()=>result(9));assert.equal((await f.measure.get(job.id)).value,9);assert.equal((await f.measure.get(job.id)).fresh,true);assert.equal((await f.operations.metrics()).length,1);assert.equal((await f.operations.metrics())[0].value,100);
 const repeated=await f.enqueue(binding,'different-measurement-intent');await f.measure.process(repeated.id,async()=>result(12));assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM platform_metric_entries WHERE source='ga4'").get().n,1);assert.equal((await f.measure.get(repeated.id)).value,12);assert.equal((await f.measure.get(job.id)).value,9);
 const automatic=f.db.prepare("SELECT * FROM platform_metric_entries WHERE source='ga4'").get();await assert.rejects(async ()=>await f.operations.removeMetric(automatic.id),e=>e.status===404);assert.equal(JSON.parse(automatic.provenance_json).attribution,'observed_not_causal');assert.equal(JSON.parse(automatic.provenance_json).resource,'12345');assert.ok(!automatic.provenance_json.includes('fixture-report-token'));
}));

test('partial/no-data reads persist status and never create a numeric metric',()=>close(async f=>{
 const binding=await f.bind();
 for(const [i,status] of ['partial','no_data'].entries()){
  const job=await f.enqueue(binding,`partial-intent-${i}`);await f.measure.process(job.id,async()=>({...result(),status,value:null,reason:status==='partial'?'provider_partial':'no_rows'}));assert.equal((await f.measure.get(job.id)).value,null);assert.equal((await f.measure.get(job.id)).resultStatus,status);
 }
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM platform_metric_entries WHERE source<>'manual'").get().n,0);
}));

test('late provider responses cannot commit after cancellation or binding edits',async()=>{
 for(const edit of ['cancel','binding'])await close(async f=>{
  const binding=await f.bind(),job=await f.enqueue(binding);let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const pending=f.measure.process(job.id,async()=>{entered();await gate;return result();});await started;
  if(edit==='cancel')await f.measure.cancel(job.id);else await f.bind({expectedVersion:1,eventName:'purchase'});release();await pending;
  assert.equal((await f.measure.get(job.id)).value,null);assert.equal((await f.measure.get(job.id)).resultStatus,'blocked');assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM platform_metric_entries WHERE source<>'manual'").get().n,0);
 });
});

test('manager/manual runner authority is rechecked after provider awaits and restoration cannot resume daily sync',async()=>{
 for(const actor of ['manager','runner'])await close(async f=>{
  const admin=await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'measurement-admin',password:'fixture-password-123',role:'admin'}),adminScope={...f.scope,subject:admin.userId},service=new ProjectMeasurements(f.db,adminScope,KEY),binding=actor==='manager'?await service.save({...f.mapping,enabled:true}):await f.bind(),job=await f.enqueue(binding);
  await f.measure.process(job.id,async()=>{await f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'viewer',true);return result();},undefined,actor==='runner'?admin.userId:undefined);
  assert.equal((await f.measure.get(job.id)).resultStatus,'blocked');assert.equal((await f.measure.get(job.id)).value,null);
  await f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'admin',true);if(actor==='manager')assert.equal((await f.measure.workspace()).bindings[0].enabled,false);
 });
});

test('provider errors are redacted and credential refresh cannot overwrite a concurrent connection change',()=>close(async f=>{
 const binding=await f.bind(),job=await f.enqueue(binding);await f.measure.process(job.id,async()=>{throw new Error('private-report-payload-and-token');});assert.equal((await f.measure.get(job.id)).resultStatus,'failed');assert.ok(!JSON.stringify(await f.measure.get(job.id)).includes('private-report-payload'));
 const fresh=await f.enqueue(binding,'refresh-conflict');await f.measure.process(fresh.id,async()=>assert.fail('Stale token reached provider'),async credentials=>{await f.store.saveConnection({id:f.google.id,provider:'ga4',integrationId:'12345',accountName:'Rotated',accessToken:'replacement-token'},KEY);return {...credentials,accessToken:'must-not-overwrite'};});assert.equal((await f.measure.get(fresh.id)).resultStatus,'blocked');
 const envelope=f.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(f.google.id).encrypted_credentials;const {decryptCredentials}=load('credential-envelope.ts');assert.equal(decryptCredentials(envelope,KEY,f.scope.organizationId,f.scope.projectId,f.google.id).accessToken,'replacement-token');
}));

test('product events require continuous retained coverage and distinguish unique entities from events',()=>close(async f=>{
 const period=defaultMeasurementPeriod('product_webhook'),binding=await f.bind({connectionId:f.source.id,metric:'event_count',eventName:'profile.updated'}),partial=await f.enqueue(binding,'product-partial',period);
 await f.measure.process(partial.id,async()=>assert.fail('Product event read called Google'));assert.equal((await f.measure.get(partial.id)).resultStatus,'partial');assert.equal((await f.measure.get(partial.id)).value,null);
 f.db.prepare('UPDATE platform_product_sources SET event_coverage_from=? WHERE connection_id=?').run(`${period.from}T00:00:00.000Z`,f.source.id);
 f.db.prepare('UPDATE platform_product_events SET occurred_at=?,entity_id=? WHERE connection_id=?').run(`${period.from}T12:00:00.000Z`,'one-observed-entity',f.source.id);
 const count=await f.enqueue(binding,'product-count',period);await f.measure.process(count.id);assert.equal((await f.measure.get(count.id)).value,7);assert.equal((await f.measure.get(count.id)).timezone,'UTC');
 const unique=await f.bind({connectionId:f.source.id,metric:'unique_entities',eventName:'profile.updated',expectedVersion:1}),uniqueJob=await f.enqueue(unique,'product-unique',period);await f.measure.process(uniqueJob.id);assert.equal((await f.measure.get(uniqueJob.id)).value,1);
 f.db.prepare('UPDATE platform_product_events SET event_name=? WHERE connection_id=?').run('different.event',f.source.id);const zero=await f.enqueue(unique,'product-observed-zero',period);await f.measure.process(zero.id);assert.equal((await f.measure.get(zero.id)).value,0);assert.equal((await f.measure.get(zero.id)).resultStatus,'ready');
}));

test('paused sources and source versions invalidate measurements; pause works even after revocation',()=>close(async f=>{
 const binding=await f.bind({connectionId:f.source.id,metric:'event_count',eventName:'profile.updated',enabled:true}),job=await f.enqueue(binding);
 await f.hooks.state(f.source.id,1,'pause');await f.measure.process(job.id);assert.equal((await f.measure.get(job.id)).resultStatus,'blocked');assert.equal((await f.measure.workspace()).bindings[0].valid,false);await f.measure.pause(binding.id,binding.version);assert.equal((await f.measure.workspace()).bindings[0].enabled,false);
}));

test('the same private worker schedule enqueues a bounded, once-daily measurement intent',()=>close(async f=>{
 const binding=await f.bind({enabled:true});assert.equal(await scheduleMeasurements(f.db,KEY),1);assert.equal(await scheduleMeasurements(f.db,KEY),0);
 const row=f.db.prepare("SELECT id,job_type FROM platform_jobs WHERE job_type='measurement.sync'").get();assert.equal(row.job_type,'measurement.sync');await f.measure.process(row.id,async()=>result());
 f.db.prepare("UPDATE platform_measurement_bindings SET next_sync_at='2000-01-01T00:00:00Z'").run();await scheduleMeasurements(f.db,KEY);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM platform_jobs WHERE job_type='measurement.sync'").get().n,1);assert.equal((await f.measure.workspace()).bindings[0].enabled,true);assert.equal((await f.measure.workspace()).bindings[0].id,binding.id);
}));

test('pausing future sync preserves a compatible observation but changed definitions never reuse it',()=>close(async f=>{
 const binding=await f.bind({enabled:true}),job=await f.enqueue(binding);await f.measure.process(job.id,async()=>result(23));
 const paused=await f.measure.pause(binding.id,binding.version),view=(await f.measure.workspace()).bindings[0];assert.equal(paused.version,2);assert.equal(view.enabled,false);assert.equal(view.nextSyncAt,null);assert.equal(view.latest.value,23);assert.equal(view.latest.fresh,true);
 await assert.rejects(async ()=>await f.measure.pause(binding.id,1),e=>e.status===409);
 await f.bind({expectedVersion:2,eventName:'purchase'});assert.equal((await f.measure.workspace()).bindings[0].latest,null);assert.equal((await f.measure.get(job.id)).fresh,false);
}));

test('a new manual read defers daily sync while idempotent retries leave the schedule alone',()=>close(async f=>{
 const binding=await f.bind({enabled:true}),job=await f.enqueue(binding),next=(await f.measure.workspace()).bindings[0].nextSyncAt;
 assert.ok(Date.parse(next)>Date.now()+86300000);assert.equal(await scheduleMeasurements(f.db,KEY),0);
 f.db.prepare("UPDATE platform_measurement_bindings SET next_sync_at='2000-01-01T00:00:00Z' WHERE id=?").run(binding.id);
 assert.equal((await f.enqueue(binding)).id,job.id);assert.equal((await f.measure.workspace()).bindings[0].nextSyncAt,'2000-01-01T00:00:00Z');
 await f.measure.process(job.id,async()=>result());
}));

test('historical observations retain their original resource and name after a connection changes',()=>close(async f=>{
 const binding=await f.bind(),job=await f.enqueue(binding);await f.measure.process(job.id,async()=>result(11));
 await f.store.saveConnection({id:f.google.id,provider:'ga4',integrationId:'67890',accountName:'Replacement property',accessToken:'replacement-token'},KEY);
 const previous=(await f.measure.workspace()).bindings[0].latest;assert.equal(previous.value,11);assert.equal(previous.resource,'12345');assert.equal(previous.sourceName,'Fixture GA4');assert.equal(previous.fresh,false);
 await f.measure.pause(binding.id,binding.version);assert.equal((await f.measure.workspace()).bindings[0].latest,null);
}));

test('expired leases can recover read-only work without two writers or duplicated observations',()=>close(async f=>{
 const binding=await f.bind(),job=await f.enqueue(binding);let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const running=f.measure.process(job.id,async()=>{entered();await gate;return result(99);});await started;await f.measure.process(job.id,async()=>assert.fail('Concurrent worker took lease'));
 f.db.prepare("UPDATE platform_jobs SET lease_until='2000-01-01T00:00:00Z' WHERE id=?").run(job.id);await new ProjectMeasurements(f.db,f.scope,KEY).process(job.id,async()=>result(7));release();await running;assert.equal((await f.measure.get(job.id)).value,7);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM platform_metric_entries WHERE source<>'manual'").get().n,1);
}));

test('schema18 upgrade preserves manual metrics, SES and queued rehearsal records across restart',async()=>{
 const f=await setup(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'measurement-migration18-')),'fixture.sqlite'),{openPlatformDatabase}=load('database.ts');let db;
 try{
  await f.operations.saveMetric({goalId:'growth',stageIndex:0,value:14,observedAt:new Date().toISOString(),note:'Existing manual metric'});const rehearsal=await f.queue.enqueue(await f.input(await f.approve()));
  require('./schema-fixture.cjs').removeMeasurementSchema(f.db);await f.db.backup(file);db=openPlatformDatabase(file);
  assert.equal((await new ProjectOperations(db,f.scope).metrics())[0].value,14);assert.equal((await new f.EmailPilotQueue(db,f.scope,KEY).get(rehearsal.id)).status,'queued');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_measurement_bindings').get().n,0);db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_migrations WHERE version=19').get().n,1);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);
 }finally{db?.close();f.db.close();}
});

test('active jobs stay visible when selecting another period, and a mapping edit cancels them',()=>close(async f=>{
 const binding=await f.bind(),job=await f.enqueue(binding),base=defaultMeasurementPeriod(),other={from:new Date(Date.parse(base.from)-86400000).toISOString().slice(0,10),to:new Date(Date.parse(base.to)-86400000).toISOString().slice(0,10)},view=await f.measure.workspace(other.from,other.to);
 assert.equal(view.bindings[0].latest,null);assert.equal(view.bindings[0].active.id,job.id);await assert.rejects(async ()=>await f.enqueue(binding,'another-range',other),e=>e.status===409);
 await f.bind({expectedVersion:1,eventName:'another_event'});assert.equal((await f.measure.get(job.id)).status,'cancelled');assert.equal((await f.measure.workspace()).bindings[0].active,null);
}));

test('successful Google refresh is encrypted and measured with the replacement token under the current lease',()=>close(async f=>{
 const binding=await f.bind(),job=await f.enqueue(binding);await f.measure.process(job.id,async request=>{assert.equal(request.token,'refreshed-fixture-token');return result(5);},async credentials=>({...credentials,accessToken:'refreshed-fixture-token',refreshToken:'private-refresh-fixture'}));
 assert.equal((await f.measure.get(job.id)).value,5);assert.equal((await f.measure.get(job.id)).fresh,true);assert.ok(!JSON.stringify(await f.measure.workspace()).includes('refreshed-fixture-token'));assert.ok(!f.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(f.google.id).encrypted_credentials.includes('private-refresh-fixture'));
}));

test('goal changes invalidate a pending read and stale retained observations are labelled not current',()=>close(async f=>{
 const binding=await f.bind(),job=await f.enqueue(binding);await f.measure.process(job.id,async()=>result());f.db.prepare("UPDATE platform_measurement_syncs SET checked_at='2000-01-01T00:00:00Z' WHERE job_id=?").run(job.id);assert.equal((await f.measure.get(job.id)).fresh,false);assert.equal((await f.measure.get(job.id)).value,9);
 const pending=await f.enqueue(binding,'goal-change');await f.measure.process(pending.id,async()=>{await f.repo.updateProject(f.a.userId,f.a.organizationId,f.a.projectId,{name:'Changed',website:'https://example.com',timezone:'UTC',language:'en',brandVoice:'Fixture',goals:[]});return result(99);});assert.equal((await f.measure.get(pending.id)).resultStatus,'blocked');assert.equal((await f.measure.get(pending.id)).value,null);assert.equal((await f.measure.workspace()).bindings[0].valid,false);
}));
