const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {ProjectAds,metaAdsGraph,adMinorUnit}=load('ad-manager.ts');
const KEY='34'.repeat(32),TOKEN='EAAFixtureMetaAdsTokenOnly';
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
// Disposable Graph API: records every call; never touches the network.
const graph=(answers={})=>{const calls=[];let next=900;const fn=async(method,path,token,params={})=>{calls.push({method,path,token,params});
  const key=`${method} ${path.replace(/\d{3,}/g,'#')}`,answer=answers[key];if(answer instanceof Error)throw answer;if(answer)return answer;
  if(key==='GET act_#')return {id:'act_123456',name:'QA ads',currency:'USD',account_status:1,timezone_name:'Europe/Istanbul'};
  if(key.startsWith('POST act_#/'))return {id:String(++next)};if(key.endsWith('/insights'))return {data:[{spend:'12.34',impressions:'5400',clicks:'87'}]};return {success:true};};fn.calls=calls;return fn;};
const ads=(f,g=graph(),scope=f.scope)=>new ProjectAds(f.db,scope,KEY,g);
const plan=(extra={})=>({name:'Spring traffic',objective:'OUTCOME_TRAFFIC',dailyBudgetMinor:2000,startDate:day(1),endDate:day(10),countries:['tr','DE'],linkUrl:'https://example.com/spring',...extra});
const ready=async(f,g)=>{await ads(f,g).connect({adAccountId:'123456',accessToken:TOKEN});return ads(f,g).setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});};

test('the project connects its own ad account; the token is checked, stored encrypted and never shown',coachRun(async f=>{
  const g=graph();let snapshot=await ads(f,g).connect({adAccountId:'123456',accessToken:TOKEN});
  assert.equal(snapshot.account.adAccountId,'act_123456');assert.equal(snapshot.account.currency,'USD');assert.equal(g.calls[0].path,'act_123456');
  assert.doesNotMatch(JSON.stringify(snapshot)+JSON.stringify(f.db.prepare('SELECT * FROM platform_connections').all()),/EAAFixture/);
  await assert.rejects(ads(f,graph({'GET act_#':new Error('denied')})).connect({adAccountId:'act_999',accessToken:TOKEN}),error=>error.status===502);
  await assert.rejects(ads(f).connect({adAccountId:'not-an-id',accessToken:TOKEN}),/act_123/);
  const editor=f.member('editor');await assert.rejects(ads(f,g,editor).connect({adAccountId:'123456',accessToken:TOKEN}),error=>error.status===403);
  assert.equal(ads(f,g,f.other).read().account,null,'other projects see nothing');
  assert.equal(adMinorUnit('USD'),100);assert.equal(adMinorUnit('JPY'),1);
}));
test('plans stay inside the caps, need an end date and are approved on their exact content',coachRun(async f=>{
  const g=graph();await ads(f,g).connect({adAccountId:'123456',accessToken:TOKEN});
  assert.throws(()=>ads(f,g).savePlan(plan()),/bütçe tavanı/,'a cap comes first');
  await ready(f,g);
  for(const [extra,pattern] of [[{dailyBudgetMinor:6000},/günlük tavan/],[{endDate:day(40)},/31 gün/],[{startDate:day(-1)},/başlangıç/],[{countries:['TUR']},/ülke/],[{linkUrl:'http://example.com'},/https/],[{objective:'OUTCOME_SALES'},/hedef/]])assert.throws(()=>ads(f,g).savePlan(plan(extra)),pattern,JSON.stringify(extra));
  assert.throws(()=>ads(f,g).setPolicy({dailyCapMinor:5000,monthlyCapMinor:4000,expectedRevision:1}),/aylık tavan/);
  ads(f,g).setPolicy({dailyCapMinor:5000,monthlyCapMinor:15000,expectedRevision:1});
  assert.throws(()=>ads(f,g).savePlan(plan()),/aylık tavanı/,'2000 × 10 days exceeds a 15000 monthly cap');
  ads(f,g).setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:2});
  const editor=f.member('editor');let snapshot=ads(f,g,editor).savePlan(plan());let item=snapshot.plans[0];
  assert.equal(item.state,'draft');assert.equal(item.totalMinor,20000);assert.deepEqual(plain(item.countries),['TR','DE']);
  assert.throws(()=>ads(f,g,editor).approve({id:item.id,expectedRevision:item.revision}),error=>error.status===403);
  item=ads(f,g).approve({id:item.id,expectedRevision:item.revision}).plans[0];assert.equal(item.state,'approved');assert.equal(item.approved,true);
  item=ads(f,g,editor).savePlan({...plan({name:'Spring traffic v2'}),id:item.id,expectedRevision:item.revision}).plans[0];assert.equal(item.state,'draft','an edit clears the approval');assert.equal(item.approved,false);
}));
test('creating puts a PAUSED campaign and ad set on Meta; starting needs the switch, acknowledgement and the monthly cap',coachRun(async f=>{
  const g=graph();await ready(f,g);let item=ads(f,g).savePlan(plan()).plans[0];item=ads(f,g).approve({id:item.id,expectedRevision:item.revision}).plans[0];
  item=(await ads(f,g).create({id:item.id})).plans[0];assert.equal(item.state,'created');assert.ok(item.providerCampaignId);
  const created=g.calls.filter(call=>call.method==='POST');assert.deepEqual(plain(created.map(call=>call.params.status)),['PAUSED','PAUSED']);assert.equal(created[1].params.daily_budget,'2000');assert.equal(created[1].params.optimization_goal,'LINK_CLICKS');assert.equal(created[0].params.special_ad_categories,'[]');
  process.env.PLATFORM_ADS_ENABLED='0';
  await assert.rejects(ads(f,g).start({id:item.id,acknowledged:true}),/kapalı/);
  process.env.PLATFORM_ADS_ENABLED='1';
  try{
    await assert.rejects(ads(f,g).start({id:item.id}),/açık onay/);
    const editor=f.member('editor');await assert.rejects(ads(f,g,editor).start({id:item.id,acknowledged:true}),error=>error.status===403);
    item=(await ads(f,g).start({id:item.id,acknowledged:true})).plans[0];assert.equal(item.state,'active');
    // A second plan that would push this month's planned spend over the cap cannot start.
    const planned=ads(f,g).read().plannedActiveMinor;assert.ok(planned>=2000);ads(f,g).setPolicy({dailyCapMinor:5000,monthlyCapMinor:planned+2000,expectedRevision:1});
    let second=ads(f,g).savePlan(plan({name:'Second',dailyBudgetMinor:2500,endDate:day(1)})).plans.find(row=>row.name==='Second');second=ads(f,g).approve({id:second.id,expectedRevision:second.revision}).plans.find(row=>row.id===second.id);
    second=(await ads(f,g).create({id:second.id})).plans.find(row=>row.id===second.id);
    await assert.rejects(ads(f,g).start({id:second.id,acknowledged:true}),/aylık tavanı/);
    // Any writer can pause; Meta's reported spend is stored as reported.
    item=(await ads(f,g,editor).pause({id:item.id})).plans.find(row=>row.id===item.id);assert.equal(item.state,'paused');
    item=(await ads(f,g,editor).refreshSpend({id:item.id})).plans.find(row=>row.id===item.id);assert.equal(item.spendMinor,1234);assert.equal(item.clicks,87);assert.equal(item.impressions,5400);
  }finally{process.env.PLATFORM_ADS_ENABLED='0';}
}));
test('provider failures are recorded honestly; a refused start leaves the campaign paused',coachRun(async f=>{
  const g=graph({'POST act_#/adsets':new Error('rejected')});await ready(f,g);let item=ads(f,g).savePlan(plan()).plans[0];item=ads(f,g).approve({id:item.id,expectedRevision:item.revision}).plans[0];
  item=(await ads(f,g).create({id:item.id})).plans[0];assert.equal(item.state,'failed');assert.match(item.lastError,/reklam seti/);
  const ok=graph({'POST #':new Error('no payment method')});let other=ads(f,ok).savePlan(plan({name:'Other'})).plans.find(row=>row.name==='Other');other=ads(f,ok).approve({id:other.id,expectedRevision:other.revision}).plans.find(row=>row.id===other.id);
  other=(await ads(f,ok).create({id:other.id})).plans.find(row=>row.id===other.id);process.env.PLATFORM_ADS_ENABLED='1';
  try{other=(await ads(f,ok).start({id:other.id,acknowledged:true})).plans.find(row=>row.id===other.id);assert.equal(other.state,'paused');assert.match(other.lastError,/reddetti/);}finally{process.env.PLATFORM_ADS_ENABLED='0';}
  const viewer=f.member('viewer');assert.equal(ads(f,ok,viewer).read().plans.length,2);assert.throws(()=>ads(f,ok,viewer).savePlan(plan()),error=>error.status===403);
}));
test('the Graph client keeps the token in the header, fixes the host and rejects other paths',async()=>{
  const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return Response.json({id:'1'});};
  try{await metaAdsGraph('GET','act_123',TOKEN,{fields:'name'});assert.match(calls[0].url,/^https:\/\/graph\.facebook\.com\/v\d+\.\d\/act_123\?fields=name$/);assert.doesNotMatch(calls[0].url,/EAAFixture/);assert.equal(calls[0].options.headers.Authorization,`Bearer ${TOKEN}`);assert.equal(calls[0].options.redirect,'error');
    await assert.rejects(metaAdsGraph('POST','me/adaccounts',TOKEN),/Invalid ad path/);await assert.rejects(metaAdsGraph('GET','../act_1',TOKEN),/Invalid ad path/);}
  finally{globalThis.fetch=original;}
});
test('schema44 is additive and repeatable',coachRun(async f=>{
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'ads-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeAdSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,43);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,64);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
