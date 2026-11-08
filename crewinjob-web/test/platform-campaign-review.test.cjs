const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHash}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts');
const {ProductDataSources}=load('product-data.ts'),{ConnectionJobs}=load('connection-jobs.ts'),{ProductSegments}=load('segments.ts');
const {CampaignReviews}=load('campaign-review.ts'),{ProjectMarketingStore}=load('marketing-store.ts');
const {EmailSenders}=load('email-sender.ts');
const KEY='12'.repeat(32);
async function fixture(){
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);await repo.bootstrapLegacy('admin');
 const provision=async name=>await repo.provision('legacy-admin',{organizationName:name,projectName:name,website:'https://example.com',username:name,password:'fixture-password-123'}),a=await provision('alpha'),b=await provision('beta');
 const scope=(v=a)=>({subject:v.userId,organizationId:v.organizationId,projectId:v.projectId}),sources=new ProductDataSources(db,scope());
 const source=await sources.save({name:'Fixture users',token:'not-for-client',config:{url:'https://api.example.com/users',auth:'bearer',entityType:'user',itemsPath:'items',idPath:'id',updatedAtPath:'updatedAt',attributes:[{key:'completion',path:'completion',type:'number'}],nextCursorPath:'',cursorParam:''}},KEY);
 const loader=async()=>({items:[{id:'profile-private-01',completion:25,updatedAt:new Date().toISOString()},{id:'profile-private-02',completion:80,updatedAt:new Date().toISOString()}],nextCursor:null});
 await sources.preview(source.id,KEY,loader);await sources.setEnabled(source.id,1,true);const jobs=new ConnectionJobs(db,scope());await jobs.run((await jobs.enqueue(source.id,'seed','product.sync')).id,KEY,undefined,undefined,undefined,undefined,loader);
 const segments=new ProductSegments(db,scope()),segment=await segments.save({name:'Incomplete',definition:{sourceId:source.id,sourceVersion:1,maxAgeHours:24,goalId:'',stageIndex:null,rules:{kind:'group',op:'and',children:[{kind:'attribute',field:'completion',op:'lt',value:50}]}}});
 await segments.preview({id:segment.id,version:1});const binding=await segments.binding(segment.id,1,'');
 const campaign={id:'campaign-review-fixture',name:'Profile campaign',status:'draft',updatedAt:new Date().toISOString(),content:{subject:'Complete your profile',text:'A useful next step.',ctaUrl:'https://example.com/profile'},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]},segmentBinding:binding};
 const store=new ProjectMarketingStore(db,scope());await store.saveCampaign(campaign,true);
 return {db,repo,a,b,scope,source,sources,segments,segment,campaign,store,reviews:new CampaignReviews(db,scope())};
}
const decide=async (reviews,id,decision='approved',note='')=>{const view=await reviews.get(id);return await reviews.decide(id,{decision,note,expectedDigest:view.digest,expectedReviewId:view.history[0]?.id??null});};

test('saved review preview is read-only, escaped and never claims sendable recipients or verified delivery',async()=>{
 const f=await fixture();try{
  const before=f.db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_preflights').get().n,view=await f.reviews.get(f.campaign.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_preflights').get().n,before);
  assert.equal(view.sendingEnabled,false);assert.equal(view.eligibleRecipients,null);assert.equal(view.audience,null);
  assert.ok(!JSON.stringify(view).includes('not-for-client'));assert.ok(!JSON.stringify(view).includes('profile-private-01'));
  for(const code of ['consent','sender_domain','unsubscribe','dispatch'])assert.equal(view.checks.find(check=>check.code===code).state,'blocked');
  const hostile={...f.campaign,content:{...f.campaign.content,text:'<script>fetch("https://untrusted.example")</script><img src=x onerror=alert(1)>'}};await f.store.saveCampaign(hostile,false);
  const rendered=(await f.reviews.get(f.campaign.id)).html;assert.ok(!rendered.includes('<script>'));assert.ok(!rendered.includes('<img '));assert.ok(rendered.includes('&lt;script&gt;'));assert.ok(rendered.includes("default-src 'none'"));
 }finally{f.db.close();}
});

test('fresh preflight and explicit owner decision create immutable content approval; repeated decisions are idempotent',async()=>{
 const f=await fixture();try{
  await assert.rejects(async ()=>await decide(f.reviews,f.campaign.id),error=>error.status===409);
  const checked=await f.reviews.check(f.campaign.id,(await f.reviews.get(f.campaign.id)).digest);assert.equal(checked.audience.matched,1);assert.equal(checked.audience.total,2);assert.equal(checked.audience.fresh,true);
  const approved=await decide(f.reviews,f.campaign.id);assert.equal(approved.approval,'approved');assert.equal(approved.sendingEnabled,false);assert.equal(approved.history.length,1);assert.equal((await f.store.campaign(f.campaign.id)).status,'draft');
  assert.equal((await decide(f.reviews,f.campaign.id)).history.length,1);
  await assert.rejects(async ()=>await decide(f.reviews,f.campaign.id,'revoked',''));
  assert.equal((await decide(f.reviews,f.campaign.id,'revoked','Need a stronger CTA')).approval,'revoked');
  assert.equal((await decide(f.reviews,f.campaign.id,'rejected','Please adjust subject')).history.length,3);
 }finally{f.db.close();}
});

test('live roles allow editor checks but only owners/admins approve; foreign and legacy scope are denied',async()=>{
 const f=await fixture();try{
  const editor=await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'editor',password:'fixture-password-123',role:'editor'}),viewer=await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'viewer',password:'fixture-password-123',role:'viewer'});
  const e=new CampaignReviews(f.db,{...await f.scope(),subject:editor.userId}),v=new CampaignReviews(f.db,{...await f.scope(),subject:viewer.userId});
  assert.equal((await v.get(f.campaign.id)).canCheck,false);await assert.rejects(async ()=>await v.check(f.campaign.id,(await v.get(f.campaign.id)).digest));
  await e.check(f.campaign.id,(await e.get(f.campaign.id)).digest);assert.equal((await e.get(f.campaign.id)).canApprove,false);await assert.rejects(async ()=>await decide(e,f.campaign.id),error=>error.status===403);
  const other=new CampaignReviews(f.db,await f.scope(f.b));await assert.rejects(async ()=>await other.get(f.campaign.id),error=>error.status===404);await assert.rejects(async ()=>await other.check(f.campaign.id,'x'));await assert.rejects(async ()=>await decide(other,f.campaign.id));
  await assert.rejects(async ()=>await new CampaignReviews(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).get(f.campaign.id));
 }finally{f.db.close();}
});

test('content edits, brand changes and optimistic decision races invalidate earlier approval',async()=>{
 const f=await fixture();try{
  await f.reviews.check(f.campaign.id,(await f.reviews.get(f.campaign.id)).digest);const old=await f.reviews.get(f.campaign.id);await decide(f.reviews,f.campaign.id,'rejected','Adjust content');
  await assert.rejects(async ()=>await f.reviews.decide(f.campaign.id,{decision:'approved',note:'',expectedDigest:old.digest,expectedReviewId:null}),error=>error.status===409);
  await f.store.saveCampaign({...f.campaign,name:'Renamed',updatedAt:new Date(Date.now()+1000).toISOString()},false);assert.equal((await f.reviews.get(f.campaign.id)).approval,'outdated');await assert.rejects(async ()=>await f.reviews.check(f.campaign.id,old.digest));
  await f.reviews.check(f.campaign.id,(await f.reviews.get(f.campaign.id)).digest);assert.equal((await decide(f.reviews,f.campaign.id)).approval,'approved');
  await f.repo.updateProject(f.a.userId,f.a.organizationId,f.a.projectId,{name:'New brand',website:'https://example.com',timezone:'UTC',language:'en',brandVoice:'Clear',goals:[]});assert.equal((await f.reviews.get(f.campaign.id)).approval,'outdated');
 }finally{f.db.close();}
});

test('approval authority loss is effective immediately without deleting historical decisions',async()=>{
 const f=await fixture();try{
  const admin=await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'reviewer',password:'fixture-password-123',role:'admin'}),reviews=new CampaignReviews(f.db,{...await f.scope(),subject:admin.userId});
  await reviews.check(f.campaign.id,(await reviews.get(f.campaign.id)).digest);await decide(reviews,f.campaign.id);
  await f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'editor',true);
  assert.equal((await f.reviews.get(f.campaign.id)).approval,'revoked');assert.equal((await f.reviews.get(f.campaign.id)).history.length,2);
  await f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'admin',true);assert.equal((await f.reviews.get(f.campaign.id)).approval,'revoked');
 }finally{f.db.close();}
});

test('expired previews, paused sources and changed membership data fail closed',async()=>{
 for(const mode of ['expired','paused','changed']){
  const f=await fixture();try{
   await f.reviews.check(f.campaign.id,(await f.reviews.get(f.campaign.id)).digest);
   if(mode==='expired')f.db.prepare('UPDATE platform_campaign_preflights SET checked_at=?').run('2000-01-01T00:00:00Z');
   if(mode==='paused')await f.sources.setEnabled(f.source.id,1,false);
   if(mode==='changed')f.db.prepare('UPDATE platform_product_records SET attributes_json=?').run(JSON.stringify({completion:99}));
   await assert.rejects(async ()=>await decide(f.reviews,f.campaign.id),error=>error.status===409);
   if(mode==='paused'){const view=await f.reviews.check(f.campaign.id,(await f.reviews.get(f.campaign.id)).digest);assert.equal(view.audience,null);assert.ok(view.audienceError);}
   if(mode==='changed'){const view=await f.reviews.check(f.campaign.id,(await f.reviews.get(f.campaign.id)).digest);assert.equal(view.audience.matched,0);await assert.rejects(async ()=>await decide(f.reviews,f.campaign.id));}
  }finally{f.db.close();}
 }
});

test('missing subject, unsafe CTA, unresolved variables, oversized content and mixed channels block approval',async()=>{
 const f=await fixture();try{
  for(const patch of [{content:{...f.campaign.content,subject:'Header\r\nBCC: attacker'}},{content:{...f.campaign.content,ctaUrl:'http://example.com'}},{content:{...f.campaign.content,text:'Hello {{firstName}}'}},{content:{...f.campaign.content,text:'x'.repeat(20001)}},{channels:{...f.campaign.channels,social:['linkedin']}}]){
   await f.store.saveCampaign({...f.campaign,...patch},false);const view=await f.reviews.check(f.campaign.id,(await f.reviews.get(f.campaign.id)).digest);assert.equal(view.audience,null);await assert.rejects(async ()=>await decide(f.reviews,f.campaign.id));
  }
 }finally{f.db.close();}
});

test('SMTP readiness is scoped, revision-bound and expires; it never opens sender or delivery gates',async()=>{
 const f=await fixture();try{
  const smtp={host:'smtp.sendgrid.net',port:587,user:'apikey',fromEmail:'hello@example.com',fromName:'Example'};
  const connection=await f.store.saveConnection({provider:'email',integrationId:'fixture',accountName:'Fixture SMTP',accessToken:'smtp-secret',smtp},KEY);
  const row=f.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(connection.id),revision=createHash('sha256').update(row.encrypted_credentials).digest('hex');
  f.db.prepare('INSERT INTO platform_connection_checks VALUES(?,?,?,?,?)').run(connection.id,revision,'verified',new Date().toISOString(),'Fixture only');
  assert.equal((await f.reviews.get(f.campaign.id)).checks.find(check=>check.code==='smtp').state,'pending');
  await new EmailSenders(f.db,await f.scope(),KEY).select({connectionId:connection.id,maxRecipients:5,expectedRevision:0});
  assert.equal((await f.reviews.get(f.campaign.id)).checks.find(check=>check.code==='smtp').state,'pass');
  f.db.prepare('UPDATE platform_connection_checks SET revision=?').run('changed');assert.equal((await f.reviews.get(f.campaign.id)).checks.find(check=>check.code==='smtp').state,'pending');
  f.db.prepare('UPDATE platform_connection_checks SET revision=?,checked_at=?').run(revision,'2000-01-01T00:00:00Z');assert.equal((await f.reviews.get(f.campaign.id)).checks.find(check=>check.code==='smtp').state,'pending');
  assert.equal((await f.reviews.get(f.campaign.id)).eligibleRecipients,null);
 }finally{f.db.close();}
});

test('campaign deletion prunes preflight but retains decision audit history; review quota persists',async()=>{
 const f=await fixture();try{
  await f.reviews.check(f.campaign.id,(await f.reviews.get(f.campaign.id)).digest);await decide(f.reviews,f.campaign.id);
  f.db.prepare("UPDATE platform_usage SET count=100 WHERE resource='campaign_review'").run();await assert.rejects(async ()=>await decide(f.reviews,f.campaign.id,'rejected','Change'),error=>error.status===429);
  await f.store.deleteCampaign(f.campaign.id);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_preflights').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_reviews').get().n,1);
  assert.equal(f.db.pragma('foreign_key_check').length,0);
 }finally{f.db.close();}
});

test('migration 14 is additive and repeatable with campaigns and pinned segments intact',async()=>{
 const f=await fixture(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'review-migration-')),'fixture.sqlite');let db;
 try{
  f.db.exec('DROP TABLE platform_campaign_preflights; DROP TABLE platform_campaign_reviews; DROP INDEX platform_campaign_scoped_identity; DELETE FROM platform_migrations WHERE version=14;');await f.db.backup(file);db=openPlatformDatabase(file);
  assert.equal((await new ProjectMarketingStore(db,await f.scope()).campaign(f.campaign.id)).segmentBinding.segmentVersion,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_segments').get().n,1);
  db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_reviews').get().n,0);assert.equal(db.pragma('foreign_key_check').length,0);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
 }finally{db?.close();f.db.close();}
});
