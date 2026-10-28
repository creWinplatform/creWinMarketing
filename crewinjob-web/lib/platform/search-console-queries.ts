import 'server-only';
// Read-only Search Console query report (top queries by impressions) for the growth coach. Values are
// returned exactly as reported; nothing is estimated when the provider has no rows.
export type SearchConsoleQuery={query:string;clicks:number;impressions:number;position:number};
export type SearchConsoleQueryReader=(input:{resource:string;token:string;from:string;to:string})=>Promise<SearchConsoleQuery[]>;
const metric=(value:unknown,max=1e12)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max)throw new Error('Invalid provider metric.');return value;};
export const readSearchConsoleQueries:SearchConsoleQueryReader=async input=>{
  if(!/^sc-domain:[a-z0-9.-]+$/i.test(input.resource)){const site=new URL(input.resource);if(!['https:','http:'].includes(site.protocol)||site.username||site.password||site.hash||site.search)throw new Error('Invalid site.');}
  const response=await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.resource)}/searchAnalytics/query`,{method:'POST',headers:{Authorization:`Bearer ${input.token}`,'Content-Type':'application/json'},body:JSON.stringify({startDate:input.from,endDate:input.to,dimensions:['query'],type:'web',dataState:'final',rowLimit:50}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok){await response.body?.cancel();throw new Error('Provider report unavailable.');}
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty response.');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>262144)throw new Error('Provider response too large.');chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const rows=JSON.parse(Buffer.concat(chunks).toString('utf8')).rows||[];if(!Array.isArray(rows)||rows.length>50)throw new Error('Invalid provider rows.');
  return rows.map((row:{keys?:unknown;clicks?:unknown;impressions?:unknown;position?:unknown})=>{
    const query=Array.isArray(row.keys)&&typeof row.keys[0]==='string'?row.keys[0].trim():'';if(!query||query.length>200||/[\x00-\x1f]/.test(query))throw new Error('Invalid query.');
    return {query,clicks:metric(row.clicks),impressions:metric(row.impressions),position:metric(row.position,1000)};
  });
};
// Site totals for one date range (no dimensions): one row, or none when the property has no data.
export type SearchConsoleTotals={clicks:number;impressions:number}|null;
export type SearchConsoleTotalsReader=(input:{resource:string;token:string;from:string;to:string})=>Promise<SearchConsoleTotals>;
export const readSearchConsoleTotals:SearchConsoleTotalsReader=async input=>{
  if(!/^sc-domain:[a-z0-9.-]+$/i.test(input.resource)){const site=new URL(input.resource);if(!['https:','http:'].includes(site.protocol)||site.username||site.password||site.hash||site.search)throw new Error('Invalid site.');}
  const response=await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.resource)}/searchAnalytics/query`,{method:'POST',headers:{Authorization:`Bearer ${input.token}`,'Content-Type':'application/json'},body:JSON.stringify({startDate:input.from,endDate:input.to,dataState:'final'}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw new Error('Provider report unavailable.');}
  const text=await response.text();if(text.length>65536)throw new Error('Provider response too large.');
  const rows=JSON.parse(text).rows||[];if(!Array.isArray(rows)||rows.length>1)throw new Error('Invalid provider rows.');
  return rows.length?{clicks:metric(rows[0].clicks),impressions:metric(rows[0].impressions)}:null;
};
