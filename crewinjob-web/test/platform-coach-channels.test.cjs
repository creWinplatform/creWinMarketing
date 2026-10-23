const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts');
const {GrowthCoach,normalizeCoachAnswers,coachStarterBrief,coachDraftRules,parseCoachDraft,coachToolHref}=load('coach.ts');
const {coachStarterContent}=load('coach-content.ts');
const {coachDraftChannel}=load('coach-types.ts');
// WhatsApp, paid ads and short video in the growth coach: proposed only when the diagnosis supports them, and always
// routed to the existing Campaign hub screens. Nothing here sends, spends or publishes.
const base={offer:'Handmade ceramics and pottery classes',customer:'People in our neighbourhood',market:'b2c',price:'low',sales:'local',current:['instagram'],hours:'5to10',skills:['design'],obstacle:'audience',success:''};
const b2b={offer:'Online bookkeeping software for small shops',customer:'Independent shop owners',market:'b2b',price:'high',sales:'sales',current:['website','linkedin'],hours:'2to5',skills:['writing'],obstacle:'start',success:''};
const ids=brief=>JSON.parse(JSON.stringify(brief.channels.map(item=>item.id)));
const content=['linkedin','instagram','facebook','twitter','email','seo'];
const plain=value=>JSON.parse(JSON.stringify(value));

test('the budget answer is optional for old answers and validated when present',()=>{
  assert.equal(normalizeCoachAnswers(base).budget,undefined);
  assert.equal(normalizeCoachAnswers({...base,budget:'mid'}).budget,'mid');
  assert.throws(()=>normalizeCoachAnswers({...base,budget:'1000'}),error=>error.status===400);
  assert.deepEqual(plain(normalizeCoachAnswers({...base,current:['whatsapp']}).current),['whatsapp']);
});

test('paid ads are never proposed without a stated budget, in any goal',()=>{
  for(const goal of ['leads','social','retention','seo','mobile'])for(const budget of [undefined,'none']){
    const brief=coachStarterBrief({...base,goal,current:['instagram','ads'],...(budget?{budget}:{})},'tr','Atölye');
    assert.ok(!ids(brief).includes('ads'),`${goal}/${budget}`);assert.ok(!brief.plan.some(item=>item.tool==='ads'||item.channel==='ads'),`${goal}/${budget}`);
  }
});

test('with a budget and a leads goal, paid ads join the brief with connect, campaign and spend-review steps',()=>{
  const brief=coachStarterBrief({...b2b,goal:'leads',budget:'high',hours:'5to10'},'en','Ledger');
  assert.ok(ids(brief).includes('ads'));assert.ok(content.includes(brief.channels[0].id),'first channel is a studio channel');
  const ads=brief.plan.filter(item=>item.channel==='ads');
  assert.deepEqual(plain(ads.map(item=>[item.week,item.tool])),[[2,'connections'],[3,'ads'],[4,'ads']]);
  assert.match(ads[1].how,/paused/);assert.match(brief.channels.find(item=>item.id==='ads').rationale,/paused/);
});

test('local individual buyers get WhatsApp with consent steps; business-only audiences do not',()=>{
  const local=coachStarterBrief({...base,goal:'retention'},'tr','Atölye');
  assert.ok(ids(local).includes('whatsapp'));
  const steps=local.plan.filter(item=>item.channel==='whatsapp');
  assert.deepEqual(plain(steps.map(item=>item.tool)),['connections','whatsapp','whatsapp']);
  assert.match(steps[1].how,/izin/);assert.match(steps[2].how,/onay/);
  assert.ok(!ids(coachStarterBrief({...b2b,goal:'leads'},'tr','Ledger')).includes('whatsapp'));
});

test('at most one of WhatsApp and paid ads, and the first channel is always one the studio drafts for',()=>{
  for(const goal of ['leads','social','retention','seo','mobile'])for(const budget of ['none','small','mid','high'])for(const market of ['b2b','b2c','both'])for(const sales of ['online','sales','local']){
    const brief=coachStarterBrief({...base,goal,budget,market,sales,current:['whatsapp','ads','instagram']},'en','Q');
    assert.ok(content.includes(brief.channels[0].id),JSON.stringify([goal,budget,market,sales]));
    assert.ok(ids(brief).filter(id=>id==='ads'||id==='whatsapp').length<=1,JSON.stringify([goal,budget,market,sales]));
    assert.ok(!brief.plan.some(item=>item.tool==='library'&&(item.channel==='ads'||item.channel==='whatsapp')));
  }
});

test('a video skill with a visual social channel adds one Reels draft; without the skill there is none',()=>{
  const video=coachStarterBrief({...base,skills:['video'],goal:'social'},'en','Atölye'),reels=video.plan.filter(item=>/Reels/.test(item.title));
  assert.equal(reels.length,1);assert.equal(reels[0].tool,'library');assert.ok(['instagram','facebook'].includes(reels[0].channel));assert.match(reels[0].how,/https/);
  assert.ok(!coachStarterBrief({...base,skills:['writing'],goal:'social'},'en','Atölye').plan.some(item=>/Reels/.test(item.title)));
  assert.ok(!coachStarterBrief({...b2b,skills:['video'],goal:'seo'},'en','Ledger').plan.some(item=>/Reels/.test(item.title)));
});

test('AI drafts lose paid ads without a budget and tools outside their channel; nothing usable is refused',()=>{
  const draft={language:'en',icp:{summary:'Shop owners',pains:['Assumption: time']},positioning:'Simple books',
    channels:[{id:'ads',rationale:'Run ads'},{id:'linkedin',rationale:'Company page'}],
    plan:[{week:1,title:'Launch ads',why:'Reach',how:'Create a campaign',minutes:30,tool:'ads',channel:'ads'},{week:1,title:'Post',why:'Trust',how:'Draft',minutes:30,tool:'library',channel:'linkedin'},{week:2,title:'WA in wrong place',why:'x',how:'y',minutes:20,tool:'whatsapp',channel:'linkedin'}]};
  const ruled=coachDraftRules(draft,{...b2b,budget:'none'});
  assert.deepEqual(ids(ruled),['linkedin']);assert.deepEqual(plain(ruled.plan.map(item=>item.title)),['Post']);
  const kept=coachDraftRules(draft,{...b2b,budget:'mid'});assert.deepEqual(ids(kept),['linkedin','ads'],'a studio channel moves first');assert.equal(kept.plan.length,2);
  assert.throws(()=>coachDraftRules({...draft,channels:[{id:'ads',rationale:'Ads only'},{id:'whatsapp',rationale:'WA'}]},{...b2b,budget:'mid'}),error=>error.status===502);
  // The parsed AI draft itself still accepts the new channel and tool names.
  assert.equal(parseCoachDraft(JSON.stringify({...draft,plan:[...draft.plan,{week:3,title:'Plan',why:'a',how:'b',minutes:20,tool:'calendar',channel:null},{week:4,title:'Measure',why:'a',how:'b',minutes:20,tool:'analytics',channel:null}]}),'en').channels[0].id,'ads');
});

test('ads and WhatsApp open their Campaign hub views; drafts never target them in the studio',()=>{
  assert.equal(coachToolHref('ads','ads'),'/?tab=campaigns&campaignView=ads');
  assert.equal(coachToolHref('whatsapp','whatsapp'),'/?tab=campaigns&campaignView=whatsapp');
  assert.equal(coachToolHref('connections','whatsapp'),'/?tab=campaigns&campaignView=whatsapp');
  assert.equal(coachToolHref('connections','ads'),'/?tab=campaigns&campaignView=ads');
  assert.match(coachToolHref('connections','instagram'),/settings=connections/);
  assert.equal(coachDraftChannel('ads'),'linkedin');assert.equal(coachDraftChannel('whatsapp'),'linkedin');assert.equal(coachDraftChannel('seo'),'blog');
});

test('the monthly content plan rotates only over studio channels',()=>{
  const brief=coachStarterBrief({...base,goal:'retention'},'tr','Atölye');assert.ok(ids(brief).includes('whatsapp'));
  const items=coachStarterContent(brief,{...base,goal:'retention'},'2026-11',null,new Date('2026-11-02T08:00:00Z'),'Europe/Istanbul');
  assert.ok(items.length>0);assert.ok(items.every(item=>content.includes(item.channel)),JSON.stringify(items.map(item=>item.channel)));
});

test('a saved ad account from any provider resolves the ad connection step',async()=>{
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
  try{
    const a=repo.provision('legacy-admin',{organizationName:'alpha',projectName:'alpha',website:'https://example.com',username:'alpha',password:'fixture-password-123'});
    const scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId},coach=new GrowthCoach(db,scope);
    const drafted=await coach.diagnose({answers:{...b2b,goal:'leads',budget:'high',hours:'5to10'},language:'en',mode:'template',expectedRevision:0});
    const approved=coach.approve({brief:drafted.draft,expectedRevision:drafted.revision});
    const connect=approved.brief.plan.find(item=>item.tool==='connections'&&item.channel==='ads');assert.ok(connect);
    const all=()=>coach.actions(),find=()=>all().find(item=>item.tool==='connections'&&item.channel==='ads');
    assert.equal(find().state,'open');assert.equal(find().href,'/?tab=campaigns&campaignView=ads');
    db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES('qa-google-ads',?,?,'google_ads','123-456-7890','QA','{}',1,?)").run(a.organizationId,a.projectId,new Date().toISOString());
    assert.equal(find().state,'done');
    assert.ok(all().filter(item=>item.channel==='ads'&&item.tool==='ads').every(item=>item.prefill===null),'ad steps carry no studio pre-fill');
  }finally{db.close();}
});
