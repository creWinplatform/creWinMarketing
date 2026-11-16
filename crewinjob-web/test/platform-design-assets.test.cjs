const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {searchStock,stockPicture,aiPicture}=load('design-assets.ts');
// Stand-ins for Openverse and the image model; nothing leaves the machine.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
const ID='0aff3595-8168-440b-83ff-7a80b65dea42',OTHER='1bff3595-8168-440b-83ff-7a80b65dea42';
function openverse(license='cc0'){
  const calls=[];
  const fetcher=async url=>{calls.push(url.href);
    if(url.pathname==='/v1/images/')return new Response(JSON.stringify({results:[{id:ID,title:'Coffee',creator:'A',license,source:'flickr',foreign_landing_url:'https://example.com/p',width:800,height:600},{id:'not-a-uuid'},{id:OTHER,title:'Desk',license:'pdm'}]}),{status:200,headers:{'content-type':'application/json'}});
    if(url.pathname===`/v1/images/${ID}/`)return new Response(JSON.stringify({id:ID,title:'Coffee',creator:'A',license}),{status:200});
    if(/\/thumb\/$/.test(url.pathname))return new Response(PNG,{status:200,headers:{'content-type':'image/png'}});
    return new Response('nope',{status:404});};
  return {fetcher,calls};
}
const aiCount=f=>f.db.prepare("SELECT COALESCE(SUM(count),0) n FROM platform_usage WHERE organization_id=? AND project_id=? AND resource='ai'").get(f.a.organizationId,f.a.projectId).n;

test('stock: Openverse CC0/public-domain search through the server, thumbnails as data, a daily limit',coachRun(async f=>{
  const {fetcher,calls}=openverse();
  await assert.rejects(searchStock(f.db,f.scope,{query:'a'},fetcher),/en az 2 harf/);
  const items=await searchStock(f.db,f.scope,{query:'coffee'},fetcher);
  assert.equal(items.length,2,'invalid ids are dropped');assert.match(items[0].thumb,/^data:image\/png;base64,/);
  assert.match(calls[0],/license=cc0%2Cpdm/,'only CC0 and public domain are asked for');assert.ok(calls.every(url=>url.startsWith('https://api.openverse.org/')),'one host only');
  f.db.prepare("UPDATE platform_usage SET count=200 WHERE resource='stock_search'").run();
  await assert.rejects(searchStock(f.db,f.scope,{query:'coffee'},fetcher),error=>error.status===429);
  const viewer=await f.member('viewer');await assert.rejects(searchStock(f.db,viewer,{query:'coffee'},fetcher),error=>error.status===403);
}));

test('stock: the full image is re-checked as CC0/public domain and must really be an image',coachRun(async f=>{
  const picture=await stockPicture(f.db,f.scope,{id:ID},openverse().fetcher);
  assert.equal(picture.mime,'image/png');assert.equal(Buffer.from(picture.data,'base64').length,PNG.length);assert.match(picture.credit,/CC0 · Openverse/);
  await assert.rejects(stockPicture(f.db,f.scope,{id:ID},openverse('by').fetcher),/ticari kullanım/);
  await assert.rejects(stockPicture(f.db,f.scope,{id:'../x'},openverse().fetcher),/Geçersiz/);
  const html=async url=>/thumb/.test(url.pathname)?new Response('<html>',{status:200}):openverse().fetcher(url);
  await assert.rejects(stockPicture(f.db,f.scope,{id:ID},html),error=>error.status===502);
}));

test('AI image: counted against the AI quota when it works, refunded when it does not',coachRun(async f=>{
  await assert.rejects(aiPicture(f.db,f.scope,{prompt:'coffee on a desk'}),error=>error.status===503,'no model configured');
  await assert.rejects(aiPicture(f.db,f.scope,{prompt:'x'},async()=>({data:'',mime:''})),/en az 4 harf/);
  let seen='';
  const ok=await aiPicture(f.db,f.scope,{prompt:'coffee on a desk',aspect:'9:16'},async(prompt,aspect)=>{seen=prompt+'|'+aspect;return {data:PNG.toString('base64'),mime:'image/png',usage:{provider:'gemini',model:'gemini-2.5-flash-image',prompt:10,output:1290,thinking:0,total:1300}};});
  assert.equal(ok.mime,'image/png');assert.match(seen,/coffee on a desk/);assert.match(seen,/\|9:16$/);assert.match(seen,/Do not include any text/);
  assert.equal(aiCount(f),1,'one AI use');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_ai_provider_usage').get().n,1,'token counts recorded');
  await assert.rejects(aiPicture(f.db,f.scope,{prompt:'coffee on a desk'},async()=>{throw new Error('quota exceeded key=AIzaSECRET');}),error=>error.status===502);
  await assert.rejects(aiPicture(f.db,f.scope,{prompt:'coffee on a desk'},async()=>({data:Buffer.from('not an image').toString('base64'),mime:'image/png'})),error=>error.status===502);
  assert.equal(aiCount(f),1,'failures are refunded');
  const viewer=await f.member('viewer');await assert.rejects(aiPicture(f.db,viewer,{prompt:'coffee on a desk'},async()=>({data:'',mime:''})),error=>error.status===403);
}));

test('AI product shot: the person\'s product photo goes to the model with a keep-the-product instruction',coachRun(async f=>{
  let got=null;
  const picture=await aiPicture(f.db,f.scope,{prompt:'on a marble counter',aspect:'4:5',source:{data:PNG.toString('base64'),mime:'image/png'}},async(prompt,aspect,source)=>{got={prompt,aspect,source};return {data:PNG.toString('base64'),mime:'image/png'};});
  assert.equal(got.source.mime,'image/png','the type comes from the bytes');assert.match(got.prompt,/exact product from the attached photo/);assert.match(got.prompt,/marble counter/);assert.match(picture.credit,/ürün fotoğrafından/);
  for(const source of [{data:Buffer.from('<svg/>').toString('base64'),mime:'image/png'},{data:'not base64!',mime:'image/png'},{data:Buffer.concat([PNG,Buffer.alloc(6_000_001)]).toString('base64'),mime:'image/png'}])
    await assert.rejects(aiPicture(f.db,f.scope,{prompt:'on a marble counter',source},async()=>({data:PNG.toString('base64'),mime:'image/png'})),/6 MB JPEG, PNG veya WebP/);
  assert.equal(aiCount(f),1,'refused photos use no quota');
}));
