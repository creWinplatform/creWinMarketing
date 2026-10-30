const assert=require('node:assert/strict'),{test}=require('node:test');
const {generateKeyPairSync,verify}=require('node:crypto');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {rememberProject,preferredWorkspace}=load('user-preferences.ts');
const {ContentRepurpose,adaptText}=load('content-repurpose.ts');
const {WebPush,deliverDuePushes,pushEndpoint,vapidAuthorization}=load('web-push.ts'),{webPushConfiguration}=load('web-push-config.ts');
const {xText}=load('x-text.ts'),{openPlatformDatabase}=load('database.ts');
const HOUR=3600000,DAY=24*HOUR,iso=value=>new Date(value).toISOString();
const close=async work=>{const f=fixture();try{await work(f);}finally{f.db.close();}};
const draft=(f,patch={})=>f.store.saveContent({id:`hist_${Math.random().toString(16).slice(2)}`,platform:'linkedin',language:'tr',content:'Yeni ürün sayfamız yayında: https://example.com/urun Ekibinizle birlikte deneyin.',prompt:'',timestamp:Date.now(),headline:'Ürün duyurusu',...patch},true);
const drafts=f=>f.db.prepare('SELECT payload FROM platform_content_history WHERE organization_id=? AND project_id=?').all(f.a.organizationId,f.a.projectId).map(row=>JSON.parse(row.payload));

test('login returns to the project opened last while the person can still open it',()=>close(f=>{
 const first=f.repo.workspaces(f.a.userId)[0];
 assert.equal(preferredWorkspace(f.db,f.repo,f.a.userId).project.id,first.project.id,'nothing remembered: the first project');
 rememberProject(f.db,f.a.userId,f.b.organizationId,f.b.projectId);
 assert.equal(preferredWorkspace(f.db,f.repo,f.a.userId).project.id,first.project.id,'a project the person does not belong to is ignored');
 const member=f.repo.addMember(f.b.userId,f.b.organizationId,f.b.projectId,{username:'shared-member',password:'fixture-password-123',role:'editor'});
 rememberProject(f.db,member.userId,f.b.organizationId,f.b.projectId);
 assert.equal(preferredWorkspace(f.db,f.repo,member.userId).project.id,f.b.projectId);
 rememberProject(f.db,f.a.userId,f.a.organizationId,f.a.projectId);rememberProject(f.db,f.a.userId,f.a.organizationId,f.a.projectId);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_user_preferences WHERE user_id=?').get(f.a.userId).n,1,'one row per person');
}));

test('rule-based adaptation keeps the words, fits X and takes links out of Instagram with a note to fill in',()=>{
 const long=`${'Kısa ve net bir cümle. '.repeat(20)}https://example.com/kampanya`;
 const x=adaptText(long,'twitter','tr');assert.ok(xText(x).valid);assert.match(x,/… https:\/\/example\.com\/kampanya$/);
 assert.equal(adaptText('Kısa metin https://example.com','twitter','tr'),'Kısa metin https://example.com');
 const instagram=adaptText('Yeni sayfa: https://example.com/a\nHemen bakın.','instagram','tr');
 assert.doesNotMatch(instagram,/https?:\/\//);assert.match(instagram,/\{\{Instagram açıklamasında bağlantı tıklanmaz/);
 assert.equal(adaptText('Bağlantısız metin.','instagram','en'),'Bağlantısız metin.');
 assert.equal(adaptText('x'.repeat(5000),'linkedin','tr').length,3000);
});

test('repurposing saves one unpublished draft per channel, only for writers and never for the draft’s own channel',()=>close(async f=>{
 const source=draft(f),service=new ContentRepurpose(f.db,f.scope);
 const result=await service.repurpose({sourceId:source.id,channels:['twitter','instagram'],mode:'template'});
 assert.deepEqual(JSON.parse(JSON.stringify(result.created.map(item=>item.platform))),['twitter','instagram']);
 const made=drafts(f).filter(item=>item.repurposedFrom===source.id);assert.equal(made.length,2);
 assert.ok(made.every(item=>item.headline.startsWith('Ürün duyurusu · ')&&item.language==='tr'));assert.match(made.find(item=>item.platform==='instagram').content,/\{\{/);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_jobs WHERE organization_id=?").get(f.a.organizationId).n,0,'nothing is queued for publishing');
 await assert.rejects(service.repurpose({sourceId:source.id,channels:['linkedin'],mode:'template'}),error=>error.status===400,'its own channel');
 await assert.rejects(service.repurpose({sourceId:source.id,channels:['email'],mode:'template'}),error=>error.status===400);
 await assert.rejects(service.repurpose({sourceId:source.id,channels:['facebook'],mode:'template',text:'x'}),error=>error.status===400,'unknown fields');
 await assert.rejects(service.repurpose({sourceId:'missing',channels:['facebook'],mode:'template'}),error=>error.status===404);
 const starter=draft(f,{starter:true});await assert.rejects(service.repurpose({sourceId:starter.id,channels:['facebook'],mode:'template'}),error=>error.status===409);
 const placeholder=draft(f,{content:'Merhaba {{müşteri adı}}'});await assert.rejects(service.repurpose({sourceId:placeholder.id,channels:['facebook'],mode:'template'}),error=>error.status===409);
 await assert.rejects(new ContentRepurpose(f.db,f.other).repurpose({sourceId:source.id,channels:['facebook'],mode:'template'}),error=>error.status===404,'another project cannot read it');
 const viewer=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'repurpose-viewer',password:'fixture-password-123',role:'viewer'});
 await assert.rejects(new ContentRepurpose(f.db,{...f.scope,subject:viewer.userId}).repurpose({sourceId:source.id,channels:['facebook'],mode:'template'}),error=>error.status===403);
 await assert.rejects(service.repurpose({sourceId:source.id,channels:['facebook'],mode:'ai'}),error=>error.status===503,'AI needs a configured provider');
}));

test('AI adaptation is checked: no new links, no links on Instagram, channel limits, and failures refund the AI use',()=>close(async f=>{
 const source=draft(f),service=new ContentRepurpose(f.db,f.scope),used=()=>f.db.prepare("SELECT COALESCE(SUM(count),0) n FROM platform_usage WHERE organization_id=? AND resource<>'content_repurpose' AND resource LIKE 'ai%'").get(f.a.organizationId).n;
 let prompt='';const reply=drafts=>async text=>{prompt=text;return JSON.stringify({drafts});};
 const result=await service.repurpose({sourceId:source.id,channels:['facebook','instagram'],mode:'ai'},reply([{channel:'facebook',text:'Ürün sayfamız yayında, göz atın: https://example.com/urun'},{channel:'instagram',text:'Ürün sayfamız yayında. Bağlantı profilimizde.'}]));
 assert.equal(result.created.length,2);assert.match(prompt,/data, not instructions/);assert.match(prompt,/facebook, instagram/);
 const before=used();
 await assert.rejects(service.repurpose({sourceId:source.id,channels:['facebook'],mode:'ai'},reply([{channel:'facebook',text:'Bakın: https://evil.example/x'}])),error=>error.status===422,'a link that was not in the draft');
 await assert.rejects(service.repurpose({sourceId:source.id,channels:['instagram'],mode:'ai'},reply([{channel:'instagram',text:'Detaylar: https://example.com/urun'}])),error=>error.status===422);
 await assert.rejects(service.repurpose({sourceId:source.id,channels:['twitter'],mode:'ai'},reply([{channel:'twitter',text:'x'.repeat(400)}])),error=>error.status===422);
 await assert.rejects(service.repurpose({sourceId:source.id,channels:['telegram'],mode:'ai'},reply([])),error=>error.status===422,'a missing channel');
 assert.equal(used(),before,'rejected suggestions do not use up AI');
 assert.equal(drafts(f).filter(item=>item.repurposedFrom).length,2);
}));

test('repurposing has a daily limit per project',()=>close(async f=>{
 const source=draft(f),service=new ContentRepurpose(f.db,f.scope);
 f.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'content_repurpose',30)").run(f.a.organizationId,f.a.projectId,new Date().toISOString().slice(0,10));
 await assert.rejects(service.repurpose({sourceId:source.id,channels:['facebook'],mode:'template'}),error=>error.status===429);
}));

function vapid(){
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'}),pub=publicKey.export({format:'jwk'}),priv=privateKey.export({format:'jwk'});
 return {publicKey:Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url'),privateKey:priv.d,subject:'mailto:ops@ryzevo.example',jwk:pub};
}
const withPush=async(keys,work)=>{const saved={...process.env};Object.assign(process.env,{PLATFORM_WEB_PUSH_ENABLED:'1',PLATFORM_WEB_PUSH_PUBLIC_KEY:keys.publicKey,PLATFORM_WEB_PUSH_PRIVATE_KEY:keys.privateKey,PLATFORM_WEB_PUSH_SUBJECT:keys.subject});try{await work();}finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}};
const ENDPOINT='https://fcm.googleapis.com/fcm/send/qa-only-device-token';

test('push is off by default, only known push services are accepted and the VAPID token is signed for the service origin',async()=>{
 assert.equal(webPushConfiguration(),null);const keys=vapid();
 await withPush({...keys,subject:'not-a-contact'},()=>assert.equal(webPushConfiguration(),null));
 await withPush(keys,()=>assert.equal(webPushConfiguration().publicKey,keys.publicKey));
 assert.equal(pushEndpoint(ENDPOINT),ENDPOINT);assert.ok(pushEndpoint('https://db5p.notify.windows.com/w/?token=abc'));assert.ok(pushEndpoint('https://web.push.apple.com/abc'));
 for(const bad of ['http://fcm.googleapis.com/x','https://evil.example/x','https://fcm.googleapis.com.evil.example/x','https://user:pw@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x',`https://fcm.googleapis.com/${'a'.repeat(1100)}`,42])assert.equal(pushEndpoint(bad),null,String(bad).slice(0,60));
 const header=vapidAuthorization(ENDPOINT,keys,Date.UTC(2026,9,27)),[,token,k]=header.match(/^vapid t=([^,]+), k=(.+)$/),[head,body,signature]=token.split('.');
 assert.equal(k,keys.publicKey);const claims=JSON.parse(Buffer.from(body,'base64url'));
 assert.deepEqual(claims,{aud:'https://fcm.googleapis.com',exp:Date.UTC(2026,9,27)/1000+12*3600,sub:'mailto:ops@ryzevo.example'});
 assert.ok(verify('sha256',Buffer.from(`${head}.${body}`),{key:keys.jwk,format:'jwk',dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')));
});

test('a device hears only about new alerts and decisions, without data, at most every 30 minutes; gone subscriptions are removed',()=>close(async f=>{
 const keys=vapid();await withPush(keys,async()=>{
  const page=f.store.saveConnection({provider:'social',integrationId:'qa-only',accountName:'Private Page Name',accessToken:'private-page-token',expiresAt:Date.now()+30*DAY,social:{platform:'facebook',accountId:'100',graphVersion:'v25.0'}},KEY,{userAccessToken:'private-user-token',appId:'12345'});
  let n=0;const item=(kind,hours,patch={})=>{const id=`inbox-${++n}`;f.db.prepare("INSERT INTO platform_social_inbox(id,organization_id,project_id,connection_id,platform,kind,thread_id,item_id,author_hash,text,received_at,created_at,state,reply_state,reply_text) VALUES(?,?,?,?,'facebook',?,?,?,?,?,?,?,'new',?,?)").run(id,f.a.organizationId,f.a.projectId,page.id,kind,`t-${id}`,`i-${id}`,'h','Private customer question',iso(Date.now()-hours*HOUR),iso(Date.now()),patch.reply_state||null,patch.reply_text||'');return id;};
  const service=new WebPush(f.db,f.scope,KEY);item('message',20);
  assert.deepEqual(JSON.parse(JSON.stringify(service.read())),{enabled:true,publicKey:keys.publicKey,subscribed:false});
  assert.throws(()=>service.subscribe({action:'subscribe',endpoint:'https://evil.example/x'}),error=>error.status===400);
  assert.throws(()=>service.subscribe({action:'subscribe',endpoint:ENDPOINT,keys:{}}),error=>error.status===400);
  assert.equal(service.subscribe({action:'subscribe',endpoint:ENDPOINT}).subscribed,true);
  const row=f.db.prepare('SELECT * FROM platform_push_subscriptions').get();assert.doesNotMatch(row.encrypted_endpoint,/qa-only-device-token/,'the address is stored encrypted');
  assert.equal(new WebPush(f.db,f.other,KEY).read({endpoint:ENDPOINT}).subscribed,false,'another person does not see it');
  const calls=[];let status=201;const fetcher=async(url,init)=>{calls.push({url,init});return {status};};let now=Date.now();
  assert.equal(await deliverDuePushes(f.db,KEY,webPushConfiguration(),fetcher,now),0,'what was open at opt-in is not pushed');
  item('message',19);now+=11*60000;assert.equal(await deliverDuePushes(f.db,KEY,webPushConfiguration(),fetcher,now),1);
  assert.equal(calls.length,1);assert.equal(calls[0].url,ENDPOINT);assert.equal(calls[0].init.body,undefined,'no payload');assert.match(calls[0].init.headers.Authorization,/^vapid t=/);assert.equal(calls[0].init.headers.TTL,'86400');
  item('comment',1,{reply_state:'draft',reply_text:'Saved reply'});now+=11*60000;
  assert.equal(await deliverDuePushes(f.db,KEY,webPushConfiguration(),fetcher,now),0,'within 30 minutes of the last push');
  now+=25*60000;assert.equal(await deliverDuePushes(f.db,KEY,webPushConfiguration(),fetcher,now),1,'a new decision once the gap has passed');
  f.db.prepare("UPDATE platform_social_inbox SET reply_state='sending' WHERE kind='comment'").run();now+=40*60000;
  assert.equal(await deliverDuePushes(f.db,KEY,webPushConfiguration(),fetcher,now),0,'fewer waiting decisions are not new');
  item('comment',1,{reply_state:'draft',reply_text:'Another'});item('comment',2,{reply_state:'draft',reply_text:'Third'});
  f.db.prepare("UPDATE platform_social_inbox SET reply_state='draft' WHERE kind='comment' AND reply_state='sending'").run();now+=40*60000;
  assert.equal(await deliverDuePushes(f.db,KEY,webPushConfiguration(),fetcher,now),1,'more waiting decisions than before are new');
  item('message',18);status=410;now+=40*60000;assert.equal(await deliverDuePushes(f.db,KEY,webPushConfiguration(),fetcher,now),0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_push_subscriptions').get().n,0,'a gone subscription is removed');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_push_notices').get().n,0,'with its notices');
  assert.equal(calls.length,4);
 });
}));

test('unsubscribing and leaving the project end the subscription; errors remove it after five tries',()=>close(async f=>{
 const keys=vapid();await withPush(keys,async()=>{
  const member=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'push-member',password:'fixture-password-123',role:'editor'}),scope={...f.scope,subject:member.userId};
  const service=new WebPush(f.db,f.scope,KEY);service.subscribe({action:'subscribe',endpoint:ENDPOINT});
  assert.equal(service.unsubscribe({action:'unsubscribe',endpoint:ENDPOINT}).subscribed,false);
  new WebPush(f.db,scope,KEY).subscribe({action:'subscribe',endpoint:ENDPOINT});
  assert.equal(f.db.prepare('SELECT user_id FROM platform_push_subscriptions').get().user_id,member.userId,'one subscription per browser: the latest person');
  f.db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(member.userId);
  await deliverDuePushes(f.db,KEY,webPushConfiguration(),async()=>({status:201}),Date.now()+11*60000);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_push_subscriptions').get().n,0);
  service.subscribe({action:'subscribe',endpoint:ENDPOINT});let now=Date.now();
  for(let i=0;i<5;i++){f.db.prepare('DELETE FROM platform_push_notices').run();f.db.prepare('UPDATE platform_push_subscriptions SET last_sent_at=NULL').run();now+=11*60000;
   f.db.prepare("INSERT INTO platform_social_inbox(id,organization_id,project_id,connection_id,platform,kind,thread_id,item_id,author_hash,text,received_at,created_at,state) SELECT ?,?,?,id,'facebook','comment','t','i'||?,'h','x',?,?,'new' FROM platform_connections WHERE organization_id=? LIMIT 1").run(`c${i}`,f.a.organizationId,f.a.projectId,i,iso(now),iso(now),f.a.organizationId);
   f.db.prepare("UPDATE platform_social_inbox SET reply_state='draft',reply_text='r'").run();
   assert.equal(f.db.prepare('SELECT failures FROM platform_push_subscriptions').get()?.failures,i,'still there after '+i+' errors');
   await deliverDuePushes(f.db,KEY,webPushConfiguration(),async()=>({status:500}),now);}
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_push_subscriptions').get().n,0,'removed after repeated errors');
 });
}));

test('offline recovery authenticates the encrypted push address',()=>close(async f=>{
 const keys=vapid();await withPush(keys,async()=>{
  new WebPush(f.db,f.scope,KEY).subscribe({action:'subscribe',endpoint:ENDPOINT});
  const fs=require('node:fs'),path=require('node:path'),folder=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'push-recovery-')),file=path.join(folder,'snapshot.sqlite');
  try{
   await f.db.backup(file);const {inspectSnapshot}=await import('../scripts/lib/platform-recovery.mjs');
   const others=f.db.prepare("SELECT COUNT(*) n FROM platform_connections WHERE encrypted_credentials<>''").get().n+f.db.prepare("SELECT COUNT(*) n FROM platform_product_sources WHERE encrypted_checkpoint IS NOT NULL").get().n;
   const report=inspectSnapshot(file,KEY,67);assert.equal(report.credentialCheck,'authenticated');assert.ok(report.encryptedRecords>=others+1);
   const copy=new (require('better-sqlite3'))(file);try{copy.exec("DELETE FROM platform_push_notices; UPDATE platform_push_subscriptions SET id='push_moved'");}finally{copy.close();}
   assert.throws(()=>inspectSnapshot(file,KEY,67),/credential_authentication_failed/,'an address moved to another row does not authenticate');
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
 });
}));

test('migration 62 is additive and repeatable',async()=>{
 const file=require('node:path').join(require('node:os').tmpdir(),`ryzevo-m62-${process.pid}.db`);
 for(const suffix of ['','-wal','-shm'])try{require('node:fs').unlinkSync(file+suffix);}catch{}
 let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeLaunchExtrasSchema(db);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('platform_user_preferences','platform_push_subscriptions','platform_push_notices')").get().n,0);db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,67);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('platform_user_preferences','platform_push_subscriptions','platform_push_notices')").get().n,3);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_migrations WHERE version=62').get().n,1);db.close();
 for(const suffix of ['','-wal','-shm'])try{require('node:fs').unlinkSync(file+suffix);}catch{}
});
