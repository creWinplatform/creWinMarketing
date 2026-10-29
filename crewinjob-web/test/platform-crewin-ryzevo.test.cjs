const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
// Ryzevo's features in the Crewin workspace: the ones Crewin has no tool for are open to its single account; the ones
// where Crewin keeps its own tool (campaigns, publishing, prospects, ads…) and the SaaS-only ones stay closed. The Compass
// is open only as the coach's store (an approved brief seeds it); its screen is replaced by the Crewin job guide.
const KEY='crewin-ryzevo-fixture-key-32-bytes!!';
const CREWIN={subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'};
const {ryzevoFeature,CREWIN_RYZEVO_FEATURES}=load('ryzevo-features.ts');
const {projectEntitlement}=load('entitlements.ts');
const {ProjectUsage}=load('project-usage.ts');
const {draftsByPlatform,draftTotal,crewinConnectedChannels}=load('coach-activity.ts');
const {resetFileSummaries}=load('file-summary.ts');
const {seedCoachFirstWeek}=load('coach-first-week.ts');
const {crewinJobGuide,resetCrewinGuideCache}=load('crewin-job-guide.ts');
const denied=error=>error.status===403;

test('the feature rule: standard projects get everything, Crewin only what it has no tool for',()=>{
  for(const feature of CREWIN_RYZEVO_FEATURES){assert.equal(ryzevoFeature('standard',feature),true);assert.equal(ryzevoFeature('crewin',feature),true,feature);}
  assert.equal(ryzevoFeature('crewin','social_publications'),false);assert.equal(ryzevoFeature(undefined,'coach'),false);assert.equal(ryzevoFeature('other','coach'),false);
});

test('Crewin’s account reaches the opened features and not the others',coachRun(async f=>{
  const opened={
    coach:()=>new (load('coach.ts').GrowthCoach)(f.db,CREWIN).read(),
    seo:()=>new (load('seo-operations.ts').SeoOperations)(f.db,CREWIN).read(),
    aiVisibility:()=>new (load('ai-visibility.ts').AiVisibility)(f.db,CREWIN).read(),
    alerts:()=>new (load('team-alerts.ts').TeamAlerts)(f.db,CREWIN).read(),
    approvals:()=>new (load('approvals.ts').ProjectApprovals)(f.db,CREWIN).read(),
    measurements:()=>new (load('measurements.ts').ProjectMeasurements)(f.db,CREWIN,KEY).workspace(),
    monthlyReport:()=>new (load('monthly-report.ts').MonthlyReports)(f.db,CREWIN).read(),
    budget:()=>new (load('budget-planner.ts').BudgetPlanner)(f.db,CREWIN).read(),
    inbox:()=>new (load('social-inbox.ts').ProjectSocialInbox)(f.db,CREWIN,KEY).read(),
    push:()=>new (load('web-push.ts').WebPush)(f.db,CREWIN,KEY).read(),
  };
  for(const [name,run] of Object.entries(opened)){try{await run();}catch(error){assert.notEqual(error.status,403,`${name} is open to Crewin: ${error.message}`);}}
  const closed={
    socialPublications:()=>new (load('social-publications.ts').SocialPublications)(f.db,CREWIN,KEY).workspace(),
    segments:()=>new (load('segments.ts').ProductSegments)(f.db,CREWIN).list(),
    emailSender:()=>new (load('email-sender.ts').EmailSenders)(f.db,CREWIN,KEY).get(),
    prospects:()=>new (load('prospects.ts').ProjectProspects)(f.db,CREWIN).read(),
    ads:()=>new (load('ad-manager.ts').ProjectAds)(f.db,CREWIN,KEY).read(),
    automations:()=>new (load('automations.ts').ProjectAutomations)(f.db,CREWIN,KEY).read(),
    whatsapp:()=>new (load('whatsapp.ts').ProjectWhatsApp)(f.db,CREWIN,KEY).read(),
    messaging:()=>new (load('messaging-sources.ts').ProjectMessaging)(f.db,CREWIN,KEY).read(),
    repurpose:()=>new (load('content-repurpose.ts').ContentRepurpose)(f.db,CREWIN).repurpose({}),
    mobile:()=>new (load('mobile-store.ts').MobileGrowth)(f.db,CREWIN,KEY).apps(),
  };
  for(const [name,run] of Object.entries(closed))await assert.rejects(async()=>run(),denied,`${name} stays closed for Crewin: it has its own tool`);
  assert.throws(()=>f.repo.updateProject('legacy-admin','crewin','crewinjob',{name:'X',website:'https://example.com',timezone:'Europe/Istanbul',language:'tr',brandVoice:'',goals:[]}),/existing adapter/,'Crewin’s name, site and goals stay with its adapter');
  const ws=f.repo.updateBrandVoice('legacy-admin','crewin','crewinjob','Kısa ve net.');
  assert.equal(ws.project.brandVoice,'Kısa ve net.');assert.equal(ws.project.goals.length,2,'Crewin’s own goals are kept');assert.equal(ws.project.productPack,'crewin');
}));

test('Crewin has no AI or scan cap; usage is still recorded',coachRun(async f=>{
  const rights=projectEntitlement(f.db,CREWIN);assert.equal(rights.limits.ai,Infinity);assert.equal(rights.limits.audits,Infinity);
  assert.equal(projectEntitlement(f.db,{organizationId:f.a.organizationId,projectId:f.a.projectId}).limits.ai<Infinity,true,'standard projects keep their limits');
  const usage=new ProjectUsage(f.db,CREWIN);for(let i=0;i<60;i++)usage.complete(usage.reserve('ai'));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_usage_reservations WHERE organization_id='crewin' AND status='committed'").get().n,60);
}));

test('the coach reads Crewin’s own content and accounts, and adds no starter drafts to the platform library',coachRun(async f=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crewin-coach-')),saved=process.env.CREWIN_WEB_DATA_DIR;process.env.CREWIN_WEB_DATA_DIR=dir;resetFileSummaries();
  try{
    fs.writeFileSync(path.join(dir,'content-history.json'),JSON.stringify([{platform:'instagram',prompt:'x',content:'a',timestamp:Date.now()},{platform:'linkedin',prompt:'y',content:'b',timestamp:Date.now()-40*86400000},{platform:'facebook',prompt:'Reklam Kampanyası · facebook',content:'ad',timestamp:Date.now()}]));
    fs.writeFileSync(path.join(dir,'social-tokens.json'),JSON.stringify({facebook:{accessToken:'qa'}}));
    fs.writeFileSync(path.join(dir,'post-history.json'),JSON.stringify([{platform:'linkedin',postId:'1',postUrl:'https://www.linkedin.com/feed/update/1',content:'Yeni ilanlar',publishedAt:Date.now()}]));
    const month=new Date().toISOString().slice(0,7),report=new (load('monthly-report.ts').MonthlyReports)(f.db,CREWIN).facts(month);
    assert.equal(report.publications.total,1,'the monthly report counts the posts Crewin published with its own tools');assert.equal(report.publications.top[0].sessions,null,'no site figures are made up');
    assert.deepEqual(plain(draftsByPlatform(f.db,['crewin','crewinjob'],Date.now()-30*86400000)),{instagram:1},'ad drafts are not channel posts; old drafts fall outside the window');
    assert.equal(draftTotal(f.db,['crewin','crewinjob']),2);assert.equal(draftTotal(f.db,[f.a.organizationId,f.a.projectId]),0,'standard projects keep reading their tables');
    assert.ok(crewinConnectedChannels({}).has('facebook'));assert.ok(!crewinConnectedChannels({}).has('linkedin'));assert.ok(crewinConnectedChannels({SMTP_HOST:'h',SMTP_USER:'u',SMTP_PASSWORD:'qa',SMTP_FROM_EMAIL:'qa@example.test'}).has('email'));
    const {GrowthCoach}=load('coach.ts'),coach=new GrowthCoach(f.db,CREWIN);
    const drafted=await coach.diagnose({answers:f.answers,language:'tr',mode:'template',expectedRevision:coach.read().revision});
    const approved=coach.approve({brief:drafted.draft,expectedRevision:drafted.revision});
    assert.ok(approved.brief);assert.equal(seedCoachFirstWeek(f.db,CREWIN).drafts,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_content_history WHERE organization_id='crewin'").get().n,0,'Crewin’s library stays its own');
    for(const action of approved.actions||[])assert.ok(!/campaignView=|planning=social|guideProvider=/.test(action.href),`${action.id} opens a Crewin tab: ${action.href}`);
  }finally{if(saved===undefined)delete process.env.CREWIN_WEB_DATA_DIR;else process.env.CREWIN_WEB_DATA_DIR=saved;resetFileSummaries();fs.rmSync(dir,{recursive:true,force:true});}
}));

test('the Crewin job guide adds the Ryzevo jobs, read from the platform tables',coachRun(async f=>{
  resetCrewinGuideCache();const root=fs.mkdtempSync(path.join(os.tmpdir(),'crewin-guide-ryzevo-'));
  try{
    const ok=value=>async()=>value;
    const deps={webData:root,agentRoot:root,now:Date.now(),env:{},agentEnv:()=>({}),socialConnected:()=>[],stats:ok({}),leads:ok({items:[]}),pendingOrders:ok({totalCount:0}),campaigns:ok({items:[]}),posts:ok({items:[]}),db:f.db};
    let view=await crewinJobGuide(deps);const job=id=>view.jobs.find(item=>item.id===id);
    for(const id of ['crewin_growth','crewin_ai','crewin_search','crewin_inbox'])assert.ok(job(id),id);
    assert.equal(job('crewin_search').steps[0].state,'blocked','Google OAuth not set: the step names the server setting');assert.match(job('crewin_search').steps[0].reason.tr,/PLATFORM_GOOGLE_CLIENT_ID/);
    assert.equal(job('crewin_results').steps.at(-1).id,'monthly');
    assert.equal(job('crewin_search').steps[0].setupHref,'/?tab=project&settings=operations&setup=google','a step waiting for Google opens the setup guide card');
    assert.equal(job('crewin_inbox').steps[0].setupHref,'/?tab=project&settings=operations&setup=meta');
    // Present but wrong for this panel's address: the step stays locked and says what the setup guide found.
    const wrong=await crewinJobGuide({...deps,env:{PLATFORM_GOOGLE_CLIENT_ID:'x',PLATFORM_GOOGLE_CLIENT_SECRET:'y',PLATFORM_GOOGLE_REDIRECT_URI:'http://localhost:3000/api/platform/google/callback'},setup:[{id:'google',state:'invalid',problems:[{tr:'PLATFORM_GOOGLE_REDIRECT_URI bu panelin adresiyle eşleşmiyor.',en:'PLATFORM_GOOGLE_REDIRECT_URI does not match this panel.'}]}]});
    const connect=wrong.jobs.find(item=>item.id==='crewin_search').steps[0];assert.equal(connect.state,'blocked');assert.match(connect.reason.tr,/Sunucu ayarı hatalı: .*eşleşmiyor/);assert.ok(connect.setupHref);
    const right=await crewinJobGuide({...deps,setup:[{id:'google',state:'ready',problems:[]}]});assert.equal(right.jobs.find(item=>item.id==='crewin_search').steps[0].state,'todo','a valid setting opens the step');
    const worker=job('crewin_search').steps.find(step=>step.id==='worker');assert.equal(worker.state,'todo');assert.match(worker.evidence.tr,/hiç çalışmadı/);
    f.db.prepare("INSERT INTO platform_worker_observations(component,run_id,first_observed_at,started_at,finished_at,outcome,checked,failed,last_success_at,consecutive_failures) VALUES('platform-worker','r',?,?,?,'completed',0,0,?,0)").run(...Array(4).fill(new Date().toISOString()));
    resetCrewinGuideCache();assert.equal((await crewinJobGuide({...deps,now:Date.now()})).jobs.find(item=>item.id==='crewin_search').steps.find(step=>step.id==='worker').state,'done','a recent worker run ticks it');
    for(const item of view.jobs)for(const step of item.steps)assert.match(step.href,/^\/\?tab=[a-z_]+(&(view|section|settings|setup)=[a-z_]+)*$/,`${item.id}/${step.id}`);
    const {GrowthCoach}=load('coach.ts'),coach=new GrowthCoach(f.db,CREWIN);await coach.diagnose({answers:f.answers,language:'tr',mode:'template',expectedRevision:coach.read().revision});
    resetCrewinGuideCache();view=await crewinJobGuide({...deps,now:Date.now()});
    assert.deepEqual(plain(job('crewin_growth').steps.map(step=>[step.id,step.state])),[['diagnose','done'],['approve','todo'],['review','todo']]);
    assert.equal(job('crewin_growth').badge.count,1,'a draft waiting for approval is shown');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}));
