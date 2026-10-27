const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SocialPublications}=load('social-publications.ts'),provider=load('x-publishing.ts'),{xConfiguration,xClient}=load('x-client.ts'),{ProjectXOAuth}=load('x-oauth.ts'),{decryptCredentials}=load('credential-envelope.ts'),{xText}=load('x-text.ts');
const {linkTag}=load('link-tracking.ts'),tagged=(scope,kind,id,url,source)=>`${url}?utm_source=${source}&utm_medium=social&utm_campaign=${linkTag(scope,kind,id)}`;
process.env.PLATFORM_X_CLIENT_ID='fixture-x-client';process.env.PLATFORM_X_CLIENT_SECRET='private-x-secret';process.env.PLATFORM_X_REDIRECT_URI='http://localhost:3033/api/platform/x/callback';
const social={platform:'twitter',accountId:'123'},access=async()=>({expiresAt:Date.now()+3600000});
function setup(){
 const f=fixture();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';
 f.x=f.store.saveConnection({provider:'social',integrationId:'x',accountName:'Fixture X',accessToken:'private-x-token',expiresAt:Date.now()+7200000,social},KEY,undefined,{configurationRevision:xConfiguration().revision,scopes:['tweet.read','users.read','tweet.write']});
 f.content={id:'x-source',platform:'twitter',language:'tr',headline:'X QA',content:'New from Ryzevo. https://example.com/long-link',timestamp:Date.now(),prompt:''};f.store.saveContent(f.content,true);
 f.service=new SocialPublications(f.db,f.scope,KEY);
 f.input=(patch={})=>({sourceKind:'content',sourceId:f.content.id,expectedDigest:f.service.workspace().sources.find(s=>s.id===f.content.id).digest,expectedTargetRevision:f.service.workspace().targets.find(t=>t.id===f.x.id).revision,connectionId:f.x.id,mode:'rehearsal',idempotencyKey:'x-fixture-intent',...patch});
 f.credentials=()=>decryptCredentials(f.db.prepare('SELECT encrypted_credentials AS value FROM platform_connections WHERE id=?').get(f.x.id).value,KEY,f.scope.organizationId,f.scope.projectId,f.x.id);
 f.publish=async(patch={})=>{process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.service.check(f.x.id,access);return f.service.enqueue(f.input({mode:'publish',acknowledged:true,...patch}));};return f;
}
const run=async fn=>{const f=setup();try{await fn(f);}finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}};

test('X weighted counter uses twitter-text for URLs, emoji, CJK, invalid characters and 280 limit',()=>{
 assert.equal(xText('a'.repeat(280)).valid,true);assert.equal(xText('a'.repeat(281)).valid,false);
 assert.equal(xText('https://example.com/'+'a'.repeat(500)).length,23);
 assert.equal(xText('\u{1f469}\u200d\u{1f4bb}').length,2);assert.equal(xText('\u754c'.repeat(140)).valid,true);assert.equal(xText('\u754c'.repeat(141)).valid,false);
 assert.equal(xText('  ').valid,false);assert.equal(xText('\ufffe').valid,false);assert.equal(xText('a'.repeat(10001)).valid,false);
});
test('X rehearsal reuses saved content, reveals weighted counter, and never contacts a provider',()=>run(async f=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Rehearsal contacted provider');
 try{const source=f.service.workspace().sources[0];assert.equal(source.weightedLength,xText(f.content.content).length);const job=f.service.enqueue(f.input({text:'untrusted'}));await f.service.process(job.id);assert.equal(f.service.get(job.id).state,'rehearsed');assert.equal(f.service.get(job.id).text,'New from Ryzevo. '+tagged(f.scope,'content',f.content.id,'https://example.com/long-link','x'));assert.equal(f.service.get(job.id).providerPostId,null);assert.equal(f.service.enqueue(f.input()).id,job.id);}
 finally{globalThis.fetch=original;}
 assert.doesNotMatch(JSON.stringify(f.service.workspace()),/private-x|xPublishing|scopes|configurationRevision/);
}));
test('X sources reject overlength, media and variables, and cannot target another channel',()=>run(async f=>{
 for(const patch of [{content:'x'.repeat(281)},{rawBgData:'image'},{content:'{{firstName}}'},{content:'bad\x00'}]){f.store.saveContent({...f.content,...patch},false);assert.equal(f.service.workspace().sources[0].eligible,false);assert.throws(()=>f.service.enqueue(f.input()),e=>e.status===409);}
 // One image is an X image post now; it still needs the verified image before it can be queued.
 f.store.saveContent({...f.content,imageData:'image'},false);assert.equal(f.service.workspace().sources[0].format,'image');assert.throws(()=>f.service.enqueue(f.input()),e=>e.status===409);
 f.store.saveContent(f.content,false);
 const li=f.store.saveConnection({provider:'social',integrationId:'li',accountName:'LinkedIn',accessToken:'other',social:{platform:'linkedin',accountId:'user'}},KEY);
 assert.throws(()=>f.service.enqueue(f.input({connectionId:li.id,expectedTargetRevision:f.service.workspace().targets.find(t=>t.id===li.id).revision})),e=>e.status===404);
 assert.throws(()=>new SocialPublications(f.db,f.other,KEY).enqueue(f.input()),e=>e.status===404);
}));
test('X campaign uses channel-specific text plus CTA without sending its other channels',()=>run(async f=>{
 const campaign={...f.campaign,id:'x-campaign',channels:{...f.campaign.channels,social:['twitter','linkedin']},content:{text:'Base',perPlatformContent:{twitter:'Specific X text',linkedin:'LinkedIn text'},ctaUrl:'https://example.com/start'}};f.store.saveCampaign(campaign,true);
 const source=f.service.workspace().sources.find(s=>s.kind==='campaign'&&s.platform==='twitter'),job=f.service.enqueue(f.input({sourceKind:'campaign',sourceId:source.id,expectedDigest:source.digest}));await f.service.process(job.id);
 assert.equal(f.service.get(job.id).text,'Specific X text\n\n'+tagged(f.scope,'campaign',campaign.id,'https://example.com/start','x'));assert.equal(f.store.campaign(campaign.id).status,'draft');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_pilots').get().n,0);
}));
test('X proof requires OAuth scope provenance, current app, valid expiry and exact user identity',()=>run(async f=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.x.com/2/users/me');assert.equal(options.headers.get('Authorization'),'Bearer private-x-token');assert.equal(options.redirect,'error');return Response.json({data:{id:'123'}});};
 try{
  await f.service.check(f.x.id);assert.equal(f.service.workspace().targets[0].ready,true);assert.equal(calls,1);
  const credentials=f.credentials();
  for(const patch of [{xPublishing:undefined},{xPublishing:{...credentials.xPublishing,scopes:['users.read']}},{xPublishing:{...credentials.xPublishing,configurationRevision:'0'.repeat(64)}},{expiresAt:1},{social:{...social,accountId:'999'}}])await assert.rejects(()=>provider.checkXPublishing('private-x-token','123',{...credentials,...patch}));
  assert.equal(calls,1);globalThis.fetch=async()=>Response.json({data:{id:'999'}});await assert.rejects(()=>f.service.check(f.x.id),e=>e.status===409&&!e.message.includes('private-'));assert.equal(f.service.workspace().targets[0].ready,false);
 }finally{globalThis.fetch=original;}
}));
test('manual token replacement cannot smuggle or retain X publishing provenance',()=>run(async f=>{
 f.store.saveConnection({provider:'social',integrationId:'ignored',accountName:'Manual',accessToken:'manual-token',social,xPublishing:f.credentials().xPublishing},KEY);
 assert.equal(f.credentials().xPublishing,undefined);const original=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Unproven token should fail locally');
 try{await assert.rejects(()=>f.service.check(f.x.id),e=>e.status===409);}finally{globalThis.fetch=original;}
}));
test('X adapter reserves once, sends exact text to a fixed endpoint and returns only a receipt',async()=>{
 const original=globalThis.fetch;let reservations=0,calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(reservations,1);assert.equal(url,'https://api.x.com/2/tweets');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer token');assert.deepEqual(JSON.parse(options.body),{text:'Exact text & #tag'});return Response.json({data:{id:'456',text:'Exact text & #tag'}},{status:201});};
 try{const result=await provider.publishXText('token','123','Exact text & #tag',()=>{reservations++;return true;});assert.equal(result.state,'accepted');assert.equal(result.postId,'456');assert.equal(calls,1);assert.equal((await provider.publishXText('token','123','text',()=>false)).state,'blocked');assert.equal(calls,1);assert.equal((await provider.publishXText('token','123','x'.repeat(281),()=>assert.fail())).state,'blocked');}
 finally{globalThis.fetch=original;}
});
test('X known rejections and unknown outcomes are distinct, bounded, and never retried',async()=>{
 const original=globalThis.fetch;
 try{for(const [response,expected] of [[Response.json({error:'private'},{status:403}),'rejected'],[Response.json({error:'billing'},{status:402}),'rejected'],[new Response('',{status:429}),'rejected'],[new Response('',{status:503}),'uncertain'],[Response.json({data:{id:'https://evil.test'}},{status:201}),'uncertain'],[new Response('x'.repeat(65537),{status:201}),'uncertain'],[Response.json({data:{id:'456'},errors:[{}]},{status:201}),'uncertain']]){let calls=0;globalThis.fetch=async()=>{calls++;return response;};assert.equal((await provider.publishXText('token','123','text',()=>true)).state,expected);assert.equal(calls,1);}
 globalThis.fetch=async()=>{throw new Error('private-token');};assert.equal((await provider.publishXText('token','123','text',()=>true)).state,'uncertain');}
 finally{globalThis.fetch=original;}
});
test('X queue settles receipt with a safe permalink, fences workers and deduplicates',()=>run(async f=>{
 const job=await f.publish();let release,entered,calls=0;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const active=f.service.process(job.id,access,async(token,id,text,reserve)=>{assert.equal(reserve(),true);calls++;entered();await gate;return {state:'accepted',postId:'456',postUrl:'https://evil.test'};});await started;await f.service.process(job.id,access,async()=>assert.fail('Second worker posted'));release();await active;
 const result=f.service.get(job.id);assert.equal(calls,1);assert.equal(result.state,'accepted');assert.equal(result.providerUrl,'https://x.com/i/status/456');assert.equal(result.impressions,undefined);assert.throws(()=>f.service.enqueue(f.input({mode:'publish',acknowledged:true,idempotencyKey:'duplicate-x'})),e=>e.status===409);
 await f.service.process(job.id,access,async()=>assert.fail('Accepted post retried'));
}));
test('X uncertain receipt never retries and ignores unsafe post IDs',()=>run(async f=>{
 const job=await f.publish();await f.service.process(job.id,access,async(t,a,b,reserve)=>{assert.equal(reserve(),true);return {state:'accepted',postId:'urn:li:share:123'};});assert.equal(f.service.get(job.id).state,'uncertain');assert.equal(f.service.get(job.id).providerUrl,null);await f.service.process(job.id,access,async()=>assert.fail('Unknown result retried'));
}));
test('X scheduled publishing cannot outlive its token and rehearsal does not execute early',()=>run(async f=>{
 process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.service.check(f.x.id,access);
 assert.throws(()=>f.service.enqueue(f.input({mode:'publish',acknowledged:true,scheduledAt:new Date(Date.now()+3*3600000).toISOString()})),e=>e.status===409);
 const job=f.service.enqueue(f.input({scheduledAt:new Date(Date.now()+3600000).toISOString()}));await f.service.process(job.id,async()=>assert.fail());assert.equal(f.service.get(job.id).state,'pending');assert.equal(f.service.cancel(job.id).state,'cancelled');
}));
test('X source edits, cancellation, revocation and app rotation during check prevent submission',async()=>{
 for(const action of ['source','cancel','app','revoke'])await run(async f=>{
  const job=await f.publish();let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const pending=f.service.process(job.id,async()=>{entered();await gate;return access();},async()=>assert.fail('Stale authorization posted'));await started;
  const old=process.env.PLATFORM_X_CLIENT_SECRET;
  if(action==='source')f.store.saveContent({...f.content,content:'Changed'},false);else if(action==='cancel')f.service.cancel(job.id);else if(action==='app')process.env.PLATFORM_X_CLIENT_SECRET='rotated';else f.store.revokeConnection(f.x.id);
  release();try{await pending;assert.equal(f.service.get(job.id).submittedAt,null);}finally{process.env.PLATFORM_X_CLIENT_SECRET=old;}
 });
});
test('X manager role loss while checking fences the manual runner before submission',()=>run(async f=>{
 const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'x-runner',password:'fixture-password-123',role:'admin'}),job=await f.publish();
 await f.service.process(job.id,async()=>{f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'viewer',true);return access();},async()=>assert.fail('Removed runner posted'),admin.userId);
 assert.equal(f.service.get(job.id).state,'blocked');assert.equal(f.service.get(job.id).submittedAt,null);
}));
test('X OAuth requests use S256 and least privilege, with no secret or offline scope in URL',()=>{
 const client=xClient();for(const publishing of [false,true]){const url=new URL(client.authorizationUrl('state','v'.repeat(43),publishing));assert.equal(url.origin,'https://x.com');assert.equal(url.pathname,'/i/oauth2/authorize');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('code_challenge').length,43);assert.equal(url.searchParams.get('scope').includes('tweet.write'),publishing);assert.ok(!url.href.includes('offline.access'));assert.ok(!url.href.includes('private-x-secret'));assert.ok(!url.href.includes('v'.repeat(43)));}
});
test('X token exchange uses private Basic auth, PKCE and validates actual returned scopes and expiry',async()=>{
 const original=globalThis.fetch,token={access_token:'private-grant-token',token_type:'bearer',expires_in:7200,scope:'tweet.read users.read tweet.write'};
 try{
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.x.com/2/oauth2/token');assert.match(options.headers.get('Authorization'),/^Basic /);assert.equal(new URLSearchParams(options.body).get('code_verifier'),'v'.repeat(43));assert.equal(new URLSearchParams(options.body).get('code'),'code');assert.equal(options.redirect,'error');return Response.json(token);};
  assert.equal((await xClient().exchange('code','v'.repeat(43))).scopes.includes('tweet.write'),true);
  for(const patch of [{token_type:'mac'},{expires_in:0},{expires_in:86401},{scope:'users.read'},{access_token:'bad\nvalue'}]){globalThis.fetch=async()=>Response.json({...token,...patch});await assert.rejects(()=>xClient().exchange('code','v'.repeat(43)));}
 }finally{globalThis.fetch=original;}
});
function oauthFixture(f,publishing,exchangePatch={}){
 let verifier;const client={revision:xConfiguration().revision,authorizationUrl:(state,v,p)=>{verifier=v;assert.equal(p,publishing);return `https://x.com/i/oauth2/authorize?state=${state}`;},exchange:async(code,v)=>{assert.equal(code,'code');assert.equal(v,verifier);return {accessToken:'private-oauth-token',expiresAt:Date.now()+7200000,scopes:['tweet.read','users.read',...(publishing?['tweet.write']:[])],...exchangePatch};}};
 return new ProjectXOAuth(f.db,f.scope,KEY,()=>client);
}
test('X OAuth stores grant only on explicit opt-in and consumes state exactly once',()=>run(async f=>{
 for(const publishing of [false,true]){const oauth=oauthFixture(f,publishing),start=oauth.start({accountName:'OAuth X',publishing}),state=new URL(start.authorizationUrl).searchParams.get('state');const connection=await oauth.complete(state,start.browser,'code',async()=>({data:{id:'123'}}));assert.equal(Boolean(f.credentials().xPublishing),publishing);assert.doesNotMatch(JSON.stringify(connection),/private-oauth|xPublishing/);await assert.rejects(()=>oauth.complete(state,start.browser,'code',async()=>assert.fail()));}
}));
test('X OAuth rejects cross-project state, wrong browser, missing write grant and revoke races',()=>run(async f=>{
 const oauth=oauthFixture(f,true),start=oauth.start({accountName:'X',publishing:true}),state=new URL(start.authorizationUrl).searchParams.get('state');
 await assert.rejects(()=>new ProjectXOAuth(f.db,f.other,KEY).complete(state,start.browser,'code'));
 await assert.rejects(()=>oauth.complete(state,'a'.repeat(43),'code'));await oauth.complete(state,start.browser,'code',async()=>({data:{id:'123'}}));
 const missing=oauthFixture(f,true,{scopes:['tweet.read','users.read']}),declined=missing.start({accountName:'X',publishing:true});await assert.rejects(()=>missing.complete(new URL(declined.authorizationUrl).searchParams.get('state'),declined.browser,'code',async()=>assert.fail()));
 const racing=oauthFixture(f,true),pending=racing.start({accountName:'X',publishing:true});await assert.rejects(()=>racing.complete(new URL(pending.authorizationUrl).searchParams.get('state'),pending.browser,'code',async()=>{f.store.revokeConnection(f.x.id);return {data:{id:'123'}};}));assert.equal(f.store.connections().find(c=>c.id===f.x.id).active,0);
}));
