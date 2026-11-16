const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {ProjectAds}=load('ad-manager.ts');
const {AdOptimizer,normalizeSearchContent}=load('ad-optimizer.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const KEY='91'.repeat(32),TOKEN='EAAFixtureOptimizerTokenOnly';
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
const ok=payload=>({status:200,header:()=>null,payload});
// Disposable Google Ads API: answers by path, records every request. No network is used.
const http=(mode={})=>{const calls=[];const fn=async request=>{const url=new URL(request.url),body=request.body?JSON.parse(request.body):null;calls.push({url,body,path:url.pathname});
  if(url.pathname.endsWith('/googleAds:search')){const q=body.query;
    if(q.includes('FROM customer '))return ok({results:[{customer:{descriptiveName:'QA Google Ads',currencyCode:'EUR',timeZone:'Europe/Berlin',status:'ENABLED'}}]});
    if(q.includes('FROM geo_target_constant'))return ok({results:[{geoTargetConstant:{resourceName:'geoTargetConstants/2792'}},{geoTargetConstant:{resourceName:'geoTargetConstants/2276'}}]});
    return ok({results:[]});}
  if(url.pathname.endsWith('/googleAds:mutate'))return mode.reject?{status:400,header:()=>null,payload:{error:{details:[{errors:[{message:'Too long.'},{message:'Policy finding.'}]}]}}}:ok(body.validateOnly?{}:{mutateOperationResponses:[{adGroupResult:{resourceName:'customers/1234567890/adGroups/555'}}]});
  if(url.pathname.endsWith(':generateKeywordIdeas'))return ok({results:[{text:'kahve makinesi',keywordIdeaMetrics:{avgMonthlySearches:'900',competition:'HIGH'}},{text:'espresso makinesi',keywordIdeaMetrics:{avgMonthlySearches:'4400',competition:'MEDIUM'}},{text:''}]});
  if(url.pathname.endsWith('/campaignBudgets:mutate'))return mode.budgetReject&&body.validateOnly?{status:400,header:()=>null,payload:{}}:ok({results:[{resourceName:'customers/1234567890/campaignBudgets/777'}]});
  if(url.pathname.endsWith('/campaigns:mutate'))return ok({results:[{resourceName:'customers/1234567890/campaigns/888'}]});
  return ok({results:[{},{}]});};fn.calls=calls;return fn;};
const refresh=async credentials=>({...credentials,accessToken:'ya29.refreshed-fixture',expiresAt:Date.now()+3600000});
const google=(f,h,scope=f.scope)=>new AdOptimizer(f.db,scope,KEY,undefined,'google',h,refresh);
const ENV=['PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN','PLATFORM_GOOGLE_ADS_CONTENT_ENABLED','PLATFORM_ADS_BUDGET_APPLY_ENABLED'];
const run=fn=>coachRun(async f=>{const saved=Object.fromEntries(ENV.map(key=>[key,process.env[key]]));try{process.env.PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN='FixtureDevToken_123';delete process.env.PLATFORM_GOOGLE_ADS_CONTENT_ENABLED;delete process.env.PLATFORM_ADS_BUDGET_APPLY_ENABLED;await fn(f);}
  finally{for(const key of ENV)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
// A created (paused) Google Search plan: campaign 888 with its own budget 777.
async function googlePlan(f,h){
  await new ProjectMarketingStore(f.db,f.scope).saveConnection({provider:'google_ads',integrationId:'1234567890',accountName:'Google Ads',accessToken:'ya29.fixture',refreshToken:'1//fixture-refresh',googleOAuth:true,expiresAt:Date.now()+3600000},KEY);
  const ads=new ProjectAds(f.db,f.scope,KEY,undefined,'google',h,refresh);await ads.connect({});await ads.setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  let item=(await ads.savePlan({name:'Autumn search',objective:'OUTCOME_TRAFFIC',dailyBudgetMinor:2500,startDate:day(1),endDate:day(10),countries:['TR','DE'],linkUrl:'https://example.com/autumn'})).plans[0];
  item=(await ads.approve({id:item.id,expectedRevision:item.revision})).plans[0];item=(await ads.create({id:item.id})).plans[0];assert.equal(item.state,'created');return item;
}
const content=(extra={})=>({keywords:[{text:'Espresso Makinesi',match:'PHRASE'},{text:'espresso makinesi',match:'PHRASE'},{text:'kahve makinesi',match:'EXACT'},{text:'barista',match:'BROAD'}],headlines:['Espresso evde','Kolay kurulum','Sessiz çalışır'],descriptions:['Evde kafe tadında espresso hazırlayın.','Kurulumu birkaç dakika sürer.'],finalUrl:'https://example.com/autumn?utm_source=google',...extra});

test('search content: Google limits are checked before anything is stored',()=>{
  const url='https://example.com/autumn',bad=(extra,pattern)=>assert.throws(()=>normalizeSearchContent(content(extra),url),pattern);
  const value=normalizeSearchContent(content(),url);assert.equal(value.keywords.length,3,'the same keyword and match once');assert.equal(value.keywords[0].text,'espresso makinesi');
  bad({headlines:['Bir','İki']},/3–15 başlık/);bad({headlines:['Bir','İki','Bu başlık otuz karakterden çok daha uzun']},/30 karakter/);bad({headlines:['Aynı','aynı','Başka']},/farklı/);
  bad({descriptions:['Tek açıklama']},/2–4 açıklama/);bad({keywords:[]},/1–50 anahtar/);bad({keywords:[{text:'indirim!',match:'BROAD'}]},/işaret/);
  bad({finalUrl:'https://elsewhere.example.net/'},/aynı alan adında/);bad({finalUrl:'http://example.com/autumn'},/https/);
  assert.equal(normalizeSearchContent(content({finalUrl:''}),url).finalUrl,url,'the plan link by default');
});

test('search content: drafted, approved by an approver, checked by Google without creating anything, sent only when switched on',run(async f=>{
  const h=http(),item=await googlePlan(f,h);
  let view=await google(f,h).searchContent({id:item.id});assert.equal(view.state,'none');assert.equal(view.finalUrl,'https://example.com/autumn');assert.equal(view.sendEnabled,false);
  const viewer=await f.member('viewer');await assert.rejects(google(f,h,viewer).saveSearchContent({id:item.id,...content()}),error=>error.status===403);
  await assert.rejects(new AdOptimizer(f.db,f.scope,KEY,undefined,'meta').searchContent({id:item.id}),error=>error.status===409,'Google plans only');
  // Keyword ideas use the plan's countries, the language and the site.
  const ideas=plain(await google(f,h).keywordIdeas({id:item.id,seeds:['espresso'],language:'tr'}));assert.deepEqual(ideas.map(idea=>idea.text),['espresso makinesi','kahve makinesi']);
  const asked=h.calls.find(call=>call.path.endsWith(':generateKeywordIdeas')).body;assert.deepEqual(plain(asked.geoTargetConstants),['geoTargetConstants/2792','geoTargetConstants/2276']);assert.equal(asked.language,'languageConstants/1037');assert.deepEqual(plain(asked.keywordAndUrlSeed),{keywords:['espresso'],url:'https://example.com/autumn'});
  // The AI suggests texts within the limits; nothing is saved by it.
  const texts=await google(f,h).draftTexts({id:item.id,keywords:['espresso']},async()=>JSON.stringify({headlines:['Espresso evde','Kolay kurulum','Bu başlık otuz karakterden çok daha uzun','Sessiz çalışır'],descriptions:['Evde kafe tadında espresso.','Kurulumu kolay.']}));
  assert.deepEqual(plain(texts.headlines),['Espresso evde','Kolay kurulum','Sessiz çalışır'],'too long lines are dropped');assert.equal((await google(f,h).searchContent({id:item.id})).state,'none');
  await assert.rejects(google(f,h).draftTexts({id:item.id},async()=>JSON.stringify({headlines:['En iyi espresso','Kolay','Hızlı'],descriptions:['%50 indirim garantili.','Bugün al.']})),error=>error.status===422);
  view=await google(f,h).saveSearchContent({id:item.id,...content(),expectedDigest:null});assert.equal(view.state,'draft');assert.equal(view.keywords.length,3);
  await assert.rejects(google(f,h).saveSearchContent({id:item.id,...content(),expectedDigest:'0'.repeat(64)}),error=>error.status===409,'another tab changed it');
  await assert.rejects(google(f,h).validateSearchContent({id:item.id}),error=>error.status===409,'not approved yet');
  const editor=await f.member('editor');await assert.rejects(google(f,h,editor).approveSearchContent({id:item.id,digest:view.digest}),error=>error.status===403);
  await assert.rejects(google(f,h).approveSearchContent({id:item.id,digest:'f'.repeat(64)}),error=>error.status===409);
  view=await google(f,h).approveSearchContent({id:item.id,digest:view.digest});assert.equal(view.state,'approved');
  // Validate only: one atomic request, a temporary ad group in the plan's campaign, keywords and the responsive search ad.
  view=await google(f,h).validateSearchContent({id:item.id});assert.equal(view.state,'validated');assert.ok(view.validatedAt);
  const check=h.calls.filter(call=>call.path.endsWith('/googleAds:mutate'));assert.equal(check.length,1);assert.equal(check[0].body.validateOnly,true);assert.equal(check[0].body.partialFailure,false);
  const ops=plain(check[0].body.mutateOperations);assert.equal(ops.length,5);
  assert.deepEqual({...ops[0].adGroupOperation.create,name:undefined},{resourceName:'customers/1234567890/adGroups/-1',campaign:'customers/1234567890/campaigns/888',name:undefined,status:'ENABLED',type:'SEARCH_STANDARD'});
  assert.deepEqual(ops[2].adGroupCriterionOperation.create,{adGroup:'customers/1234567890/adGroups/-1',status:'ENABLED',keyword:{text:'kahve makinesi',matchType:'EXACT'}});
  assert.deepEqual(ops[4].adGroupAdOperation.create.ad,{finalUrls:['https://example.com/autumn?utm_source=google'],responsiveSearchAd:{headlines:[{text:'Espresso evde'},{text:'Kolay kurulum'},{text:'Sessiz çalışır'}],descriptions:[{text:'Evde kafe tadında espresso hazırlayın.'},{text:'Kurulumu birkaç dakika sürer.'}]}});
  // Off by default: sending is refused until the server switches it on.
  await assert.rejects(google(f,h).sendSearchContent({id:item.id}),error=>error.status===409&&/kapalı/.test(error.message));
  // Google's own messages come back when it rejects the content; the state stays as it was.
  const rejecting=http({reject:true});view=await google(f,rejecting).validateSearchContent({id:item.id});assert.equal(view.state,'validated');assert.match(view.lastError,/Google: Too long\. · Policy finding\./);
  // Any edit needs a new approval and a new check.
  const edited=await google(f,h).saveSearchContent({id:item.id,...content({headlines:['Espresso evde','Kolay kurulum','Sessiz ve hızlı']})});assert.equal(edited.state,'draft');assert.equal(edited.validatedAt,null);assert.equal(edited.lastError,null);
  view=await google(f,h).approveSearchContent({id:item.id,digest:edited.digest});process.env.PLATFORM_GOOGLE_ADS_CONTENT_ENABLED='1';
  await assert.rejects(google(f,h).sendSearchContent({id:item.id}),error=>error.status===409&&/doğrulayın/.test(error.message),'approved but not checked');
  await google(f,h).validateSearchContent({id:item.id});view=await google(f,h).sendSearchContent({id:item.id});assert.equal(view.state,'sent');assert.ok(view.sentAt);
  const sent=h.calls.filter(call=>call.path.endsWith('/googleAds:mutate')).pop();assert.equal(sent.body.validateOnly,false);
  assert.equal((await f.db.prepare('SELECT provider_ad_group FROM platform_ad_search_content WHERE plan_id=?').get(item.id)).provider_ad_group,'customers/1234567890/adGroups/555');
  await assert.rejects(google(f,h).saveSearchContent({id:item.id,...content()}),error=>error.status===409,'sent content is changed in Google Ads');
  assert.ok((await f.db.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE operation LIKE 'ads.search_content.%'").get()).n>=6);
  assert.equal((await google(f,h,f.other).searchContent({id:item.id}).catch(error=>error.status)),404,'other projects see nothing');
}));

// A Meta plan that has run for six days with the given figures.
async function metaPlan(f,g,figures){
  const ads=new ProjectAds(f.db,f.scope,KEY,g);await ads.connect({adAccountId:'123456',accessToken:TOKEN});await ads.setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  let item=(await ads.savePlan({name:'Spring traffic',objective:'OUTCOME_TRAFFIC',dailyBudgetMinor:figures.daily||2000,startDate:day(1),endDate:day(10),countries:['TR'],linkUrl:'https://example.com/spring'})).plans[0];
  item=(await ads.approve({id:item.id,expectedRevision:item.revision})).plans[0];
  const row=await f.db.prepare('SELECT * FROM platform_ad_plans WHERE id=?').get(item.id),{digestOf}=load('ad-manager.ts'),moved={...row,start_date:day(-5)},digest=digestOf(moved);
  await f.db.prepare("UPDATE platform_ad_plans SET state='active',start_date=?,digest=?,approved_digest=?,provider_campaign_id='120000000001',provider_adset_id='120000000002',spend_minor=?,impressions=?,clicks=?,spend_checked_at=? WHERE id=?").run(day(-5),digest,digest,figures.spend,figures.impressions,figures.clicks,new Date().toISOString(),item.id);
  return item.id;
}
const graph=(fail=false)=>{const calls=[];const fn=async(method,path,token,params={})=>{calls.push({method,path,token,params});if(path==='act_123456')return {id:'act_123456',name:'QA ads',currency:'USD',account_status:1};if(fail&&method==='POST'&&path==='120000000002')throw new Error('rejected');return {success:true};};fn.calls=calls;return fn;};

test('budget suggestion: from the plan’s own figures, inside the caps; applying needs an approver, the switch and a provider check first',run(async f=>{
  const g=graph(),meta=scope=>new AdOptimizer(f.db,scope||f.scope,KEY,g);
  const id=await metaPlan(f,g,{spend:11500,impressions:5000,clicks:80});
  let hint=await meta().budgetSuggestion({id});assert.equal(hint.change,'increase');assert.equal(hint.currentMinor,2000);assert.equal(hint.suggestedMinor,2400);assert.equal(hint.applyEnabled,false);
  await f.db.prepare('UPDATE platform_ad_plans SET clicks=10 WHERE id=?').run(id);hint=await meta().budgetSuggestion({id});assert.equal(hint.change,'decrease');assert.equal(hint.suggestedMinor,1600);assert.match(hint.reasons[0],/Tıklanma oranı düşük/);
  await f.db.prepare('UPDATE platform_ad_plans SET clicks=80,spend_minor=3000 WHERE id=?').run(id);hint=await meta().budgetSuggestion({id});assert.equal(hint.change,'keep');assert.match(hint.reasons[0],/yarısından azı/);
  await f.db.prepare('UPDATE platform_ad_plans SET spend_minor=11500 WHERE id=?').run(id);
  // Applying is off by default.
  await assert.rejects(meta().applyBudget({id,dailyBudgetMinor:2400,acknowledged:true}),error=>error.status===409&&/kapalı/.test(error.message));
  process.env.PLATFORM_ADS_BUDGET_APPLY_ENABLED='1';
  const editor=await f.member('editor');await assert.rejects(meta(editor).applyBudget({id,dailyBudgetMinor:2400,acknowledged:true}),error=>error.status===403);
  await assert.rejects(meta().applyBudget({id,dailyBudgetMinor:2400}),/kutuyu/);
  await assert.rejects(meta().applyBudget({id,dailyBudgetMinor:5100,acknowledged:true}),error=>error.status===409,'over the daily cap');
  await assert.rejects(meta().applyBudget({id,dailyBudgetMinor:3100,acknowledged:true}),error=>error.status===409&&/%50/.test(error.message),'at most +50% at once');
  assert.equal(g.calls.filter(call=>call.method==='POST').length,0,'nothing reached Meta');
  // A provider that refuses the check: nothing is changed.
  const refusing=graph(true);await assert.rejects(new AdOptimizer(f.db,f.scope,KEY,refusing).applyBudget({id,dailyBudgetMinor:2400,acknowledged:true}),error=>error.status===502);
  assert.equal(refusing.calls.filter(call=>call.method==='POST').length,1,'only the validate-only request');assert.equal((await f.db.prepare('SELECT daily_budget_minor FROM platform_ad_plans WHERE id=?').get(id)).daily_budget_minor,2000);
  hint=await meta().applyBudget({id,dailyBudgetMinor:2400,acknowledged:true});assert.equal(hint.currentMinor,2400);
  const posts=g.calls.filter(call=>call.method==='POST');assert.equal(posts.length,2);
  assert.deepEqual(plain(posts[0].params),{daily_budget:'2400',execution_options:'["validate_only"]'});assert.deepEqual(plain(posts[1].params),{daily_budget:'2400'});assert.equal(posts[1].path,'120000000002');
  const plan=(await new ProjectAds(f.db,f.scope,KEY,g).read()).plans.find(item=>item.id===id);assert.equal(plan.dailyBudgetMinor,2400);assert.equal(plan.approved,true,'the new budget carries the approver’s approval');
  hint=await meta().budgetSuggestion({id});assert.ok(hint.suggestedMinor<=5000);
  await f.db.prepare('UPDATE platform_ad_plans SET daily_budget_minor=4500,spend_minor=26000 WHERE id=?').run(id);hint=await meta().budgetSuggestion({id});assert.equal(hint.suggestedMinor,5000,'never above the project cap');assert.match(hint.reasons.join(' '),/tavanına/);
}));

test('budget on Google: the campaign budget is checked with validateOnly, then changed in micros',run(async f=>{
  const h=http(),item=await googlePlan(f,h);process.env.PLATFORM_ADS_BUDGET_APPLY_ENABLED='1';
  await f.db.prepare("UPDATE platform_ad_plans SET state='active' WHERE id=?").run(item.id);
  const refusing=http({budgetReject:true});await assert.rejects(google(f,refusing).applyBudget({id:item.id,dailyBudgetMinor:3000,acknowledged:true}),error=>error.status===502);
  await google(f,h).applyBudget({id:item.id,dailyBudgetMinor:3000,acknowledged:true});
  const budget=h.calls.filter(call=>call.path.endsWith('/campaignBudgets:mutate')).slice(-2).map(call=>plain(call.body));
  assert.deepEqual(budget.map(body=>body.validateOnly),[true,false]);assert.deepEqual(budget[1].operations[0],{update:{resourceName:'customers/1234567890/campaignBudgets/777',amountMicros:'30000000'},updateMask:'amount_micros'});
}));
