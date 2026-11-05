import 'server-only';
import type Database from 'better-sqlite3';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { googleAdsConfigured } from './ad-providers';
import type { LocalizedText } from './catalog';
import type { GoLiveItem,GoLiveView } from './go-live-types';

// What stands between the project and live use, read from its own records and the server's switches: per channel, ad
// account and mobile connection, whether it is connected, checked and switched on, and the next step. Nothing is sent
// and no secret is shown; a switch is only reported as on or off.
const l=(tr:string,en:string):LocalizedText=>({tr,en});
const on=(name:string)=>process.env[name]==='1';
const configured=(...names:string[])=>names.every(name=>Boolean(process.env[name]?.trim()));
const DAY=86400000;
type Scope={subject:string;organizationId:string;projectId:string};

export function goLiveStatus(db:Database.Database,scope:Scope,now=Date.now()):GoLiveView{
  const repo=new PlatformRepository(db),args=[scope.organizationId,scope.projectId] as const;
  if(!repo.can(scope.subject,...args,'connections.manage')||repo.workspace(scope.subject,...args)?.project.productPack!=='standard')throw new MarketingStoreError('Canlıya geçiş durumunu yalnız bağlantı yöneticileri görebilir.',403);
  const items:GoLiveItem[]=[],add=(item:GoLiveItem)=>items.push(item);
  const connection=(provider:string)=>db.prepare('SELECT id,account_name,updated_at FROM platform_connections WHERE organization_id=? AND project_id=? AND provider=? AND active=1 ORDER BY updated_at DESC LIMIT 1').get(...args,provider) as {id:string;account_name:string;updated_at:string}|undefined;
  const has=(table:string)=>Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));

  // Social channels: a connected account per platform, its grant, and the server's publishing switch.
  const accounts=db.prepare("SELECT a.platform,a.expires_at,c.account_name FROM platform_social_accounts a JOIN platform_connections c ON c.id=a.connection_id WHERE c.organization_id=? AND c.project_id=? AND c.active=1").all(...args) as {platform:string;expires_at:number|null;account_name:string}[];
  const channelApps:Record<string,string[]>={tiktok:['PLATFORM_TIKTOK_CLIENT_KEY','PLATFORM_TIKTOK_CLIENT_SECRET','PLATFORM_TIKTOK_REDIRECT_URI'],pinterest:['PLATFORM_PINTEREST_CLIENT_ID','PLATFORM_PINTEREST_CLIENT_SECRET','PLATFORM_PINTEREST_REDIRECT_URI'],youtube:['PLATFORM_YOUTUBE_CLIENT_ID','PLATFORM_YOUTUBE_CLIENT_SECRET','PLATFORM_YOUTUBE_REDIRECT_URI']};
  const names:Record<string,string>={linkedin:'LinkedIn',facebook:'Facebook',instagram:'Instagram',twitter:'X',tiktok:'TikTok',pinterest:'Pinterest',youtube:'YouTube'};
  for(const platform of ['linkedin','facebook','instagram','twitter','tiktok','pinterest','youtube']){
    const account=accounts.find(item=>item.platform===platform),app=channelApps[platform];
    if(app&&!configured(...app)&&!account){add({id:`social:${platform}`,group:'social',label:l(names[platform],names[platform]),state:'optional',detail:l('Bu sunucuda uygulama bilgileri tanımlı değil (yöneticinin işi). Kanalı kullanmayacaksanız gerekmez.','The app credentials are not set on this server (an administrator task). Not needed if you will not use this channel.'),href:'/?tab=project&settings=connections'});continue;}
    if(!account){add({id:`social:${platform}`,group:'social',label:l(names[platform],names[platform]),state:'optional',detail:l('Bağlı hesap yok. Kullanacaksanız Bağlantılar’dan bağlayın.','No connected account. Connect it under Connections if you will use it.'),href:'/?tab=project&settings=connections'});continue;}
    const expiring=account.expires_at&&account.expires_at-now<7*DAY;
    add({id:`social:${platform}`,group:'social',label:l(names[platform],names[platform]),state:expiring?'action':'ready',detail:expiring?l(`“${account.account_name}” bağlı; izni ${account.expires_at!<=now?'bitti':'7 gün içinde bitiyor'}. Yeniden bağlayın.`,`“${account.account_name}” is connected; its grant ${account.expires_at!<=now?'has ended':'ends within 7 days'}. Reconnect it.`):l(`“${account.account_name}” bağlı.`,`“${account.account_name}” is connected.`),href:'/?tab=project&settings=connections'});
  }
  add({id:'switch:social',group:'social',label:l('Gerçek yayın anahtarı','Live publishing switch'),state:on('PLATFORM_SOCIAL_PUBLISH_ENABLED')?'ready':'off',detail:on('PLATFORM_SOCIAL_PUBLISH_ENABLED')?l('Açık: onaylı gönderiler gerçekten yayınlanır.','On: approved posts are really published.'):l('Kapalı (PLATFORM_SOCIAL_PUBLISH_ENABLED): yalnız prova yapılır.','Off (PLATFORM_SOCIAL_PUBLISH_ENABLED): rehearsals only.'),switch:'PLATFORM_SOCIAL_PUBLISH_ENABLED'});

  // Ad accounts: connected and checked, a budget cap, plans created, and the server's start and image switches.
  const adNames:Record<string,[string,string]>={meta:['Meta','meta_ads'],google:['Google Ads','google_ads'],linkedin:['LinkedIn','linkedin_ads'],tiktok:['TikTok','tiktok_ads'],apple_search:['Apple Search Ads','apple_search_ads']};
  for(const [provider,[name,kind]] of Object.entries(adNames)){
    const account=connection(kind),policy=has('platform_ad_policies')?db.prepare('SELECT 1 FROM platform_ad_policies WHERE organization_id=? AND project_id=? AND provider=?').get(...args,provider):null;
    const plans=(db.prepare('SELECT COUNT(*) n FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND provider=? AND provider_campaign_id IS NOT NULL').get(...args,provider) as {n:number}).n;
    const href=`/?tab=campaigns&campaignView=ads&provider=${provider}`;
    if(provider==='google'&&!googleAdsConfigured()){add({id:`ads:${provider}`,group:'ads',label:l(name,name),state:'optional',detail:l('Sunucuda Google Ads geliştirici anahtarı yok (yöneticinin işi).','No Google Ads developer token on the server (an administrator task).'),href});continue;}
    if(!account){add({id:`ads:${provider}`,group:'ads',label:l(name,name),state:'optional',detail:l('Reklam hesabı bağlı değil.','No ad account connected.'),href});continue;}
    add({id:`ads:${provider}`,group:'ads',label:l(name,name),state:policy?'ready':'action',detail:policy?l(`“${account.account_name}” bağlı, bütçe tavanı var · sağlayıcıda ${plans} plan.`,`“${account.account_name}” connected with budget caps · ${plans} plan(s) on the provider.`):l(`“${account.account_name}” bağlı; önce bütçe tavanı belirleyin.`,`“${account.account_name}” connected; set the budget caps first.`),href,verify:{kind:'ads',provider}});
  }
  for(const [name,label] of [['PLATFORM_ADS_ENABLED',l('Reklam yayınını başlatma anahtarı','Ad delivery start switch')],['PLATFORM_AD_CREATIVES_ENABLED',l('Reklam görseli ve videosu gönderme anahtarı','Ad image and video sending switch')]] as const)
    add({id:`switch:${name}`,group:'ads',label,state:on(name)?'ready':'off',detail:on(name)?l('Açık.','On.'):l(`Kapalı (${name}). Planlar ve görseller hazırlanıp onaylanabilir.`,`Off (${name}). Plans and images can still be prepared and approved.`),switch:name});

  // Mobile apps: each app's connections, whether they were checked or sent events, and the mobile switches.
  if(has('platform_mobile_apps')){
    const apps=db.prepare('SELECT id,config_json FROM platform_mobile_apps WHERE organization_id=? AND project_id=? ORDER BY created_at,id').all(...args) as {id:string;config_json:string}[];
    const labels:Record<string,string>={bridge:'Server Bridge',appsflyer:'AppsFlyer',adjust:'Adjust',onesignal:'OneSignal',firebase:'Firebase FCM',branch:'Branch',revenuecat:'RevenueCat',google_play:'Google Play',app_store_connect:'App Store Connect',appsflyer_skan:'AppsFlyer SKAN'};
    for(const app of apps){
      const config=JSON.parse(app.config_json) as {name:string;platform:string;attributionProvider:string;appleId:string;packageName:string};
      const integrations=db.prepare("SELECT i.connection_id,i.kind,i.status,i.checked_at,i.last_event_at,c.active FROM platform_mobile_integrations i JOIN platform_connections c ON c.id=i.connection_id WHERE i.app_id=? AND i.organization_id=? AND i.project_id=?").all(app.id,...args) as {connection_id:string;kind:string;status:string;checked_at:string|null;last_event_at:string|null;active:number}[];
      const wanted=[config.attributionProvider||'bridge',...(config.platform!=='android'&&config.appleId?['app_store_connect']:[]),...(config.platform!=='ios'&&config.packageName?['google_play']:[])];
      const push=integrations.find(item=>item.active&&['onesignal','firebase'].includes(item.kind));
      for(const kind of [...new Set([...wanted,...integrations.filter(item=>item.active).map(item=>item.kind)])]){
        const row=integrations.find(item=>item.kind===kind&&item.active),label=l(`${config.name} · ${labels[kind]||kind}`,`${config.name} · ${labels[kind]||kind}`),href='/?tab=mobile&mobileSection=connections';
        if(!row){add({id:`mobile:${app.id}:${kind}`,group:'mobile',label,state:'action',detail:l('Bağlantı kurulmadı.','Not set up.'),href});continue;}
        const webhook=['bridge','appsflyer','adjust','revenuecat'].includes(kind),good=webhook?Boolean(row.last_event_at):['access_verified','credential_verified','report_read','credential_saved'].includes(row.status);
        add({id:`mobile:${app.id}:${kind}`,group:'mobile',label,state:good?'ready':'action',detail:webhook?(row.last_event_at?l(`Son olay: ${row.last_event_at.slice(0,16).replace('T',' ')} UTC.`,`Last event: ${row.last_event_at.slice(0,16).replace('T',' ')} UTC.`):l('Kayıtlı ama henüz olay gelmedi. Uygulama tarafındaki kurulumu tamamlayın.','Saved, but no event has arrived yet. Finish the setup on the app side.')):good?l('Erişim doğrulandı.','Access verified.'):l('Kaydedildi; “Doğrula” ile erişimi test edin.','Saved; test access with “Verify”.'),href,...(webhook?{}:{verify:{kind:'mobile' as const,id:row.connection_id}})});
      }
      if(!push)add({id:`mobile:${app.id}:push`,group:'mobile',label:l(`${config.name} · bildirim`,`${config.name} · push`),state:'optional',detail:l('OneSignal veya Firebase bağlı değil; bildirim gönderilmez.','No OneSignal or Firebase connection; no push can be sent.'),href:'/?tab=mobile&mobileSection=connections'});
    }
    if(apps.length)for(const [name,label] of [['PLATFORM_MOBILE_SEND_ENABLED',l('Mobil gerçek gönderim anahtarı','Mobile live send switch')],['PLATFORM_MOBILE_BROADCAST_ENABLED',l('Pilot dışı mobil gönderim anahtarı','Mobile broadcast switch')],['PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED',l('Mağaza kaydına yazma anahtarı','Store listing write switch')],['PLATFORM_MOBILE_REVIEW_REPLY_ENABLED',l('Yorum yanıtı yayınlama anahtarı','Review reply publishing switch')]] as const)
      add({id:`switch:${name}`,group:'mobile',label,state:on(name)?'ready':'off',detail:on(name)?l('Açık.','On.'):l(`Kapalı (${name}).`,`Off (${name}).`),switch:name});
  }

  // Messages and measurement: email sender, WhatsApp, IYS, Google Analytics and Search Console.
  const email=connection('email'),whatsapp=connection('whatsapp'),ga=connection('ga4'),gsc=connection('search_console');
  add({id:'msg:email',group:'messages',label:l('E-posta gönderici','Email sender'),state:email?'ready':'optional',detail:email?l(`“${email.account_name}” bağlı.`,`“${email.account_name}” connected.`):l('Gönderici bağlı değil.','No sender connected.'),href:'/?tab=campaigns&campaignView=sender'});
  add({id:'msg:whatsapp',group:'messages',label:l('WhatsApp','WhatsApp'),state:whatsapp?'ready':'optional',detail:whatsapp?l(`“${whatsapp.account_name}” bağlı.`,`“${whatsapp.account_name}” connected.`):l('WhatsApp hesabı bağlı değil.','No WhatsApp account connected.'),href:'/?tab=campaigns&campaignView=whatsapp'});
  if(has('platform_iys_settings')){const iys=db.prepare('SELECT scope FROM platform_iys_settings WHERE organization_id=? AND project_id=?').get(...args) as {scope:string|null}|undefined;
    add({id:'msg:iys',group:'messages',label:l('İYS beyanı','IYS declaration'),state:iys?.scope?'ready':'action',detail:iys?.scope?l('Beyan verildi.','Declared.'):l('Türkiye’deki alıcılara ticari ileti gönderip göndermediğinizi beyan edin; beyan yoksa canlı gönderim açılmaz.','Declare whether you send commercial messages to recipients in Türkiye; without it live sending stays off.'),href:'/?tab=project&settings=iys'});}
  for(const [name,label] of [['PLATFORM_EMAIL_PILOT_SEND_ENABLED',l('E-posta gerçek gönderim anahtarı','Email live send switch')],['PLATFORM_WHATSAPP_SEND_ENABLED',l('WhatsApp gerçek gönderim anahtarı','WhatsApp live send switch')]] as const)
    add({id:`switch:${name}`,group:'messages',label,state:on(name)?'ready':'off',detail:on(name)?l('Açık.','On.'):l(`Kapalı (${name}): yalnız prova yapılır.`,`Off (${name}): rehearsals only.`),switch:name});
  add({id:'measure:ga4',group:'measurement',label:l('Google Analytics 4','Google Analytics 4'),state:ga?'ready':'action',detail:ga?l(`“${ga.account_name}” bağlı.`,`“${ga.account_name}” connected.`):l('Bağlı değil; paylaşımlardan siteye gelen oturumlar ölçülmez.','Not connected; site sessions from posts are not measured.'),href:'/?tab=project&settings=connections'});
  add({id:'measure:gsc',group:'measurement',label:l('Google Search Console','Google Search Console'),state:gsc?'ready':'optional',detail:gsc?l(`“${gsc.account_name}” bağlı.`,`“${gsc.account_name}” connected.`):l('Bağlı değil; arama performansı okunmaz.','Not connected; search performance is not read.'),href:'/?tab=project&settings=connections'});

  const groups=['social','ads','mobile','messages','measurement'] as const;
  return {items,checkedAt:new Date(now).toISOString(),summary:groups.map(group=>{const list=items.filter(item=>item.group===group&&item.state!=='optional');return {group,ready:list.filter(item=>item.state==='ready').length,total:list.length,action:items.filter(item=>item.group===group&&item.state==='action').length};})};
}
