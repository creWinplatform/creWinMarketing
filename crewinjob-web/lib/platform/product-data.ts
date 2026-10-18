import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials, type StoredCredentials } from './credential-envelope';
import { normalizeProductSource, PRODUCT_SOURCE_LIMITS, type ProductPreview, type ProductSource, type ProductSourceConfig } from './product-data-types';
import { readProductPage, type ProductPageLoader } from './product-rest';
import { normalizeProductRecords as normalizeRecords, writeProductRecords, type ProductRecord } from './product-records';

type Row = { connection_id:string; organization_id:string; project_id:string; version:number; config_json:string; enabled:number; paused:number; preview_at:string|null; preview_revision:string|null; last_synced_at:string|null; encrypted_checkpoint:string; account_name:string; encrypted_credentials:string; active:number; provider:string; integration_id:string };
type RecordValue = ProductRecord;
const revision = (row:Row) => createHash('sha256').update(JSON.stringify([row.version,row.config_json,row.encrypted_credentials])).digest('hex');
const mask = (id:string) => `...${id.slice(-4)}`;

export class ProductDataSources {
  constructor(private db:Database.Database,private scope:MarketingScope) {}
  private args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  authorize() {
    const repo=new PlatformRepository(this.db);
    if (!repo.can(this.scope.subject,...this.args(),'connections.manage') || repo.workspace(this.scope.subject,...this.args())?.project.productPack!=='standard') throw new MarketingStoreError('Standart proje veri yönetimi yetkisi gerekli.',403);
  }
  private row(id:string):Row {
    const row=this.db.prepare(`SELECT s.*,c.account_name,c.encrypted_credentials,c.active,c.provider,c.integration_id FROM platform_product_sources s JOIN platform_connections c ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.project_id=s.project_id WHERE s.connection_id=? AND s.organization_id=? AND s.project_id=?`).get(id,...this.args()) as Row|undefined;
    if (!row || row.provider!=='product_rest') throw new MarketingStoreError('Veri kaynağı bulunamadı.',404);
    return row;
  }
  private validPreview(row:Row){return Boolean(row.preview_at && Date.now()-Date.parse(row.preview_at)<3600000 && row.preview_revision===revision(row));}
  private publicSource(row:Row):ProductSource {
    const recordCount=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_product_records WHERE connection_id=? AND version=? AND organization_id=? AND project_id=?').get(row.connection_id,row.version,...this.args()) as {n:number}).n;
    return {id:row.connection_id,name:row.account_name,version:row.version,config:JSON.parse(row.config_json),state:!row.active?'revoked':row.enabled?'active':row.paused?'paused':this.validPreview(row)?'ready':'draft',previewAt:row.preview_at,lastSyncedAt:row.last_synced_at,recordCount,hasMore:Boolean(row.encrypted_checkpoint),credentialConfigured:Boolean(row.active && row.encrypted_credentials)};
  }
  list(){
    this.authorize();
    return (this.db.prepare("SELECT s.connection_id FROM platform_product_sources s JOIN platform_connections c ON c.id=s.connection_id WHERE s.organization_id=? AND s.project_id=? AND c.provider='product_rest' ORDER BY s.connection_id").all(...this.args()) as {connection_id:string}[]).map(item=>this.publicSource(this.row(item.connection_id)));
  }
  save(input:{id?:string;version?:number;name:string;config:unknown;token?:string},key:string) {
    this.authorize();
    let config:ProductSourceConfig;
    try {config=normalizeProductSource(input.config);} catch(error){throw new MarketingStoreError(error instanceof Error?error.message:'Kaynak ayarları geçersiz.');}
    if (typeof input.name!=='string' || !input.name.trim() || input.name.length>160 || (input.token!==undefined && (typeof input.token!=='string' || input.token.length>16384 || /[\r\n\x00]/.test(input.token)))) throw new MarketingStoreError('Kaynak adı veya erişim anahtarı geçersiz.');
    return this.db.transaction(()=>{
      this.authorize();
      const current=input.id?this.row(input.id):null;
      if (current && input.version!==current.version) throw new MarketingStoreError('Kaynak değişti. Güncel sürümü yükleyin.',409);
      const count=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_product_sources WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
      if ((!current && count>=PRODUCT_SOURCE_LIMITS.sources) || (current && current.version>=25)) throw new MarketingStoreError('Pilot kaynak veya sürüm sınırına ulaşıldı.',429);
      let token=config.auth==='none'?'':input.token || '';
      if (config.auth==='bearer' && !token && current?.active) {
        if (new URL(config.url).origin!==new URL(JSON.parse(current.config_json).url).origin) throw new MarketingStoreError('Kaynak alan adı değiştiğinde yeni erişim anahtarı girin.');
        token=decryptCredentials<StoredCredentials>(current.encrypted_credentials,key,...this.args(),current.connection_id).accessToken;
      }
      if (config.auth==='bearer' && !token) throw new MarketingStoreError('Bearer erişim anahtarı gerekli.');
      const saved=new ProjectMarketingStore(this.db,this.scope).saveConnection({id:current?.connection_id,provider:'product_rest',integrationId:current?.integration_id || `product:${randomUUID()}`,accountName:input.name.trim(),accessToken:token},key)!;
      const version=(current?.version || 0)+1;
      this.db.prepare(`INSERT INTO platform_product_sources(connection_id,organization_id,project_id,version,config_json) VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET version=excluded.version,config_json=excluded.config_json,enabled=0,paused=0,preview_at=NULL,preview_revision=NULL,last_synced_at=NULL,encrypted_checkpoint=''`).run(saved.id,...this.args(),version,JSON.stringify(config));
      this.db.prepare('INSERT INTO platform_product_source_versions VALUES(?,?,?,?,?,?)').run(saved.id,version,...this.args(),JSON.stringify(config),new Date().toISOString());
      this.cancelPending(saved.id);
      this.audit('source.save');
      return this.publicSource(this.row(saved.id));
    })();
  }
  private cancelPending(id:string){this.db.prepare("UPDATE platform_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE connection_id=? AND organization_id=? AND project_id=? AND status IN ('queued','running')").run(new Date().toISOString(),id,...this.args());}
  revoke(id:string,version:number) {
    this.authorize();
    return this.db.transaction(()=>{
      const row=this.row(id);
      if (version!==row.version) throw new MarketingStoreError('Kaynak değişti. Güncel sürümü yükleyin.',409);
      new ProjectMarketingStore(this.db,this.scope).revokeConnection(id);
      this.db.prepare('UPDATE platform_product_sources SET enabled=0,paused=1,preview_at=NULL,preview_revision=NULL WHERE connection_id=?').run(id);
      this.cancelPending(id);
      return this.publicSource(this.row(id));
    })();
  }
  setEnabled(id:string,version:number,enabled:boolean) {
    this.authorize();
    return this.db.transaction(()=>{
      const row=this.row(id);
      if (version!==row.version) throw new MarketingStoreError('Kaynak değişti. Güncel sürümü yükleyin.',409);
      if (!row.active || (enabled && !this.validPreview(row))) throw new MarketingStoreError('Önce bu sürümün başarılı ve güncel önizlemesini tamamlayın.',409);
      this.db.prepare('UPDATE platform_product_sources SET enabled=?,paused=? WHERE connection_id=?').run(Number(enabled),Number(!enabled),id);
      if (!enabled) this.cancelPending(id);
      this.audit(enabled?'source.activate':'source.pause');
      return this.publicSource(this.row(id));
    })();
  }
  async preview(id:string,key:string,load:ProductPageLoader=readProductPage):Promise<ProductPreview> {
    this.authorize();
    const row=this.row(id);
    if (!row.active) throw new MarketingStoreError('Kaynak bağlantısı iptal edilmiş.',409);
    this.db.transaction(()=>{
      const day=new Date().toISOString().slice(0,10);
      const used=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='product_preview'").get(...this.args(),day) as {count:number}|undefined;
      if ((used?.count||0)>=PRODUCT_SOURCE_LIMITS.previewsPerDay) throw new MarketingStoreError('Günlük kaynak önizleme sınırına ulaşıldı.',429);
      this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'product_preview',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),day);
    })();
    const config=normalizeProductSource(JSON.parse(row.config_json));
    const token=decryptCredentials<StoredCredentials>(row.encrypted_credentials,key,...this.args(),id).accessToken;
    // Invalidate earlier success before a new check; an aborted/failed preview cannot enable stale data.
    this.db.prepare('UPDATE platform_product_sources SET preview_at=NULL,preview_revision=NULL WHERE connection_id=?').run(id);
    let page;
    try {page=await load(config,token,null);} catch {throw new MarketingStoreError('Kaynak okunamadı. HTTPS, genel ağ erişimi, yetki, JSON biçimi ve 200 kayıt sınırını kontrol edin.',422);}
    const parsed=normalizeRecords(page.items,config),canActivate=parsed.records.length>0 && parsed.errors.length===0;
    this.db.transaction(()=>{
      this.authorize(); const fresh=this.row(id);
      if (!fresh.active || revision(fresh)!==revision(row)) throw new MarketingStoreError('Önizleme sırasında kaynak veya erişim değişti.',409);
      if (canActivate) this.db.prepare('UPDATE platform_product_sources SET preview_at=?,preview_revision=? WHERE connection_id=?').run(new Date().toISOString(),revision(row),id);
      this.audit('source.preview');
    })();
    return {total:page.items.length,valid:parsed.records.length,errors:parsed.errors.slice(0,10),samples:parsed.records.slice(0,5).map(item=>({...item,externalId:mask(item.externalId),consentStatus:'unknown'})),canActivate};
  }
  records(id:string) {
    this.authorize(); const row=this.row(id);
    return (this.db.prepare('SELECT external_id,attributes_json,observed_at,received_at FROM platform_product_records WHERE connection_id=? AND version=? AND organization_id=? AND project_id=? ORDER BY received_at DESC,external_id LIMIT 10').all(id,row.version,...this.args()) as {external_id:string;attributes_json:string;observed_at:string;received_at:string}[]).map(item=>({externalId:mask(item.external_id),attributes:JSON.parse(item.attributes_json),observedAt:item.observed_at,receivedAt:item.received_at,consentStatus:'unknown' as const}));
  }
  async prepareSync(id:string,key:string,load:ProductPageLoader=readProductPage) {
    this.authorize(); const row=this.row(id);
    if (!row.enabled || !row.active) throw new MarketingStoreError('Veri kaynağı etkin değil.',409);
    const config=normalizeProductSource(JSON.parse(row.config_json));
    const credentials=decryptCredentials<StoredCredentials>(row.encrypted_credentials,key,...this.args(),id);
    const checkpoint=row.encrypted_checkpoint?decryptCredentials<{cursor:string;seen:string[]}>(row.encrypted_checkpoint,key,...this.args(),`${id}:checkpoint`):null;
    let cursor:string|null=checkpoint?.cursor || null;
    const seen=new Set(checkpoint?.seen || []), records=new Map<string,RecordValue>();
    for (let pageNumber=0;pageNumber<PRODUCT_SOURCE_LIMITS.batchPages;pageNumber++) {
      this.authorize();
      const fresh=this.row(id);
      if (!fresh.active || !fresh.enabled || revision(fresh)!==revision(row)) throw new MarketingStoreError('Senkronizasyon sırasında kaynak değişti.',409);
      if (cursor) {if(seen.has(cursor)||seen.size>=100) throw new MarketingStoreError('Kaynak sayfalaması ilerlemiyor veya pilot sınırını aşıyor.');seen.add(cursor);}
      const page=await load(config,credentials.accessToken,cursor);
      const parsed=normalizeRecords(page.items,config);
      if (parsed.errors.length) throw new MarketingStoreError('Kaynak alanları veya türleri değişti. Eşleştirmeyi yeniden kontrol edin.',422);
      for (const item of parsed.records) {
        const prior=records.get(item.externalId);
        if (prior?.observedAt===item.observedAt && JSON.stringify(prior.attributes)!==JSON.stringify(item.attributes)) throw new MarketingStoreError('Aynı kimlik ve zamanda çelişen kaynak kayıtları bulundu.');
        if (!prior || prior.observedAt<item.observedAt) records.set(item.externalId,item);
      }
      if (page.nextCursor!==null && (typeof page.nextCursor!=='string'||page.nextCursor.length>512||!config.cursorParam||seen.has(page.nextCursor))) throw new MarketingStoreError('Kaynak cursor yanıtı geçersiz veya tekrarlanıyor.');
      cursor=page.nextCursor;
      if (!cursor) break;
    }
    const commit=this.db.transaction(()=>{
      this.authorize(); const fresh=this.row(id);
      if (!fresh.active || !fresh.enabled || revision(fresh)!==revision(row) || fresh.encrypted_checkpoint!==row.encrypted_checkpoint) throw new MarketingStoreError('Kaynak sürümü veya ilerleme değişti.',409);
      const receivedAt=new Date().toISOString();
      const written=writeProductRecords(this.db,this.scope,id,row.version,config.entityType,[...records.values()],receivedAt);
      const encrypted=cursor?encryptCredentials({cursor,seen:[...seen]},key,...this.args(),`${id}:checkpoint`):'';
      this.db.prepare('UPDATE platform_product_sources SET last_synced_at=?,encrypted_checkpoint=? WHERE connection_id=?').run(receivedAt,encrypted,id);
      this.audit('source.sync');
      return {written,checked:records.size,hasMore:Boolean(cursor)};
    });
    return {commit};
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
}
