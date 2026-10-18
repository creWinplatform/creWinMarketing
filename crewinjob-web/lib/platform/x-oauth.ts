import 'server-only';
import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { OAuthRequests } from './oauth-requests';
import { xClient } from './x-client';
import { readSocialJson } from './social-connection';
import { normalizeSocialConfiguration } from './social-configuration';

export const X_BROWSER_COOKIE = 'platform_x_oauth';
type Pending = { verifier:string; publishing:boolean; revision:string };
export class ProjectXOAuth {
  constructor(private db:Database.Database,private scope:MarketingScope,private key:string,private clientFactory=xClient) {}
  start(input:{accountName:string;publishing?:boolean}) {
    new ProjectMarketingStore(this.db,this.scope).connections();
    if(typeof input.accountName!=='string'||!input.accountName.trim()||input.accountName.length>160||input.publishing!==undefined&&typeof input.publishing!=='boolean')throw new MarketingStoreError('Hesap adı veya izin seçimi geçersiz.');
    const client=this.clientFactory(),verifier=randomBytes(32).toString('base64url'),publishing=input.publishing===true;
    const result=new OAuthRequests(this.db,this.scope,this.key).create('x','',input.accountName.trim(),{verifier,publishing,revision:client.revision});
    return {browser:result.browser,authorizationUrl:client.authorizationUrl(result.state,verifier,publishing)};
  }
  async complete(state:string,browser:string,code:string,read=readSocialJson) {
    if(!code||code.length>4096)throw new MarketingStoreError('Yetkilendirme kodu geçersiz.');
    const requests=new OAuthRequests(this.db,this.scope,this.key),pending=requests.claim(state,browser,['x']);
    try {
      const secret=requests.secret<Pending>(pending),client=this.clientFactory();
      if(client.revision!==secret.revision||!/^[a-zA-Z0-9_-]{43}$/.test(secret.verifier))throw new Error();
      const token=await client.exchange(code,secret.verifier);
      if(secret.publishing&&!token.scopes.includes('tweet.write'))throw new Error();
      const profile=await read('https://api.x.com/2/users/me',token.accessToken),data=profile.data as Record<string,unknown>|undefined;
      const social=normalizeSocialConfiguration({platform:'twitter',accountId:data?.id});
      if(!/^\d{1,19}$/.test(social.accountId)||this.clientFactory().revision!==secret.revision)throw new Error();
      return requests.finish(pending,()=>new ProjectMarketingStore(this.db,this.scope).saveConnection({provider:'social',integrationId:`twitter:${social.accountId}`,accountName:pending.account_name,accessToken:token.accessToken,expiresAt:token.expiresAt,social},this.key,undefined,secret.publishing?{configurationRevision:secret.revision,scopes:token.scopes}:undefined));
    } catch {
      requests.discard(pending);
      throw new MarketingStoreError('X bağlantısı tamamlanamadı. Proje, hesap ve uygulama izinlerini kontrol edin.');
    }
  }
}
