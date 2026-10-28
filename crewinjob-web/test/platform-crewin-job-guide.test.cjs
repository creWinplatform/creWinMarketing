const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {load}=require('./platform-loader.cjs');
// The Crewin workspace's "What would you like to do?": steps come from its JSON stores and the Crewin backend.
const {crewinJobGuide,resetCrewinGuideCache}=load('crewin-job-guide.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const DAY=86_400_000,NOW=Date.parse('2026-10-28T12:00:00Z');
const iso=daysAgo=>new Date(NOW-daysAgo*DAY).toISOString();
function fixture(){
  resetCrewinGuideCache();
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crewin-guide-')),web=path.join(root,'web'),agent=path.join(root,'agent');
  fs.mkdirSync(web,{recursive:true});fs.mkdirSync(path.join(agent,'data'),{recursive:true});
  const write=(file,data)=>{fs.writeFileSync(file,JSON.stringify(data));const t=new Date(Date.now()+Math.random()*1000);fs.utimesSync(file,t,t);};
  const calls={stats:0,leads:0,orders:0,campaigns:0,posts:0};
  const remote={stats:{seafarers:{newThisWeek:12,fillRateBuckets:{zero:9000,low:800}},jobs:{newThisWeek:40}},leads:{items:[{status:'review'},{status:'review'},{status:'approved'},{status:'rejected'}]},orders:{totalCount:0,items:[]},campaigns:{items:[]},posts:{items:[]}};
  const fail=new Set();
  const read=name=>async()=>{calls[name]++;if(fail.has(name))throw new Error('down');return remote[name];};
  const deps=(patch={})=>({webData:web,agentRoot:agent,now:NOW,env:{},agentEnv:()=>({}),socialConnected:()=>[],
    stats:read('stats'),leads:read('leads'),pendingOrders:read('orders'),campaigns:read('campaigns'),posts:read('posts'),...patch});
  return {web:file=>path.join(web,file),agent:(...file)=>path.join(agent,...file),write,remote,fail,calls,deps,done:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const job=(view,id)=>view.jobs.find(item=>item.id===id);
const states=item=>plain(item.steps.map(step=>[step.id,step.state]));

test('every Crewin job is offered with real steps that open a Crewin tab',async()=>{const f=fixture();try{
  const view=await crewinJobGuide(f.deps());
  assert.deepEqual(plain(view.jobs.map(item=>item.id)).sort(),['crewin_campaign','crewin_credits','crewin_jobs','crewin_leads','crewin_profiles','crewin_results','crewin_seo','crewin_social']);
  assert.equal(view.unavailable,undefined);
  for(const item of view.jobs){assert.ok(item.title.tr&&item.title.en&&item.outcome.en,item.id);assert.equal(item.total,item.steps.length);
    for(const step of item.steps){assert.match(step.href,/^\/\?tab=(pipeline|jobbot|retention|messaging|kpi|social|growth|library|campaigns|seo|analytics|firma_kredi)$/,`${item.id}/${step.id}`);assert.ok(step.detail.tr&&step.detail.en);}}
  assert.deepEqual(plain(job(view,'crewin_profiles').badge),{count:9000,label:{tr:'boş profil',en:'empty profile(s)'}},'empty profiles from the live stats');
  assert.deepEqual(plain(job(view,'crewin_leads').badge),{count:2,label:{tr:'lead incelemede',en:'lead(s) in review'}});
  assert.deepEqual(states(job(view,'crewin_leads')),[['research','done'],['review','todo'],['campaign','todo']]);
  assert.equal(job(view,'crewin_credits').complete,true,'no pending orders: done, listed last');assert.equal(view.jobs.at(-1).complete,true);
}finally{f.done();}});

test('weekly work counts from the last 7 days and every step ticks only from a record',async()=>{const f=fixture();try{
  f.write(f.agent('data','posted-jobs.json'),[{ilanId:1,postedAt:iso(20),broadcastedAt:iso(20)}]);
  f.write(f.agent('data','review-queue.json'),[{id:'a',status:'pending',queuedAt:iso(2)},{id:'b',status:'pending',queuedAt:iso(40)}]);
  let jobs=job(await crewinJobGuide(f.deps()),'crewin_jobs');
  assert.deepEqual(states(jobs),[['review','todo'],['publish','todo'],['broadcast','blocked']],'last post and announcement were 20 days ago');
  assert.equal(jobs.badge.count,1,'only ads found this week wait for a decision');assert.match(jobs.steps[0].evidence.tr,/1 eski kayıt/);
  assert.match(jobs.steps[1].evidence.tr,/Son ilan: 20 gün önce · sitede bu hafta toplam 40 yeni ilan/);
  assert.match(jobs.steps[2].reason.tr,/TG_SESSION/,'announcing needs the Telegram session');
  f.write(f.agent('data','review-queue.json'),[{id:'b',status:'pending',queuedAt:iso(40)}]);
  f.write(f.web('activity-log.json'),[{id:'1',type:'job_posted',label:'İlan yayınlandı',ts:NOW-DAY}]);
  f.write(f.agent('data','posted-jobs.json'),[{ilanId:1,postedAt:iso(20),broadcastedAt:iso(1)}]);
  jobs=job(await crewinJobGuide(f.deps({agentEnv:()=>({TG_SESSION:'qa-session'})})),'crewin_jobs');
  assert.deepEqual(states(jobs),[['review','done'],['publish','done'],['broadcast','done']],'a direct post is recorded as activity; files are read again once changed');
  assert.equal(jobs.complete,true);
  f.write(f.web('content-history.json'),[{platform:'instagram',prompt:'Seafarer Büyüme · instagram',content:'x',timestamp:NOW-2*DAY},{platform:'kpi',prompt:'KPI Raporu',content:'r',timestamp:NOW-10*DAY},{platform:'facebook',prompt:'Reklam Kampanyası · facebook',content:'ad',timestamp:NOW}]);
  const view=await crewinJobGuide(f.deps({socialConnected:()=>['LinkedIn']}));
  assert.deepEqual(states(job(view,'crewin_social')),[['connect','done'],['draft','done'],['publish','todo']],'a sign-up draft counts as a post draft; an ad draft does not');
  assert.match(job(view,'crewin_social').steps[2].evidence.tr,/bu hafta 12 yeni kayıt/);
  assert.equal(job(view,'crewin_results').steps.find(step=>step.id==='report').state,'todo','a report from 10 days ago is not this week’s');
}finally{f.done();}});

test('missing server settings are named, and earlier steps stay doable',async()=>{const f=fixture();try{
  const view=await crewinJobGuide(f.deps());
  const send=job(view,'crewin_profiles').steps.find(step=>step.id==='send'),ga4=job(view,'crewin_results').steps[0],publish=job(view,'crewin_social').steps.find(step=>step.id==='publish');
  assert.equal(send.state,'blocked');assert.match(send.reason.tr,/SMTP_HOST.*WHATSAPP_ACCESS_TOKEN/);assert.equal(job(view,'crewin_profiles').steps[0].canAct,true);
  assert.match(ga4.reason.tr,/GA4_PROPERTY_ID/);assert.match(publish.reason.tr,/1\. adım/);
  const ready=await crewinJobGuide(f.deps({env:{SMTP_HOST:'smtp.test',SMTP_USER:'u',SMTP_PASSWORD:'qa',SMTP_FROM_EMAIL:'qa@example.test',GA4_PROPERTY_ID:'1',GOOGLE_SERVICE_ACCOUNT_JSON:'{}'}}));
  assert.equal(job(ready,'crewin_profiles').steps.find(step=>step.id==='send').state,'todo');assert.equal(job(ready,'crewin_results').steps[0].state,'done');
}finally{f.done();}});

test('a backend that is down hides only its own job, says so, and is not called again for 15 seconds',async()=>{const f=fixture();try{
  f.fail.add('leads');f.fail.add('orders');
  const view=await crewinJobGuide(f.deps());
  assert.ok(!job(view,'crewin_leads')&&!job(view,'crewin_credits'));assert.ok(job(view,'crewin_jobs')&&job(view,'crewin_campaign'));
  assert.equal(view.unavailable.length,2);assert.match(view.unavailable[0].tr,/lead servisi/);
  await crewinJobGuide(f.deps({now:NOW+5000}));assert.equal(f.calls.leads,1,'a failure is retried after 15 s, not on every focus');assert.equal(f.calls.stats,1,'a good answer is reused for a minute');
  f.fail.clear();await crewinJobGuide(f.deps({now:NOW+16000}));assert.equal(f.calls.leads,2);assert.equal(f.calls.stats,1);
}finally{f.done();}});

test('money and waiting work come first; a pending order outranks everything',async()=>{const f=fixture();try{
  f.remote.orders={totalCount:3,items:[{}]};
  const view=await crewinJobGuide(f.deps());
  assert.equal(view.jobs[0].id,'crewin_credits');assert.equal(view.jobs[0].badge.count,3);assert.equal(view.jobs[0].steps[0].state,'todo');
  assert.ok(view.jobs.findIndex(item=>item.id==='crewin_leads')<view.jobs.findIndex(item=>item.id==='crewin_campaign'),'leads in review come before an idle job');
}finally{f.done();}});
