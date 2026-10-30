const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
// AI search visibility. The search-grounded assistant is a stub; no provider is contacted.
const {AiVisibility,judgeAnswer,runAiVisibilityChecks}=load('ai-visibility.ts');
const {openPlatformDatabase}=load('database.ts');
const DAY=86400000;
const answer=(text,domains=[])=>async(question,language)=>({text,sources:domains.map(domain=>({domain,title:domain})),queries:[`q: ${question}`],provider:'gemini',model:'gemini-2.5-flash',usage:{provider:'gemini',model:'gemini-2.5-flash',prompt:10,output:20,thinking:0,total:30},language});
const ai=f=>f.db.prepare("SELECT COALESCE(SUM(count),0) n FROM platform_usage WHERE organization_id=? AND project_id=? AND resource='ai'").get(f.scope.organizationId,f.scope.projectId).n;
const competitors=(f,names)=>f.db.prepare('INSERT INTO platform_coach_brand(organization_id,project_id,revision,competitors_json,updated_by,updated_at) VALUES(?,?,1,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET competitors_json=excluded.competitors_json').run(f.scope.organizationId,f.scope.projectId,JSON.stringify(names.map(name=>({name}))),f.scope.subject,new Date().toISOString());

test('the answer is judged from its text and cited sources only, with Turkish letters and case folded',()=>{
  assert.deepEqual(plain(judgeAnswer({text:'İstanbul’da Kahve Dükkanı ve Moda Kafe öne çıkıyor.',sources:[{domain:'kahvedukkani.com.tr',title:''}]},'kahve dukkani','https://www.kahvedukkani.com.tr',['Moda Kafe','Yok Kafe'])),{brandMentioned:true,siteCited:true,competitors:['Moda Kafe']});
  assert.deepEqual(plain(judgeAnswer({text:'Bu bölgede birçok kafe var.',sources:[{domain:'blog.example.org',title:''}]},'Kahve Dükkanı','https://kahvedukkani.com.tr',[])),{brandMentioned:false,siteCited:false,competitors:[]});
  assert.equal(judgeAnswer({text:'Detaylar kahvedukkani.com.tr adresinde.',sources:[]},'Başka Ad','https://kahvedukkani.com.tr',[]).brandMentioned,true,'the site address counts as naming the brand');
  assert.equal(judgeAnswer({text:'x',sources:[{domain:'menu.kahvedukkani.com.tr',title:''}]},'Ad','https://kahvedukkani.com.tr',[]).siteCited,true,'a subdomain is the same site');
  assert.equal(judgeAnswer({text:'xkahvedukkani.com.tr.evil',sources:[{domain:'notkahvedukkani.com.tr',title:''}]},'Ad','https://kahvedukkani.com.tr',[]).siteCited,false);
  assert.equal(judgeAnswer({text:'AB AB',sources:[]},'AB','https://ab.example',[]).brandMentioned,false,'names under three letters are not matched');
});

test('writers keep up to ten questions; everyone in the project can read them',coachRun(async f=>{
  const service=new AiVisibility(f.db,f.scope),viewer=f.member('viewer');
  assert.throws(()=>service.add({action:'add',question:'kısa'}),error=>error.status===400);
  assert.throws(()=>new AiVisibility(f.db,viewer).add({action:'add',question:'Kadıköy’de iyi kafeler hangileri?'}),error=>error.status===403);
  service.add({action:'add',question:'  Kadıköy’de   iyi kafeler hangileri?  '});
  assert.throws(()=>service.add({action:'add',question:'kadıköy’de iyi kafeler hangileri?'}),error=>error.status===409,'no duplicates');
  for(let i=1;i<10;i++)service.add({action:'add',question:`Soru numarası ${i} için örnek metin`});
  assert.throws(()=>service.add({action:'add',question:'Onuncudan sonraki soru metni'}),error=>error.status===409);
  const view=new AiVisibility(f.db,viewer).read();assert.equal(view.questions.length,10);assert.equal(view.questions[0].question,'Kadıköy’de iyi kafeler hangileri?');assert.equal(view.canWrite,false);
  assert.equal(new AiVisibility(f.db,f.other).read().questions.length,0,'another project sees nothing');
  service.remove({action:'remove',id:view.questions[1].id});assert.equal(service.read().questions.length,9);
}));

test('asking records the answer, uses one AI credit and never turns a failure into "not mentioned"',coachRun(async f=>{
  competitors(f,['Moda Kafe']);const service=new AiVisibility(f.db,f.scope);
  service.add({action:'add',question:'Kadıköy’de iyi kafeler hangileri?'});const id=service.read().questions[0].id;
  await assert.rejects(service.ask({id},undefined),error=>error.status===503,'no grounded model, no question');
  let view=await service.ask({id},answer('alpha ve Moda Kafe sakin mekanlar.',['example.com','moda.example']));
  assert.equal(ai(f),1);
  let latest=view.questions[0].latest;assert.equal(latest.status,'ok');assert.equal(latest.brandMentioned,true);assert.equal(latest.siteCited,true);assert.deepEqual(plain(latest.competitors),['Moda Kafe']);
  assert.deepEqual(plain(latest.sources.map(item=>item.domain)),['example.com','moda.example']);assert.equal(view.summary.mentioned,1);assert.equal(view.summary.cited,1);
  await assert.rejects(service.ask({id},async()=>{throw new Error('provider down');}),error=>error.status===502);
  assert.equal(ai(f),1,'the failed ask is refunded');
  latest=service.read().questions[0].latest;assert.equal(latest.status,'failed');assert.equal(latest.brandMentioned,null);
  assert.equal(service.read().summary.asked,0,'the latest answer failed, so it is not counted either way');
  view=await service.ask({id},answer('Bölgede birçok kafe var.'));latest=view.questions[0].latest;assert.equal(latest.brandMentioned,false);assert.equal(latest.siteCited,false);
  assert.equal(view.questions[0].history.length,3);
  await assert.rejects(new AiVisibility(f.db,f.member('viewer')).ask({id},answer('x')),error=>error.status===403);
  await assert.rejects(new AiVisibility(f.db,f.other).ask({id},answer('x')),error=>error.status===404,'another project cannot ask this question');
}));

test('weekly checks run as the member who turned them on and stop when they lose the right',coachRun(async f=>{
  const editor=f.member('editor'),service=new AiVisibility(f.db,editor);
  service.add({action:'add',question:'Kadıköy’de iyi kafeler hangileri?'});service.add({action:'add',question:'Moda’da kahve nerede içilir?'});
  const view=service.weekly({action:'weekly',on:true});assert.equal(view.weekly.on,true);assert.equal(view.weekly.ownedByYou,true);
  assert.equal(await runAiVisibilityChecks(f.db,answer('alpha iyi bir seçenek.'),Date.now()),0,'not due yet');
  assert.equal(await runAiVisibilityChecks(f.db,undefined,Date.now()+8*DAY),0,'no model, nothing asked');
  assert.equal(await runAiVisibilityChecks(f.db,answer('alpha iyi bir seçenek.'),Date.now()+8*DAY),2);
  assert.ok(service.read().questions.every(item=>item.latest.via==='schedule'));
  assert.equal(await runAiVisibilityChecks(f.db,answer('x'),Date.now()+9*DAY),0,'next run is a week later');
  f.db.prepare("UPDATE platform_memberships SET role='viewer' WHERE user_id=?").run(editor.subject);
  assert.equal(await runAiVisibilityChecks(f.db,answer('x'),Date.now()+16*DAY),0);
  assert.equal(new AiVisibility(f.db,f.scope).read().weekly.on,false,'the weekly check is never handed to someone else');
}));

test('migration 64 is additive and repeatable',async()=>{
  const file=require('node:path').join(require('node:os').tmpdir(),`ryzevo-m64-${process.pid}.db`);
  for(const suffix of ['','-wal','-shm'])try{require('node:fs').unlinkSync(file+suffix);}catch{}
  let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeAiVisibilitySchema(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'platform_ai_visibility_%'").get().n,0);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,67);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'platform_ai_visibility_%'").get().n,3);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_migrations WHERE version=64').get().n,1);db.close();
  for(const suffix of ['','-wal','-shm'])try{require('node:fs').unlinkSync(file+suffix);}catch{}
});
