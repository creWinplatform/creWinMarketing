const assert=require('node:assert/strict'),{test}=require('node:test'),{randomBytes}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{projectFeatures,requireAdTools}=load('entitlements.ts');
const {PLAN_CATALOG,AGENCY_PACKAGE,PLAN_CATALOG_VERSION}=load('plan-catalog.ts'),{saveAdAutoPause}=load('ad-auto-pause.ts'),{saveWebWatch,webWatch}=load('web-mentions.ts');
const DAY=86400000,iso=value=>new Date(value).toISOString(),plain=value=>JSON.parse(JSON.stringify(value));
// One project per state: trial, paid Launch, paid Growth, agency package, ended trial, pilot. No payment provider.
async function fixture(){
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);await repo.bootstrapLegacy('admin');
  const make=async(name,mode='trial',start=Date.now())=>{const w=await repo.provision('legacy-admin',{organizationName:name,projectName:name,website:`https://${name}.example`,username:name,password:'fixture-password-123'});
    db.prepare("UPDATE platform_project_entitlements SET mode=?,trial_owner_id=?,started_at=?,ends_at=? WHERE organization_id=? AND project_id=?").run(mode,mode==='pilot'?null:w.userId,iso(start),mode==='pilot'?null:iso(start+14*DAY),w.organizationId,w.projectId);
    return {...w,scope:{subject:w.userId,organizationId:w.organizationId,projectId:w.projectId}};};
  const pay=(w,plan,pack=null)=>{const id='RZLIVE'+randomBytes(16).toString('hex'),start=Date.now()-DAY,end=Date.now()+29*DAY;
    db.prepare("INSERT INTO platform_billing_live_orders(id,organization_id,project_id,actor_id,idempotency_key,request_digest,merchant_revision,catalog_version,plan_id,cadence,amount_minor,state,terms_url,created_at,expires_at,updated_at,package) VALUES(?,?,?,?,?,'d','m','v',?,'monthly',100,'paid','https://ryzevo.example/terms',?,?,?,?)").run(id,w.organizationId,w.projectId,w.userId,id,plan,iso(start),iso(start),iso(start),pack);
    db.prepare("INSERT INTO platform_project_subscriptions(order_id,organization_id,project_id,plan_id,cadence,starts_at,ends_at,grace_ends_at,created_at,package) VALUES(?,?,?,?,'monthly',?,?,?,?,?)").run(id,w.organizationId,w.projectId,plan,iso(start),iso(end),iso(end+7*DAY),iso(start),pack);};
  const trial=await make('trial'),launch=await make('launch'),growth=await make('growth'),agency=await make('agency'),ended=await make('ended','trial',Date.now()-20*DAY),pilot=await make('pilot','pilot');
  pay(launch,'launch');pay(growth,'growth');pay(agency,'growth','agency');
  return {db,trial,launch,growth,agency,ended,pilot};
}

test('the 2026-11 catalog: prices, and the new features per plan',()=>{
  assert.equal(PLAN_CATALOG_VERSION,'2026-11-v1');
  assert.deepEqual(plain(PLAN_CATALOG.map(plan=>[plan.id,plan.monthlyUsdMinor,plan.mapsSearches,plan.webQueries,plan.webFeeds,plan.adTools])),[['launch',3900,30,1,0,false],['growth',9900,100,3,5,true],['team',19900,300,3,5,true]]);
  assert.equal(AGENCY_PACKAGE.monthlyUsdMinor,39900);
});

test('features follow the plan: Maps searches, web mentions and the ad tools',async()=>{
  const f=await fixture(),features=async w=>plain(await projectFeatures(f.db,w.scope));
  assert.deepEqual(await features(f.trial),{plan:'trial',mapsSearches:5,mapsPerDay:2,webQueries:1,webFeeds:0,adTools:true});
  assert.deepEqual(await features(f.launch),{plan:'launch',mapsSearches:30,mapsPerDay:10,webQueries:1,webFeeds:0,adTools:false});
  assert.deepEqual(await features(f.growth),{plan:'growth',mapsSearches:100,mapsPerDay:10,webQueries:3,webFeeds:5,adTools:true});
  assert.equal((await features(f.agency)).plan,'growth','the agency package is Growth');
  assert.equal((await features(f.pilot)).plan,'pilot');assert.equal((await features(f.pilot)).mapsSearches,100);
  assert.deepEqual(await features(f.ended),{plan:'none',mapsSearches:0,mapsPerDay:0,webQueries:0,webFeeds:0,adTools:false});
  // Ad tools: refused on Launch with the way to get them; automatic pausing can always be turned off.
  await assert.rejects(requireAdTools(f.db,f.launch.scope),error=>error.status===402&&/Growth ve üstü/.test(error.message));
  await requireAdTools(f.db,f.growth.scope);
  await assert.rejects(saveAdAutoPause(f.db,f.launch.scope,{enabled:true,kinds:['overspend'],acknowledged:true}),error=>error.status===402);
  await saveAdAutoPause(f.db,f.launch.scope,{enabled:false,kinds:[]});
  // Web mentions: Launch has one search term and no feeds; Growth has three and five.
  assert.deepEqual(plain((await webWatch(f.db,f.launch.scope)).limits),{queries:1,feeds:0});
  await assert.rejects(saveWebWatch(f.db,f.launch.scope,{enabled:true,queries:['a marka','b marka'],feeds:[],language:'tr'}),error=>error.status===402&&/en çok 1 arama/.test(error.message));
  await assert.rejects(saveWebWatch(f.db,f.launch.scope,{enabled:true,queries:['marka'],feeds:['https://www.google.com/alerts/feeds/1/2'],language:'tr'}),error=>error.status===402&&/Growth ve üstü/.test(error.message));
  assert.equal((await saveWebWatch(f.db,f.launch.scope,{enabled:true,queries:['marka'],feeds:[],language:'tr'})).enabled,true);
  assert.equal((await saveWebWatch(f.db,f.growth.scope,{enabled:true,queries:['a','bb','cc'].map(item=>item+' marka'),feeds:['https://www.google.com/alerts/feeds/1/2'],language:'tr'})).queries.length,3);
  await assert.rejects(saveWebWatch(f.db,f.ended.scope,{enabled:true,queries:['marka'],feeds:[],language:'tr'}),error=>error.status===402&&/etkin bir plan/.test(error.message));
});
