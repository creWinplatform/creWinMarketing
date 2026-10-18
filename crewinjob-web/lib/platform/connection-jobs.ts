import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials, type StoredCredentials } from './credential-envelope';
import { refreshGoogleCredentials } from './google-client';
import { verifySmtpConnection } from './email-connection';
import { verifySocialConnection } from './social-connection';
import { ProductDataSources } from './product-data';
import { readProductPage, type ProductPageLoader } from './product-rest';
import { PRODUCT_SOURCE_LIMITS } from './product-data-types';
import { PlatformRepository } from './repository';

type Connection = { id: string; provider: string; integration_id: string; encrypted_credentials: string; active: number };
type Job = { id: string; organization_id: string; project_id: string; actor_id: string; connection_id: string; revision: string; status: string; attempts: number; lease_until: string | null; created_at: string; updated_at: string; message: string; job_type:'connection.verify'|'product.sync' };
type Verification = { status: 'verified' | 'failed' | 'unsupported'; message: string };
const revision = (row: Connection) => createHash('sha256').update(row.encrypted_credentials).digest('hex');
const publicJob = (job: Job) => ({ id: job.id, jobType: job.job_type, connectionId: job.connection_id, status: job.status, attempts: job.attempts, createdAt: job.created_at, updatedAt: job.updated_at, message: job.message });

// Trusted worker cleanup only: an actor who lost access must not starve the queue.
export function settleUnauthorizedConnectionJob(db:Database.Database,scope:MarketingScope,id:string){
  return db.transaction(()=>{
    const job=db.prepare("SELECT actor_id FROM platform_jobs WHERE id=? AND organization_id=? AND project_id=? AND job_type IN ('connection.verify','product.sync') AND (status='queued' OR (status='running' AND (lease_until IS NULL OR lease_until<=?)))").get(id,scope.organizationId,scope.projectId,new Date().toISOString()) as {actor_id:string}|undefined;
    if(!job||new PlatformRepository(db).can(job.actor_id,scope.organizationId,scope.projectId,'connections.manage'))return false;
    db.prepare("UPDATE platform_jobs SET status='failed',message='İş sahibinin proje yetkisi kaldırıldı.',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND organization_id=? AND project_id=?").run(new Date().toISOString(),id,scope.organizationId,scope.projectId);
    db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(job.actor_id,scope.organizationId,scope.projectId,'worker.authority_lost',new Date().toISOString());return true;
  }).immediate();
}

export async function verifyGoogleConnection(provider: string, resource: string, token: string): Promise<Verification> {
  let url: string;
  if (provider === 'ga4') {
    if (!/^\d{1,20}$/.test(resource)) return { status: 'failed', message: 'GA4 bağlantı adı sayısal property ID olmalı.' };
    url = `https://analyticsadmin.googleapis.com/v1beta/properties/${resource}`;
  } else if (provider === 'search_console') {
    if (!/^sc-domain:[a-z0-9.-]+$/i.test(resource)) {
      try { const site = new URL(resource); if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password) throw new Error(); }
      catch { return { status: 'failed', message: 'Geçerli Search Console mülk URL veya sc-domain değeri gerekli.' }; }
    }
    url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(resource)}`;
  } else return { status: 'unsupported', message: 'Bu sağlayıcının doğrulama adaptörü henüz etkin değil.' };
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) });
    // Never surface provider payloads: they can contain credentials or account data.
    if (!response.ok) {
      await response.body?.cancel();
      return { status: 'failed', message: response.status === 401 || response.status === 403 ? 'Erişim anahtarı geçersiz veya mülk yetkisi yok.' : `Sağlayıcı erişim testi başarısız (HTTP ${response.status}).` };
    }
    const payload = await response.json();
    const verified = provider === 'ga4' ? payload.name === `properties/${resource}`
      : payload.siteUrl === resource && ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(payload.permissionLevel);
    return verified ? { status: 'verified', message: 'Sağlayıcı mülk erişimini doğruladı.' }
      : { status: 'failed', message: 'Sağlayıcı yanıtında doğrulanmış mülk erişimi bulunamadı.' };
  } catch { return { status: 'failed', message: 'Sağlayıcıya ulaşılamadı veya erişim testi zaman aşımına uğradı.' }; }
}

export class ConnectionJobs {
  constructor(private db: Database.Database, private scope: MarketingScope) {}
  private authorize() { new ProjectMarketingStore(this.db, this.scope).connections(); }
  private connection(id: string) {
    const row = this.db.prepare('SELECT * FROM platform_connections WHERE id=? AND organization_id=? AND project_id=?').get(id, this.scope.organizationId, this.scope.projectId) as Connection | undefined;
    if (!row?.active) throw new MarketingStoreError('Etkin proje bağlantısı bulunamadı.', 404);
    return row;
  }
  private job(id: string) {
    const row = this.db.prepare("SELECT * FROM platform_jobs WHERE id=? AND organization_id=? AND project_id=? AND job_type IN ('connection.verify','product.sync')").get(id, this.scope.organizationId, this.scope.projectId) as Job | undefined;
    if (!row) throw new MarketingStoreError('İş bulunamadı.', 404);
    return row;
  }
  list():ReturnType<typeof publicJob>[];
  list(id:string):ReturnType<typeof publicJob>;
  list(id?:string):ReturnType<typeof publicJob>|ReturnType<typeof publicJob>[];
  list(id?: string) {
    this.authorize();
    if (id) return publicJob(this.job(id));
    return this.db.prepare("SELECT * FROM platform_jobs WHERE organization_id=? AND project_id=? AND job_type IN ('connection.verify','product.sync') ORDER BY created_at DESC LIMIT 100").all(this.scope.organizationId, this.scope.projectId).map(row => publicJob(row as Job));
  }
  enqueue(connectionId: string, key: string, jobType:'connection.verify'|'product.sync'='connection.verify') {
    this.authorize();
    if (typeof key!=='string' || !key || key.length > 160) throw new MarketingStoreError('Geçerli idempotencyKey gerekli.');
    return this.db.transaction(() => {
      const connection = this.connection(connectionId);
      if(connection.provider==='mobile')throw new MarketingStoreError('Mobil bağlantıyı Mobil büyüme bölümünden test edin.',409);
      if (connection.provider==='product_webhook') throw new MarketingStoreError('Webhook kaynakları imzalı olay kabul eder; doğrulama işi başlatılmaz.',409);
      if (!['connection.verify','product.sync'].includes(jobType) || (jobType==='product.sync')!==(connection.provider==='product_rest')) throw new MarketingStoreError('Bu bağlantı için iş türü geçersiz.');
      if (jobType==='product.sync') {
        const source=new ProductDataSources(this.db,this.scope).list().find(item=>item.id===connectionId);
        if (source?.state!=='active') throw new MarketingStoreError('Önce veri kaynağını önizleyip etkinleştirin.',409);
      }
      const existing = this.db.prepare('SELECT * FROM platform_jobs WHERE organization_id=? AND project_id=? AND idempotency_key=?').get(this.scope.organizationId, this.scope.projectId, key) as Job | undefined;
      if (existing) {
        if (existing.connection_id !== connectionId || existing.revision !== revision(connection) || existing.job_type!==jobType) throw new MarketingStoreError('Bu işlem anahtarı başka bir bağlantı sürümüne ait.', 409);
        return publicJob(existing);
      }
      const active = this.db.prepare("SELECT * FROM platform_jobs WHERE organization_id=? AND project_id=? AND connection_id=? AND job_type IN ('connection.verify','product.sync') AND status IN ('queued','running')").get(this.scope.organizationId, this.scope.projectId, connectionId) as Job | undefined;
      if (active) return publicJob(active);
      if (jobType==='product.sync') {
        const day=new Date().toISOString().slice(0,10);
        const usage=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='product_sync'").get(this.scope.organizationId,this.scope.projectId,day) as {count:number}|undefined;
        if ((usage?.count||0)>=PRODUCT_SOURCE_LIMITS.syncsPerDay) throw new MarketingStoreError('Günlük senkronizasyon sınırına ulaşıldı.',429);
        this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'product_sync',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(this.scope.organizationId,this.scope.projectId,day);
      }
      const id = randomUUID(), now = new Date().toISOString();
      this.db.prepare(`INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,?,?,'queued',?,?,?)`).run(id, this.scope.organizationId, this.scope.projectId, this.scope.subject, connectionId, revision(connection), key, now, now,jobType);
      return publicJob(this.job(id));
    })();
  }
  cancel(id: string) {
    this.authorize(); this.job(id);
    this.db.prepare("UPDATE platform_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status IN ('queued','running')").run(new Date().toISOString(), id);
    return publicJob(this.job(id));
  }
  async run(id: string, keyHex: string, verify = verifyGoogleConnection, refresh = refreshGoogleCredentials, verifyEmail = verifySmtpConnection, verifySocial = verifySocialConnection, readProduct:ProductPageLoader=readProductPage) {
    this.authorize();
    const lease = randomUUID();
    const claimed = this.db.transaction(() => {
      const job = this.job(id), now = new Date().toISOString();
      if (job.status !== 'queued' && !(job.status === 'running' && (!job.lease_until || job.lease_until <= now))) return null;
      if (job.attempts >= 3) { this.db.prepare("UPDATE platform_jobs SET status='failed',message='Deneme sınırına ulaşıldı.',updated_at=? WHERE id=?").run(now, id); return null; }
      this.db.prepare("UPDATE platform_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(lease, new Date(Date.now() + 60000).toISOString(), now, id);
      return job;
    })();
    if (!claimed) return publicJob(this.job(id));
    let result: Verification;
    let productSync:Awaited<ReturnType<ProductDataSources['prepareSync']>>|undefined;
    try {
      // Both the initiating actor and the current runner must retain live permission.
      new ProjectMarketingStore(this.db, { ...this.scope, subject: claimed.actor_id }).connections();
      const connection = this.connection(claimed.connection_id);
      if (revision(connection) !== claimed.revision) throw new Error();
      if (claimed.job_type==='product.sync') {
        if (connection.provider!=='product_rest') throw new Error();
        productSync=await new ProductDataSources(this.db,this.scope).prepareSync(connection.id,keyHex,readProduct);
        result={status:'verified',message:'Kaynak okundu.'};
      } else {
      const credentials = decryptCredentials<StoredCredentials>(connection.encrypted_credentials, keyHex, this.scope.organizationId, this.scope.projectId, connection.id);
      const fresh = await refresh(credentials);
      if (fresh !== credentials) this.db.transaction(() => {
        this.authorize();
        new ProjectMarketingStore(this.db, { ...this.scope, subject: claimed.actor_id }).connections();
        if (!this.db.prepare("SELECT id FROM platform_jobs WHERE id=? AND status='running' AND lease_token=?").get(id, lease)) throw new Error();
        const envelope = encryptCredentials(fresh, keyHex, this.scope.organizationId, this.scope.projectId, connection.id);
        const changed = this.db.prepare('UPDATE platform_connections SET encrypted_credentials=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND active=1 AND encrypted_credentials=?').run(envelope, new Date().toISOString(), connection.id, this.scope.organizationId, this.scope.projectId, connection.encrypted_credentials);
        if (!changed.changes) throw new Error();
        claimed.revision = revision({ ...connection, encrypted_credentials: envelope });
        this.db.prepare('UPDATE platform_jobs SET revision=? WHERE id=?').run(claimed.revision, id);
        this.db.prepare('DELETE FROM platform_connection_checks WHERE connection_id=?').run(connection.id);
      })();
      result = connection.provider === 'email' ? fresh.smtp ? await verifyEmail(fresh.smtp, fresh.accessToken)
        : { status: 'unsupported', message: 'SMTP ayarları eksik. Sunucu, kullanıcı ve gönderen bilgilerini kaydedin.' }
        : connection.provider === 'social' ? fresh.social ? await verifySocial(fresh.social, fresh.accessToken, fresh.expiresAt)
        : { status: 'unsupported', message: 'Sosyal platform ve hesap kimliği henüz tanımlanmadı.' }
        : await verify(connection.provider, connection.integration_id, fresh.accessToken);
      }
    } catch { result = { status: 'failed', message: claimed.job_type==='product.sync'?'Kaynak okunamadı veya alanlar değişti. Önizleme ve erişimi kontrol edin.':'Bağlantı veya erişim değişti. Google anahtarı yenilenemiyorsa yeniden bağlanın.' }; }
    return this.db.transaction(() => {
      const job = this.job(id);
      const holder = this.db.prepare("SELECT id FROM platform_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until>=?").get(id, lease,new Date().toISOString());
      if (!holder) return publicJob(job);
      try {
        this.authorize();
        new ProjectMarketingStore(this.db, { ...this.scope, subject: claimed.actor_id }).connections();
        const connection = this.connection(claimed.connection_id);
        if (revision(connection) !== claimed.revision) throw new Error();
        if (productSync && result.status==='verified') {
          const counts=productSync.commit();
          result.message=`${counts.checked} kayıt değerlendirildi; ${counts.written} kayıt yazıldı.${counts.hasMore?' Sonraki sayfalar bekliyor.':''}`;
        }
        this.db.prepare(`INSERT INTO platform_connection_checks VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,checked_at=excluded.checked_at,message=excluded.message`).run(connection.id, claimed.revision, result.status, new Date().toISOString(), result.message);
      } catch { result = { status: 'failed', message: 'İş sırasında bağlantı veya proje erişimi değişti.' }; }
      this.db.prepare('UPDATE platform_jobs SET status=?,message=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?').run(result.status === 'verified' ? 'completed' : 'failed', result.message, new Date().toISOString(), id);
      this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, this.scope.organizationId, this.scope.projectId, claimed.job_type, new Date().toISOString());
      return publicJob(this.job(id));
    })();
  }
}
