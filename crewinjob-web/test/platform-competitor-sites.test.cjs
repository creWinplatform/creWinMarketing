const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {CompetitorSites,checkCompetitorSite,refreshDueCompetitorSites,siteSnapshot,siteChanges,competitorSiteKey}=load('competitor-sites.ts');
const {CoachBrand}=load('coach-brand.ts');
const {teamAlerts}=load('team-alerts.ts');

const home=({title='Rakip · Muhasebe',description='Küçük işletmeler için muhasebe.',headings=['Kolay muhasebe','Fatura kes'],links=[]}={})=>`<html><head><title>${title}</title><meta name="description" content="${description}"></head><body>${headings.map(item=>`<h2>${item}</h2>`).join('')}
<a href="/fiyatlar">Fiyatlar</a><a href="/gizlilik">Gizlilik</a><a href="/blog/ilk-yazi">İlk yazı</a>${links.map(([href,text])=>`<a href="${href}">${text}</a>`).join('')}</body></html>`;
const pricing=text=>`<html><head><title>Fiyatlar</title></head><body><p>${text}</p></body></html>`;
// A disposable competitor site: answers by URL, records each request. No network is used.
function site(pages){const calls=[];const reader=async(url,accept)=>{calls.push(url.toString());const item=pages[url.toString()];if(item instanceof Error)throw item;if(!item)return {url:url.toString(),status:404,type:'text/html',body:'',redirects:[]};return {url:item.url||url.toString(),status:200,type:item.type||'text/html',body:item.body,redirects:[]};};return {calls,reader};}
const pages=(homeHtml,price='Aylık 100 TL',robots='User-agent: *\nDisallow: /admin')=>({'https://rakip.example/robots.txt':{type:'text/plain',body:robots},'https://rakip.example/':{body:homeHtml},'https://rakip.example/fiyatlar':{body:pricing(price)}});
const competitor={name:'Rakip A',url:'https://rakip.example/',says:'',strengths:'',weaknesses:''};
const save=async (f,list=[competitor])=>await new CoachBrand(f.db,f.scope).saveCompetitors({competitors:list,difference:'',expectedRevision:(await new CoachBrand(f.db,f.scope).read()).revision});

test('changes come from fixed rules; the first read is a baseline and one rotating heading is not news',()=>{
 const before=siteSnapshot(home(),'https://rakip.example/',pricing('Aylık 100 TL'),'https://rakip.example/fiyatlar');
 assert.deepEqual(plain(before.paths.map(item=>item.path)),['/fiyatlar','/blog/ilk-yazi'],'legal pages are left out');
 assert.deepEqual(plain(siteChanges(before,before)),[]);
 assert.deepEqual(plain(siteChanges(before,siteSnapshot(home({headings:['Kolay muhasebe','Yeni slogan']}),'https://rakip.example/',pricing('Aylık 100 TL'),'https://rakip.example/fiyatlar'))),[],'one heading alone');
 const after=siteSnapshot(home({title:'Rakip · Yapay zekâlı muhasebe',headings:['Yapay zekâ ile fatura','Yeni özellik'],links:[['/blog/yapay-zeka','Yapay zekâ ile muhasebe'],['/hakkimizda','Hakkımızda']]}),'https://rakip.example/',pricing('Aylık 150 TL'),'https://rakip.example/fiyatlar');
 const kinds=plain(siteChanges(before,after)).map(item=>item.kind);
 assert.deepEqual(kinds,['title','headings','new_pages','pricing']);
 assert.deepEqual(plain(siteChanges(before,after).find(item=>item.kind==='new_pages').detail.pages),[{path:'/blog/yapay-zeka',text:'Yapay zekâ ile muhasebe'}],'only content-looking new pages');
});

test('a weekly read stores a snapshot, notes changes, respects robots.txt and stays on the competitor’s host',coachRun(async f=>{
 await save(f);const scope=f.scope,key=competitorSiteKey(competitor.url),siteWithKey={...competitor,key},day=86400000,start=Date.now()-20*day;
 let fake=site(pages(home()));
 assert.deepEqual(plain(await checkCompetitorSite(f.db,scope,siteWithKey,fake.reader,start)),{status:'ok',changes:0});
 assert.deepEqual(fake.calls,['https://rakip.example/robots.txt','https://rakip.example/','https://rakip.example/fiyatlar']);
 fake=site(pages(home({title:'Rakip · Yeni'}),'Aylık 150 TL'));
 assert.deepEqual(plain(await checkCompetitorSite(f.db,scope,siteWithKey,fake.reader,start+8*day)),{status:'ok',changes:2});
 const view=await new CompetitorSites(f.db,f.scope).view();assert.equal(view[0].status,'ok');assert.deepEqual(view[0].changes.map(item=>item.kind).sort(),['pricing','title']);
 const blocked=site(pages(home(),'x','User-agent: *\nDisallow: /'));
 assert.equal((await checkCompetitorSite(f.db,scope,siteWithKey,blocked.reader,start+16*day)).status,'blocked');assert.equal(blocked.calls.length,1,'only robots.txt');
 const moved=site({...pages(home()),'https://rakip.example/fiyatlar':{body:pricing('elsewhere'),url:'https://other.example/fiyatlar'}});
 await checkCompetitorSite(f.db,scope,siteWithKey,moved.reader,start+17*day);
 assert.equal(JSON.parse(f.db.prepare('SELECT snapshot_json FROM platform_competitor_sites WHERE site_key=? ORDER BY checked_at DESC').get(key).snapshot_json).pricing,null,'a pricing page on another host is not read as theirs');
 assert.ok((await teamAlerts(f.db,f.scope)).every(alert=>alert.kind!=='competitor_site'),'changes older than a week do not alert');
}));

test('the worker reads the least recently read site once it is a week old; check now is limited and needs the right',coachRun(async f=>{
 await save(f,[competitor,{...competitor,name:'Rakip B',url:'https://rakip-b.example/'}]);
 const both={...pages(home()),'https://rakip-b.example/robots.txt':{type:'text/plain',body:''},'https://rakip-b.example/':{body:home({title:'B'})}};
 const fake=site(both);
 assert.equal((await refreshDueCompetitorSites(f.db,fake.reader)).status,'ok');assert.equal((await refreshDueCompetitorSites(f.db,fake.reader)).status,'ok');
 assert.equal(await refreshDueCompetitorSites(f.db,fake.reader),null,'both read this week');
 const service=new CompetitorSites(f.db,f.scope,site({...both,'https://rakip.example/':{body:home({title:'Rakip · Değişti',headings:['A','B']})}}).reader);
 const key=competitorSiteKey(competitor.url);
 const view=await service.checkNow({key});assert.ok(view.find(item=>item.key===key).changes.length>0);
 assert.ok((await teamAlerts(f.db,f.scope)).some(alert=>alert.kind==='competitor_site'&&alert.plans.includes('Rakip A')),'a fresh change alerts the team');
 await service.checkNow({key});await service.checkNow({key});
 await assert.rejects(service.checkNow({key}),error=>error.status===429);
 await assert.rejects(new CompetitorSites(f.db,await f.member('viewer')).checkNow({key}),error=>error.status===403);
 await assert.rejects(new CompetitorSites(f.db,f.scope).checkNow({key:'unknown'}),error=>error.status===404||error.status===429);
}));
