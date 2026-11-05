const assert=require('node:assert/strict');
const {test}=require('node:test');
const crypto=require('node:crypto');
const sharp=require('sharp');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {ProjectAds}=load('ad-manager.ts'),{AdCreatives}=load('ad-creatives.ts');
const KEY='9a'.repeat(32),TOKEN=`qa-meta-${crypto.randomBytes(8).toString('hex')}`,TIKTOK=`qa-tiktok-${crypto.randomBytes(8).toString('hex')}`;
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
// Disposable Meta Graph: records calls; ids count up. No network is used.
const graph=(fail)=>{const calls=[];let next=900;const fn=async(method,path,token,params={})=>{calls.push({method,path,token,params});
  if(fail&&path.endsWith(fail))throw new Error('denied');
  if(method==='GET'&&/^act_\d+$/.test(path))return {id:path,name:'QA ads',currency:'USD',account_status:1,timezone_name:'Europe/Istanbul'};
  if(path.endsWith('/adimages'))return {images:{bytes:{hash:'a1b2c3d4e5f60718293a4b5c6d7e8f90',url:'https://example.com/i.jpg'}}};
  if(method==='POST'&&path.startsWith('act_'))return {id:String(++next)};return {success:true};};fn.calls=calls;return fn;};
const tiktokHttp=()=>{const calls=[];const fn=async request=>{const url=new URL(request.url);calls.push({...request,url});const ok=payload=>({status:200,header:()=>null,payload});
  if(url.pathname.endsWith('/advertiser/info/'))return ok({code:0,data:{list:[{name:'QA TikTok',currency:'USD',status:'STATUS_ENABLE'}]}});
  if(url.pathname.endsWith('/campaign/create/'))return ok({code:0,data:{campaign_id:'1800000000000009'}});
  if(url.pathname.endsWith('/file/image/ad/upload/'))return ok({code:0,data:{image_id:'ad-image-7788'}});
  return {status:404,header:()=>null,payload:{}};};fn.calls=calls;return fn;};
const png=async(width,height)=>(await sharp({create:{width,height,channels:3,background:{r:200,g:40,b:90}}}).png().toBuffer()).toString('base64');
const plan=(extra={})=>({name:'Ink installs',objective:'OUTCOME_TRAFFIC',dailyBudgetMinor:2000,startDate:day(1),endDate:day(10),countries:['TR'],linkUrl:'https://example.com/ink',...extra});
const env=fn=>coachRun(async f=>{const saved=process.env.PLATFORM_AD_CREATIVES_ENABLED;try{delete process.env.PLATFORM_AD_CREATIVES_ENABLED;await fn(f);}finally{if(saved===undefined)delete process.env.PLATFORM_AD_CREATIVES_ENABLED;else process.env.PLATFORM_AD_CREATIVES_ENABLED=saved;}});
async function metaPlan(f,g){const ads=()=>new ProjectAds(f.db,f.scope,KEY,g);await ads().connect({adAccountId:'123456',accessToken:TOKEN});ads().setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  let item=ads().savePlan(plan()).plans[0];item=ads().approve({id:item.id,expectedRevision:item.revision}).plans[0];return (await ads().create({id:item.id})).plans[0];}

test('Meta: an approved image and text become an image, a creative and a PAUSED ad in the plan’s ad set',env(async f=>{
  const g=graph(),item=await metaPlan(f,g),creatives=(scope=f.scope)=>new AdCreatives(f.db,scope,KEY,'meta',g);
  assert.equal(item.state,'created');
  await assert.rejects(creatives().save({planId:item.id,image:{data:await png(1080,1080),mime:'image/png'},primaryText:'Dövme fikirleri',pageId:'abc'}),/Sayfası kimliği/);
  await assert.rejects(creatives().save({planId:item.id,image:{data:await png(1000,200),mime:'image/png'},primaryText:'x',pageId:'1234567890'}),/0,5–1,91/,'a banner shape is refused');
  await assert.rejects(creatives().save({planId:item.id,image:{data:await png(1080,1080),mime:'image/jpeg'},primaryText:'x',pageId:'1234567890'}),/JPEG, PNG/,'the declared type must match');
  let list=await creatives().save({planId:item.id,image:{data:await png(1080,1920),mime:'image/png'},headline:'Yeni stüdyo',primaryText:'Dövme fikirlerini keşfet.',pageId:'1234567890'});
  let creative=list.creatives[0];assert.equal(creative.state,'draft');assert.equal(creative.cta,'LEARN_MORE');assert.equal(creative.height>creative.width,true,'9:16 is kept');assert.match(creative.thumbnail,/^data:image\/jpeg;base64,/);
  const editor={...f.scope,subject:f.member('editor').subject};
  assert.throws(()=>creatives(editor).approve({id:creative.id,expectedRevision:creative.revision}),e=>e.status===403);
  creative=creatives().approve({id:creative.id,expectedRevision:creative.revision}).creatives[0];assert.equal(creative.approved,true);
  await assert.rejects(creatives().upload({id:creative.id,acknowledged:true}),e=>e.status===409&&/PLATFORM_AD_CREATIVES_ENABLED/.test(e.message));
  process.env.PLATFORM_AD_CREATIVES_ENABLED='1';await assert.rejects(creatives().upload({id:creative.id}),/açık onay/);
  await assert.rejects(creatives(editor).upload({id:creative.id,acknowledged:true}),e=>e.status===403);
  // Editing after approval needs a new approval.
  creative=(await creatives().save({planId:item.id,id:creative.id,expectedRevision:creative.revision,headline:'Yeni stüdyo',primaryText:'Dövme fikirleri ve randevu.',pageId:'1234567890'})).creatives[0];assert.equal(creative.state,'draft');
  await assert.rejects(creatives().upload({id:creative.id,acknowledged:true}),/onaylı/);
  creative=creatives().approve({id:creative.id,expectedRevision:creative.revision}).creatives[0];
  const before=g.calls.length;creative=(await creatives().upload({id:creative.id,acknowledged:true})).creatives[0];assert.equal(creative.state,'uploaded');assert.ok(creative.adRef);
  const [image,made,ad]=g.calls.slice(before);assert.equal(image.path,'act_123456/adimages');assert.equal(Buffer.from(image.params.bytes,'base64').subarray(0,2).toString('hex'),'ffd8','a JPEG is sent');assert.equal(image.token,TOKEN);
  const story=JSON.parse(made.params.object_story_spec);assert.deepEqual(plain(story),{page_id:'1234567890',link_data:{image_hash:'a1b2c3d4e5f60718293a4b5c6d7e8f90',link:'https://example.com/ink',message:'Dövme fikirleri ve randevu.',name:'Yeni stüdyo',call_to_action:{type:'LEARN_MORE',value:{link:'https://example.com/ink'}}}});
  assert.equal(ad.path,'act_123456/ads');assert.equal(ad.params.status,'PAUSED');assert.equal(ad.params.adset_id,f.db.prepare('SELECT provider_adset_id id FROM platform_ad_plans WHERE id=?').get(item.id).id);assert.match(JSON.parse(ad.params.creative).creative_id,/^\d+$/);
  await assert.rejects(creatives().upload({id:creative.id,acknowledged:true}),/onaylı/,'sent once');assert.throws(()=>creatives().remove({id:creative.id}),/silinemez/);
  // A creative refused by Meta leaves the image uploaded and says so.
  const refusing=graph('/adcreatives'),other=new AdCreatives(f.db,f.scope,KEY,'meta',refusing);
  let second=(await other.save({planId:item.id,image:{data:await png(1200,630),mime:'image/png'},primaryText:'İkinci görsel',pageId:'1234567890'})).creatives[1];second=other.approve({id:second.id,expectedRevision:second.revision}).creatives[1];
  second=(await other.upload({id:second.id,acknowledged:true})).creatives[1];assert.equal(second.state,'failed');assert.match(second.lastError,/reklam içeriği oluşturulamadı/);
  assert.throws(()=>new AdCreatives(f.db,f.other,KEY,'meta',g).list(item.id),e=>e.status===403||e.status===404,'other projects see nothing');
  assert.throws(()=>new AdCreatives(f.db,f.scope,KEY,'google',g).list(item.id),/Meta ve TikTok/);
}));
test('TikTok: an approved image goes to the ad account’s library as a signed file upload; app plans only offer install',env(async f=>{
  const h=tiktokHttp(),ads=()=>new ProjectAds(f.db,f.scope,KEY,undefined,'tiktok',h);
  await ads().connect({adAccountId:'7000000000000001',accessToken:TIKTOK});ads().setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  let item=ads().savePlan(plan({objective:'OUTCOME_APP_PROMOTION',app:{store:'google',appId:'com.example.qaink',storeUrl:'https://play.google.com/store/apps/details?id=com.example.qaink'}})).plans[0];item=ads().approve({id:item.id,expectedRevision:item.revision}).plans[0];item=(await ads().create({id:item.id})).plans[0];
  const creatives=new AdCreatives(f.db,f.scope,KEY,'tiktok',undefined,h);
  assert.deepEqual(plain(creatives.list(item.id).ctas),['INSTALL_MOBILE_APP']);
  await assert.rejects(creatives.save({planId:item.id,image:{data:await png(1080,1920),mime:'image/png'},primaryText:'x'.repeat(101)}),/100/,'TikTok ad text is short');
  let creative=(await creatives.save({planId:item.id,image:{data:await png(1080,1920),mime:'image/png'},primaryText:'Dövme fikirleri'})).creatives[0];assert.equal(creative.pageId,'');
  await assert.rejects(creatives.save({planId:item.id,id:creative.id,expectedRevision:creative.revision,cta:'SHOP_NOW'}),/eylem düğmesi/);
  creative=creatives.approve({id:creative.id,expectedRevision:creative.revision}).creatives[0];process.env.PLATFORM_AD_CREATIVES_ENABLED='1';
  creative=(await creatives.upload({id:creative.id,acknowledged:true})).creatives[0];assert.equal(creative.state,'uploaded');assert.equal(creative.adRef,null);
  const upload=h.calls.find(call=>call.url.pathname.endsWith('/file/image/ad/upload/'));assert.equal(upload.headers['Access-Token'],TIKTOK);assert.equal(upload.body.get('upload_type'),'UPLOAD_BY_FILE');assert.equal(upload.body.get('advertiser_id'),'7000000000000001');
  const file=Buffer.from(await upload.body.get('image_file').arrayBuffer());assert.equal(upload.body.get('image_signature'),crypto.createHash('md5').update(file).digest('hex'),'the signature is the file’s MD5');
  assert.equal(f.db.prepare("SELECT image_ref r FROM platform_ad_creatives WHERE id=?").get(creative.id).r,'ad-image-7788');
}));

// Disposable video host: answers the header check; nothing is downloaded.
const videoHost=(etag='"v1"')=>async url=>({status:200,headers:new Headers({'content-type':'video/mp4','content-length':'1000000',etag}),finalUrl:url,cancel:async()=>{}});
test('Meta video: Meta fetches the team’s video, the image is its cover; a video still processing waits for another Send',env(async f=>{
  let ready=false;const base=graph(),g=async(method,path,token,params={})=>{if(path.endsWith('/advideos')){base.calls.push({method,path,token,params});return {id:'770001'};}if(method==='GET'&&path==='770001'){base.calls.push({method,path,token,params});return {status:{video_status:ready?'ready':'processing'}};}return base(method,path,token,params);};g.calls=base.calls;
  const item=await metaPlan(f,g),host=videoHost(),creatives=new AdCreatives(f.db,f.scope,KEY,'meta',g,undefined,host,async()=>{});
  await assert.rejects(creatives.save({planId:item.id,image:{data:await png(1080,1920),mime:'image/png'},primaryText:'x',pageId:'1234567890',videoUrl:'http://example.com/v.mp4'}),/https/);
  let creative=(await creatives.save({planId:item.id,image:{data:await png(1080,1920),mime:'image/png'},headline:'Stüdyo turu',primaryText:'Dövme stüdyomuzu gezin.',pageId:'1234567890',videoUrl:'https://cdn.example.com/tur.mp4'})).creatives[0];
  assert.equal(creative.videoUrl,'https://cdn.example.com/tur.mp4');assert.equal(creative.videoBytes,1000000);
  creative=creatives.approve({id:creative.id,expectedRevision:creative.revision}).creatives[0];process.env.PLATFORM_AD_CREATIVES_ENABLED='1';
  creative=(await creatives.upload({id:creative.id,acknowledged:true})).creatives[0];
  assert.equal(creative.state,'approved','still approved while Meta processes the video');assert.match(creative.lastError,/işleniyor/);assert.equal(creative.videoRef,'770001');
  const upload=g.calls.find(call=>call.path.endsWith('/advideos'));assert.equal(upload.params.file_url,'https://cdn.example.com/tur.mp4');
  ready=true;const before=g.calls.length;creative=(await creatives.upload({id:creative.id,acknowledged:true})).creatives[0];assert.equal(creative.state,'uploaded');
  const later=g.calls.slice(before);assert.equal(later.some(call=>call.path.endsWith('/advideos')||call.path.endsWith('/adimages')),false,'the image and video are not sent twice');
  const story=JSON.parse(later.find(call=>call.path.endsWith('/adcreatives')).params.object_story_spec);
  assert.deepEqual(plain(story.video_data),{video_id:'770001',image_hash:'a1b2c3d4e5f60718293a4b5c6d7e8f90',message:'Dövme stüdyomuzu gezin.',title:'Stüdyo turu',call_to_action:{type:'LEARN_MORE',value:{link:'https://example.com/ink'}}});
  // A video that changes after approval is never sent.
  let changed=(await creatives.save({planId:item.id,image:{data:await png(1080,1080),mime:'image/png'},primaryText:'İkinci',pageId:'1234567890',videoUrl:'https://cdn.example.com/iki.mp4'})).creatives[1];changed=creatives.approve({id:changed.id,expectedRevision:changed.revision}).creatives[1];
  await assert.rejects(new AdCreatives(f.db,f.scope,KEY,'meta',g,undefined,videoHost('"v2"'),async()=>{}).upload({id:changed.id,acknowledged:true}),/değişti/);
}));
test('TikTok: the ad group is made once from the approved plan with TikTok’s own locations; a video becomes a DISABLED ad in it',env(async f=>{
  const base=tiktokHttp(),calls=base.calls,ok=payload=>({status:200,header:()=>null,payload});let regions=[{location_id:'298795',region_code:'TR',level:'COUNTRY'},{location_id:'2921044',region_code:'DE',level:'COUNTRY'}];
  const h=async request=>{const url=new URL(request.url);
    if(url.pathname.endsWith('/tool/region/')){calls.push({...request,url});return ok({code:0,data:{region_info:regions}});}
    if(url.pathname.endsWith('/identity/create/')){calls.push({...request,url,json:JSON.parse(request.body)});return ok({code:0,data:{identity_id:'ident-55'}});}
    if(url.pathname.endsWith('/adgroup/create/')){calls.push({...request,url,json:JSON.parse(request.body)});return ok({code:0,data:{adgroup_id:'1700000000000077'}});}
    if(url.pathname.endsWith('/file/video/ad/upload/')){calls.push({...request,url,json:JSON.parse(request.body)});return ok({code:0,data:[{video_id:'v10000'}]});}
    if(url.pathname.endsWith('/ad/create/')){calls.push({...request,url,json:JSON.parse(request.body)});return ok({code:0,data:{ad_ids:['1600000000000088']}});}
    return base(request);};h.calls=calls;
  const ads=()=>new ProjectAds(f.db,f.scope,KEY,undefined,'tiktok',h);await ads().connect({adAccountId:'7000000000000001',accessToken:TIKTOK});ads().setPolicy({dailyCapMinor:5000,monthlyCapMinor:60000,expectedRevision:0});
  let item=ads().savePlan(plan({objective:'OUTCOME_APP_PROMOTION',countries:['TR','DE'],app:{store:'apple',appId:'1234567890',storeUrl:'https://apps.apple.com/tr/app/qa/id1234567890'}})).plans[0];item=ads().approve({id:item.id,expectedRevision:item.revision}).plans[0];item=(await ads().create({id:item.id})).plans[0];
  const creatives=new AdCreatives(f.db,f.scope,KEY,'tiktok',undefined,h,videoHost(),async()=>{});
  // A video uploaded before the ad group exists stays in the library.
  let early=(await creatives.save({planId:item.id,image:{data:await png(1080,1920),mime:'image/png'},primaryText:'Dövme fikirleri',videoUrl:'https://cdn.example.com/ink.mp4'})).creatives[0];early=creatives.approve({id:early.id,expectedRevision:early.revision}).creatives[0];
  process.env.PLATFORM_AD_CREATIVES_ENABLED='1';early=(await creatives.upload({id:early.id,acknowledged:true})).creatives[0];assert.equal(early.state,'uploaded');assert.equal(early.adRef,null);assert.equal(early.videoRef,'v10000');
  assert.deepEqual(plain(calls.find(call=>call.url.pathname.endsWith('/file/video/ad/upload/')).json),{advertiser_id:'7000000000000001',upload_type:'UPLOAD_BY_URL',video_url:'https://cdn.example.com/ink.mp4',file_name:`ryzevo-${early.id.slice(0,8)}`});
  await assert.rejects(creatives.setupTikTok({planId:item.id,displayName:'QA Ink',acknowledged:true}),/App ID/,'app plans need the TikTok app id');
  regions=[{location_id:'298795',region_code:'TR',level:'COUNTRY'}];
  await assert.rejects(creatives.setupTikTok({planId:item.id,displayName:'QA Ink',tiktokAppId:'7300000001',acknowledged:true}),/konum listesinde/);
  assert.equal(calls.some(call=>call.url.pathname.endsWith('/adgroup/create/')),false,'an unknown country creates nothing');
  regions=[{location_id:'298795',region_code:'TR',level:'COUNTRY'},{location_id:'2921044',region_code:'DE',level:'COUNTRY'}];
  const list=await creatives.setupTikTok({planId:item.id,displayName:'QA Ink',tiktokAppId:'7300000001',acknowledged:true});assert.equal(list.tiktok.ready,true);assert.equal(list.tiktok.adgroupId,'1700000000000077');
  const group=calls.find(call=>call.url.pathname.endsWith('/adgroup/create/')).json;
  assert.equal(group.operation_status,'DISABLE');assert.equal(group.promotion_type,'APP_IOS');assert.equal(group.app_id,'7300000001');assert.deepEqual(plain(group.location_ids),['298795','2921044']);assert.equal(group.budget,20);assert.equal(group.optimization_goal,'INSTALL');
  assert.equal(group.schedule_start_time,`${day(1)} 00:00:00`);assert.equal(group.campaign_id,'1800000000000009');
  assert.equal(f.db.prepare('SELECT provider_adset_id id FROM platform_ad_plans WHERE id=?').get(item.id).id,'1700000000000077');
  await assert.rejects(creatives.setupTikTok({planId:item.id,displayName:'QA Ink',tiktokAppId:'7300000001',acknowledged:true}),/zaten kurulu/);
  // The video already in the library becomes an ad now, without a second upload.
  const before=calls.length;early=(await creatives.upload({id:early.id,acknowledged:true})).creatives[0];assert.equal(early.adRef,'1600000000000088');
  assert.equal(calls.slice(before).some(call=>call.url.pathname.includes('/file/')),false);
  const ad=calls.slice(before).find(call=>call.url.pathname.endsWith('/ad/create/')).json;
  assert.equal(ad.operation_status,'DISABLE');assert.equal(ad.adgroup_id,'1700000000000077');assert.deepEqual(plain(ad.creatives[0]),{ad_name:`Ink installs · ${early.id.slice(0,8)}`,identity_type:'CUSTOMIZED_USER',identity_id:'ident-55',ad_format:'SINGLE_VIDEO',video_id:'v10000',image_ids:['ad-image-7788'],ad_text:'Dövme fikirleri',call_to_action:'DOWNLOAD_NOW'});
}));
test('Google Play search terms: the Play Console CSV is read by column name, per period, against the previous upload',()=>{
  const {parsePlayTermsCsv}=load('mobile-aso-providers.ts');
  const english=parsePlayTermsCsv('﻿Search term,Store listing visitors,Store listing acquisitions,Conversion rate\ntattoo ideas,1200,96,8.0%\n"dövme, fikir",300,12,4%\nTattoo Ideas,5,1,20%\n');
  assert.deepEqual(plain(english),[{term:'tattoo ideas',visitors:1200,installs:96,conversion:0.08},{term:'dövme, fikir',visitors:300,installs:12,conversion:0.04}],'duplicates after normalising are dropped');
  const turkish=parsePlayTermsCsv('Rapor,Mağaza performansı\nArama terimi,Mağaza girişi ziyaretçileri,Mağaza girişi edinimleri\ndövme,"1,5",3\n');
  assert.deepEqual(plain(turkish),[{term:'dövme',visitors:2,installs:3,conversion:null}],'a title row is skipped; Turkish headers and decimal commas are read');
  assert.throws(()=>parsePlayTermsCsv('foo,bar\n1,2\n'),/columns/);
});
