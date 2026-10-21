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
  for(const [raw,platform] of [[{url:'http://x.example/v.mp4',format:'reel'},'instagram'],[{url:VIDEO,format:'feed'},'instagram'],[{url:VIDEO,format:'reel'},'facebook'],[{url:VIDEO,format:'reel'},'linkedin']])assert.throws(()=>normalizeContentVideo(raw,platform),JSON.stringify([raw,platform]));
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
