const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {runCoachAi}=load('coach-ai.ts');
const {ProjectUsage}=load('project-usage.ts');

test('provider-reported token counts are kept with the quota, never as a price, and only for completed calls',coachRun(async f=>{
  const usage={provider:'gemini',model:'gemini-2.5-flash',prompt:1200,output:340,thinking:500,total:2040};
  await runCoachAi(f.db,f.scope,async()=>({text:'{"ok":true}',usage}),'prompt',output=>JSON.parse(output),value=>value);
  await runCoachAi(f.db,f.scope,async()=>({text:'{"ok":true}',usage:{...usage,prompt:800,output:100,thinking:0,total:900}}),'prompt',output=>JSON.parse(output),value=>value);
  await runCoachAi(f.db,f.scope,async()=>'{"ok":true}','prompt',output=>JSON.parse(output),value=>value);
  await assert.rejects(runCoachAi(f.db,f.scope,async()=>({text:'not json',usage}),'prompt',output=>JSON.parse(output),value=>value),'a failed parse refunds and records nothing');
  await runCoachAi(f.db,f.scope,async()=>({text:'{"ok":true}',usage:{...usage,prompt:-5}}),'prompt',output=>JSON.parse(output),value=>value);
  const snapshot=new ProjectUsage(f.db,f.scope).read();
  assert.deepEqual(plain(snapshot.providerUsage),[{provider:'gemini',model:'gemini-2.5-flash',calls:2,prompt:2000,output:440,thinking:500,total:2940}],'only plain, completed provider counts are summed');
  assert.equal(f.aiUsage(),4,'the quota still counts every completed call');
  assert.doesNotMatch(JSON.stringify(f.db.prepare('PRAGMA table_info(platform_ai_provider_usage)').all()),/price|cost|amount/,'no price is stored');
  assert.equal(new ProjectUsage(f.db,f.other).read().providerUsage.length,0,'other projects see nothing');
}));
test('schema50 is additive and repeatable',coachRun(async f=>{
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'ai-usage-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeAiUsageSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,49);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,55);db.close();
}));
