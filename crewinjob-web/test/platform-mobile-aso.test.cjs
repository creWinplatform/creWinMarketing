const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs'),{plain}=require('./coach-fixture.cjs');
const {MobileGrowth}=load('mobile-store.ts'),{MobileAso,refreshDueKeywordRanks,normalizeListing,listingChecks}=load('mobile-aso.ts'),{parseSkanCsv}=load('mobile-aso-providers.ts');
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
// Throwaway values made per run; none of them is a real credential.
const AF_TOKEN=`af-qa-${crypto.randomBytes(16).toString('hex')}`,PLAY_TOKEN=`play-qa-${crypto.randomBytes(8).toString('hex')}`,ISSUER=crypto.randomUUID(),PEM_LABEL=['PRIVATE','KEY'].join(' ');
// Disposable provider transport: answers by method and path, records every request. No network is used.
const transport=(answer)=>{const calls=[];const fn=async(url,init={})=>{const parsed=new URL(url),method=init.method||'GET',call={url:parsed,method,headers:init.headers||{},body:init.body?String(init.body):null};calls.push(call);
  const value=await answer(call);if(value instanceof Response)return value;if(value===undefined)return new Response('not found',{status:404});
  return typeof value==='string'?new Response(value,{status:200,headers:{'content-type':'text/plain'}}):new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});};fn.calls=calls;return fn;};
function mobile(){const f=fixture(),service=new MobileGrowth(f.db,f.scope,f.KEY),app=service.saveApp({name:'QA Ink',platform:'both',appleId:'123456789',bundleId:'com.example.qa',packageName:'com.example.qa',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'qaink',attributionProvider:'bridge',revenueProvider:'bridge',identityConfirmed:true});
  let members=0;const member=role=>({...f.scope,subject:f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:`aso-${role}-${++members}`,password:'fixture-password-123',role}).userId});
  return {...f,service,app,aso:new MobileAso(service),as:scope=>new MobileAso(new MobileGrowth(f.db,scope,f.KEY)),member};}
const withMobile=fn=>async()=>{const f=mobile(),saved=process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED;try{delete process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED;await fn(f);}finally{if(saved===undefined)delete process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED;else process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED=saved;f.db.close();}};
const result=id=>({wrapperType:'software',kind:'software',trackId:id,trackName:`App ${id}`});
const itunes=()=>transport(call=>{if(call.url.hostname!=='itunes.apple.com')return;const term=call.url.searchParams.get('term');
  if(term==='dövme')return {resultCount:6,results:[1,2,3,4,123456789,5].map(result)};if(term==='tattoo')return {resultCount:2,results:[7,8].map(result)};return new Response('busy',{status:503});});

test('keywords: normalised, unique per country, limited, scoped and checked once a day',withMobile(async f=>{
  let list=f.aso.addKeyword({appId:f.app.id,term:'  Dövme   Fikirleri '});assert.equal(list[0].term,'dövme fikirleri');assert.equal(list[0].country,'TR');
  assert.throws(()=>f.aso.addKeyword({appId:f.app.id,term:'DÖVME fikirleri'}),e=>e.status===409,'the same term in the same country');
  f.aso.addKeyword({appId:f.app.id,term:'dövme fikirleri',country:'de'});
  assert.throws(()=>f.aso.addKeyword({appId:f.app.id,term:'x'.repeat(101)}),/1–100/);assert.throws(()=>f.aso.addKeyword({appId:f.app.id,term:'a',country:'TUR'}),/ülke/);
  const viewer=f.member('viewer');assert.throws(()=>f.as(viewer).addKeyword({appId:f.app.id,term:'kına'}),e=>e.status===403);
  assert.throws(()=>f.as(f.other).keywords(f.app.id),e=>e.status===404,'other projects see nothing');
  f.as(f.member('editor')).addKeyword({appId:f.app.id,term:'dövme'});f.aso.addKeyword({appId:f.app.id,term:'tattoo'});f.aso.addKeyword({appId:f.app.id,term:'hata'});
  const read=itunes(),checked=await f.aso.checkRanks(f.app.id,read);
  assert.equal(checked.checked,2);assert.equal(checked.failed,3,'the fake has no answer for the other terms');assert.equal(checked.remaining,0);
  const search=read.calls.find(call=>call.url.searchParams.get('term')==='dövme').url;assert.equal(search.pathname,'/search');assert.equal(search.searchParams.get('country'),'tr');assert.equal(search.searchParams.get('entity'),'software');assert.equal(search.searchParams.get('limit'),'200');
  const by=term=>checked.keywords.find(item=>item.term===term);
  assert.equal(by('dövme').rank,5);assert.deepEqual(plain(by('dövme').leaders.map(item=>item.id)),['1','2','3']);
  assert.equal(by('tattoo').rank,null);assert.equal(by('tattoo').resultCount,2,'not in the results: read, no position');
  assert.equal(by('hata').rank,null);assert.equal(by('hata').resultCount,null,'a failed read keeps no position');assert.equal(by('hata').checkedOn,day(0),'and is not retried today');
  assert.equal((await f.aso.checkRanks(f.app.id,read)).checked,0,'each term once a day');
  // The next day the worker moves the position; the change is shown against the day before.
  f.db.prepare("UPDATE platform_mobile_keyword_ranks SET day=? WHERE day=?").run(day(-1),day(0));f.db.prepare('UPDATE platform_mobile_keywords SET checked_on=?').run(day(-1));
  const moved=transport(call=>call.url.searchParams.get('term')==='dövme'?{results:[1,123456789].map(result)}:{results:[]});
  assert.equal(await refreshDueKeywordRanks(f.db,moved,10),5);
  const after=f.aso.keywords(f.app.id).find(item=>item.term==='dövme');assert.equal(after.rank,2);assert.equal(after.previousRank,5);assert.deepEqual(plain(after.history.map(item=>item.rank)),[5,2]);
  list=f.aso.removeKeyword(f.app.id,after.id);assert.equal(list.some(item=>item.term==='dövme'),false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_mobile_keyword_ranks WHERE keyword_id=?').get(after.id).n,0);
  for(let i=list.length;i<30;i++)f.aso.addKeyword({appId:f.app.id,term:`terim ${i}`});assert.throws(()=>f.aso.addKeyword({appId:f.app.id,term:'one more'}),e=>e.status===429);
}));

const SKAN_CSV=`Date,Media Source (pid),Campaign (c),Country,Installs,Clicks,Total Revenue,Total Cost,Converted Users,af_purchase (Unique users)
${day(-10)},Apple Search Ads,"Ink, autumn",TR,12,300,45.5,30,4,2
${day(-10)},Apple Search Ads,"Ink, autumn",TR,3,20,N/A,6,1,0
${day(-9)},tiktokglobal_int,Ink video,DE,8,,12,N/A,,1
not-a-day,x,y,TR,1,1,1,1,1,1
`;
test('SKAN: the AppsFlyer report is read by column name, merged, replaced on a second pull and summed per source',withMobile(async f=>{
  assert.throws(()=>f.service.saveIntegration({appId:f.app.id,provider:'appsflyer_skan',config:{externalAppId:'com.example.qa'},credentials:{apiToken:AF_TOKEN}}),/Sağlayıcı ayarlarını/,'the iOS app id starts with id');
  await assert.rejects(f.aso.syncSkan({appId:f.app.id}),e=>e.status===409,'no connection yet');
  f.service.saveIntegration({appId:f.app.id,provider:'appsflyer_skan',config:{externalAppId:'id123456789',currency:'EUR'},credentials:{apiToken:AF_TOKEN}});
  assert.equal(JSON.stringify(f.service.integrations(f.app.id)).includes(AF_TOKEN),false);
  const read=transport(call=>call.url.hostname==='hq1.appsflyer.com'?SKAN_CSV:undefined);
  let value=await f.aso.syncSkan({appId:f.app.id,from:day(-20),to:day(-5)},read);
  const call=read.calls[0];assert.equal(call.url.pathname,'/api/skadnetworks/v3/data/app/id123456789');assert.equal(call.url.searchParams.get('start_date'),day(-20));assert.equal(call.url.searchParams.get('end_date'),day(-5));assert.equal(call.headers.Authorization,`Bearer ${AF_TOKEN}`);
  assert.equal(value.rows,2,'duplicate keys are merged; rows without a day are dropped');
  const skan=value.skan;assert.equal(skan.installs,23);assert.equal(skan.currency,'EUR');assert.equal(skan.revenue,57.5);assert.equal(skan.cost,36);
  const apple=skan.rows.find(row=>row.mediaSource==='Apple Search Ads');assert.equal(apple.campaign,'Ink, autumn');assert.equal(apple.installs,15);assert.equal(apple.clicks,320);assert.equal(apple.revenue,45.5);assert.equal(apple.ecpi,2.4);
  const tiktok=skan.rows.find(row=>row.mediaSource==='tiktokglobal_int');assert.equal(tiktok.cost,null,'N/A stays unknown');assert.equal(tiktok.ecpi,null);assert.equal(tiktok.clicks,null);
  value=await f.aso.syncSkan({appId:f.app.id,from:day(-20),to:day(-5)},read);assert.equal(value.skan.installs,23,'a second pull replaces the range');
  await assert.rejects(f.aso.syncSkan({appId:f.app.id,from:day(-120),to:day(-5)},read),/90 gün/);await assert.rejects(f.aso.syncSkan({appId:f.app.id,from:day(-3),to:day(0)},read),/90 gün/);
  await assert.rejects(f.aso.syncSkan({appId:f.app.id},transport(()=>'Day,Something\n')),/sütunu/);
  await assert.rejects(f.aso.syncSkan({appId:f.app.id},transport(()=>new Response('denied',{status:401}))),e=>e.status===502);
  assert.equal(parseSkanCsv('﻿date,installs\n2026-01-02,5\n').rows[0].installs,5,'a BOM and lower-case headers are read');
  assert.throws(()=>f.as(f.other).skan(f.app.id),e=>e.status===404);
}));

test('listing fields: store limits, keyword clean-up and ASO checks',()=>{
  assert.throws(()=>normalizeListing('ios',{name:'x'.repeat(31)}),/en çok 30/);assert.throws(()=>normalizeListing('android',{shortDescription:'y'.repeat(81)}),/en çok 80/);
  assert.throws(()=>normalizeListing('ios',{name:'  '}),/En az bir/);assert.throws(()=>normalizeListing('ios',{name:'a\nb'}),/satır sonu/);
  const fields=normalizeListing('ios',{name:'QA Ink: Dövme',subtitle:'Dövme fikirleri',keywords:'dövme , tasarım,dövme,,  fikirleri',description:'Satır 1\nSatır 2',unknown:'x'});
  assert.deepEqual(plain(fields),{name:'QA Ink: Dövme',subtitle:'Dövme fikirleri',keywords:'dövme,tasarım,fikirleri',description:'Satır 1\nSatır 2'});
  const checks=listingChecks('ios',fields).map(item=>item.code);assert.ok(checks.includes('aso.keyword_repeats_title'));assert.ok(checks.includes('aso.keyword_space'));assert.ok(checks.includes('aso.title_short'));
  assert.equal(listingChecks('ios',fields).find(item=>item.code==='aso.keyword_repeats_title').evidence,'dövme, fikirleri');
  assert.ok(listingChecks('android',{fullDescription:'kısa'}).some(item=>item.code==='aso.description_short'));
});

// A throwaway App Store Connect API key: generated here, never leaves the test.
const ascKey=()=>crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
const asc=({versions,publicKey,fail}={})=>transport(call=>{
  if(call.url.hostname!=='api.appstoreconnect.apple.com')return;const auth=String(call.headers.Authorization||'');
  if(publicKey){const [h,c,s]=auth.slice(7).split('.');if(!crypto.verify('sha256',Buffer.from(`${h}.${c}`),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')))return new Response('bad',{status:401});}
  const path=call.url.pathname;if(call.method==='PATCH'){if(fail&&path.includes(fail))return new Response('no',{status:409});return {data:JSON.parse(call.body).data};}
  if(path==='/v1/apps/123456789')return {data:{id:'123456789',attributes:{bundleId:'com.example.qa'}}};
  if(path==='/v1/apps/123456789/appStoreVersions')return {data:versions||[{id:'v-live',attributes:{appStoreState:'READY_FOR_SALE',versionString:'1.0'}},{id:'v-next',attributes:{appVersionState:'PREPARE_FOR_SUBMISSION',versionString:'1.1'}}]};
  if(path==='/v1/apps/123456789/appInfos')return {data:[{id:'info-live',attributes:{state:'READY_FOR_DISTRIBUTION'}},...(versions?[]:[{id:'info-next',attributes:{state:'PREPARE_FOR_SUBMISSION'}}])]};
  if(path.endsWith('/appStoreVersionLocalizations'))return {data:[{id:`loc-${path.split('/')[3]}`,attributes:{locale:'tr',description:'Eski açıklama',keywords:'dövme',promotionalText:'Eski tanıtım',whatsNew:''}}]};
  if(path.endsWith('/appInfoLocalizations'))return {data:[{id:'info-tr',attributes:{locale:'tr',name:'QA Ink',subtitle:'Eski alt başlık'}}]};
});
test('App Store listing: drafted by the team, approved on the exact text, written to the editable version behind the switch',withMobile(async f=>{
  const key=ascKey(),privateKey=key.privateKey.export({type:'pkcs8',format:'pem'});
  assert.throws(()=>f.service.saveIntegration({appId:f.app.id,provider:'app_store_connect',config:{issuerId:'not-a-uuid',keyId:'ABCDE12345'},credentials:{privateKey}}),/Sağlayıcı ayarlarını/);
  f.service.saveIntegration({appId:f.app.id,provider:'app_store_connect',config:{issuerId:ISSUER,keyId:'ABCDE12345'},credentials:{privateKey}});
  assert.equal(JSON.stringify(f.service.integrations(f.app.id)).includes(PEM_LABEL),false);
  const read=asc({publicKey:key.publicKey}),current=await f.aso.currentListing({appId:f.app.id,store:'ios',locale:'tr-TR'},read);
  assert.equal(current.locale,'tr','tr-TR falls back to the store’s tr');assert.equal(current.fields.subtitle,'Eski alt başlık');assert.equal(current.fields.promotionalText,'Eski tanıtım');assert.equal(current.editable,true);
  const [h,c]=String(read.calls[0].headers.Authorization).slice(7).split('.');assert.deepEqual(plain(JSON.parse(Buffer.from(h,'base64url'))),{alg:'ES256',kid:'ABCDE12345',typ:'JWT'});
  const claims=JSON.parse(Buffer.from(c,'base64url'));assert.equal(claims.aud,'appstoreconnect-v1');assert.equal(claims.iss,ISSUER);assert.ok(claims.exp-claims.iat<=1200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_mobile_listing_drafts').get().n,0,'loading the store text saves nothing');
  const editor=f.as(f.member('editor'));let list=editor.saveListing({appId:f.app.id,store:'ios',locale:'tr',fields:{subtitle:'Dövme fikirleri ve randevu',keywords:'dövme,tasarım,stüdyo',description:''}});
  let item=list[0];assert.equal(item.state,'draft');assert.deepEqual(plain(Object.keys(item.fields)),['subtitle','keywords'],'empty fields are not written');
  assert.throws(()=>editor.approveListing({appId:f.app.id,id:item.id,expectedRevision:item.revision}),e=>e.status===403,'editors write, approvers approve');
  item=f.aso.approveListing({appId:f.app.id,id:item.id,expectedRevision:item.revision})[0];assert.equal(item.approved,true);
  await assert.rejects(f.aso.publishListing({appId:f.app.id,id:item.id,acknowledged:true},read),e=>e.status===409&&/PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED/.test(e.message),'the server switch is off');
  process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED='1';
  await assert.rejects(f.aso.publishListing({appId:f.app.id,id:item.id},read),/açık onay/);
  await assert.rejects(f.as(f.member('editor')).publishListing({appId:f.app.id,id:item.id,acknowledged:true},read),e=>e.status===403);
  // An edit after approval needs a new approval.
  item=f.aso.saveListing({appId:f.app.id,store:'ios',locale:'tr',id:item.id,expectedRevision:item.revision,fields:{subtitle:'Dövme fikirleri, randevu',keywords:'dövme,tasarım,stüdyo'}})[0];assert.equal(item.state,'draft');
  await assert.rejects(f.aso.publishListing({appId:f.app.id,id:item.id,acknowledged:true},read),/onaylı/);
  item=f.aso.approveListing({appId:f.app.id,id:item.id,expectedRevision:item.revision})[0];
  const before=read.calls.length;item=(await f.aso.publishListing({appId:f.app.id,id:item.id,acknowledged:true},read))[0];assert.equal(item.state,'published');assert.ok(item.publishedAt);
  const patches=read.calls.slice(before).filter(call=>call.method==='PATCH').map(call=>[call.url.pathname,JSON.parse(call.body).data]);
  assert.deepEqual(plain(patches),[['/v1/appInfoLocalizations/info-tr',{type:'appInfoLocalizations',id:'info-tr',attributes:{subtitle:'Dövme fikirleri, randevu'}}],['/v1/appStoreVersionLocalizations/loc-v-next',{type:'appStoreVersionLocalizations',id:'loc-v-next',attributes:{keywords:'dövme,tasarım,stüdyo'}}]]);
  assert.equal(read.calls.some(call=>/appStoreVersionSubmissions|reviewSubmissions/.test(call.url.pathname)),false,'nothing is submitted for review');
  await assert.rejects(f.aso.publishListing({appId:f.app.id,id:item.id,acknowledged:true},read),/onaylı/,'written once');
  // Only a live version: promotional text alone is written there; other fields need a new version.
  const live=asc({versions:[{id:'v-live',attributes:{appStoreState:'READY_FOR_SALE'}}]});
  let promo=f.aso.saveListing({appId:f.app.id,store:'ios',locale:'tr',fields:{promotionalText:'Kasım kampanyası'}})[0];promo=f.aso.approveListing({appId:f.app.id,id:promo.id,expectedRevision:promo.revision}).find(row=>row.id===promo.id);
  promo=(await f.aso.publishListing({appId:f.app.id,id:promo.id,acknowledged:true},live)).find(row=>row.id===promo.id);assert.equal(promo.state,'published');assert.equal(live.calls.find(call=>call.method==='PATCH').url.pathname,'/v1/appStoreVersionLocalizations/loc-v-live');
  let text=f.aso.saveListing({appId:f.app.id,store:'ios',locale:'tr',fields:{description:'Yeni açıklama'}})[0];text=f.aso.approveListing({appId:f.app.id,id:text.id,expectedRevision:text.revision}).find(row=>row.id===text.id);
  text=(await f.aso.publishListing({appId:f.app.id,id:text.id,acknowledged:true},live)).find(row=>row.id===text.id);assert.equal(text.state,'failed');assert.match(text.lastError,/düzenlenebilir bir sürüm yok/);
  assert.equal(live.calls.filter(call=>call.method==='PATCH').length,1,'nothing was written for the failed draft');
  assert.throws(()=>f.aso.saveListing({appId:f.app.id,store:'ios',id:promo.id,expectedRevision:promo.revision,fields:{promotionalText:'x'}}),/düzenlenemez/,'a written draft stays as history');
  assert.equal(f.aso.deleteListing(f.app.id,text.id).some(row=>row.id===text.id),false);
}));

test('Google Play listing: read in a throwaway edit, written in a committed edit; a failed write commits nothing',withMobile(async f=>{
  f.service.saveIntegration({appId:f.app.id,provider:'google_play',config:{},credentials:{serviceAccount:{type:'service_account',project_id:'qa-project',client_email:'qa@qa-project.iam.gserviceaccount.com',private_key:`-----BEGIN ${PEM_LABEL}-----\n${crypto.randomBytes(24).toString('base64')}\n-----END ${PEM_LABEL}-----\n`}}});
  const token=async()=>PLAY_TOKEN,play=(failPatch=false)=>transport(call=>{
    if(call.url.hostname!=='androidpublisher.googleapis.com')return;const path=call.url.pathname.replace('/androidpublisher/v3/applications/com.example.qa/edits','');
    if(call.method==='POST'&&path==='')return {id:'edit-1'};if(call.method==='DELETE')return new Response(null,{status:204});
    if(call.method==='GET'&&path==='/edit-1/listings/tr-TR')return {language:'tr-TR',title:'QA Ink',shortDescription:'Dövme fikirleri',fullDescription:'Uzun açıklama'};
    if(call.method==='PATCH')return failPatch?new Response('bad',{status:400}):{language:'tr-TR',...JSON.parse(call.body)};if(call.method==='POST'&&path==='/edit-1:commit')return {id:'edit-1'};});
  let read=play();const current=await f.aso.currentListing({appId:f.app.id,store:'android'},read,token);
  assert.deepEqual(plain(current.fields),{title:'QA Ink',shortDescription:'Dövme fikirleri',fullDescription:'Uzun açıklama'});
  assert.deepEqual(plain(read.calls.map(call=>call.method)),['POST','GET','DELETE'],'the read edit is deleted, never committed');assert.equal(read.calls[1].headers.Authorization,`Bearer ${PLAY_TOKEN}`);
  let item=f.aso.saveListing({appId:f.app.id,store:'android',fields:{shortDescription:'Dövme fikirleri, randevu ve stüdyolar'}})[0];item=f.aso.approveListing({appId:f.app.id,id:item.id,expectedRevision:item.revision})[0];
  process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED='1';read=play();
  item=(await f.aso.publishListing({appId:f.app.id,id:item.id,acknowledged:true},read,token))[0];assert.equal(item.state,'published');
  assert.deepEqual(plain(read.calls.map(call=>`${call.method} ${call.url.pathname.split('/edits')[1]||''}`)),['POST ','PATCH /edit-1/listings/tr-TR','POST /edit-1:commit']);
  assert.deepEqual(plain(JSON.parse(read.calls[1].body)),{language:'tr-TR',shortDescription:'Dövme fikirleri, randevu ve stüdyolar'});
  let failed=f.aso.saveListing({appId:f.app.id,store:'android',fields:{title:'QA Ink: Dövme'}})[0];failed=f.aso.approveListing({appId:f.app.id,id:failed.id,expectedRevision:failed.revision}).find(row=>row.id===failed.id);read=play(true);
  failed=(await f.aso.publishListing({appId:f.app.id,id:failed.id,acknowledged:true},read,token)).find(row=>row.id===failed.id);assert.equal(failed.state,'failed');
  assert.deepEqual(plain(read.calls.map(call=>call.method)),['POST','PATCH','DELETE'],'the edit is deleted, nothing committed');
  assert.throws(()=>f.aso.saveListing({appId:f.app.id,store:'android',locale:'tr_TR',fields:{title:'x'}}),/Dil kodu/);
}));
