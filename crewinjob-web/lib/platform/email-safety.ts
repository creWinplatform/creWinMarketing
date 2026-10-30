import 'server-only';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import type Database from 'better-sqlite3';
import {MarketingStoreError} from './marketing-store';

export type EmailScope={organizationId:string;projectId:string};
const args=(scope:EmailScope)=>[scope.organizationId,scope.projectId] as const;
export function emailAddress(value:unknown):string|null{
  if(typeof value!=='string'||value.length>254||value!==value.trim()||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value))return null;
  const [local,domain]=value.split('@');
  if(local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||domain.split('.').some(label=>!label||label.length>63||label.startsWith('-')||label.endsWith('-')))return null;
  return value.toLowerCase();
}
export const maskEmail=(email:string)=>`${email[0]}***@${email.split('@')[1]?.[0]||'*'}***`;
export function emailIdentity(scope:EmailScope,key:string,kind:string,parts:unknown[]){return createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(['ryzevo-email-v1',...args(scope),kind,...parts])).digest('hex');}
export function safetyRevision(db:Database.Database,scope:EmailScope){return (db.prepare('SELECT revision FROM platform_email_state WHERE organization_id=? AND project_id=?').get(...args(scope)) as {revision:number}|undefined)?.revision||0;}
export function bumpSafety(db:Database.Database,scope:EmailScope){db.prepare('INSERT INTO platform_email_state VALUES(?,?,1) ON CONFLICT(organization_id,project_id) DO UPDATE SET revision=revision+1').run(...args(scope));}
export function blockEmail(db:Database.Database,scope:EmailScope,emailKey:string,masked:string,reason:string){
  const existing=db.prepare('SELECT email_key FROM platform_email_blocks WHERE organization_id=? AND project_id=? AND email_key=?').get(...args(scope),emailKey);
  if(existing)return;
  const n=(db.prepare('SELECT COUNT(*) AS n FROM platform_email_blocks WHERE organization_id=? AND project_id=?').get(...args(scope)) as {n:number}).n;
  if(n>=20000)throw new MarketingStoreError('Alıcı engel kaydı sınırına ulaşıldı.',429);
  db.prepare('INSERT INTO platform_email_blocks VALUES(?,?,?,?,?,?)').run(...args(scope),emailKey,masked,reason,new Date().toISOString());bumpSafety(db,scope);
}
export function blockEntity(db:Database.Database,scope:EmailScope,sourceId:string,entityKey:string){
  const exists=db.prepare('SELECT 1 FROM platform_email_entity_blocks WHERE organization_id=? AND project_id=? AND source_id=? AND entity_key=?').get(...args(scope),sourceId,entityKey);
  if(exists)return;
  const n=(db.prepare('SELECT COUNT(*) AS n FROM platform_email_entity_blocks WHERE organization_id=? AND project_id=?').get(...args(scope)) as {n:number}).n;
  if(n>=20000)throw new MarketingStoreError('İzin geri çekme kaydı sınırına ulaşıldı.',429);
  db.prepare('INSERT INTO platform_email_entity_blocks VALUES(?,?,?,?,?)').run(...args(scope),sourceId,entityKey,new Date().toISOString());bumpSafety(db,scope);
}
// Opt-outs persist outside the short-lived event payload tables, including before a mapping exists.
export function recordEmailOptOut(db:Database.Database,scope:EmailScope,key:string,sourceId:string,version:number,entityId:string,attributes:Record<string,unknown>){
  blockEntity(db,scope,sourceId,emailIdentity(scope,key,'entity',[sourceId,entityId]));
  const mapping=db.prepare('SELECT field FROM platform_email_mappings WHERE source_id=? AND source_version=? AND organization_id=? AND project_id=?').get(sourceId,version,...args(scope)) as {field:string}|undefined;
  const email=mapping?emailAddress(attributes[mapping.field]):null;
  if(email)blockEmail(db,scope,emailIdentity(scope,key,'email',[email]),maskEmail(email),'reported_opt_out');
  return email;
}
export function publicEmailOrigin(value=process.env.PLATFORM_PUBLIC_ORIGIN||''){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash?url.origin:null;}catch{return null;}
}
export function newUnsubscribeToken(db:Database.Database,scope:EmailScope,input:{sourceId:string;entityKey:string;emailKey:string;maskedEmail:string}){
  const token=`rzv1_${randomBytes(32).toString('base64url')}`,hash=createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO platform_email_unsubscribe VALUES(?,?,?,?,?,?,?,?,NULL)').run(hash,...args(scope),input.sourceId,input.entityKey,input.emailKey,input.maskedEmail,new Date(Date.now()+30*86400000).toISOString());
  return {path:`/unsubscribe?token=${encodeURIComponent(token)}`,expiresAt:new Date(Date.now()+30*86400000).toISOString()};
}
export const isRyzevoUnsubscribe=(token:string)=>/^rzv/i.test(token);
// afterBlock: runs in the same transaction when a link is used for the first time (the İYS opt-out is queued there).
export function processRyzevoUnsubscribe(db:Database.Database,token:string,inspect=false,afterBlock?:(input:{scope:EmailScope;sourceId:string;entityKey:string;emailKey:string})=>void){
  if(!/^rzv1_[A-Za-z0-9_-]{43}$/.test(token))throw new MarketingStoreError('Bağlantı geçersiz veya süresi dolmuş.',400);
  const hash=createHash('sha256').update(token).digest('hex');
  return db.transaction(()=>{
    const row=db.prepare('SELECT u.*,p.name FROM platform_email_unsubscribe u JOIN platform_projects p ON p.id=u.project_id AND p.organization_id=u.organization_id WHERE u.token_hash=?').get(hash) as {organization_id:string;project_id:string;source_id:string;entity_key:string;email_key:string;masked_email:string;expires_at:string;used_at:string|null;name:string}|undefined;
    if(!row||Date.parse(row.expires_at)<Date.now())throw new MarketingStoreError('Bağlantı geçersiz veya süresi dolmuş.',400);
    if(!inspect&&!row.used_at){
      const scope={organizationId:row.organization_id,projectId:row.project_id};
      blockEntity(db,scope,row.source_id,row.entity_key);blockEmail(db,scope,row.email_key,row.masked_email,'unsubscribe');
      afterBlock?.({scope,sourceId:row.source_id,entityKey:row.entity_key,emailKey:row.email_key});
      db.prepare('UPDATE platform_email_unsubscribe SET used_at=? WHERE token_hash=?').run(new Date().toISOString(),hash);
    }
    return {projectName:row.name,unsubscribed:Boolean(row.used_at)||!inspect};
  })();
}
export function pruneEmailTokens(db:Database.Database){return db.prepare('DELETE FROM platform_email_unsubscribe WHERE token_hash IN (SELECT token_hash FROM platform_email_unsubscribe WHERE expires_at<? LIMIT 1000)').run(new Date().toISOString()).changes;}
