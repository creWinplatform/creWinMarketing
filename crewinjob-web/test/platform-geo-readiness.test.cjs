const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
// AI search readiness (GEO): fixed checks on robots.txt and page HTML, and the llms.txt draft. No network is used.
const {blockedAiSearchBots,inspectHtml,GEO_CATEGORY}=load('../site-audit.ts');
const {SeoOperations}=load('seo-operations.ts');
const titles=(html,path='/')=>plain(inspectHtml(html,new URL(`https://example.com${path}`),200,[]).findings.filter(item=>item.category===GEO_CATEGORY).map(item=>item.title));
const page=(body,head='')=>`<!doctype html><html><head><title>Mahalle kafesi menü ve saatler</title>${head}</head><body>${body}</body></html>`;
const text='<h1>Mahalle Kafesi</h1><p>'+'Nitelikli kahve, ev yapımı tatlılar ve sakin bir çalışma köşesi. '.repeat(6)+'</p><a href="/rezervasyon">Rezervasyon</a>';
const org='<script type="application/ld+json">{"@context":"https://schema.org","@type":"CafeOrCoffeeShop","name":"Mahalle Kafesi"}</script>';

test('only AI search crawlers that are disallowed from the whole site are reported',()=>{
  assert.deepEqual(plain(blockedAiSearchBots('User-agent: *\nAllow: /')),[]);
  assert.deepEqual(plain(blockedAiSearchBots('User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /')),[],'training crawlers are a separate choice');
  assert.deepEqual(plain(blockedAiSearchBots('User-agent: OAI-SearchBot\nUser-agent: PerplexityBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin')),['OAI-SearchBot','PerplexityBot'],'a group can name several agents');
  assert.deepEqual(plain(blockedAiSearchBots('User-agent: *\nDisallow: /\n\nUser-agent: PerplexityBot\nAllow: /')),['OAI-SearchBot','ChatGPT-User','Claude-SearchBot'],'a bot with its own group follows that group, others fall back to *');
  assert.deepEqual(plain(blockedAiSearchBots('# comment\nuser-agent: claude-searchbot  \ndisallow: / # all\n')),['Claude-SearchBot'],'names and fields are case-insensitive, comments ignored');
  assert.deepEqual(plain(blockedAiSearchBots('User-agent: ChatGPT-User\nDisallow: /private')),[],'a partial disallow is not a block');
});

test('pages are checked for readable text without JavaScript and for structured data',()=>{
  assert.deepEqual(titles(page(text,org)),[],'a readable page with business markup passes');
  assert.deepEqual(titles(page('<div id="root"></div><script src="/app.js"></script>',org)),['Sayfa içeriği JavaScript olmadan okunamıyor']);
  assert.deepEqual(titles(page('<div id="root"></div>')),['Yapılandırılmış veri yok'],'an empty page without scripts is not a JavaScript problem');
  assert.deepEqual(titles(page('<p>This domain is for use in documentation examples.</p><script src=/s.js></script>',org)),[],'a short static page with one script is not an app shell');
  assert.deepEqual(titles(page('<main></main><noscript>Please enable JavaScript to use this app.</noscript><script src=/a.js></script>',org)),['Sayfa içeriği JavaScript olmadan okunamıyor'],'a noscript notice marks an app shell');
  assert.deepEqual(titles(page(text)),['Yapılandırılmış veri yok']);
  assert.deepEqual(titles(page(text,'<script type="application/ld+json">{"@type":"WebSite","name":"x"}</script>')),['Kurum bilgisi işaretlenmemiş'],'the home page should say who runs the site');
  assert.deepEqual(titles(page(text,'<script type="application/ld+json">{"@type":"WebSite"}</script>'),'/menu'),[],'only the home page needs organization markup');
  assert.deepEqual(titles(page(text,'<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Organization","Brand"]}]}</script>')),[],'@graph and type lists are read');
  const [finding]=inspectHtml(page('<div id="root"></div><script src="/a.js"></script><script src="/b.js"></script>',org),new URL('https://example.com/'),200,[]).findings.filter(item=>item.category===GEO_CATEGORY);
  assert.match(finding.evidence,/script etiketi: 2/);
});

test('the llms.txt draft uses only what the project knows and the pages the last scan read',coachRun(async f=>{
  const deps={discover:async origin=>({baseUrl:origin,urls:['https://example.com/','https://example.com/menu','https://example.com/iletisim'],source:'sitemap',discoveredCount:3}),audit:async()=>({ok:true,httpStatus:200,findings:[]})};
  const seo=(scope=f.scope)=>new SeoOperations(f.db,scope,deps);
  let draft=seo().llmsDraft();
  assert.match(draft.text,/^# alpha\n\n> Describe your business|^# alpha\n\n> Bu satıra/,'no invented summary before a strategy exists');
  assert.equal(draft.hasSummary,false);assert.equal(draft.fromScan,false);assert.match(draft.text,/\[(Ana sayfa|Home page)\]\(https:\/\/example\.com\/\)/);
  await f.approve();
  let snapshot=await seo().start();for(let i=0;i<5&&snapshot.scan.state==='running';i++)snapshot=await seo().step();
  draft=seo().llmsDraft();
  assert.equal(draft.fromScan,true);assert.equal(draft.pages,3);assert.equal(draft.hasSummary,true);
  assert.match(draft.text,/- \[menu\]\(https:\/\/example\.com\/menu\)/);assert.match(draft.text,/- \[iletisim\]\(https:\/\/example\.com\/iletisim\)/);
  const brief=f.db.prepare('SELECT brief_json FROM platform_growth_coach').get().brief_json;assert.ok(draft.text.includes(JSON.parse(brief).positioning.slice(0,40)),'the summary is the approved positioning');
  assert.doesNotMatch(draft.text,/\d+\s*%|guarantee|garanti/i);
  assert.ok(seo(f.member('viewer')).llmsDraft().text,'readers can see the draft');
  assert.doesNotMatch(new SeoOperations(f.db,f.other,deps).llmsDraft().text,/example\.com\/menu/,'another project never sees these pages');
}));
