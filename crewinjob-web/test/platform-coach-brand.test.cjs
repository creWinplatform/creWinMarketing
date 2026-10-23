const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {CoachBrand,normalizeVoiceAnswers,normalizeCompetitors}=load('coach-brand.ts');
const {CoachLearning}=load('coach-learning.ts');
const voice={traits:'calm, clear, helpful',avoid:'hyped, smug',address:'formal',useWords:'simple, together',avoidWords:'revolutionary',example:'We keep your books tidy.'};
const rivals=[{name:'LedgerCo',url:'https://ledger.example',says:'All-in-one accounting for everyone',strengths:'Big brand',weaknesses:'Complex setup'},{name:'BookBox',url:'',says:'',strengths:'Cheap',weaknesses:''}];
const brand=(f,scope=f.scope)=>new CoachBrand(f.db,scope);

test('voice workshop: validated answers, a rule-based draft, edits and optimistic revisions',coachRun(async f=>{
  for(const bad of [{traits:''},{address:'shouting'},{example:'x'.repeat(301)}])assert.throws(()=>normalizeVoiceAnswers({...voice,...bad}));
  let snapshot=await brand(f).draftVoice({answers:voice,mode:'template',expectedRevision:0});
  assert.equal(snapshot.voiceSource,'template');assert.match(snapshot.voiceDraft,/calm, clear, helpful/);assert.match(snapshot.voiceDraft,/revolutionary/);assert.doesNotMatch(snapshot.voiceDraft,/\d+\s*%/);assert.equal(f.aiUsage(),0);
  await assert.rejects(brand(f).draftVoice({answers:voice,mode:'template',expectedRevision:0}),error=>error.status===409);
  snapshot=brand(f).editVoice({draft:'Our own voice guide.',expectedRevision:snapshot.revision});assert.equal(snapshot.voiceSource,'human');assert.equal(snapshot.voiceDraft,'Our own voice guide.');
  assert.equal(snapshot.currentVoice,'','nothing reaches the product profile before it is applied');
}));
test('applying the voice to the product profile needs project-settings rights',coachRun(async f=>{
  const editor=f.member('editor'),viewer=f.member('viewer');
  let snapshot=await brand(f,editor).draftVoice({answers:voice,mode:'template',expectedRevision:0});
  assert.equal(snapshot.canApplyVoice,false);assert.throws(()=>brand(f,editor).applyVoice({expectedRevision:snapshot.revision}),error=>error.status===403);
  await assert.rejects(brand(f,viewer).draftVoice({answers:voice,mode:'template',expectedRevision:snapshot.revision}),error=>error.status===403);
  snapshot=brand(f).applyVoice({expectedRevision:snapshot.revision});assert.ok(snapshot.voiceAppliedAt);assert.equal(snapshot.currentVoice,snapshot.voiceDraft);
  assert.equal(f.repo.workspace(f.scope.subject,f.scope.organizationId,f.scope.projectId).project.brandVoice,snapshot.voiceDraft);
}));
test('competitor notes are only what the team writes; nothing is fetched',coachRun(async f=>{
  assert.throws(()=>normalizeCompetitors(Array.from({length:6},(_,i)=>({...rivals[0],name:`R${i}`}))));
  for(const url of ['javascript:alert(1)','ftp://x.example','https://user:pass@x.example','not a url'])assert.throws(()=>normalizeCompetitors([{...rivals[0],url}]),url);
  const original=globalThis.fetch;let fetched=0;globalThis.fetch=async()=>{fetched++;throw new Error('no network');};
  try{
    await assert.rejects(brand(f).analyze({mode:'template',expectedRevision:0}),error=>error.status===409);
    let snapshot=brand(f).saveCompetitors({competitors:rivals,difference:'set up in ten minutes with a real person helping',expectedRevision:0});
    snapshot=await brand(f).analyze({mode:'template',expectedRevision:snapshot.revision});
    assert.equal(fetched,0,'competitor addresses are never visited');assert.equal(snapshot.analysisSource,'template');assert.equal(snapshot.analysis.rows.length,2);
    assert.equal(snapshot.analysis.rows[0].theirClaim,'All-in-one accounting for everyone');assert.equal(snapshot.analysis.rows[1].theirClaim,'Cheap');
    assert.match(snapshot.analysis.positioning,/LedgerCo, BookBox/);assert.match(snapshot.analysis.notes,/not visited|ziyaret edilmedi/);
  }finally{globalThis.fetch=original;}
}));
test('AI suggestions reserve usage and reject unknown competitors, links and claims',coachRun(async f=>{
  let snapshot=brand(f).saveCompetitors({competitors:rivals,difference:'human help',expectedRevision:0});
  const good={rows:[{name:'LedgerCo',theirClaim:'All-in-one',ourAngle:'Human help'}],positioning:'Bookkeeping with a real person helping.',notes:''};
  snapshot=await brand(f).analyze({mode:'ai',expectedRevision:snapshot.revision},async()=>JSON.stringify(good));assert.equal(snapshot.analysisSource,'ai');assert.equal(f.aiUsage(),1);
  for(const output of [JSON.stringify({...good,rows:[{name:'MadeUpCorp',theirClaim:'x',ourAngle:'y'}]}),JSON.stringify({...good,positioning:'Visit https://competitor.example'}),JSON.stringify({...good,positioning:'Cut costs by 40% guaranteed'}),'nope'])
    await assert.rejects(brand(f).analyze({mode:'ai',expectedRevision:snapshot.revision},async()=>output),error=>[422,502].includes(error.status),output.slice(0,40));
  const voiceOk=await brand(f).draftVoice({answers:voice,mode:'ai',expectedRevision:snapshot.revision},async()=>JSON.stringify({voice:'Calm and clear.'}));assert.equal(voiceOk.voiceSource,'ai');
  await assert.rejects(brand(f).draftVoice({answers:voice,mode:'ai',expectedRevision:voiceOk.revision},async()=>JSON.stringify({voice:'We are autonomous.'})),error=>error.status===422);
  assert.equal(f.aiUsage(),2);assert.equal(f.reserved(),0);
}));
test('the suggested positioning changes the approved brief only with approval rights and is versioned',coachRun(async f=>{
  await f.approve();let snapshot=brand(f).saveCompetitors({competitors:rivals,difference:'human help',expectedRevision:0});snapshot=await brand(f).analyze({mode:'template',expectedRevision:snapshot.revision});
  const editor=f.member('editor');assert.throws(()=>brand(f,editor).applyPositioning({expectedCoachRevision:snapshot.coachRevision}),error=>error.status===403);
  assert.throws(()=>brand(f).applyPositioning({expectedCoachRevision:snapshot.coachRevision-1}),error=>error.status===409);
  snapshot=brand(f).applyPositioning({positioning:'Bookkeeping with a real person helping.',expectedCoachRevision:snapshot.coachRevision});
  assert.equal(snapshot.positioning,'Bookkeeping with a real person helping.');assert.equal(f.coach.read().brief.positioning,'Bookkeeping with a real person helping.');
  const versions=new CoachLearning(f.db,f.scope).read();assert.equal(versions.versions[0].kind,'positioning');assert.equal(versions.changes.positioning,true);
  assert.equal(brand(f,f.other).read().competitors.length,0,'other projects see nothing');
  assert.throws(()=>brand(f,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).read(),error=>error.status===403);
}));
test('schema37 is additive and repeatable',coachRun(async f=>{
  brand(f).saveCompetitors({competitors:rivals,difference:'',expectedRevision:0});
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'coach-brand-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeBrandSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,36);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,56);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_coach_brand').get().n,0);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
