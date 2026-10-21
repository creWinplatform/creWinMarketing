const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SocialPublications}=load('social-publications.ts'),{normalizeContentVideo,checkPublicationVideo,sameVideo}=load('social-video.ts');
const access=async()=>({expiresAt:Date.now()+3600000});
const VIDEO='https://cdn.example-team.com/media/spring.mp4';
function config(){Object.assign(process.env,{PLATFORM_META_APP_ID:'12345',PLATFORM_META_APP_SECRET:'private-secret',PLATFORM_META_GRAPH_VERSION:'v25.0',PLATFORM_META_REDIRECT_URI:'https://app.ryzevo.com/api/platform/meta/callback',PLATFORM_PUBLIC_ORIGIN:'https://app.ryzevo.com'});}
// Disposable header reader standing in for the SSRF-safe fetcher; `file` can be changed to simulate an edited video.
const reader=(file={type:'video/mp4',length:'52428800',etag:'"v1"'},final)=>{const calls=[];const fn=async url=>{calls.push(url.href);return {status:200,finalUrl:final?new URL(final):url,headers:new Headers({'content-type':file.type,'content-length':file.length,etag:file.etag}),cancel:async()=>{}};};fn.calls=calls;fn.file=file;return fn;};
function setup(platform='instagram',format='reel',read=reader()){
  config();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';const f=fixture();
  f.conn=platform==='instagram'?f.store.saveConnection({provider:'social',integrationId:'instagram:300',accountName:'QA Instagram',accessToken:'private-page-token',expiresAt:Date.now()+86400000,social:{platform:'instagram',accountId:'300',pageId:'100',graphVersion:'v25.0'}},KEY,{appId:'12345',userAccessToken:'private-user-token'})
    :f.store.saveConnection({provider:'social',integrationId:'facebook:100',accountName:'QA Page',accessToken:'private-page-token',expiresAt:Date.now()+86400000,social:{platform:'facebook',accountId:'100',graphVersion:'v25.0'}},KEY,{appId:'12345',userAccessToken:'private-user-token'});
  f.content={id:`${platform}-video`,platform,language:'tr',headline:'Video QA',content:'Bahar dönemi videosu.',prompt:'',timestamp:Date.now(),video:{url:VIDEO,format}};f.store.saveContent(f.content,true);
  f.calls=[];f.adapter={create:async()=>assert.fail('image path'),createVideo:async(_t,_id,text,url,fmt)=>{f.calls.push(['createVideo',url,fmt,text]);return '701';},status:async()=>{f.calls.push(['status']);return 'FINISHED';},publish:async(_t,_id,container,reserve)=>{assert.equal(reserve(),true);f.calls.push(['publish',container]);return {state:'accepted',postId:'801',postUrl:'https://www.instagram.com/reel/AbC123/'};}};
  f.read=read;f.service=new SocialPublications(f.db,f.scope,KEY,f.adapter,read);
  f.input=(patch={})=>{const v=f.service.workspace(),s=v.sources.find(s=>s.id===f.content.id),t=v.targets.find(t=>t.id===f.conn.id);return {sourceKind:'content',sourceId:s.id,connectionId:t.id,expectedDigest:s.digest,expectedTargetRevision:t.revision,mode:'rehearsal',idempotencyKey:`video-${platform}-${format}-intent`,...patch};};
  f.publish=async(patch={})=>{process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.service.check(f.conn.id,access);return f.service.create(f.input({mode:'publish',acknowledged:true,idempotencyKey:`video-publish-${Date.now()}`,...patch}));};
  f.due=id=>f.db.prepare('UPDATE platform_social_publications SET next_check_at=NULL WHERE job_id=?').run(id);return f;
}
const run=(fn,...args)=>async()=>{const f=setup(...args);try{await fn(f);}finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}};

test('video addresses and formats are checked; only the address is stored',async()=>{
  assert.deepEqual({...normalizeContentVideo({url:VIDEO,format:'reel'},'instagram')},{url:VIDEO,format:'reel'});
  for(const [raw,platform] of [[{url:'http://x.example/v.mp4',format:'reel'},'instagram'],[{url:VIDEO,format:'feed'},'instagram'],[{url:VIDEO,format:'story'},'facebook'],[{url:VIDEO,format:'reel'},'linkedin']])assert.throws(()=>normalizeContentVideo(raw,platform),JSON.stringify([raw,platform]));
  const ok=await checkPublicationVideo({url:VIDEO,format:'reel'},reader());assert.equal(ok.bytes,52428800);assert.equal(ok.etag,'"v1"');
  await assert.rejects(checkPublicationVideo({url:VIDEO,format:'reel'},reader(undefined,'https://other.example/x.mp4')),/yönlendirme/);
  await assert.rejects(checkPublicationVideo({url:VIDEO,format:'reel'},reader({type:'text/html',length:'10',etag:''})),/MP4/);
  await assert.rejects(checkPublicationVideo({url:VIDEO,format:'reel'},reader({type:'video/mp4',length:String(400*1024*1024),etag:''})),/300 MB/);
  await assert.rejects(checkPublicationVideo({url:VIDEO,format:'reel'},reader({type:'video/mp4',length:'',etag:''})),/boyutu bilinmiyor/);
  assert.equal(sameVideo(ok,{...ok,etag:'"v2"'}),false);
});
test('Instagram Reels: checked at queue time, re-checked before the container, published after processing',run(async f=>{
  const source=f.service.workspace().sources.find(s=>s.id===f.content.id);assert.equal(source.eligible,true);assert.equal(source.format,'reel');assert.equal(source.imagePreview,undefined);
  const rehearsal=await f.service.create(f.input());await f.service.process(rehearsal.id);assert.equal(f.service.get(rehearsal.id).state,'rehearsed');assert.equal(f.calls.length,0,'rehearsal never contacts Instagram');
  const job=await f.publish();assert.equal(job.format,'reel');assert.equal(job.video.bytes,52428800);
  await f.service.process(job.id,access);assert.deepEqual(f.calls[0],['createVideo',VIDEO,'reel','Bahar dönemi videosu.']);
  f.due(job.id);await f.service.process(job.id,access);const done=f.service.get(job.id);
  assert.equal(done.state,'accepted');assert.equal(done.providerPostId,'801');assert.equal(done.providerUrl,'https://www.instagram.com/reel/AbC123/');
  assert.ok(f.read.calls.length>=2,'the file is checked when queued and again before the container');
}));
test('Instagram Story: an edited file after approval is never posted',run(async f=>{
  const job=await f.publish();f.read.file.etag='"v2-edited"';
  await f.service.process(job.id,access);const result=f.service.get(job.id);
  assert.equal(result.state,'blocked');assert.equal(result.reason,'media_changed');assert.equal(f.calls.length,0);
},'instagram','story'));
test('Facebook Page video: file_url to the Page, the video id is the post',run(async f=>{
  const original=globalThis.fetch,seen=[];
  globalThis.fetch=async(url,options={})=>{const href=String(url);seen.push({href,body:String(options.body||'')});
    if(href.includes('/videos'))return Response.json({id:'9900000000001'});
    if(href.includes('/permissions'))return Response.json({data:['pages_show_list','pages_read_engagement','pages_manage_posts'].map(permission=>({permission,status:'granted'}))});
    return Response.json(href.includes('/accounts')?{data:[{id:'100',access_token:'private-page-token',tasks:['CREATE_CONTENT']}]}:{id:'100'});};
  try{
    const job=await f.publish();await f.service.process(job.id);const done=f.service.get(job.id);
    assert.equal(done.state,'accepted');assert.equal(done.providerPostId,'9900000000001');
    const post=seen.find(call=>call.href.includes('/videos'));assert.match(post.href,/^https:\/\/graph-video\.facebook\.com\/v25\.0\/100\/videos$/);
    assert.equal(new URLSearchParams(post.body).get('file_url'),VIDEO);assert.doesNotMatch(post.href,/private-/);
  }finally{globalThis.fetch=original;}
},'facebook','feed'));
test('video and images cannot be mixed, and other channels do not take videos',()=>{
  config();const f=fixture();
  try{
    f.store.saveContent({id:'li-video',platform:'linkedin',language:'tr',headline:'x',content:'x',prompt:'',timestamp:Date.now(),video:{url:VIDEO,format:'reel'}},true);
    const service=new SocialPublications(f.db,f.scope,KEY);assert.equal(service.workspace().sources.find(s=>s.id==='li-video')?.eligible??false,false);
  }finally{f.db.close();}
});
test('a single Instagram image can go out as a Story: no caption is sent',async()=>{
  const sharp=require('sharp');const f=setup('instagram','reel');
  try{
    const imageData=(await sharp({create:{width:640,height:640,channels:3,background:'#5e963c'}}).png().toBuffer()).toString('base64');
    f.store.saveContent({id:'ig-story',platform:'instagram',language:'tr',headline:'Story',content:'Story metni',prompt:'',timestamp:Date.now(),imageData,imageMime:'image/png',story:true},true);
    let created=null;f.adapter.create=async(_t,_id,text,url,story)=>{created={text,story};return '702';};
    const source=f.service.workspace().sources.find(s=>s.id==='ig-story');assert.equal(source.format,'story');assert.equal(source.eligible,true);
    process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.service.check(f.conn.id,access);
    const job=await f.service.create({sourceKind:'content',sourceId:'ig-story',connectionId:f.conn.id,expectedDigest:source.digest,expectedTargetRevision:f.service.workspace().targets.find(t=>t.id===f.conn.id).revision,mode:'publish',acknowledged:true,idempotencyKey:'ig-story-publish'});
    assert.equal(job.format,'story');await f.service.process(job.id,access);assert.deepEqual(created,{text:'Story metni',story:true});
  }finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}
});
test('Facebook Reels: start, Meta fetches the file, then publish; a failed upload is never published',run(async f=>{
  const original=globalThis.fetch,seen=[];
  globalThis.fetch=async(url,options={})=>{const href=String(url);seen.push({href,body:String(options.body||''),headers:options.headers||{}});
    if(href.includes('/video_reels')){const phase=new URLSearchParams(String(options.body)).get('upload_phase');return Response.json(phase==='start'?{video_id:'7700000000001',upload_url:'https://rupload.facebook.com/video-upload/v25.0/7700000000001'}:{success:true});}
    if(href.startsWith('https://rupload.facebook.com/'))return Response.json({success:true});
    if(href.includes('/permissions'))return Response.json({data:['pages_show_list','pages_read_engagement','pages_manage_posts'].map(permission=>({permission,status:'granted'}))});
    return Response.json(href.includes('/accounts')?{data:[{id:'100',access_token:'private-page-token',tasks:['CREATE_CONTENT']}]}:{id:'100'});};
  try{
    const job=await f.publish();assert.equal(job.format,'reel');await f.service.process(job.id);const done=f.service.get(job.id);
    assert.equal(done.state,'accepted');assert.equal(done.providerPostId,'7700000000001');assert.equal(done.providerUrl,'https://www.facebook.com/reel/7700000000001');
    const upload=seen.find(call=>call.href.startsWith('https://rupload.facebook.com/'));assert.equal(upload.href,'https://rupload.facebook.com/video-upload/v25.0/7700000000001');assert.equal(upload.headers.file_url,VIDEO);
    const finish=seen.filter(call=>call.href.includes('/video_reels')).at(-1),body=new URLSearchParams(finish.body);
    assert.equal(body.get('upload_phase'),'finish');assert.equal(body.get('video_state'),'PUBLISHED');assert.equal(body.get('video_id'),'7700000000001');
    assert.ok(seen.every(call=>!/private-/.test(call.href)));
  }finally{globalThis.fetch=original;}
},'facebook','reel'));
test('Facebook Reels: when Meta cannot fetch the file, nothing is published',run(async f=>{
  const original=globalThis.fetch,seen=[];
  globalThis.fetch=async(url,options={})=>{const href=String(url);seen.push({href,body:String(options.body||'')});
    if(href.includes('/video_reels'))return Response.json({video_id:'7700000000002'});
    if(href.startsWith('https://rupload.facebook.com/'))return Response.json({success:false});
    if(href.includes('/permissions'))return Response.json({data:['pages_show_list','pages_read_engagement','pages_manage_posts'].map(permission=>({permission,status:'granted'}))});
    return Response.json(href.includes('/accounts')?{data:[{id:'100',access_token:'private-page-token',tasks:['CREATE_CONTENT']}]}:{id:'100'});};
  try{
    const job=await f.publish();await f.service.process(job.id);assert.equal(f.service.get(job.id).state,'rejected');
    assert.equal(seen.filter(call=>call.href.includes('/video_reels')&&new URLSearchParams(call.body).get('upload_phase')==='finish').length,0);
  }finally{globalThis.fetch=original;}
},'facebook','reel'));
test('campaign drafts can carry a video: Instagram gets it in the chosen format, other channels get the text',run(async f=>{
  f.store.saveCampaign({id:'video-campaign',name:'Bahar videosu',status:'draft',updatedAt:new Date().toISOString(),objective:'awareness',content:{text:'Bahar dönemi başlıyor.',video:{url:VIDEO,instagram:'story'}},channels:{email:false,social:['instagram','linkedin'],whatsapp:false,telegram:false,paidAds:[]}},true);
  const sources=f.service.workspace().sources.filter(s=>s.id==='video-campaign');
  const instagram=sources.find(s=>s.platform==='instagram');assert.equal(instagram.format,'story');assert.equal(instagram.eligible,true);assert.deepEqual(JSON.parse(JSON.stringify(instagram.video)),{url:VIDEO,format:'story'});
  const linkedin=sources.find(s=>s.platform==='linkedin');if(linkedin){assert.equal(linkedin.format,'text');assert.equal(linkedin.video,undefined);}
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.service.check(f.conn.id,access);
  const target=f.service.workspace().targets.find(t=>t.id===f.conn.id);
  const job=await f.service.create({sourceKind:'campaign',sourceId:'video-campaign',connectionId:f.conn.id,expectedDigest:instagram.digest,expectedTargetRevision:target.revision,mode:'publish',acknowledged:true,idempotencyKey:'campaign-video-publish'});
  assert.equal(job.format,'story');await f.service.process(job.id,access);
  assert.deepEqual(f.calls[0],['createVideo',VIDEO,'story','Bahar dönemi başlıyor.']);
},'instagram','reel'));
