const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture}=require('./email-pilot-fixture.cjs');
// Two editors on one draft: the second save carries the version it opened (updatedAt). A stale version is refused with
// 409 instead of silently overwriting the first edit. Callers that send no version keep the old behaviour.
const run=fn=>async()=>{const f=await fixture();try{await fn(f);}finally{f.db.close();}};
const draft={id:'qa-draft',platform:'linkedin',language:'tr',content:'QA-TEST ilk metin',headline:'QA-TEST',prompt:'',timestamp:Date.now()};
const wait=()=>new Promise(resolve=>setTimeout(resolve,5));

test('content: history exposes updatedAt; a save from a stale version is refused, the first edit stays',run(async f=>{
  const created=await f.store.saveContent(draft,true);
  assert.ok(created.updatedAt,'the saved item carries its version');
  const opened=(await f.store.history()).find(item=>item.id==='qa-draft');
  assert.equal(opened.updatedAt,created.updatedAt,'history returns the same version');
  // Tab A and tab B open the same version; A saves first.
  await wait();
  const a=await f.store.saveContent({...opened,content:'QA-TEST (A)'},false,opened.updatedAt);
  assert.notEqual(a.updatedAt,opened.updatedAt,'a save moves the version on');
  await assert.rejects(async()=>await f.store.saveContent({...opened,content:'QA-TEST (B)'},false,opened.updatedAt),error=>error.status===409&&/başka bir yerde değiştirildi/.test(error.message));
  const stored=(await f.store.history()).find(item=>item.id==='qa-draft');
  assert.equal(stored.content,'QA-TEST (A)','the first edit is kept');
  assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM platform_content_history WHERE id=?').get('qa-draft').payload).updatedAt,undefined,'the version lives in the row, not in the payload');
  // B reloads and saves on the latest version.
  const b=await f.store.saveContent({...stored,content:'QA-TEST (B)'},false,stored.updatedAt);
  assert.equal((await f.store.history()).find(item=>item.id==='qa-draft').content,'QA-TEST (B)');
  assert.equal(b.content,'QA-TEST (B)');
  // No version sent: the save goes through as before.
  await f.store.saveContent({...stored,content:'QA-TEST (no version)'},false);
  assert.equal((await f.store.history()).find(item=>item.id==='qa-draft').content,'QA-TEST (no version)');
  await assert.rejects(async()=>await f.store.saveContent({...draft,id:'missing'},false,new Date().toISOString()),error=>error.status===404,'a missing draft is still 404');
}));

test('campaign: a save from a stale updatedAt is refused with 409',run(async f=>{
  const opened=await f.store.campaign('pilot-campaign');
  assert.ok(opened.updatedAt);
  await wait();
  const a={...opened,name:'QA-TEST (A)',updatedAt:new Date().toISOString()};
  await f.store.saveCampaign(a,false,opened.updatedAt);
  await assert.rejects(async()=>await f.store.saveCampaign({...opened,name:'QA-TEST (B)',updatedAt:new Date(Date.now()+1).toISOString()},false,opened.updatedAt),error=>error.status===409);
  assert.equal((await f.store.campaign('pilot-campaign')).name,'QA-TEST (A)');
  await f.store.saveCampaign({...a,name:'QA-TEST (B)',updatedAt:new Date(Date.now()+2).toISOString()},false,a.updatedAt);
  assert.equal((await f.store.campaign('pilot-campaign')).name,'QA-TEST (B)');
}));
