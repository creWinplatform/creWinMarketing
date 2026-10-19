const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {CoachSeo,guessSeoIntent,coachStarterTopics,normalizeSeoBrief}=load('coach-seo.ts');
const {rankAuditFindings,developerTask}=load('seo-impact.ts');
const {encryptCredentials,decryptCredentials}=load('credential-envelope.ts');
const KEY='34'.repeat(32);
const seo=f=>new CoachSeo(f.db,f.scope,KEY);
const rows=[{query:'bookkeeping app for shops',clicks:12,impressions:340,position:8.43},{query:'how to do shop bookkeeping',clicks:3,impressions:120,position:14.1}];
const connect=(f,credentials={accessToken:'gsc-access-token',refreshToken:'gsc-refresh-token',googleOAuth:true,expiresAt:Date.now()+3600000})=>{const id='gsc-connection';f.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,'search_console','https://example.com/','QA Search Console',?,1,?)").run(id,f.scope.organizationId,f.scope.projectId,encryptCredentials(credentials,KEY,f.scope.organizationId,f.scope.projectId,id),new Date().toISOString());return id;};
const noRefresh=async credentials=>credentials;

test('audit findings are re-ranked by a fixed impact rule with plain-language guidance',()=>{
  const findings=[{id:'finding-1',priority:'low',category:'Erişilebilirlik',title:'Alt metni olmayan görseller var',detail:'d',recommendation:'r',evidence:'e1'},{id:'finding-2',priority:'medium',category:'Meta',title:'Meta description yok',detail:'d',recommendation:'r',evidence:'e2'},{id:'finding-3',priority:'high',category:'İndekslenebilirlik',title:'Sayfa noindex olarak işaretli',detail:'d',recommendation:'r',evidence:'robots: noindex'},{id:'finding-4',priority:'medium',category:'Yeni',title:'Unknown check',detail:'own detail',recommendation:'own fix',evidence:'e4'}];
  const ranked=rankAuditFindings(findings);
  assert.deepEqual(plain(ranked.map(item=>item.id)),['finding-3','finding-2','finding-4','finding-1']);assert.deepEqual(plain(ranked.map(item=>item.rank)),[1,2,3,4]);
  assert.equal(ranked[0].impact,'high');assert.ok(ranked[0].why.en.length>20&&ranked[0].how.tr.length>20);
  assert.equal(ranked[2].why.en,'own detail');assert.equal(ranked[2].how.tr,'own fix');
  const task=developerTask(ranked[0],'https://example.com/page','en',text=>text==='Sayfa noindex olarak işaretli'?'Page is marked noindex':text);
  assert.equal(task.split('\n')[0],'https://example.com/page','the first line stays the page URL used by existing SEO work items');assert.match(task,/Problem: Page is marked noindex/);assert.match(task,/Evidence: robots: noindex/);assert.match(task,/Done when:/);
  assert.doesNotMatch(JSON.stringify(ranked),/\d\s*%|traffic will|guarantee/i);
});
test('intent is a labelled heuristic; starter topics carry no invented numbers',coachRun(async f=>{
  assert.equal(guessSeoIntent('best bookkeeping app'),'commercial');assert.equal(guessSeoIntent('muhasebe programı fiyat'),'transactional');assert.equal(guessSeoIntent('how to keep books'),'informational');
  const {brief}=await f.approve(),clusters=coachStarterTopics(brief,f.answers,[]);
  assert.ok(clusters.length>=3);assert.ok(clusters.every(cluster=>cluster.keywords.every(keyword=>keyword.source==='suggested'&&keyword.clicks===null&&keyword.impressions===null&&keyword.position===null)));
  const withData=coachStarterTopics(brief,f.answers,rows);assert.equal(withData[0].keywords[0].phrase,'bookkeeping app for shops');assert.equal(withData[0].keywords[0].impressions,340);assert.equal(withData[0].keywords[0].source,'search_console');
}));
test('without Search Console the source says so and nothing is fetched',coachRun(async f=>{
  await assert.rejects(seo(f).generate({mode:'template'}),error=>error.status===404);
  await f.approve();let called=0;
  const snapshot=await seo(f).generate({mode:'template'},{reader:async()=>{called++;return rows;},refresh:noRefresh});
  assert.equal(called,0);assert.equal(snapshot.searchConsole.state,'not_connected');assert.ok(snapshot.topics.length>=3);assert.equal(f.aiUsage(),0);
  assert.ok(snapshot.topics.flatMap(topic=>topic.keywords).every(keyword=>keyword.source==='suggested'&&keyword.impressions===null));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_coach_seo_queries').get().n,0);
}));
test('connected Search Console rows are used exactly as reported; failures are "unavailable", empty is "no data"',coachRun(async f=>{
  await f.approve();const id=connect(f);let seen;
  let snapshot=await seo(f).generate({mode:'template'},{reader:async input=>{seen=input;return rows;},refresh:noRefresh});
  assert.equal(seen.resource,'https://example.com/');assert.equal(seen.token,'gsc-access-token');assert.ok(seen.from<seen.to);
  assert.equal(snapshot.searchConsole.state,'ready');assert.equal(snapshot.searchConsole.queries,2);
  const first=snapshot.topics[0].keywords[0];assert.deepEqual(plain(first),{phrase:'bookkeeping app for shops',source:'search_console',clicks:12,impressions:340,position:8.4});
  assert.ok(!JSON.stringify(snapshot).includes('gsc-access-token')&&!JSON.stringify(snapshot).includes('gsc-refresh-token'));
  snapshot=await seo(f).generate({mode:'template'},{reader:async()=>[],refresh:noRefresh});assert.equal(snapshot.searchConsole.state,'no_data');assert.ok(snapshot.topics.flatMap(topic=>topic.keywords).every(keyword=>keyword.source==='suggested'));
  snapshot=await seo(f).generate({mode:'template'},{reader:async()=>{throw new Error('403');},refresh:noRefresh});assert.equal(snapshot.searchConsole.state,'unavailable');assert.ok(snapshot.topics.length>=3);
  // A refreshed Google grant is stored back encrypted, and the stale verification is dropped.
  f.db.prepare('INSERT INTO platform_connection_checks VALUES(?,?,?,?,?)').run(id,'old','verified',new Date().toISOString(),'QA');
  await seo(f).generate({mode:'template'},{reader:async input=>{seen=input;return rows;},refresh:async credentials=>({...credentials,accessToken:'refreshed-token'})});
  assert.equal(seen.token,'refreshed-token');const stored=f.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(id).encrypted_credentials;
  assert.equal(decryptCredentials(stored,KEY,f.scope.organizationId,f.scope.projectId,id).accessToken,'refreshed-token');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_connection_checks WHERE connection_id=?').get(id).n,0);
}));
test('Search Console data is only for connection managers; others get brief-based topics and a note',coachRun(async f=>{
  await f.approve();connect(f);let calls=0;const reader=async()=>{calls++;return rows;};
  const editor=new CoachSeo(f.db,f.member('editor'),KEY),viewer=new CoachSeo(f.db,f.member('viewer'),KEY);
  let snapshot=await editor.generate({mode:'template'},{reader,refresh:noRefresh});
  assert.equal(calls,0,'an editor never triggers a Search Console read');assert.equal(snapshot.searchConsole.state,'restricted');assert.equal(snapshot.searchConsole.canRefresh,false);
  assert.ok(snapshot.topics.length>=3,'editors still get product/brief-based topics');assert.ok(snapshot.topics.flatMap(topic=>topic.keywords).every(keyword=>keyword.source==='suggested'&&keyword.impressions===null));
  await assert.rejects(editor.refresh({reader,refresh:noRefresh}),error=>error.status===403);
  // A manager reads real rows and builds topics from them…
  snapshot=await seo(f).generate({mode:'template'},{reader,refresh:noRefresh});assert.equal(calls,1);assert.equal(snapshot.searchConsole.state,'ready');assert.equal(snapshot.searchConsole.canRefresh,true);assert.equal(snapshot.topics[0].keywords[0].impressions,340);
  // …which other members never see: no rows, no phrases, no period, no counts.
  for(const member of [editor,viewer]){const view=member.read(),text=JSON.stringify(view);
    assert.equal(view.searchConsole.state,'restricted');assert.equal(view.searchConsole.queries,0);assert.equal(view.searchConsole.from,null);assert.equal(view.searchConsole.checkedAt,null);
    assert.ok(!text.includes('bookkeeping app for shops')&&!text.includes('340')&&!text.includes('search_console'),'no Search Console data leaks to non-managers');}
  // An editor's AI brief prompt never receives Search Console phrases either.
  const topic=seo(f).read().topics.find(item=>item.keywords.some(keyword=>keyword.source==='search_console'));let prompt='';
  await editor.draftBrief({topicId:topic.id,mode:'ai'},async value=>{prompt=value;return JSON.stringify({targetKeyword:'shop books',intent:'informational',title:'T',outline:['A','B','C'],questions:[],internalLinks:[],notes:''});});
  assert.doesNotMatch(prompt,/bookkeeping app for shops|how to do shop bookkeeping/);
}));
test('AI topics: numbers come only from Search Console rows; metric claims are rejected and refunded',coachRun(async f=>{
  await f.approve();connect(f);
  await assert.rejects(seo(f).generate({mode:'ai'},{reader:async()=>rows,refresh:noRefresh}),error=>error.status===503);
  let prompt='';const ok=await seo(f).generate({mode:'ai'},{reader:async()=>rows,refresh:noRefresh,generator:async value=>{prompt=value;return JSON.stringify({clusters:[{name:'Shop bookkeeping',intent:'informational',keywords:['How to do shop bookkeeping','bookkeeping checklist']}]});}});
  assert.equal(f.aiUsage(),1);assert.match(prompt,/never state or estimate search volume/);assert.match(prompt,/bookkeeping app for shops/);
  const [known,unknown]=ok.topics[0].keywords;assert.equal(known.source,'search_console');assert.equal(known.impressions,120);assert.equal(unknown.source,'suggested');assert.equal(unknown.clicks,null);
  for(const output of [JSON.stringify({clusters:[{name:'X',intent:'commercial',keywords:['a'],note:'search volume 1,200 per month'}]}),'not json',JSON.stringify({clusters:[{name:'X',intent:'unknown',keywords:['a']}]}),JSON.stringify({clusters:[]})])
    await assert.rejects(seo(f).generate({mode:'ai'},{reader:async()=>rows,refresh:noRefresh,generator:async()=>output}),error=>[422,502].includes(error.status),output.slice(0,50));
  assert.equal(f.aiUsage(),1);assert.equal(f.reserved(),0);
}));
test('content briefs are drafted, edited and approved before they can become a blog draft',coachRun(async f=>{
  await f.approve();let snapshot=await seo(f).generate({mode:'template'});const topic=snapshot.topics[0];
  snapshot=await seo(f).draftBrief({topicId:topic.id,mode:'template'});let current=snapshot.topics.find(item=>item.id===topic.id);
  assert.equal(current.briefState,'draft');assert.equal(current.prefill,null);assert.ok(current.brief.outline.length>=3);assert.match(current.brief.internalLinks[0].target,/^https:\/\/example\.com\//);
  assert.throws(()=>seo(f).saveBrief({topicId:topic.id,expectedRevision:current.revision,brief:{...current.brief,internalLinks:[{anchor:'Elsewhere',target:'https://other.example/page'}]}}),error=>error.status===400);
  assert.throws(()=>seo(f).saveBrief({topicId:topic.id,expectedRevision:current.revision-1,brief:current.brief}),error=>error.status===409);
  snapshot=seo(f).saveBrief({topicId:topic.id,expectedRevision:current.revision,brief:{...current.brief,title:'Our own title'}});current=snapshot.topics.find(item=>item.id===topic.id);assert.equal(current.briefSource,'human');assert.equal(current.brief.title,'Our own title');
  snapshot=seo(f).approveBrief({topicId:topic.id,expectedRevision:current.revision});current=snapshot.topics.find(item=>item.id===topic.id);
  assert.equal(current.briefState,'approved');assert.equal(current.prefill.channel,'blog');assert.equal(current.prefill.name,'Our own title');assert.match(current.prefill.brief,/Outline:/);
  snapshot=await seo(f).generate({mode:'template'});assert.ok(snapshot.topics.some(item=>item.id===topic.id),'topics with a brief survive regeneration');
  const other=snapshot.topics.find(item=>!item.brief);assert.throws(()=>seo(f).approveBrief({topicId:other.id,expectedRevision:other.revision}),error=>error.status===409);
  assert.equal(seo(f).remove({topicId:other.id}).topics.some(item=>item.id===other.id),false);
  assert.throws(()=>normalizeSeoBrief({targetKeyword:'a',intent:'informational',title:'t',outline:['only one']},'https://example.com'),error=>error.status===400);
}));
test('AI briefs reserve usage and reject invented metrics or outside links',coachRun(async f=>{
  await f.approve();const [topic]=(await seo(f).generate({mode:'template'})).topics;
  const brief={targetKeyword:'shop bookkeeping',intent:'informational',title:'Shop bookkeeping basics',outline:['What it is','Why it matters','How to start'],questions:['How long does it take?'],internalLinks:[{anchor:'Home',target:'https://example.com/'}],notes:'Use a real example.'};
  const ok=await seo(f).draftBrief({topicId:topic.id,mode:'ai'},async()=>JSON.stringify(brief));assert.equal(ok.topics.find(item=>item.id===topic.id).briefSource,'ai');assert.equal(f.aiUsage(),1);
  for(const output of [JSON.stringify({...brief,notes:'Ranking #3 expected'}),JSON.stringify({...brief,internalLinks:[{anchor:'Out',target:'https://competitor.example/'}]}),'oops'])
    await assert.rejects(seo(f).draftBrief({topicId:topic.id,mode:'ai'},async()=>output),error=>[422,502].includes(error.status));
  assert.equal(f.aiUsage(),1);assert.equal(f.reserved(),0);
}));
test('roles and scope for SEO topics',coachRun(async f=>{
  await f.approve();const [topic]=(await seo(f).generate({mode:'template'})).topics;
  const viewer=new CoachSeo(f.db,f.member('viewer'),KEY);assert.equal(viewer.read().topics.length>0,true);assert.equal(viewer.read().canWrite,false);
  await assert.rejects(viewer.generate({mode:'template'}),error=>error.status===403);await assert.rejects(viewer.draftBrief({topicId:topic.id,mode:'template'}),error=>error.status===403);
  assert.throws(()=>viewer.remove({topicId:topic.id}),error=>error.status===403);
  const foreign=new CoachSeo(f.db,f.other,KEY);assert.equal(foreign.read().topics.length,0);assert.throws(()=>foreign.remove({topicId:topic.id}),error=>error.status===404);
  assert.throws(()=>new CoachSeo(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'},KEY).read(),error=>error.status===403);
}));
test('schema33 is additive and repeatable',coachRun(async f=>{
  await f.approve();await seo(f).generate({mode:'template'});
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'coach-seo-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeSeoCoachSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,32);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_coach_seo_topics').get().n,0);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,39);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
