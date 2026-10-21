// Published reference values for the budget planner. Each value is quoted from its source page as published, with the
// page's own update date. They are all-industry averages from one vendor's customer campaigns; the pages state neither
// the region nor the data period, and show amounts only with "$". They are context for a range, never a forecast, and
// are not converted to other currencies.
export type Benchmark={id:string;channel:'google_search'|'meta_traffic'|'meta_leads';metric:'cpc'|'conversion'|'ctr'|'cpl';value:number;unit:'USD'|'ratio'};
export type BenchmarkSource={name:string;url:string;updated:string;scope:{tr:string;en:string}};
export const BENCHMARK_SOURCES:Record<'search'|'meta',BenchmarkSource>={
  search:{name:'LocaliQ – Search Advertising Benchmarks',url:'https://localiq.com/blog/search-advertising-benchmarks/',updated:'2026-06-01',
    scope:{tr:'Google Ads ve Microsoft Ads müşteri kampanyaları, 20+ sektörün ortalaması; bölge ve veri dönemi belirtilmemiş, tutarlar “$” ile.',en:'Google Ads and Microsoft Ads customer campaigns, average of 20+ industries; region and data period not stated, amounts shown with “$”.'}},
  meta:{name:'LocaliQ – Facebook Advertising Benchmarks',url:'https://localiq.com/blog/facebook-advertising-benchmarks/',updated:'2026-09-23',
    scope:{tr:'Facebook reklam kampanyaları, 20 sektörün ortalaması; bölge ve veri dönemi belirtilmemiş, tutarlar “$” ile.',en:'Facebook ad campaigns, average of 20 industries; region and data period not stated, amounts shown with “$”.'}},
};
export const BENCHMARKS:readonly Benchmark[]=[
  {id:'search-cpc',channel:'google_search',metric:'cpc',value:5.42,unit:'USD'},
  {id:'search-conversion',channel:'google_search',metric:'conversion',value:0.0818,unit:'ratio'},
  {id:'search-ctr',channel:'google_search',metric:'ctr',value:0.0664,unit:'ratio'},
  {id:'search-cpl',channel:'google_search',metric:'cpl',value:66.69,unit:'USD'},
  {id:'meta-traffic-cpc',channel:'meta_traffic',metric:'cpc',value:0.6,unit:'USD'},
  {id:'meta-traffic-ctr',channel:'meta_traffic',metric:'ctr',value:0.0193,unit:'ratio'},
  {id:'meta-leads-cpc',channel:'meta_leads',metric:'cpc',value:1.8,unit:'USD'},
  {id:'meta-leads-conversion',channel:'meta_leads',metric:'conversion',value:0.0854,unit:'ratio'},
  {id:'meta-leads-cpl',channel:'meta_leads',metric:'cpl',value:27.39,unit:'USD'},
];
export const benchmarkSource=(item:Benchmark)=>BENCHMARK_SOURCES[item.channel==='google_search'?'search':'meta'];
// Widens a range so it also covers a reference value; the team's own ends are kept.
export const includeValue=(range:{low:number;high:number},value:number)=>({low:Math.min(range.low,value),high:Math.max(range.high,value)});
