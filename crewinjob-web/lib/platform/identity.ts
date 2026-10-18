import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import type Database from 'better-sqlite3';
import {PlatformRepository,insertStandardWorkspace,passwordHash} from './repository';
import {securityVersion,invalidateAccountAccess} from './account';
import {encryptCredentials,decryptCredentials} from './credential-envelope';
import {identityEmailConfiguration,normalizeAccountEmail,deliverIdentityEmail,type IdentityEmail,type IdentityDelivery} from './identity-email';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const invalid=()=>new Error('Invalid or expired account link.');
type Challenge={token_hash:string;kind:IdentityEmail['kind'];user_id:string|null;email:string;security_version:number;configuration_revision:string;expires_at:number;used_at:number|null;encrypted_delivery:string;delivery_state:string};

export class PlatformIdentity {
  private repo:PlatformRepository;
  constructor(private db:Database.Database,private key:string){this.repo=new PlatformRepository(db);}
  capabilities(){return {emailEnabled:Boolean(identityEmailConfiguration()),signupEnabled:Boolean(identityEmailConfiguration()&&process.env.PLATFORM_PUBLIC_SIGNUP_ENABLED==='1')};}
  account(userId:string){
    const user=this.db.prepare("SELECT 1 FROM platform_users WHERE id=? AND kind='platform' AND active=1").get(userId);
    if(!user)throw invalid();
    const email=this.db.prepare('SELECT email,verified_at AS verifiedAt FROM platform_account_emails WHERE user_id=?').get(userId) as {email:string;verifiedAt:string}|undefined;
    return {...this.capabilities(),email:email?.email||null,verifiedAt:email?.verifiedAt||null};
  }
  private limit(identity:string){
    const now=Date.now();
    return this.db.transaction(()=>{
      this.db.prepare('DELETE FROM platform_login_limits WHERE expires_at<?').run(now);
      const entries=[{key:`identity:hour:${Math.floor(now/3600000)}`,maximum:100,expiry:now+3600000},{key:`identity:day:${Math.floor(now/86400000)}`,maximum:500,expiry:now+86400000},{key:`identity:target:${digest(identity)}`,maximum:3,expiry:now+3600000}];
      for(const item of entries){const row=this.db.prepare('SELECT count FROM platform_login_limits WHERE key=?').get(item.key) as {count:number}|undefined;if((row?.count||0)>=item.maximum)return false;}
      for(const item of entries)this.db.prepare('INSERT INTO platform_login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(item.key,item.expiry);
      return true;
    }).immediate();
  }
  request(kind:'signup'|'reset',email:unknown,language:unknown){
    const normalized=normalizeAccountEmail(email);
    if(!this.limit(normalized))return;
    if(!identityEmailConfiguration()||kind==='signup'&&!this.capabilities().signupEnabled)return;
    if(kind==='signup'){
      if(this.db.prepare('SELECT 1 FROM platform_users WHERE username=?').get(normalized)||this.db.prepare('SELECT 1 FROM platform_account_emails WHERE email=?').get(normalized))return;
      const count=this.db.prepare("SELECT COUNT(*) AS n FROM platform_organizations WHERE id<>'crewin'").get() as {n:number};
      if(count.n>=100)return;
      this.queue('signup',normalized,null,language);return;
    }
    const user=this.db.prepare("SELECT u.id FROM platform_account_emails e JOIN platform_users u ON u.id=e.user_id WHERE e.email=? AND u.active=1 AND u.kind='platform' AND EXISTS(SELECT 1 FROM platform_memberships m WHERE m.user_id=u.id AND m.active=1)").get(normalized) as {id:string}|undefined;
    if(user)this.queue('reset',normalized,user.id,language);
  }
  requestVerification(userId:string,email:unknown,password:unknown,language:unknown){
    const normalized=normalizeAccountEmail(email);
    if(!this.limit(`verify:${userId}`))throw new Error('Too many requests.');
    if(!identityEmailConfiguration())throw new Error('Account email delivery is not configured.');
    const user=this.db.prepare("SELECT username FROM platform_users WHERE id=? AND kind='platform' AND active=1").get(userId) as {username:string}|undefined;
    if(!user||typeof password!=='string'||!this.repo.authenticate(user.username,password))throw new Error('Current password is required.');
    if(this.db.prepare('SELECT 1 FROM platform_account_emails WHERE user_id=? OR email=?').get(userId,normalized))throw new Error('A verified email is already linked.');
    // A mailbox already used as someone else's login must not be claimed by this account.
    const reserved=this.db.prepare('SELECT id FROM platform_users WHERE username=?').get(normalized) as {id:string}|undefined;
    if(reserved&&reserved.id!==userId)throw new Error('Email is unavailable.');
    this.queue('verify',normalized,userId,language);
  }
  private queue(kind:IdentityEmail['kind'],email:string,userId:string|null,language:unknown){
    const configuration=identityEmailConfiguration();if(!configuration)return;
    const token=randomBytes(32).toString('base64url'),hash=digest(token),now=Date.now();
    this.db.transaction(()=>{
      this.prune();
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM platform_identity_challenges').get() as {n:number};if(count.n>=3000)return;
      this.db.prepare("UPDATE platform_identity_challenges SET used_at=?,encrypted_delivery='' WHERE kind=? AND email=? AND used_at IS NULL").run(now,kind,email);
      const delivery=encryptCredentials({to:email,kind,token,language:language==='en'?'en':'tr'},this.key,'platform-identity','system-email',hash);
      this.db.prepare("INSERT INTO platform_identity_challenges VALUES(?,?,?,?,?,?,?,?,NULL,?,'queued')").run(hash,kind,userId,email,userId?securityVersion(this.db,userId):0,configuration.revision,now,now+30*60000,delivery);
    }).immediate();
  }
  private challenge(token:string,kind:IdentityEmail['kind']){
    if(typeof token!=='string'||!/^[\w-]{43}$/.test(token))throw invalid();
    const row=this.db.prepare('SELECT * FROM platform_identity_challenges WHERE token_hash=?').get(digest(token)) as Challenge|undefined;
    const config=identityEmailConfiguration();
    if(!row||row.kind!==kind||row.used_at!==null||row.expires_at<=Date.now()||!config||config.revision!==row.configuration_revision||kind==='signup'&&!this.capabilities().signupEnabled)throw invalid();
    if(row.user_id){
      if(!this.db.prepare("SELECT 1 FROM platform_users WHERE id=? AND active=1 AND kind='platform'").get(row.user_id)||securityVersion(this.db,row.user_id)!==row.security_version||!this.repo.workspaces(row.user_id).length)throw invalid();
      if(kind==='reset'&&!this.db.prepare('SELECT 1 FROM platform_account_emails WHERE user_id=? AND email=?').get(row.user_id,row.email))throw invalid();
    }
    return row;
  }
  inspect(token:string,kind:IdentityEmail['kind']){this.challenge(token,kind);return {valid:true};}
  verify(token:string){
    this.db.transaction(()=>{
      const row=this.challenge(token,'verify');
      if(!row.user_id)throw invalid();
      const reserved=this.db.prepare('SELECT id FROM platform_users WHERE username=?').get(row.email) as {id:string}|undefined;
      if(reserved&&reserved.id!==row.user_id)throw invalid();
      this.db.prepare('INSERT INTO platform_account_emails VALUES(?,?,?)').run(row.user_id,row.email,new Date().toISOString());
      this.consume(row);
    }).immediate();
  }
  reset(token:string,password:string){
    const hash=passwordHash(password);
    this.db.transaction(()=>{
      const row=this.challenge(token,'reset');if(!row.user_id)throw invalid();
      this.db.prepare('UPDATE platform_users SET password_hash=? WHERE id=?').run(hash,row.user_id);
      invalidateAccountAccess(this.db,row.user_id);
    }).immediate();
  }
  register(token:string,input:{organizationName:string;projectName:string;website:string;password:string;timezone?:string}){
    return this.db.transaction(()=>{
      const row=this.challenge(token,'signup');
      if(this.db.prepare('SELECT 1 FROM platform_account_emails WHERE email=?').get(row.email))throw invalid();
      const count=this.db.prepare("SELECT COUNT(*) AS n FROM platform_organizations WHERE id<>'crewin'").get() as {n:number};if(count.n>=100)throw invalid();
      const user=insertStandardWorkspace(this.db,'verified-signup',{...input,username:row.email},'trial');
      this.db.prepare('INSERT INTO platform_account_emails VALUES(?,?,?)').run(user.userId,row.email,new Date().toISOString());
      this.consume(row);return user;
    }).immediate();
  }
  private consume(row:Challenge){this.db.prepare("UPDATE platform_identity_challenges SET used_at=?,encrypted_delivery='' WHERE token_hash=? AND used_at IS NULL").run(Date.now(),row.token_hash);}
  prune(){this.db.prepare("UPDATE platform_identity_challenges SET encrypted_delivery='',delivery_state='blocked' WHERE (expires_at<=? OR used_at IS NOT NULL) AND encrypted_delivery<>''").run(Date.now());this.db.prepare('DELETE FROM platform_identity_challenges WHERE expires_at<?').run(Date.now()-86400000);}
  async deliverNext(deliver:IdentityDelivery=deliverIdentityEmail){
    const configuration=identityEmailConfiguration();if(!configuration)return false;
    const claimed=this.db.transaction(()=>{
      this.prune();
      const row=this.db.prepare("SELECT * FROM platform_identity_challenges WHERE delivery_state='queued' AND used_at IS NULL AND expires_at>? ORDER BY created_at,token_hash LIMIT 1").get(Date.now()) as Challenge|undefined;
      if(!row)return null;
      let mail:IdentityEmail;
      try{mail=decryptCredentials<IdentityEmail>(row.encrypted_delivery,this.key,'platform-identity','system-email',row.token_hash);this.challenge(mail.token,row.kind);}catch{this.db.prepare("UPDATE platform_identity_challenges SET delivery_state='blocked',encrypted_delivery='' WHERE token_hash=?").run(row.token_hash);return null;}
      // Reserve once before SES. A crash/timeout never causes automatic resend.
      this.db.prepare("UPDATE platform_identity_challenges SET delivery_state='submitted',encrypted_delivery='' WHERE token_hash=? AND delivery_state='queued'").run(row.token_hash);
      return {row,mail};
    }).immediate();
    if(!claimed)return false;
    let state='sent';try{await deliver(claimed.mail,configuration);}catch{state='uncertain';}
    this.db.prepare('UPDATE platform_identity_challenges SET delivery_state=? WHERE token_hash=?').run(state,claimed.row.token_hash);
    return true;
  }
}
