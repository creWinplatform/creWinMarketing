const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SocialPublications}=load('social-publications.ts'),{LinkTracking,linkTag,tagOwnLinks,linkPeriod,syncDueLinkResults}=load('link-tracking.ts'),{readGoogleLinkResults}=load('measurement-google.ts');
const {coachStarterRefresh}=load('coach-refresh.ts');
process.env.PLATFORM_LINKEDIN_CLIENT_ID='fixture-client';process.env.PLATFORM_LINKEDIN_CLIENT_SECRET='private-fixture-secret';process.env.PLATFORM_LINKEDIN_REDIRECT_URI='http://localhost:3033/api/platform/social/callback';process.env.PLATFORM_LINKEDIN_API_VERSION='202609';
const plain=value=>JSON.parse(JSON.stringify(value));
const fresh=async credentials=>credentials;
function setup(){
 const f=fixture();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';
 f.linkedin=f.store.saveConnection({provider:'social',integrationId:'unused-client-id',accountName:'Fixture LinkedIn',accessToken:'private-social-token',expiresAt:Date.now()+86400000,social:{platform:'linkedin',accountId:'fixture_member'}},KEY);
 f.ga=f.store.saveConnection({provider:'ga4',integrationId:'12345',accountName:'Fixture GA4',accessToken:'private-report-token'},KEY);
 f.content={id:'link-draft',platform:'linkedin',language:'tr',content:'Yeni rehberimiz: https://example.com/rehber?ref=x. Ayrıca https://other.example.org/a ve https://blog.example.com/yazi#bolum',headline:'Rehber',prompt:'',timestamp:Date.now()};f.store.saveContent(f.content,true);
 f.social=new SocialPublications(f.db,f.scope,KEY);f.links=new LinkTracking(f.db,f.scope,KEY);
 f.source=()=>f.social.workspace().sources.find(item=>item.id===f.content.id);
 f.input=(overrides={})=>({sourceKind:'content',sourceId:f.content.id,connectionId:f.linkedin.id,expectedDigest:f.source().digest,expectedTargetRevision:f.social.workspace().targets.find(item=>item.id===f.linkedin.id).revision,mode:'rehearsal',idempotencyKey:'link-fixture-intent',...overrides});
 // An accepted live post, without contacting LinkedIn: a rehearsal row promoted the way the worker settles one.
 f.accept=(overrides={},submittedAt=new Date(Date.now()-5*86400000).toISOString())=>{const job=f.social.enqueue(f.input(overrides));f.db.prepare("UPDATE platform_social_publications SET mode='publish',state='accepted',submitted_at=?,provider_post_id='urn:li:share:1' WHERE job_id=?").run(submittedAt,job.id);f.db.prepare("UPDATE platform_jobs SET status='completed' WHERE id=?").run(job.id);return f.social.get(job.id);};
 f.tag=linkTag(f.scope,'content',f.content.id);
 f.report=(rows,status='ready')=>async input=>{f.requests=(f.requests||[]).concat([input]);return {status,rows,timezone:'Europe/Istanbul',checkedAt:new Date().toISOString()};};
 return f;
}
const close=async work=>{const f=setup();try{await work(f);}finally{f.db.close();}};

test('only links to the project site are tagged; other sites, existing utm and Instagram stay as written',()=>{
 const tag='rz_0123456789';
 const out=tagOwnLinks('A https://www.example.com/a?x=1. B https://shop.example.com/b#top) C https://example.org/c D https://example.com/d?utm_source=news E https://notexample.com/e',"https://example.com",'linkedin',tag);
 assert.equal(out.tagged,2);
 assert.match(out.text,/https:\/\/www\.example\.com\/a\?x=1&utm_source=linkedin&utm_medium=social&utm_campaign=rz_0123456789\. B/);
 assert.match(out.text,/https:\/\/shop\.example\.com\/b\?utm_source=linkedin&utm_medium=social&utm_campaign=rz_0123456789#top\) C/);
 assert.match(out.text,/C https:\/\/example\.org\/c D https:\/\/example\.com\/d\?utm_source=news E https:\/\/notexample\.com\/e$/);
 assert.equal(tagOwnLinks('https://example.com/a','https://example.com','instagram',tag).tagged,0,'Instagram captions are not clickable');
 assert.equal(tagOwnLinks('https://example.com/a','https://example.com','twitter',tag).text,'https://example.com/a?utm_source=x&utm_medium=social&utm_campaign=rz_0123456789');
 assert.equal(tagOwnLinks('https://user:pw@example.com/a','https://example.com','linkedin',tag).tagged,0);
 assert.equal(tagOwnLinks('https://example.com/a','https://example.com','linkedin','not-a-tag').tagged,0);
});

test('the preview shows the tagged text, the approved snapshot keeps it and turning tagging off changes the digest',()=>close(async f=>{
 const source=f.source();assert.equal(source.trackedLinks,2);assert.ok(source.text.includes(`utm_campaign=${f.tag}`));assert.ok(source.text.includes('https://other.example.org/a ve'),'other sites untouched');
 const job=f.social.enqueue(f.input());assert.equal(job.text,source.text);assert.equal(f.db.prepare('SELECT link_tag FROM platform_social_publications WHERE job_id=?').get(job.id).link_tag,f.tag);
 const stale=f.input({idempotencyKey:'link-fixture-off'});f.links.configure({enabled:false,connectionId:null});
 const off=f.source();assert.equal(off.trackedLinks,undefined);assert.equal(off.text,f.content.content);assert.notEqual(off.digest,source.digest);
 assert.throws(()=>f.social.enqueue(stale),error=>error.status===409,'an approval made with tagging on cannot queue untagged text');
 const untagged=f.social.enqueue(f.input({idempotencyKey:'link-fixture-untagged'}));assert.equal(f.db.prepare('SELECT link_tag FROM platform_social_publications WHERE job_id=?').get(untagged.id).link_tag,null);
 await f.social.process(job.id);assert.equal(f.social.get(job.id).state,'blocked','a queued tagged post is re-reviewed after the setting changed');
}));

test('settings are owner-only, need an active GA4 connection of the project and changing the property drops results',()=>close(async f=>{
 assert.equal(f.links.view().enabled,true);assert.equal(f.links.view().connectionId,null);
 const viewer=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'link-viewer',password:'fixture-password-123',role:'viewer'}),service=new LinkTracking(f.db,{...f.scope,subject:viewer.userId},KEY);
 assert.equal(service.view().connections.length,0);assert.throws(()=>service.configure({enabled:true,connectionId:f.ga.id}),error=>error.status===403);
 assert.throws(()=>new LinkTracking(f.db,f.other,KEY).configure({enabled:true,connectionId:f.ga.id}),error=>error.status===409,'another project cannot use this connection');
 for(const bad of [{enabled:'yes',connectionId:null},{enabled:true,connectionId:f.ga.id,managerId:'x'},{enabled:true}])assert.throws(()=>f.links.configure(bad));
 assert.throws(()=>f.links.configure({enabled:true,connectionId:f.linkedin.id}),error=>error.status===409,'only GA4 connections');
 f.links.configure({enabled:true,connectionId:f.ga.id});f.accept();await f.links.refresh(f.report([{tag:f.tag,source:'linkedin',sessions:4,keyEvents:1}]),fresh);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_link_results').get().n,1);
 const second=f.store.saveConnection({provider:'ga4',integrationId:'67890',accountName:'Second GA4',accessToken:'private-second'},KEY);f.links.configure({enabled:true,connectionId:second.id});
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_link_results').get().n,0);assert.equal(f.links.view().checkedAt,null);
 assert.ok(!JSON.stringify(f.links.view()).includes('private-report-token'));
}));

test('GA4 results appear under the accepted post; no row is "none", a later post waits and missing data is never zero',()=>close(async f=>{
 const post=f.accept();assert.equal(post.site.status,'not_connected');
 f.links.configure({enabled:true,connectionId:f.ga.id});assert.equal(f.social.get(post.id).site.status,'pending');
 await f.links.refresh(f.report([{tag:f.tag,source:'linkedin',sessions:43,keyEvents:3},{tag:f.tag,source:'facebook',sessions:9,keyEvents:0}]),fresh);
 const period=linkPeriod();assert.equal(f.requests[0].resource,'12345');assert.equal(f.requests[0].from,period.from);assert.equal(f.requests[0].to,period.to);assert.equal(f.requests[0].token,'private-report-token');
 let site=f.social.get(post.id).site;assert.equal(site.status,'ready');assert.equal(site.sessions,43,'only the linkedin row of this tag');assert.equal(site.keyEvents,3);
 f.db.prepare('DELETE FROM platform_link_results').run();site=f.social.get(post.id).site;assert.equal(site.status,'none');assert.equal(site.sessions,null);
 f.db.prepare("UPDATE platform_social_publications SET submitted_at=? WHERE job_id=?").run(new Date().toISOString(),post.id);assert.equal(f.social.get(post.id).site.status,'pending','published after the measured period');
 const rehearsal=f.social.enqueue(f.input({idempotencyKey:'link-rehearsal'}));assert.equal(f.social.get(rehearsal.id).site,undefined,'rehearsals have no site result');
}));

test('a failed read keeps the last result, a lost connection blocks and clears it, and reads are rate-limited and leased',()=>close(async f=>{
 f.links.configure({enabled:true,connectionId:f.ga.id});const post=f.accept();
 await f.links.refresh(f.report([{tag:f.tag,source:'linkedin',sessions:5,keyEvents:2}]),fresh);
 await assert.rejects(()=>f.links.refresh(f.report([]),fresh),error=>error.status===429,'manual refresh every 10 minutes');
 const backdate=()=>f.db.prepare('UPDATE platform_link_tracking SET attempted_at=?').run(new Date(Date.now()-11*60000).toISOString());
 backdate();await f.links.refresh(async()=>{throw new Error('provider down');},fresh);
 let view=f.links.view();assert.equal(view.state,'failed');assert.equal(view.reason,'provider_unavailable');assert.equal(f.social.get(post.id).site.sessions,5,'last good result kept');
 backdate();await f.links.refresh(async()=>{f.db.prepare('UPDATE platform_connections SET active=0 WHERE id=?').run(f.ga.id);return {status:'ready',rows:[{tag:f.tag,source:'linkedin',sessions:99,keyEvents:0}],timezone:'UTC',checkedAt:new Date().toISOString()};},fresh).catch(()=>{});
 view=f.links.view();assert.equal(view.state,'blocked');assert.equal(view.reason,'changed');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_link_results').get().n,0,'nothing from a changed connection is stored');
 f.db.prepare('UPDATE platform_connections SET active=1 WHERE id=?').run(f.ga.id);
 f.db.prepare("UPDATE platform_link_tracking SET state='refreshing',lease_token='other',lease_until=?,attempted_at=NULL").run(new Date(Date.now()+60000).toISOString());
 await assert.rejects(()=>f.links.refresh(f.report([]),fresh),error=>error.status===429,'a running read is not overlapped');
 f.db.prepare("UPDATE platform_link_tracking SET state='ready',lease_token=NULL,lease_until=NULL").run();
 f.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'link_results',24) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=24").run(f.a.organizationId,f.a.projectId,new Date().toISOString().slice(0,10));
 await assert.rejects(()=>f.links.refresh(f.report([]),fresh),error=>error.status===429,'daily read cap');
}));

test('the worker reads one due project as the person who chose the property, and not after that person loses access',()=>close(async f=>{
 f.links.configure({enabled:true,connectionId:f.ga.id});f.accept();
 assert.equal(await syncDueLinkResults(f.db,KEY,f.report([{tag:f.tag,source:'linkedin',sessions:7,keyEvents:1}]),fresh),1);
 assert.equal(f.links.view().state,'ready');assert.ok(Date.parse(f.links.view().nextSyncAt)>Date.now()+23*3600000);
 assert.equal(await syncDueLinkResults(f.db,KEY,f.report([]),fresh),0,'not due again until tomorrow');
 const admin=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'link-admin',password:'fixture-password-123',role:'admin'});
 new LinkTracking(f.db,{...f.scope,subject:admin.userId},KEY).configure({enabled:true,connectionId:f.ga.id});
 f.db.prepare("UPDATE platform_memberships SET role='viewer' WHERE user_id=?").run(admin.userId);f.db.prepare('UPDATE platform_link_tracking SET next_sync_at=?').run(new Date(Date.now()-1000).toISOString());
 await syncDueLinkResults(f.db,KEY,async()=>assert.fail('read without authority'),fresh);assert.equal(f.links.view().state,'blocked');
}));

test('GA4 link report asks for sessions and key events per Ryzevo tag and source and keeps only valid rows',async()=>{
 const original=globalThis.fetch,calls=[];let payload;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(payload);};
 const input={resource:'12345',from:'2026-07-01',to:'2026-09-28',token:'fixture-only'},headers={dimensionHeaders:[{name:'sessionCampaignName'},{name:'sessionSource'}],metricHeaders:[{name:'sessions'},{name:'keyEvents'}],metadata:{timeZone:'Europe/Istanbul'}};
 try{
  payload={...headers,rowCount:3,rows:[{dimensionValues:[{value:'rz_0123456789'},{value:'linkedin'}],metricValues:[{value:'12'},{value:'2'}]},{dimensionValues:[{value:'rz_summer'},{value:'linkedin'}],metricValues:[{value:'5'},{value:'0'}]},{dimensionValues:[{value:'rz_0123456789'},{value:'LinkedIn Ads!'}],metricValues:[{value:'1'},{value:'0'}]}]};
  const report=await readGoogleLinkResults(input);assert.equal(report.status,'ready');assert.deepEqual(plain(report.rows),[{tag:'rz_0123456789',source:'linkedin',sessions:12,keyEvents:2}]);
  const body=JSON.parse(calls[0].options.body);assert.equal(calls[0].url,'https://analyticsdata.googleapis.com/v1beta/properties/12345:runReport');assert.equal(calls[0].options.redirect,'error');
  assert.deepEqual(plain(body.dimensions.map(item=>item.name)),['sessionCampaignName','sessionSource']);assert.deepEqual(plain(body.metrics.map(item=>item.name)),['sessions','keyEvents']);assert.equal(body.dimensionFilter.filter.stringFilter.matchType,'BEGINS_WITH');assert.equal(body.dimensionFilter.filter.stringFilter.value,'rz_');
  payload={...headers,rowCount:2,rows:[{dimensionValues:[{value:'(other)'},{value:'(other)'}],metricValues:[{value:'3'},{value:'0'}]},{dimensionValues:[{value:'rz_0123456789'},{value:'x'}],metricValues:[{value:'1'},{value:'0'}]}]};
  assert.equal((await readGoogleLinkResults(input)).status,'partial','the (other) row hides some tags');
  payload={...headers,rowCount:5000,rows:[{dimensionValues:[{value:'rz_0123456789'},{value:'x'}],metricValues:[{value:'1'},{value:'0'}]}]};assert.equal((await readGoogleLinkResults(input)).status,'partial','truncated table');
  payload={...headers,metadata:{timeZone:'UTC',subjectToThresholding:true},rows:[{dimensionValues:[{value:'rz_0123456789'},{value:'x'}],metricValues:[{value:'1'},{value:'0'}]}]};assert.equal((await readGoogleLinkResults(input)).status,'partial');
  payload={metadata:{timeZone:'UTC'}};assert.equal((await readGoogleLinkResults(input)).status,'no_data');
  payload={...headers,rows:[{dimensionValues:[{value:'rz_0123456789'},{value:'x'}],metricValues:[{value:'-1'},{value:'0'}]}]};await assert.rejects(()=>readGoogleLinkResults(input));
  payload={...headers,metricHeaders:[{name:'totalRevenue'},{name:'keyEvents'}],rows:[{dimensionValues:[{value:'rz_0123456789'},{value:'x'}],metricValues:[{value:'1'},{value:'0'}]}]};await assert.rejects(()=>readGoogleLinkResults(input));
  await assert.rejects(()=>readGoogleLinkResults({...input,resource:'properties/12345'}));
 }finally{globalThis.fetch=original;}
});

test('the learning view and the monthly renewal use visits per channel as an observation, not a cause',()=>close(async f=>{
 f.links.configure({enabled:true,connectionId:f.ga.id});f.accept();
 const second={...f.content,id:'link-draft-2',headline:'İkinci rehber'};f.store.saveContent(second,true);
 const job=f.social.enqueue({...f.input(),sourceId:second.id,expectedDigest:f.social.workspace().sources.find(item=>item.id===second.id).digest,idempotencyKey:'link-second'});
 f.db.prepare("UPDATE platform_social_publications SET mode='publish',state='accepted',submitted_at=? WHERE job_id=?").run(new Date(Date.now()-3*86400000).toISOString(),job.id);
 await f.links.refresh(f.report([{tag:f.tag,source:'linkedin',sessions:30,keyEvents:2},{tag:linkTag(f.scope,'content',second.id),source:'linkedin',sessions:12,keyEvents:0}]),fresh);
 const summary=f.links.summary();assert.equal(summary.posts,2);assert.deepEqual(plain(summary.byChannel),[{source:'linkedin',posts:2,sessions:42,keyEvents:2}]);assert.deepEqual(plain(summary.top.map(item=>[item.title,item.sessions])),[['Rehber',30],['İkinci rehber',12]]);
 const plan=[{week:1,title:'Draft for Instagram',why:'w',how:'h',minutes:30,tool:'library',channel:'instagram'},{week:2,title:'Post on LinkedIn',why:'w',how:'h',minutes:30,tool:'library',channel:'linkedin'}];
 const brief={language:'en',icp:{summary:'Shop owners',pains:['Time']},positioning:'Simple books',channels:[{id:'instagram',rationale:'r'},{id:'linkedin',rationale:'r'}],plan};
 const facts={from:new Date(Date.now()-25*86400000).toISOString(),to:new Date().toISOString(),planWeek:4,plan:plan.map(item=>({...item,state:'open'})),drafts:{instagram:2,linkedin:2},publications:2,emailRecipients:0,measurements:[],leader:null,
  site:{from:summary.from,to:summary.to,partial:false,byChannel:[{channel:'linkedin',posts:2,sessions:42,keyEvents:2},{channel:'facebook',posts:1,sessions:3,keyEvents:0}]}};
 const {brief:next,reasons}=coachStarterRefresh(brief,facts,null,'Acme',false);
 assert.deepEqual(plain(next.channels.map(item=>item.id)),['linkedin','instagram']);assert.ok(reasons.some(item=>/42 sessions/.test(item.why)&&/not proof of cause/.test(item.why)));
 const thin=coachStarterRefresh(brief,{...facts,site:{...facts.site,byChannel:[{channel:'linkedin',posts:1,sessions:42,keyEvents:0},{channel:'facebook',posts:1,sessions:3,keyEvents:0}]}},null,'Acme',false);
 assert.equal(thin.brief.channels[0].id,'instagram','one post is not enough to reorder channels');
 const engagement=coachStarterRefresh(brief,{...facts,leader:{dimension:'channel',key:'instagram',average:5,observed:2}},null,'Acme',false);assert.equal(engagement.brief.channels[0].id,'instagram','an engagement leader keeps priority');
}));

test('migration 57 is additive and repeatable',async()=>{
 const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'link-tracking-')),'fixture.sqlite');
 let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeLinkTrackingSchema(db);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('platform_link_tracking','platform_link_results')").get().n,0);db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,57);assert.ok(db.prepare("SELECT name FROM pragma_table_info('platform_social_publications')").all().some(item=>item.name==='link_tag'));assert.equal(db.pragma('foreign_key_check').length,0);db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_migrations WHERE version=57').get().n,1);db.close();
});
