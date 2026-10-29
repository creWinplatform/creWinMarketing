const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {approvalQueue,ProjectApprovals}=load('approvals.ts'),{coachWeekKey,zonedInstant}=load('coach.ts'),{coachMonthKey}=load('coach-content.ts');
const HOUR=3600000,iso=value=>new Date(value).toISOString(),plain=value=>JSON.parse(JSON.stringify(value));
function setup(){
 const f=fixture(),zone=f.repo.workspace(f.a.userId,f.a.organizationId,f.a.projectId).project.timezone,now=iso(Date.now()),org=f.a.organizationId,project=f.a.projectId;f.zone=zone;
 f.account=f.store.saveConnection({provider:'social',integrationId:'unused',accountName:'Fixture LinkedIn',accessToken:'private-token',expiresAt:Date.now()+86400000,social:{platform:'linkedin',accountId:'fixture_member'}},KEY);
 f.db.prepare("INSERT INTO platform_growth_coach(organization_id,project_id,answers_json,brief_json,draft_json,draft_source,draft_at,updated_by,created_at,updated_at) VALUES(?,?,'{}','{}','{}','template',?,?,?,?)").run(org,project,now,f.a.userId,now,now);
 f.db.prepare("INSERT INTO platform_coach_reviews(id,organization_id,project_id,week,facts_json,adjustments_json,created_by,updated_by,created_at,updated_at) VALUES('review-1',?,?,?,'{}',?,?,?,?,?)").run(org,project,coachWeekKey(new Date(),zone),JSON.stringify([{id:'a',state:'proposed'},{id:'b',state:'accepted'},{id:'c',state:'proposed'}]),f.a.userId,f.a.userId,now,now);
 f.db.prepare("INSERT INTO platform_coach_refreshes(id,organization_id,project_id,month,base_revision,facts_json,brief_json,reasons_json,source,state,created_by,updated_by,created_at,updated_at) VALUES('refresh-1',?,?,?,1,'{}','{}','[]','template','proposed',?,?,?,?)").run(org,project,coachMonthKey(new Date(),0,zone),f.a.userId,f.a.userId,now,now);
 const item=(id,state,month=coachMonthKey(new Date(),0,zone))=>f.db.prepare("INSERT INTO platform_coach_content_items(id,organization_id,project_id,month,channel,theme,title,angle,planned_for,state,source,updated_by,created_at,updated_at) VALUES(?,?,?,?,'linkedin','t','Private plan title','a',?,?,'template',?,?,?)").run(id,org,project,month,`${month}-20`,state,f.a.userId,now,now);
 item('plan-1','suggested');item('plan-2','suggested');item('plan-3','approved');item('plan-old','suggested',coachMonthKey(new Date(),-1,zone));
 f.db.prepare("INSERT INTO platform_ad_plans(id,organization_id,project_id,connection_id,name,objective,daily_budget_minor,currency,start_date,end_date,countries_json,link_url,state,digest,created_by,created_at,updated_at) VALUES('ad-1',?,?,?,'Private plan','OUTCOME_TRAFFIC',1000,'USD','2026-12-01','2026-12-05','[\"TR\"]','https://example.com','draft','d',?,?,?)").run(org,project,f.account.id,f.a.userId,now,now);
 const batch=(id,state)=>f.db.prepare("INSERT INTO platform_whatsapp_batches(id,organization_id,project_id,connection_id,name,template_name,template_language,params_json,contacts_json,digest,state,created_by,created_at,updated_at,approved_at) VALUES(?,?,?,?,'n','t','tr','[]','[]','d',?,?,?,?,?)").run(id,org,project,f.account.id,state,f.a.userId,now,now,state==='approved'?now:null);
 batch('wa-1','draft');batch('wa-2','approved');batch('wa-3','done');
 let n=0;const inbox=(kind,hours,reply_state,text='Saved reply')=>f.db.prepare("INSERT INTO platform_social_inbox(id,organization_id,project_id,connection_id,platform,kind,thread_id,item_id,author_hash,text,received_at,created_at,state,reply_state,reply_text) VALUES(?,?,?,?,'linkedin',?,?,?,'h','Private customer words',?,?,'new',?,?)").run(`in-${++n}`,org,project,f.account.id,kind,`t${n}`,`i${n}`,iso(Date.now()-hours*HOUR),now,reply_state,text);
 inbox('message',2,'draft');inbox('comment',72,'draft');inbox('message',30,'draft');inbox('message',3,'sending');inbox('message',3,'draft','');
 f.member=role=>({...f.scope,subject:f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:`approvals-${role}`,password:'fixture-password-123',role}).userId});
 f.kinds=scope=>plain(approvalQueue(f.db,scope).map(item=>`${item.kind}:${item.count}`)).sort();
 return f;
}
const close=async work=>{const f=setup();try{await work(f);}finally{f.db.close();}};

test('the owner sees every kind of decision waiting, counted as the screens count them',()=>close(f=>{
 assert.deepEqual(f.kinds(f.scope),['ad_plan:1','coach_brief:1','coach_renewal:1','coach_review:2','content_plan:2','inbox_reply:2','whatsapp_approve:1','whatsapp_send:1'].sort());
 const items=new ProjectApprovals(f.db,f.scope).read().items;assert.ok(items.every(item=>item.href.startsWith('/?tab=')));
 assert.ok(!JSON.stringify(items).match(/Private|Saved reply|private-token/),'counts and links only');
}));

test('each member sees only what their role or duty lets them decide',()=>close(f=>{
 assert.deepEqual(f.kinds(f.member('editor')),['content_plan:2'],'editors decide the content plan, not approvals');
 assert.deepEqual(f.kinds(f.member('viewer')),[]);assert.deepEqual(f.kinds(f.member('analyst')),[]);
 assert.deepEqual(f.kinds(f.member('admin')),['ad_plan:1','coach_brief:1','coach_renewal:1','coach_review:2','content_plan:2','whatsapp_approve:1'].sort(),'admins need the publish duty given on purpose to send replies');
 assert.deepEqual(f.kinds(f.other),[],'another project sees nothing');
 assert.doesNotThrow(()=>new ProjectApprovals(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).read(),'the Crewin workspace has this Ryzevo feature (lib/platform/ryzevo-features.ts)');
}));

test('last month’s report is suggested in the first ten days of a month, only when there was activity and no approval',()=>close(f=>{
 const next=coachMonthKey(new Date(),1,f.zone),day=d=>Date.parse(zonedInstant(`${next}-${d}`,12,f.zone)),month=coachMonthKey(new Date(),0,f.zone);
 const has=now=>approvalQueue(f.db,f.scope,now).some(item=>item.kind==='monthly_report');
 f.db.prepare('DELETE FROM platform_social_inbox').run();assert.equal(has(day('05')),false,'nothing happened this month yet');
 f.db.prepare("INSERT INTO platform_metric_entries(id,organization_id,project_id,goal_id,stage_index,value,observed_at,source,note) VALUES('m1',?,?,'g',0,3,?,'manual','')").run(f.a.organizationId,f.a.projectId,zonedInstant(`${month}-15`,12,f.zone));
 assert.equal(has(day('05')),true);assert.equal(has(day('12')),false,'not after the tenth');
 f.db.prepare("INSERT INTO platform_monthly_reports(id,organization_id,project_id,month,state,facts_json,digest,approved_by,approved_at,updated_by,updated_at) VALUES('r1',?,?,?,'approved','{}','d',?,?,?,?)").run(f.a.organizationId,f.a.projectId,month,f.a.userId,iso(Date.now()),f.a.userId,iso(Date.now()));
 assert.equal(has(day('05')),false,'approved reports are done');
}));

test('content plan suggestions count only when an approved brief lets the plan screen act on them',()=>close(f=>{
 f.db.prepare('UPDATE platform_growth_coach SET brief_json=NULL').run();assert.ok(!f.kinds(f.scope).some(item=>item.startsWith('content_plan')));
}));

test('decided records leave the list',()=>close(f=>{
 f.db.prepare("UPDATE platform_growth_coach SET draft_json=NULL").run();f.db.prepare("UPDATE platform_coach_refreshes SET state='approved'").run();
 f.db.prepare("UPDATE platform_coach_content_items SET state='dismissed'").run();f.db.prepare("UPDATE platform_ad_plans SET state='approved'").run();
 f.db.prepare("UPDATE platform_whatsapp_batches SET state='done'").run();f.db.prepare("UPDATE platform_social_inbox SET state='replied'").run();
 f.db.prepare("UPDATE platform_coach_reviews SET adjustments_json='[]'").run();
 assert.deepEqual(f.kinds(f.scope),[]);
}));
