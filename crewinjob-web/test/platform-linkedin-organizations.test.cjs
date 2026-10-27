const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SocialPublications}=load('social-publications.ts'),{LinkedInOrganizationOAuth}=load('linkedin-organization-oauth.ts'),{linkedinClient}=load('linkedin-client.ts'),provider=load('linkedin-publishing.ts'),org=load('linkedin-organization-publishing.ts'),api=load('linkedin-organizations.ts'),{decryptCredentials,encryptCredentials}=load('credential-envelope.ts');
process.env.PLATFORM_LINKEDIN_CLIENT_ID='fixture-org-client';process.env.PLATFORM_LINKEDIN_CLIENT_SECRET='private-org-secret';process.env.PLATFORM_LINKEDIN_REDIRECT_URI='http://localhost:3033/api/platform/social/callback';process.env.PLATFORM_LINKEDIN_API_VERSION='202609';
const social={platform:'linkedin',accountType:'organization',accountId:'100'},access=async()=>({expiresAt:Date.now()+3600000});
const acl=(id,role='ADMINISTRATOR',state='APPROVED')=>({organization:`urn:li:organization:${id}`,role,roleAssignee:'urn:li:person:acl_member',state});
function reader(patch={}){return async(url,token,init)=>{
 const parsed=new URL(url);assert.equal(parsed.origin,'https://api.linkedin.com');assert.equal(token,'private-org-token');assert.ok(!url.includes(token));
 if(parsed.pathname==='/v2/userinfo')return {sub:patch.member||'oidc_subject'};
 assert.equal(init.headers['LinkedIn-Version'],'202609');assert.equal(init.headers['X-Restli-Protocol-Version'],'2.0.0');
 if(parsed.pathname==='/rest/organizationAcls')return {elements:patch.rows||[acl('100'),acl('200','ANALYST'),acl('300','CONTENT_ADMINISTRATOR'),acl('400','DIRECT_SPONSORED_CONTENT_POSTER'),acl('500','ADMINISTRATOR','REVOKED')],paging:{start:Number(parsed.searchParams.get('start')),count:25,links:[]}};
 assert.equal(parsed.pathname,'/rest/organizationsLookup');return {results:patch.names||Object.fromEntries(['100','200','300','400'].map(id=>[id,{id:Number(id),localizedName:`Company ${id}`} ])),statuses:{},errors:{}};
};}
function setup(){
 const f=fixture();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';
 const grant={memberSub:'oidc_subject',configurationRevision:org.linkedinOrganizationConfiguration().revision,publishing:true};
 f.company=f.store.saveConnection({provider:'social',integrationId:'unused',accountName:'Company 100',accessToken:'private-org-token',expiresAt:Date.now()+7200000,social},KEY,undefined,undefined,grant);
 f.content={id:'org-content',platform:'linkedin',headline:'Company update',language:'en',content:'New milestone. #Ryzevo',timestamp:Date.now(),prompt:''};f.store.saveContent(f.content,true);
 f.service=new SocialPublications(f.db,f.scope,KEY);f.credentials=()=>decryptCredentials(f.db.prepare('SELECT encrypted_credentials AS value FROM platform_connections WHERE id=?').get(f.company.id).value,KEY,f.scope.organizationId,f.scope.projectId,f.company.id);
 f.input=(patch={})=>({sourceKind:'content',sourceId:f.content.id,connectionId:f.company.id,expectedDigest:f.service.workspace().sources[0].digest,expectedTargetRevision:f.service.workspace().targets.find(t=>t.id===f.company.id).revision,mode:'rehearsal',idempotencyKey:'organization-fixture',...patch});
 f.publish=async(patch={})=>{process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.service.check(f.company.id,access);return f.service.enqueue(f.input({mode:'publish',acknowledged:true,...patch}));};return f;
}
const run=async fn=>{const f=setup();try{await fn(f);}finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}};
function oauth(f,read=reader()){
 const real=linkedinClient(),client={...real,exchange:async()=>({accessToken:'private-org-token',expiresAt:Date.now()+7200000})};return new LinkedInOrganizationOAuth(f.db,f.scope,KEY,()=>client,read);
}
async function selection(service,publishing=true){const start=service.start(publishing),state=new URL(start.authorizationUrl).searchParams.get('state');return {start,state,cookie:await service.complete(state,start.browser,'code')};}
function providerFetch(patch={}){const read=reader(patch);return async(url,init)=>{
 if(url==='https://www.linkedin.com/oauth/v2/introspectToken')return Response.json({active:true,status:'active',auth_type:'3L',client_id:'fixture-org-client',scope:patch.scopes||'openid,profile,r_organization_admin,w_organization_social',expires_at:Math.floor(Date.now()/1000)+3600,...patch.introspection});
 return Response.json(await read(url,init.headers.get('Authorization').slice(7),{headers:{'LinkedIn-Version':init.headers.get('LinkedIn-Version'),'X-Restli-Protocol-Version':init.headers.get('X-Restli-Protocol-Version')}}));
};}

test('same numeric personal and company IDs coexist without a schema change or duplicate content',()=>run(async f=>{
 const person=f.store.saveConnection({provider:'social',integrationId:'unused',accountName:'Personal 100',accessToken:'personal-token',social:{platform:'linkedin',accountId:'100'}},KEY);
 assert.notEqual(person.id,f.company.id);assert.equal(person.integrationId,'linkedin:100');assert.equal(f.company.integrationId,'linkedin:organization:100');assert.equal(f.service.workspace().targets.find(t=>t.id===f.company.id).accountType,'organization');assert.equal(f.service.workspace().sources.length,1);
 const job=f.service.enqueue(f.input({accountType:'person',text:'untrusted'}));await f.service.process(job.id,async()=>assert.fail(),async()=>assert.fail());assert.equal(f.service.get(job.id).state,'rehearsed');assert.equal(f.service.get(job.id).accountType,'organization');assert.equal(f.service.get(job.id).text,f.content.content);assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n,59);assert.equal(f.db.pragma('integrity_check',{simple:true}),'ok');assert.equal(f.db.pragma('foreign_key_check').length,0);
}));
test('organization OAuth requests read scope by default and write scope only on explicit opt-in',()=>run(async f=>{
 const client=linkedinClient();assert.equal(new URL(client.authorizationUrl('state',false,'organization')).searchParams.get('scope'),'openid profile r_organization_admin');assert.equal(new URL(client.authorizationUrl('state',true,'organization')).searchParams.get('scope'),'openid profile r_organization_admin w_organization_social');assert.equal(new URL(client.authorizationUrl('state',true)).searchParams.get('scope'),'openid profile w_member_social');assert.throws(()=>oauth(f).start('true'));
}));
test('page discovery returns safe names/roles with no auto-selection or credential leakage',()=>run(async f=>{
 const service=oauth(f),selected=await selection(service),view=await service.list(selected.cookie);
 assert.deepEqual(Array.from(view.items,p=>p.id),['100','200','300','400']);assert.equal(view.items[0].canPublish,true);assert.equal(view.items[1].canPublish,false);assert.equal(view.items[2].canPublish,true);assert.equal(view.items[3].canPublish,false);assert.equal(view.selectedId,undefined);assert.doesNotMatch(JSON.stringify(view),/private-|accessToken|memberSub|revision|"start"/);
 const row=f.db.prepare("SELECT encrypted_verifier FROM platform_oauth_requests WHERE provider='linkedin_organization_selection'").get();assert.ok(!row.encrypted_verifier.includes('private-org-token'));await assert.rejects(()=>service.complete(selected.state,selected.start.browser,'code'));
}));
test('only an explicitly selected current authorized page is saved; readonly consent never upgrades',()=>run(async f=>{
 for(const publishing of [false,true]){
  const service=oauth(f),selected=await selection(service,publishing);await service.list(selected.cookie);const saved=await service.select(selected.cookie,'300');assert.equal(saved.integrationId,'linkedin:organization:300');assert.equal(saved.accountName,'Company 300');
  const credential=decryptCredentials(f.db.prepare('SELECT encrypted_credentials AS value FROM platform_connections WHERE id=?').get(saved.id).value,KEY,f.scope.organizationId,f.scope.projectId,saved.id);assert.equal(credential.linkedinOrganization.publishing,publishing);assert.equal(credential.social.accountType,'organization');assert.equal(credential.linkedinOrganization.memberSub,'oidc_subject');await assert.rejects(()=>service.select(selected.cookie,'300'));
 }
}));
test('analyst, sponsored-only, missing, unlisted and revoked pages cannot be selected for organic publishing',async()=>{
 for(const id of ['200','400','500','999'])await run(async f=>{const service=oauth(f),s=await selection(service);await service.list(s.cookie);await assert.rejects(()=>service.select(s.cookie,id),e=>e.status===409);assert.equal(f.store.connections().filter(c=>c.integrationId===`linkedin:organization:${id}`).length,0);});
});
test('selection is bound to project/browser, invalidates on cancellation and new OAuth flow',()=>run(async f=>{
 const service=oauth(f),start=service.start(true),state=new URL(start.authorizationUrl).searchParams.get('state');await assert.rejects(()=>oauth({...f,scope:f.other}).complete(state,start.browser,'code'));await assert.rejects(()=>service.complete(state,'a'.repeat(43),'code'));
 const cookie=await service.complete(state,start.browser,'code');await service.list(cookie);service.cancel(cookie);await assert.rejects(()=>service.list(cookie));const s=await selection(service);await service.list(s.cookie);service.start(false);await assert.rejects(()=>service.select(s.cookie,'100'));
}));
test('page or role changes, account switch and connection revocation during selection fail closed',async()=>{
 for(const change of ['role','name','member','revoke'])await run(async f=>{
  let changed=false;const service=oauth(f,async(...args)=>{if(changed&&change==='revoke')f.store.revokeConnection(f.company.id);return reader(changed?change==='role'?{rows:[acl('100','ANALYST')]}:change==='name'?{names:{100:{id:100,localizedName:'Renamed'}}}:change==='member'?{member:'other'}:{}:{})(...args);});
  const s=await selection(service);await service.list(s.cookie);changed=true;await assert.rejects(()=>service.select(s.cookie,'100'),e=>e.status===409);
 });
});
test('page discovery rejects unsafe paging, does not follow next URLs and caps raw ACL rows at 200',()=>run(async f=>{
 const read=async(url,token,init)=>{
  const parsed=new URL(url);assert.equal(parsed.origin,'https://api.linkedin.com');
  if(parsed.pathname==='/rest/organizationAcls'){const start=Number(parsed.searchParams.get('start'));assert.ok(start<200);return {elements:Array.from({length:25},(_,i)=>acl(String(start+i+1))),paging:{start,count:25,links:[{rel:'next',href:'https://evil.test/?access_token=private'}]}};}
  if(parsed.pathname==='/rest/organizationsLookup')return {results:Object.fromEntries(parsed.searchParams.get('ids').slice(5,-1).split(',').map(id=>[id,{id:Number(id),localizedName:`Company ${id}`}]))};return {sub:'oidc_subject'};
 };
 const service=oauth(f,read),s=await selection(service);let view=await service.list(s.cookie);for(let i=0;i<7;i++)view=await service.list(s.cookie,true);assert.equal(view.items.length,200);assert.equal(view.hasMore,false);assert.equal(view.limitReached,true);assert.equal((await service.list(s.cookie,true)).items.length,200);
 await assert.rejects(()=>api.organizationRoles(async()=>({elements:[],paging:{start:1,count:25}}),'token','202609',0));
}));
test('batch name lookup handles partial errors and never treats a mismatched ID as selectable',()=>run(async f=>{
 const service=oauth(f,reader({names:{100:{id:999,localizedName:'Wrong'},200:{id:200,localizedName:'Analyst company'}}})),s=await selection(service),view=await service.list(s.cookie);assert.equal(view.items[0].available,false);assert.equal(view.items[0].name,'LinkedIn #100');await assert.rejects(()=>service.select(s.cookie,'100'));
}));
test('real check binds current introspection scopes, app, member and exact organization organic role',()=>run(async f=>{
 const original=globalThis.fetch;globalThis.fetch=providerFetch();
 try{await f.service.check(f.company.id);assert.equal(f.service.workspace().targets[0].ready,true);
  for(const patch of [{scopes:'w_member_social,r_organization_admin'},{introspection:{client_id:'other-app'}},{member:'other'},{rows:[acl('999')]},{rows:[acl('100','ANALYST')]},{rows:[acl('100','ADMINISTRATOR','REVOKED')]},{rows:[acl('100','DIRECT_SPONSORED_CONTENT_POSTER')]}]){globalThis.fetch=providerFetch(patch);await assert.rejects(()=>f.service.check(f.company.id),e=>e.status===409&&!e.message.includes('private-'));assert.equal(f.service.workspace().targets[0].ready,false);}
 }finally{globalThis.fetch=original;}
}));
test('manual token saves cannot forge or retain organization OAuth provenance',()=>run(async f=>{
 const credentials=f.credentials();f.store.saveConnection({provider:'social',integrationId:'unused',accountName:'Manual company',accessToken:'manual-token',social,linkedinOrganization:credentials.linkedinOrganization},KEY);assert.equal(f.credentials().linkedinOrganization,undefined);
 const original=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Unproven token contacted provider');try{await assert.rejects(()=>f.service.check(f.company.id),e=>e.status===409);}finally{globalThis.fetch=original;}
}));
test('organization adapter uses an organization author, fixed Posts API and one durable reservation',async()=>{
 const original=globalThis.fetch;let reserved=0,calls=0;
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(reserved,1);assert.equal(url,'https://api.linkedin.com/rest/posts');assert.equal(init.redirect,'error');assert.equal(init.headers['LinkedIn-Version'],'202609');const body=JSON.parse(init.body);assert.equal(body.author,'urn:li:organization:100');assert.equal(body.commentary,'New milestone. \\#Ryzevo');assert.equal(body.distribution.feedDistribution,'MAIN_FEED');return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:555'}});};
 try{assert.equal((await provider.publishLinkedInOrganizationText('token','100','New milestone. #Ryzevo',()=>{reserved++;return true;})).state,'accepted');assert.equal(calls,1);await provider.publishLinkedInOrganizationText('token','100','text',()=>false);assert.equal(calls,1);assert.equal((await provider.publishLinkedInOrganizationText('token','member','text',()=>assert.fail())).state,'blocked');}
 finally{globalThis.fetch=original;}
});
test('default company worker revalidates grant and role, publishes once and stores safe receipt',()=>run(async f=>{
 const job=await f.publish(),original=globalThis.fetch;let posts=0;
 globalThis.fetch=async(url,init)=>{if(url==='https://api.linkedin.com/rest/posts'){posts++;assert.equal(JSON.parse(init.body).author,'urn:li:organization:100');assert.ok(f.db.prepare('SELECT submitted_at FROM platform_social_publications WHERE job_id=?').get(job.id).submitted_at);return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:ugcPost:12345'}});}return providerFetch()(url,init);};
 try{await f.service.process(job.id);const result=f.service.get(job.id);assert.equal(result.state,'accepted');assert.equal(result.accountType,'organization');assert.equal(result.providerUrl,'https://www.linkedin.com/feed/update/urn:li:ugcPost:12345');assert.equal(result.impressions,undefined);await f.service.process(job.id);assert.equal(posts,1);}
 finally{globalThis.fetch=original;}
}));
test('worker refuses role loss and never retries ambiguous organization submissions',()=>run(async f=>{
 const job=await f.publish(),original=globalThis.fetch;globalThis.fetch=providerFetch({rows:[acl('100','ANALYST')]});
 try{await f.service.process(job.id);assert.equal(f.service.get(job.id).state,'blocked');assert.equal(f.service.get(job.id).submittedAt,null);}
 finally{globalThis.fetch=original;}
 const unknown=await f.publish({idempotencyKey:'company-unknown'});await f.service.process(unknown.id,access,async(t,a,b,reserve)=>{assert.equal(reserve(),true);throw new Error('Unknown provider response');});assert.equal(f.service.get(unknown.id).state,'uncertain');await f.service.process(unknown.id,access,async()=>assert.fail('Unknown post retried'));
}));
test('same saved content can rehearse on either actor without silently changing an existing snapshot',()=>run(async f=>{
 const job=f.service.enqueue(f.input());const row=f.db.prepare('SELECT encrypted_snapshot FROM platform_social_publications WHERE job_id=?').get(job.id),snapshot=decryptCredentials(row.encrypted_snapshot,KEY,f.scope.organizationId,f.scope.projectId,`publication:${job.id}`);delete snapshot.accountType;
 f.db.prepare('UPDATE platform_social_publications SET encrypted_snapshot=? WHERE job_id=?').run(encryptCredentials(snapshot,KEY,f.scope.organizationId,f.scope.projectId,`publication:${job.id}`),job.id);await f.service.process(job.id,access,async()=>assert.fail('Changed actor posted'));assert.equal(f.service.get(job.id).state,'blocked');
 assert.throws(()=>new SocialPublications(f.db,f.other,KEY).get(job.id),e=>e.status===404);
}));
test('bounded organization reader rejects unsafe hosts and oversized or failing responses',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Unsafe request escaped');
 try{for(const url of ['https://evil.test/rest/organizationAcls','https://api.linkedin.com/rest/organizations/100','https://api.linkedin.com/rest/organizationAcls?access_token=secret'])await assert.rejects(()=>api.readLinkedInOrganizationJson(url,'token'));
  globalThis.fetch=async()=>new Response('x'.repeat(65537));await assert.rejects(()=>api.readLinkedInOrganizationJson('https://api.linkedin.com/rest/organizationAcls','token'));
  globalThis.fetch=async()=>new Response('private-error',{status:403});await assert.rejects(()=>api.readLinkedInOrganizationJson('https://api.linkedin.com/rest/organizationAcls','token'),e=>!e.message.includes('private-error'));
 }finally{globalThis.fetch=original;}
});
