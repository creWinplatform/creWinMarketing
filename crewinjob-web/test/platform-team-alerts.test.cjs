const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {TeamAlerts,teamAlerts,deliverNextAlertEmail,alertMessage}=load('team-alerts.ts');
const HOUR=3600000,DAY=24*HOUR,iso=value=>new Date(value).toISOString();
const CONFIG={origin:'https://ryzevo.example',region:'eu-central-1',from:'alerts@ryzevo.example',accessKeyId:'AKIAFIXTUREONLY00000',secretAccessKey:'x'.repeat(40),revision:'fixture'};
function setup(){
 const f=fixture();
 f.page=f.store.saveConnection({provider:'social',integrationId:'qa-only',accountName:'Private Page Name',accessToken:'private-page-token',expiresAt:Date.now()+30*DAY,social:{platform:'facebook',accountId:'100',graphVersion:'v25.0'}},KEY,{userAccessToken:'private-user-token',appId:'12345'});
 let n=0;f.message=(hours,patch={})=>{const id=`inbox-${++n}`;f.db.prepare("INSERT INTO platform_social_inbox(id,organization_id,project_id,connection_id,platform,kind,thread_id,item_id,author_hash,text,received_at,created_at,state,reply_state) VALUES(?,?,?,?,'facebook',?,?,?,?,?,?,?,?,?)")
  .run(id,f.a.organizationId,f.a.projectId,f.page.id,patch.kind||'message',`t-${id}`,`i-${id}`,'h','Private customer question about my order',iso(Date.now()-hours*HOUR),iso(Date.now()),patch.state||'new',patch.reply_state||null);return id;};
 f.publication=(state,hoursAgo=1,mode='publish')=>{const id=`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,at=iso(Date.now()-hoursAgo*HOUR);
  f.db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,'r',?,'failed',?,?,'social.publish')").run(id,f.a.organizationId,f.a.projectId,f.a.userId,f.page.id,`social:${id}`,at,at);
  f.db.prepare("INSERT INTO platform_social_publications(job_id,organization_id,project_id,source_kind,source_id,source_digest,body_digest,encrypted_snapshot,mode,scheduled_at,timezone,configuration_revision,state) VALUES(?,?,?,'content','x','d','b','sealed',?,?,'UTC','cfg',?)").run(id,f.a.organizationId,f.a.projectId,mode,at,state);return id;};
 f.member=role=>{const user=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:`alerts-${role}`,password:'fixture-password-123',role});return {...f.scope,subject:user.userId};};
 f.kinds=(scope=f.scope)=>JSON.parse(JSON.stringify(teamAlerts(f.db,scope).map(item=>item.kind)));
 f.verify=(user=f.a.userId,email='owner@ryzevo.example')=>f.db.prepare('INSERT OR REPLACE INTO platform_account_emails VALUES(?,?,?)').run(user,email,iso(Date.now()));
 return f;
}
const close=async work=>{const f=setup();try{await work(f);}finally{f.db.close();}};

test('only messages whose 24-hour window closes within six hours and that have no reply on its way are urgent',()=>close(f=>{
 assert.equal(teamAlerts(f.db,f.scope).length,0);
 const closing=f.message(20);f.message(10);f.message(25);f.message(21,{state:'replied'});f.message(22,{reply_state:'sending'});f.message(19,{kind:'comment'});const draft=f.message(23,{reply_state:'draft'});
 const [alert]=teamAlerts(f.db,f.scope);assert.equal(alert.kind,'inbox_window');assert.equal(alert.severity,'urgent');assert.equal(alert.count,2);
 assert.deepEqual(JSON.parse(JSON.stringify([...alert.keys])).sort(),[`inbox:${closing}`,`inbox:${draft}`].sort());assert.ok(Math.abs(Date.parse(alert.at)-(Date.now()+HOUR))<60000,'the first window closes in about an hour');
 assert.deepEqual(f.kinds(f.member('admin')),[],'admins need the reading duty given on purpose');
}));

test('each alert needs the right that acting on it needs',()=>close(f=>{
 f.publication('uncertain');f.publication('rejected',8*24);f.publication('blocked',2,'rehearsal');
 f.db.prepare('UPDATE platform_social_accounts SET expires_at=? WHERE connection_id=?').run(Date.now()+2*DAY,f.page.id);
 f.db.prepare("INSERT INTO platform_ad_plans(id,organization_id,project_id,connection_id,name,objective,daily_budget_minor,currency,start_date,end_date,countries_json,link_url,state,digest,last_error,created_by,created_at,updated_at) VALUES('ad-1',?,?,?,'Private plan','OUTCOME_TRAFFIC',1000,'USD','2026-11-01','2026-11-05','[\"TR\"]','https://example.com','paused','d','Meta refused',?,?,?)").run(f.a.organizationId,f.a.projectId,f.page.id,f.a.userId,iso(Date.now()),iso(Date.now()));
 const owner=teamAlerts(f.db,f.scope),publication=owner.find(item=>item.kind==='publication_failed');
 assert.deepEqual(JSON.parse(JSON.stringify(owner.map(item=>item.kind))).sort(),['ad_error','connection_expiring','publication_failed']);assert.equal(publication.count,1,'older than a week and rehearsals are left out');assert.equal(publication.severity,'urgent');
 assert.deepEqual(f.kinds(f.member('editor')),['publication_failed']);assert.deepEqual(f.kinds(f.member('viewer')),[]);
 assert.deepEqual(f.kinds(f.member('admin')).sort(),['ad_error','connection_expiring','publication_failed']);
 assert.deepEqual(f.kinds(f.other),[],'another project sees nothing of this one');
}));

test('the paid period, its grace and a trial warn the billing owner unless a later period is paid',()=>close(f=>{
 const start=Date.now(),end=start+14*DAY;f.db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE organization_id=? AND project_id=?").run(f.a.userId,iso(end-14*DAY),iso(end),f.a.organizationId,f.a.projectId);
 assert.deepEqual(f.kinds(),[]);f.db.prepare('UPDATE platform_project_entitlements SET started_at=?,ends_at=? WHERE organization_id=? AND project_id=?').run(iso(start-12*DAY),iso(start+2*DAY),f.a.organizationId,f.a.projectId);
 assert.equal(teamAlerts(f.db,f.scope)[0].phase,'trial_ending');assert.deepEqual(f.kinds(f.member('admin')),[],'billing belongs to the owner');
 const order=(id,from,to)=>{f.db.prepare("INSERT INTO platform_billing_live_orders(id,organization_id,project_id,actor_id,idempotency_key,request_digest,merchant_revision,catalog_version,plan_id,cadence,amount_minor,state,terms_url,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,'d','m','v','launch','monthly',2900,'paid','https://ryzevo.example/terms',?,?,?)").run(id,f.a.organizationId,f.a.projectId,f.a.userId,id,iso(from),iso(from),iso(from));
  f.db.prepare("INSERT INTO platform_project_subscriptions(order_id,organization_id,project_id,plan_id,cadence,starts_at,ends_at,grace_ends_at,created_at) VALUES(?,?,?,'launch','monthly',?,?,?,?)").run(id,f.a.organizationId,f.a.projectId,iso(from),iso(to),iso(to+7*DAY),iso(from));};
 order('RZLIVE'+'a'.repeat(32),start-27*DAY,start+3*DAY);let [alert]=teamAlerts(f.db,f.scope);assert.equal(alert.phase,'paid_ending');assert.equal(alert.severity,'warning');
 f.db.prepare('UPDATE platform_project_subscriptions SET ends_at=?,grace_ends_at=?').run(iso(start-DAY),iso(start+6*DAY));[alert]=teamAlerts(f.db,f.scope);assert.equal(alert.phase,'grace');assert.equal(alert.severity,'urgent');
 order('RZLIVE'+'b'.repeat(32),start-DAY,start+29*DAY);assert.deepEqual(f.kinds(),[],'a renewed period ends the warning');
}));

test('email alerts are opt-in, need a verified email, skip what was open at opt-in and never carry message text or names',()=>close(async f=>{
 const service=new TeamAlerts(f.db,f.scope);f.message(20);
 assert.equal(service.read().email.enabled,false);assert.throws(()=>service.subscribe({action:'subscribe',language:'tr'}),error=>error.status===409);
 f.verify();assert.throws(()=>service.subscribe({action:'subscribe',language:'tr',to:'x@example.com'}));service.subscribe({action:'subscribe',language:'tr'});
 const sent=[],deliver=async mail=>{sent.push(mail);};let now=Date.now();
 assert.equal(await deliverNextAlertEmail(f.db,deliver,CONFIG,now),false,'what was already open is not mailed');
 f.message(19);now+=11*60000;assert.equal(await deliverNextAlertEmail(f.db,deliver,CONFIG,now),true);
 assert.equal(sent.length,1);assert.equal(sent[0].to,'owner@ryzevo.example');assert.match(sent[0].subject,/dikkat gereken 2 konu/);assert.match(sent[0].text,/https:\/\/ryzevo\.example\/\?tab=campaigns&campaignView=inbox/);
 assert.doesNotMatch(sent[0].text,/Private customer|Private Page Name|private-page-token/);
 assert.equal(f.db.prepare("SELECT state FROM platform_alert_deliveries").get().state,'sent');
 assert.equal(await deliverNextAlertEmail(f.db,deliver,CONFIG,now+11*60000),false,'nothing new');
 f.message(18);assert.equal(await deliverNextAlertEmail(f.db,deliver,CONFIG,now+22*60000),false,'at most every three hours');
 assert.equal(await deliverNextAlertEmail(f.db,deliver,CONFIG,now+3*HOUR+60000),true);assert.equal(sent.length,2);
 service.unsubscribe();f.message(18.5);assert.equal(await deliverNextAlertEmail(f.db,deliver,CONFIG,now+7*HOUR),false);
 assert.equal(await deliverNextAlertEmail(f.db,async()=>assert.fail('switch off'),null,now+8*HOUR),false);
}));

test('a failed provider call is recorded as uncertain and not retried; a member who left gets nothing',()=>close(async f=>{
 f.verify();new TeamAlerts(f.db,f.scope).subscribe({action:'subscribe',language:'en'});f.message(20);let now=Date.now()+11*60000,calls=0;
 assert.equal(await deliverNextAlertEmail(f.db,async()=>{calls++;throw new Error('ses down');},CONFIG,now),true);
 assert.equal(f.db.prepare("SELECT state FROM platform_alert_deliveries").get().state,'uncertain');
 assert.equal(await deliverNextAlertEmail(f.db,async()=>{calls++;},CONFIG,now+4*HOUR),false,'the covered records are not mailed again');assert.equal(calls,1);
 const editor=f.member('editor');f.verify(editor.subject,'editor@ryzevo.example');new TeamAlerts(f.db,editor).subscribe({action:'subscribe',language:'tr'});f.publication('rejected');
 f.db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(editor.subject);
 for(let i=1;i<=3;i++)await deliverNextAlertEmail(f.db,async mail=>{assert.notEqual(mail.to,'editor@ryzevo.example');},CONFIG,now+4*HOUR+i*11*60000);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_alert_deliveries WHERE user_id=?").get(editor.subject).n,0);
}));

test('the English email names the deadline in the project time zone and how to turn it off',()=>{
 const message=alertMessage([{kind:'billing_period',phase:'grace',severity:'urgent',count:1,at:'2026-11-03T21:30:00.000Z',href:'/?tab=project&settings=plan',keys:['billing:grace:x']}],'en',{name:'Acme',timezone:'Europe/Istanbul'},'https://ryzevo.example');
 assert.match(message.subject,/Acme · 1 item\(s\) need attention/);assert.match(message.text,/4 Nov.*00:30/);assert.match(message.text,/turn them off/);assert.match(message.text,/Nothing was sent to customers/);
});

test('migration 58 is additive and repeatable',async()=>{
 const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'team-alerts-')),'fixture.sqlite');
 let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeAlertSchema(db);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'platform_alert_%'").get().n,0);db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,62);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'platform_alert_%'").get().n,3);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_migrations WHERE version=58').get().n,1);db.close();
});
