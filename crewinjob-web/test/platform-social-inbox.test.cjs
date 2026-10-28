const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {ProjectSocialInbox,inboxHttp}=load('social-inbox.ts'),{ProjectMessaging}=load('messaging-sources.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
// Disposable Graph / LinkedIn API: answers by path, records every request. No network is used.
const fake=(overrides={})=>{const calls=[];const fn=async request=>{const url=new URL(request.url);calls.push({...request,path:url.pathname,search:url.search});
  for(const [match,answer] of Object.entries(overrides))if(url.pathname.includes(match)){if(answer instanceof Error)throw answer;return typeof answer==='function'?answer(request):answer;}
  if(url.pathname.endsWith('/100_200/comments'))return {status:200,header:()=>null,payload:{data:[
    {id:'200_1',message:'Kurs ne zaman başlıyor? Bana ayse@example.com adresinden dönün.',created_time:new Date(Date.now()-3600000).toISOString(),from:{id:'555',name:'Ayşe Kaya'}},
    {id:'200_2',message:'Teşekkürler!',created_time:new Date().toISOString(),from:{id:'100',name:'Our Page'}}]}};
  if(url.pathname.endsWith('/100/conversations'))return {status:200,header:()=>null,payload:{data:[
    {id:'t_1',messages:{data:[{id:'m_2',message:'Fiyat nedir?',from:{id:'777',name:'Mehmet'},created_time:new Date(Date.now()-7200000).toISOString()}]}},
    {id:'t_2',messages:{data:[{id:'m_9',message:'Eski soru',from:{id:'888'},created_time:new Date(Date.now()-30*3600000).toISOString()}]}}]}};
  if(url.pathname.endsWith('/200_1/comments'))return {status:200,header:()=>null,payload:{id:'200_99'}};
  if(url.pathname.endsWith('/100/messages'))return {status:200,header:()=>null,payload:{recipient_id:'777',message_id:'mid.reply1'}};
  return {status:404,header:()=>null,payload:{}};};fn.calls=calls;return fn;};
function setup(){
  Object.assign(process.env,{PLATFORM_META_GRAPH_VERSION:'v25.0',PLATFORM_SOCIAL_PUBLISH_ENABLED:'0'});const f=fixture();
  f.page=f.store.saveConnection({provider:'social',integrationId:'facebook:100',accountName:'QA Page',accessToken:'private-page-token',expiresAt:Date.now()+86400000,social:{platform:'facebook',accountId:'100',graphVersion:'v25.0'}},KEY,{appId:'12345',userAccessToken:'private-user-token'});
  const now=new Date().toISOString();
  f.db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES('job-1',?,?,?,?,'r','social:k1','completed',?,?,'social.publish')").run(f.scope.organizationId,f.scope.projectId,f.scope.subject,f.page.id,now,now);
  f.db.prepare("INSERT INTO platform_social_publications(job_id,organization_id,project_id,source_kind,source_id,source_digest,body_digest,encrypted_snapshot,mode,scheduled_at,timezone,configuration_revision,state,submitted_at,provider_post_id,provider_url) VALUES('job-1',?,?,'content','c1','d','b','x','publish',?,'UTC','cfg','accepted',?,'100_200','https://www.facebook.com/100_200')").run(f.scope.organizationId,f.scope.projectId,now,now);
  f.http=fake();f.inbox=(scope=f.scope,http=f.http)=>new ProjectSocialInbox(f.db,scope,KEY,http);return f;
}
const run=fn=>async()=>{const f=setup();try{await fn(f);}finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}};

test('the inbox client reaches only Meta and LinkedIn, with the token in the header',async()=>{
  for(const url of ['https://evil.example/x','https://graph.facebook.com/v25.0/1?access_token=x'])await assert.rejects(inboxHttp({method:'GET',url,token:'t'}),url);
});
test('comments under our own posts and recent messages are read with masked text and hashed authors',run(async f=>{
  const result=await f.inbox().sync({connectionId:f.page.id});assert.equal(result.added,3,'our own reply is skipped');
  const items=result.snapshot.items;assert.ok(items.every(item=>!/ayse@example|Ayşe Kaya|Mehmet/.test(item.text)));
  const comment=items.find(item=>item.kind==='comment');assert.match(comment.text,/\[…\]/,'the email address is masked');assert.equal(comment.postUrl,'https://www.facebook.com/100_200');
  assert.equal(items.find(item=>item.text==='Eski soru').windowOpen,false,'a message older than 24 hours is outside the window');
  assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM platform_social_inbox').all()),/"(555|777)"|Ayşe|Mehmet|ayse@/,'no names, sender ids or contact details are stored in clear');
  assert.equal((await f.inbox().sync({connectionId:f.page.id})).added,0,'nothing is stored twice');
  assert.ok(f.http.calls.every(call=>call.token==='private-page-token'));
  const editor=f.repo.addMember(f.scope.subject,f.scope.organizationId,f.scope.projectId,{username:'inbox-editor',password:'fixture-password-123',role:'editor'}).userId;
  assert.equal(f.inbox({...f.scope,subject:editor}).read().items.length,0,'without the reading duty nothing is shown');
}));
test('replies are drafted, then sent once with the publish duty, the switch and acknowledgement',run(async f=>{
  let snapshot=(await f.inbox().sync({connectionId:f.page.id})).snapshot;const comment=snapshot.items.find(item=>item.kind==='comment'),message=snapshot.items.find(item=>item.text==='Fiyat nedir?'),old=snapshot.items.find(item=>item.text==='Eski soru');
  assert.throws(()=>f.inbox().saveReply({id:comment.id,expectedRevision:comment.revision,reply:'Bize 0532 111 22 33 numaradan ulaşın'}),/telefon/);
  snapshot=f.inbox().saveReply({id:comment.id,expectedRevision:comment.revision,reply:'Yeni dönem 3 Kasım’da başlıyor; ayrıntıları özel mesajla paylaşabiliriz.'});let current=snapshot.items.find(item=>item.id===comment.id);
  await assert.rejects(f.inbox().send({id:current.id,expectedRevision:current.revision,acknowledged:true}),error=>error.status===409,'the switch is off');
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';
  const admin=f.repo.addMember(f.scope.subject,f.scope.organizationId,f.scope.projectId,{username:'inbox-admin',password:'fixture-password-123',role:'admin'}).userId;
  await assert.rejects(f.inbox({...f.scope,subject:admin}).send({id:current.id,expectedRevision:current.revision,acknowledged:true}),error=>error.status===403,'an admin without the publish duty cannot send');
  snapshot=await f.inbox().send({id:current.id,expectedRevision:current.revision,acknowledged:true});current=snapshot.items.find(item=>item.id===comment.id);
  assert.equal(current.replyState,'sent');assert.equal(current.state,'replied');
  const sent=f.http.calls.find(call=>call.path.endsWith('/200_1/comments'));assert.equal(sent.form.message,'Yeni dönem 3 Kasım’da başlıyor; ayrıntıları özel mesajla paylaşabiliriz.');
  await assert.rejects(f.inbox().send({id:current.id,expectedRevision:current.revision,acknowledged:true}),error=>error.status===409,'a reply is sent once');
  let m=f.inbox().saveReply({id:message.id,expectedRevision:message.revision,reply:'Fiyatı web sitemizdeki sayfada bulabilirsiniz.'}).items.find(item=>item.id===message.id);
  snapshot=await f.inbox().send({id:m.id,expectedRevision:m.revision,acknowledged:true});assert.equal(snapshot.items.find(item=>item.id===message.id).replyState,'sent');
  const dm=f.http.calls.find(call=>call.path.endsWith('/100/messages'));assert.deepEqual(plain(dm.json),{recipient:{id:'777'},messaging_type:'RESPONSE',message:{text:'Fiyatı web sitemizdeki sayfada bulabilirsiniz.'}});
  const o=f.inbox().saveReply({id:old.id,expectedRevision:old.revision,reply:'Merhaba'}).items.find(item=>item.id===old.id);
  await assert.rejects(f.inbox().send({id:o.id,expectedRevision:o.revision,acknowledged:true}),/24 saat/,'the 24-hour window is enforced');
  assert.ok(f.db.prepare("SELECT COUNT(*) n FROM platform_audit WHERE operation LIKE 'inbox.%'").get().n>=5);
}));
test('an unclear send outcome is recorded as uncertain and never repeated',run(async f=>{
  const snapshot=(await f.inbox().sync({connectionId:f.page.id})).snapshot,message=snapshot.items.find(item=>item.text==='Fiyat nedir?');
  const m=f.inbox().saveReply({id:message.id,expectedRevision:message.revision,reply:'Merhaba, yardımcı olalım.'}).items.find(item=>item.id===message.id);
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';const broken=fake({'/100/messages':new Error('connection reset')});
  const after=(await f.inbox(f.scope,broken).send({id:m.id,expectedRevision:m.revision,acknowledged:true})).items.find(item=>item.id===message.id);
  assert.equal(after.replyState,'uncertain');await assert.rejects(f.inbox(f.scope,broken).send({id:after.id,expectedRevision:after.revision,acknowledged:true}),error=>error.status===409);
  assert.equal(broken.calls.filter(call=>call.path.endsWith('/messages')).length,1);
}));
test('AI drafts a reply into the box only and refuses links or contact details',run(async f=>{
  const snapshot=(await f.inbox().sync({connectionId:f.page.id})).snapshot,item=snapshot.items[0];
  await assert.rejects(f.inbox().aiReply({id:item.id},async()=>'{"reply":"Bilgi için https://example.com adresine bakın"}'),error=>error.status===422);
  const result=await f.inbox().aiReply({id:item.id},async()=>'{"reply":"Merhaba, sorunuz için teşekkürler. Ayrıntıları özel mesajla paylaşabiliriz."}');
  assert.match(result.reply,/teşekkürler/);assert.equal(result.snapshot.items.find(row=>row.id===item.id).reply,'','nothing is saved by the AI');
}));
test('schema51 is additive and repeatable',async()=>{
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'inbox-')),'fixture.sqlite');
  let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeInboxSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,50);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,64);db.close();
});
