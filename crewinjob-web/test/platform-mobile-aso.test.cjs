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
async function mobile(){const f=await fixture(),service=new MobileGrowth(f.db,f.scope,f.KEY),app=await service.saveApp({name:'QA Ink',platform:'both',appleId:'123456789',bundleId:'com.example.qa',packageName:'com.example.qa',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'qaink',attributionProvider:'bridge',revenueProvider:'bridge',identityConfirmed:true});
  let members=0;const member=async role=>({...f.scope,subject:(await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:`aso-${role}-${++members}`,password:'fixture-password-123',role})).userId});
  return {...f,service,app,aso:new MobileAso(service),as:scope=>new MobileAso(new MobileGrowth(f.db,scope,f.KEY)),member};}
const withMobile=fn=>async()=>{const f=await mobile(),saved=process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED;try{delete process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED;await fn(f);}finally{if(saved===undefined)delete process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED;else process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED=saved;f.db.close();}};
const result=id=>({wrapperType:'software',kind:'software',trackId:id,trackName:`App ${id}`});
const itunes=()=>transport(call=>{if(call.url.hostname!=='itunes.apple.com')return;const term=call.url.searchParams.get('term');
  if(term==='dövme')return {resultCount:6,results:[1,2,3,4,123456789,5].map(result)};if(term==='tattoo')return {resultCount:2,results:[7,8].map(result)};return new Response('busy',{status:503});});

test('keywords: normalised, unique per country, limited, scoped and checked once a day',withMobile(async f=>{
  let list=await f.aso.addKeyword({appId:f.app.id,term:'  Dövme   Fikirleri '});assert.equal(list[0].term,'dövme fikirleri');assert.equal(list[0].country,'TR');
  await assert.rejects(async ()=>await f.aso.addKeyword({appId:f.app.id,term:'DÖVME fikirleri'}),e=>e.status===409,'the same term in the same country');
  await f.aso.addKeyword({appId:f.app.id,term:'dövme fikirleri',country:'de'});
  await assert.rejects(async ()=>await f.aso.addKeyword({appId:f.app.id,term:'x'.repeat(101)}),/1–100/);await assert.rejects(async ()=>await f.aso.addKeyword({appId:f.app.id,term:'a',country:'TUR'}),/ülke/);
  const viewer=await f.member('viewer');await assert.rejects(async ()=>await f.as(viewer).addKeyword({appId:f.app.id,term:'kına'}),e=>e.status===403);
  await assert.rejects(async ()=>await f.as(f.other).keywords(f.app.id),e=>e.status===404,'other projects see nothing');
  await f.as(await f.member('editor')).addKeyword({appId:f.app.id,term:'dövme'});await f.aso.addKeyword({appId:f.app.id,term:'tattoo'});await f.aso.addKeyword({appId:f.app.id,term:'hata'});
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
  const after=(await f.aso.keywords(f.app.id)).find(item=>item.term==='dövme');assert.equal(after.rank,2);assert.equal(after.previousRank,5);assert.deepEqual(plain(after.history.map(item=>item.rank)),[5,2]);
  list=await f.aso.removeKeyword(f.app.id,after.id);assert.equal(list.some(item=>item.term==='dövme'),false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_mobile_keyword_ranks WHERE keyword_id=?').get(after.id).n,0);
  for(let i=list.length;i<30;i++)await f.aso.addKeyword({appId:f.app.id,term:`terim ${i}`});await assert.rejects(async ()=>await f.aso.addKeyword({appId:f.app.id,term:'one more'}),e=>e.status===429);
}));

const SKAN_CSV=`Date,Media Source (pid),Campaign (c),Country,Installs,Clicks,Total Revenue,Total Cost,Converted Users,af_purchase (Unique users)
${day(-10)},Apple Search Ads,"Ink, autumn",TR,12,300,45.5,30,4,2
${day(-10)},Apple Search Ads,"Ink, autumn",TR,3,20,N/A,6,1,0
${day(-9)},tiktokglobal_int,Ink video,DE,8,,12,N/A,,1
not-a-day,x,y,TR,1,1,1,1,1,1
`;
test('SKAN: the AppsFlyer report is read by column name, merged, replaced on a second pull and summed per source',withMobile(async f=>{
  await assert.rejects(async ()=>await f.service.saveIntegration({appId:f.app.id,provider:'appsflyer_skan',config:{externalAppId:'com.example.qa'},credentials:{apiToken:AF_TOKEN}}),/Sağlayıcı ayarlarını/,'the iOS app id starts with id');
  await assert.rejects(f.aso.syncSkan({appId:f.app.id}),e=>e.status===409,'no connection yet');
  await f.service.saveIntegration({appId:f.app.id,provider:'appsflyer_skan',config:{externalAppId:'id123456789',currency:'EUR'},credentials:{apiToken:AF_TOKEN}});
  assert.equal(JSON.stringify(await f.service.integrations(f.app.id)).includes(AF_TOKEN),false);
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
  await assert.rejects(async ()=>await f.as(f.other).skan(f.app.id),e=>e.status===404);
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
const asc=({versions,publicKey,fail}={})=>transport(async call=>{
  if(call.url.hostname!=='api.appstoreconnect.apple.com')return;const auth=String(call.headers.Authorization||'');
  if(publicKey){const [h,c,s]=auth.slice(7).split('.');if(!await crypto.verify('sha256',Buffer.from(`${h}.${c}`),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')))return new Response('bad',{status:401});}
  const path=call.url.pathname;if(call.method==='PATCH'){if(fail&&path.includes(fail))return new Response('no',{status:409});return {data:JSON.parse(call.body).data};}
  if(path==='/v1/apps/123456789')return {data:{id:'123456789',attributes:{bundleId:'com.example.qa'}}};
  if(path==='/v1/apps/123456789/appStoreVersions')return {data:versions||[{id:'v-live',attributes:{appStoreState:'READY_FOR_SALE',versionString:'1.0'}},{id:'v-next',attributes:{appVersionState:'PREPARE_FOR_SUBMISSION',versionString:'1.1'}}]};
  if(path==='/v1/apps/123456789/appInfos')return {data:[{id:'info-live',attributes:{state:'READY_FOR_DISTRIBUTION'}},...(versions?[]:[{id:'info-next',attributes:{state:'PREPARE_FOR_SUBMISSION'}}])]};
  if(path.endsWith('/appStoreVersionLocalizations'))return {data:[{id:`loc-${path.split('/')[3]}`,attributes:{locale:'tr',description:'Eski açıklama',keywords:'dövme',promotionalText:'Eski tanıtım',whatsNew:''}}]};
  if(path.endsWith('/appInfoLocalizations'))return {data:[{id:'info-tr',attributes:{locale:'tr',name:'QA Ink',subtitle:'Eski alt başlık'}}]};
});
test('App Store listing: drafted by the team, approved on the exact text, written to the editable version behind the switch',withMobile(async f=>{
  const key=ascKey(),privateKey=key.privateKey.export({type:'pkcs8',format:'pem'});
  await assert.rejects(async ()=>await f.service.saveIntegration({appId:f.app.id,provider:'app_store_connect',config:{issuerId:'not-a-uuid',keyId:'ABCDE12345'},credentials:{privateKey}}),/Sağlayıcı ayarlarını/);
  await f.service.saveIntegration({appId:f.app.id,provider:'app_store_connect',config:{issuerId:ISSUER,keyId:'ABCDE12345'},credentials:{privateKey}});
  assert.equal(JSON.stringify(await f.service.integrations(f.app.id)).includes(PEM_LABEL),false);
  const read=asc({publicKey:key.publicKey}),current=await f.aso.currentListing({appId:f.app.id,store:'ios',locale:'tr-TR'},read);
  assert.equal(current.locale,'tr','tr-TR falls back to the store’s tr');assert.equal(current.fields.subtitle,'Eski alt başlık');assert.equal(current.fields.promotionalText,'Eski tanıtım');assert.equal(current.editable,true);
  const [h,c]=String(read.calls[0].headers.Authorization).slice(7).split('.');assert.deepEqual(plain(JSON.parse(Buffer.from(h,'base64url'))),{alg:'ES256',kid:'ABCDE12345',typ:'JWT'});
  const claims=JSON.parse(Buffer.from(c,'base64url'));assert.equal(claims.aud,'appstoreconnect-v1');assert.equal(claims.iss,ISSUER);assert.ok(claims.exp-claims.iat<=1200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_mobile_listing_drafts').get().n,0,'loading the store text saves nothing');
  const editor=f.as(await f.member('editor'));let list=await editor.saveListing({appId:f.app.id,store:'ios',locale:'tr',fields:{subtitle:'Dövme fikirleri ve randevu',keywords:'dövme,tasarım,stüdyo',description:''}});
  let item=list[0];assert.equal(item.state,'draft');assert.deepEqual(plain(Object.keys(item.fields)),['subtitle','keywords'],'empty fields are not written');
  await assert.rejects(async ()=>await editor.approveListing({appId:f.app.id,id:item.id,expectedRevision:item.revision}),e=>e.status===403,'editors write, approvers approve');
  item=(await f.aso.approveListing({appId:f.app.id,id:item.id,expectedRevision:item.revision}))[0];assert.equal(item.approved,true);
  await assert.rejects(f.aso.publishListing({appId:f.app.id,id:item.id,acknowledged:true},read),e=>e.status===409&&/PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED/.test(e.message),'the server switch is off');
  process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED='1';
  await assert.rejects(f.aso.publishListing({appId:f.app.id,id:item.id},read),/açık onay/);
  await assert.rejects(f.as(await f.member('editor')).publishListing({appId:f.app.id,id:item.id,acknowledged:true},read),e=>e.status===403);
  // An edit after approval needs a new approval.
  item=(await f.aso.saveListing({appId:f.app.id,store:'ios',locale:'tr',id:item.id,expectedRevision:item.revision,fields:{subtitle:'Dövme fikirleri, randevu',keywords:'dövme,tasarım,stüdyo'}}))[0];assert.equal(item.state,'draft');
  await assert.rejects(f.aso.publishListing({appId:f.app.id,id:item.id,acknowledged:true},read),/onaylı/);
  item=(await f.aso.approveListing({appId:f.app.id,id:item.id,expectedRevision:item.revision}))[0];
  const before=read.calls.length;item=(await f.aso.publishListing({appId:f.app.id,id:item.id,acknowledged:true},read))[0];assert.equal(item.state,'published');assert.ok(item.publishedAt);
  const patches=read.calls.slice(before).filter(call=>call.method==='PATCH').map(call=>[call.url.pathname,JSON.parse(call.body).data]);
  assert.deepEqual(plain(patches),[['/v1/appInfoLocalizations/info-tr',{type:'appInfoLocalizations',id:'info-tr',attributes:{subtitle:'Dövme fikirleri, randevu'}}],['/v1/appStoreVersionLocalizations/loc-v-next',{type:'appStoreVersionLocalizations',id:'loc-v-next',attributes:{keywords:'dövme,tasarım,stüdyo'}}]]);
  assert.equal(read.calls.some(call=>/appStoreVersionSubmissions|reviewSubmissions/.test(call.url.pathname)),false,'nothing is submitted for review');
  await assert.rejects(f.aso.publishListing({appId:f.app.id,id:item.id,acknowledged:true},read),/onaylı/,'written once');
  // Only a live version: promotional text alone is written there; other fields need a new version.
  const live=asc({versions:[{id:'v-live',attributes:{appStoreState:'READY_FOR_SALE'}}]});
  let promo=(await f.aso.saveListing({appId:f.app.id,store:'ios',locale:'tr',fields:{promotionalText:'Kasım kampanyası'}}))[0];promo=(await f.aso.approveListing({appId:f.app.id,id:promo.id,expectedRevision:promo.revision})).find(row=>row.id===promo.id);
  promo=(await f.aso.publishListing({appId:f.app.id,id:promo.id,acknowledged:true},live)).find(row=>row.id===promo.id);assert.equal(promo.state,'published');assert.equal(live.calls.find(call=>call.method==='PATCH').url.pathname,'/v1/appStoreVersionLocalizations/loc-v-live');
  let text=(await f.aso.saveListing({appId:f.app.id,store:'ios',locale:'tr',fields:{description:'Yeni açıklama'}}))[0];text=(await f.aso.approveListing({appId:f.app.id,id:text.id,expectedRevision:text.revision})).find(row=>row.id===text.id);
  text=(await f.aso.publishListing({appId:f.app.id,id:text.id,acknowledged:true},live)).find(row=>row.id===text.id);assert.equal(text.state,'failed');assert.match(text.lastError,/düzenlenebilir bir sürüm yok/);
  assert.equal(live.calls.filter(call=>call.method==='PATCH').length,1,'nothing was written for the failed draft');
  await assert.rejects(async ()=>await f.aso.saveListing({appId:f.app.id,store:'ios',id:promo.id,expectedRevision:promo.revision,fields:{promotionalText:'x'}}),/düzenlenemez/,'a written draft stays as history');
  assert.equal((await f.aso.deleteListing(f.app.id,text.id)).some(row=>row.id===text.id),false);
}));

test('Google Play listing: read in a throwaway edit, written in a committed edit; a failed write commits nothing',withMobile(async f=>{
  await f.service.saveIntegration({appId:f.app.id,provider:'google_play',config:{},credentials:{serviceAccount:{type:'service_account',project_id:'qa-project',client_email:'qa@qa-project.iam.gserviceaccount.com',private_key:`-----BEGIN ${PEM_LABEL}-----\n${crypto.randomBytes(24).toString('base64')}\n-----END ${PEM_LABEL}-----\n`}}});
  const token=async()=>PLAY_TOKEN,play=(failPatch=false)=>transport(call=>{
    if(call.url.hostname!=='androidpublisher.googleapis.com')return;const path=call.url.pathname.replace('/androidpublisher/v3/applications/com.example.qa/edits','');
    if(call.method==='POST'&&path==='')return {id:'edit-1'};if(call.method==='DELETE')return new Response(null,{status:204});
    if(call.method==='GET'&&path==='/edit-1/listings/tr-TR')return {language:'tr-TR',title:'QA Ink',shortDescription:'Dövme fikirleri',fullDescription:'Uzun açıklama'};
    if(call.method==='PATCH')return failPatch?new Response('bad',{status:400}):{language:'tr-TR',...JSON.parse(call.body)};if(call.method==='POST'&&path==='/edit-1:commit')return {id:'edit-1'};});
  let read=play();const current=await f.aso.currentListing({appId:f.app.id,store:'android'},read,token);
  assert.deepEqual(plain(current.fields),{title:'QA Ink',shortDescription:'Dövme fikirleri',fullDescription:'Uzun açıklama'});
  assert.deepEqual(plain(read.calls.map(call=>call.method)),['POST','GET','DELETE'],'the read edit is deleted, never committed');assert.equal(read.calls[1].headers.Authorization,`Bearer ${PLAY_TOKEN}`);
  let item=(await f.aso.saveListing({appId:f.app.id,store:'android',fields:{shortDescription:'Dövme fikirleri, randevu ve stüdyolar'}}))[0];item=(await f.aso.approveListing({appId:f.app.id,id:item.id,expectedRevision:item.revision}))[0];
  process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED='1';read=play();
  item=(await f.aso.publishListing({appId:f.app.id,id:item.id,acknowledged:true},read,token))[0];assert.equal(item.state,'published');
  assert.deepEqual(plain(read.calls.map(call=>`${call.method} ${call.url.pathname.split('/edits')[1]||''}`)),['POST ','PATCH /edit-1/listings/tr-TR','POST /edit-1:commit']);
  assert.deepEqual(plain(JSON.parse(read.calls[1].body)),{language:'tr-TR',shortDescription:'Dövme fikirleri, randevu ve stüdyolar'});
  let failed=(await f.aso.saveListing({appId:f.app.id,store:'android',fields:{title:'QA Ink: Dövme'}}))[0];failed=(await f.aso.approveListing({appId:f.app.id,id:failed.id,expectedRevision:failed.revision})).find(row=>row.id===failed.id);read=play(true);
  failed=(await f.aso.publishListing({appId:f.app.id,id:failed.id,acknowledged:true},read,token)).find(row=>row.id===failed.id);assert.equal(failed.state,'failed');
  assert.deepEqual(plain(read.calls.map(call=>call.method)),['POST','PATCH','DELETE'],'the edit is deleted, nothing committed');
  await assert.rejects(async ()=>await f.aso.saveListing({appId:f.app.id,store:'android',locale:'tr_TR',fields:{title:'x'}}),/Dil kodu/);
}));

test('AI listing proposals use the tracked positions, keep the limits and rules, and are never saved',withMobile(async f=>{
  await f.aso.addKeyword({appId:f.app.id,term:'dövme'});
  await f.aso.checkRanks(f.app.id,transport(()=>({results:[{wrapperType:'software',trackId:555,trackName:'InkRival Pro'},{wrapperType:'software',trackId:123456789,trackName:'QA Ink'}]})));
  let prompt='';const ai=value=>async text=>{prompt=text;return JSON.stringify(value);};
  await assert.rejects(f.aso.suggestListing({appId:f.app.id,store:'ios'}),e=>e.status===503);
  const value=await f.aso.suggestListing({appId:f.app.id,store:'ios',locale:'tr-TR',current:{name:'QA Ink'}},ai({name:'QA Ink: Dövme Fikirleri ve Randevu Takvimi',subtitle:'Stüdyo bul, randevu al',keywords:'dövme,tasarım,stüdyo,randevu,kına',description:'Dövme fikirlerini keşfedin.'}));
  assert.ok([...value.fields.name].length<=30,'clipped to the store limit');assert.equal(value.fields.keywords,'tasarım,kına','words already in the name or subtitle are dropped');
  assert.match(prompt,/"term":"dövme","country":"TR","position":2/);assert.match(prompt,/InkRival Pro/);assert.match(prompt,/never name them/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_mobile_listing_drafts').get().n,0,'nothing saved');
  await assert.rejects(f.aso.suggestListing({appId:f.app.id,store:'ios'},ai({subtitle:'InkRival Pro’dan daha iyi'})),e=>e.status===422,'no competitor names');
  await assert.rejects(f.aso.suggestListing({appId:f.app.id,store:'ios'},ai({description:'Bilgi: https://example.com'})),e=>e.status===422,'no links');
  await assert.rejects(f.aso.suggestListing({appId:f.app.id,store:'ios'},ai('not json')),e=>e.status===422);
  const android=await f.aso.suggestListing({appId:f.app.id,store:'android'},ai({title:'QA Ink',shortDescription:'Dövme fikirleri ve stüdyolar',fullDescription:'Açıklama',name:'ignored'}));
  assert.deepEqual(plain(Object.keys(android.fields)),['title','shortDescription','fullDescription']);
}));

test('competitor apps: looked up once, read from the same searches, limited to five',withMobile(async f=>{
  await f.aso.addKeyword({appId:f.app.id,term:'dövme'});await f.aso.addKeyword({appId:f.app.id,term:'tattoo'});
  const lookup=transport(call=>call.url.pathname==='/lookup'?{results:call.url.searchParams.get('id')==='5550001'?[{trackId:5550001,trackName:'InkRival Pro'}]:[]}:undefined);
  await assert.rejects(f.aso.addCompetitor({appId:f.app.id,appleId:'123456789'},lookup),/Kendi uygulamanız/);
  await assert.rejects(f.aso.addCompetitor({appId:f.app.id,appleId:'abc'},lookup),/yalnız rakam/);
  await assert.rejects(f.aso.addCompetitor({appId:f.app.id,appleId:'99999'},lookup),e=>e.status===404);
  let value=await f.aso.addCompetitor({appId:f.app.id,appleId:'5550001'},lookup);assert.deepEqual(plain(value.competitors.map(({id,name})=>({id,name}))),[{id:'5550001',name:'InkRival Pro'}]);
  await assert.rejects(f.aso.addCompetitor({appId:f.app.id,appleId:'5550001'},lookup),e=>e.status===409);
  const search=transport(call=>call.url.searchParams.get('term')==='dövme'?{results:[{wrapperType:'software',trackId:5550001,trackName:'InkRival Pro'},{wrapperType:'software',trackId:123456789,trackName:'QA Ink'}]}:{results:[{wrapperType:'software',trackId:7,trackName:'Other'}]});
  const checked=await f.aso.checkRanks(f.app.id,search);assert.equal(search.calls.length,2,'no extra request for competitors');
  const by=term=>checked.keywords.find(item=>item.term===term);
  assert.deepEqual(plain(by('dövme').competitors),[{id:'5550001',name:'InkRival Pro',rank:1}]);assert.deepEqual(plain(by('tattoo').competitors),[{id:'5550001',name:'InkRival Pro',rank:null}]);
  for(const id of ['11111','22222','33333','44444']){f.db.prepare('INSERT INTO platform_mobile_competitors VALUES(?,?,?,?,?,?,?)').run(f.scope.organizationId,f.scope.projectId,f.app.id,id,`Rival ${id}`,f.scope.subject,new Date().toISOString());}
  await assert.rejects(f.aso.addCompetitor({appId:f.app.id,appleId:'66666'},lookup),e=>e.status===429);
  value=await f.aso.removeCompetitor(f.app.id,'5550001');assert.equal(value.competitors.some(item=>item.id==='5550001'),false);assert.equal(value.keywords[0].competitors.length,0,'a removed competitor disappears from the table');
  await assert.rejects(async ()=>await f.as(f.other).competitors(f.app.id),e=>e.status===404);
}));

test('competitor watch: daily public details, changes of version, name and rating, and a team alert',withMobile(async f=>{
  const {refreshDueCompetitors}=load('mobile-aso.ts'),{teamAlerts}=load('team-alerts.ts');
  f.db.prepare('INSERT INTO platform_mobile_competitors VALUES(?,?,?,?,?,?,?)').run(f.scope.organizationId,f.scope.projectId,f.app.id,'5550001','InkRival',f.scope.subject,new Date().toISOString());
  let details={trackId:5550001,trackName:'InkRival',averageUserRating:4.51,userRatingCount:1200,version:'2.0',currentVersionReleaseDate:'2026-10-01T00:00:00Z',releaseNotes:'Hata düzeltmeleri'};
  const lookup=()=>transport(call=>call.url.pathname==='/lookup'?{results:[details]}:undefined);
  let read=lookup();assert.equal(await refreshDueCompetitors(f.db,read),1);assert.equal(read.calls[0].url.searchParams.get('country'),'tr');
  assert.equal(await refreshDueCompetitors(f.db,lookup()),0,'once a day');
  // Yesterday's snapshot, then today’s with a new version, a new name and a lower rating.
  f.db.prepare("UPDATE platform_mobile_competitor_snapshots SET checked_on=?").run(day(-1));
  details={...details,trackName:'InkRival: Dövme',averageUserRating:4.3,version:'2.1',releaseNotes:'Yeni randevu ekranı'};
  assert.equal(await refreshDueCompetitors(f.db,lookup()),1);
  const [rival]=plain(await f.aso.competitors(f.app.id));assert.equal(rival.name,'InkRival: Dövme');assert.deepEqual(rival.latest,{checkedOn:day(0),rating:4.3,ratingCount:1200,version:'2.1',releasedAt:'2026-10-01T00:00:00Z'});
  assert.deepEqual(rival.changes.map(change=>change.kind).sort(),['name','rating','version']);assert.equal(rival.changes.find(change=>change.kind==='version').notes,'Yeni randevu ekranı');
  const alert=plain(await teamAlerts(f.db,f.scope)).find(item=>item.kind==='competitor_change');assert.equal(alert.count,3);assert.deepEqual(alert.plans,['InkRival: Dövme']);
  // A failed read marks the day without inventing a change.
  f.db.prepare("UPDATE platform_mobile_competitor_snapshots SET checked_on=? WHERE checked_on=?").run(day(-2),day(-1));f.db.prepare("UPDATE platform_mobile_competitor_snapshots SET checked_on=? WHERE checked_on=?").run(day(-1),day(0));
  assert.equal(await refreshDueCompetitors(f.db,transport(()=>new Response('down',{status:503}))),0);
  assert.equal(plain(await f.aso.competitors(f.app.id))[0].changes.filter(change=>change.day===day(0)).length,0);
}));
