const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {fixture}=require('./email-pilot-fixture.cjs');
const {GrowthCompass,compassSiteReceipt}=load('guidance.ts');
const {COMPASS_INTENTS,COMPASS_PATHS,CONNECTION_GUIDES}=load('guidance-catalog.ts');
const run=fn=>async()=>{const f=fixture();f.compass=new GrowthCompass(f.db,f.scope,f.KEY);f.defaults={intent:'leads',experience:'guided',channels:['linkedin_company'],obstacles:{},expectedRevision:0};try{await fn(f);}finally{f.db.close();}};
const step=(snapshot,id)=>snapshot.steps.find(item=>item.id===id);
const verify=(f,id)=>f.db.prepare('INSERT INTO platform_connection_checks VALUES(?,?,?,?,?)').run(id,require('node:crypto').createHash('sha256').update(f.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(id).encrypted_credentials).digest('hex'),'verified',new Date().toISOString(),'Disposable QA access');

test('first-run read is side-effect free, scoped and safe',run(f=>{
  const before=f.db.totalChanges,changes=f.db.prepare('SELECT total_changes() n').get().n;
  const result=f.compass.read();assert.equal(result.firstRun,true);assert.equal(result.preferences,null);assert.ok(result.steps.length>0);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);assert.equal(f.db.totalChanges,before);
  for(const privateValue of ['private-smtp-password','pilot0@example.com',f.KEY])assert.ok(!JSON.stringify(result).includes(privateValue));
  assert.equal(result.campaigns.length,1);assert.equal(new GrowthCompass(f.db,f.other,f.KEY).read().campaigns.length,0);
}));
test('each path derives a valid plan using existing modules',run(f=>{
  for(const intent of COMPASS_INTENTS){const snapshot=f.compass.save({...f.defaults,intent,channels:[...COMPASS_PATHS[intent].channels],expectedRevision:f.compass.read().preferences?.revision||0});assert.equal(snapshot.preferences.intent,intent);assert.ok(snapshot.steps.length>=5);assert.ok(snapshot.steps.every(item=>item.href.startsWith('/?tab=')));assert.ok(snapshot.steps.every(item=>item.state!=='unknown'));}
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_compass_preferences').get().n,1);
}));
test('preferences use optimistic concurrency; selected channels do not grant access',run(f=>{
  const first=f.compass.save({...f.defaults,role:'owner',liveEnabled:true,completed:true,accessToken:'do-not-store'});assert.equal(first.preferences.revision,1);
  assert.equal(step(first,'connection:linkedin_company').state,'blocked');assert.notEqual(step(first,'rehearsal').state,'done');
  assert.throws(()=>f.compass.save(f.defaults),error=>error.status===409);
  const stored=f.db.prepare('SELECT preferences_json FROM platform_compass_preferences').get().preferences_json;assert.doesNotMatch(stored,/accessToken|do-not-store|completed|owner/);
}));
test('first-run deferral persists and never completes a missing connection',run(f=>{
  const deferred=f.compass.defer(0);assert.equal(deferred.firstRun,false);assert.equal(deferred.preferences.deferred,true);assert.equal(deferred.preferences.channels.length,0);
  assert.equal(deferred.boundCampaignId,null);assert.notEqual(step(deferred,'campaign').state,'done');
  const resumed=f.compass.save({...deferred.preferences,channels:['facebook'],obstacles:{facebook:'later'},expectedRevision:1});assert.equal(resumed.preferences.deferred,false);assert.notEqual(step(resumed,'connection:facebook').state,'done');
}));
test('first pilot channel, not a secondary channel, determines campaign compatibility',run(f=>{
  f.store.saveCampaign({...f.campaign,channels:{...f.campaign.channels,social:['facebook']}},false);
  let snapshot=f.compass.save({...f.defaults,channels:['instagram','facebook']});assert.equal(snapshot.boundCampaignId,null);assert.equal(snapshot.campaigns.length,0);
  snapshot=f.compass.save({...snapshot.preferences,channels:['facebook','instagram'],expectedRevision:1});assert.equal(snapshot.boundCampaignId,f.campaign.id);
}));
test('goals/campaign/app identifiers cannot escape project scope',run(f=>{
  const other=new(load('marketing-store.ts').ProjectMarketingStore)(f.db,f.other);other.saveCampaign({...f.campaign,id:'foreign',segmentBinding:undefined},true);
  for(const input of [{goalId:'foreign'},{campaignId:'foreign'},{appId:'foreign'}])assert.throws(()=>f.compass.save({...f.defaults,...input}),error=>error.status===404);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_compass_preferences').get().n,0);
}));
test('malformed and excessive preferences fail without writes',run(f=>{
  for(const input of [{intent:'unknown'},{experience:'auto_send'},{channels:['email','email']},{channels:['email','facebook','instagram','twitter']},{obstacles:{facebook:'connected'}},{channels:'facebook'},{expectedRevision:'0'}])assert.throws(()=>f.compass.save({...f.defaults,...input}));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_compass_preferences').get().n,0);
}));
test('viewer can set personal needs without obtaining management privileges',run(f=>{
  const member=f.repo.addMember(f.scope.subject,f.a.organizationId,f.a.projectId,{username:'compass-viewer',password:'fixture-password-123',role:'viewer'}),viewer=new GrowthCompass(f.db,{...f.scope,subject:member.userId},f.KEY);
  const snapshot=viewer.save(f.defaults);assert.equal(snapshot.canManage,false);assert.equal(snapshot.canWrite,false);assert.equal(step(snapshot,'connection:linkedin_company').canAct,false);assert.ok(snapshot.providers.every(item=>item.state==='restricted'));
  assert.equal(f.compass.read().firstRun,true);assert.throws(()=>viewer.handoff('linkedin_company'),error=>error.status===403);
}));
test('revoked membership and forged scope deny both reads and writes',run(f=>{
  assert.throws(()=>new GrowthCompass(f.db,{...f.other,subject:f.scope.subject},f.KEY).read(),error=>error.status===403);
  f.db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(f.scope.subject);
  for(const action of [()=>f.compass.read(),()=>f.compass.save(f.defaults),()=>f.compass.handoff('facebook')])assert.throws(action,error=>error.status===403);
}));
test('legacy Crewin pack has no new compass preferences or side effects',run(f=>{
  const compass=new GrowthCompass(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'},f.KEY);assert.throws(()=>compass.read(),error=>error.status===403);assert.throws(()=>compass.defer(0),error=>error.status===403);
}));
test('handoff reuses the existing calendar and deduplicates an active task',run(f=>{
  const first=f.compass.handoff('facebook'),second=f.compass.handoff('facebook');assert.equal(first.created,true);assert.equal(second.created,false);assert.equal(first.task.id,second.task.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_work_items').get().n,1);assert.match(first.task.note,/https:\/\/www.facebook.com/);assert.doesNotMatch(first.task.note,/private-smtp-password|pilot0@example.com/);
  const other=new GrowthCompass(f.db,f.other,f.KEY).handoff('facebook');assert.notEqual(other.task.id,first.task.id);assert.equal(other.created,true);
}));
test('configured and expired access are not completed; verified access is not publishing',run(f=>{
  const snapshot=f.compass.save({...f.defaults,channels:['email']});assert.equal(snapshot.providers.find(item=>item.id==='email').state,'configured');assert.notEqual(step(snapshot,'connection:email').state,'done');
  verify(f,f.connection.id);
  const checked=f.compass.read();assert.equal(checked.providers.find(item=>item.id==='email').state,'access_verified');assert.equal(step(checked,'connection:email').state,'done');assert.notEqual(step(checked,'rehearsal').state,'done');
  f.db.prepare("UPDATE platform_connection_checks SET checked_at='2000-01-01'").run();assert.notEqual(step(f.compass.read(),'connection:email').state,'done');
}));
test('personal LinkedIn verification does not complete company-page access',run(f=>{
  const c=f.store.saveConnection({provider:'social',integrationId:'linkedin:member',accountName:'Private profile',accessToken:'not-real',social:{platform:'linkedin',accountId:'member'}},f.KEY);
  verify(f,c.id);
  const result=f.compass.save({...f.defaults,channels:['linkedin_person','linkedin_company']});assert.equal(step(result,'connection:linkedin_person').state,'done');assert.notEqual(step(result,'connection:linkedin_company').state,'done');
}));
test('unrelated calendar work and quota counters are not SEO audit evidence',run(f=>{
  new(load('operations.ts').ProjectOperations)(f.db,f.scope).saveTask({title:'Unrelated work',dueAt:new Date().toISOString(),note:'A non-audit task'});
  let result=f.compass.save({...f.defaults,intent:'seo',channels:[]});assert.notEqual(step(result,'site-audit').state,'done');assert.notEqual(step(result,'improvement-task').state,'done');
  const at=new Date().toISOString();for(const operation of [compassSiteReceipt('https://example.com'),compassSiteReceipt('https://example.com')+':clean'])f.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(f.scope.subject,f.scope.organizationId,f.scope.projectId,operation,at);
  result=f.compass.read();assert.equal(step(result,'site-audit').state,'done');assert.equal(step(result,'improvement-task').state,'done');assert.notEqual(step(result,'search-data').state,'done');
  f.db.prepare("UPDATE platform_projects SET website='https://different.example' WHERE id=?").run(f.scope.projectId);assert.notEqual(step(f.compass.read(),'site-audit').state,'done');
}));
test('retention data proof is lost when source pauses; existing content is not a rehearsal',run(f=>{
  let snapshot=f.compass.save({...f.defaults,intent:'retention',channels:['email']});assert.equal(step(snapshot,'product-events').state,'done');assert.equal(step(snapshot,'draft').state,'done');assert.notEqual(step(snapshot,'rehearsal').state,'done');assert.notEqual(step(snapshot,'live').state,'done');
  f.db.prepare('UPDATE platform_product_sources SET enabled=0 WHERE connection_id=?').run(f.source.id);snapshot=f.compass.read();assert.notEqual(step(snapshot,'product-events').state,'done');
}));
test('no email send occurs from reading, changing a path or creating a handoff',run(f=>{
  const jobs=f.db.prepare('SELECT COUNT(*) n FROM platform_jobs').get().n;f.compass.save({...f.defaults,intent:'retention',channels:['email']});f.compass.read();f.compass.handoff('email');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_jobs').get().n,jobs);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_email_pilots').get().n,0);
}));
test('current rehearsal proof is invalidated by a campaign edit',run(async f=>{
  f.compass.save({...f.defaults,intent:'retention',channels:['email']});const job=f.queue.enqueue(f.input(f.approve()));await f.queue.process(job.id,async()=>{});
  assert.equal(step(f.compass.read(),'rehearsal').state,'done');assert.notEqual(step(f.compass.read(),'live').state,'done');
  f.store.saveCampaign({...f.campaign,content:{...f.campaign.content,text:'Changed draft'},updatedAt:new Date().toISOString()},false);assert.notEqual(step(f.compass.read(),'rehearsal').state,'done');
}));
test('manual measurements count only when linked to a current project goal',run(f=>{
  const operations=new(load('operations.ts').ProjectOperations)(f.db,f.scope);let result=f.compass.save({...f.defaults,intent:'seo',channels:[]});assert.notEqual(step(result,'measurement').state,'done');
  f.repo.updateProject(f.scope.subject,f.scope.organizationId,f.scope.projectId,{...f.repo.workspace(f.scope.subject,f.scope.organizationId,f.scope.projectId).project,goals:[{id:'revenue',label:{tr:'Gelir',en:'Revenue'},audience:{tr:'Müşteriler',en:'Customers'},stages:[{tr:'Talep',en:'Lead'},{tr:'Müşteri',en:'Customer'}]}]});
  operations.saveMetric({goalId:'revenue',stageIndex:0,value:0,observedAt:new Date().toISOString()});assert.notEqual(step(f.compass.read(),'measurement').state,'done');
  assert.equal(step(f.compass.save({...f.compass.read().preferences,goalId:'revenue',expectedRevision:1}),'measurement').state,'done');
}));
test('mobile progress requires a current production event, not a saved key or sandbox',run(f=>{
  const {MobileGrowth}=load('mobile-store.ts'),{recordMobileEvents}=load('mobile-ingestion.ts'),mobile=new MobileGrowth(f.db,f.scope,f.KEY),app=mobile.saveApp({name:'Compass mobile QA',platform:'both',appleId:'123456789',bundleId:'com.example.compass',packageName:'com.example.compass',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'compassqa',attributionProvider:'bridge',revenueProvider:'bridge',identityConfirmed:true});mobile.setSource(app.id,true);
  f.compass.save({...f.defaults,intent:'mobile',channels:[],appId:app.id});assert.notEqual(step(f.compass.read(),'mobile-events').state,'done');
  const event={id:'sandbox',entityId:'user1',kind:'install',occurredAt:new Date(Date.now()-60000).toISOString(),platform:'ios',details:{identity:'customer',environment:'sandbox'}};recordMobileEvents(mobile,app,'bridge',[event]);assert.notEqual(step(f.compass.read(),'mobile-events').state,'done');
  recordMobileEvents(mobile,app,'bridge',[{...event,id:'production',details:{identity:'customer',environment:'production'}}]);assert.equal(step(f.compass.read(),'mobile-events').state,'done');mobile.setSource(app.id,false);assert.notEqual(step(f.compass.read(),'mobile-events').state,'done');
}));
test('guides distinguish operator OAuth setup, customer access and mobile SDK work',()=>{
  for(const guide of CONNECTION_GUIDES){assert.ok(guide.steps.length>=3);assert.ok(guide.needs.length>=2);assert.ok(guide.href.startsWith('/?tab='));for(const link of guide.links)assert.equal(new URL(link.url).protocol,'https:');}
  const company=CONNECTION_GUIDES.find(item=>item.id==='linkedin_company');assert.match(JSON.stringify(company),/operator/);assert.match(JSON.stringify(company),/analyst/);
  assert.match(JSON.stringify(CONNECTION_GUIDES.find(item=>item.id==='instagram')),/Facebook Login/);assert.match(JSON.stringify(CONNECTION_GUIDES.find(item=>item.id==='mobile')),/SDK/);
});
test('schema30 is additive and preferences survive reopening and offline recovery',run(async f=>{
  const fs=require('node:fs'),path=require('node:path'),folder=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'compass-migration-')),file=path.join(folder,'snapshot.sqlite');
  require('./schema-fixture.cjs').removeCompassSchema(f.db);await f.db.backup(file);let db=load('database.ts').openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,54);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_campaigns').get().n,1);
  new GrowthCompass(db,f.scope,f.KEY).save(f.defaults);db.close();db=load('database.ts').openPlatformDatabase(file);assert.equal(new GrowthCompass(db,f.scope,f.KEY).read().preferences.revision,1);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);db.close();
  const {inspectSnapshot}=await import('../scripts/lib/platform-recovery.mjs');assert.equal(inspectSnapshot(file,f.KEY,54).integrity,'ok');fs.rmSync(folder,{recursive:true,force:true});
}));
