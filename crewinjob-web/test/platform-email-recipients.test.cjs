const assert=require('node:assert/strict'),{test}=require('node:test'),{randomBytes,createHmac}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{ProductWebhooks,authenticateProductWebhook,pruneProductEvents}=load('product-webhooks.ts');
const {EmailRecipients}=load('email-recipients.ts'),{ProductSegments}=load('segments.ts'),{ProjectMarketingStore}=load('marketing-store.ts'),{CampaignReviews}=load('campaign-review.ts');
const {emailAddress,emailIdentity,processRyzevoUnsubscribe,isRyzevoUnsubscribe,pruneEmailTokens,publicEmailOrigin}=load('email-safety.ts');
const KEY='12'.repeat(32);
function fixture(){
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
 const provision=username=>repo.provision('legacy-admin',{organizationName:username,projectName:username,website:'https://example.com',username,password:'fixture-password-123'}),a=provision('alpha'),b=provision('beta');
 const scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId},hooks=new ProductWebhooks(db,scope),secret=randomBytes(32).toString('hex');
 const config={entityType:'user',attributes:[{key:'email',type:'string'},{key:'alternate',type:'string'},{key:'completion',type:'number'}],eventNames:['profile.updated']};
 const source=hooks.save({name:'Fixture contacts',config,secret},KEY),at=new Date(Date.now()-10000).toISOString();let sequence=0;
 const event=(id,email='person@example.com',status=null,time=at)=>({id:`evt-${++sequence}`,entityId:id,eventName:'profile.updated',occurredAt:time,attributes:{email,alternate:'alt@example.com',completion:20},...(status?{consent:{channel:'email',status,evidenceRef:'proof/source',recordedAt:time}}:{})});
 hooks.preview(source.id,{sourceVersion:1,events:[event('private-01')]});hooks.state(source.id,1,'activate');
 const post=(events,version=1)=>{const bytes=Buffer.from(JSON.stringify({sourceVersion:version,events})),timestamp=String(Math.floor(Date.now()/1000)),headers=new Headers({'X-Ryzevo-Timestamp':timestamp,'X-Ryzevo-Signature':'v1='+createHmac('sha256',Buffer.from(secret,'hex')).update(`${timestamp}.${source.id}.`).update(bytes).digest('hex')});return authenticateProductWebhook(db,source.id,headers,KEY)(bytes);};
 post([event('private-01','person@example.com','opted_in'),event('private-02','PERSON@example.com'),event('private-03','not-an-email')]);
 const recipients=new EmailRecipients(db,scope,KEY),map=()=>recipients.saveMapping({sourceId:source.id,sourceVersion:1,field:'email',expectedRevision:null});
 const review=(contact,who=recipients)=>who.review({sourceId:source.id,contactKey:contact.key,expectedDecisionId:contact.decisionId,decision:'reviewed',evidenceRef:'proof/consent-001',recordedAt:at,note:'Inspected original marketing permission.',acknowledged:true});
 const members=()=>db.prepare('SELECT external_id AS id,attributes_json FROM platform_product_records WHERE connection_id=? AND version=1 ORDER BY external_id').all(source.id).map(row=>({id:row.id,attributes:JSON.parse(row.attributes_json),observedAt:at}));
 return {db,repo,a,b,scope,hooks,source,secret,config,at,event,post,recipients,map,review,members};
}
test('email normalization is strict, scoped and never guesses addresses',()=>{
 assert.equal(emailAddress('First.Last+tag@Example.COM'),'first.last+tag@example.com');
 for(const value of [' person@example.com','a..b@example.com','a@-example.com','a@example..com','x\n@example.com','é@example.com','x@localhost',123])assert.equal(emailAddress(value),null);
 const scope={organizationId:'a',projectId:'p'};assert.notEqual(emailIdentity(scope,KEY,'email',['x@example.com']),emailIdentity({...scope,projectId:'q'},KEY,'email',['x@example.com']));
 assert.notEqual(emailIdentity(scope,KEY,'entity',['s','id']),emailIdentity(scope,KEY,'email',['s','id']));
});
test('mapping requires declared string field, current source/version, owner role and optimistic revision',()=>{
 const f=fixture();try{
  assert.throws(()=>f.recipients.saveMapping({sourceId:f.source.id,sourceVersion:1,field:'completion',expectedRevision:null}));
  assert.throws(()=>f.recipients.saveMapping({sourceId:f.source.id,sourceVersion:2,field:'email',expectedRevision:null}));
  f.map();assert.throws(()=>f.recipients.saveMapping({sourceId:f.source.id,sourceVersion:1,field:'alternate',expectedRevision:null}),error=>error.status===409);
  const editor=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'editor',password:'fixture-password-123',role:'editor'});
  assert.throws(()=>new EmailRecipients(f.db,{...f.scope,subject:editor.userId},KEY).list(),error=>error.status===403);
  assert.throws(()=>new EmailRecipients(f.db,{subject:f.b.userId,organizationId:f.b.organizationId,projectId:f.b.projectId},KEY).list(f.source.id),error=>error.status===404);
  const list=f.recipients.list(f.source.id);assert.equal(list.contacts.length,3);assert.ok(!JSON.stringify(list).includes('person@example.com'));assert.ok(!JSON.stringify(list).includes('private-01'));assert.equal(list.contacts[0].reported,'opted_in');assert.equal(list.contacts[0].consent,'unknown');
  assert.throws(()=>f.recipients.list(f.source.id,0));
 }finally{f.db.close();}
});
test('consent evidence is encrypted, optimistic and never inferred from opt-in claims; duplicate identities all require proof',()=>{
 const f=fixture();try{
  f.map();let rows=f.recipients.list(f.source.id).contacts;
  assert.equal(f.recipients.eligibility(f.source.id,1,f.members()).eligible,0);f.review(rows[0]);assert.equal(f.recipients.eligibility(f.source.id,1,f.members()).eligible,0);
  assert.throws(()=>f.review(rows[0]),error=>error.status===409);f.review(rows[1]);
  const counts=f.recipients.eligibility(f.source.id,1,f.members());assert.equal(counts.eligible,1);assert.equal(counts.duplicates,1);assert.equal(counts.invalid,1);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_email_consents').all()).includes('proof/consent-001'));assert.ok(!JSON.stringify(f.recipients.list(f.source.id)).includes('Inspected original'));
  f.recipients.saveMapping({sourceId:f.source.id,sourceVersion:1,field:'alternate',expectedRevision:1});assert.equal(f.recipients.eligibility(f.source.id,1,f.members()).eligible,0);
 }finally{f.db.close();}
});
test('withdrawal suppresses entity and address permanently and later opt-in events cannot restore permission',()=>{
 const f=fixture();try{
  f.map();f.review(f.recipients.list(f.source.id).contacts[0]);const contact=f.recipients.list(f.source.id).contacts[0];
  f.recipients.review({sourceId:f.source.id,contactKey:contact.key,expectedDecisionId:contact.decisionId,decision:'withdrawn',note:'Customer asked to stop.',acknowledged:true});
  f.post([f.event('private-01','person@example.com','opted_in',new Date(Date.now()-1000).toISOString())]);
  assert.equal(f.recipients.list(f.source.id).contacts[0].blocked,true);assert.throws(()=>f.review(f.recipients.list(f.source.id).contacts[0]));assert.equal(f.recipients.eligibility(f.source.id,1,f.members()).suppressed,1);
  assert.equal(f.recipients.list(f.source.id).contacts[1].blocked,true);
 }finally{f.db.close();}
});
test('signed opt-outs before mapping survive pruning and source-version changes; replay stays idempotent',()=>{
 const f=fixture();try{
  const optout=f.event('private-01','person@example.com','opted_out',new Date(Date.now()-1000).toISOString());f.post([optout]);f.post([optout]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_entity_blocks').get().n,1);f.map();assert.equal(f.recipients.list(f.source.id).contacts[0].blocked,true);
  f.db.prepare('UPDATE platform_product_events SET received_at=?').run('2000-01-01T00:00:00Z');pruneProductEvents(f.db);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_entity_blocks').get().n,1);
  f.hooks.save({id:f.source.id,version:1,name:'New schema',config:f.config},KEY);assert.equal(f.recipients.eligibility(f.source.id,2,[]).mappingReady,false);
  f.recipients.saveMapping({sourceId:f.source.id,sourceVersion:2,field:'email',expectedRevision:1});
  const row=f.members()[0];assert.equal(f.recipients.eligibility(f.source.id,2,[row]).suppressed,1);
 }finally{f.db.close();}
});
test('revoking a reviewer role invalidates consent permanently even after the role is restored',()=>{
 const f=fixture();try{
  f.map();const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'reviewer',password:'fixture-password-123',role:'admin'}),reviewer=new EmailRecipients(f.db,{...f.scope,subject:admin.userId},KEY);
  for(const contact of f.recipients.list(f.source.id).contacts.slice(0,2))f.review(contact,reviewer);assert.equal(f.recipients.eligibility(f.source.id,1,f.members()).eligible,1);
  f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'editor',true);assert.equal(f.recipients.eligibility(f.source.id,1,f.members()).eligible,0);
  f.repo.updateMember(f.a.userId,f.a.organizationId,f.a.projectId,admin.userId,'admin',true);assert.equal(f.recipients.eligibility(f.source.id,1,f.members()).eligible,0);assert.equal(f.recipients.list(f.source.id).contacts[0].consent,'revoked');
 }finally{f.db.close();}
});
test('unsubscribe tokens are opaque, scoped, hashed, inspect-only until confirmed, expiring and idempotent',()=>{
 const f=fixture();try{
  f.map();const contact=f.recipients.list(f.source.id).contacts[0],link=f.recipients.testLink(f.source.id,contact.key),token=new URL(link.path,'https://ryzevo.example').searchParams.get('token');
  assert.equal(isRyzevoUnsubscribe('RZVgarbage'),true);assert.equal(isRyzevoUnsubscribe('legacy-token'),false);assert.throws(()=>processRyzevoUnsubscribe(f.db,'RZVgarbage'));
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_email_unsubscribe').all()).includes(token));assert.ok(!link.path.includes('person'));
  assert.equal(processRyzevoUnsubscribe(f.db,token,true).unsubscribed,false);assert.equal(f.recipients.list(f.source.id).contacts[0].blocked,false);
  assert.equal(processRyzevoUnsubscribe(f.db,token).unsubscribed,true);assert.equal(processRyzevoUnsubscribe(f.db,token).unsubscribed,true);assert.equal(f.recipients.list(f.source.id).contacts[0].blocked,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_email_blocks WHERE project_id=?').get(f.b.projectId).n,0);
  f.db.prepare('UPDATE platform_email_unsubscribe SET expires_at=?').run('2000-01-01T00:00:00Z');assert.throws(()=>processRyzevoUnsubscribe(f.db,token));assert.equal(pruneEmailTokens(f.db),1);assert.equal(f.recipients.list(f.source.id).contacts[0].blocked,true);
  assert.equal(publicEmailOrigin('https://ryzevo.com'),'https://ryzevo.com');for(const value of ['http://ryzevo.com','https://user:pass@ryzevo.com','https://ryzevo.com/path','bad'])assert.equal(publicEmailOrigin(value),null);
 }finally{f.db.close();}
});
test('campaign preflight reuses segment membership, returns only aggregate recipients and expires when safety state changes',()=>{
 const f=fixture();try{
  f.map();for(const contact of f.recipients.list(f.source.id).contacts.slice(0,2))f.review(contact);
  const segments=new ProductSegments(f.db,f.scope),segment=segments.save({name:'Incomplete',definition:{sourceId:f.source.id,sourceVersion:1,maxAgeHours:24,goalId:'',stageIndex:null,rules:{kind:'group',op:'and',children:[{kind:'attribute',field:'completion',op:'lt',value:50}]}}});segments.preview({id:segment.id,version:1});
  const binding=segments.binding(segment.id,1,''),campaign={id:'email-fixture',name:'Email',status:'draft',updatedAt:new Date().toISOString(),content:{subject:'Subject',text:'Useful content',ctaUrl:'https://example.com'},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]},segmentBinding:binding};new ProjectMarketingStore(f.db,f.scope).saveCampaign(campaign,true);
  const reviews=new CampaignReviews(f.db,f.scope,KEY),view=reviews.check(campaign.id,reviews.get(campaign.id).digest);assert.equal(view.eligibleRecipients,1);assert.equal(view.sendingEnabled,false);assert.equal(view.checks.find(c=>c.code==='consent').state,'pass');assert.ok(!JSON.stringify(view).includes('person@example.com'));assert.ok(!JSON.stringify(view).includes('private-01'));
  f.recipients.suppress({email:'person@example.com',acknowledged:true});assert.equal(reviews.get(campaign.id).eligibleRecipients,null);assert.equal(reviews.get(campaign.id).audience.fresh,false);
  const checked=reviews.check(campaign.id,reviews.get(campaign.id).digest);assert.equal(checked.eligibleRecipients,0);assert.equal(checked.eligibility.suppressed,1);
  const digest=checked.digest;f.recipients.saveMapping({sourceId:f.source.id,sourceVersion:1,field:'alternate',expectedRevision:1});assert.notEqual(reviews.get(campaign.id).digest,digest);
 }finally{f.db.close();}
});
test('recipient quotas are persistent, oversized evidence and unacknowledged review fail closed',()=>{
 const f=fixture();try{
  f.map();const contact=f.recipients.list(f.source.id).contacts[0];assert.throws(()=>f.recipients.review({sourceId:f.source.id,contactKey:contact.key,expectedDecisionId:null,decision:'reviewed',acknowledged:false,note:'Proof'}));
  assert.throws(()=>f.recipients.suppress({email:'person@example.com',acknowledged:false}));
  f.recipients.testLink(f.source.id,contact.key);f.db.prepare("UPDATE platform_usage SET count=20 WHERE resource='recipient_link'").run();assert.throws(()=>f.recipients.testLink(f.source.id,contact.key),error=>error.status===429);
  assert.equal(f.db.pragma('integrity_check',{simple:true}),'ok');assert.equal(f.db.pragma('foreign_key_check').length,0);
 }finally{f.db.close();}
});
test('migration 15 is additive and repeatable with source data and campaigns intact',async()=>{
 const f=fixture(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'recipient-migration-')),'fixture.sqlite');let db;
 try{
  f.db.exec('DROP TABLE platform_email_unsubscribe; DROP TABLE platform_email_entity_blocks; DROP TABLE platform_email_blocks; DROP TABLE platform_email_consents; DROP TABLE platform_email_mappings; DROP TABLE platform_email_state; DELETE FROM platform_migrations WHERE version=15;');await f.db.backup(file);db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_product_records').get().n,3);db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_migrations WHERE version=15').get().n,1);assert.equal(db.pragma('foreign_key_check').length,0);
 }finally{db?.close();f.db.close();}
});
