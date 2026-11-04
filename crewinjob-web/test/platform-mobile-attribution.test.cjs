const {test}=require('node:test'),assert=require('node:assert/strict'),{createHmac,randomBytes}=require('node:crypto');
const {fixture}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
// The "Which work brought customers" report for an app: an install the attribution provider credits to a campaign is the
// person's first touch, and the backend's later signup event (same customer id, entity type user) counts for it.
// Instagram/TikTok profile links carry a fixed tag of their own.
const {MobileGrowth}=load('mobile-store.ts'),{recordMobileEvents}=load('mobile-ingestion.ts');
const {ProductWebhooks,authenticateProductWebhook}=load('product-webhooks.ts');
const {ProjectAttribution,attributionEntity,profileTag}=load('attribution.ts');
const SECRET=randomBytes(32).toString('hex'),ago=(days,extra=0)=>new Date(Date.now()-days*86400000-extra).toISOString();
const plain=value=>JSON.parse(JSON.stringify(value));

function setup(){
  const f=fixture(),service=new MobileGrowth(f.db,f.scope,f.KEY);
  const app=service.saveApp({name:'Dövme QA',platform:'both',appleId:'123456789',bundleId:'com.example.tattoo',packageName:'com.example.tattoo',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'tattoo',attributionProvider:'appsflyer',revenueProvider:'bridge',identityConfirmed:true});
  service.setSource(app.id,true);
  const hooks=new ProductWebhooks(f.db,f.scope),saved=hooks.save({name:'Uygulama backend',config:{entityType:'user',attributes:[{key:'amount',type:'number'}],eventNames:['user.signed_up']},secret:SECRET},f.KEY);
  hooks.preview(saved.id,{sourceVersion:1,events:[{id:'p',entityId:'p',eventName:'user.signed_up',occurredAt:ago(0,1000),attributes:{amount:0}}]});hooks.state(saved.id,1,'activate');
  const send=events=>{const bytes=Buffer.from(JSON.stringify({sourceVersion:1,events})),timestamp=String(Math.floor(Date.now()/1000));
    return authenticateProductWebhook(f.db,saved.id,new Headers({'x-ryzevo-timestamp':timestamp,'x-ryzevo-signature':'v1='+createHmac('sha256',Buffer.from(SECRET,'hex')).update(`${timestamp}.${saved.id}.`).update(bytes).digest('hex')}),f.KEY)(bytes);};
  return {...f,service,app:service.app(app.id),backend:saved,send};
}
const run=fn=>()=>{const f=setup();try{fn(f);}finally{f.db.close();}};
const install=(id,entityId,patch={})=>({id,entityId,kind:'install',occurredAt:ago(3),platform:'ios',details:{identity:'customer',environment:'production',campaign:'Yaz Lansmanı 2026',channel:'Facebook Ads',providerConfirmed:true,...patch}});

test('a campaign-credited app install is the first touch of the person the backend later signs up',run(f=>{
  recordMobileEvents(f.service,f.app,'appsflyer',[install('i-1','user-42')]);
  const touch=f.db.prepare('SELECT * FROM platform_attribution_touches').get();
  assert.deepEqual(plain({campaign:touch.campaign,source:touch.source,medium:touch.medium}),{campaign:'Yaz_Lansman_2026',source:'Facebook_Ads',medium:'app'},'provider labels are cleaned to the tag alphabet');
  assert.equal(touch.entity_key,attributionEntity(f.KEY,f.scope,'user','user-42'),'keyed by the customer id, as the backend sends it');
  const trail=f.db.prepare("SELECT entity_key FROM platform_attribution_events WHERE event_name='mobile.install'").get();
  assert.equal(trail.entity_key,touch.entity_key,'the install joins the person’s trail');
  f.send([{id:'s-1',entityId:'user-42',eventName:'user.signed_up',occurredAt:ago(2),attributes:{amount:0}}]);
  // Without a stage mapping, the most frequent event names stand in: the install and the backend signup.
  const report=new ProjectAttribution(f.db,f.scope).report(30);
  const signup=report.stages.findIndex(stage=>stage.eventName==='user.signed_up');assert.ok(signup>=0);
  assert.equal(report.other.length,1);assert.equal(report.other[0].campaign,'Yaz_Lansman_2026','the app campaign shows with its own name');
  assert.equal(report.other[0].counts[signup],1,'the backend signup counts for the install’s campaign');
}));

test('organic, provider-only and non-primary installs leave no touch; an earlier web touch still wins',run(f=>{
  recordMobileEvents(f.service,f.app,'appsflyer',[install('o-1','user-1',{campaign:'',channel:'organic'}),install('p-1','user-2',{identity:'provider'})]);
  recordMobileEvents(f.service,f.app,'bridge',[install('b-1','user-3')]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_attribution_touches').get().n,0,'only the primary attribution source credits a campaign');
  f.send([{id:'w-1',entityId:'user-4',eventName:'user.signed_up',occurredAt:ago(1),attributes:{amount:0},attribution:{campaign:'rz_0123456789',source:'instagram',medium:'social',touchedAt:ago(5)}}]);
  recordMobileEvents(f.service,f.app,'appsflyer',[install('i-4','user-4')]);
  assert.equal(f.db.prepare('SELECT campaign FROM platform_attribution_touches').get().campaign,'rz_0123456789','first touch wins');
}));

test('profile links: one fixed tag per platform, named in the report',run(f=>{
  const attribution=new ProjectAttribution(f.db,f.scope),links=attribution.settings().profileLinks;
  assert.deepEqual(plain(links.map(item=>item.platform)),['instagram','tiktok']);
  const url=new URL(links[0].url);assert.equal(url.origin,'https://example.com');assert.equal(url.searchParams.get('utm_campaign'),profileTag(f.scope,'instagram'));
  f.send([{id:'w-1',entityId:'user-9',eventName:'user.signed_up',occurredAt:ago(1),attributes:{amount:0},attribution:{campaign:profileTag(f.scope,'instagram'),source:'instagram',medium:'social',touchedAt:ago(2)}}]);
  const item=attribution.report(30).items[0];
  assert.deepEqual(plain({kind:item.kind,title:item.title}),{kind:'profile',title:'Instagram'});
}));

const {GoogleAdsClient,LinkedInAdsClient}=load('ad-providers.ts');
const day=offset=>new Date(Date.now()-offset*86400000).toISOString().slice(0,10);
function adPlan(f,provider='meta',patch={}){
  const now=new Date().toISOString(),connection=`qa-ads-${provider}`;
  f.db.prepare("INSERT OR IGNORE INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,?,?,?,?,1,?)").run(connection,f.scope.organizationId,f.scope.projectId,`${provider}_ads`,`qa-${provider}`,'QA ads · not real','{}',now);
  const id=`plan-${provider}`;
  f.db.prepare("INSERT INTO platform_ad_plans(id,organization_id,project_id,connection_id,provider,name,objective,daily_budget_minor,currency,start_date,end_date,countries_json,link_url,state,digest,created_by,created_at,updated_at,provider_campaign_id) VALUES(?,?,?,?,?,?,'OUTCOME_TRAFFIC',5000,'TRY',?,?,'[\"TR\"]','https://example.com','active','d',?,?,?,?)")
    .run(id,f.scope.organizationId,f.scope.projectId,connection,provider,'Yaz Lansmanı',patch.start||day(40),patch.end||day(-10),f.scope.subject,now,now,'provider-campaign' in patch?patch['provider-campaign']:'120000000000');
  return id;
}

test('ad spend sync: last 30 closed days, the plan name or given campaign name, no estimates',async()=>{const f=setup();try{
  const plan=adPlan(f),calls=[];
  const fake=provider=>({dailySpend:async input=>{calls.push({provider,...input});return {plan:{id:plan,name:'Yaz Lansmanı',currency:'TRY'},days:[{day:day(2),amount:120.5},{day:day(1),amount:80}]};}});
  const result=await f.service.syncAdSpend({appId:f.app.id,provider:'meta',planId:plan},fake);
  assert.equal(result.synced,2);assert.equal(calls[0].from,day(30));assert.equal(calls[0].to,day(1),'only closed days');
  const rows=f.db.prepare('SELECT campaign_id,attribution_campaign,day,currency,amount FROM platform_mobile_costs ORDER BY day').all();
  assert.deepEqual(plain(rows.map(row=>[row.campaign_id,row.attribution_campaign,row.currency,row.amount])),[[`ad:meta:${plan}`,'Yaz Lansmanı','TRY',120.5],[`ad:meta:${plan}`,'Yaz Lansmanı','TRY',80]]);
  await f.service.syncAdSpend({appId:f.app.id,provider:'meta',planId:plan,attributionCampaign:'yaz_lansman_af'},fake);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_mobile_costs').get().n,2,'a second pull updates the same days');
  assert.equal(f.db.prepare('SELECT DISTINCT attribution_campaign c FROM platform_mobile_costs').get().c,'yaz_lansman_af');
  const report=require('./platform-loader.cjs').load('mobile-report.ts').mobileReport(f.service,f.app.id);
  assert.ok(report.warnings.includes('spend_synced'));assert.ok(!report.warnings.includes('spend_manual'),'no manual entry, no manual warning');
  await assert.rejects(()=>f.service.syncAdSpend({appId:f.app.id,provider:'tiktok',planId:plan},fake),e=>e.status===400);
  await assert.rejects(()=>f.service.syncAdSpend({appId:f.app.id,provider:'meta',planId:adPlan(f,'google',{'provider-campaign':null})},fake),e=>e.status===404,'the provider must match the plan');
  const future=adPlan(f,'linkedin',{start:day(-5),end:day(-30)});
  await assert.rejects(()=>f.service.syncAdSpend({appId:f.app.id,provider:'linkedin',planId:future},fake),e=>e.status===409,'a plan that has not started has no closed day');
}finally{f.db.close();}});

test('Google and LinkedIn daily spend parse only well-formed days and costs',async()=>{
  const saved=process.env.PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN;process.env.PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN='qa-developer-token-only';try{
  const plan={provider_campaign_id:'customers/1234567890/campaigns/55',start_date:day(10),end_date:day(1)};
  const google=new GoogleAdsClient(async()=>({status:200,header:()=>null,payload:{results:[{segments:{date:day(3)},metrics:{costMicros:'12500000'}},{segments:{date:'bad'},metrics:{costMicros:'1'}},{segments:{date:day(2)},metrics:{}}]}}),'1234567890','qa-token');
  assert.deepEqual(plain(await google.dailySpend(plan,100,day(10),day(1))),[{day:day(3),spendMinor:1250}]);
  const linkedin=new LinkedInAdsClient(async()=>({status:200,header:()=>null,payload:{elements:[{costInLocalCurrency:'7.25',dateRange:{start:{year:2026,month:10,day:5}}},{costInLocalCurrency:'x',dateRange:{start:{year:2026,month:10,day:6}}}]}}),'123456','qa-token');
  assert.deepEqual(plain(await linkedin.dailySpend({...plan,provider_campaign_id:'987654'},100,day(10),day(1))),[{day:'2026-10-05',spendMinor:725}]);
  await assert.rejects(()=>google.dailySpend({...plan,provider_campaign_id:'nope'},100,day(10),day(1)));
  }finally{if(saved===undefined)delete process.env.PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN;else process.env.PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN=saved;}
});

test('event quotas follow the plan; the mobile report reads up to 90 closed days',run(f=>{
  const {projectEventLimits,DEFAULT_EVENT_LIMITS}=load('entitlements.ts');
  assert.deepEqual(plain(projectEventLimits(f.db,f.scope)),plain(DEFAULT_EVENT_LIMITS),'pilot and trial projects keep the stock quota');
  assert.deepEqual(plain(projectEventLimits(f.db,{organizationId:'crewin',projectId:'crewinjob'})),{perDay:20000,stored:200000});
  const {mobileReport}=load('mobile-report.ts');
  assert.equal(mobileReport(f.service,f.app.id,day(60),day(1)).from,day(60));
  assert.throws(()=>mobileReport(f.service,f.app.id,day(95),day(1)),e=>e.status===400,'still within the 90-day window');
}));
