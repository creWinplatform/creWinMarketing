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
