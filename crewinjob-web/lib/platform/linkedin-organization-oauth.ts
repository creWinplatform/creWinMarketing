import 'server-only';
import type Database from 'better-sqlite3';
import { OAuthRequests } from './oauth-requests';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { linkedinClient } from './linkedin-client';
import { linkedinOrganizationConfiguration } from './linkedin-organization-publishing';
import { organizationPageBatch, organizationId, readLinkedInOrganizationJson, type LinkedInPage, type LinkedInReader } from './linkedin-organizations';

export const LINKEDIN_ORGANIZATION_SELECTION_COOKIE='platform_linkedin_organization_selection';
type Grant={accessToken:string;expiresAt:number;memberSub:string;publishing:boolean;revision:string;version:string;pages:LinkedInPage[];next:number;hasMore:boolean;loaded:boolean};
export class LinkedInOrganizationOAuth {
  private requests:OAuthRequests;
  constructor(private db:Database.Database,private scope:MarketingScope,private key:string,private clientFactory=linkedinClient,private read:LinkedInReader=readLinkedInOrganizationJson){this.requests=new OAuthRequests(db,scope,key);}
  start(publishing=false){
    new ProjectMarketingStore(this.db,this.scope).connections();
    if(typeof publishing!=='boolean')throw new MarketingStoreError('Geçerli yayın izni seçimi gerekli.');
    const config=linkedinOrganizationConfiguration(),client=this.clientFactory();
    const result=this.requests.create('linkedin_organization','','LinkedIn organization',{publishing,revision:config.revision});
    return {browser:result.browser,authorizationUrl:client.authorizationUrl(result.state,publishing,'organization')};
  }
  async complete(state:string,browser:string,code:string){
    if(!code||code.length>4096)throw new MarketingStoreError('Yetkilendirme kodu geçersiz.');
    const pending=this.requests.claim(state,browser,['linkedin_organization']);
    try{
      const secret=this.requests.secret<{publishing:boolean;revision:string}>(pending),config=linkedinOrganizationConfiguration();
      if(config.revision!==secret.revision)throw new Error();
      const token=await this.clientFactory().exchange(code),profile=await this.read('https://api.linkedin.com/v2/userinfo',token.accessToken);
      if(typeof profile.sub!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(profile.sub)||linkedinOrganizationConfiguration().revision!==config.revision)throw new Error();
      return this.requests.finish(pending,()=>{
        const selected=this.requests.create('linkedin_organization_selection','','LinkedIn organization',{...token,memberSub:profile.sub,publishing:secret.publishing,revision:config.revision,version:config.version,pages:[],next:0,hasMore:false,loaded:false});
        return `${selected.state}.${selected.browser}`;
      });
    }catch{this.requests.discard(pending);throw new MarketingStoreError('LinkedIn şirket onayı tamamlanamadı. Uygulama ve izinleri kontrol edin.');}
  }
  private selection(cookie:string,claim=false){
    const [state,browser,extra]=cookie.split('.');
    if(extra!==undefined)throw new MarketingStoreError('Geçersiz sayfa seçimi.',403);
    const pending=claim?this.requests.claim(state||'',browser||'',['linkedin_organization_selection']):this.requests.get(state||'',browser||'',['linkedin_organization_selection']);
    const grant=this.requests.secret<Grant>(pending);
    if(grant.expiresAt<=Date.now()+60000||grant.revision!==linkedinOrganizationConfiguration().revision)throw new MarketingStoreError('Şirket bağlantısı süresi veya uygulama ayarı değişti. Yeniden bağlanın.',409);
    return {pending,grant};
  }
  async list(cookie:string,more=false){
    const {pending,grant}=this.selection(cookie);
    if(!grant.loaded||more&&grant.hasMore&&grant.next<200){
      try{
        const batch=await organizationPageBatch(this.read,grant.accessToken,grant.version,grant.loaded?grant.next:0,AbortSignal.timeout(20000));
        const pages=new Map(grant.pages.map(page=>[page.id,page]));
        for(const page of batch.pages){const old=pages.get(page.id);pages.set(page.id,old?{...page,roles:[...new Set([...old.roles,...page.roles])],canPublish:old.canPublish||page.canPublish,start:page.canPublish?page.start:old.start}:page);}
        grant.pages=[...pages.values()];grant.next=batch.next;grant.hasMore=batch.hasMore;grant.loaded=true;
        if(grant.revision!==linkedinOrganizationConfiguration().revision)throw new Error();
        this.requests.replaceSecret(pending,grant);
      }catch{throw new MarketingStoreError('LinkedIn şirket sayfaları alınamadı. Uygulama erişimi ve r_organization_admin iznini kontrol edin.',409);}
    }
    return {publishing:grant.publishing,items:grant.pages.map(({start,...page})=>page),hasMore:grant.hasMore&&grant.next<200,limitReached:grant.hasMore&&grant.next>=200};
  }
  async select(cookie:string,id:string){
    if(!organizationId(id))throw new MarketingStoreError('Geçerli şirket sayfası seçin.');
    const {pending,grant}=this.selection(cookie,true);
    try{
      const cached=grant.pages.find(page=>page.id===id);
      if(!cached?.available||grant.publishing&&!cached.canPublish)throw new Error();
      const signal=AbortSignal.timeout(20000),profile=await this.read('https://api.linkedin.com/v2/userinfo',grant.accessToken,{signal});
      const batch=await organizationPageBatch(this.read,grant.accessToken,grant.version,cached.start,signal),page=batch.pages.find(page=>page.id===id);
      if(profile.sub!==grant.memberSub||!page?.available||page.name!==cached.name||grant.publishing&&!page.canPublish||grant.revision!==linkedinOrganizationConfiguration().revision)throw new Error();
      return this.requests.finish(pending,()=>new ProjectMarketingStore(this.db,this.scope).saveConnection({provider:'social',integrationId:`linkedin:organization:${id}`,accountName:page.name,accessToken:grant.accessToken,expiresAt:grant.expiresAt,social:{platform:'linkedin',accountType:'organization',accountId:id}},this.key,undefined,undefined,{memberSub:grant.memberSub,publishing:grant.publishing,configurationRevision:grant.revision}));
    }catch{this.requests.discard(pending);throw new MarketingStoreError('Seçilen şirket sayfası veya yetkiniz değişti. Yeniden bağlanın.',409);}
  }
  cancel(cookie:string){const {pending}=this.selection(cookie);this.requests.discard(pending);}
}
