const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs'),{plain}=require('./coach-fixture.cjs');
const {MobileGrowth}=load('mobile-store.ts'),{MobileReviews,syncDueReviews,cleanReply}=load('mobile-reviews.ts');
// Throwaway values made per run; none of them is a real credential.
const PLAY_TOKEN=`play-qa-${crypto.randomBytes(8).toString('hex')}`,PEM_LABEL=['PRIVATE','KEY'].join(' ');
const transport=answer=>{const calls=[];const fn=async(url,init={})=>{const parsed=new URL(url),call={url:parsed,method:init.method||'GET',headers:init.headers||{},body:init.body?String(init.body):null};calls.push(call);
  const value=await answer(call);if(value instanceof Response)return value;if(value===undefined)return new Response('not found',{status:404});return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});};fn.calls=calls;return fn;};
const token=async()=>PLAY_TOKEN;
function mobile(){const f=fixture(),service=new MobileGrowth(f.db,f.scope,f.KEY),app=service.saveApp({name:'QA Ink',platform:'both',appleId:'123456789',bundleId:'com.example.qa',packageName:'com.example.qa',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'qaink',attributionProvider:'bridge',revenueProvider:'bridge',identityConfirmed:true});
  let members=0;const member=role=>({...f.scope,subject:f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:`reviews-${role}-${++members}`,password:'fixture-password-123',role}).userId});
  service.saveIntegration({appId:app.id,provider:'app_store_connect',config:{issuerId:crypto.randomUUID(),keyId:'ABCDE12345'},credentials:{privateKey:crypto.generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({type:'pkcs8',format:'pem'})}});
  service.saveIntegration({appId:app.id,provider:'google_play',config:{},credentials:{serviceAccount:{type:'service_account',project_id:'qa-project',client_email:'qa@qa-project.iam.gserviceaccount.com',private_key:`-----BEGIN ${PEM_LABEL}-----\n${crypto.randomBytes(24).toString('base64')}\n-----END ${PEM_LABEL}-----\n`}}});
  return {...f,service,app,reviews:new MobileReviews(service),as:scope=>new MobileReviews(new MobileGrowth(f.db,scope,f.KEY)),member};}
const withMobile=fn=>async()=>{const f=mobile(),saved=process.env.PLATFORM_MOBILE_REVIEW_REPLY_ENABLED;try{delete process.env.PLATFORM_MOBILE_REVIEW_REPLY_ENABLED;await fn(f);}finally{if(saved===undefined)delete process.env.PLATFORM_MOBILE_REVIEW_REPLY_ENABLED;else process.env.PLATFORM_MOBILE_REVIEW_REPLY_ENABLED=saved;f.db.close();}};
const ago=days=>new Date(Date.now()-days*86400000).toISOString();
// App Store Connect: two pages; the second page's next link points elsewhere and is ignored.
const asc=(rating=2)=>transport(call=>{
  if(call.url.hostname!=='api.appstoreconnect.apple.com')return;
  if(call.method==='POST'&&call.url.pathname==='/v1/customerReviewResponses')return {data:{type:'customerReviewResponses',id:'resp-new',attributes:{responseBody:JSON.parse(call.body).data.attributes.responseBody}}};
  if(call.url.pathname==='/v1/apps/123456789/customerReviews'&&!call.url.searchParams.get('cursor'))return {data:[
    {type:'customerReviews',id:'r-1',attributes:{rating,title:'Uygulama çöküyor',body:'Randevu alırken kapanıyor.',reviewerNickname:'inkfan',createdDate:ago(1),territory:'TUR'},relationships:{response:{data:null}}},
    {type:'customerReviews',id:'r-2',attributes:{rating:5,title:'Harika',body:'Dövme fikirleri çok iyi.',reviewerNickname:'ayse',createdDate:ago(3),territory:'TUR'},relationships:{response:{data:{type:'customerReviewResponses',id:'resp-2'}}}}],
    included:[{type:'customerReviewResponses',id:'resp-2',attributes:{responseBody:'Teşekkürler!',lastModifiedDate:ago(2),state:'PUBLISHED'}}],links:{next:'https://api.appstoreconnect.apple.com/v1/apps/123456789/customerReviews?cursor=2'}};
  if(call.url.searchParams.get('cursor')==='2')return {data:[{type:'customerReviews',id:'r-3',attributes:{rating:4,title:'',body:'İyi.',reviewerNickname:'',createdDate:ago(10),territory:'DEU'}},{type:'customerReviews',id:'bad',attributes:{rating:9,createdDate:ago(1)}}],links:{next:'https://evil.example/next'}};});
test('App Store reviews: read with their replies, counted, answered from an approved draft behind the switch',withMobile(async f=>{
  const read=asc();let value=await f.reviews.sync({appId:f.app.id,store:'ios'},read);
  assert.equal(value.read,3,'an invalid rating is skipped');assert.equal(read.calls.length,2,'the foreign next link is not followed');
  assert.equal(read.calls[0].url.searchParams.get('include'),'response');assert.match(String(read.calls[0].headers.Authorization),/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  let stats=value.snapshot.stats.find(item=>item.store==='ios');assert.equal(stats.count,3);assert.equal(stats.average,3.67);assert.deepEqual(plain(stats.distribution),[0,1,0,1,1]);assert.equal(stats.unanswered,2);
  assert.equal(value.snapshot.reviews.find(review=>review.title==='Harika').storeReply,'Teşekkürler!');
  value=await f.reviews.sync({appId:f.app.id,store:'ios'},asc(1));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_mobile_reviews').get().n,3,'a second read updates, never duplicates');
  const crash=value.snapshot.reviews.find(review=>review.title==='Uygulama çöküyor');assert.equal(crash.rating,1);
  assert.deepEqual(plain(f.reviews.snapshot(f.app.id,'low').reviews.map(review=>review.rating)),[1]);
  const editor=f.as(f.member('editor'));assert.throws(()=>editor.saveReply({appId:f.app.id,reviewId:crash.id,text:'  '}),/gerekli/);
  let snapshot=editor.saveReply({appId:f.app.id,reviewId:crash.id,text:'Bildiriminiz için teşekkürler, sorunu inceliyoruz.'});let reply=snapshot.reviews.find(review=>review.id===crash.id).reply;assert.equal(reply.state,'draft');
  assert.throws(()=>editor.approveReply({appId:f.app.id,reviewId:crash.id,expectedRevision:reply.revision}),e=>e.status===403);
  reply=f.reviews.approveReply({appId:f.app.id,reviewId:crash.id,expectedRevision:reply.revision}).reviews.find(review=>review.id===crash.id).reply;assert.equal(reply.approved,true);
  await assert.rejects(f.reviews.sendReply({appId:f.app.id,reviewId:crash.id,acknowledged:true},read),e=>e.status===409&&/PLATFORM_MOBILE_REVIEW_REPLY_ENABLED/.test(e.message));
  process.env.PLATFORM_MOBILE_REVIEW_REPLY_ENABLED='1';await assert.rejects(f.reviews.sendReply({appId:f.app.id,reviewId:crash.id},read),/açık onay/);
  await assert.rejects(editor.sendReply({appId:f.app.id,reviewId:crash.id,acknowledged:true},read),e=>e.status===403);
  reply=f.reviews.saveReply({appId:f.app.id,reviewId:crash.id,expectedRevision:reply.revision,text:'Teşekkürler, sorunu inceliyoruz.'}).reviews.find(review=>review.id===crash.id).reply;assert.equal(reply.state,'draft','an edit clears the approval');
  await assert.rejects(f.reviews.sendReply({appId:f.app.id,reviewId:crash.id,acknowledged:true},read),/onaylı/);
  f.reviews.approveReply({appId:f.app.id,reviewId:crash.id,expectedRevision:reply.revision});
  const before=read.calls.length;snapshot=await f.reviews.sendReply({appId:f.app.id,reviewId:crash.id,acknowledged:true},read);
  const sent=read.calls.slice(before).find(call=>call.method==='POST');assert.deepEqual(plain(JSON.parse(sent.body)),{data:{type:'customerReviewResponses',attributes:{responseBody:'Teşekkürler, sorunu inceliyoruz.'},relationships:{review:{data:{type:'customerReviews',id:'r-1'}}}}});
  const answered=snapshot.reviews.find(review=>review.id===crash.id);assert.equal(answered.reply.state,'sent');assert.equal(answered.storeReply,'Teşekkürler, sorunu inceliyoruz.');
  assert.equal(snapshot.stats.find(item=>item.store==='ios').unanswered,1);assert.equal(f.reviews.snapshot(f.app.id,'unanswered').reviews.some(review=>review.id===crash.id),false);
  await assert.rejects(f.reviews.sendReply({appId:f.app.id,reviewId:crash.id,acknowledged:true},read),/onaylı/,'sent once');
  assert.throws(()=>f.reviews.deleteReply({appId:f.app.id,reviewId:crash.id}),/silinemez/);
  assert.throws(()=>f.as(f.other).snapshot(f.app.id),e=>e.status===404,'other projects see nothing');
}));
const play=(fail=false)=>transport(call=>{
  if(call.url.hostname!=='androidpublisher.googleapis.com')return;const path=call.url.pathname.replace('/androidpublisher/v3/applications/com.example.qa','');
  if(call.method==='POST'&&path.endsWith(':reply'))return fail?new Response('bad',{status:400}):{result:{replyText:JSON.parse(call.body).replyText,lastEdited:{seconds:String(Math.floor(Date.now()/1000))}}};
  if(path==='/reviews'&&!call.url.searchParams.get('token'))return {reviews:[{reviewId:'gp-1',authorName:'Mehmet',comments:[{userComment:{text:'\tGiriş yapamıyorum',starRating:2,reviewerLanguage:'tr',appVersionName:'1.2.0',lastModified:{seconds:String(Math.floor(Date.now()/1000)-3600)}}}]}],tokenPagination:{nextPageToken:'page-2'}};
  if(path==='/reviews')return {reviews:[{reviewId:'gp-2',authorName:'Zeynep',comments:[{userComment:{text:'Süper',starRating:5,reviewerLanguage:'tr',lastModified:{seconds:String(Math.floor(Date.now()/1000)-7200)}}},{developerComment:{text:'Teşekkürler!',lastModified:{seconds:String(Math.floor(Date.now()/1000)-3000)}}}]}]};});
test('Google Play reviews: paged read, a 350-character reply limit, failures stay as drafts to retry',withMobile(async f=>{
  let read=play();const value=await f.reviews.sync({appId:f.app.id,store:'android'},read,token);
  assert.equal(value.read,2);assert.equal(read.calls[1].url.searchParams.get('token'),'page-2');assert.equal(read.calls[0].headers.Authorization,`Bearer ${PLAY_TOKEN}`);
  const login=value.snapshot.reviews.find(review=>review.store==='android'&&review.rating===2);assert.equal(login.body,'Giriş yapamıyorum');assert.equal(login.appVersion,'1.2.0');
  assert.equal(value.snapshot.reviews.find(review=>review.rating===5).storeReply,'Teşekkürler!');
  assert.throws(()=>cleanReply('android','x'.repeat(351)),/350/);assert.equal(cleanReply('ios','x'.repeat(351)).length,351);
  let reply=f.reviews.saveReply({appId:f.app.id,reviewId:login.id,text:'Yaşadığınız sorun için üzgünüz; inceliyoruz.'}).reviews.find(review=>review.id===login.id).reply;
  f.reviews.approveReply({appId:f.app.id,reviewId:login.id,expectedRevision:reply.revision});process.env.PLATFORM_MOBILE_REVIEW_REPLY_ENABLED='1';
  read=play(true);reply=(await f.reviews.sendReply({appId:f.app.id,reviewId:login.id,acknowledged:true},read,token)).reviews.find(review=>review.id===login.id).reply;
  assert.equal(reply.state,'failed');assert.match(reply.lastError,/Google Play/);assert.equal(read.calls[0].url.pathname,'/androidpublisher/v3/applications/com.example.qa/reviews/gp-1:reply');
  reply=f.reviews.saveReply({appId:f.app.id,reviewId:login.id,expectedRevision:reply.revision,text:'Üzgünüz; sorunu inceliyoruz.'}).reviews.find(review=>review.id===login.id).reply;assert.equal(reply.state,'draft','a failed reply is edited and approved again');
  f.reviews.approveReply({appId:f.app.id,reviewId:login.id,expectedRevision:reply.revision});read=play();
  reply=(await f.reviews.sendReply({appId:f.app.id,reviewId:login.id,acknowledged:true},read,token)).reviews.find(review=>review.id===login.id);assert.equal(reply.reply.state,'sent');assert.deepEqual(plain(JSON.parse(read.calls[0].body)),{replyText:'Üzgünüz; sorunu inceliyoruz.'});
}));
test('AI reply drafts follow the rules and are never saved by themselves; the worker reads each store once a day',withMobile(async f=>{
  await f.reviews.sync({appId:f.app.id,store:'android'},play(),token);const review=f.reviews.snapshot(f.app.id).reviews.find(item=>item.rating===2);
  let prompt='';const ai=reply=>async text=>{prompt=text;return JSON.stringify({reply});};
  await assert.rejects(f.reviews.aiReply({appId:f.app.id,reviewId:review.id}),e=>e.status===503,'no AI configured');
  const value=await f.reviews.aiReply({appId:f.app.id,reviewId:review.id},ai(`Merhaba! ${'Sorunu inceliyoruz. '.repeat(40)}`));
  assert.ok([...value.reply].length<=350,'clipped to the Play limit');assert.match(prompt,/2-star Google Play review/);assert.match(prompt,/Giriş yapamıyorum/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_mobile_review_replies').get().n,0,'nothing saved');
  await assert.rejects(f.reviews.aiReply({appId:f.app.id,reviewId:review.id},ai('Bize https://example.com adresinden yazın.')),e=>e.status===422);
  // Worker: one store per tick as the person who set it up; then nothing until tomorrow.
  f.db.prepare('DELETE FROM platform_mobile_review_sync').run();
  const read=transport(call=>call.url.hostname==='api.appstoreconnect.apple.com'?{data:[]}:call.url.hostname==='androidpublisher.googleapis.com'?{reviews:[]}:undefined);
  assert.equal(await syncDueReviews(f.db,f.KEY,read,token),1);assert.equal(await syncDueReviews(f.db,f.KEY,read,token),1);assert.equal(await syncDueReviews(f.db,f.KEY,read,token),0);
  assert.deepEqual(plain(f.db.prepare('SELECT store FROM platform_mobile_review_sync ORDER BY store').all().map(row=>row.store)),['android','ios']);
}));
test('the monthly report carries the month’s mobile figures as counts only',withMobile(async f=>{
  const {mobileMonthFacts}=load('mobile-month.ts'),{MonthlyReports}=load('monthly-report.ts');
  const start=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()-1,1)),month=start.toISOString().slice(0,7),from=start.toISOString(),to=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,1)).toISOString(),inMonth=day=>`${month}-${String(day).padStart(2,'0')}`;
  const insert=(sql,...values)=>f.db.prepare(sql).run(...values),args=[f.scope.organizationId,f.scope.projectId],now=new Date().toISOString();
  insert('INSERT INTO platform_mobile_skan VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',...args,f.app.id,inMonth(5),'Apple Search Ads','Ink','TR',12,null,null,40.5,30,null,'EUR',now);
  insert('INSERT INTO platform_mobile_skan VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',...args,f.app.id,`${new Date(Date.parse(to)).toISOString().slice(0,10)}`,'Apple Search Ads','Ink','TR',99,null,null,null,null,null,'EUR',now);
  insert('INSERT INTO platform_mobile_keywords(id,organization_id,project_id,app_id,country,term,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)','kw-1',...args,f.app.id,'TR','dövme',f.scope.subject,now);
  for(const [d,rank] of [[2,14],[20,6]])insert('INSERT INTO platform_mobile_keyword_ranks(keyword_id,day,rank,result_count,leaders_json,checked_at) VALUES(?,?,?,?,?,?)','kw-1',inMonth(d),rank,50,'[]',now);
  for(const [id,rating,d] of [['a',5,3],['b',2,9],['c',4,40]])insert('INSERT INTO platform_mobile_reviews(id,organization_id,project_id,app_id,store,provider_id,rating,title,body,author,territory,language,app_version,reviewed_at,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,...args,f.app.id,'ios',`p-${id}`,rating,'Gizli başlık','Gizli yorum metni','gizli-kişi','TUR','','',d===40?to:new Date(Date.parse(from)+d*86400000).toISOString(),now);
  insert("INSERT INTO platform_mobile_review_replies(review_id,organization_id,project_id,app_id,text,digest,source,state,sent_at,created_by,created_at,updated_at) VALUES('b',?,?,?,'Teşekkürler','x','team','sent',?,?,?,?)",...args,f.app.id,new Date(Date.parse(from)+10*86400000).toISOString(),f.scope.subject,now,now);
  const [app]=plain(mobileMonthFacts(f.db,f.scope,from,to));
  assert.equal(app.name,'QA Ink');assert.deepEqual(app.skan,{installs:12,revenue:40.5,cost:30,currency:'EUR'},'only days inside the month');
  assert.deepEqual(app.keywords,{tracked:1,improved:1,declined:0,top:[{term:'dövme',country:'TR',first:14,last:6}]});
  assert.deepEqual(app.reviews,[{store:'ios',count:2,average:3.5,replied:1,overallAverage:3.5,overallCount:2}]);
  const facts=new MonthlyReports(f.db,f.scope).facts(month);assert.equal(facts.mobile[0].name,'QA Ink');assert.doesNotMatch(JSON.stringify(facts),/Gizli|gizli-kişi|Teşekkürler/,'no review text, author or reply text');
}));
