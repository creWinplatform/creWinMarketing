const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {MonthlyReports,openSharedReport}=load('monthly-report.ts'),{SocialPublications}=load('social-publications.ts'),{LinkTracking,linkTag,syncLinkResults}=load('link-tracking.ts');
const {zonedInstant}=load('coach.ts'),{coachMonthKey}=load('coach-content.ts');
process.env.PLATFORM_LINKEDIN_CLIENT_ID='fixture-client';process.env.PLATFORM_LINKEDIN_CLIENT_SECRET='private-fixture-secret';process.env.PLATFORM_LINKEDIN_REDIRECT_URI='http://localhost:3033/api/platform/social/callback';process.env.PLATFORM_LINKEDIN_API_VERSION='202609';
const plain=value=>JSON.parse(JSON.stringify(value));
function setup(){
 const f=fixture(),zone=f.repo.workspace(f.a.userId,f.a.organizationId,f.a.projectId).project.timezone;
 f.month=coachMonthKey(new Date(),-1,zone);f.mid=zonedInstant(`${f.month}-15`,12,zone);f.reports=new MonthlyReports(f.db,f.scope);
 f.linkedin=f.store.saveConnection({provider:'social',integrationId:'unused',accountName:'Fixture LinkedIn',accessToken:'private-social-token',expiresAt:Date.now()+86400000,social:{platform:'linkedin',accountId:'fixture_member'}},KEY);
 f.ga=f.store.saveConnection({provider:'ga4',integrationId:'12345',accountName:'Fixture GA4',accessToken:'private-report-token'},KEY);
 f.social=new SocialPublications(f.db,f.scope,KEY);
 // One accepted live post in the reported month, with a tagged link, provider engagement and a stub GA4 reading.
 f.post=async()=>{
  f.store.saveContent({id:'report-post',platform:'linkedin',language:'tr',headline:'Kayıt rehberi',content:'Rehber: https://example.com/rehber',prompt:'',timestamp:Date.parse(f.mid)},true);
  const source=f.social.workspace().sources.find(item=>item.id==='report-post'),target=f.social.workspace().targets.find(item=>item.id===f.linkedin.id);
  const job=f.social.enqueue({sourceKind:'content',sourceId:'report-post',connectionId:f.linkedin.id,expectedDigest:source.digest,expectedTargetRevision:target.revision,mode:'rehearsal',idempotencyKey:'report-post-intent'});
  f.db.prepare("UPDATE platform_social_publications SET mode='publish',state='accepted',submitted_at=?,provider_url='https://www.linkedin.com/feed/update/urn:li:share:1' WHERE job_id=?").run(f.mid,job.id);
  f.db.prepare("INSERT INTO platform_social_engagement(job_id,organization_id,project_id,attempted_at,state,counts_json,observed_at) VALUES(?,?,?,?,'ready',?,?)").run(job.id,f.a.organizationId,f.a.projectId,f.mid,JSON.stringify({likes:5,comments:2,impressions:900}),f.mid);
  new LinkTracking(f.db,f.scope,KEY).configure({enabled:true,connectionId:f.ga.id});
  await syncLinkResults(f.db,f.scope,KEY,async()=>({status:'ready',rows:[{tag:linkTag(f.scope,'content','report-post'),source:'linkedin',sessions:43,keyEvents:3}],timezone:'UTC',checkedAt:new Date().toISOString()}),async c=>c,f.a.userId);
 };
 let n=0;f.inbox=(kind,state,repliedAfterHours=null)=>{const id=`report-inbox-${++n}`,received=new Date(Date.parse(f.mid)+n*60000).toISOString();
  f.db.prepare("INSERT INTO platform_social_inbox(id,organization_id,project_id,connection_id,platform,kind,thread_id,item_id,author_hash,text,received_at,created_at,state,replied_at) VALUES(?,?,?,?,'linkedin',?,?,?,'h','Private customer words',?,?,?,?)").run(id,f.a.organizationId,f.a.projectId,f.linkedin.id,kind,`t${id}`,`i${id}`,received,received,state,repliedAfterHours===null?null:new Date(Date.parse(received)+repliedAfterHours*3600000).toISOString());};
 f.member=role=>({...f.scope,subject:f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:`report-${role}`,password:'fixture-password-123',role}).userId});
 f.approve=(service=f.reports)=>{const view=service.read(f.month);return service.approve({action:'approve',month:f.month,expectedDigest:view.digest,expectedRevision:view.revision,acknowledged:true});};
 return f;
}
const close=async work=>{const f=setup();try{await work(f);}finally{f.db.close();}};

test('the report counts the month’s own records and never carries customer text, tokens or account names',()=>close(async f=>{
 await f.post();f.inbox('comment','replied',2);f.inbox('message','replied',3);f.inbox('message','replied',30);f.inbox('message','new');f.inbox('comment','dismissed');
 f.db.prepare("INSERT INTO platform_ad_plans(id,organization_id,project_id,connection_id,name,objective,daily_budget_minor,currency,start_date,end_date,countries_json,link_url,state,digest,provider_campaign_id,spend_minor,impressions,clicks,spend_checked_at,created_by,created_at,updated_at) VALUES('ad-1',?,?,?,'Bahar trafiği','OUTCOME_TRAFFIC',1000,'USD',?,?,'[\"TR\"]','https://example.com','paused','d','900',12345,5000,120,?,?,?,?)").run(f.a.organizationId,f.a.projectId,f.linkedin.id,`${f.month}-10`,`${f.month}-20`,f.mid,f.a.userId,f.mid,f.mid);
 f.db.prepare("INSERT INTO platform_work_items VALUES('task-1',?,?,'Hazırlık',NULL,?,'completed','',?)").run(f.a.organizationId,f.a.projectId,f.mid,f.mid);
 const view=f.reports.read(f.month),facts=view.facts;
 assert.equal(view.state,'draft');assert.equal(facts.month,f.month);assert.equal(facts.publications.total,1);assert.deepEqual(plain(facts.publications.byChannel),[{channel:'linkedin',count:1}]);
 assert.deepEqual(plain(facts.publications.top[0]),{title:'Kayıt rehberi',channel:'linkedin',publishedAt:f.mid,url:'https://www.linkedin.com/feed/update/urn:li:share:1',sessions:43,keyEvents:3,interactions:7});
 assert.equal(facts.site.sessions,43);assert.equal(facts.site.posts,1);assert.deepEqual(plain(facts.engagement),{observed:1,interactions:7},'impressions are not interactions');
 assert.deepEqual(plain(facts.inbox),{received:5,comments:2,messages:3,replied:3,messagesInWindow:1,open:1,dismissed:1});
 assert.equal(facts.ads[0].spendMinor,12345);assert.equal(facts.work.tasksCompleted,1);assert.equal(facts.email,null);
 const json=JSON.stringify(view);for(const secret of ['Private customer words','private-social-token','private-report-token','Fixture LinkedIn'])assert.ok(!json.includes(secret),secret);
 assert.equal(f.reports.read().month,f.month,'the default is the last complete month');assert.throws(()=>f.reports.read('2001-01'));
}));

test('approval freezes exactly the reviewed figures; only approvers approve, editors write the note, nothing changes afterwards',()=>close(async f=>{
 const editor=new MonthlyReports(f.db,f.member('editor')),viewer=new MonthlyReports(f.db,f.member('viewer'));
 assert.throws(()=>viewer.saveNote({action:'note',month:f.month,note:'x',expectedRevision:0}),error=>error.status===403);
 editor.saveNote({action:'note',month:f.month,note:'  Ekim yoğun geçti.  ',expectedRevision:0});assert.equal(f.reports.read(f.month).note,'Ekim yoğun geçti.');
 assert.throws(()=>f.approve(editor),error=>error.status===403);assert.equal(editor.read(f.month).canApprove,false);
 const stale=f.reports.read(f.month);await f.post();
 assert.throws(()=>f.reports.approve({action:'approve',month:f.month,expectedDigest:stale.digest,expectedRevision:stale.revision,acknowledged:true}),error=>error.status===409,'figures changed while reviewing');
 const fresh=f.reports.read(f.month);assert.throws(()=>f.reports.approve({action:'approve',month:f.month,expectedDigest:fresh.digest,expectedRevision:fresh.revision}));
 assert.throws(()=>f.reports.approve({action:'approve',month:f.reports.months()[0],expectedDigest:'x',expectedRevision:0,acknowledged:true}),error=>error.status===409,'the month in progress cannot be approved');
 const approved=f.approve();assert.equal(approved.state,'approved');assert.equal(approved.facts.publications.total,1);
 f.store.saveContent({id:'later',platform:'linkedin',language:'tr',headline:'Sonra',content:'x',prompt:'',timestamp:Date.parse(f.mid)},true);
 assert.equal(f.reports.read(f.month).facts.work.drafts,approved.facts.work.drafts,'the snapshot does not move');
 assert.throws(()=>editor.saveNote({action:'note',month:f.month,note:'y',expectedRevision:approved.revision}),error=>error.status===409);
}));

test('a share link opens only the approved snapshot until it expires, is turned off or the approval is withdrawn',()=>close(async f=>{
 assert.throws(()=>f.reports.share({action:'share',month:f.month,days:30}),error=>error.status===409,'approve first');
 f.reports.saveNote({action:'note',month:f.month,note:'Paylaşılan not',expectedRevision:0});f.approve();
 assert.throws(()=>f.reports.share({action:'share',month:f.month,days:365}));
 const {token,shareId}=f.reports.share({action:'share',month:f.month,days:7});assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_report_shares').all()).includes(token),'only the hash is stored');
 const opened=openSharedReport(f.db,token);assert.equal(opened.note,'Paylaşılan not');assert.equal(opened.facts.month,f.month);assert.ok(!('digest' in opened));
 assert.equal(f.reports.read(f.month).shares[0].views,1);assert.equal(openSharedReport(f.db,token.slice(0,-1)+(token.endsWith('A')?'B':'A')),null);assert.equal(openSharedReport(f.db,'short'),null);
 f.db.prepare('UPDATE platform_report_shares SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),shareId);assert.equal(openSharedReport(f.db,token),null,'expired');
 const second=f.reports.share({action:'share',month:f.month,days:30});f.reports.revoke({action:'revoke',month:f.month,shareId:second.shareId});assert.equal(openSharedReport(f.db,second.token),null,'turned off');
 assert.throws(()=>f.reports.revoke({action:'revoke',month:f.month,shareId:second.shareId}),error=>error.status===404);
 const third=f.reports.share({action:'share',month:f.month,days:30}),view=f.reports.read(f.month);f.reports.reopen({action:'reopen',month:f.month,expectedRevision:view.revision});
 assert.equal(openSharedReport(f.db,third.token),null,'withdrawn approval closes every link');assert.equal(f.reports.read(f.month).state,'draft');
 f.approve();assert.equal(openSharedReport(f.db,third.token),null,'re-approving does not revive an old link');
 for(let i=0;i<5;i++)f.reports.share({action:'share',month:f.month,days:7});assert.throws(()=>f.reports.share({action:'share',month:f.month,days:7}),error=>error.status===429);
 assert.equal(new MonthlyReports(f.db,f.member('editor')).read(f.month).shares.length,0,'links are listed only to approvers');
}));

test('another project cannot see, approve or share this project’s report',()=>close(async f=>{
 await f.post();f.approve();const {token}=f.reports.share({action:'share',month:f.month,days:7});
 const other=new MonthlyReports(f.db,f.other);assert.equal(other.read(f.month).facts.publications.total,0);assert.equal(other.read(f.month).state,'draft');
 assert.throws(()=>other.share({action:'share',month:f.month,days:7}),error=>error.status===409);
 f.db.prepare("UPDATE platform_projects SET product_pack='crewin' WHERE id=?").run(f.a.projectId);assert.equal(openSharedReport(f.db,token),null,'only standard projects share');
}));

test('migration 59 is additive and repeatable',async()=>{
 const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'monthly-report-')),'fixture.sqlite');
 let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeMonthlyReportSchema(db);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('platform_monthly_reports','platform_report_shares')").get().n,0);db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,59);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('platform_monthly_reports','platform_report_shares')").get().n,2);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_migrations WHERE version=59').get().n,1);db.close();
});
