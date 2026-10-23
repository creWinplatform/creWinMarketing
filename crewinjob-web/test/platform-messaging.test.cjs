const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {ProjectMessaging,readDueMessagingSources,maskPersonal,matchTopics,copiesSource}=load('messaging-sources.ts');
const {hasMessagingDuty}=load('messaging-duties.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const {readTelegramPosts,TelegramReadError}=load('telegram-publishing.ts');
const KEY='34'.repeat(32),TOKEN='123456789:AAFixtureTelegramTokenOnly_not_real_01';
// Disposable reader: answers like the Bot API would, and records each call. No network is used.
const fakeReader=(posts=[])=>{const calls=[];return {calls,source:async(token,channel)=>{calls.push(['source',channel]);if(channel==='@group_chat')throw new Error('Not a channel.');return {chatId:channel==='@ryzevo_news'?'-1001111111111':'-1002222222222',title:channel==='@ryzevo_news'?'Ryzevo News':'Other',username:channel.slice(1)};},
  posts:async(token,offset)=>{calls.push(['posts',offset]);assert.equal(token,TOKEN);return {posts:posts.filter(post=>post.updateId>=offset),nextOffset:Math.max(offset,...posts.map(post=>post.updateId+1))};}};};
const setup=f=>{f.bot=new ProjectMarketingStore(f.db,f.scope).saveConnection({provider:'social',integrationId:'telegram',accountName:'QA bot',accessToken:TOKEN,social:{platform:'telegram',accountId:'@ryzevo_out'}},KEY);return f;};
const post=(updateId,messageId,text,chatId='-1001111111111')=>({updateId,chatId,messageId,date:Math.floor(Date.now()/1000)-60,text});

test('contact details are masked and topics come from the team’s own dictionary',()=>{
  const masked=maskPersonal('Yaz ali.veli@example.com ya da ara +90 532 123 45 67, @ayse_k sorumlu. Site: https://example.com/@path');
  assert.doesNotMatch(masked,/example\.com ya|532|ayse_k/);assert.match(masked,/https:\/\/example\.com\/@path/,'links stay');
  const dictionary=[{id:'denizcilik',label:'Denizcilik',terms:['gemi','liman']},{id:'egitim',label:'Eğitim',terms:['KURS']}];
  assert.deepEqual(plain(matchTopics('Yeni LİMAN projesi ve kurs duyurusu',dictionary)),['denizcilik','egitim']);assert.deepEqual(plain(matchTopics('Hava durumu',dictionary)),[]);
});
test('Bot API reading keeps only channel posts and never author fields',async()=>{
  const original=globalThis.fetch,bodies=[];
  globalThis.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));assert.match(String(url),/^https:\/\/api\.telegram\.org\/bot\d+:[^/]+\/getUpdates$/);assert.equal(options.redirect,'error');
    return Response.json({ok:true,result:[{update_id:5,channel_post:{message_id:9,date:1760000000,chat:{id:-1001111111111,type:'channel',title:'News'},author_signature:'Ayşe K.',text:'Merhaba'}},{update_id:6,message:{message_id:1,date:1760000000,chat:{id:42,type:'private'},from:{id:42,first_name:'Private'},text:'secret'}}]});};
  try{
    const result=await readTelegramPosts(TOKEN,0);
    assert.deepEqual(plain(result.posts),[{updateId:5,chatId:'-1001111111111',messageId:9,date:1760000000,text:'Merhaba'}]);assert.equal(result.nextOffset,7,'private updates are skipped but confirmed');
    assert.deepEqual(plain(bodies[0].allowed_updates),['channel_post']);assert.doesNotMatch(JSON.stringify(result),/Ayşe|secret|Private/);
    globalThis.fetch=async()=>new Response('{"ok":false}',{status:409});await assert.rejects(readTelegramPosts(TOKEN,0),error=>error instanceof TelegramReadError&&error.code==='webhook');
  }finally{globalThis.fetch=original;}
});
test('sources, reading, suggestions and drafts follow separate duties',coachRun(async f=>{
  setup(f);const reader=fakeReader([post(10,100,'Yeni gemi siparişi: bilgi@firma.com'),post(11,101,'Başka bir kanal','-1009999999999'),post(12,102,'Liman yatırımı')]);
  const owner=new ProjectMessaging(f.db,f.scope,KEY,reader);
  assert.equal(owner.read().me.publish,true,'owners hold every duty they are eligible for');
  await assert.rejects(owner.addSource({connectionId:f.bot.id,channel:'@group_chat'}),error=>error.status===409,'groups and unverifiable chats are refused');
  let snapshot=await owner.addSource({connectionId:f.bot.id,channel:'@ryzevo_news'});assert.equal(snapshot.sources[0].title,'Ryzevo News');
  await assert.rejects(owner.addSource({connectionId:f.bot.id,channel:'@ryzevo_news'}),error=>error.status===409);
  owner.saveDictionary({dictionary:[{id:'denizcilik',label:'Denizcilik',terms:['gemi','liman']}],expectedRevision:0});
  const read=await owner.readNow();assert.equal(read.added,2,'posts from chats that are not sources are skipped');
  assert.deepEqual(plain(read.snapshot.posts.map(item=>item.text).sort()),['Liman yatırımı','Yeni gemi siparişi: […]']);assert.ok(read.snapshot.posts.every(item=>item.topics[0]==='denizcilik'));
  assert.equal(read.snapshot.posts[0].link.startsWith('https://t.me/ryzevo_news/'),true);
  assert.equal((await owner.readNow()).added,0,'the offset moves on and posts are never stored twice');
  assert.deepEqual(plain(reader.calls.filter(call=>call[0]==='posts').map(call=>call[1])),[0,13]);

  const editor=f.member('editor'),asEditor=new ProjectMessaging(f.db,editor,KEY,reader);
  assert.equal(asEditor.read().posts.length,0,'without the reading duty no post text is shown');assert.equal(asEditor.read().sources.length,1);
  await assert.rejects(asEditor.readNow(),error=>error.status===403);
  assert.throws(()=>owner.setDuty({userId:editor.subject,duty:'publish',granted:true}),error=>error.status===403,'publishing needs full social publishing rights');
  owner.setDuty({userId:editor.subject,duty:'source.read',granted:true});
  const target=asEditor.read().posts.find(item=>item.text==='Liman yatırımı');assert.ok(target);
  assert.throws(()=>asEditor.suggest({id:target.id,expectedRevision:target.revision,suggestion:'Liman yatırımları üzerine kendi yorumumuz.'}),error=>error.status===403,'reading does not include suggesting');
  owner.setDuty({userId:editor.subject,duty:'suggest',granted:true});
  assert.throws(()=>asEditor.suggest({id:target.id,expectedRevision:target.revision+1,suggestion:'x'}),error=>error.status===409);
  snapshot=asEditor.suggest({id:target.id,expectedRevision:target.revision,suggestion:'Liman yatırımları üzerine kendi yorumumuz.',draft:true});
  const suggested=snapshot.posts.find(item=>item.id===target.id);assert.equal(suggested.state,'suggested');assert.ok(suggested.contentId);
  const draft=new ProjectMarketingStore(f.db,f.scope).history().find(item=>item.id===suggested.contentId);
  assert.equal(draft.platform,'telegram');assert.equal(draft.content,'Liman yatırımları üzerine kendi yorumumuz.','the draft is the team’s text, not the source post');assert.match(draft.prompt,/t\.me\/ryzevo_news/);
  const viewer=f.member('viewer');assert.throws(()=>owner.setDuty({userId:viewer.subject,duty:'suggest',granted:true}),error=>error.status===403);
  assert.throws(()=>asEditor.setDuty({userId:editor.subject,duty:'publish',granted:true}),error=>error.status===403,'only member managers give duties');
  assert.equal(new ProjectMessaging(f.db,f.other,KEY,reader).read().sources.length,0,'other projects see nothing');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_audit WHERE operation LIKE 'messaging.%'").get().n,5,'source, dictionary, two duties and the draft are audited');
}));
test('automatic reading runs as the person who enabled it and stops when that duty is taken away',coachRun(async f=>{
  setup(f);const reader=fakeReader([post(1,1,'Gemi')]),owner=new ProjectMessaging(f.db,f.scope,KEY,reader);
  let snapshot=await owner.addSource({connectionId:f.bot.id,channel:'@ryzevo_news'});
  const admin=f.member('admin');owner.setDuty({userId:admin.subject,duty:'source.read',granted:true});
  snapshot=new ProjectMessaging(f.db,admin,KEY,reader).setAutoRead({id:snapshot.sources[0].id,expectedRevision:snapshot.sources[0].revision,autoRead:true});assert.equal(snapshot.sources[0].autoRead,true);
  assert.equal(await readDueMessagingSources(f.db,KEY,reader),1);assert.equal(await readDueMessagingSources(f.db,KEY,reader),0,'read at most every 30 minutes');
  assert.equal(owner.read().counts.new,1);
  owner.setDuty({userId:admin.subject,duty:'source.read',granted:false});assert.equal(owner.read().sources[0].autoRead,false,'taking the duty away stops automatic reading');
  assert.equal(hasMessagingDuty(f.db,admin.subject,f.scope.organizationId,f.scope.projectId,'source.read'),false);
}));
test('AI suggestions are original, go only to the team’s text box and refund the AI quota when refused',coachRun(async f=>{
  setup(f);const reader=fakeReader([post(1,1,'Mersin limanında konteyner hacmi bu çeyrekte yüzde on iki arttı ve yeni rıhtım açıldı.')]),owner=new ProjectMessaging(f.db,f.scope,KEY,reader);
  await owner.addSource({connectionId:f.bot.id,channel:'@ryzevo_news'});await owner.readNow();const target=owner.read().posts[0];
  assert.equal(copiesSource('Bugün Mersin limanında konteyner hacmi bu çeyrekte çok arttı',target.text),true);assert.equal(copiesSource('Liman hacmi artınca lojistik planlaması nasıl değişir?',target.text),false);
  await assert.rejects(owner.aiSuggest({id:target.id}),error=>error.status===503,'no provider, no AI');
  const before=f.aiUsage();
  for(const bad of ['{"post":"Mersin limanında konteyner hacmi bu çeyrekte yüzde on iki arttı!"}','{"post":"Bilgi için ali@example.com adresine yazın."}','not json'])
    await assert.rejects(owner.aiSuggest({id:target.id},async()=>bad),error=>error.status===422||error.status===502,bad);
  assert.equal(f.aiUsage(),before,'refused answers refund the quota');assert.equal(f.reserved(),0);
  const prompts=[],result=await owner.aiSuggest({id:target.id},async prompt=>{prompts.push(prompt);return '{"post":"Liman hacmi artınca lojistik planlaması nasıl değişir? Müşterilerimizle bu hafta kısa bir kontrol listesi paylaşıyoruz."}';});
  assert.match(result.suggestion,/kontrol listesi/);assert.equal(f.aiUsage(),before+1);assert.match(prompts[0],/inspiration only/);
  assert.equal(owner.read().posts[0].state,'new','nothing is saved until a person saves it');
  const viewer=f.member('viewer');await assert.rejects(new ProjectMessaging(f.db,viewer,KEY,reader).aiSuggest({id:target.id},async()=>'{}'),error=>error.status===403);
}));
test('schema46 is additive and repeatable',coachRun(async f=>{
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'messaging-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeMessagingSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,45);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,56);assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='platform_messaging_posts'").get());db.close();
}));
