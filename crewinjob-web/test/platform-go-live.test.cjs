const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {goLiveStatus}=load('go-live.ts'),{ProjectAds}=load('ad-manager.ts'),{MobileGrowth}=load('mobile-store.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const SWITCHES=['PLATFORM_SOCIAL_PUBLISH_ENABLED','PLATFORM_ADS_ENABLED','PLATFORM_AD_CREATIVES_ENABLED','PLATFORM_MOBILE_SEND_ENABLED','PLATFORM_EMAIL_PILOT_SEND_ENABLED','PLATFORM_TIKTOK_CLIENT_KEY','PLATFORM_TIKTOK_CLIENT_SECRET','PLATFORM_TIKTOK_REDIRECT_URI'];
const run=fn=>async()=>{const f=fixture(),saved=Object.fromEntries(SWITCHES.map(name=>[name,process.env[name]]));try{for(const name of SWITCHES)delete process.env[name];await fn(f);}finally{for(const [name,value] of Object.entries(saved))if(value===undefined)delete process.env[name];else process.env[name]=value;f.db.close();}};
const TOKEN=`qa-meta-${crypto.randomBytes(8).toString('hex')}`;
const graph=()=>{const calls=[];const fn=async(method,path,token,params={})=>{calls.push({method,path,token,params});if(method==='GET'&&/^act_\d+$/.test(path))return {id:path,name:'QA ads',currency:'USD',account_status:1};return {success:true};};fn.calls=calls;return fn;};

test('the go-live panel reads the project’s records and switches, for connection managers only',run(async f=>{
  let view=plain(goLiveStatus(f.db,f.scope));const by=id=>view.items.find(item=>item.id===id);
  assert.equal(by('msg:email').state,'ready','the fixture’s sender is connected');assert.equal(by('switch:PLATFORM_EMAIL_PILOT_SEND_ENABLED').state,'off');
  assert.equal(by('social:tiktok').state,'optional');assert.match(by('social:tiktok').detail.tr,/uygulama bilgileri/,'no TikTok app on this server');
  assert.equal(by('ads:meta').state,'optional');assert.equal(by('measure:ga4').state,'action');
  process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED='1';process.env.PLATFORM_TIKTOK_CLIENT_KEY='qa';process.env.PLATFORM_TIKTOK_CLIENT_SECRET='qa';process.env.PLATFORM_TIKTOK_REDIRECT_URI='https://example.com/cb';
  view=plain(goLiveStatus(f.db,f.scope));assert.equal(by('switch:PLATFORM_EMAIL_PILOT_SEND_ENABLED').state,'ready');assert.match(by('social:tiktok').detail.tr,/Bağlı hesap yok/);
  assert.doesNotMatch(JSON.stringify(view),/https:\/\/example\.com\/cb/,'no setting value is shown');
  // An ad account: connected but without caps is to do; with caps it is ready and can be verified.
  const g=graph();await new ProjectAds(f.db,f.scope,f.KEY,g).connect({adAccountId:'123456',accessToken:TOKEN});
  view=plain(goLiveStatus(f.db,f.scope));assert.equal(by('ads:meta').state,'action');assert.deepEqual(by('ads:meta').verify,{kind:'ads',provider:'meta'});
  new ProjectAds(f.db,f.scope,f.KEY,g).setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});view=plain(goLiveStatus(f.db,f.scope));assert.equal(by('ads:meta').state,'ready');
  const checked=await new ProjectAds(f.db,f.scope,f.KEY,g).verify();assert.deepEqual(plain(checked),{ok:true,name:'QA ads',currency:'USD'});assert.equal(g.calls.at(-1).method,'GET','only a read');
  await assert.rejects(new ProjectAds(f.db,f.scope,f.KEY,async()=>{throw new Error('denied');}).verify(),e=>e.status===502&&/Meta hesabı okunamadı/.test(e.message));
  // A mobile app: its attribution source and store connections are listed; without events it is to do.
  const service=new MobileGrowth(f.db,f.scope,f.KEY);const app=service.saveApp({name:'QA Ink',platform:'ios',appleId:'123456789',bundleId:'com.example.qa',packageName:'',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'qaink',attributionProvider:'appsflyer',revenueProvider:'bridge',identityConfirmed:true});
  view=plain(goLiveStatus(f.db,f.scope));assert.equal(by(`mobile:${app.id}:appsflyer`).state,'action');assert.equal(by(`mobile:${app.id}:app_store_connect`).state,'action');assert.equal(by(`mobile:${app.id}:push`).state,'optional');
  service.saveIntegration({appId:app.id,provider:'appsflyer',config:{externalAppId:'id123456789'},credentials:{webhookSecret:crypto.randomBytes(24).toString('hex')}});
  view=plain(goLiveStatus(f.db,f.scope));assert.match(by(`mobile:${app.id}:appsflyer`).detail.tr,/henüz olay gelmedi/);assert.equal(by(`mobile:${app.id}:appsflyer`).verify,undefined,'a webhook is checked by its events');
  f.db.prepare("UPDATE platform_mobile_integrations SET last_event_at=? WHERE app_id=? AND kind='appsflyer'").run(new Date().toISOString(),app.id);view=plain(goLiveStatus(f.db,f.scope));assert.equal(by(`mobile:${app.id}:appsflyer`).state,'ready');
  const summary=view.summary.find(item=>item.group==='ads');assert.equal(summary.ready,1);assert.equal(summary.total,3,'Meta plus the two ad switches; unused providers are not counted');
  const editor={...f.scope,subject:f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'golive-editor',password:'fixture-password-123',role:'editor'}).userId};
  assert.throws(()=>goLiveStatus(f.db,editor),e=>e.status===403);assert.equal(plain(goLiveStatus(f.db,f.other)).items.some(item=>item.id===`mobile:${app.id}:appsflyer`),false,'another project sees only its own');
}));
