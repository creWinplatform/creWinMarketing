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
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
 const provision=name=>repo.provision('legacy-admin',{organizationName:name,projectName:name,website:'https://example.com',username:name,password:'fixture-password-123'}),a=provision('alpha'),b=provision('beta');
 const scope=(v=a)=>({subject:v.userId,organizationId:v.organizationId,projectId:v.projectId}),sources=new ProductDataSources(db,scope());
 const source=sources.save({name:'Fixture users',token:'not-for-client',config:{url:'https://api.example.com/users',auth:'bearer',entityType:'user',itemsPath:'items',idPath:'id',updatedAtPath:'updatedAt',attributes:[{key:'completion',path:'completion',type:'number'}],nextCursorPath:'',cursorParam:''}},KEY);
 const loader=async()=>({items:[{id:'profile-private-01',completion:25,updatedAt:new Date().toISOString()},{id:'profile-private-02',completion:80,updatedAt:new Date().toISOString()}],nextCursor:null});
 await sources.preview(source.id,KEY,loader);sources.setEnabled(source.id,1,true);const jobs=new ConnectionJobs(db,scope());await jobs.run(jobs.enqueue(source.id,'seed','product.sync').id,KEY,undefined,undefined,undefined,undefined,loader);
 const segments=new ProductSegments(db,scope()),segment=segments.save({name:'Incomplete',definition:{sourceId:source.id,sourceVersion:1,maxAgeHours:24,goalId:'',stageIndex:null,rules:{kind:'group',op:'and',children:[{kind:'attribute',field:'completion',op:'lt',value:50}]}}});
 segments.preview({id:segment.id,version:1});const binding=segments.binding(segment.id,1,'');
 const campaign={id:'campaign-review-fixture',name:'Profile campaign',status:'draft',updatedAt:new Date().toISOString(),content:{subject:'Complete your profile',text:'A useful next step.',ctaUrl:'https://example.com/profile'},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]},segmentBinding:binding};
 const store=new ProjectMarketingStore(db,scope());store.saveCampaign(campaign,true);
 return {db,repo,a,b,scope,source,sources,segments,segment,campaign,store,reviews:new CampaignReviews(db,scope())};
}
const decide=(reviews,id,decision='approved',note='')=>{const view=reviews.get(id);return reviews.decide(id,{decision,note,expectedDigest:view.digest,expectedReviewId:view.history[0]?.id??null});};

test('saved review preview is read-only, escaped and never claims sendable recipients or verified delivery',async()=>{
 const f=await fixture();try{
  const before=f.db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_preflights').get().n,view=f.reviews.get(f.campaign.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_preflights').get().n,before);
  assert.equal(view.sendingEnabled,false);assert.equal(view.eligibleRecipients,null);assert.equal(view.audience,null);
  assert.ok(!JSON.stringify(view).includes('not-for-client'));assert.ok(!JSON.stringify(view).includes('profile-private-01'));
  for(const code of ['consent','sender_domain','unsubscribe','dispatch'])assert.equal(view.checks.find(check=>check.code===code).state,'blocked');
  const hostile={...f.campaign,content:{...f.campaign.content,text:'<script>fetch("https://untrusted.example")</script><img src=x onerror=alert(1)>'}};f.store.saveCampaign(hostile,false);
  const rendered=f.reviews.get(f.campaign.id).html;assert.ok(!rendered.includes('<script>'));assert.ok(!rendered.includes('<img '));assert.ok(rendered.includes('&lt;script&gt;'));assert.ok(rendered.includes("default-src 'none'"));
 }finally{f.db.close();}
});

test('fresh preflight and explicit owner decision create immutable content approval; repeated decisions are idempotent',async()=>{
 const f=await fixture();try{
  assert.throws(()=>decide(f.reviews,f.campaign.id),error=>error.status===409);
  const checked=f.reviews.check(f.campaign.id,f.reviews.get(f.campaign.id).digest);assert.equal(checked.audience.matched,1);assert.equal(checked.audience.total,2);assert.equal(checked.audience.fresh,true);
  const approved=decide(f.reviews,f.campaign.id);assert.equal(approved.approval,'approved');assert.equal(approved.sendingEnabled,false);assert.equal(approved.history.length,1);assert.equal(f.store.campaign(f.campaign.id).status,'draft');
  assert.equal(decide(f.reviews,f.campaign.id).history.length,1);
  assert.throws(()=>decide(f.reviews,f.campaign.id,'revoked',''));
  assert.equal(decide(f.reviews,f.campaign.id,'revoked','Need a stronger CTA').approval,'revoked');
  assert.equal(decide(f.reviews,f.campaign.id,'rejected','Please adjust subject').history.length,3);
 }finally{f.db.close();}
});

test('live roles allow editor checks but only owners/admins approve; foreign and legacy scope are denied',async()=>{
 const f=await fixture();try{
  const editor=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'editor',password:'fixture-password-123',role:'editor'}),viewer=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'viewer',password:'fixture-password-123',role:'viewer'});
  const e=new CampaignReviews(f.db,{...f.scope(),subject:editor.userId}),v=new CampaignReviews(f.db,{...f.scope(),subject:viewer.userId});
  assert.equal(v.get(f.campaign.id).canCheck,false);assert.throws(()=>v.check(f.campaign.id,v.get(f.campaign.id).digest));
  e.check(f.campaign.id,e.get(f.campaign.id).digest);assert.equal(e.get(f.campaign.id).canApprove,false);assert.throws(()=>decide(e,f.campaign.id),error=>error.status===403);
  const other=new CampaignReviews(f.db,f.scope(f.b));assert.throws(()=>other.get(f.campaign.id),error=>error.status===404);assert.throws(()=>other.check(f.campaign.id,'x'));assert.throws(()=>decide(other,f.campaign.id));
  assert.throws(()=>new CampaignReviews(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).get(f.campaign.id));
 }finally{f.db.close();}
});

test('content edits, brand changes and optimistic decision races invalidate earlier approval',async()=>{
 const f=await fixture();try{
  f.reviews.check(f.campaign.id,f.reviews.get(f.campaign.id).digest);const old=f.reviews.get(f.campaign.id);decide(f.reviews,f.campaign.id,'rejected','Adjust content');
  assert.throws(()=>f.reviews.decide(f.campaign.id,{decision:'approved',note:'',expectedDigest:old.digest,expectedReviewId:null}),error=>error.status===409);
  f.store.saveCampaign({...f.campaign,name:'Renamed',updatedAt:new Date(Date.now()+1000).toISOString()},false);assert.equal(f.reviews.get(f.campaign.id).approval,'outdated');assert.throws(()=>f.reviews.check(f.campaign.id,old.digest));
  f.reviews.check(f.campaign.id,f.reviews.get(f.campaign.id).digest);assert.equal(decide(f.reviews,f.campaign.id).approval,'approved');
  f.repo.updateProject(f.a.userId,f.a.organizationId,f.a.projectId,{name:'New brand',website:'https://example.com',timezone:'UTC',language:'en',brandVoice:'Clear',goals:[]});assert.equal(f.reviews.get(f.campaign.id).approval,'outdated');
 }finally{f.db.close();}
});

test('approval authority loss is effective immediately without deleting historical decisions',async()=>{
 const f=await fixture();try{
  const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'reviewer',password:'fixture-password-123',role:'admin'}),reviews=new CampaignReviews(f.db,{...f.scope(),subject:admin.userId});
  reviews.check(f.campaign.id,reviews.get(f.campaign.id).digest);decide(reviews,f.campaign.id);
  f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'editor',true);
  assert.equal(f.reviews.get(f.campaign.id).approval,'revoked');assert.equal(f.reviews.get(f.campaign.id).history.length,2);
  f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'admin',true);assert.equal(f.reviews.get(f.campaign.id).approval,'revoked');
 }finally{f.db.close();}
});

test('expired previews, paused sources and changed membership data fail closed',async()=>{
 for(const mode of ['expired','paused','changed']){
  const f=await fixture();try{
   f.reviews.check(f.campaign.id,f.reviews.get(f.campaign.id).digest);
   if(mode==='expired')f.db.prepare('UPDATE platform_campaign_preflights SET checked_at=?').run('2000-01-01T00:00:00Z');
   if(mode==='paused')f.sources.setEnabled(f.source.id,1,false);
   if(mode==='changed')f.db.prepare('UPDATE platform_product_records SET attributes_json=?').run(JSON.stringify({completion:99}));
   assert.throws(()=>decide(f.reviews,f.campaign.id),error=>error.status===409);
   if(mode==='paused'){const view=f.reviews.check(f.campaign.id,f.reviews.get(f.campaign.id).digest);assert.equal(view.audience,null);assert.ok(view.audienceError);}
   if(mode==='changed'){const view=f.reviews.check(f.campaign.id,f.reviews.get(f.campaign.id).digest);assert.equal(view.audience.matched,0);assert.throws(()=>decide(f.reviews,f.campaign.id));}
  }finally{f.db.close();}
 }
});

test('missing subject, unsafe CTA, unresolved variables, oversized content and mixed channels block approval',async()=>{
 const f=await fixture();try{
  for(const patch of [{content:{...f.campaign.content,subject:'Header\r\nBCC: attacker'}},{content:{...f.campaign.content,ctaUrl:'http://example.com'}},{content:{...f.campaign.content,text:'Hello {{firstName}}'}},{content:{...f.campaign.content,text:'x'.repeat(20001)}},{channels:{...f.campaign.channels,social:['linkedin']}}]){
   f.store.saveCampaign({...f.campaign,...patch},false);const view=f.reviews.check(f.campaign.id,f.reviews.get(f.campaign.id).digest);assert.equal(view.audience,null);assert.throws(()=>decide(f.reviews,f.campaign.id));
  }
 }finally{f.db.close();}
});

test('SMTP readiness is scoped, revision-bound and expires; it never opens sender or delivery gates',async()=>{
 const f=await fixture();try{
  const smtp={host:'smtp.sendgrid.net',port:587,user:'apikey',fromEmail:'hello@example.com',fromName:'Example'};
  const connection=f.store.saveConnection({provider:'email',integrationId:'fixture',accountName:'Fixture SMTP',accessToken:'smtp-secret',smtp},KEY);
  const row=f.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(connection.id),revision=createHash('sha256').update(row.encrypted_credentials).digest('hex');
  f.db.prepare('INSERT INTO platform_connection_checks VALUES(?,?,?,?,?)').run(connection.id,revision,'verified',new Date().toISOString(),'Fixture only');
  assert.equal(f.reviews.get(f.campaign.id).checks.find(check=>check.code==='smtp').state,'pending');
  new EmailSenders(f.db,f.scope(),KEY).select({connectionId:connection.id,maxRecipients:5,expectedRevision:0});
  assert.equal(f.reviews.get(f.campaign.id).checks.find(check=>check.code==='smtp').state,'pass');
  f.db.prepare('UPDATE platform_connection_checks SET revision=?').run('changed');assert.equal(f.reviews.get(f.campaign.id).checks.find(check=>check.code==='smtp').state,'pending');
  f.db.prepare('UPDATE platform_connection_checks SET revision=?,checked_at=?').run(revision,'2000-01-01T00:00:00Z');assert.equal(f.reviews.get(f.campaign.id).checks.find(check=>check.code==='smtp').state,'pending');
  assert.equal(f.reviews.get(f.campaign.id).eligibleRecipients,null);
 }finally{f.db.close();}
});

test('campaign deletion prunes preflight but retains decision audit history; review quota persists',async()=>{
 const f=await fixture();try{
  f.reviews.check(f.campaign.id,f.reviews.get(f.campaign.id).digest);decide(f.reviews,f.campaign.id);
  f.db.prepare("UPDATE platform_usage SET count=100 WHERE resource='campaign_review'").run();assert.throws(()=>decide(f.reviews,f.campaign.id,'rejected','Change'),error=>error.status===429);
  f.store.deleteCampaign(f.campaign.id);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_preflights').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_reviews').get().n,1);
  assert.equal(f.db.pragma('foreign_key_check').length,0);
 }finally{f.db.close();}
});

test('migration 14 is additive and repeatable with campaigns and pinned segments intact',async()=>{
 const f=await fixture(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'review-migration-')),'fixture.sqlite');let db;
 try{
  f.db.exec('DROP TABLE platform_campaign_preflights; DROP TABLE platform_campaign_reviews; DROP INDEX platform_campaign_scoped_identity; DELETE FROM platform_migrations WHERE version=14;');await f.db.backup(file);db=openPlatformDatabase(file);
  assert.equal(new ProjectMarketingStore(db,f.scope()).campaign(f.campaign.id).segmentBinding.segmentVersion,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_segments').get().n,1);
  db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_reviews').get().n,0);assert.equal(db.pragma('foreign_key_check').length,0);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
 }finally{db?.close();f.db.close();}
});
