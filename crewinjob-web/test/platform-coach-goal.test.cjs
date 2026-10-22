const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {normalizeCoachAnswers,coachStarterBrief}=load('coach.ts'),{compassFromBrief}=load('coach-compass.ts');
// New accounts choose their main goal in the diagnosis; the Compass path comes from that choice, not from a guess.
// The form defaults (online sales, website, writing) used to push almost everyone to the SEO path.
const defaults={offer:'Online STCW courses for seafarers',customer:'Seafarers starting their career',market:'b2c',price:'mid',sales:'online',current:['website','instagram'],hours:'2to5',skills:['writing'],obstacle:'start',success:'20 course sign-ups a month'};
const route=answers=>{const brief=coachStarterBrief(answers,'tr','QA Proje');return {brief,suggestion:compassFromBrief(brief,answers,[])};};

test('the goal is kept, optional for older answers and limited to the five paths',()=>{
  assert.equal(normalizeCoachAnswers({...defaults,goal:'retention'}).goal,'retention');
  assert.equal('goal' in normalizeCoachAnswers(defaults),false,'answers saved before the question still load');
  assert.equal('goal' in normalizeCoachAnswers({...defaults,goal:''}),false);
  assert.throws(()=>normalizeCoachAnswers({...defaults,goal:'growth-hacking'}));
});

test('each goal sets its own Compass path, even with the default answers',()=>{
  for(const goal of ['leads','social','retention','seo','mobile'])assert.equal(route({...defaults,goal}).suggestion.intent,goal,goal);
});

test('the goal decides the first channels: B2C sign-ups start on social, not on search',()=>{
  assert.notEqual(route({...defaults,goal:'leads'}).brief.channels[0].id,'seo');
  assert.equal(route({...defaults,goal:'social'}).brief.channels[0].id,'instagram');
  assert.equal(route({...defaults,market:'b2b',goal:'social'}).brief.channels[0].id,'linkedin');
  assert.equal(route({...defaults,goal:'retention'}).brief.channels[0].id,'email');
  assert.equal(route({...defaults,goal:'seo'}).brief.channels[0].id,'seo');
});

test('without a stated goal the old inference still applies',()=>{
  const old=route(defaults);
  assert.equal(old.brief.channels[0].id,'seo','this was the reported problem: defaults lead to search');
  assert.equal(old.suggestion.intent,'seo');
});
