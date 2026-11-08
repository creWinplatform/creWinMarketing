const assert=require('node:assert/strict'),{test}=require('node:test'),sharp=require('sharp');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
// TikTok, Pinterest and YouTube Shorts: OAuth connection, the publishing check with a refreshed access token, approved
// publications and the provider calls. A fake fetch stands in for every provider; nothing leaves the machine.
const {SocialPublications}=load('social-publications.ts'),{ProjectChannelOAuth}=load('channel-oauth.ts'),{decryptCredentials}=load('credential-envelope.ts');
const channel=load('channel-publishing.ts');
const ENV={PLATFORM_TIKTOK_CLIENT_KEY:'qa-tiktok-key',PLATFORM_TIKTOK_CLIENT_SECRET:'qa-tiktok-secret-only',PLATFORM_TIKTOK_REDIRECT_URI:'http://localhost:3033/api/platform/channels/callback',
  PLATFORM_PINTEREST_CLIENT_ID:'qa-pinterest-id',PLATFORM_PINTEREST_CLIENT_SECRET:'qa-pinterest-secret-only',PLATFORM_PINTEREST_REDIRECT_URI:'http://localhost:3033/api/platform/channels/callback',
  PLATFORM_YOUTUBE_CLIENT_ID:'qa-youtube-id',PLATFORM_YOUTUBE_CLIENT_SECRET:'qa-youtube-secret-only',PLATFORM_YOUTUBE_REDIRECT_URI:'http://localhost:3033/api/platform/channels/callback'};
Object.assign(process.env,ENV);
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
// A fake provider: routes by URL, records calls, never touches the network.
function provider(routes){const calls=[];const fetch=async(url,init={})=>{const key=`${init.method||'GET'} ${String(url).split('?')[0]}`;calls.push({key,url:String(url),init});const route=routes[key];if(!route)throw new Error(`unexpected ${key}`);return typeof route==='function'?route(init,String(url)):new Response(await route.clone().text(),{status:route.status,headers:route.headers});};return {fetch,calls};}
const withFetch=async(fake,work)=>{const original=globalThis.fetch;globalThis.fetch=fake;try{return await work();}finally{globalThis.fetch=original;}};
const TOKENS={
  tiktok:{'POST https://open.tiktokapis.com/v2/oauth/token/':json({access_token:'tt-access',expires_in:86400,refresh_token:'tt-refresh',refresh_expires_in:31536000,open_id:'-000abcDEF',scope:'user.info.basic,video.publish,video.list',token_type:'Bearer'}),
    'GET https://open.tiktokapis.com/v2/user/info/':json({data:{user:{open_id:'-000abcDEF',display_name:'QA'}},error:{code:'ok'}})},
  pinterest:{'POST https://api.pinterest.com/v5/oauth/token':json({access_token:'pin-access',expires_in:2592000,refresh_token:'pin-refresh',refresh_token_expires_in:31536000,scope:'boards:read pins:write user_accounts:read'}),
    'GET https://api.pinterest.com/v5/boards/549755885175':json({id:'549755885175',name:'Dövme fikirleri'})},
  youtube:{'POST https://oauth2.googleapis.com/token':json({access_token:'yt-access',expires_in:3599,refresh_token:'yt-refresh',scope:'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',token_type:'Bearer'}),
    'GET https://www.googleapis.com/youtube/v3/channels':json({items:[{id:'UCabcdefghijklmnopqrstuv'}]})},
};
async function connect(f,platform,extra={}){
  const oauth=new ProjectChannelOAuth(f.db,f.scope,KEY),started=await oauth.start({platform,accountName:`QA ${platform}`,...extra}),url=new URL(started.authorizationUrl),state=url.searchParams.get('state');
  const fake=provider(TOKENS[platform]);const done=await withFetch(fake.fetch,async ()=>await oauth.complete(state,started.browser,'qa-code'));
  return {connection:done.connection,url,calls:fake.calls};
}
const makeImage=async()=>({imageData:(await sharp({create:{width:1000,height:1000,channels:3,background:'#222'}}).png().toBuffer()).toString('base64'),imageMime:'image/png'});
const videoReader=async url=>({status:200,finalUrl:url,headers:new Headers({'content-type':'video/mp4','content-length':'5242880',etag:'"v1"'}),cancel:async()=>{}});
const run=fn=>async()=>{const f=await fixture();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';try{await fn(f);}finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}};

test('each channel connects with OAuth; the account is the open_id, the chosen board or the channel; no secret leaves the vault',run(async f=>{
  const tiktok=await connect(f,'tiktok');assert.equal(tiktok.url.origin+tiktok.url.pathname,'https://www.tiktok.com/v2/auth/authorize/');assert.equal(tiktok.url.searchParams.get('scope'),'user.info.basic,video.publish,video.list');
  const pinterest=await connect(f,'pinterest',{boardId:'549755885175'});
  const youtube=await connect(f,'youtube');assert.equal(youtube.url.searchParams.get('access_type'),'offline');assert.ok(youtube.url.searchParams.get('code_challenge'));
  const rows=f.db.prepare("SELECT platform,account_id FROM platform_social_accounts WHERE platform IN ('tiktok','pinterest','youtube') ORDER BY platform").all();
  assert.deepEqual(JSON.parse(JSON.stringify(rows)),[{platform:'pinterest',account_id:'549755885175'},{platform:'tiktok',account_id:'-000abcDEF'},{platform:'youtube',account_id:'UCabcdefghijklmnopqrstuv'}]);
  const credentials=decryptCredentials(f.db.prepare('SELECT encrypted_credentials v FROM platform_connections WHERE id=?').get(tiktok.connection.id).v,KEY,f.scope.organizationId,f.scope.projectId,tiktok.connection.id);
  assert.equal(credentials.refreshToken,'tt-refresh');assert.ok(credentials.channelPublishing.accessExpiresAt>Date.now());
  assert.doesNotMatch(JSON.stringify(await new SocialPublications(f.db,f.scope,KEY).workspace()),/tt-access|tt-refresh|pin-refresh|yt-refresh|secret-only/);
  await assert.rejects(async ()=>await new ProjectChannelOAuth(f.db,f.scope,KEY).start({platform:'pinterest',accountName:'x'}),e=>e.status===400,'Pinterest needs a board');
  await assert.rejects(async ()=>await new ProjectChannelOAuth(f.db,f.scope,KEY).start({platform:'myspace',accountName:'x'}),e=>e.status===400);
}));

test('a missing scope or a board that is not the account’s fails the connection',run(async f=>{
  const oauth=new ProjectChannelOAuth(f.db,f.scope,KEY);
  let started=await oauth.start({platform:'tiktok',accountName:'QA'}),state=new URL(started.authorizationUrl).searchParams.get('state');
  await withFetch(provider({...TOKENS.tiktok,'POST https://open.tiktokapis.com/v2/oauth/token/':json({access_token:'a',expires_in:86400,refresh_token:'r',open_id:'x',scope:'user.info.basic'})}).fetch,()=>assert.rejects(async ()=>await oauth.complete(state,started.browser,'code'),e=>e.status===400));
  started=await oauth.start({platform:'pinterest',accountName:'QA',boardId:'1'});state=new URL(started.authorizationUrl).searchParams.get('state');
  await withFetch(provider({...TOKENS.pinterest,'GET https://api.pinterest.com/v5/boards/1':json({message:'not found'},404)}).fetch,()=>assert.rejects(async ()=>await oauth.complete(state,started.browser,'code')));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_social_accounts WHERE platform IN ('tiktok','pinterest')").get().n,0);
}));

test('a Pinterest pin: one image, a 500-character description, the check refreshes the token, the pin goes to the board',run(async f=>{
  const {connection}=await connect(f,'pinterest',{boardId:'549755885175'});
  await f.store.saveContent({id:'pin-1',platform:'pinterest',language:'tr',headline:'Minimal dövme fikirleri',content:'Bilek için minimal dövme fikirleri https://example.com/fikirler',timestamp:Date.now(),prompt:'',...await makeImage()},true);
  const service=new SocialPublications(f.db,f.scope,KEY),source=(await service.workspace()).sources.find(item=>item.id==='pin-1');
  assert.equal(source.eligible,true);assert.equal(source.format,'image');assert.ok(source.text.includes('utm_source=pinterest')||!source.trackedLinks,'own links carry the pin’s tag when tracking is on');
  await f.store.saveContent({id:'pin-2',platform:'pinterest',language:'tr',headline:'x',content:'x'.repeat(501),timestamp:Date.now(),prompt:'',...await makeImage()},true);
  assert.equal((await service.workspace()).sources.find(item=>item.id==='pin-2').eligible,false,'over 500 characters');
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';
  const fake=provider({'GET https://api.pinterest.com/v5/boards/549755885175':json({id:'549755885175'}),'POST https://api.pinterest.com/v5/pins':init=>{const body=JSON.parse(init.body);assert.equal(body.board_id,'549755885175');assert.equal(body.media_source.source_type,'image_base64');assert.ok(body.link.startsWith('https://example.com/fikirler'));return json({id:'987654321'});}});
  await withFetch(fake.fetch,async()=>{
    await service.check(connection.id);
    const target=(await service.workspace()).targets.find(item=>item.id===connection.id);assert.equal(target.ready,true);
    const job=await service.create({sourceKind:'content',sourceId:'pin-1',connectionId:connection.id,expectedDigest:source.digest,expectedTargetRevision:target.revision,mode:'publish',idempotencyKey:'pinterest-qa-1',acknowledged:true});
    await service.process(job.id);
    const done=await service.get(job.id);assert.equal(done.state,'accepted');assert.equal(done.providerUrl,'https://www.pinterest.com/pin/987654321/');
  });
  assert.equal(fake.calls.filter(call=>call.key==='POST https://api.pinterest.com/v5/pins').length,1);
}));

test('TikTok and YouTube take a video only; a TikTok post pulls the approved file and keeps the private default',run(async f=>{
  const {connection}=await connect(f,'tiktok');
  await f.store.saveContent({id:'tt-1',platform:'tiktok',language:'tr',headline:'Dövme süreci',content:'Dövme süreci #dövme',timestamp:Date.now(),prompt:'',video:{url:'https://cdn.example.com/dovme.mp4',format:'feed'}},true);
  await f.store.saveContent({id:'tt-2',platform:'tiktok',language:'tr',headline:'Metin',content:'Yalnız metin',timestamp:Date.now(),prompt:''},true);
  const service=new SocialPublications(f.db,f.scope,KEY,undefined,videoReader),sources=(await service.workspace()).sources;
  assert.equal(sources.find(item=>item.id==='tt-1').eligible,true);assert.equal(sources.find(item=>item.id==='tt-2').eligible,false,'TikTok needs a video');
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';
  const fake=provider({'POST https://open.tiktokapis.com/v2/post/publish/creator_info/query/':json({data:{privacy_level_options:['SELF_ONLY','PUBLIC_TO_EVERYONE']},error:{code:'ok'}}),
    'POST https://open.tiktokapis.com/v2/post/publish/video/init/':init=>{const body=JSON.parse(init.body);assert.equal(body.post_info.privacy_level,'SELF_ONLY');assert.equal(body.source_info.video_url,'https://cdn.example.com/dovme.mp4');return json({data:{publish_id:'v_pub_url~v2.123'},error:{code:'ok'}});}});
  await withFetch(fake.fetch,async()=>{
    await service.check(connection.id);const source=(await service.workspace()).sources.find(item=>item.id==='tt-1'),target=(await service.workspace()).targets.find(item=>item.id===connection.id);
    const job=await service.create({sourceKind:'content',sourceId:'tt-1',connectionId:connection.id,expectedDigest:source.digest,expectedTargetRevision:target.revision,mode:'publish',idempotencyKey:'tiktok-qa-1',acknowledged:true});
    await service.process(job.id);assert.equal((await service.get(job.id)).state,'accepted');assert.equal((await service.get(job.id)).providerPostId,'v_pub_url~v2.123');
  });
}));

test('the access token is refreshed from the refresh token; a rotated refresh token is kept outside the envelope',run(async f=>{
  const {connection}=await connect(f,'tiktok'),row=()=>f.db.prepare('SELECT encrypted_credentials v FROM platform_connections WHERE id=?').get(connection.id).v,before=row();
  f.db.prepare('UPDATE platform_connections SET encrypted_credentials=? WHERE id=?').run(before,connection.id);
  const credentials=decryptCredentials(before,KEY,f.scope.organizationId,f.scope.projectId,connection.id);credentials.channelPublishing.accessExpiresAt=Date.now()-1000;
  const fake=provider({'POST https://open.tiktokapis.com/v2/oauth/token/':init=>{assert.match(String(init.body),/grant_type=refresh_token/);assert.match(String(init.body),/refresh_token=tt-refresh/);return json({access_token:'tt-access-2',expires_in:86400,refresh_token:'tt-refresh-2',refresh_expires_in:31536000,open_id:'-000abcDEF',scope:'user.info.basic,video.publish,video.list'});}});
  const access=await channel.channelAccess(f.db,[f.scope.organizationId,f.scope.projectId],KEY,{id:connection.id,encrypted_credentials:before},credentials,fake.fetch);
  assert.equal(access.token,'tt-access-2');assert.equal(row(),before,'the approved envelope does not change');
  const stored=f.db.prepare('SELECT encrypted_refresh FROM platform_channel_tokens WHERE connection_id=?').get(connection.id);
  assert.equal(decryptCredentials(stored.encrypted_refresh,KEY,f.scope.organizationId,f.scope.projectId,`channel-refresh:${connection.id}`).refreshToken,'tt-refresh-2');
}));

test('YouTube Short: resumable upload from the approved file, #Shorts title, private by default; a 4xx is a rejection',async()=>{
  const video={url:'https://cdn.example.com/dovme.mp4',format:'feed',bytes:4,contentType:'video/mp4',etag:'"v1"',lastModified:null,checkedAt:new Date().toISOString()};
  let reserved=0;const reserve=()=>{reserved++;return true;};
  const source=async()=>({response:new Response(new Uint8Array([1,2,3,4]),{status:200,headers:{'content-length':'4','content-type':'video/mp4'}}),finalUrl:new URL(video.url),redirects:[]});
  const fake=provider({'POST https://www.googleapis.com/upload/youtube/v3/videos':init=>{const body=JSON.parse(init.body);assert.equal(body.snippet.title,'Dövme süreci #Shorts');assert.equal(body.status.privacyStatus,'private');return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=qa'}});},
    'PUT https://www.googleapis.com/upload/youtube/v3/videos':json({id:'dQw4w9WgXcQ'})});
  const result=await channel.publishYouTubeShort('yt-access','Dövme süreci\nAyrıntılar',video,reserve,fake.fetch,source);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{state:'accepted',postId:'dQw4w9WgXcQ'});assert.equal(reserved,1);
  assert.equal(channel.channelPostUrl('youtube','dQw4w9WgXcQ'),'https://www.youtube.com/shorts/dQw4w9WgXcQ');
  const rejected=await channel.publishYouTubeShort('yt-access','x',video,reserve,provider({'POST https://www.googleapis.com/upload/youtube/v3/videos':json({error:'quota'},403)}).fetch,source);
  assert.equal(rejected.state,'rejected');
  assert.equal((await channel.publishTikTokVideo('a','x',video,()=>false,async()=>assert.fail('no call without a reservation'))).state,'blocked');
});

test('Pinterest takes 2:3 pins; other channels keep the 0.8-1.91 rule',async()=>{
  const {normalizePublicationImage}=load('publication-image.ts'),tall=(await sharp({create:{width:1000,height:1500,channels:3,background:'#333'}}).png().toBuffer()).toString('base64');
  const pin=await normalizePublicationImage(tall,'image/png','pinterest');assert.ok(pin.height>pin.width,'kept tall');
  await assert.rejects(()=>normalizePublicationImage(tall,'image/png','instagram'),/0,8–1,91/);
  await assert.rejects(()=>normalizePublicationImage(tall,'image/png'),/0,8–1,91/);
});

test('a TikTok photo post: up to five approved images, served to TikTok from signed URLs on the public origin',run(async f=>{
  const saved=process.env.PLATFORM_PUBLIC_ORIGIN;process.env.PLATFORM_PUBLIC_ORIGIN='https://panel.ryzevo-qa.com';
  try{
    const {connection}=await connect(f,'tiktok');const image=await makeImage();
    await f.store.saveContent({id:'tt-photo',platform:'tiktok',language:'tr',headline:'Portfolyo',content:'Yeni portfolyo çalışmaları\n#dövme',timestamp:Date.now(),prompt:'',images:[{data:image.imageData,mime:'image/png'},{data:image.imageData,mime:'image/png'}]},true);
    const service=new SocialPublications(f.db,f.scope,KEY,undefined,videoReader),source=(await service.workspace()).sources.find(item=>item.id==='tt-photo');
    assert.equal(source.eligible,true);assert.equal(source.format,'carousel');
    process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';let urls=[];
    const fake=provider({'POST https://open.tiktokapis.com/v2/post/publish/creator_info/query/':json({data:{privacy_level_options:['SELF_ONLY']},error:{code:'ok'}}),
      'POST https://open.tiktokapis.com/v2/post/publish/content/init/':init=>{const body=JSON.parse(init.body);urls=body.source_info.photo_images;assert.equal(body.media_type,'PHOTO');assert.equal(body.post_info.title,'Yeni portfolyo çalışmaları');return json({data:{publish_id:'p_pub_url~v2.9'},error:{code:'ok'}});}});
    let jobId;
    await withFetch(fake.fetch,async()=>{
      await service.check(connection.id);const target=(await service.workspace()).targets.find(item=>item.id===connection.id);
      const job=await service.create({sourceKind:'content',sourceId:'tt-photo',connectionId:connection.id,expectedDigest:source.digest,expectedTargetRevision:target.revision,mode:'publish',idempotencyKey:'tiktok-photo-1',acknowledged:true});
      jobId=job.id;await service.process(job.id);assert.equal((await service.get(job.id)).state,'accepted');
    });
    assert.equal(urls.length,2);assert.ok(urls.every(url=>url.startsWith(`https://panel.ryzevo-qa.com/api/platform/publication-media/${jobId}?signature=`)));
    const {providerPublicationImage}=load('social-publications.ts'),second=new URL(urls[1]);
    const served=await providerPublicationImage(f.db,KEY,jobId,second.searchParams.get('signature'),Number(second.searchParams.get('index')));
    assert.ok(served.data,'TikTok can fetch the accepted post image');
    await assert.rejects(async ()=>await providerPublicationImage(f.db,KEY,jobId,'0'.repeat(64),1),e=>e.status===404,'a wrong signature gets nothing');
  }finally{if(saved===undefined)delete process.env.PLATFORM_PUBLIC_ORIGIN;else process.env.PLATFORM_PUBLIC_ORIGIN=saved;}
}));

test('a Pinterest video pin: register, stream the file as multipart, wait for processing, then pin',async()=>{
  const video={url:'https://cdn.example.com/dovme.mp4',format:'feed',bytes:4,contentType:'video/mp4',etag:'"v1"',lastModified:null,checkedAt:new Date().toISOString()};
  const source=async()=>({response:new Response(new Uint8Array([1,2,3,4]),{status:200,headers:{'content-length':'4'}}),finalUrl:new URL(video.url),redirects:[]});
  let polls=0,uploaded='';
  const fake=async(url,init={})=>{
    const key=`${init.method||'GET'} ${String(url).split('?')[0]}`;
    if(key==='POST https://api.pinterest.com/v5/media')return json({media_id:'12345',upload_url:'https://pinterest-media-upload.s3-accelerate.amazonaws.com/',upload_parameters:{key:'uploads/x',policy:'p'}});
    if(key==='POST https://pinterest-media-upload.s3-accelerate.amazonaws.com/'){uploaded=Buffer.from(await new Response(init.body).arrayBuffer()).toString('latin1');assert.equal(Number(init.headers['Content-Length']),Buffer.byteLength(uploaded,'latin1'));return new Response(null,{status:204});}
    if(key==='GET https://api.pinterest.com/v5/media/12345'){polls++;return json({status:polls<2?'processing':'succeeded'});}
    if(key==='POST https://api.pinterest.com/v5/pins'){const body=JSON.parse(init.body);assert.deepEqual(body.media_source,{source_type:'video_id',media_id:'12345',cover_image_key_frame_time:1});return json({id:'55555'});}
    throw new Error(`unexpected ${key}`);
  };
  const result=await channel.publishPinterestVideoPin('pin','549755885175','Dövme süreci','Süreç https://example.com/x',video,()=>true,fake,source,async()=>{});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{state:'accepted',postId:'55555'});
  assert.ok(uploaded.includes('name="policy"')&&uploaded.includes('name="file"; filename="video.mp4"')&&uploaded.includes('\x01\x02\x03\x04'),'fields first, then the file');
  assert.equal(polls,2);
  const failed=await channel.publishPinterestVideoPin('pin','1','t','x',video,()=>assert.fail('never pinned'),async(url,init={})=>String(url).endsWith('/v5/media')&&init.method==='POST'?json({media_id:'1',upload_url:'https://evil.example.com/',upload_parameters:{}}):assert.fail(),source,async()=>{});
  assert.equal(failed.state,'blocked','only the Pinterest upload host');
});

test('engagement counts for the three channels, as each provider reports them',async()=>{
  const yt=await channel.readChannelEngagement('youtube','t','dQw4w9WgXcQ',provider({'GET https://www.googleapis.com/youtube/v3/videos':json({items:[{id:'dQw4w9WgXcQ',statistics:{viewCount:'1200',likeCount:'45',commentCount:'3'}}]})}).fetch);
  assert.deepEqual(JSON.parse(JSON.stringify(yt)),{views:1200,likes:45,comments:3});
  const pin=await channel.readChannelEngagement('pinterest','t','987654321',provider({'GET https://api.pinterest.com/v5/pins/987654321/analytics':json({all:{summary_metrics:{IMPRESSION:900,SAVE:12,OUTBOUND_CLICK:30,PIN_CLICK:50}}})}).fetch);
  assert.deepEqual(JSON.parse(JSON.stringify(pin)),{impressions:900,bookmarks:12,clicks:30});
  const tt=await channel.readChannelEngagement('tiktok','t','v_pub_url~v2.123',provider({'POST https://open.tiktokapis.com/v2/post/publish/status/fetch/':json({data:{status:'PUBLISH_COMPLETE',publicaly_available_post_id:['7300000000000000001']},error:{code:'ok'}}),
    'POST https://open.tiktokapis.com/v2/video/query/':json({data:{videos:[{id:'7300000000000000001',view_count:5000,like_count:300,comment_count:20,share_count:7}]},error:{code:'ok'}})}).fetch);
  assert.deepEqual(JSON.parse(JSON.stringify(tt)),{views:5000,likes:300,comments:20,shares:7});
  await assert.rejects(()=>channel.readChannelEngagement('tiktok','t','v_pub_url~v2.1',provider({'POST https://open.tiktokapis.com/v2/post/publish/status/fetch/':json({data:{status:'PROCESSING_UPLOAD'},error:{code:'ok'}})}).fetch),/Not public yet/);
});
