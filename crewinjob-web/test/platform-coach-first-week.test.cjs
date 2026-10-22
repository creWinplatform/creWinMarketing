const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {seedCoachFirstWeek,coachStarterDraft}=load('coach-first-week.ts'),{ProjectMarketingStore}=load('marketing-store.ts'),{CoachContentPlan}=load('coach-content.ts'),{GrowthCompass}=load('guidance.ts');
// Ready first week: after approval the starter plan and a few drafts exist; nothing is published or counted as the team's work.
const starters=f=>new ProjectMarketingStore(f.db,f.scope).history().filter(item=>item.starter);

test('approving the brief leads to this month’s starter plan and three drafts in the library',coachRun(async f=>{
  await f.approve({goal:'social',market:'b2c',current:['website','instagram']});
  assert.equal(seedCoachFirstWeek(f.db,f.scope).drafts,3);
  const drafts=starters(f),plan=new CoachContentPlan(f.db,f.scope).read();
  assert.equal(drafts.length,3);assert.ok(plan.items.length>=3,'the month’s plan was prepared');
  assert.ok(drafts.every(item=>/^content:/.test(item.coachRef)&&plan.items.some(p=>`content:${p.id}`===item.coachRef)),'each draft points to its plan item');
  assert.ok(drafts.every(item=>item.content.includes('https://example.com')&&item.prompt.length>0),'the team’s instructions stay in the brief field, not in the post');
  assert.equal(new Set(drafts.map(item=>item.content.split('\n\n')[0])).size,3,'each draft starts with its own topic');
  assert.ok(new Set(drafts.map(item=>item.platform)).size>=2,'the first week spreads over the brief’s channels');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_social_publications').get().n,0,'nothing is published or queued');
  assert.equal(f.coach.read().starterDrafts,3);
  assert.equal(seedCoachFirstWeek(f.db,f.scope).drafts,0,'running it again adds nothing');
  assert.equal(starters(f).length,3);
}));

test('starter drafts do not complete the Compass “first content” step or the learning view until the team saves them',coachRun(async f=>{
  await f.approve({goal:'social',market:'b2c',current:['website','instagram']});seedCoachFirstWeek(f.db,f.scope);
  const compass=new GrowthCompass(f.db,f.scope,'00'.repeat(32)),draftStep=()=>compass.read().steps.find(step=>step.id==='draft');
  assert.notEqual(draftStep()?.state,'done','a draft the team never touched is not their first content');
  const store=new ProjectMarketingStore(f.db,f.scope),first=starters(f)[0];
  // The editor rebuilds the item from known fields only (contentInput), so a saved draft no longer carries the flag.
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','lib','platform','marketing-routes.ts'),'utf8');
  const input=source.slice(source.indexOf('async function contentInput'),source.indexOf('\n}',source.indexOf('async function contentInput')));
  assert.ok(input.length>100);assert.doesNotMatch(input,/starter/,'contentInput never copies the starter flag');
  const {starter:_drop,...saved}=first;store.saveContent({...saved,content:first.content+' (edited by the team)'},false);
  assert.equal(starters(f).length,2);
  assert.equal(draftStep()?.state,'done','once the team saves a draft on the chosen channel, the step is theirs');
}));

test('a starter is a frame the team fills in: it cannot be published untouched and fits X’s limit',()=>{
  const brief={language:'tr',icp:{summary:'s',pains:['Doğrulanacak varsayım: Kurs tarihleri ne zaman?']},positioning:'QA Proje, gemi adamları için çevrim içi STCW kursu sunar. '.repeat(8),channels:[{id:'twitter',rationale:'r'}],plan:[]};
  const draft=coachStarterDraft({id:'c1',channel:'twitter',title:'X gönderisi: Sık sorulan bir soruya kısa yanıt',angle:'Bir soruyu yanıtlayın.'},brief,'https://example.com');
  assert.ok(draft.content.length<=280);assert.match(draft.content,/Ayrıntılar: https:\/\/example\.com$/);
  assert.equal(draft.content.split('\n\n')[0],'{{Sık sorulan bir soruya kısa yanıt — buraya kendi örneğinizi yazın}}','the first line asks the team for its own example');
  assert.doesNotMatch(draft.content,/%|\d+\s*(kat|x)\b|garanti|Doğrulanacak varsayım/i,'no figures, promises or internal research notes');
  // Publishing refuses text that still holds {{…}} (social-publications.ts), so an untouched starter cannot go out.
  const rule=/\{\{[\s\S]*?\}\}/;assert.match(draft.content,rule);
  assert.ok(require('node:fs').readFileSync(require('node:path').join(__dirname,'..','lib','platform','social-publications.ts'),'utf8').includes(String.raw`!/\{\{[\s\S]*?\}\}|`),'the publish rule that refuses {{…}} is in place');
  const en=coachStarterDraft({id:'c2',channel:'linkedin',title:'LinkedIn post: Who it is for',angle:'a'},{...brief,language:'en',positioning:'Short positioning.'},'https://example.com');
  assert.equal(en.content,'{{Who it is for — write your own example here}}\n\nShort positioning.\n\nDetails: https://example.com');
  assert.equal(coachStarterDraft({id:'c3',channel:'seo',title:'t',angle:'a'},brief,'').platform,'blog');
});

test('no brief, no write right or a full library: approval still stands and no starter is forced',coachRun(async f=>{
  assert.equal(seedCoachFirstWeek(f.db,f.scope).drafts,0,'nothing before approval');
  await f.approve({goal:'leads'});
  const viewer=f.member('viewer');assert.equal(seedCoachFirstWeek(f.db,viewer).drafts,0);
  assert.equal(starters(f).length,0);
}));
