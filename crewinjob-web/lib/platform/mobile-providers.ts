import 'server-only';
import { JWT } from 'google-auth-library';
import { mobileRecord as rec,mobileText } from './mobile-validation';
import type { MobileApp,MobileProvider,MobileStoreSnapshot } from './mobile-types';

export type MobileSecret=Record<string,unknown>;
export type MobileTransport=(url:string,init?:RequestInit)=>Promise<Response>;
async function json(response:Response){
  if(!response.ok){await response.body?.cancel();throw new Error('Provider unavailable.');}
  const reader=response.body?.getReader();if(!reader)throw new Error();let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>512*1024)throw new Error();chunks.push(part.value);}}finally{await reader.cancel();}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid response.');return value as Record<string,unknown>;
}
const request=(read:MobileTransport,url:string,init:RequestInit={})=>read(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});
export function googleServiceAccount(value:unknown){
  const raw=rec(value);if(raw.type!=='service_account'||typeof raw.project_id!=='string'||!/^[a-z][a-z0-9-]{4,62}$/.test(raw.project_id)||typeof raw.client_email!=='string'||!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+\.gserviceaccount\.com$/.test(raw.client_email)||typeof raw.private_key!=='string'||raw.private_key.length>8192||!raw.private_key.startsWith('-----BEGIN PRIVATE KEY-----'))throw new Error('Service account required.');
  return {project_id:raw.project_id,client_email:raw.client_email,private_key:raw.private_key};
}
export async function mobileGoogleAccess(secret:MobileSecret,scope:string){
  const account=googleServiceAccount(secret.serviceAccount),client=new JWT({email:account.client_email,key:account.private_key,scopes:[scope]});
  let timer:ReturnType<typeof setTimeout>|undefined;
  const result=await Promise.race([client.getAccessToken(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Token timeout.')),10000);})]).finally(()=>clearTimeout(timer));
  if(!result.token)throw new Error('Token unavailable.');return result.token;
}
export function validateMobileIntegration(provider:MobileProvider,raw:unknown,secretRaw:unknown,app:MobileApp){
  const value=rec(raw),secret=rec(secretRaw),config:Record<string,string>={},credentials:MobileSecret={};
  if(['bridge','appsflyer','adjust','revenuecat'].includes(provider)){
    const key=mobileText(secret.webhookSecret,256);if(key.length<32||/[\r\n]/.test(key))throw new Error('Use a random webhook authorization secret of at least 32 characters.');credentials.webhookSecret=key;
    if(provider!=='bridge'){config.externalAppId=mobileText(value.externalAppId,200);if(!/^[a-zA-Z0-9_.-]+$/.test(config.externalAppId))throw new Error('Invalid app identity.');}
  }
  if(provider==='onesignal'){
    config.appId=mobileText(value.appId,36);if(!/^[a-f0-9-]{36}$/.test(config.appId))throw new Error('OneSignal app UUID required.');credentials.apiKey=mobileText(secret.apiKey,4096);
  }
  if(provider==='firebase'||provider==='google_play'){
    const account=googleServiceAccount(secret.serviceAccount);credentials.serviceAccount={type:'service_account',...account};config.projectId=account.project_id;
    if(provider==='google_play'){if(!app.packageName)throw new Error('Android package required.');config.editId=mobileText(value.editId,100);if(!/^[a-zA-Z0-9_-]+$/.test(config.editId))throw new Error('Existing Publisher edit ID required.');}
  }
  if(provider==='branch'){
    const key=mobileText(secret.branchKey,256);if(!/^key_(live|test)_[a-zA-Z0-9]+$/.test(key))throw new Error('Branch key required.');credentials.branchKey=key;
    config.linkDomain=mobileText(value.linkDomain,200).toLowerCase();if(!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(config.linkDomain)||!(config.linkDomain.endsWith('.app.link')||config.linkDomain===new URL(app.website).hostname))throw new Error('Branch app.link or declared website domain required.');
  }
  if(JSON.stringify(credentials).length>12000)throw new Error('Credentials too large.');return {config,credentials};
}
export async function probeMobileIntegration(provider:MobileProvider,config:Record<string,string>,secret:MobileSecret,read:MobileTransport=fetch):Promise<string>{
  if(provider==='onesignal'){
    const value=await json(await request(read,`https://api.onesignal.com/apps/${config.appId}`,{headers:{Authorization:`Key ${secret.apiKey}`}}));
    if(value.id!==config.appId)throw new Error('App mismatch.');return 'access_verified';
  }
  if(provider==='firebase'){await mobileGoogleAccess(secret,'https://www.googleapis.com/auth/firebase.messaging');return 'credential_verified';}
  return ['bridge','appsflyer','adjust','revenuecat'].includes(provider)?'awaiting_event':'sdk_required';
}
export type MobilePushResult={state:'accepted'|'rejected'|'uncertain';providerId?:string};
export async function sendMobilePush(input:{provider:'onesignal'|'firebase';config:Record<string,string>;secret:MobileSecret;destination:string;title:string;body:string;path:string;idempotencyKey:string},read:MobileTransport=fetch,getToken=mobileGoogleAccess):Promise<MobilePushResult>{
  let response:Response;
  try{
    if(input.provider==='onesignal'){
      response=await request(read,'https://api.onesignal.com/notifications',{method:'POST',headers:{Authorization:`Key ${input.secret.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({app_id:input.config.appId,target_channel:'push',include_aliases:{external_id:[input.destination]},headings:{en:input.title},contents:{en:input.body},data:{ryzevo_path:input.path},idempotency_key:input.idempotencyKey})});
    }else{
      const token=await getToken(input.secret,'https://www.googleapis.com/auth/firebase.messaging');
      response=await request(read,`https://fcm.googleapis.com/v1/projects/${input.config.projectId}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({message:{token:input.destination,notification:{title:input.title,body:input.body},data:{ryzevo_path:input.path,ryzevo_id:input.idempotencyKey}}})});
    }
    if(!response.ok){const status=response.status;await response.body?.cancel();return {state:[400,401,403,404,422,429].includes(status)?'rejected':'uncertain'};}
    const value=await json(response),id=input.provider==='onesignal'?value.id:value.name;
    if(typeof id!=='string'||id.length>250||!id||value.errors||value.error)return {state:'uncertain'};
    if(input.provider==='firebase'&&!id.startsWith(`projects/${input.config.projectId}/messages/`))return {state:'uncertain'};
    return {state:'accepted',providerId:id};
  }catch{return {state:'uncertain'};}
}
export function asoFindings(store:string,title:string,subtitle:string,description:string,screenshots:number|null){
  const findings:MobileStoreSnapshot['findings']=[],add=(code:string,priority:'low'|'medium'|'high',evidence:string,recommendation:string)=>findings.push({code,priority,evidence,recommendation});
  if(!title)add('aso.title_missing','high','Başlık boş.','Mağaza başlığını tanımlayın.');
  else if([...title].length>30)add('aso.title_length','medium',`Başlık ${[...title].length} karakter.`,`Başlığı ${store==='ios'?'App Store':'Google Play'} sınırına göre gözden geçirin (30 karakter).`);
  if(!description)add('aso.description_missing','high','Açıklama boş.','Uygulamanın değerini ve temel kullanımını açıklayın.');
  if(store==='android'&&!subtitle)add('aso.short_description_missing','medium','Kısa açıklama yok.','Google Play kısa açıklamasını tamamlayın.');
  if(subtitle&&[...subtitle].length>(store==='ios'?30:80))add('aso.subtitle_length','medium',`Alt/kısa açıklama ${[...subtitle].length} karakter.`,`En fazla ${store==='ios'?30:80} karakter kullanın.`);
  if(screenshots===0)add('aso.screenshots_missing','medium','0 ekran görüntüsü bildirildi.','Gerçek ürün ekran görüntülerini mağaza kaydına ekleyin.');
  return findings;
}
export async function readAppleListing(app:MobileApp,read:MobileTransport=fetch){
  if(!app.appleId)throw new Error('Apple store ID missing.');
  const payload=await json(await request(read,`https://itunes.apple.com/lookup?id=${app.appleId}&country=${app.country.toLowerCase()}&entity=software`)),rows=payload.results;
  if(!Array.isArray(rows)||rows.length!==1)throw new Error('Listing not found.');const row=rec(rows[0]);
  if(String(row.trackId)!==app.appleId||row.wrapperType!=='software'||app.bundleId&&row.bundleId!==app.bundleId)throw new Error('App mismatch.');
  return {title:mobileText(row.trackName,300),subtitle:'',description:mobileText(row.description,20000,true),screenshotCount:Array.isArray(row.screenshotUrls)?row.screenshotUrls.length:null};
}
export async function readPlayListing(app:MobileApp,config:Record<string,string>,secret:MobileSecret,read:MobileTransport=fetch,getToken=mobileGoogleAccess){
  if(!app.packageName||!config.editId)throw new Error('Publisher edit required.');
  const token=await getToken(secret,'https://www.googleapis.com/auth/androidpublisher');
  const row=await json(await request(read,`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${app.packageName}/edits/${config.editId}/listings/${app.locale}`,{headers:{Authorization:`Bearer ${token}`}}));
  if(row.language!==app.locale)throw new Error('Locale mismatch.');
  return {title:mobileText(row.title,300),subtitle:mobileText(row.shortDescription,500,true),description:mobileText(row.fullDescription,20000,true),screenshotCount:null};
}
export async function createBranchLink(app:MobileApp,config:Record<string,string>,secret:MobileSecret,input:{id:string;path:string;campaignId:string},read:MobileTransport=fetch){
  const value=await json(await request(read,'https://api2.branch.io/v1/url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({branch_key:secret.branchKey,alias:`rz-${input.id}`,channel:'ryzevo',campaign:input.campaignId,feature:'marketing',data:{$deeplink_path:input.path.slice(1),$fallback_url:app.website,...(app.appleId?{$ios_url:`https://apps.apple.com/${app.country.toLowerCase()}/app/id${app.appleId}`}:{ }),...(app.packageName?{$android_url:`https://play.google.com/store/apps/details?id=${app.packageName}`}:{})}})}));
  if(typeof value.url!=='string')throw new Error('No link.');const url=new URL(value.url);
  if(url.protocol!=='https:'||url.hostname!==config.linkDomain||url.username||url.password||url.port||url.search||url.hash)throw new Error('Link domain mismatch.');return url.href;
}
