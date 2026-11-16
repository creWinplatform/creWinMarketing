const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {parseFeed,newsFeedUrl,normalizeWatch,webWatch,saveWebWatch,webMentions,markMentions,readDueWebMentions}=load('web-mentions.ts');
const {teamAlerts}=load('team-alerts.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const day=offset=>new Date(Date.now()+offset*86400000).toUTCString();
// Shapes copied from what Google News (RSS) and Google Alerts (Atom) return; the content is made up.
const rss=items=>`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>"QA Marka" - Google News</title>${items.map(i=>`<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.date||day(0)}</pubDate><description>&lt;a href="${i.link}"&gt;${i.title}&lt;/a&gt;&amp;nbsp;</description><source url="https://example.com">${i.source||'Örnek Haber'}</source></item>`).join('')}</channel></rss>`;
const atom=`<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Google Alert - QA Marka</title><entry><id>tag:google.com,2013:googlealerts/feed:1</id><title type="html">&lt;b&gt;QA Marka&lt;/b&gt; müşterileri iade bekliyor</title><link href="https://www.google.com/url?rct=j&amp;sa=t&amp;url=https://forum.example.com/konu/42&amp;ct=ga&amp;cd=x"/><published>${new Date().toISOString()}</published><content type="html">Kullanıcılar &lt;b&gt;QA Marka&lt;/b&gt; için şikayet yazıyor</content></entry></feed>`;

test('feeds: RSS and Atom read leniently, entities and HTML removed, Google Alerts links unwrapped',()=>{
  const items=plain(parseFeed(rss([{title:'QA Marka yeni şubesini açtı',link:'https://news.example.com/a?x=1&amp;y=2'}]),'Google News'));
  assert.equal(items.length,1);assert.equal(items[0].title,'QA Marka yeni şubesini açtı');assert.equal(items[0].url,'https://news.example.com/a?x=1&y=2');assert.equal(items[0].source,'Örnek Haber');assert.ok(items[0].publishedAt);
  const [alert]=plain(parseFeed(atom,'google.com'));
  assert.equal(alert.title,'QA Marka müşterileri iade bekliyor');assert.equal(alert.url,'https://forum.example.com/konu/42','the real address, not google.com/url');assert.match(alert.snippet,/şikayet yazıyor/);
  assert.deepEqual(plain(parseFeed('<html>not a feed</html>','x')),[]);
  assert.deepEqual(plain(parseFeed(rss([{title:'Bad link',link:'javascript:alert(1)'}]),'x')),[],'only http(s) links');
  const url=new URL(newsFeedUrl('QA Marka','tr'));assert.equal(url.hostname,'news.google.com');assert.equal(url.searchParams.get('q'),'"QA Marka"');assert.equal(url.searchParams.get('ceid'),'TR:tr');
});

test('settings: off by default with the project name; validated terms and https feeds; only writers change it',coachRun(async f=>{
  const first=await webWatch(f.db,f.scope);assert.equal(first.enabled,false);assert.deepEqual(plain(first.queries),['alpha'],'starts from the project name');
  for(const bad of [{queries:['a','b','c','d']},{queries:['x']},{feeds:['http://insecure.example/rss']},{feeds:['not a url']},{feeds:Array(6).fill('https://e.example/r')},{enabled:true,queries:[],feeds:[]}])assert.throws(()=>normalizeWatch({queries:['QA'],feeds:[],...bad}));
  const saved=await saveWebWatch(f.db,f.scope,{enabled:true,queries:['QA Marka',''],feeds:['https://www.google.com/alerts/feeds/1/2'],language:'tr'});
  assert.equal(saved.enabled,true);assert.deepEqual(plain(saved.queries),['QA Marka']);
  const viewer=await f.member('viewer');assert.equal((await webWatch(f.db,viewer)).canEdit,false);
  await assert.rejects(saveWebWatch(f.db,viewer,{enabled:false,queries:['x y'],feeds:[]}),error=>error.status===403);
}));

test('worker: new items stored once, labelled, alerting on complaints until seen; unreadable sources noted; old items skipped',coachRun(async f=>{
  await saveWebWatch(f.db,f.scope,{enabled:true,queries:['QA Marka'],feeds:['https://www.google.com/alerts/feeds/1/2'],language:'tr'});
  const seen=[];let fail=false;
  const reader=async url=>{seen.push(url.hostname);if(url.hostname==='news.google.com')return rss([{title:'QA Marka yeni şubesini açtı',link:'https://news.example.com/sube'},{title:'QA Marka hakkında dolandırıcılık iddiası',link:'https://news.example.com/iddia'},{title:'Eski haber',link:'https://news.example.com/eski',date:day(-200)}]);if(fail)throw new Error('down');return atom;};
  assert.equal(await readDueWebMentions(f.db,Date.now(),reader),3,'old news is skipped');
  assert.deepEqual(seen.sort(),['news.google.com','www.google.com']);
  let list=await webMentions(f.db,f.scope);assert.deepEqual(plain(list.map(item=>item.level)).sort(),['complaint','none','urgent']);
  let alert=(await teamAlerts(f.db,f.scope)).find(item=>item.kind==='web_negative');assert.equal(alert.count,2);assert.equal(alert.severity,'urgent');
  assert.equal(await readDueWebMentions(f.db,Date.now(),reader),0,'not again within 3 hours');
  fail=true;assert.equal(await readDueWebMentions(f.db,Date.now()+4*3600000,reader),0,'known items are not stored twice');
  assert.match((await webWatch(f.db,f.scope)).lastError,/unreadable:google\.com|unreadable:www\.google\.com/);
  list=await markMentions(f.db,f.scope,{ids:list.map(item=>item.id)});assert.ok(list.every(item=>item.state==='seen'));
  assert.ok(!(await teamAlerts(f.db,f.scope)).some(item=>item.kind==='web_negative'),'seen items no longer alert');
  await assert.rejects(markMentions(f.db,f.other,{ids:list.map(item=>item.id)}).then(()=>webMentions(f.db,f.other)).then(other=>{assert.equal(other.length,0);throw Object.assign(new Error('ok'),{status:0});}),error=>error.status===0||error.status===403);
  await saveWebWatch(f.db,f.scope,{enabled:false,queries:['QA Marka'],feeds:[]});
  assert.equal(await readDueWebMentions(f.db,Date.now()+9*3600000,reader),0,'off means not read');
}));
