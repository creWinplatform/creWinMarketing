const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHmac,randomBytes}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {openPlatformDatabase}=load('database.ts');
const {PlatformRepository}=load('repository.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const {ProductWebhooks,authenticateProductWebhook}=load('product-webhooks.ts');
const {ProjectMeasurements}=load('measurements.ts');
const {ProjectAttribution,normalizeTouches,pruneAttribution}=load('attribution.ts');
const {LinkTracking,linkTag}=load('link-tracking.ts');
const {ProjectWhatsApp}=load('whatsapp.ts');
const {createBranchLink}=load('mobile-providers.ts');
const {removeTouchLogSchema}=require('./schema-fixture.cjs');
const KEY='34'.repeat(32),SECRET=randomBytes(32).toString('hex'),DAY=86400000;
const plain=value=>JSON.parse(JSON.stringify(value));
const ago=days=>new Date(Date.now()-days*DAY).toISOString();

async function fixture(){
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);await repo.bootstrapLegacy('admin');
 const a=await repo.provision('legacy-admin',{organizationName:'touches',projectName:'touches',website:'https://example.com',username:'touches',password:'fixture-password-123'});
 const scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId};
 await repo.updateProject(a.userId,a.organizationId,a.projectId,{name:'Touches QA',website:'https://example.com',timezone:'Europe/Istanbul',language:'tr',brandVoice:'Fixture',goals:[{id:'growth',label:{tr:'Büyüme',en:'Growth'},audience:{tr:'Kurucular',en:'Founders'},stages:[{tr:'Kayıt',en:'Signup'}]}]});
 const hooks=new ProductWebhooks(db,scope),store=new ProjectMarketingStore(db,scope);
 const saved=await hooks.save({name:'App events',config:{entityType:'user',attributes:[{key:'amount',type:'number'}],eventNames:['user.signed_up']},secret:SECRET},KEY);
 await hooks.preview(saved.id,{sourceVersion:1,events:[{id:'preview-1',entityId:'preview',eventName:'user.signed_up',occurredAt:ago(0.01),attributes:{amount:1}}]});
 const app=await hooks.state(saved.id,1,'activate');
 const send=async events=>{
  const bytes=Buffer.from(JSON.stringify({sourceVersion:1,events})),timestamp=String(Math.floor(Date.now()/1000));
  const signature='v1='+createHmac('sha256',Buffer.from(SECRET,'hex')).update(`${timestamp}.${app.id}.`).update(bytes).digest('hex');
  return await (await authenticateProductWebhook(db,app.id,new Headers({'x-ryzevo-timestamp':timestamp,'x-ryzevo-signature':signature}),KEY))(bytes);
 };
 await new ProjectMeasurements(db,scope,KEY).save({goalId:'growth',stageIndex:0,connectionId:app.id,metric:'unique_entities',eventName:'user.signed_up',enabled:false,expectedVersion:0});
 const campaign=async (id,name)=>{await store.saveCampaign({id,name,status:'draft',updatedAt:new Date().toISOString(),content:{subject:name,text:'x',ctaUrl:''},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]}},true);return linkTag(scope,'campaign',id);};
 return {db,repo,a,scope,send,campaign,attribution:new ProjectAttribution(db,scope)};
}
const close=work=>async ()=>{const f=await fixture();try{await work(f);}finally{f.db.close();}};
const touch=(campaign,days,source='email')=>({campaign,source,medium:source,touchedAt:ago(days)});
const signup=(id,entityId,extra)=>({id,entityId,eventName:'user.signed_up',occurredAt:ago(1),attributes:{amount:0},...extra});
const counts=(report,tag)=>report.items.find(item=>item.tag===tag)?.counts[0]??0;

test('the touches field is optional and strict; a bad list is dropped, never the event',()=>{
 const at=new Date().toISOString();
 assert.deepEqual(plain(normalizeTouches(undefined,at)),{touches:[],invalid:false});
 assert.equal(normalizeTouches([touch('rz_0123456789',2)],at).touches.length,1);
 assert.equal(normalizeTouches('rz_0123456789',at).invalid,true);
 assert.equal(normalizeTouches(Array.from({length:11},(_,i)=>touch('rz_0123456789',i)),at).invalid,true,'at most ten');
 assert.deepEqual(plain(normalizeTouches([touch('rz_0123456789',2),{campaign:'bad tag'}],at)),{touches:[],invalid:true},'one bad entry drops the list');
});

test('first, last and all touches credit different works; the first-touch view stays as it was',close(async f=>{
 const A=await f.campaign('c-a','Campaign A'),B=await f.campaign('c-b','Campaign B');
 // Person 1 came through A, then B; person 2 only through B.
 const one=signup('s-1','person-1',{attribution:touch(A,10),touches:[touch(A,10),touch(B,5,'linkedin')]});
 const result=await f.send([one,signup('s-2','person-2',{attribution:touch(B,3)}),signup('s-3','person-3',{attribution:touch(A,4),touches:[{campaign:'?'}]})]);
 assert.equal(result.accepted,3);assert.deepEqual(plain(result.attribution),{recorded:3,ignored:1},'a bad touches list is ignored like a bad tag');
 const first=await f.attribution.report(30),last=await f.attribution.report(30,'last'),any=await f.attribution.report(30,'any');
 assert.equal(first.model,'first');assert.equal(counts(first,A),2);assert.equal(counts(first,B),1);
 assert.equal(counts(last,A),1,'person 3 only has A');assert.equal(counts(last,B),2);
 assert.equal(counts(any,A),2);assert.equal(counts(any,B),2,'person 1 counts for both');
 assert.equal((await f.attribution.report(30,'nonsense')).model,'first');
 assert.deepEqual(plain(first.coverage),plain(any.coverage),'coverage is always the first touch');
 // Repeating the event is a duplicate; changing its touches later is refused like any change.
 assert.equal((await f.send([one])).duplicates,1);
 await assert.rejects(async ()=>await f.send([{...one,touches:[touch(A,10)]}]),error=>error.code==='event_conflict');
}));

test('a person keeps the latest twenty arrivals and old ones are pruned with the touches',close(async f=>{
 const tags=[];for(let i=0;i<25;i++)tags.push(await f.campaign(`c-${i}`,`C${i}`));
 const events=[0,1,2].map(n=>signup(`s-${n}`,'person-1',{touches:tags.slice(n*10,n*10+10).filter(Boolean).map((tag,i)=>touch(tag,30-n*10-i*0.5))}));
 await f.send(events);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_attribution_touch_log').get().n,20);
 const kept=f.db.prepare('SELECT MIN(touched_at) m FROM platform_attribution_touch_log').get().m;assert.ok(kept>ago(28)&&kept<ago(27),'the five oldest arrivals went first');
 f.db.prepare('UPDATE platform_attribution_touch_log SET touched_at=?').run(ago(600));
 await pruneAttribution(f.db);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_attribution_touch_log').get().n,0);
}));

test('WhatsApp sends and old app links are works in the report',close(async f=>{
 const C=await f.campaign('c-app','App launch');
 f.db.pragma('foreign_keys=OFF');
 f.db.prepare("INSERT INTO platform_whatsapp_batches(id,organization_id,project_id,connection_id,name,template_name,template_language,params_json,overrides_json,extras_json,contacts_json,digest,state,mode,created_by,created_at,updated_at) VALUES('wabatch_1',?,?,'conn','Spring WhatsApp','t','tr','[]','{}','{}','[]','d','done','send',?,?,?)").run(f.a.organizationId,f.a.projectId,f.a.userId,ago(5),ago(5));
 f.db.prepare("INSERT INTO platform_mobile_links(id,organization_id,project_id,app_id,connection_id,campaign_id,name,path,request_digest,status,url,created_at) VALUES('link-1',?,?,'app','conn','c-app','Launch','/x','d','created',NULL,?)").run(f.a.organizationId,f.a.projectId,ago(5));
 f.db.pragma('foreign_keys=ON');
 const W=linkTag(f.scope,'whatsapp','wabatch_1');
 await f.send([signup('s-1','person-1',{attribution:touch(W,2,'whatsapp')}),signup('s-2','person-2',{attribution:{campaign:'c-app',source:'ryzevo',medium:'app',touchedAt:ago(2)}}),signup('s-3','person-3',{attribution:touch('newsletter',2)})]);
 const report=await f.attribution.report(30),wa=report.items.find(item=>item.tag===W),app=report.items.find(item=>item.tag==='c-app');
 assert.equal(wa.kind,'whatsapp');assert.equal(wa.title,'Spring WhatsApp');assert.equal(wa.counts[0],1);
 assert.equal(app.kind,'campaign');assert.equal(app.title,'App launch','an app link made before tagging still counts for its campaign');
 assert.deepEqual(plain(report.other.map(item=>item.campaign)),['newsletter']);
 assert.notEqual(C,'c-app');
}));

test('Branch app links carry the campaign tag, and the web fallback only while tagging is on',async()=>{
 const bodies=[],read=async(url,init)=>{bodies.push(JSON.parse(init.body));return Response.json({url:'https://example.app.link/abc'});};
 const app={website:'https://example.com/',appleId:'123456789',country:'TR',packageName:'com.example.qa'};
 const secret={branchKey:'key_test_'+randomBytes(8).toString('hex')};
 await createBranchLink(app,{linkDomain:'example.app.link'},secret,{id:'link-1',path:'/promo',campaign:'rz_0123456789',tagWeb:true},read);
 await createBranchLink(app,{linkDomain:'example.app.link'},secret,{id:'link-2',path:'/promo',campaign:'rz_0123456789',tagWeb:false},read);
 assert.equal(bodies[0].campaign,'rz_0123456789');
 assert.equal(bodies[0].data.$fallback_url,'https://example.com/?utm_source=app_link&utm_medium=app&utm_campaign=rz_0123456789');
 assert.equal(bodies[1].data.$fallback_url,'https://example.com/');
});

test('WhatsApp batches tag own-site links in variables and the URL button, and show what they are approved with',coachRun(async f=>{
 const project=(await f.repo.workspace(f.scope.subject,f.a.organizationId,f.a.projectId)).project;
 await f.repo.updateProject(f.scope.subject,f.a.organizationId,f.a.projectId,{name:project.name,website:'https://ryzevo.example',timezone:project.timezone,language:'tr',brandVoice:'Clear',goals:project.goals});
 const graph=async(method,path)=>{
  if(path==='1234567890')return {status:200,payload:{display_phone_number:'+90 212 000 00 00',verified_name:'Ryzevo QA',quality_rating:'GREEN'}};
  if(path==='9988776655/phone_numbers')return {status:200,payload:{data:[{id:'1234567890'}]}};
  if(path==='9988776655/message_templates')return {status:200,payload:{data:[{name:'gorselli',language:'tr',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Yeni dönem {{1}}'},{type:'BUTTONS',buttons:[{type:'URL',text:'Kayıt',url:'https://ryzevo.example/kayit/{{1}}'}]}]}]}};
  return {status:404,payload:{}};
 };
 const wa=new ProjectWhatsApp(f.db,f.scope,'56'.repeat(32),graph);
 await wa.connect({phoneNumberId:'1234567890',wabaId:'9988776655',accessToken:'EAAFixtureWhatsAppTokenOnly_'+randomBytes(4).toString('hex')});await wa.refreshTemplates();
 await wa.addContacts({phones:'+90 532 111 22 33',evidence:'QA form 2026-10',consentAt:'2026-10-01',acknowledged:true});
 const base={name:'Kayıt',templateName:'gorselli',templateLanguage:'tr',contactIds:(await wa.read()).contacts.map(item=>item.id)};
 let batch=(await wa.saveBatch({...base,params:['https://ryzevo.example/donem ve https://other.example/x'],extras:{buttonParam:'stcw-2026'}})).batches[0];
 const tag=linkTag(f.scope,'whatsapp',batch.id),query=`utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=${tag}`;
 assert.equal(batch.params[0],`https://ryzevo.example/donem?${query} ve https://other.example/x`,'only the own site is tagged');
 assert.equal(batch.extras.buttonParam,`stcw-2026?${query}`);assert.match(batch.preview,new RegExp(tag),'the reviewed preview shows the tag');
 assert.equal(batch.results,null);
 // Saving again does not tag twice; a query ending gets an ampersand.
 batch=(await wa.saveBatch({...base,id:batch.id,expectedRevision:batch.revision,params:batch.params,extras:batch.extras})).batches[0];
 assert.equal(batch.extras.buttonParam,`stcw-2026?${query}`);
 batch=(await wa.saveBatch({...base,id:batch.id,expectedRevision:batch.revision,params:['Kasım'],extras:{buttonParam:'stcw?ref=wa'}})).batches[0];
 assert.equal(batch.extras.buttonParam,`stcw?ref=wa&${query}`);
 await new LinkTracking(f.db,f.scope,'56'.repeat(32)).configure({enabled:false,connectionId:null});
 batch=(await wa.saveBatch({...base,id:batch.id,expectedRevision:batch.revision,params:['https://ryzevo.example/donem'],extras:{buttonParam:'stcw-2026'}})).batches[0];
 assert.equal(batch.params[0],'https://ryzevo.example/donem');assert.equal(batch.extras.buttonParam,'stcw-2026','tagging off leaves links as written');
}));

test('migration 77 seeds the arrival log from first touches and is repeatable',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ryzevo-touches-')),file=path.join(directory,'platform.sqlite');
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let db=openPlatformDatabase(file);
 const repo=new PlatformRepository(db);await repo.bootstrapLegacy('admin');const a=await repo.provision('legacy-admin',{organizationName:'m',projectName:'m',website:'https://example.com',username:'m77',password:'fixture-password-123'});
 removeTouchLogSchema(db);
 db.pragma('foreign_keys=OFF');
 db.prepare('INSERT INTO platform_attribution_touches VALUES(?,?,?,?,?,?,?,?,?,?)').run(a.organizationId,a.projectId,'a'.repeat(64),'rz_0123456789','email','email',ago(3),'conn','e1',ago(3));
 db.close();
 for(let i=0;i<2;i++){
  db=openPlatformDatabase(file);
  try{
   assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,78);
   const first=db.prepare('SELECT touched_at FROM platform_attribution_touches').get().touched_at;
   assert.deepEqual(plain(db.prepare('SELECT campaign,source,touched_at FROM platform_attribution_touch_log').all()),[{campaign:'rz_0123456789',source:'email',touched_at:first}]);
   assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  }finally{db.close();}
 }
});
