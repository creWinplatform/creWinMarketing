const assert=require('node:assert/strict'),{test}=require('node:test'),sharp=require('sharp');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SocialPublications,providerPublicationImage}=load('social-publications.ts'),ig=load('instagram-publishing.ts'),{normalizePublicationImage}=load('publication-image.ts');
const access=async()=>({expiresAt:Date.now()+3600000});
function config(){process.env.PLATFORM_META_APP_ID='12345';process.env.PLATFORM_META_APP_SECRET='private-secret';process.env.PLATFORM_META_GRAPH_VERSION='v25.0';process.env.PLATFORM_META_REDIRECT_URI='https://app.ryzevo.com/api/platform/meta/callback';process.env.PLATFORM_PUBLIC_ORIGIN='https://app.ryzevo.com';}
const makeImage=async(width=640,height=640)=>({imageData:(await sharp({create:{width,height,channels:3,background:'#5e963c'}}).png().toBuffer()).toString('base64'),imageMime:'image/png'});
async function setup(adapter={}){
 config();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';const f=fixture();
 f.ig=f.store.saveConnection({provider:'social',integrationId:'instagram:300',accountName:'QA Instagram',accessToken:'private-page-token',expiresAt:Date.now()+86400000,social:{platform:'instagram',accountId:'300',pageId:'100',graphVersion:'v25.0'}},KEY,{appId:'12345',userAccessToken:'private-user-token'});
 f.content={id:'ig-source',platform:'instagram',language:'tr',headline:'Instagram QA',content:'A reviewed image and caption.',prompt:'',timestamp:Date.now(),...await makeImage()};f.store.saveContent(f.content,true);
 f.calls={create:0,status:0,publish:0};f.adapter={create:async(_token,_id,_text,url)=>{f.calls.create++;f.url=url;return '700';},status:async()=>{f.calls.status++;return 'FINISHED';},publish:async(_token,_id,_container,reserve)=>{assert.equal(reserve(),true);f.calls.publish++;return {state:'accepted',postId:'800',postUrl:'https://www.instagram.com/p/qaPost/'};},...adapter};
 f.service=new SocialPublications(f.db,f.scope,KEY,f.adapter);
 f.input=(patch={})=>{const v=f.service.workspace(),s=v.sources.find(s=>s.id===f.content.id),t=v.targets.find(t=>t.id===f.ig.id);return {sourceKind:'content',sourceId:s.id,connectionId:t.id,expectedDigest:s.digest,expectedTargetRevision:t.revision,mode:'rehearsal',idempotencyKey:'instagram-fixture-intent',...patch};};
 f.publish=async(patch={})=>{process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.service.check(f.ig.id,access);return f.service.create(f.input({mode:'publish',acknowledged:true,...patch}));};
 f.due=id=>f.db.prepare('UPDATE platform_social_publications SET next_check_at=NULL WHERE job_id=?').run(id);
 f.media=()=>providerPublicationImage(f.db,KEY,new URL(f.url).pathname.split('/').pop(),new URL(f.url).searchParams.get('signature'));return f;
}
async function withFixture(fn,adapter){const f=await setup(adapter);try{await fn(f);}finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}}

test('image normalization uses real decoder, strips metadata, enforces shape/size/type and never fetches remote URLs',async()=>{
 const good=await makeImage(),image=await normalizePublicationImage(good.imageData,good.imageMime);assert.equal(image.width,640);assert.equal(image.height,640);assert.equal(image.digest.length,64);assert.equal((await sharp(Buffer.from(image.data,'base64')).metadata()).format,'jpeg');
 for(const [data,mime] of [['https://example.com/image.jpg','image/jpeg'],['<svg/>','image/svg+xml'],['not-valid-data','image/png'],[good.imageData,'image/jpeg'],[(await makeImage(200,200)).imageData,'image/png'],[(await makeImage(640,1200)).imageData,'image/png']])await assert.rejects(()=>normalizePublicationImage(data,mime));
});

test('Instagram requires a saved final image and caption and creates an encrypted local rehearsal without network calls',()=>withFixture(async f=>{
 const job=await f.service.create(f.input());assert.equal(job.platform,'instagram');assert.equal(job.image.width,640);assert.equal(job.image.bytes>0,true);assert.equal(job.image.data,undefined);
 await f.service.process(job.id,async()=>assert.fail('Rehearsal external check'));assert.equal(f.service.get(job.id).state,'rehearsed');assert.equal(f.calls.create,0);assert.equal(f.calls.publish,0);assert.equal(f.service.get(job.id).submittedAt,null);
 assert.doesNotMatch(JSON.stringify(f.service.workspace()),/private-page-token|private-user-token|signature=/);
 await assert.rejects(()=>new SocialPublications(f.db,f.other,KEY).create(f.input()),e=>e.status===404);assert.throws(()=>new SocialPublications(f.db,f.other,KEY).previewJobImage(job.id),e=>e.status===404);
 f.store.saveContent({...f.content,imageData:undefined},false);assert.equal(f.service.workspace().sources[0].eligible,false);await assert.rejects(()=>f.service.create(f.input()));
}));

test('Instagram scope, Page task and exact parent association are verified using existing Meta grant',()=>withFixture(async f=>{
 const {decryptCredentials}=load('credential-envelope.ts'),c=decryptCredentials(f.db.prepare('SELECT encrypted_credentials AS c FROM platform_connections WHERE id=?').get(f.ig.id).c,KEY,f.scope.organizationId,f.scope.projectId,f.ig.id),original=globalThis.fetch;
 function reply(url,options,broken=''){
  assert.equal(new URL(url).hostname,'graph.facebook.com');assert.ok(!url.includes('private-'));
  if(url.includes('/permissions'))return Response.json({data:['pages_show_list','pages_read_engagement','instagram_basic',...(broken==='scope'?[]:['instagram_content_publish'])].map(permission=>({permission,status:'granted'}))});
  const page={id:'100',access_token:'private-page-token',tasks:['CREATE_CONTENT'],instagram_business_account:{id:broken==='association'?'999':'300'}};
  return Response.json(url.includes('/accounts')?{data:[page]}:page);
 }
 try{globalThis.fetch=(url,options)=>reply(url,options);await f.service.check(f.ig.id);assert.equal(f.service.workspace().targets[0].ready,true);for(const broken of ['scope','association']){globalThis.fetch=(url,options)=>reply(url,options,broken);await assert.rejects(()=>f.service.check(f.ig.id));}assert.equal(c.metaPublishing.appId,'12345');}
 finally{globalThis.fetch=original;}
}));

test('two-stage worker persists one container, backs off processing and submits exactly once after FINISHED',()=>withFixture(async f=>{
 const job=await f.publish();await f.service.process(job.id,access);assert.equal(f.calls.create,1);assert.equal(f.calls.publish,0);assert.equal(f.service.get(job.id).state,'container_processing');assert.ok(f.service.get(job.id).nextCheckAt);assert.equal(f.media().width,640);
 await f.service.process(job.id,access);assert.equal(f.calls.status,0);f.due(job.id);f.adapter.status=async()=>{f.calls.status++;return 'IN_PROGRESS';};await f.service.process(job.id,access);assert.equal(f.calls.create,1);assert.equal(f.calls.publish,0);
 f.due(job.id);f.adapter.status=async()=>{f.calls.status++;return 'FINISHED';};await f.service.process(job.id,access);const done=f.service.get(job.id);assert.equal(done.state,'accepted');assert.equal(done.providerPostId,'800');assert.equal(done.providerUrl,'https://www.instagram.com/p/qaPost/');assert.ok(done.submittedAt);assert.equal(f.calls.publish,1);assert.throws(()=>f.media());await f.service.process(job.id,access);assert.equal(f.calls.publish,1);
}));

test('signed media is only available for active live preparation; forged, cross-job, expired, cancelled and revoked access fail closed',async()=>{
 for(const action of ['signature','job','expiry','cancel','revoke','source','role','gate'])await withFixture(async f=>{
  const job=await f.publish();await f.service.process(job.id,access);const u=new URL(f.url),signature=u.searchParams.get('signature');assert.ok(f.media().data);
  if(action==='signature')assert.throws(()=>providerPublicationImage(f.db,KEY,job.id,'0'.repeat(64)));
  if(action==='job')assert.throws(()=>providerPublicationImage(f.db,KEY,'00000000-0000-0000-0000-000000000000',signature));
  if(action==='expiry')f.db.prepare("UPDATE platform_social_publications SET preparation_started_at='2000-01-01T00:00:00Z' WHERE job_id=?").run(job.id);
  if(action==='cancel')f.service.cancel(job.id);if(action==='revoke')f.store.revokeConnection(f.ig.id);if(action==='source')f.store.saveContent({...f.content,content:'Changed after approval'},false);
  if(action==='role')f.db.prepare("UPDATE platform_memberships SET active=0 WHERE user_id=? AND organization_id=? AND project_id=?").run(f.scope.subject,f.scope.organizationId,f.scope.projectId);
  if(action==='gate')process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';
  if(!['signature','job'].includes(action))assert.throws(()=>f.media());
 });
});

test('container creation interruption or lost response cannot recreate a container or publish',async()=>{
 for(const action of ['lost','crash'])await withFixture(async f=>{
  const job=await f.publish();if(action==='lost')f.adapter.create=async()=>{f.calls.create++;throw new Error('private-provider-error');};
  else f.db.prepare("UPDATE platform_social_publications SET preparation_started_at=? WHERE job_id=?").run(new Date().toISOString(),job.id);
  await f.service.process(job.id,access);assert.equal(f.service.get(job.id).state,'uncertain');assert.equal(f.service.get(job.id).reason,'container_unknown');assert.equal(f.calls.publish,0);assert.equal(f.service.get(job.id).submittedAt,null);await f.service.process(job.id,access);assert.ok(f.calls.create<=1);
 });
});

test('cancellation during preparation or status reads prevents media_publish and revokes temporary media',async()=>{
 for(const phase of ['create','status'])await withFixture(async f=>{
  const job=await f.publish();let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  if(phase==='create')f.adapter.create=async()=>{entered();await gate;return '700';};else{await f.service.process(job.id,access);f.due(job.id);f.adapter.status=async()=>{entered();await gate;return 'FINISHED';};}
  const running=f.service.process(job.id,access);await started;f.service.cancel(job.id);release();await running;assert.equal(f.service.get(job.id).state,'cancelled');assert.equal(f.calls.publish,0);
 });
});

test('only one worker can create a container and ambiguous final POST is never retried',()=>withFixture(async f=>{
 const job=await f.publish();let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);f.adapter.create=async()=>{f.calls.create++;entered();await gate;return '700';};
 const running=f.service.process(job.id,access);await started;await f.service.process(job.id,access);release();await running;assert.equal(f.calls.create,1);f.due(job.id);f.adapter.publish=async(_t,_id,_c,reserve)=>{assert.equal(reserve(),true);f.calls.publish++;return {state:'uncertain',postId:null};};await f.service.process(job.id,access);await f.service.process(job.id,access);assert.equal(f.calls.publish,1);assert.equal(f.service.get(job.id).state,'uncertain');await assert.rejects(()=>f.publish({idempotencyKey:'another-unknown-intent'}),e=>e.status===409);
}));

test('ERROR, EXPIRED, time budget and polling cap do not publish and empty permalink is not fabricated',async()=>{
 for(const status of ['ERROR','EXPIRED','PUBLISHED','time','attempts'])await withFixture(async f=>{
  const job=await f.publish();await f.service.process(job.id,access);f.due(job.id);f.adapter.status=async()=>status;
  if(status==='time')f.db.prepare("UPDATE platform_social_publications SET preparation_started_at='2000-01-01T00:00:00Z' WHERE job_id=?").run(job.id);if(status==='attempts')f.db.prepare('UPDATE platform_jobs SET attempts=30 WHERE id=?').run(job.id);
  await f.service.process(job.id,access);assert.equal(f.calls.publish,0);assert.ok(['blocked','uncertain'].includes(f.service.get(job.id).state));
 });
});

test('Instagram adapter uses fixed URLs and exact caption/image, only reserves media_publish and accepts only safe receipt URLs',async()=>{
 config();const original=globalThis.fetch,calls=[];let reserved=0;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});assert.ok(!url.includes('private-token'));if(options.method==='POST'){const body=new URLSearchParams(options.body);if(url.endsWith('/media')){assert.equal(body.get('caption'),'Reviewed #caption');assert.ok(body.get('image_url').startsWith('https://app.ryzevo.com/api/platform/publication-media/'));return Response.json({id:'700'});}assert.equal(reserved,1);assert.equal(body.get('creation_id'),'700');return Response.json({id:'800'});}if(url.includes('status_code'))return Response.json({id:'700',status_code:'FINISHED'});return Response.json({id:'800',permalink:'https://evil.example/post'});};
 try{
  const container=await ig.instagramPublisher.create('private-token','300','Reviewed #caption',`https://app.ryzevo.com/api/platform/publication-media/00000000-0000-0000-0000-000000000000?signature=${'a'.repeat(64)}`);assert.equal(container,'700');assert.equal(await ig.instagramPublisher.status('private-token','700'),'FINISHED');const result=await ig.instagramPublisher.publish('private-token','300','700',()=>{reserved++;return true;});assert.equal(result.state,'accepted');assert.equal(result.postUrl,null);assert.equal(calls.filter(c=>c.options.method==='POST').length,2);assert.equal(ig.instagramPermalink('https://www.instagram.com/p/shortCode/'),'https://www.instagram.com/p/shortCode/');assert.equal(ig.instagramPermalink('https://www.instagram.com.evil/p/short/'),null);
  const n=calls.length;assert.equal((await ig.instagramPublisher.publish('private-token','300','700',()=>false)).state,'blocked');assert.equal(calls.length,n);
 }finally{globalThis.fetch=original;}
});

test('Instagram adapter classifies final HTTP/network/malformed outcomes without retrying; public origin is strict',async()=>{
 config();const original=globalThis.fetch;
 try{for(const [status,state] of [[403,'rejected'],[429,'rejected'],[500,'uncertain'],[200,'uncertain']]){globalThis.fetch=async()=>new Response('invalid response',{status});assert.equal((await ig.instagramPublisher.publish('token','300','700',()=>true)).state,state);}globalThis.fetch=async()=>{throw new Error();};assert.equal((await ig.instagramPublisher.publish('token','300','700',()=>true)).state,'uncertain');
  for(const origin of ['http://app.ryzevo.com','https://127.0.0.1','https://other.ryzevo.com','https://app.ryzevo.com/path','https://app.ryzevo.com/?q=1']){process.env.PLATFORM_PUBLIC_ORIGIN=origin;assert.throws(()=>ig.instagramPublishingConfiguration());}
 }finally{globalThis.fetch=original;config();}
});

test('migration21 is additive and repeatable, preserving old LinkedIn rehearsals and email work',()=>withFixture(async f=>{
 const {openPlatformDatabase}=load('database.ts'),{mkdtempSync}=require('node:fs'),path=require('node:path'),os=require('node:os'),file=path.join(mkdtempSync(path.join(os.tmpdir(),'ig-migration-')),'db.sqlite');
 const li=f.store.saveConnection({provider:'social',integrationId:'linkedin:old',accountName:'Old',accessToken:'token',social:{platform:'linkedin',accountId:'old'}},KEY);f.store.saveContent({...f.content,id:'old-li',platform:'linkedin',imageData:undefined,imageMime:undefined},true);const view=f.service.workspace(),source=view.sources.find(s=>s.id==='old-li'),job=f.service.enqueue({sourceKind:'content',sourceId:source.id,expectedDigest:source.digest,connectionId:li.id,expectedTargetRevision:view.targets.find(t=>t.id===li.id).revision,mode:'rehearsal',idempotencyKey:'old-li-migration'});
 require('./schema-fixture.cjs').removeInstagramSchema(f.db);await f.db.backup(file);let db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT image_bytes FROM platform_social_publications WHERE job_id=?').get(job.id).image_bytes,0);assert.equal(db.prepare('SELECT status FROM platform_jobs WHERE id=?').get(job.id).status,'queued');db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n,55);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
