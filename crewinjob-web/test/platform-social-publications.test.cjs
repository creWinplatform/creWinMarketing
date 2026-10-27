const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SocialPublications}=load('social-publications.ts'),provider=load('linkedin-publishing.ts');
const {linkTag}=load('link-tracking.ts'),tagged=(scope,kind,id,url,source)=>`${url}?utm_source=${source}&utm_medium=social&utm_campaign=${linkTag(scope,kind,id)}`;
process.env.PLATFORM_LINKEDIN_CLIENT_ID='fixture-client';process.env.PLATFORM_LINKEDIN_CLIENT_SECRET='private-fixture-secret';process.env.PLATFORM_LINKEDIN_REDIRECT_URI='http://localhost:3033/api/platform/social/callback';process.env.PLATFORM_LINKEDIN_API_VERSION='202609';
const access=async()=>({expiresAt:Date.now()+3600000});
function setup(){
 const f=fixture();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';
 f.connectionSocial=f.store.saveConnection({provider:'social',integrationId:'unused-client-id',accountName:'Fixture LinkedIn',accessToken:'private-social-token',expiresAt:Date.now()+86400000,social:{platform:'linkedin',accountId:'fixture_member'}},KEY);
 f.content={id:'social-draft',platform:'linkedin',language:'tr',content:'Useful public update. #Ryzevo',headline:'Social QA',prompt:'',timestamp:Date.now()};f.store.saveContent(f.content,true);
 f.social=new SocialPublications(f.db,f.scope,KEY);
 f.input=(overrides={})=>({sourceKind:'content',sourceId:f.content.id,connectionId:f.connectionSocial.id,expectedDigest:f.social.workspace().sources.find(item=>item.id===f.content.id).digest,expectedTargetRevision:f.social.workspace().targets.find(item=>item.id===f.connectionSocial.id).revision,mode:'rehearsal',idempotencyKey:'social-fixture-intent',...overrides});
 f.publish=async(overrides={})=>{process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.social.check(f.connectionSocial.id,access);return f.social.enqueue(f.input({mode:'publish',acknowledged:true,...overrides}));};
 return f;
}
const close=async fn=>{const f=setup();try{await fn(f);}finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}};

test('local rehearsal reuses content and queue, is idempotent and never contacts the provider',()=>close(async f=>{
 const input=f.input({text:'untrusted replacement',providerPostId:'fabricated'}),job=f.social.enqueue(input);assert.equal(f.social.enqueue(input).id,job.id);
 await f.social.process(job.id,async()=>assert.fail('Rehearsal checked external grant'),async()=>assert.fail('Rehearsal posted'));
 const result=f.social.get(job.id);assert.equal(result.state,'rehearsed');assert.equal(result.text,f.content.content);assert.equal(result.providerPostId,null);assert.equal(result.submittedAt,null);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM platform_content_history WHERE id='social-draft'").get().n,1);assert.ok(!JSON.stringify(f.social.workspace()).includes('private-social-token'));
}));

test('queued publication is blocked if delivery rights change before worker execution',()=>close(async f=>{
 const job=await f.publish(),start=new Date().toISOString(),end=new Date(Date.parse(start)+14*86400000).toISOString();f.db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE project_id=?").run(f.a.userId,start,end,f.a.projectId);await f.social.process(job.id,async()=>assert.fail('Trial must not reach provider'),async()=>assert.fail('Trial must not publish'));assert.equal(f.social.get(job.id).state,'blocked');assert.equal(f.social.get(job.id).submittedAt,null);
}));

test('publication access is project-scoped and only owner/admin can approve, check, run or cancel',()=>close(async f=>{
 const job=f.social.enqueue(f.input());assert.throws(()=>new SocialPublications(f.db,f.other,KEY).get(job.id),e=>e.status===404);assert.throws(()=>new SocialPublications(f.db,f.other,KEY).enqueue(f.input()),e=>e.status===404);
 for(const role of ['viewer','analyst','editor']){
  const user=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:`social-${role}`,password:'fixture-password-123',role}),service=new SocialPublications(f.db,{...f.scope,subject:user.userId},KEY);
  assert.equal(service.workspace().sources.length,0);assert.equal(service.workspace().targets.length,0);assert.equal(service.get(job.id).title,'Social QA');assert.throws(()=>service.enqueue(f.input()),e=>e.status===403);assert.throws(()=>service.cancel(job.id),e=>e.status===403);await assert.rejects(()=>service.check(f.connectionSocial.id,access),e=>e.status===403);
 }
 assert.throws(()=>new SocialPublications(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'},KEY).workspace(),e=>e.status===403);
}));

test('only saved text is approved; media, unresolved variables and edited/deleted sources fail closed',()=>close(async f=>{
 const stale=f.input();f.store.saveContent({...f.content,content:'Changed after preview'},false);assert.throws(()=>f.social.enqueue(stale),e=>e.status===409);
 for(const patch of [{content:'{{firstName}}'},{content:'x'.repeat(3001)},{content:'\x00private'}]){f.store.saveContent({...f.content,...patch},false);assert.equal(f.social.workspace().sources[0].eligible,false);assert.throws(()=>f.social.enqueue(f.input()),e=>e.status===409);}
 // One image is a LinkedIn image post now; it still cannot be queued until the image itself has been verified.
 f.store.saveContent({...f.content,imageData:'fixture-image'},false);assert.equal(f.social.workspace().sources[0].format,'image');assert.throws(()=>f.social.enqueue(f.input()),e=>e.status===409);
 f.store.saveContent(f.content,false);const job=f.social.enqueue(f.input());f.store.deleteContent(f.content.id);await f.social.process(job.id);assert.equal(f.social.get(job.id).state,'blocked');assert.equal(f.social.get(job.id).reason,'changed');
}));

test('LinkedIn-only campaign text and CTA are reused without starting email or other channels',()=>close(async f=>{
 const campaign={...f.campaign,id:'social-campaign',channels:{...f.campaign.channels,email:true,social:['linkedin','twitter']},content:{text:'Base',perPlatformContent:{linkedin:'Channel text'},ctaUrl:'https://example.com/start'}};f.store.saveCampaign(campaign,true);
 const source=f.social.workspace().sources.find(item=>item.kind==='campaign'),job=f.social.enqueue(f.input({sourceKind:'campaign',sourceId:source.id,expectedDigest:source.digest}));await f.social.process(job.id);
 assert.equal(f.social.get(job.id).text,'Channel text\n\n'+tagged(f.scope,'campaign',campaign.id,'https://example.com/start','linkedin'));assert.equal(f.store.campaign(campaign.id).status,'draft');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_pilots').get().n,0);
}));

test('publishing check uses official introspection and exact user account with no token in URL',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});if(url.includes('introspectToken')){const body=new URLSearchParams(options.body);assert.equal(body.get('token'),'fixture-token');assert.equal(body.get('client_secret'),'private-fixture-secret');assert.equal(options.redirect,'error');return Response.json({active:true,status:'active',auth_type:'3L',client_id:'fixture-client',scope:'openid,profile,w_member_social',expires_at:Math.floor(Date.now()/1000)+3600});}return Response.json({sub:'fixture_member'});};
 try{assert.ok((await provider.checkLinkedInPublishing('fixture-token','fixture_member')).expiresAt>Date.now());assert.equal(calls[0].url,'https://www.linkedin.com/oauth/v2/introspectToken');assert.equal(calls[1].url,'https://api.linkedin.com/v2/userinfo');assert.ok(!calls[0].url.includes('fixture-token'));}
 finally{globalThis.fetch=original;}
});

test('permission evidence rejects app-only, missing scopes, mismatched app/account, expiry and oversized replies',async()=>{
 const original=globalThis.fetch,base={active:true,status:'active',auth_type:'3L',client_id:'fixture-client',scope:'openid,profile,w_member_social',expires_at:Math.floor(Date.now()/1000)+3600};
 try{
  for(const patch of [{active:false},{auth_type:'2L'},{scope:'openid,profile'},{client_id:'foreign-app'},{expires_at:1}]){globalThis.fetch=async()=>Response.json({...base,...patch});await assert.rejects(()=>provider.checkLinkedInPublishing('fixture-token','fixture_member'));}
  globalThis.fetch=async url=>url.includes('introspectToken')?Response.json(base):Response.json({sub:'other_member'});await assert.rejects(()=>provider.checkLinkedInPublishing('fixture-token','fixture_member'));
  globalThis.fetch=async()=>new Response('x'.repeat(65537));await assert.rejects(()=>provider.checkLinkedInPublishing('fixture-token','fixture_member'));
 }finally{globalThis.fetch=original;}
});

test('check evidence is revision-bound, expires and older concurrent checks cannot overwrite a newer result',()=>close(async f=>{
 await f.social.check(f.connectionSocial.id,access);assert.equal(f.social.workspace().targets[0].ready,true);
 f.db.prepare("UPDATE platform_social_publish_checks SET expires_at='2000-01-01T00:00:00Z'").run();assert.equal(f.social.workspace().targets[0].ready,false);
 let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const old=f.social.check(f.connectionSocial.id,async()=>{entered();await gate;return access();});await started;
 await assert.rejects(()=>f.social.check(f.connectionSocial.id,async()=>{throw new Error('private-provider-body');}));release();await assert.rejects(()=>old);assert.equal(f.social.workspace().targets[0].ready,false);
 await assert.rejects(()=>f.social.check(f.connectionSocial.id,async()=>{f.store.revokeConnection(f.connectionSocial.id);return access();}));
}));

test('live enqueue needs deployment opt-in, current proof and explicit public-post approval',()=>close(async f=>{
 const input=f.input({mode:'publish',acknowledged:true});assert.throws(()=>f.social.enqueue(input),e=>e.status===409);process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';assert.throws(()=>f.social.enqueue(input),e=>e.status===409);
 await f.social.check(f.connectionSocial.id,access);assert.throws(()=>f.social.enqueue({...input,acknowledged:false}),e=>e.status===409);
 const job=f.social.enqueue(input);assert.equal(job.mode,'publish');assert.equal(job.status,'queued');assert.equal(job.providerPostId,null);assert.equal(f.social.enqueue(input).id,job.id);
 assert.throws(()=>f.social.enqueue({...input,idempotencyKey:'duplicate-public-text'}),e=>e.status===409);
}));

test('scheduled work waits for its timestamp, normalizes offsets and blocks jobs more than 24 hours overdue',()=>close(async f=>{
 const scheduledAt=new Date(Date.now()+3600000).toISOString(),input=f.input({scheduledAt}),job=f.social.enqueue(input);await f.social.process(job.id,async()=>assert.fail('Future check ran'));assert.equal(f.social.get(job.id).state,'pending');
 const offset=scheduledAt.replace('Z','+00:00');assert.equal(f.social.enqueue({...input,scheduledAt:offset}).id,job.id);
 f.db.prepare("UPDATE platform_social_publications SET scheduled_at='2000-01-01T00:00:00Z' WHERE job_id=?").run(job.id);await f.social.process(job.id);assert.equal(f.social.get(job.id).reason,'expired');
 for(const value of ['not-a-date','2026-10-16T10:00:00',new Date(Date.now()+31*86400000).toISOString()])assert.throws(()=>f.social.enqueue(f.input({idempotencyKey:'invalid-schedule-key',scheduledAt:value})));
}));

test('one durable reservation fences concurrent workers and records provider acceptance without invented metrics',()=>close(async f=>{
 const job=await f.publish();let release,entered,count=0;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const running=f.social.process(job.id,access,async(token,account,text,reserve)=>{assert.equal(token,'private-social-token');assert.equal(account,'fixture_member');assert.equal(text,f.content.content);assert.equal(reserve(),true);count++;entered();await gate;return {state:'accepted',postId:'urn:li:share:12345'};});await started;
 await f.social.process(job.id,access,async()=>assert.fail('Concurrent publisher entered'));release();await running;
 const value=f.social.get(job.id);assert.equal(count,1);assert.equal(value.state,'accepted');assert.equal(value.providerUrl,'https://www.linkedin.com/feed/update/urn:li:share:12345');assert.ok(value.submittedAt);assert.equal(value.impressions,undefined);await f.social.process(job.id,access,async()=>assert.fail('Accepted post retried'));
}));

test('cancellation or content changes during account checks prevents a provider submission',async()=>{
 for(const action of ['cancel','content'])await close(async f=>{
  const job=await f.publish();let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const running=f.social.process(job.id,async()=>{entered();await gate;return access();},async()=>assert.fail('Changed request reached transport'));await started;
  if(action==='cancel')f.social.cancel(job.id);else f.store.saveContent({...f.content,content:'Rewritten'},false);release();await running;assert.equal(f.social.get(job.id).submittedAt,null);assert.equal(f.social.get(job.id).state,action==='cancel'?'cancelled':'blocked');
 });
});

test('authority loss permanently blocks unsent work; role restoration never revives the approval',()=>close(async f=>{
 const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'social-admin',password:'fixture-password-123',role:'admin'}),service=new SocialPublications(f.db,{...f.scope,subject:admin.userId},KEY);process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await service.check(f.connectionSocial.id,access);const job=service.enqueue(f.input({mode:'publish',acknowledged:true}));
 f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'editor',true);f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'admin',true);await service.process(job.id,access,async()=>assert.fail('Restored role revived approval'));
 assert.equal(service.get(job.id).state,'blocked');assert.equal(service.workspace().targets[0].ready,false);
}));

test('ambiguous or interrupted submission is terminal, never retried and cannot be enqueued as duplicate text',()=>close(async f=>{
 const job=await f.publish();await f.social.process(job.id,access,async(_token,_account,_text,reserve)=>{assert.equal(reserve(),true);throw new Error('private lost response');});assert.equal(f.social.get(job.id).state,'uncertain');assert.ok(!JSON.stringify(f.social.get(job.id)).includes('private lost response'));
 await f.social.process(job.id,access,async()=>assert.fail('Uncertain publication retried'));assert.throws(()=>f.social.enqueue(f.input({mode:'publish',acknowledged:true,idempotencyKey:'new-key-same-text'})),e=>e.status===409);
}));

test('cancel after submission is not called unsent; an expired lease cannot later overwrite unknown outcome',async()=>{
 for(const action of ['cancel','expire'])await close(async f=>{
  const job=await f.publish();let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const pending=f.social.process(job.id,access,async(_t,_a,_x,reserve)=>{assert.equal(reserve(),true);entered();await gate;return {state:'accepted',postId:'urn:li:ugcPost:555'};});await started;
  if(action==='cancel'){const value=f.social.cancel(job.id);assert.equal(value.cancelRequested,true);assert.equal(value.state,'submitting');}
  else{f.db.prepare("UPDATE platform_jobs SET lease_until='2000-01-01T00:00:00Z' WHERE id=?").run(job.id);await f.social.process(job.id,access,async()=>assert.fail('Interrupted submit repeated'));}
  release();await pending;assert.equal(f.social.get(job.id).state,action==='cancel'?'accepted':'uncertain');
 });
});

test('official Posts adapter escapes plain text, only reserves once, handles header IDs and classifies ambiguity',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.linkedin.com/rest/posts');assert.equal(options.redirect,'error');assert.equal(options.headers['LinkedIn-Version'],'202609');const body=JSON.parse(options.body);assert.equal(body.author,'urn:li:person:fixture_member');assert.equal(body.commentary,'Hello \\#test \\(safe\\) \\@plain');return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:123'}});};
  let reserved=0;assert.equal((await provider.publishLinkedInText('fixture','fixture_member','Hello #test (safe) @plain',()=>{reserved++;return true;})).state,'accepted');assert.equal(reserved,1);
  globalThis.fetch=async()=>assert.fail('Transport ran without reservation');assert.equal((await provider.publishLinkedInText('fixture','fixture_member','Text',()=>false)).state,'blocked');
  for(const [status,expected] of [[403,'rejected'],[429,'rejected'],[500,'uncertain'],[201,'uncertain']]){globalThis.fetch=async()=>new Response(null,{status});assert.equal((await provider.publishLinkedInText('fixture','fixture_member','Text',()=>true)).state,expected);}
  globalThis.fetch=async()=>{throw new Error('Network ambiguity');};assert.equal((await provider.publishLinkedInText('fixture','fixture_member','Text',()=>true)).state,'uncertain');
 }finally{globalThis.fetch=original;}
});

test('LinkedIn OAuth requests write permission only with explicit opt-in',()=>{
 const {linkedinClient}=load('linkedin-client.ts'),client=linkedinClient();assert.equal(new URL(client.authorizationUrl('fixture-state')).searchParams.get('scope'),'openid profile');assert.equal(new URL(client.authorizationUrl('fixture-state',true)).searchParams.get('scope'),'openid profile w_member_social');
});

test('a changed publishing target invalidates preview and daily submission quotas count reserved attempts',()=>close(async f=>{
 const stale=f.input();f.store.saveConnection({id:f.connectionSocial.id,provider:'social',integrationId:'unused',accountName:'Replacement account',accessToken:'replacement-token',social:{platform:'linkedin',accountId:'replacement_member'}},KEY);assert.throws(()=>f.social.enqueue(stale),e=>e.status===409);
 process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.social.check(f.connectionSocial.id,access);
 for(let i=0;i<5;i++){const job=f.social.enqueue(f.input({mode:'publish',acknowledged:true,idempotencyKey:`quota-rejection-${i}`}));await f.social.process(job.id,access,async(_t,_a,_x,reserve)=>{assert.equal(reserve(),true);return {state:'rejected',postId:null};});}
 const last=f.social.enqueue(f.input({mode:'publish',acknowledged:true,idempotencyKey:'quota-blocked-final'}));await f.social.process(last.id,access,async(_t,_a,_x,reserve)=>{assert.equal(reserve(),false);return {state:'blocked',postId:null};});assert.equal(f.social.get(last.id).reason,'limit');assert.equal(f.social.get(last.id).submittedAt,null);
}));

test('a manual runner losing authority and a changed API configuration are rechecked before submission',async()=>{
 for(const change of ['runner','configuration'])await close(async f=>{
  const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'manual-social-admin',password:'fixture-password-123',role:'admin'}),job=await f.publish();
  try{await f.social.process(job.id,async()=>{if(change==='runner')f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'viewer',true);else process.env.PLATFORM_LINKEDIN_API_VERSION='202608';return access();},async()=>assert.fail('Changed authority reached transport'),admin.userId);assert.equal(f.social.get(job.id).state,'blocked');assert.equal(f.social.get(job.id).submittedAt,null);}
  finally{process.env.PLATFORM_LINKEDIN_API_VERSION='202609';}
 });
});

test('schema19 upgrade preserves measurements, manual work and email queue with no social records',async()=>{
 const f=setup(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'social-migration19-')),'fixture.sqlite'),{openPlatformDatabase}=load('database.ts');let db;
 try{const review=f.approve(),queued=f.queue.enqueue({campaignId:f.campaign.id,expectedDigest:review.digest,expectedReviewId:review.history[0].id,idempotencyKey:'migration-email-fixture',acknowledged:true});require('./schema-fixture.cjs').removeSocialPublicationSchema(f.db);assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n,19);await f.db.backup(file);db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_social_publications').get().n,0);assert.equal(db.prepare('SELECT status FROM platform_jobs WHERE id=?').get(queued.id).status,'queued');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_measurement_bindings').get().n,0);db.close();db=openPlatformDatabase(file);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_migrations WHERE version=20').get().n,1);}
 finally{db?.close();f.db.close();}
});
