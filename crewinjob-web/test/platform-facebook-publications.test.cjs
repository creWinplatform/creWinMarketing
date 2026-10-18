const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SocialPublications}=load('social-publications.ts'),provider=load('facebook-publishing.ts'),{decryptCredentials,encryptCredentials}=load('credential-envelope.ts');
process.env.PLATFORM_META_APP_ID='12345';process.env.PLATFORM_META_APP_SECRET='fixture-meta-secret';process.env.PLATFORM_META_GRAPH_VERSION='v25.0';process.env.PLATFORM_META_REDIRECT_URI='http://localhost:3033/api/platform/meta/callback';
const grant={userAccessToken:'private-user-token',appId:'12345'},social={platform:'facebook',accountId:'100',graphVersion:'v25.0'},access=async()=>({expiresAt:Date.now()+3600000});
function setup(){
 const f=fixture();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';
 f.fb=f.store.saveConnection({provider:'social',integrationId:'facebook:100',accountName:'Fixture Page',accessToken:'private-page-token',expiresAt:Date.now()+86400000,social},KEY,grant);
 f.content={id:'fb-source',platform:'facebook',language:'tr',content:'Public Page update. #Ryzevo',headline:'Facebook QA',timestamp:Date.now(),prompt:''};f.store.saveContent(f.content,true);
 f.service=new SocialPublications(f.db,f.scope,KEY);
 f.input=(patch={})=>({sourceKind:'content',sourceId:f.content.id,connectionId:f.fb.id,expectedDigest:f.service.workspace().sources.find(s=>s.id===f.content.id).digest,expectedTargetRevision:f.service.workspace().targets.find(s=>s.id===f.fb.id).revision,mode:'rehearsal',idempotencyKey:'facebook-fixture-intent',...patch});
 f.credentials=()=>decryptCredentials(f.db.prepare('SELECT encrypted_credentials AS value FROM platform_connections WHERE id=?').get(f.fb.id).value,KEY,f.scope.organizationId,f.scope.projectId,f.fb.id);
 f.publish=async(patch={})=>{process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.service.check(f.fb.id,access);return f.service.enqueue(f.input({mode:'publish',acknowledged:true,...patch}));};return f;
}
async function withFixture(fn){const f=setup();try{await fn(f);}finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}}
function reply(url,options,patch={}){
 assert.equal(new URL(url).origin,'https://graph.facebook.com');assert.equal(options.redirect,'error');assert.ok(!url.includes('private-'));
 if(url.includes('/me/permissions'))return Response.json({data:['pages_show_list','pages_read_engagement','pages_manage_posts'].map(permission=>({permission,status:'granted'})),...patch.permissions});
 if(url.includes('/me/accounts'))return Response.json({data:[{id:'100',access_token:'private-page-token',tasks:['CREATE_CONTENT'],...patch.page}],...patch.accounts});
 return Response.json({id:'100',...patch.identity});
}

test('Facebook rehearsal reuses queue and saved content, never calls a provider and keeps credentials private',()=>withFixture(async f=>{
 const job=f.service.enqueue(f.input());await f.service.process(job.id,async()=>assert.fail('External check'),async()=>assert.fail('External post'));
 const value=f.service.get(job.id);assert.equal(value.platform,'facebook');assert.equal(value.state,'rehearsed');assert.equal(value.submittedAt,null);assert.equal(value.providerUrl,null);
 assert.equal(f.service.workspace().targets[0].configured,true);assert.doesNotMatch(JSON.stringify(f.service.workspace()),/private-user-token|private-page-token|fixture-meta-secret/);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_content_history WHERE id=?').get(f.content.id).n,1);
 assert.throws(()=>new SocialPublications(f.db,f.other,KEY).enqueue(f.input()),e=>e.status===404);
}));

test('each saved campaign channel has a separate preview; a Facebook source cannot publish to LinkedIn',()=>withFixture(async f=>{
 const li=f.store.saveConnection({provider:'social',integrationId:'linkedin:user',accountName:'LinkedIn',accessToken:'li-token',social:{platform:'linkedin',accountId:'user'}},KEY);
 const liTarget=f.service.workspace().targets.find(t=>t.id===li.id);assert.throws(()=>f.service.enqueue(f.input({connectionId:li.id,expectedTargetRevision:liTarget.revision})),e=>e.status===404);
 const c={...f.campaign,id:'multichannel',channels:{...f.campaign.channels,social:['facebook','linkedin']},content:{text:'Base',perPlatformContent:{facebook:'Page text',linkedin:'Member text'},ctaUrl:'https://example.com/start'}};f.store.saveCampaign(c,true);
 const previews=f.service.workspace().sources.filter(s=>s.id===c.id);assert.equal(previews.length,2);assert.notEqual(previews[0].digest,previews[1].digest);
 const fb=previews.find(s=>s.platform==='facebook'),job=f.service.enqueue(f.input({sourceKind:'campaign',sourceId:c.id,expectedDigest:fb.digest}));await f.service.process(job.id);
 assert.equal(f.service.get(job.id).text,'Page text\n\nhttps://example.com/start');assert.equal(f.store.campaign(c.id).status,'draft');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_pilots').get().n,0);
}));

test('Facebook permission proof checks current scopes, Page task, Page token and exact identity with no tokens in URLs',()=>withFixture(async f=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push([url,options]);return reply(url,options);};
 try{await f.service.check(f.fb.id);assert.equal(f.service.workspace().targets[0].ready,true);assert.equal(calls.length,3);assert.equal(calls[0][1].headers.get('Authorization'),'Bearer private-user-token');assert.equal(calls[2][1].headers.get('Authorization'),'Bearer private-page-token');assert.ok(new URL(calls[1][0]).searchParams.get('fields').includes('tasks'));globalThis.fetch=async(url,options)=>reply(url,options,{page:{tasks:['PROFILE_PLUS_CREATE_CONTENT']}});await f.service.check(f.fb.id);assert.equal(f.service.workspace().targets[0].ready,true);}
 finally{globalThis.fetch=original;}
}));

test('Facebook proof fails closed for missing scope/task, token rotation, mismatched identity/app/version and expired grant',()=>withFixture(async f=>{
 const original=globalThis.fetch,credentials=f.credentials();
 try{
  for(const patch of [{permissions:{data:[]}},{page:{tasks:['ANALYZE']}},{page:{access_token:'rotated'}},{identity:{id:'999'}},{accounts:{data:[]}}]){
   globalThis.fetch=async(url,options)=>reply(url,options,patch);await assert.rejects(()=>f.service.check(f.fb.id),e=>e.status===409&&!e.message.includes('private-'));assert.equal(f.service.workspace().targets[0].ready,false);
  }
  globalThis.fetch=async()=>assert.fail('Invalid grant should not make a request');
  for(const altered of [{...credentials,metaPublishing:undefined},{...credentials,metaPublishing:{...grant,appId:'999'}},{...credentials,social:{...social,graphVersion:'v24.0'}},{...credentials,expiresAt:1}])await assert.rejects(()=>provider.checkFacebookPublishing('private-page-token','100',altered));
 }finally{globalThis.fetch=original;}
}));

test('Page lookup handles only bounded safe cursors, never follows provider next URLs and fails at its 200-Page cap',()=>withFixture(async f=>{
 const original=globalThis.fetch,calls=[];let count=0;
 try{
  globalThis.fetch=async(url,options)=>{calls.push(url);if(!url.includes('/me/accounts'))return reply(url,options);return new URL(url).searchParams.has('after')?reply(url,options):Response.json({data:[],paging:{next:'https://evil.example/?access_token=private-token',cursors:{after:'safe-cursor'}}});};
  await f.service.check(f.fb.id);assert.ok(calls.every(url=>new URL(url).hostname==='graph.facebook.com'));assert.ok(calls.some(url=>new URL(url).searchParams.get('after')==='safe-cursor'));
  globalThis.fetch=async(url,options)=>url.includes('/me/accounts')?(count++,Response.json({data:[],paging:{next:'https://evil.example',cursors:{after:`cursor-${count}`}}})):reply(url,options);
  await assert.rejects(()=>f.service.check(f.fb.id));assert.equal(count,4);
  globalThis.fetch=async(url,options)=>url.includes('/me/accounts')?Response.json({data:[],paging:{next:'ignored',cursors:{after:'same'}}}):reply(url,options);await assert.rejects(()=>f.service.check(f.fb.id));
 }finally{globalThis.fetch=original;}
}));

test('Facebook default processor revalidates permission, reserves before one Page feed POST and stores real receipt only',()=>withFixture(async f=>{
 const job=await f.publish(),original=globalThis.fetch;let posts=0;
 globalThis.fetch=async(url,options)=>{
  if(options.method!=='POST')return reply(url,options);
  posts++;assert.equal(url,'https://graph.facebook.com/v25.0/100/feed');assert.equal(options.headers.Authorization,'Bearer private-page-token');assert.equal(new URLSearchParams(options.body).get('message'),f.content.content);
  assert.ok(f.service.get(job.id).submittedAt);return Response.json({id:'100_98765'});
 };
 try{await f.service.process(job.id);await f.service.process(job.id);const result=f.service.get(job.id);assert.equal(result.state,'accepted');assert.equal(result.providerPostId,'100_98765');assert.equal(result.providerUrl,'https://www.facebook.com/100_98765');assert.equal(posts,1);assert.equal(result.impressions,undefined);}
 finally{globalThis.fetch=original;}
}));

test('Facebook no longer granted at execution never posts; cancellation and edited source also block before reservation',async()=>{
 for(const change of ['permission','cancel','content','config'])await withFixture(async f=>{
  const job=await f.publish(),original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{if(change==='cancel')f.service.cancel(job.id);if(change==='content')f.store.saveContent({...f.content,content:'Updated'},false);if(change==='config')process.env.PLATFORM_META_APP_SECRET='changed-secret';return reply(url,options,change==='permission'?{permissions:{data:[]}}:{});};
  try{await f.service.process(job.id,undefined,async()=>assert.fail('Must not POST'));assert.equal(f.service.get(job.id).submittedAt,null);assert.ok(['blocked','cancelled'].includes(f.service.get(job.id).state));}
  finally{globalThis.fetch=original;process.env.PLATFORM_META_APP_SECRET='fixture-meta-secret';}
 });
});

test('Facebook ambiguous acceptance is terminal, receipt must belong to selected Page and cannot be automatically retried',()=>withFixture(async f=>{
 const job=await f.publish();let posts=0;await f.service.process(job.id,access,async(_token,_account,_text,reserve)=>{assert.equal(reserve(),true);posts++;return {state:'accepted',postId:'999_123'};});assert.equal(f.service.get(job.id).state,'uncertain');assert.equal(f.service.get(job.id).providerPostId,null);
 await f.service.process(job.id,access,async()=>assert.fail('Retried ambiguous post'));assert.equal(posts,1);assert.throws(()=>f.service.enqueue(f.input({mode:'publish',acknowledged:true,idempotencyKey:'duplicate-facebook-text'})),e=>e.status===409);
}));

test('Facebook adapter classifies known rejection and unknown outcomes, bounds receipts and never calls fetch after failed reservation',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;return Response.json({id:'100_12'});};assert.equal((await provider.publishFacebookText('token','100','Plain #text',()=>false)).state,'blocked');assert.equal(calls,0);
  assert.equal((await provider.publishFacebookText('token','100','Plain #text',()=>true)).state,'accepted');
  for(const status of [400,401,403,429,500,503]){globalThis.fetch=async()=>new Response('private response',{status});assert.equal((await provider.publishFacebookText('token','100','Plain text',()=>true)).state,status<500?'rejected':'uncertain');}
  for(const data of [{id:'999_123'},{id:'urn:li:share:1'},{id:'100_1',error:{}},{success:true}]){globalThis.fetch=async()=>Response.json(data);assert.equal((await provider.publishFacebookText('token','100','Plain text',()=>true)).state,'uncertain');}
  globalThis.fetch=async()=>new Response('x'.repeat(65537));assert.equal((await provider.publishFacebookText('token','100','Plain text',()=>true)).state,'uncertain');
  globalThis.fetch=async()=>{throw new Error('lost response');};assert.equal((await provider.publishFacebookText('token','100','Plain text',()=>true)).state,'uncertain');
 }finally{globalThis.fetch=original;}
});

test('Meta OAuth is read-only by default; explicit Facebook opt-in persists encrypted user grant only after Page selection',()=>withFixture(async f=>{
 const {metaClient}=load('meta-client.ts'),{ProjectMetaOAuth}=load('meta-oauth.ts'),client=metaClient();
 assert.ok(!new URL(client.authorizationUrl('state','facebook')).searchParams.get('scope').includes('pages_manage_posts'));assert.ok(new URL(client.authorizationUrl('state','facebook',true)).searchParams.get('scope').includes('pages_manage_posts'));assert.ok(!new URL(client.authorizationUrl('state','instagram',true)).searchParams.get('scope').includes('pages_manage_posts'));
 const factory=()=>({appId:'12345',graphVersion:'v25.0',authorizationUrl:(state)=>`https://www.facebook.com/?state=${state}`,exchange:async()=>({accessToken:grant.userAccessToken,expiresAt:Date.now()+3600000})});
 const oauth=new ProjectMetaOAuth(f.db,f.scope,KEY,factory,async()=>({data:[{id:'100',name:'Fixture Page',access_token:'private-page-token'}]}));
 assert.ok(oauth.start('instagram',true).authorizationUrl);assert.throws(()=>oauth.start('facebook','true'));
 for(const publishing of [false,true]){
  const start=oauth.start('facebook',publishing),cookie=await oauth.complete(new URL(start.authorizationUrl).searchParams.get('state'),start.browser,'code'),selection=await oauth.list(cookie);
  assert.equal(selection.publishing,publishing);assert.doesNotMatch(JSON.stringify(selection),/private-|userAccessToken|appId/);const connection=await oauth.select(cookie,'100');
  const row=f.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(connection.id);assert.ok(!row.encrypted_credentials.includes('private-user-token'));const secret=decryptCredentials(row.encrypted_credentials,KEY,f.scope.organizationId,f.scope.projectId,connection.id);assert.equal(Boolean(secret.metaPublishing),publishing);
  await assert.rejects(()=>oauth.select(cookie,'100'));
 }
}));

test('existing LinkedIn snapshots without a platform field remain readable and run without migration',()=>withFixture(async f=>{
 const connection=f.store.saveConnection({provider:'social',integrationId:'linkedin:old',accountName:'Old LI',accessToken:'old-token',social:{platform:'linkedin',accountId:'old'}},KEY),content={...f.content,id:'old-li',platform:'linkedin'};f.store.saveContent(content,true);
 const view=f.service.workspace(),job=f.service.enqueue(f.input({sourceId:content.id,connectionId:connection.id,expectedDigest:view.sources.find(s=>s.id===content.id).digest,expectedTargetRevision:view.targets.find(t=>t.id===connection.id).revision}));
 const row=f.db.prepare('SELECT encrypted_snapshot FROM platform_social_publications WHERE job_id=?').get(job.id),snapshot=decryptCredentials(row.encrypted_snapshot,KEY,f.scope.organizationId,f.scope.projectId,`publication:${job.id}`);delete snapshot.platform;
 f.db.prepare('UPDATE platform_social_publications SET encrypted_snapshot=? WHERE job_id=?').run(encryptCredentials(snapshot,KEY,f.scope.organizationId,f.scope.projectId,`publication:${job.id}`),job.id);
 await f.service.process(job.id);assert.equal(f.service.get(job.id).platform,'linkedin');assert.equal(f.service.get(job.id).state,'rehearsed');assert.equal(f.db.pragma('integrity_check',{simple:true}),'ok');assert.equal(f.db.pragma('foreign_key_check').length,0);
}));
