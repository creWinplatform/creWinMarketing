const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./platform-loader.cjs');
const {hssProfile}=require('./hss-pilot-fixture.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{ProjectOperations}=load('operations.ts'),{ProjectMarketingStore}=load('marketing-store.ts');

test('existing new-organization invitation persists owner, never the member-role placeholder',()=>{
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db),{PlatformAccounts}=load('account.ts');
  try{
    repo.bootstrapLegacy('fixture-admin');
    const accounts=new PlatformAccounts(db),invite=accounts.invite({subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'},{username:'hss-digital-owner',role:'admin',newOrganization:true});
    const row=db.prepare('SELECT role,organization_id,project_id,used_at FROM platform_enrollments').get();
    assert.equal(row.role,'owner');assert.equal(row.organization_id,null);assert.equal(row.project_id,null);assert.equal(row.used_at,null);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM platform_users WHERE kind='platform'").get().n,0);
    assert.equal(accounts.invitation(invite.token).newOrganization,true);
    const activated=accounts.redeem(invite.token,{organizationName:'HSS Digital QA',projectName:'HSS QA',website:hssProfile.website,password:'disposable-fixture-only-123'});
    assert.equal(repo.workspaces(activated.userId).length,1);
    assert.equal(repo.can(activated.userId,'crewin','crewinjob','read'),false);
    assert.equal(db.prepare('SELECT role FROM platform_memberships WHERE user_id=?').get(activated.userId).role,'owner');
  }finally{db.close();}
});

test('HSS Digital pilot reuses standard goals, workflows and tenant isolation without invented metrics',()=>{
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);
  try{
    repo.bootstrapLegacy('pilot-admin');
    const member=repo.provision('legacy-admin',{organizationName:'HSS Digital QA',projectName:hssProfile.name,website:hssProfile.website,username:'hss-qa',password:'hss-fixture-only-123'});
    repo.updateProject(member.userId,member.organizationId,member.projectId,hssProfile);
    const workspace=repo.workspace(member.userId,member.organizationId,member.projectId);
    assert.equal(workspace.project.productPack,'standard');
    assert.equal(workspace.project.goals.length,2);
    assert.equal(workspace.modules.some(item=>['firma_kredi','jobbot','telegrambot','growth'].includes(item.id)),false);
    assert.equal(repo.workspace(member.userId,'crewin','crewinjob'),null);
    const scope={subject:member.userId,organizationId:member.organizationId,projectId:member.projectId},ops=new ProjectOperations(db,scope),store=new ProjectMarketingStore(db,scope);
    assert.deepEqual(ops.metrics(),[]);
    const now=new Date().toISOString();
    const campaign=store.saveCampaign({id:'cmp_hss_qa',name:'HSS QA - ERP evaluation draft',objective:'awareness',status:'draft',channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]},goalId:'hss_leads',content:{subject:'QA only',text:'Example technical evaluation draft. Never sent.',ctaUrl:hssProfile.website},budget:{currency:'USD',dailyByPlatform:{}},timezone:'Europe/Istanbul',utm:{campaign:'hss-qa'},deliveries:[],createdAt:now,updatedAt:now},true);
    const task=ops.saveTask({title:'Review proposed HSS acquisition journey',dueAt:new Date().toISOString(),status:'planned',campaignId:campaign.id,note:'QA only. No message or deployment.'});
    assert.equal(task.campaignId,campaign.id);
    const foreign=repo.provision('legacy-admin',{organizationName:'Other QA',projectName:'Other QA',website:'https://example.com',username:'other-hss-qa',password:'other-fixture-only-123'});
    const foreignScope={subject:foreign.userId,organizationId:foreign.organizationId,projectId:foreign.projectId};
    assert.equal(new ProjectMarketingStore(db,foreignScope).campaign(campaign.id),null);
    assert.equal(new ProjectOperations(db,foreignScope).tasks().length,0);
    assert.equal(ops.metrics().length,0);
  }finally{db.close();}
});

test('HSS first-use compass -> approved campaign -> no-send rehearsal -> sourced measurement',async()=>{
  const f=require('./email-pilot-fixture.cjs').fixture(),{GrowthCompass}=load('guidance.ts'),{ProjectMeasurements}=load('measurements.ts'),{defaultMeasurementPeriod}=load('measurement-types.ts');
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>assert.fail('The HSS isolated activation scenario must not contact a provider.');
  try{
    f.repo.updateProject(f.scope.subject,f.scope.organizationId,f.scope.projectId,hssProfile);
    const compass=new GrowthCompass(f.db,f.scope,f.KEY);assert.equal(compass.read().firstRun,true);
    compass.save({intent:'retention',experience:'guided',goalId:'hss_leads',campaignId:'',appId:'',channels:['email'],obstacles:{},expectedRevision:0});
    const segment=f.segments.save({name:'HSS QA - consent-reviewed test contacts',definition:{sourceId:f.source.id,sourceVersion:1,maxAgeHours:24,goalId:'hss_leads',stageIndex:0,rules:{kind:'group',op:'and',children:[{kind:'attribute',field:'completion',op:'lt',value:50}]}}});
    f.segments.preview({id:segment.id,version:1});
    const campaign={...f.campaign,name:'HSS QA - ERP integration discovery',goalId:'hss_leads',content:{subject:'ERP entegrasyon ihtiyaçlarınızı değerlendirelim',text:'Bu izole test içeriğidir. Mevcut sistemleriniz ve entegrasyon ihtiyacınız için teknik keşif görüşmesi planlayabilirsiniz. Hiçbir alıcıya gönderilmez.',ctaUrl:hssProfile.website},segmentBinding:f.segments.binding(segment.id,1,'hss_leads'),updatedAt:new Date().toISOString()};
    f.store.saveCampaign(campaign,false);
    const check=f.reviews.check(campaign.id,f.reviews.get(campaign.id).digest),approval=f.reviews.decide(campaign.id,{decision:'approved',expectedDigest:check.digest,expectedReviewId:check.history[0]?.id||null,note:'Isolated test only; no live send.'});
    const job=f.queue.enqueue(f.input(approval,'hss-compass-rehearsal'));
    await f.queue.process(job.id,async()=>{});
    assert.equal(f.queue.get(job.id).status,'completed');assert.equal(f.queue.get(job.id).mode,'rehearsal');assert.equal(f.queue.get(job.id).checked,5);assert.equal(f.queue.get(job.id).accepted||0,0);
    let snapshot=compass.read();assert.equal(snapshot.boundCampaignId,campaign.id);assert.equal(snapshot.steps.find(item=>item.id==='rehearsal').state,'done');assert.notEqual(snapshot.steps.find(item=>item.id==='live').state,'done');
    const operations=new ProjectOperations(f.db,f.scope);assert.equal(operations.metrics().length,0);
    const measure=new ProjectMeasurements(f.db,f.scope,f.KEY),period=defaultMeasurementPeriod();
    // Coverage and historical timestamps are fixture-only, not a production claim.
    f.db.prepare('UPDATE platform_product_sources SET event_coverage_from=? WHERE connection_id=?').run(`${period.from}T00:00:00.000Z`,f.source.id);
    f.db.prepare('UPDATE platform_product_events SET occurred_at=? WHERE connection_id=?').run(`${period.from}T12:00:00.000Z`,f.source.id);
    const binding=measure.save({goalId:'hss_leads',stageIndex:0,connectionId:f.source.id,metric:'unique_entities',eventName:'profile.updated',enabled:true,expectedVersion:0}),sync=measure.enqueue({bindingId:binding.id,expectedVersion:binding.version,...period,idempotencyKey:'hss-observed-fixture'});
    await measure.process(sync.id);
    assert.equal(measure.get(sync.id).resultStatus,'ready');assert.equal(measure.get(sync.id).value,7);
    snapshot=compass.read();assert.equal(snapshot.steps.find(item=>item.id==='measurement').state,'done');assert.notEqual(snapshot.steps.find(item=>item.id==='live').state,'done');
    assert.equal(new GrowthCompass(f.db,f.other,f.KEY).read().preferences,null);
    f.store.saveCampaign({...campaign,content:{...campaign.content,text:'Changed QA draft'},updatedAt:new Date().toISOString()},false);
    assert.notEqual(compass.read().steps.find(item=>item.id==='rehearsal').state,'done');
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_jobs WHERE job_type='email.pilot_send'").get().n,0);
    assert.equal(f.db.pragma('foreign_key_check').length,0);
  }finally{globalThis.fetch=originalFetch;f.db.close();}
});
