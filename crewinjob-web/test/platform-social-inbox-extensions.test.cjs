const assert=require('node:assert/strict'),{test}=require('node:test'),{createHmac}=require('node:crypto');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {ProjectSocialInbox,readDueInboxAccounts,receiveMetaInboxHook,verifyMetaInboxHook}=load('social-inbox.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const SECRET='fixture-meta-app-secret-only',VERIFY='fixture_verify_token_1234';
// Disposable provider API: answers by path, records every request. No network is used.
const fake=(answers)=>{const calls=[];const fn=async request=>{const url=new URL(request.url);calls.push({...request,host:url.hostname,path:url.pathname,query:url.searchParams});
  for(const [match,answer] of Object.entries(answers))if(url.pathname.includes(match))return typeof answer==='function'?answer(request,url):answer;
  return {status:404,header:()=>null,payload:{}};};fn.calls=calls;return fn;};
const ok=payload=>({status:200,header:()=>null,payload});
const env={PLATFORM_META_GRAPH_VERSION:'v25.0',PLATFORM_SOCIAL_PUBLISH_ENABLED:'0',PLATFORM_X_INBOX_ENABLED:'0',PLATFORM_LINKEDIN_MEMBER_COMMENTS_ENABLED:'0',PLATFORM_LINKEDIN_API_VERSION:'202609',PLATFORM_META_APP_SECRET:'',PLATFORM_META_WEBHOOK_VERIFY_TOKEN:''};
function publication(f,connection,job,postId,url){
  const now=new Date().toISOString();
  f.db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,'r',?,'completed',?,?,'social.publish')").run(job,f.scope.organizationId,f.scope.projectId,f.scope.subject,connection.id,`social:${job}`,now,now);
  f.db.prepare("INSERT INTO platform_social_publications(job_id,organization_id,project_id,source_kind,source_id,source_digest,body_digest,encrypted_snapshot,mode,scheduled_at,timezone,configuration_revision,state,submitted_at,provider_post_id,provider_url) VALUES(?,?,?,'content','c1','d','b','x','publish',?,'UTC','cfg','accepted',?,?,?)").run(job,f.scope.organizationId,f.scope.projectId,now,now,postId,url);
}
function setup(){
  Object.assign(process.env,env);const f=fixture();
  f.page=f.store.saveConnection({provider:'social',integrationId:'facebook:100',accountName:'QA Page',accessToken:'private-page-token',expiresAt:Date.now()+86400000,social:{platform:'facebook',accountId:'100',graphVersion:'v25.0'}},KEY,{appId:'12345',userAccessToken:'private-user-token'});
  f.x=f.store.saveConnection({provider:'social',integrationId:'twitter:1500',accountName:'QA X',accessToken:'private-x-token',expiresAt:Date.now()+3600000,social:{platform:'twitter',accountId:'1500'}},KEY);
  f.member=f.store.saveConnection({provider:'social',integrationId:'linkedin:abc123',accountName:'QA Person',accessToken:'private-li-token',expiresAt:Date.now()+86400000,social:{platform:'linkedin',accountId:'abc123'}},KEY);
  publication(f,f.page,'job-fb','100_200','https://www.facebook.com/100_200');
  publication(f,f.x,'job-x','1800000000000000001','https://x.com/i/status/1800000000000000001');
  publication(f,f.member,'job-li','urn:li:share:7000','https://www.linkedin.com/feed/update/urn:li:share:7000');
  f.inbox=(http,scope=f.scope)=>new ProjectSocialInbox(f.db,scope,KEY,http);return f;
}
const run=fn=>async()=>{const saved={...process.env};const f=setup();try{await fn(f);}finally{f.db.close();for(const key of Object.keys(env))if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}};

test('X accounts and LinkedIn member profiles stay out of the inbox until their server switch is on',run(async f=>{
  const names=()=>f.inbox(fake({})).read().accounts.map(a=>a.name).sort();
  assert.deepEqual(plain(names()),['QA Page']);
  process.env.PLATFORM_X_INBOX_ENABLED='1';process.env.PLATFORM_LINKEDIN_MEMBER_COMMENTS_ENABLED='1';
  assert.deepEqual(plain(names()),['QA Page','QA Person','QA X']);
  const person=f.inbox(fake({})).read().accounts.find(a=>a.name==='QA Person');assert.equal(person.personal,true);assert.equal(person.messages,false);
}));
test('X replies: recent search by conversation, our own posts skipped, a reply goes in the thread after approval',run(async f=>{
  process.env.PLATFORM_X_INBOX_ENABLED='1';
  const http=fake({'/2/tweets/search/recent':ok({data:[
    {id:'1800000000000000002',text:'Kayıt nasıl? @ayse_k bana yazın',author_id:'42',conversation_id:'1800000000000000001',created_at:new Date(Date.now()-600000).toISOString()},
    {id:'1800000000000000003',text:'Bizim cevabımız',author_id:'1500',conversation_id:'1800000000000000001',created_at:new Date().toISOString()},
    {id:'1800000000000000004',text:'Başka konuşma',author_id:'43',conversation_id:'1799999999999999999',created_at:new Date().toISOString()}]}),
    '/2/tweets':{status:201,header:()=>null,payload:{data:{id:'1800000000000000009'}}}});
  const {added,snapshot}=await f.inbox(http).sync({connectionId:f.x.id});assert.equal(added,1);
  const search=http.calls.find(c=>c.path==='/2/tweets/search/recent');assert.equal(search.host,'api.x.com');assert.equal(search.query.get('query'),'conversation_id:1800000000000000001 -from:1500');assert.equal(search.token,'private-x-token');
  const item=snapshot.items.find(i=>i.platform==='twitter');assert.doesNotMatch(item.text,/ayse_k/,'handles are masked');
  assert.throws(()=>f.inbox(http).saveReply({id:item.id,expectedRevision:item.revision,reply:'x'.repeat(281)}),/280/);
  let saved=f.inbox(http).saveReply({id:item.id,expectedRevision:item.revision,reply:'Merhaba, kayıt sayfamızdan başvurabilirsiniz.'}).items.find(i=>i.id===item.id);
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';saved=(await f.inbox(http).send({id:saved.id,expectedRevision:saved.revision,acknowledged:true})).items.find(i=>i.id===item.id);
  assert.equal(saved.replyState,'sent');const post=http.calls.find(c=>c.method==='POST');assert.equal(post.path,'/2/tweets');
  assert.deepEqual(plain(post.json),{text:'Merhaba, kayıt sayfamızdan başvurabilirsiniz.',reply:{in_reply_to_tweet_id:'1800000000000000002'}});
  await assert.rejects(f.inbox(http).sync({connectionId:f.x.id},true),error=>error.status===409,'X is never read automatically');
  assert.throws(()=>f.inbox(http).setAutoRead({connectionId:f.x.id,autoRead:true}),error=>error.status===409);
}));
test('LinkedIn member profile comments: the person is the actor and their own comments are skipped',run(async f=>{
  process.env.PLATFORM_LINKEDIN_MEMBER_COMMENTS_ENABLED='1';
  const http=fake({'/comments':(request)=>request.method==='GET'?ok({elements:[
      {commentUrn:'urn:li:comment:(urn:li:share:7000,9001)',actor:'urn:li:person:zz9',message:{text:'Harika paylaşım, ne zaman başlıyor?'},created:{time:Date.now()-60000}},
      {commentUrn:'urn:li:comment:(urn:li:share:7000,9002)',actor:'urn:li:person:abc123',message:{text:'Kendi yorumum'},created:{time:Date.now()}}]})
    :{status:201,header:name=>name==='x-restli-id'?'urn:li:comment:(urn:li:share:7000,9100)':null,payload:{}}});
  const {added,snapshot}=await f.inbox(http).sync({connectionId:f.member.id});assert.equal(added,1);
  let item=snapshot.items.find(i=>i.platform==='linkedin');item=f.inbox(http).saveReply({id:item.id,expectedRevision:item.revision,reply:'Teşekkürler, 3 Kasım’da.'}).items.find(i=>i.id===item.id);
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';item=(await f.inbox(http).send({id:item.id,expectedRevision:item.revision,acknowledged:true})).items.find(i=>i.id===item.id);
  assert.equal(item.replyState,'sent');assert.equal(http.calls.find(c=>c.method==='POST').json.actor,'urn:li:person:abc123');
}));
test('automatic reading runs every 30 minutes as the person who turned it on and stops when that person loses the duty',run(async f=>{
  const http=fake({'/100_200/comments':ok({data:[{id:'200_1',message:'Soru',created_time:new Date().toISOString(),from:{id:'555'}}]}),'/100/conversations':ok({data:[]})});
  assert.equal(f.inbox(http).setAutoRead({connectionId:f.page.id,autoRead:true}).accounts.find(a=>a.id===f.page.id).autoRead,true);
  const usage=()=>f.db.prepare("SELECT COALESCE(SUM(count),0) n FROM platform_usage WHERE resource='inbox_sync'").get().n;
  assert.equal(await readDueInboxAccounts(f.db,KEY,http),1);assert.equal(usage(),0,'automatic reads do not use the manual daily limit');
  assert.equal(await readDueInboxAccounts(f.db,KEY,http),0,'not again within 30 minutes');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_audit WHERE operation='inbox.sync.auto'").get().n,1);
  f.db.prepare("UPDATE platform_social_inbox_accounts SET attempted_at='2000-01-01T00:00:00.000Z'").run();
  f.db.prepare('UPDATE platform_social_inbox_accounts SET manager_id=?').run('someone-without-duty');
  assert.equal(await readDueInboxAccounts(f.db,KEY,http),0);assert.equal(f.db.prepare('SELECT auto_read FROM platform_social_inbox_accounts').get().auto_read,0,'switched off');
}));
test('Meta webhook: signed events store comments on our own posts and inbound messages; unsigned or foreign events store nothing',run(async f=>{
  const events={object:'page',entry:[{id:'100',time:Math.floor(Date.now()/1000),
    changes:[{field:'feed',value:{item:'comment',verb:'add',comment_id:'200_7',post_id:'100_200',message:'Webhook yorumu, tel 0532 111 22 33',from:{id:'555'},created_time:Math.floor(Date.now()/1000)}},
      {field:'feed',value:{item:'comment',verb:'add',comment_id:'300_1',post_id:'100_300',message:'Başka gönderi',from:{id:'556'},created_time:Math.floor(Date.now()/1000)}},
      {field:'feed',value:{item:'comment',verb:'add',comment_id:'200_8',post_id:'100_200',message:'Sayfanın kendi yorumu',from:{id:'100'},created_time:Math.floor(Date.now()/1000)}}],
    messaging:[{sender:{id:'777'},recipient:{id:'100'},timestamp:Date.now(),message:{mid:'m_hook1',text:'Merhaba, bilgi alabilir miyim?'}},
      {sender:{id:'100'},recipient:{id:'777'},timestamp:Date.now(),message:{mid:'m_echo',text:'yanıt',is_echo:true}}]}]};
  const body=Buffer.from(JSON.stringify(events)),sign=secret=>`sha256=${createHmac('sha256',secret).update(body).digest('hex')}`;
  assert.throws(()=>receiveMetaInboxHook(f.db,KEY,body,sign(SECRET)),error=>error.status===404,'off until configured');
  assert.equal(verifyMetaInboxHook(new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':VERIFY,'hub.challenge':'abc'})),null);
  process.env.PLATFORM_META_APP_SECRET=SECRET;process.env.PLATFORM_META_WEBHOOK_VERIFY_TOKEN=VERIFY;
  assert.equal(verifyMetaInboxHook(new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':VERIFY,'hub.challenge':'abc'})),'abc');
  assert.equal(verifyMetaInboxHook(new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':'wrong_token_000000','hub.challenge':'abc'})),null);
  for(const bad of [null,'sha256=00',sign('another-secret')])assert.throws(()=>receiveMetaInboxHook(f.db,KEY,body,bad),error=>error.status===401);
  assert.equal(receiveMetaInboxHook(f.db,KEY,body,sign(SECRET)).stored,2);
  assert.equal(receiveMetaInboxHook(f.db,KEY,body,sign(SECRET)).stored,0,'the same event is stored once');
  const snapshot=f.inbox(fake({})).read(),texts=snapshot.items.map(i=>i.text);
  assert.equal(texts.length,2);assert.ok(texts.every(text=>!/0532/.test(text)));assert.ok(snapshot.accounts.find(a=>a.id===f.page.id).liveEventAt);
  assert.equal(snapshot.liveConfigured,true);
  assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM platform_social_inbox').all()),/"777"|"555"/,'sender ids are not stored in clear');
  // The message can be answered like a synced one: the reply goes to the encrypted sender id.
  const http=fake({'/100/messages':ok({recipient_id:'777',message_id:'mid.reply'}),'/subscribed_apps':ok({success:true})});
  let message=snapshot.items.find(i=>i.kind==='message');message=f.inbox(http).saveReply({id:message.id,expectedRevision:message.revision,reply:'Merhaba, tabii.'}).items.find(i=>i.id===message.id);
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';await f.inbox(http).send({id:message.id,expectedRevision:message.revision,acknowledged:true});
  assert.deepEqual(plain(http.calls.at(-1).json.recipient),{id:'777'});
  await f.inbox(http).subscribeLive({connectionId:f.page.id});const sub=http.calls.at(-1);assert.equal(sub.path,'/v25.0/100/subscribed_apps');assert.equal(sub.form.subscribed_fields,'feed,messages');assert.equal(sub.token,'private-page-token');
}));
test('turning on automatic reading or instant updates needs the reading duty and connection management',run(async f=>{
  const other={...f.scope,subject:'not-a-member'};
  assert.throws(()=>f.inbox(fake({}),other).setAutoRead({connectionId:f.page.id,autoRead:true}),error=>error.status===403);
}));
