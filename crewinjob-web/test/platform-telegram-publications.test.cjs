const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SocialPublications}=load('social-publications.ts'),{verifySocialConnection}=load('social-connection.ts'),{normalizeSocialConfiguration}=load('social-configuration.ts');
const TOKEN='123456789:AAFixtureTelegramTokenOnly_not_real_01';
const social={platform:'telegram',accountId:'@ryzevo_qa'};
// Disposable Bot API: answers by method name; every call is recorded so the test can check URLs and headers.
const botApi=(answers={})=>{const calls=[];const original=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{const href=String(url),method=href.split('/').pop();calls.push({href,method,options,body:options.body?JSON.parse(options.body):null});
    const answer=answers[method]??{getMe:{ok:true,result:{id:777,is_bot:true,username:'ryzevo_qa_bot'}},getChat:{ok:true,result:{id:-1001234567890,type:'channel',username:'ryzevo_qa'}},getChatMember:{ok:true,result:{status:'administrator',can_post_messages:true}},sendMessage:{ok:true,result:{message_id:42,chat:{id:-1001234567890,type:'channel',username:'ryzevo_qa'}}}}[method];
    if(answer instanceof Error)throw answer;if(typeof answer==='number')return new Response('{"ok":false}',{status:answer,headers:{'Content-Type':'application/json'}});
    return Response.json(answer);};
  return {calls,restore:()=>{globalThis.fetch=original;}};};
function setup(){
  const f=fixture();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';
  f.tg=f.store.saveConnection({provider:'social',integrationId:'telegram',accountName:'QA channel',accessToken:TOKEN,social},KEY);
  f.content={id:'tg-source',platform:'telegram',language:'tr',headline:'Telegram QA',content:'Yeni sürüm yayında. https://example.com/notes',timestamp:Date.now(),prompt:''};f.store.saveContent(f.content,true);
  f.service=new SocialPublications(f.db,f.scope,KEY);
  f.input=(patch={})=>({sourceKind:'content',sourceId:f.content.id,expectedDigest:f.service.workspace().sources.find(s=>s.id===f.content.id).digest,expectedTargetRevision:f.service.workspace().targets.find(t=>t.id===f.tg.id).revision,connectionId:f.tg.id,mode:'rehearsal',idempotencyKey:'telegram-fixture-intent',...patch});
  return f;
}
const run=async fn=>{const f=setup();try{await fn(f);}finally{f.db.close();process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='0';}};

test('Telegram channels are addressed by @username or -100 id; the bot and channel are verified without auth headers',async()=>{
  assert.equal(normalizeSocialConfiguration({platform:'telegram',accountId:'@ryzevo_qa'}).accountId,'@ryzevo_qa');
  assert.equal(normalizeSocialConfiguration({platform:'telegram',accountId:'-1001234567890'}).accountId,'-1001234567890');
  for(const bad of ['12345','@ab','ryzevo_qa','-100abc'])assert.throws(()=>normalizeSocialConfiguration({platform:'telegram',accountId:bad}),bad);
  const api=botApi();try{
    const result=await verifySocialConnection(social,TOKEN);assert.equal(result.status,'verified');
    assert.deepEqual(api.calls.map(call=>call.method),['getMe','getChat']);
    for(const call of api.calls){assert.match(call.href,/^https:\/\/api\.telegram\.org\/bot/);assert.equal(call.options.redirect,'error');assert.equal(new Headers(call.options.headers).get('Authorization'),null);}
  }finally{api.restore();}
  const group=botApi({getChat:{ok:true,result:{id:-200,type:'supergroup'}}});try{assert.equal((await verifySocialConnection(social,TOKEN)).status,'failed','groups are not publishing targets');}finally{group.restore();}
  const wrong=botApi();try{assert.equal((await verifySocialConnection(social,'not-a-token')).status,'failed');assert.equal(wrong.calls.length,0,'a malformed token is never sent');}finally{wrong.restore();}
});
test('Telegram sources allow 4096 characters of text and no media; rehearsal never contacts Telegram',()=>run(async f=>{
  const api=botApi({sendMessage:new Error('Rehearsal contacted Telegram')});
  try{const job=f.service.enqueue(f.input());await f.service.process(job.id);assert.equal(f.service.get(job.id).state,'rehearsed');assert.equal(api.calls.length,0);}finally{api.restore();}
  for(const patch of [{content:'x'.repeat(4097)},{imageData:'image'},{content:'{{firstName}}'}]){f.store.saveContent({...f.content,...patch},false);assert.equal(f.service.workspace().sources.find(s=>s.id===f.content.id).eligible,false);}
  f.store.saveContent({...f.content,content:'x'.repeat(4096)},false);assert.equal(f.service.workspace().sources.find(s=>s.id===f.content.id).eligible,true);
  assert.doesNotMatch(JSON.stringify(f.service.workspace()),/AAFixtureTelegram/,'the bot token never reaches the browser');
}));
test('publishing needs the switch, an admin bot with post rights and acknowledgement; the post link is the channel message',()=>run(async f=>{
  assert.throws(()=>f.service.enqueue(f.input({mode:'publish',acknowledged:true})),e=>e.status===409,'switch off');
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';
  const member=botApi({getChatMember:{ok:true,result:{status:'administrator',can_post_messages:false}}});
  try{await assert.rejects(f.service.check(f.tg.id),e=>e.status===409&&/Telegram yayın izni/.test(e.message));}finally{member.restore();}
  const api=botApi();
  try{
    await f.service.check(f.tg.id);const job=f.service.enqueue(f.input({mode:'publish',acknowledged:true,idempotencyKey:'telegram-publish-1'}));await f.service.process(job.id);
    const done=f.service.get(job.id);assert.equal(done.state,'accepted');assert.equal(done.providerPostId,'-1001234567890:42');assert.equal(done.providerUrl,'https://t.me/ryzevo_qa/42');assert.equal(done.engagement.status,'unsupported');
    const send=api.calls.find(call=>call.method==='sendMessage');assert.deepEqual(send.body,{chat_id:'@ryzevo_qa',text:f.content.content});
    assert.throws(()=>f.service.enqueue(f.input({mode:'publish',acknowledged:true,idempotencyKey:'telegram-publish-2'})),e=>e.status===409,'the same text is not posted twice');
  }finally{api.restore();}
  const audit=JSON.stringify(f.db.prepare('SELECT * FROM platform_audit').all())+JSON.stringify(f.db.prepare('SELECT * FROM platform_social_publications').all());assert.doesNotMatch(audit,/AAFixtureTelegram/,'the token is stored only encrypted');
}));
test('a non-owner needs the publish messaging duty, checked again when the queued job runs',()=>run(async f=>{
  const {ProjectMessaging}=load('messaging-sources.ts'),admin={...f.scope,subject:f.repo.addMember(f.scope.subject,f.scope.organizationId,f.scope.projectId,{username:'telegram-admin',password:'fixture-password-123',role:'admin'}).userId};
  const asAdmin=new SocialPublications(f.db,admin,KEY),owner=new ProjectMessaging(f.db,f.scope,KEY);process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';
  const api=botApi();
  try{
    await asAdmin.check(f.tg.id);
    assert.throws(()=>asAdmin.enqueue(f.input({mode:'publish',acknowledged:true,idempotencyKey:'telegram-duty-1'})),e=>e.status===403,'without the duty an admin cannot publish');
    assert.ok(asAdmin.enqueue(f.input({idempotencyKey:'telegram-duty-rehearsal'})).id,'rehearsal stays open');
    owner.setDuty({userId:admin.subject,duty:'publish',granted:true});
    const job=asAdmin.enqueue(f.input({mode:'publish',acknowledged:true,idempotencyKey:'telegram-duty-2'}));
    owner.setDuty({userId:admin.subject,duty:'publish',granted:false});await asAdmin.process(job.id);
    assert.notEqual(asAdmin.get(job.id).state,'accepted');assert.equal(api.calls.some(call=>call.method==='sendMessage'),false,'a duty taken away while queued stops the post');
  }finally{api.restore();}
}));
test('Telegram refusals and network failures are recorded as rejected or uncertain, never as success',()=>run(async f=>{
  process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED='1';
  for(const [answer,state] of [[403,'rejected'],[new Error('network'),'uncertain']]){
    const proof=botApi();try{await f.service.check(f.tg.id);}finally{proof.restore();}
    f.store.saveContent({...f.content,content:`Deneme ${state}`},false);
    const api=botApi({sendMessage:answer});try{const job=f.service.enqueue(f.input({mode:'publish',acknowledged:true,idempotencyKey:`telegram-${state}`}));await f.service.process(job.id);assert.equal(f.service.get(job.id).state,state);assert.equal(f.service.get(job.id).providerUrl,null);}finally{api.restore();}
  }
}));
test('schema43 keeps existing social accounts and is repeatable',async()=>{
  const f=fixture();try{
    f.store.saveConnection({provider:'social',integrationId:'li',accountName:'LinkedIn',accessToken:'other',social:{platform:'linkedin',accountId:'user'}},KEY);
    const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'telegram-')),'fixture.sqlite');
    await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeTelegramSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,42);
    assert.throws(()=>db.prepare("INSERT INTO platform_social_accounts(connection_id,platform,account_id) VALUES('x','telegram','@abcdef')").run(),/CHECK|FOREIGN/);db.close();
    db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,53);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_social_accounts').get().n,1);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
  }finally{f.db.close();}
});
