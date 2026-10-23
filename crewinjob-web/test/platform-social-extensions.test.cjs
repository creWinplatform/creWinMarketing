const assert=require('node:assert/strict'),{test}=require('node:test'),sharp=require('sharp');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SocialPublications,providerPublicationImage}=load('social-publications.ts');
const {normalizePublicationImages}=load('publication-image.ts'),{instagramPublisher}=load('instagram-publishing.ts');
const {publishFacebookImage}=load('facebook-publishing.ts'),{readPublicationEngagement}=load('social-engagement.ts');
const access=async()=>({expiresAt:Date.now()+3600000});
Object.assign(process.env,{PLATFORM_META_APP_ID:'12345',PLATFORM_META_APP_SECRET:'fixture-meta-secret',PLATFORM_META_GRAPH_VERSION:'v25.0',PLATFORM_META_REDIRECT_URI:'https://app.ryzevo.com/api/platform/meta/callback',PLATFORM_PUBLIC_ORIGIN:'https://app.ryzevo.com',PLATFORM_SOCIAL_PUBLISH_ENABLED:'0'});
async function images(){return Promise.all(['#b9ed26','#20352a'].map(async color=>({data:(await sharp({create:{width:640,height:640,channels:3,background:color}}).png().toBuffer()).toString('base64'),mime:'image/png'})));}
async function setup(platform='instagram',adapter){
 const f=fixture();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';
 f.social={platform,accountId:platform==='instagram'?'300':'100',...(platform==='instagram'?{pageId:'100'}:{}),graphVersion:'v25.0'};
 f.connection=f.store.saveConnection({provider:'social',integrationId:`${platform}:${f.social.accountId}`,accountName:'Disposable QA',accessToken:'private-page-token',expiresAt:Date.now()+3600000,social:f.social},KEY,{appId:'12345',userAccessToken:'private-user-token'});
 f.media=await images();f.content={id:'extension-source',platform,language:'tr',headline:'Extension QA',content:'Reviewed caption',timestamp:Date.now(),prompt:'',...(platform==='instagram'?{images:f.media}:{imageData:f.media[0].data,imageMime:f.media[0].mime})};
 f.store.saveContent(f.content,true);f.service=new SocialPublications(f.db,f.scope,KEY,adapter);
 f.input=(patch={})=>{const v=f.service.workspace(),source=v.sources.find(s=>s.id===f.content.id),target=v.targets.find(t=>t.id===f.connection.id);return {sourceKind:'content',sourceId:source.id,expectedDigest:source.digest,expectedTargetRevision:target.revision,connectionId:target.id,mode:'rehearsal',idempotencyKey:'social-extension-fixture',...patch};};
 f.publish=async()=>{process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.service.check(f.connection.id,access);return f.service.create(f.input({mode:'publish',acknowledged:true}));};
 return f;
}
async function run(fn,platform='instagram',adapter){const f=await setup(platform,adapter);try{await fn(f);}finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}}

test('carousel normalization preserves order, bounds count and rejects remote or malformed media',async()=>{
 const raw=await images(),normalized=await normalizePublicationImages(raw);assert.equal(normalized.length,2);assert.notEqual(normalized[0].digest,normalized[1].digest);
 assert.equal((await sharp(Buffer.from(normalized[0].data,'base64')).metadata()).format,'jpeg');
 for(const invalid of [[],Array(6).fill(raw[0]),[{data:'https://evil.example/image',mime:'image/jpeg'}],[null]])await assert.rejects(()=>normalizePublicationImages(invalid));
});

test('carousel rehearsal reuses one queue record and exposes ordered previews without image bytes or external requests',()=>run(async f=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Rehearsal network');
 try{const source=f.service.workspace().sources[0];assert.equal(source.format,'carousel');assert.equal(source.imagePreviews.length,2);const job=await f.service.create(f.input());await f.service.process(job.id);const result=f.service.get(job.id);assert.equal(result.state,'rehearsed');assert.equal(result.images.length,2);assert.equal(result.images[0].data,undefined);assert.equal(result.image.previewUrl,result.images[0].previewUrl);assert.equal(result.engagement.status,'unsupported');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_jobs WHERE job_type=?').get('social.publish').n,1);assert.doesNotMatch(JSON.stringify(result),/private-|signature=/);}
 finally{globalThis.fetch=original;}
}));

test('carousel creates one parent, serves index-bound signed media and publishes only after ready',async()=>{
 let urls,creates=0,publishes=0;
 const adapter={create:async()=>assert.fail('Single-image path'),createCarousel:async(_t,_id,_text,items,valid)=>{assert.equal(valid(),true);urls=items;creates++;return '700';},status:async()=>'FINISHED',publish:async(_t,_id,_parent,reserve)=>{assert.equal(reserve(),true);publishes++;return {state:'accepted',postId:'800',postUrl:'https://www.instagram.com/p/carouselQa/'};}};
 await run(async f=>{
  const job=await f.publish();await f.service.process(job.id,access);assert.equal(creates,1);assert.equal(publishes,0);
  const a=new URL(urls[0]),b=new URL(urls[1]),sigA=a.searchParams.get('signature'),sigB=b.searchParams.get('signature');assert.notEqual(sigA,sigB);
  assert.notEqual(providerPublicationImage(f.db,KEY,job.id,sigA,0).digest,providerPublicationImage(f.db,KEY,job.id,sigB,1).digest);
  assert.throws(()=>providerPublicationImage(f.db,KEY,job.id,sigA,1));assert.throws(()=>f.service.previewJobImage(job.id,2));
  f.db.prepare('UPDATE platform_social_publications SET next_check_at=NULL WHERE job_id=?').run(job.id);await f.service.process(job.id,access);await f.service.process(job.id,access);assert.equal(publishes,1);assert.equal(f.service.get(job.id).state,'accepted');assert.throws(()=>providerPublicationImage(f.db,KEY,job.id,sigB,1));
 },'instagram',adapter);
});

test('carousel child preparation uses fixed endpoints and checks cancellation before each mutating request',async()=>{
 const original=globalThis.fetch,calls=[];let permitted=true;
 const urls=[0,1].map(index=>`https://app.ryzevo.com/api/platform/publication-media/00000000-0000-0000-0000-000000000000?signature=${'a'.repeat(64)}&index=${index}`);
 globalThis.fetch=async(url,init)=>{assert.equal(url,'https://graph.facebook.com/v25.0/300/media');calls.push(new URLSearchParams(init.body));assert.equal(init.headers.Authorization,'Bearer page-token');assert.equal(init.redirect,'error');return Response.json({id:String(700+calls.length)});};
 try{assert.equal(await instagramPublisher.createCarousel('page-token','300','Exact caption',urls,()=>permitted),'703');assert.equal(calls.length,3);assert.equal(calls[0].get('is_carousel_item'),'true');assert.equal(calls[0].get('caption'),null);assert.equal(calls[2].get('media_type'),'CAROUSEL');assert.equal(calls[2].get('children'),'701,702');assert.equal(calls[2].get('caption'),'Exact caption');
 calls.length=0;globalThis.fetch=async()=>{calls.push('request');permitted=false;return Response.json({id:'701'});};await assert.rejects(()=>instagramPublisher.createCarousel('page-token','300','Caption',urls,()=>permitted));assert.equal(calls.length,1);
 await assert.rejects(()=>instagramPublisher.createCarousel('page-token','300','Caption',[urls[0].replace('app.ryzevo.com','evil.example'),urls[1]],()=>true));assert.equal(calls.length,1);
 }finally{globalThis.fetch=original;}
});

test('ambiguous carousel preparation never retries children or final publication',async()=>{
 let count=0;
 const adapter={create:async()=>assert.fail(),createCarousel:async()=>{count++;throw new Error('private-error');},status:async()=>assert.fail(),publish:async()=>assert.fail()};
 await run(async f=>{const job=await f.publish();await f.service.process(job.id,access);await f.service.process(job.id,access);assert.equal(count,1);assert.equal(f.service.get(job.id).reason,'container_unknown');assert.equal(f.service.get(job.id).submittedAt,null);},'instagram',adapter);
});

test('Facebook photo worker reserves before multipart upload and stores only an account-bound post receipt',()=>run(async f=>{
 const original=globalThis.fetch;let posts=0;
 try{const job=await f.publish();globalThis.fetch=async(url,init)=>{posts++;assert.equal(url,'https://graph.facebook.com/v25.0/100/photos');assert.equal(init.body.get('caption'),'Reviewed caption');assert.equal(init.body.get('published'),'true');assert.equal(init.body.get('source').type,'image/jpeg');assert.equal(init.headers['Content-Type'],undefined);assert.ok(f.service.get(job.id).submittedAt);return Response.json({id:'777',post_id:'100_777'});};await f.service.process(job.id,access);await f.service.process(job.id,access);assert.equal(posts,1);assert.equal(f.service.get(job.id).providerPostId,'100_777');assert.equal(f.service.get(job.id).format,'image');}
 finally{globalThis.fetch=original;}
},'facebook'));

test('Facebook photo upload never sends on failed reservation and treats missing or wrong-Page receipts as uncertain',async()=>{
 const image=(await normalizePublicationImages(await images()))[0],original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;return Response.json({id:'777'});};assert.equal((await publishFacebookImage('token','100','Caption',image,()=>false)).state,'blocked');assert.equal(calls,0);assert.equal((await publishFacebookImage('token','100','Caption',image,()=>true)).state,'uncertain');globalThis.fetch=async()=>Response.json({post_id:'999_777'});assert.equal((await publishFacebookImage('token','100','Caption',image,()=>true)).state,'uncertain');}
 finally{globalThis.fetch=original;}
});

async function accepted(f){f.store.saveContent({...f.content,imageData:undefined,imageMime:undefined},false);const job=await f.publish();await f.service.process(job.id,access,async(_t,_a,_text,reserve)=>{assert.equal(reserve(),true);return {state:'accepted',postId:'100_555'};});assert.equal(f.service.get(job.id).state,'accepted');return job;}
test('metrics store measured zero, omit unavailable counters and preserve last success on refresh failure',()=>run(async f=>{
 const job=await accepted(f);assert.equal(f.service.get(job.id).engagement.status,'not_requested');
 const measured=await f.service.refreshEngagement(job.id,async()=>({likes:0,comments:7,shares:2}));assert.equal(measured.engagement.counts.likes,0);assert.equal(measured.engagement.counts.impressions,undefined);assert.ok(measured.engagement.observedAt);
 await f.service.refreshEngagement(job.id,async()=>assert.fail('Cooldown'));f.db.prepare("UPDATE platform_social_engagement SET attempted_at='2000-01-01T00:00:00Z' WHERE job_id=?").run(job.id);
 const failed=await f.service.refreshEngagement(job.id,async()=>{throw new Error('private-provider-payload');});assert.equal(failed.engagement.status,'unavailable');assert.equal(failed.engagement.counts.comments,7);assert.equal(failed.engagement.observedAt,measured.engagement.observedAt);assert.doesNotMatch(JSON.stringify(failed),/private-provider|private-page-token/);
},'facebook'));

test('metric refresh is tenant/role scoped, fenced while concurrent and bounded by daily quota',()=>run(async f=>{
 const job=await accepted(f);await assert.rejects(()=>new SocialPublications(f.db,f.other,KEY).refreshEngagement(job.id),e=>e.status===404);
 const user=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'metrics-viewer',password:'fixture-password-123',role:'viewer'}),viewer=new SocialPublications(f.db,{...f.scope,subject:user.userId},KEY);await assert.rejects(()=>viewer.refreshEngagement(job.id),e=>e.status===403);assert.equal(viewer.get(job.id).engagement.status,'not_requested');
 let release,entered,calls=0;const gate=new Promise(r=>release=r),start=new Promise(r=>entered=r);const first=f.service.refreshEngagement(job.id,async()=>{calls++;entered();await gate;return {likes:4};});await start;assert.equal((await f.service.refreshEngagement(job.id,async()=>assert.fail('Concurrent read'))).engagement.status,'refreshing');release();await first;assert.equal(calls,1);
 f.db.prepare("UPDATE platform_social_engagement SET attempted_at='2000-01-01' WHERE job_id=?").run(job.id);f.db.prepare("UPDATE platform_usage SET count=100 WHERE resource='social_metrics'").run();await assert.rejects(()=>f.service.refreshEngagement(job.id,async()=>assert.fail('Over quota')),e=>e.status===429);
},'facebook'));

test('provider metric counters reject wrong authors and do not follow URLs or manufacture missing metrics',async()=>{
 const original=globalThis.fetch,credentials={accessToken:'private-page-token',expiresAt:Date.now()+3600000,social:{platform:'facebook',accountId:'100',graphVersion:'v25.0'}};
 try{globalThis.fetch=async(url,init)=>{assert.equal(init.method,'GET');assert.equal(new URL(url).hostname,'graph.facebook.com');assert.equal(init.redirect,'error');assert.ok(!url.includes('private-'));return Response.json({id:'100_555',from:{id:'100'},reactions:{summary:{total_count:0}},comments:{summary:{total_count:2}}});};const input={platform:'facebook',accountId:'100',postId:'100_555',credentials},counts=await readPublicationEngagement(input);assert.equal(counts.likes,0);assert.equal(counts.comments,2);assert.equal(counts.shares,undefined);
 globalThis.fetch=async()=>Response.json({id:'100_555',from:{id:'999'},reactions:{summary:{total_count:999}}});await assert.rejects(()=>readPublicationEngagement(input));
 globalThis.fetch=async()=>assert.fail('Invalid receipt');await assert.rejects(()=>readPublicationEngagement({...input,postId:'https://evil.example'}));
 }finally{globalThis.fetch=original;}
});

test('Instagram media metrics require exact owner and keep missing impressions absent',async()=>{
 const original=globalThis.fetch,input={platform:'instagram',accountId:'300',postId:'800',credentials:{accessToken:'token',expiresAt:Date.now()+3600000,social:{platform:'instagram',accountId:'300',pageId:'100',graphVersion:'v25.0'}}};
 try{globalThis.fetch=async()=>Response.json({id:'800',owner:{id:'300'},like_count:6,comments_count:0});const value=await readPublicationEngagement(input);assert.equal(value.likes,6);assert.equal(value.comments,0);assert.equal(value.impressions,undefined);globalThis.fetch=async()=>Response.json({id:'800',owner:{id:'999'},like_count:6});await assert.rejects(()=>readPublicationEngagement(input));}
 finally{globalThis.fetch=original;}
});

test('X metrics verify OAuth identity, exact author and only documented public counters',async()=>{
 Object.assign(process.env,{PLATFORM_X_CLIENT_ID:'fixture-x-app',PLATFORM_X_CLIENT_SECRET:'fixture-x-secret',PLATFORM_X_REDIRECT_URI:'http://localhost:3033/api/platform/x/callback'});
 const original=globalThis.fetch,{xConfiguration}=load('x-client.ts'),credentials={accessToken:'token',expiresAt:Date.now()+3600000,social:{platform:'twitter',accountId:'123'},xPublishing:{configurationRevision:xConfiguration().revision,scopes:['tweet.read','users.read','tweet.write']}};
 try{globalThis.fetch=async(url,init)=>{assert.notEqual(init.method,'POST');return Response.json(url.includes('/users/me')?{data:{id:'123'}}:{data:{id:'456',author_id:'123',public_metrics:{like_count:1,reply_count:2,retweet_count:3,quote_count:4}}});};
 const value=await readPublicationEngagement({platform:'twitter',accountId:'123',postId:'456',credentials});assert.equal(value.likes,1);assert.equal(value.quotes,4);assert.equal(value.impressions,undefined);
 globalThis.fetch=async(url)=>Response.json(url.includes('/users/me')?{data:{id:'123'}}:{data:{id:'456',author_id:'999',public_metrics:{like_count:500}}});await assert.rejects(()=>readPublicationEngagement({platform:'twitter',accountId:'123',postId:'456',credentials}));
 }finally{globalThis.fetch=original;}
});

test('LinkedIn organization analytics are explicit opt-in, verify role and post ownership, never substitute account aggregates',async()=>{
 Object.assign(process.env,{PLATFORM_LINKEDIN_CLIENT_ID:'fixture-li-app',PLATFORM_LINKEDIN_CLIENT_SECRET:'fixture-li-secret',PLATFORM_LINKEDIN_REDIRECT_URI:'http://localhost:3033/api/platform/social/callback',PLATFORM_LINKEDIN_API_VERSION:'202609'});
 const original=globalThis.fetch,postId='urn:li:share:456',owner='urn:li:organization:100',input={platform:'linkedin',accountId:'100',accountType:'organization',postId,credentials:{accessToken:'token',expiresAt:Date.now()+3600000,social:{platform:'linkedin',accountId:'100',accountType:'organization'}}};
 try{
  process.env.PLATFORM_LINKEDIN_ANALYTICS_ENABLED='0';globalThis.fetch=async()=>assert.fail('Disabled analytics');await assert.rejects(()=>readPublicationEngagement(input));
  const {linkedinClient}=load('linkedin-client.ts');assert.ok(!new URL(linkedinClient().authorizationUrl('state',false,'organization')).searchParams.get('scope').split(' ').includes('r_organization_social'));
  process.env.PLATFORM_LINKEDIN_ANALYTICS_ENABLED='1';assert.ok(new URL(linkedinClient().authorizationUrl('state',false,'organization')).searchParams.get('scope').split(' ').includes('r_organization_social'));
  let aggregate=false;
  globalThis.fetch=async(url,init)=>{
   if(url.includes('/introspectToken'))return Response.json({active:true,status:'active',auth_type:'3L',client_id:'fixture-li-app',scope:'r_organization_social',expires_at:Math.floor(Date.now()/1000)+3600});
   assert.equal(new Headers(init.headers).get('LinkedIn-Version'),'202609');
   if(url.includes('/organizationAcls'))return Response.json({paging:{start:0,count:25},elements:[{organization:owner,role:'ADMINISTRATOR',roleAssignee:'urn:li:person:member',state:'APPROVED'}]});
   if(url.includes('/posts/'))return Response.json({author:owner});
   assert.equal(new URL(url).searchParams.get('shares[0]'),postId);return Response.json({elements:[{organizationalEntity:owner,...(!aggregate?{share:postId}:{}),totalShareStatistics:{likeCount:2,commentCount:0,impressionCount:10,clickCount:1}}]});
  };
  const result=await readPublicationEngagement(input);assert.equal(result.impressions,10);assert.equal(result.comments,0);aggregate=true;await assert.rejects(()=>readPublicationEngagement(input));
 }finally{globalThis.fetch=original;process.env.PLATFORM_LINKEDIN_ANALYTICS_ENABLED='0';}
});

test('connection replacement during metric refresh discards the in-flight result',()=>run(async f=>{
 const job=await accepted(f);let release,entered;const wait=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const pending=f.service.refreshEngagement(job.id,async()=>{entered();await wait;return {likes:999};});await started;
 f.store.saveConnection({id:f.connection.id,provider:'social',integrationId:'facebook:100',accountName:'Replacement',accessToken:'rotated-private-token',expiresAt:Date.now()+3600000,social:f.social},KEY);release();
 const result=await pending;assert.equal(result.engagement.status,'unavailable');assert.equal(result.engagement.counts.likes,undefined);
},'facebook'));

test('historical receipts can refresh after token renewal for the same account, without republishing',()=>run(async f=>{
 const job=await accepted(f);
 f.store.saveConnection({id:f.connection.id,provider:'social',integrationId:'facebook:100',accountName:'Renewed Page',accessToken:'new-private-token',expiresAt:Date.now()+3600000,social:f.social},KEY);
 const value=await f.service.refreshEngagement(job.id,async input=>{assert.equal(input.credentials.accessToken,'new-private-token');assert.equal(input.postId,'100_555');return {likes:3};});
 assert.equal(value.engagement.counts.likes,3);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_jobs WHERE job_type='social.publish'").get().n,1);
},'facebook'));

test('schema28 is additive, repeatable and preserves published jobs across reopen',()=>run(async f=>{
 const job=await accepted(f),{openPlatformDatabase}=load('database.ts'),path=require('node:path'),fs=require('node:fs'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'social-schema-')),'fixture.sqlite');
 require('./schema-fixture.cjs').removeEngagementSchema(f.db);assert.equal(f.db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,27);await f.db.backup(file);
 let db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,56);assert.equal(db.prepare('SELECT state FROM platform_social_publications WHERE job_id=?').get(job.id).state,'accepted');assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_social_engagement').get().n,0);db.close();db=openPlatformDatabase(file);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);db.close();
},'facebook'));
