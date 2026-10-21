const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {ProjectAds}=load('ad-manager.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const {adHttp,googleCustomerId,linkedInAccountId}=load('ad-providers.ts');
const KEY='78'.repeat(32);
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
// Disposable provider HTTP: answers by method and path, records every request. No network is used.
const http=(answers={})=>{const calls=[];let next=500;const fn=async request=>{const url=new URL(request.url),key=`${request.method} ${url.pathname.replace(/\d{3,}/g,'#')}`,body=request.body?JSON.parse(request.body):null;calls.push({...request,key,body,url});
  const answer=answers[key];if(answer instanceof Error)throw answer;if(typeof answer==='function')return answer(body,url);if(answer)return {status:200,header:()=>null,payload:answer};
  if(key.endsWith('/googleAds:search')){const q=body.query;
    if(q.includes('FROM customer '))return {status:200,header:()=>null,payload:{results:[{customer:{descriptiveName:'QA Google Ads',currencyCode:'EUR',timeZone:'Europe/Berlin',status:'ENABLED'}}]}};
    if(q.includes('FROM geo_target_constant'))return {status:200,header:()=>null,payload:{results:[{geoTargetConstant:{resourceName:'geoTargetConstants/2792',countryCode:'TR'}},{geoTargetConstant:{resourceName:'geoTargetConstants/2276',countryCode:'DE'}}]}};
    if(q.includes('FROM campaign '))return {status:200,header:()=>null,payload:{results:[{metrics:{costMicros:'12340000',impressions:'4000',clicks:'90'}}]}};}
  if(key.endsWith('/campaignBudgets:mutate'))return {status:200,header:()=>null,payload:{results:[{resourceName:'customers/1234567890/campaignBudgets/777'}]}};
  if(key.endsWith('/campaigns:mutate'))return {status:200,header:()=>null,payload:{results:[{resourceName:'customers/1234567890/campaigns/888'}]}};
  if(key.endsWith('/campaignCriteria:mutate'))return {status:200,header:()=>null,payload:{results:[{},{}]}};
  if(key==='GET /rest/adAccounts/#')return {status:200,header:()=>null,payload:{id:510000001,name:'QA LinkedIn',currency:'USD',status:'ACTIVE'}};
  if(key==='GET /rest/adTargetingEntities')return {status:200,header:()=>null,payload:{elements:[{urn:'urn:li:geo:102105699',name:'Türkiye'},{urn:'urn:li:geo:101282230',name:'Germany'},{urn:'urn:li:geo:103644278',name:'United States'}]}};
  if(key==='POST /rest/adAccounts/#/adCampaignGroups'||key==='POST /rest/adAccounts/#/adCampaigns'){const id=String(++next);return {status:201,header:name=>name==='x-restli-id'?id:null,payload:{}};}
  if(key==='GET /rest/adAnalytics')return {status:200,header:()=>null,payload:{elements:[{costInLocalCurrency:'45.60',impressions:7000,clicks:55}]}};
  return {status:204,header:()=>null,payload:{}};};fn.calls=calls;return fn;};
const refresh=async credentials=>({...credentials,accessToken:'ya29.refreshed-fixture',expiresAt:Date.now()+3600000});
const ads=(f,provider,h,scope=f.scope)=>new ProjectAds(f.db,scope,KEY,undefined,provider,h,refresh);
const plan=(extra={})=>({name:'Autumn traffic',objective:'OUTCOME_TRAFFIC',dailyBudgetMinor:2500,startDate:day(1),endDate:day(10),countries:['TR','DE'],linkUrl:'https://example.com/autumn',...extra});
const run=fn=>coachRun(async f=>{const saved={...process.env};try{process.env.PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN='FixtureDevToken_123';process.env.PLATFORM_ADS_ENABLED='0';await fn(f);}finally{for(const key of ['PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN','PLATFORM_ADS_ENABLED'])if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});

test('ids and hosts are checked before any provider call',async()=>{
  assert.equal(googleCustomerId('123-456-7890'),'1234567890');assert.equal(googleCustomerId('12345'),null);
  assert.equal(linkedInAccountId('urn:li:sponsoredAccount:510000001'),'510000001');assert.equal(linkedInAccountId('abc'),null);
  for(const url of ['https://evil.example/x','http://api.linkedin.com/rest/x','https://api.linkedin.com/rest/x?access_token=1'])await assert.rejects(adHttp({method:'GET',url,headers:{}}),url);
});
test('LinkedIn: connect, caps, approval and a PAUSED campaign group and campaign; start needs the switch',run(async f=>{
  const h=http(),TOKEN='AQXFixtureLinkedInAdsToken';
  await assert.rejects(ads(f,'linkedin',h).connect({adAccountId:'x',accessToken:TOKEN}),/yalnız rakam/);
  let snapshot=await ads(f,'linkedin',h).connect({adAccountId:'510000001',accessToken:TOKEN});
  assert.equal(snapshot.provider,'linkedin');assert.equal(snapshot.account.currency,'USD');assert.equal(h.calls[0].headers['Linkedin-Version'].length,6);assert.equal(h.calls[0].headers['X-Restli-Protocol-Version'],'2.0.0');
  assert.doesNotMatch(JSON.stringify(snapshot)+JSON.stringify(f.db.prepare('SELECT * FROM platform_connections').all()),/AQXFixture/);
  assert.equal(ads(f,'meta').read().account,null,'Meta and LinkedIn accounts are separate');
  ads(f,'linkedin',h).setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});assert.equal(ads(f,'meta').read().policy,null,'caps are per provider');
  assert.throws(()=>ads(f,'linkedin',h).savePlan(plan({specialCategory:'HOUSING'})),/yalnız Meta/);
  let item=ads(f,'linkedin',h).savePlan(plan({objective:'OUTCOME_AWARENESS'})).plans[0];item=ads(f,'linkedin',h).approve({id:item.id,expectedRevision:item.revision}).plans[0];
  assert.equal(ads(f,'meta').read().plans.length,0,'plans are per provider');
  snapshot=await ads(f,'linkedin',h).create({id:item.id});item=snapshot.plans[0];assert.equal(item.state,'created');
  const group=h.calls.find(c=>c.key.endsWith('/adCampaignGroups')).body,campaign=h.calls.find(c=>c.key.endsWith('/adCampaigns')&&c.method==='POST').body;
  assert.equal(group.status,'PAUSED');assert.equal(campaign.status,'PAUSED');assert.equal(campaign.objectiveType,'BRAND_AWARENESS');assert.equal(campaign.optimizationTargetType,'MAX_IMPRESSION');
  assert.deepEqual(plain(campaign.dailyBudget),{amount:'25.00',currencyCode:'USD'});assert.deepEqual(plain(campaign.targetingCriteria.include.and[0].or['urn:li:adTargetingFacet:locations']),['urn:li:geo:102105699','urn:li:geo:101282230']);
  await assert.rejects(ads(f,'linkedin',h).start({id:item.id,acknowledged:true}),error=>error.status===409,'the server switch is off');
  process.env.PLATFORM_ADS_ENABLED='1';snapshot=await ads(f,'linkedin',h).start({id:item.id,acknowledged:true});assert.equal(snapshot.plans[0].state,'active');
  const patches=h.calls.filter(c=>c.headers['X-RestLi-Method']==='PARTIAL_UPDATE');assert.deepEqual(plain(patches.map(c=>c.body.patch.$set.status)),['ACTIVE','ACTIVE']);
  snapshot=await ads(f,'linkedin',h).pause({id:item.id});assert.equal(snapshot.plans[0].state,'paused');
  snapshot=await ads(f,'linkedin',h).refreshSpend({id:item.id});assert.equal(snapshot.plans[0].spendMinor,4560);assert.equal(snapshot.plans[0].clicks,55);
  const unknown=http({'GET /rest/adTargetingEntities':{elements:[]}});let other=ads(f,'linkedin',unknown).savePlan(plan({name:'Elsewhere'})).plans.find(p=>p.name==='Elsewhere');other=ads(f,'linkedin',unknown).approve({id:other.id,expectedRevision:other.revision}).plans.find(p=>p.id===other.id);
  assert.equal((await ads(f,'linkedin',unknown).create({id:other.id})).plans.find(p=>p.id===other.id).state,'failed','an unknown location is never guessed');
  assert.equal(unknown.calls.some(c=>c.key.endsWith('/adCampaignGroups')),false);
}));
test('Google Ads: sign-in first, then the account is read with the developer token; a PAUSED Search campaign with its own budget',run(async f=>{
  const h=http();
  await assert.rejects(ads(f,'google',h).connect({}),error=>error.status===409,'no Google sign-in yet');
  new ProjectMarketingStore(f.db,f.scope).saveConnection({provider:'google_ads',integrationId:'1234567890',accountName:'Google Ads',accessToken:'ya29.fixture-old',refreshToken:'1//fixture-refresh',googleOAuth:true,expiresAt:Date.now()-1000},KEY);
  let snapshot=ads(f,'google',h).read();assert.equal(snapshot.pendingVerification,true);assert.equal(snapshot.account,null);
  snapshot=await ads(f,'google',h).connect({});assert.equal(snapshot.account.currency,'EUR');assert.equal(snapshot.account.adAccountId,'1234567890');
  const first=h.calls[0];assert.equal(first.headers.Authorization,'Bearer ya29.refreshed-fixture','the expired token is refreshed first');assert.equal(first.headers['developer-token'],'FixtureDevToken_123');assert.match(first.url.pathname,/^\/v\d{2}\/customers\/1234567890\/googleAds:search$/);
  assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM platform_connections').all())+JSON.stringify(snapshot),/ya29|fixture-refresh/);
  ads(f,'google',h).setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  assert.throws(()=>ads(f,'google',h).savePlan(plan({objective:'OUTCOME_AWARENESS'})),error=>error.status===409,'only Search traffic plans');
  let item=ads(f,'google',h).savePlan(plan()).plans[0];item=ads(f,'google',h).approve({id:item.id,expectedRevision:item.revision}).plans[0];
  snapshot=await ads(f,'google',h).create({id:item.id});item=snapshot.plans[0];assert.equal(item.state,'created');assert.equal(item.providerCampaignId,'customers/1234567890/campaigns/888');
  const budget=h.calls.find(c=>c.key.endsWith('/campaignBudgets:mutate')).body.operations[0].create,campaign=h.calls.find(c=>c.key.endsWith('/campaigns:mutate')).body.operations[0].create;
  assert.equal(budget.amountMicros,'25000000');assert.equal(campaign.status,'PAUSED');assert.equal(campaign.advertisingChannelType,'SEARCH');assert.equal(campaign.startDateTime,`${day(1)} 00:00:00`);
  assert.equal(h.calls.find(c=>c.key.endsWith('/campaignCriteria:mutate')).body.operations.length,2);
  process.env.PLATFORM_ADS_ENABLED='1';snapshot=await ads(f,'google',h).start({id:item.id,acknowledged:true});assert.equal(snapshot.plans[0].state,'active');
  const enable=h.calls.filter(c=>c.key.endsWith('/campaigns:mutate')).pop().body.operations[0];assert.deepEqual(plain(enable),{update:{resourceName:'customers/1234567890/campaigns/888',status:'ENABLED'},updateMask:'status'});
  snapshot=await ads(f,'google',h).refreshSpend({id:item.id});assert.equal(snapshot.plans[0].spendMinor,1234);assert.equal(snapshot.plans[0].impressions,4000);
  delete process.env.PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN;assert.equal(ads(f,'google',h).read().providerReady,false);
  const viewer=f.member('viewer');await assert.rejects(ads(f,'google',h,viewer).pause({id:item.id}),error=>error.status===403);
}));
