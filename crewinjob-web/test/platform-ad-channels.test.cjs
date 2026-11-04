const assert=require('node:assert/strict');
const {test}=require('node:test');
const crypto=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {ProjectAds}=load('ad-manager.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const {MobileGrowth}=load('mobile-store.ts');
const {tiktokAdvertiserId,normalizeAppleSearch}=load('ad-providers.ts');
const KEY='56'.repeat(32);
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
const ok=payload=>({status:200,header:()=>null,payload});
// Disposable provider HTTP for TikTok, Apple Search Ads and Google: answers by method and path, records every request.
const http=(answers={})=>{const calls=[];const fn=async request=>{const url=new URL(request.url),key=`${request.method} ${url.hostname} ${url.pathname.replace(/\d{3,}/g,'#')}`;
  const body=!request.body?null:request.headers['Content-Type']==='application/json'?JSON.parse(request.body):Object.fromEntries(new URLSearchParams(request.body));calls.push({...request,key,body,url});
  const answer=answers[key];if(answer instanceof Error)throw answer;if(typeof answer==='function')return answer(body,url);if(answer)return ok(answer);
  if(key==='GET business-api.tiktok.com /open_api/v1.3/advertiser/info/')return ok({code:0,data:{list:[{name:'QA TikTok',currency:'USD',status:'STATUS_ENABLE',timezone:'Europe/Istanbul'}]}});
  if(key==='POST business-api.tiktok.com /open_api/v1.3/campaign/create/')return ok({code:0,data:{campaign_id:'1800000000000001'}});
  if(key==='POST business-api.tiktok.com /open_api/v1.3/campaign/status/update/')return ok({code:0,data:{}});
  if(key==='GET business-api.tiktok.com /open_api/v1.3/report/integrated/get/')return ok({code:0,data:{list:url.searchParams.get('start_date')?[{dimensions:{campaign_id:'1800000000000001',stat_time_day:`${day(1)} 00:00:00`},metrics:{spend:'7.25'}},{dimensions:{stat_time_day:'bad'},metrics:{spend:'1'}}]:[{metrics:{spend:'12.50',impressions:'3000',clicks:'40'}}]}});
  if(key==='POST appleid.apple.com /auth/oauth2/token')return ok({access_token:'apple-fixture-access',expires_in:3600});
  if(key==='GET api.searchads.apple.com /api/v5/acls')return ok({data:[{orgId:4400001,orgName:'QA Apple',currency:'USD',paymentModel:'PAYG',timeZone:'Europe/Istanbul'}]});
  if(key==='POST api.searchads.apple.com /api/v5/campaigns')return ok({data:{id:9900001}});
  if(key==='PUT api.searchads.apple.com /api/v5/campaigns/#')return ok({data:{}});
  if(key==='POST api.searchads.apple.com /api/v5/reports/campaigns')return ok({data:{reportingDataResponse:{row:[body.granularity?{granularity:[{date:day(1),localSpend:{amount:'3.40',currency:'USD'}}]}:{total:{localSpend:{amount:'21.00',currency:'USD'},impressions:900,taps:33}}]}}});
  if(key.endsWith('/googleAds:search')){const q=body.query;
    if(q.includes('FROM customer '))return ok({results:[{customer:{descriptiveName:'QA Google Ads',currencyCode:'EUR',timeZone:'Europe/Berlin',status:'ENABLED'}}]});
    if(q.includes('FROM geo_target_constant'))return ok({results:[{geoTargetConstant:{resourceName:'geoTargetConstants/2792',countryCode:'TR'}},{geoTargetConstant:{resourceName:'geoTargetConstants/2276',countryCode:'DE'}}]});}
  if(key.endsWith('/campaignBudgets:mutate'))return ok({results:[{resourceName:'customers/1234567890/campaignBudgets/777'}]});
  if(key.endsWith('/campaigns:mutate'))return ok({results:[{resourceName:'customers/1234567890/campaigns/888'}]});
  if(key.endsWith('/campaignCriteria:mutate'))return ok({results:[{},{}]});
  return {status:404,header:()=>null,payload:{}};};fn.calls=calls;return fn;};
// Disposable Meta Graph API.
const graph=()=>{const calls=[];let next=900;const fn=async(method,path,token,params={})=>{calls.push({method,path,token,params});
  if(method==='GET'&&/^act_\d+$/.test(path))return {id:path,name:'QA ads',currency:'USD',account_status:1,timezone_name:'Europe/Istanbul'};
  if(method==='POST'&&path.startsWith('act_'))return {id:String(++next)};return {success:true};};fn.calls=calls;return fn;};
const refresh=async credentials=>({...credentials,accessToken:'ya29.refreshed-fixture',expiresAt:Date.now()+3600000});
const ads=(f,provider,h,scope=f.scope)=>new ProjectAds(f.db,scope,KEY,undefined,provider,h,refresh);
const APPLE_APP={store:'apple',appId:'1234567890',storeUrl:'https://apps.apple.com/tr/app/qa-ink/id1234567890'};
const PLAY_APP={store:'google',appId:'com.example.qaink',storeUrl:'https://play.google.com/store/apps/details?id=com.example.qaink'};
const plan=(extra={})=>({name:'Ink installs',objective:'OUTCOME_APP_PROMOTION',dailyBudgetMinor:2500,startDate:day(1),endDate:day(10),countries:['TR','DE'],linkUrl:'https://example.com/app',...extra});
// A throwaway Apple Search Ads API user: the key is generated here and never leaves the test.
const appleUser=()=>({adAccountId:'4400001',clientId:'SEARCHADS.0000aaaa-1111-2222-3333-444455556666',teamId:'SEARCHADS.0000aaaa-1111-2222-3333-444455556666',keyId:'0000bbbb-1111-2222-3333-444455556666',
  privateKey:crypto.generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({type:'pkcs8',format:'pem'})});
const run=fn=>coachRun(async f=>{const saved={...process.env};try{process.env.PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN='FixtureDevToken_123';process.env.PLATFORM_ADS_ENABLED='0';await fn(f);}finally{for(const key of ['PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN','PLATFORM_ADS_ENABLED'])if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
const approve=(f,provider,h,raw)=>{const item=ads(f,provider,h).savePlan(raw).plans.find(p=>p.name===raw.name);return ads(f,provider,h).approve({id:item.id,expectedRevision:item.revision}).plans.find(p=>p.id===item.id);};

test('ids and the Apple key are checked before any provider call',()=>{
  assert.equal(tiktokAdvertiserId(' 7000000000000001 '),'7000000000000001');assert.equal(tiktokAdvertiserId('abc'),null);
  const user=appleUser();assert.equal(normalizeAppleSearch(user).keyId,user.keyId);
  assert.throws(()=>normalizeAppleSearch({...user,privateKey:'-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----'}),/özel anahtarı/);
  const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});assert.throws(()=>normalizeAppleSearch({...user,privateKey:rsa}),/özel anahtarı/,'only EC keys');
  assert.throws(()=>normalizeAppleSearch({...user,clientId:'not-searchads'}),/biçimi hatalı/);
});
test('TikTok: connect, a DISABLE campaign for traffic or installs, start and pause need the switch, spend per day',run(async f=>{
  const h=http(),TOKEN='TikTokFixtureAccessToken';
  await assert.rejects(ads(f,'tiktok',h).connect({adAccountId:'x',accessToken:TOKEN}),/yalnız rakam/);
  await assert.rejects(ads(f,'tiktok',http({'GET business-api.tiktok.com /open_api/v1.3/advertiser/info/':{code:40001,message:'denied'}})).connect({adAccountId:'7000000000000001',accessToken:TOKEN}),error=>error.status===502&&/TikTok/.test(error.message));
  let snapshot=await ads(f,'tiktok',h).connect({adAccountId:'7000000000000001',accessToken:TOKEN});
  assert.equal(snapshot.provider,'tiktok');assert.equal(snapshot.account.currency,'USD');assert.equal(h.calls.at(-1).headers['Access-Token'],TOKEN);
  assert.doesNotMatch(JSON.stringify(snapshot)+JSON.stringify(f.db.prepare('SELECT * FROM platform_connections').all()),/TikTokFixture/);
  assert.equal(ads(f,'meta').read().account,null,'TikTok and Meta accounts are separate');
  ads(f,'tiktok',h).setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  let item=approve(f,'tiktok',h,plan({app:PLAY_APP}));assert.deepEqual(plain(item.app),PLAY_APP);
  snapshot=await ads(f,'tiktok',h).create({id:item.id});item=snapshot.plans.find(p=>p.id===item.id);assert.equal(item.state,'created');assert.equal(item.providerCampaignId,'1800000000000001');
  const created=h.calls.find(c=>c.key.endsWith('/campaign/create/')).body;
  assert.equal(created.operation_status,'DISABLE');assert.equal(created.objective_type,'APP_PROMOTION');assert.equal(created.app_promotion_type,'APP_INSTALL');assert.equal(created.budget,25);assert.equal(created.advertiser_id,'7000000000000001');
  await assert.rejects(ads(f,'tiktok',h).start({id:item.id,acknowledged:true}),error=>error.status===409,'the server switch is off');
  process.env.PLATFORM_ADS_ENABLED='1';snapshot=await ads(f,'tiktok',h).start({id:item.id,acknowledged:true});assert.equal(snapshot.plans.find(p=>p.id===item.id).state,'active');
  snapshot=await ads(f,'tiktok',h).pause({id:item.id});assert.equal(snapshot.plans.find(p=>p.id===item.id).state,'paused');
  assert.deepEqual(plain(h.calls.filter(c=>c.key.endsWith('/campaign/status/update/')).map(c=>c.body.operation_status)),['ENABLE','DISABLE']);
  snapshot=await ads(f,'tiktok',h).refreshSpend({id:item.id});item=snapshot.plans.find(p=>p.id===item.id);assert.equal(item.spendMinor,1250);assert.equal(item.clicks,40);
  const daily=await ads(f,'tiktok',h).dailySpend({id:item.id,from:day(0),to:day(5)});assert.deepEqual(plain(daily.days),[{day:day(1),amount:7.25}],'rows without a valid day are dropped');
  const filter=JSON.parse(h.calls.at(-1).url.searchParams.get('filtering'));assert.deepEqual(plain(JSON.parse(filter[0].filter_value)),['1800000000000001']);
  const traffic=approve(f,'tiktok',h,plan({name:'Ink visits',objective:'OUTCOME_TRAFFIC'}));await ads(f,'tiktok',h).create({id:traffic.id});
  const second=h.calls.filter(c=>c.key.endsWith('/campaign/create/')).at(-1).body;assert.equal(second.objective_type,'TRAFFIC');assert.equal(second.app_promotion_type,undefined);
  assert.equal(h.calls.every(c=>['business-api.tiktok.com'].includes(c.url.hostname)),true);
}));
test('Apple Search Ads: a signed client secret buys the token; only App Store install plans; PAUSED campaign, PUT status',run(async f=>{
  const h=http(),user=appleUser();
  await assert.rejects(ads(f,'apple_search',h).connect({...user,adAccountId:'org'}),/orgId/);
  await assert.rejects(ads(f,'apple_search',http({'POST appleid.apple.com /auth/oauth2/token':()=>({status:401,header:()=>null,payload:{error:'invalid_client'}})})).connect(user),error=>error.status===502);
  let snapshot=await ads(f,'apple_search',h).connect(user);assert.equal(snapshot.provider,'apple_search');assert.equal(snapshot.account.currency,'USD');assert.equal(snapshot.account.name,'QA Apple');
  const grant=h.calls.find(c=>c.key==='POST appleid.apple.com /auth/oauth2/token').body;assert.equal(grant.grant_type,'client_credentials');assert.equal(grant.scope,'searchadsorg');assert.equal(grant.client_id,user.clientId);
  const [header,claims,signature]=grant.client_secret.split('.');assert.deepEqual(plain(JSON.parse(Buffer.from(header,'base64url'))),{alg:'ES256',kid:user.keyId,typ:'JWT'});
  const body=JSON.parse(Buffer.from(claims,'base64url'));assert.equal(body.iss,user.teamId);assert.equal(body.sub,user.clientId);assert.equal(body.aud,'https://appleid.apple.com');assert.equal(body.exp-body.iat,3600);
  const publicKey=crypto.createPublicKey(user.privateKey);assert.equal(crypto.verify('sha256',Buffer.from(`${header}.${claims}`),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true,'a valid ES256 signature');
  const acl=h.calls.find(c=>c.key.endsWith('/acls'));assert.equal(acl.headers.Authorization,'Bearer apple-fixture-access');assert.equal(acl.headers['X-AP-Context'],'orgId=4400001');
  assert.doesNotMatch(JSON.stringify(snapshot)+JSON.stringify(f.db.prepare('SELECT * FROM platform_connections').all()),/PRIVATE KEY|apple-fixture-access/,'the key and the token are never stored in clear or shown');
  ads(f,'apple_search',h).setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  assert.throws(()=>ads(f,'apple_search',h).savePlan(plan({objective:'OUTCOME_TRAFFIC'})),error=>error.status===409,'install plans only');
  assert.throws(()=>ads(f,'apple_search',h).savePlan(plan({app:PLAY_APP})),/App Store/,'App Store apps only');
  let item=approve(f,'apple_search',h,plan({app:APPLE_APP}));
  snapshot=await ads(f,'apple_search',h).create({id:item.id});item=snapshot.plans.find(p=>p.id===item.id);assert.equal(item.state,'created');assert.equal(item.providerCampaignId,'9900001');
  const campaign=h.calls.find(c=>c.key==='POST api.searchads.apple.com /api/v5/campaigns').body;
  assert.equal(campaign.status,'PAUSED');assert.equal(campaign.adamId,1234567890);assert.equal(campaign.orgId,4400001);assert.deepEqual(plain(campaign.dailyBudgetAmount),{amount:'25.00',currency:'USD'});assert.deepEqual(plain(campaign.countriesOrRegions),['TR','DE']);
  const tokens=h.calls.filter(c=>c.url.hostname==='appleid.apple.com').length;assert.ok(tokens>=2,'a fresh token per request, never stored');
  process.env.PLATFORM_ADS_ENABLED='1';await ads(f,'apple_search',h).start({id:item.id,acknowledged:true});snapshot=await ads(f,'apple_search',h).pause({id:item.id});assert.equal(snapshot.plans.find(p=>p.id===item.id).state,'paused');
  assert.deepEqual(plain(h.calls.filter(c=>c.method==='PUT').map(c=>[c.url.pathname,c.body.campaign.status])),[['/api/v5/campaigns/9900001','ENABLED'],['/api/v5/campaigns/9900001','PAUSED']]);
  snapshot=await ads(f,'apple_search',h).refreshSpend({id:item.id});item=snapshot.plans.find(p=>p.id===item.id);assert.equal(item.spendMinor,2100);assert.equal(item.impressions,900);assert.equal(item.clicks,33);
  const daily=await ads(f,'apple_search',h).dailySpend({id:item.id,from:day(0),to:day(5)});assert.deepEqual(plain(daily.days),[{day:day(1),amount:3.4}]);
  const viewer=f.member('viewer');await assert.rejects(ads(f,'apple_search',h,viewer).pause({id:item.id}),error=>error.status===403);
}));
test('Meta and Google app installs: the promoted app is validated, part of the approval and sent to the provider',run(async f=>{
  const g=graph();await new ProjectAds(f.db,f.scope,KEY,g).connect({adAccountId:'123456',accessToken:'EAAFixtureMetaAppToken'});const meta=()=>new ProjectAds(f.db,f.scope,KEY,g);
  meta().setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  assert.throws(()=>meta().savePlan(plan({app:APPLE_APP})),/App ID/,'Meta needs its own app id');
  assert.throws(()=>meta().savePlan(plan({app:{...APPLE_APP,metaApplicationId:'5550001',storeUrl:'https://evil.example/app'}})),/apps\.apple\.com/);
  assert.throws(()=>meta().savePlan(plan({app:{...PLAY_APP,appId:'not a package',metaApplicationId:'5550001'}})),/paket adı/);
  assert.throws(()=>meta().savePlan(plan({app:undefined})),/mağaza/);
  let item=meta().savePlan(plan({app:{...APPLE_APP,metaApplicationId:'5550001'}})).plans[0];item=meta().approve({id:item.id,expectedRevision:item.revision}).plans[0];assert.equal(item.approved,true);
  const changed=meta().savePlan({...plan({app:{...APPLE_APP,appId:'1234567891',storeUrl:'https://apps.apple.com/tr/app/qa-ink/id1234567891',metaApplicationId:'5550001'}}),id:item.id,expectedRevision:item.revision}).plans[0];
  assert.equal(changed.state,'draft','changing the app clears the approval');assert.equal(changed.approved,false);
  item=meta().approve({id:changed.id,expectedRevision:changed.revision}).plans[0];
  const snapshot=await meta().create({id:item.id});assert.equal(snapshot.plans[0].state,'created');
  const campaign=g.calls.find(c=>c.path.endsWith('/campaigns')).params,adset=g.calls.find(c=>c.path.endsWith('/adsets')).params;
  assert.equal(campaign.objective,'OUTCOME_APP_PROMOTION');assert.equal(adset.optimization_goal,'APP_INSTALLS');assert.equal(adset.destination_type,undefined);
  assert.deepEqual(plain(JSON.parse(adset.promoted_object)),{application_id:'5550001',object_store_url:'https://apps.apple.com/tr/app/qa-ink/id1234567891'});

  const h=http();new ProjectMarketingStore(f.db,f.scope).saveConnection({provider:'google_ads',integrationId:'1234567890',accountName:'Google Ads',accessToken:'ya29.fixture-old',refreshToken:'1//fixture-refresh',googleOAuth:true,expiresAt:Date.now()-1000},KEY);
  await ads(f,'google',h).connect({});ads(f,'google',h).setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  assert.throws(()=>ads(f,'google',h).savePlan(plan({app:PLAY_APP})),/hedef maliyet/,'Google needs a target cost');
  assert.throws(()=>ads(f,'google',h).savePlan(plan({app:{...PLAY_APP,targetCostMinor:9000}})),/hedef maliyet/,'not above the daily budget');
  let google=approve(f,'google',h,plan({app:{...PLAY_APP,targetCostMinor:300}}));
  google=(await ads(f,'google',h).create({id:google.id})).plans.find(p=>p.id===google.id);assert.equal(google.state,'created');
  const app=h.calls.find(c=>c.key.endsWith('/campaigns:mutate')).body.operations[0].create;
  assert.equal(app.status,'PAUSED');assert.equal(app.advertisingChannelType,'MULTI_CHANNEL');assert.equal(app.advertisingChannelSubType,'APP_CAMPAIGN');
  assert.deepEqual(plain(app.appCampaignSetting),{appId:'com.example.qaink',appStore:'GOOGLE_APP_STORE',biddingStrategyGoalType:'OPTIMIZE_INSTALLS_TARGET_INSTALL_COST'});assert.equal(app.targetCpa.targetCpaMicros,'3000000');

  await ads(f,'linkedin',http({'GET api.linkedin.com /rest/adAccounts/#':{id:510000001,name:'QA LinkedIn',currency:'USD',status:'ACTIVE'}})).connect({adAccountId:'510000001',accessToken:'AQXFixtureLinkedInToken'});
  ads(f,'linkedin',h).setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  assert.throws(()=>ads(f,'linkedin',h).savePlan(plan({app:PLAY_APP})),error=>error.status===409,'no app installs on LinkedIn');
}));
test('the plan form offers the project’s mobile apps; other projects see none',run(async f=>{
  const app=new MobileGrowth(f.db,f.scope,KEY).saveApp({name:'QA Ink',platform:'both',appleId:'1234567890',bundleId:'com.example.qaink',packageName:'com.example.qaink',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'qaink',attributionProvider:'bridge',revenueProvider:'bridge',identityConfirmed:true});
  assert.deepEqual(plain(ads(f,'tiktok',http()).read().apps),[{id:app.id,name:'QA Ink',appleId:'1234567890',packageName:'com.example.qaink'}]);
  assert.deepEqual(plain(ads(f,'tiktok',http(),f.other).read().apps),[]);
}));
