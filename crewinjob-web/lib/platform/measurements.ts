import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { ProductSegments } from './segments';
import { decryptCredentials, encryptCredentials, type StoredCredentials } from './credential-envelope';
import { refreshGoogleCredentials } from './google-client';
import { readGoogleMeasurement, type GoogleMeasurementReader } from './measurement-google';
import { WEBHOOK_LIMITS } from './product-webhook-types';
import { MEASUREMENT_METRICS, defaultMeasurementPeriod, type MeasurementSource, type MeasurementDefinition, type MeasurementProvider, type MeasurementResult, type MeasurementJob, type MeasurementWorkspace } from './measurement-types';
import { ryzevoFeature } from './ryzevo-features';

type Binding = { id: string; organization_id: string; project_id: string; goal_id: string; stage_index: number; goal_signature: string; connection_id: string; provider: MeasurementProvider; source_version: number | null; definition_json: string; version: number; enabled: number; manager_id: string; next_sync_at: string | null };
type Connection = { id: string; provider: string; account_name: string; integration_id: string; encrypted_credentials: string; active: number };
type Job = { id: string; actor_id: string; connection_id: string; revision: string; status: string; attempts: number; lease_until: string | null; binding_id: string; binding_version: number; date_from: string; date_to: string; snapshot_json: string; result_status: string; reason: string | null; timezone: string; row_count: number; checked_at: string | null; value: number | null; updated_at: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const jobQuery = `SELECT j.*,s.binding_id,s.binding_version,s.date_from,s.date_to,s.snapshot_json,s.result_status,s.reason,s.timezone,s.row_count,s.checked_at,CASE WHEN s.result_status='ready' THEN s.result_value ELSE NULL END AS value FROM platform_jobs j JOIN platform_measurement_syncs s ON s.job_id=j.id AND s.organization_id=j.organization_id AND s.project_id=j.project_id WHERE j.organization_id=? AND j.project_id=? AND j.job_type='measurement.sync'`;
export function measurementPeriod(from: unknown, to: unknown) {
  for (const value of [from, to]) if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new MarketingStoreError('Geçerli başlangıç ve bitiş tarihi gerekli.');
  const start = Date.parse(from as string), end = Date.parse(to as string), today = Date.parse(new Date().toISOString().slice(0, 10));
  if (end < start || end - start > 30 * 86400000 || end >= today || start < today - 90 * 86400000) throw new MarketingStoreError('Son 90 gün içinde, tamamlanmış 1–31 günlük bir dönem seçin.');
  return { from: from as string, to: to as string };
}

export class ProjectMeasurements {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: MarketingScope, private key: string) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private can(subject = this.scope.subject) { return this.repo.can(subject, ...this.args(), 'connections.manage') && ryzevoFeature(this.repo.workspace(subject, ...this.args())?.project.productPack, 'measurements'); }
  private authorize(manage = false) {
    if (!this.repo.can(this.scope.subject, ...this.args(), 'read') || !ryzevoFeature(this.repo.workspace(this.scope.subject, ...this.args())?.project.productPack, 'measurements') || manage && !this.can()) throw new MarketingStoreError('Ölçüm erişimi reddedildi.', 403);
  }
  private binding(id: string) {
    const row = this.db.prepare('SELECT * FROM platform_measurement_bindings WHERE id=? AND organization_id=? AND project_id=?').get(id, ...this.args()) as Binding | undefined;
    if (!row) throw new MarketingStoreError('Ölçüm eşleştirmesi bulunamadı.', 404); return row;
  }
  private connection(id: string) {
    const row = this.db.prepare('SELECT * FROM platform_connections WHERE id=? AND organization_id=? AND project_id=?').get(id, ...this.args()) as Connection | undefined;
    if (!row?.active) throw new MarketingStoreError('Etkin ölçüm bağlantısı bulunamadı.', 409); return row;
  }
  private signature(goalId: string, stage: number) {
    const goal = this.repo.workspace(this.scope.subject, ...this.args())?.project.goals.find(item => item.id === goalId);
    if (!goal || !Number.isSafeInteger(stage) || stage < 0 || stage >= goal.stages.length) throw new MarketingStoreError('Hedef veya aşama artık geçerli değil.', 409);
    return hash(JSON.stringify(goal));
  }
  sources(): MeasurementSource[] {
    this.authorize(true);
    const google = this.db.prepare("SELECT id,account_name AS name,provider,integration_id AS resource FROM platform_connections WHERE organization_id=? AND project_id=? AND active=1 AND provider IN ('ga4','search_console') ORDER BY account_name,id").all(...this.args()) as Omit<MeasurementSource, 'version' | 'eventNames'>[];
    // Product-data event sources exist only in standard projects; the Crewin workspace's data comes from its backend.
    const events = this.repo.workspace(this.scope.subject, ...this.args())?.project.productPack === 'standard' ? new ProductSegments(this.db, this.scope).sources().filter(item => item.kind === 'webhook' && item.state === 'active') : [];
    return [...google.map(item => ({ ...item, version: null, eventNames: [] })), ...events.map(item => ({ id: item.id, name: item.name, provider: 'product_webhook' as const, resource: 'signed_events', version: item.version, eventNames: item.eventNames }))];
  }
  private valid(row: Binding) {
    try {
      if (!this.can(row.manager_id) || row.goal_signature !== this.signature(row.goal_id, row.stage_index)) return false;
      const connection = this.connection(row.connection_id); if (connection.provider !== row.provider) return false;
      if (row.provider === 'product_webhook') {
        const source = new ProductSegments(this.db, { ...this.scope, subject: row.manager_id }).sources().find(item => item.id === row.connection_id);
        if (source?.state !== 'active' || source.version !== row.source_version || !source.eventNames.includes(JSON.parse(row.definition_json).eventName)) return false;
      }
      return true;
    } catch { return false; }
  }
  private compatible(job: Job, binding: Binding) {
    try {
      const snapshot = JSON.parse(job.snapshot_json) as Binding & { measurementResource?: string };
      const resource = binding.provider === 'product_webhook' ? `v${binding.source_version}` : this.connection(binding.connection_id).integration_id;
      return snapshot.goal_signature === binding.goal_signature && snapshot.connection_id === binding.connection_id && snapshot.provider === binding.provider && snapshot.source_version === binding.source_version && snapshot.definition_json === binding.definition_json && (!snapshot.measurementResource || snapshot.measurementResource === resource);
    } catch { return false; }
  }
  workspace(from?: string, to?: string): MeasurementWorkspace {
    this.authorize(); const period = from === undefined && to === undefined ? defaultMeasurementPeriod() : measurementPeriod(from, to);
    const rows = this.db.prepare('SELECT * FROM platform_measurement_bindings WHERE organization_id=? AND project_id=? ORDER BY goal_id,stage_index LIMIT 20').all(...this.args()) as Binding[];
    return { ...period, canManage: this.can(), sources: this.can() ? this.sources() : [], bindings: rows.map(row => {
      let job = this.db.prepare(jobQuery + ' AND s.binding_id=? AND s.binding_version=? AND s.date_from=? AND s.date_to=? ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1').get(...this.args(), row.id, row.version, period.from, period.to) as Job | undefined;
      if (!job) {
        const observed = this.db.prepare(jobQuery + " AND s.binding_id=? AND s.date_from=? AND s.date_to=? AND j.status='completed' AND s.result_status='ready' ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1").get(...this.args(), row.id, period.from, period.to) as Job | undefined;
        if (observed && this.compatible(observed, row)) job = observed;
      }
      const active = this.db.prepare(jobQuery + " AND s.binding_id=? AND j.status IN ('queued','running') ORDER BY j.created_at DESC LIMIT 1").get(...this.args(), row.id) as Job | undefined;
      const source = this.db.prepare('SELECT account_name,integration_id FROM platform_connections WHERE id=? AND organization_id=? AND project_id=?').get(row.connection_id, ...this.args()) as { account_name: string; integration_id: string };
      return { id: row.id, version: row.version, goalId: row.goal_id, stageIndex: row.stage_index, connectionId: row.connection_id, sourceName: source.account_name, resource: row.provider === 'product_webhook' ? `v${row.source_version}` : source.integration_id, provider: row.provider, definition: JSON.parse(row.definition_json), enabled: Boolean(row.enabled), valid: this.valid(row), nextSyncAt: row.next_sync_at, latest: job ? this.describe(job) : null, active: active ? this.describe(active) : null };
    }) };
  }
  save(input: { goalId: string; stageIndex: number; connectionId: string; metric: string; eventName: string; enabled: boolean; expectedVersion: number }) {
    this.authorize(true);
    return this.db.transaction(() => {
      const signature = this.signature(input.goalId, input.stageIndex), source = this.sources().find(item => item.id === input.connectionId);
      if (!source) throw new MarketingStoreError('Bu projeye ait etkin kaynak gerekli.', 409);
      if (!(MEASUREMENT_METRICS[source.provider] as readonly string[]).includes(input.metric) || typeof input.eventName !== 'string' || input.eventName !== '' && !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(input.eventName) || typeof input.enabled !== 'boolean') throw new MarketingStoreError('Ölçüm veya olay adı geçersiz.');
      if (source.provider === 'product_webhook' && !source.eventNames.includes(input.eventName) || source.provider === 'search_console' && input.eventName || source.provider === 'ga4' && !['eventCount', 'keyEvents'].includes(input.metric) && input.eventName) throw new MarketingStoreError('Bu ölçüm için olay filtresi uygun değil.');
      const old = this.db.prepare('SELECT * FROM platform_measurement_bindings WHERE organization_id=? AND project_id=? AND goal_id=? AND stage_index=?').get(...this.args(), input.goalId, input.stageIndex) as Binding | undefined;
      if (!Number.isSafeInteger(input.expectedVersion) || (old?.version || 0) !== input.expectedVersion) throw new MarketingStoreError('Eşleştirme değişti; yenileyin.', 409);
      if (!old && (this.db.prepare('SELECT COUNT(*) AS n FROM platform_measurement_bindings WHERE organization_id=? AND project_id=?').get(...this.args()) as { n: number }).n >= 20) throw new MarketingStoreError('20 otomatik ölçüm sınırına ulaşıldı.', 429);
      const id = old?.id || randomUUID(), now = new Date().toISOString(), definition: MeasurementDefinition = { metric: input.metric, eventName: input.eventName };
      if (old) this.invalidatePending(old.id);
      this.db.prepare(`INSERT INTO platform_measurement_bindings(id,organization_id,project_id,goal_id,stage_index,goal_signature,connection_id,provider,source_version,definition_json,version,enabled,manager_id,next_sync_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET goal_signature=excluded.goal_signature,connection_id=excluded.connection_id,provider=excluded.provider,source_version=excluded.source_version,definition_json=excluded.definition_json,version=excluded.version,enabled=excluded.enabled,manager_id=excluded.manager_id,next_sync_at=excluded.next_sync_at,updated_at=excluded.updated_at`).run(id, ...this.args(), input.goalId, input.stageIndex, signature, source.id, source.provider, source.version, JSON.stringify(definition), (old?.version || 0) + 1, Number(input.enabled), this.scope.subject, input.enabled ? now : null, now);
      this.audit('measurement.configure'); return { id, version: (old?.version || 0) + 1 };
    }).immediate();
  }
  private job(id: string) {
    const row = this.db.prepare(jobQuery + ' AND j.id=?').get(...this.args(), id) as Job | undefined;
    if (!row) throw new MarketingStoreError('Ölçüm işi bulunamadı.', 404); return row;
  }
  private describe(job: Job): MeasurementJob {
    const binding = this.binding(job.binding_id); let unchanged = false;
    try { unchanged = job.revision === hash(this.connection(job.connection_id).encrypted_credentials); } catch {}
    const snapshot = JSON.parse(job.snapshot_json) as { measurementResource?: string; measurementSourceName?: string };
    return { id: job.id, status: job.status, bindingId: job.binding_id, version: job.binding_version, from: job.date_from, to: job.date_to, resultStatus: job.result_status, reason: job.reason, timezone: job.timezone, rows: job.row_count, checkedAt: job.checked_at, value: job.value, updatedAt: job.updated_at, resource: snapshot.measurementResource || null, sourceName: snapshot.measurementSourceName || null, fresh: job.result_status === 'ready' && this.valid(binding) && this.compatible(job, binding) && unchanged && Boolean(job.checked_at && Date.now() - Date.parse(job.checked_at) < 86400000) };
  }
  get(id: string) { this.authorize(); return this.describe(this.job(id)); }
  pause(id: string, expectedVersion: number) {
    this.authorize(true);
    return this.db.transaction(() => {
      const row = this.binding(id);
      if (row.version !== expectedVersion) throw new MarketingStoreError('Eşleştirme değişti; yenileyin.', 409);
      this.invalidatePending(id);
      this.db.prepare('UPDATE platform_measurement_bindings SET enabled=0,next_sync_at=NULL,version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(), id);
      this.audit('measurement.pause'); return { id, version: row.version + 1 };
    }).immediate();
  }
  enqueue(input: { bindingId: string; expectedVersion: number; from: string; to: string; idempotencyKey: string }) {
    this.authorize(true); const period = measurementPeriod(input.from, input.to);
    if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.idempotencyKey)) throw new MarketingStoreError('Geçerli işlem anahtarı gerekli.');
    return this.db.transaction(() => {
      const row = this.binding(input.bindingId), connection = this.connection(row.connection_id), revision = hash(connection.encrypted_credentials), key = `measurement:${input.idempotencyKey}`;
      if (row.version !== input.expectedVersion || !this.valid(row)) throw new MarketingStoreError('Hedef veya kaynak değişti; eşleştirmeyi yeniden kaydedin.', 409);
      const existing = this.db.prepare(jobQuery + ' AND j.idempotency_key=?').get(...this.args(), key) as Job | undefined;
      if (existing) {
        if (existing.binding_id !== row.id || existing.binding_version !== row.version || existing.date_from !== period.from || existing.date_to !== period.to || existing.revision !== revision) throw new MarketingStoreError('İşlem anahtarı başka bir ölçüme ait.', 409);
        return this.describe(existing);
      }
      const active = this.db.prepare(jobQuery + " AND s.binding_id=? AND j.status IN ('queued','running')").get(...this.args(), row.id) as Job | undefined;
      if (active) {
        if (active.binding_version === row.version && active.date_from === period.from && active.date_to === period.to) return this.describe(active);
        throw new MarketingStoreError('Önce etkin ölçüm işini tamamlayın veya iptal edin.', 409);
      }
      const day = new Date().toISOString().slice(0, 10), usage = this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='measurement_sync'").get(...this.args(), day) as { count: number } | undefined;
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM platform_measurement_syncs WHERE organization_id=? AND project_id=?').get(...this.args()) as { n: number };
      if ((usage?.count || 0) >= 100 || count.n >= 500) throw new MarketingStoreError('Ölçüm pilot işlem sınırına ulaşıldı.', 429);
      const id = randomUUID(), now = new Date().toISOString();
      this.db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,?,?,'queued',?,?,'measurement.sync')").run(id, ...this.args(), this.scope.subject, row.connection_id, revision, key, now, now);
      this.db.prepare('INSERT INTO platform_measurement_syncs(job_id,organization_id,project_id,binding_id,binding_version,date_from,date_to,snapshot_json) VALUES(?,?,?,?,?,?,?,?)').run(id, ...this.args(), row.id, row.version, period.from, period.to, JSON.stringify({ ...row, measurementResource: row.provider === 'product_webhook' ? `v${row.source_version}` : connection.integration_id, measurementSourceName: connection.account_name }));
      this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'measurement_sync',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(), day);
      if (row.enabled) this.db.prepare('UPDATE platform_measurement_bindings SET next_sync_at=? WHERE id=? AND version=?').run(new Date(Date.now() + 86400000).toISOString(), row.id, row.version);
      this.audit('measurement.enqueue'); return this.describe(this.job(id));
    }).immediate();
  }
  cancel(id: string) {
    this.authorize(true); this.job(id);
    this.db.transaction(() => {
      this.db.prepare("UPDATE platform_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status IN ('queued','running')").run(new Date().toISOString(), id);
      this.db.prepare("UPDATE platform_measurement_syncs SET result_status='blocked',reason='cancelled' WHERE job_id=? AND result_status='pending'").run(id);
      this.audit('measurement.cancel');
    }).immediate(); return this.get(id);
  }
  async run(id: string) { this.authorize(true); await this.process(id, readGoogleMeasurement, refreshGoogleCredentials, this.scope.subject); return this.get(id); }
  private holder(id: string, lease: string) { return Boolean(this.db.prepare("SELECT 1 FROM platform_jobs WHERE id=? AND organization_id=? AND project_id=? AND job_type='measurement.sync' AND status='running' AND lease_token=? AND lease_until>?").get(id, ...this.args(), lease, new Date().toISOString())); }
  private live(job: Job, manualRunner?: string) {
    const row = this.binding(job.binding_id);
    if (!this.can(job.actor_id) || manualRunner && !this.can(manualRunner) || !this.valid(row) || row.version !== job.binding_version || hash(this.connection(job.connection_id).encrypted_credentials) !== job.revision) throw new Error('Measurement authority changed.');
    return row;
  }
  private product(row: Binding, job: Job): MeasurementResult {
    const source = new ProductSegments(this.db, { ...this.scope, subject: row.manager_id }).sources().find(item => item.id === row.connection_id)!;
    const start = Date.parse(job.date_from), cutoff = Date.now() - WEBHOOK_LIMITS.retentionDays * 86400000, checkedAt = new Date().toISOString();
    if (!source.coverageFrom || !Number.isFinite(Date.parse(source.coverageFrom)) || Date.parse(source.coverageFrom) > start || start < cutoff) return { status: 'partial', value: null, reason: 'coverage', timezone: 'UTC', rows: 0, checkedAt };
    const end = new Date(Date.parse(job.date_to) + 86400000).toISOString(), definition: MeasurementDefinition = JSON.parse(row.definition_json);
    const aggregate = this.db.prepare(`SELECT COUNT(*) AS events,COUNT(DISTINCT entity_id) AS entities FROM platform_product_events WHERE organization_id=? AND project_id=? AND connection_id=? AND version=? AND event_name=? AND occurred_at>=? AND occurred_at<? AND received_at<=?`).get(...this.args(), row.connection_id, row.source_version, definition.eventName, `${job.date_from}T00:00:00.000Z`, end, checkedAt) as { events: number; entities: number };
    return { status: 'ready', value: definition.metric === 'event_count' ? aggregate.events : aggregate.entities, reason: null, timezone: 'UTC', rows: aggregate.events, checkedAt };
  }
  async process(id: string, read: GoogleMeasurementReader = readGoogleMeasurement, refresh = refreshGoogleCredentials, manualRunner?: string) {
    const lease = randomUUID();
    const claimed = this.db.transaction(() => {
      const job = this.job(id), now = new Date().toISOString();
      if (!['queued','running'].includes(job.status) || job.status === 'running' && job.lease_until && job.lease_until > now) return null;
      if (job.attempts >= 3) { this.fail(job.id, 'failed', 'attempt_limit'); return null; }
      this.db.prepare("UPDATE platform_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(lease, new Date(Date.now() + 60000).toISOString(), now, id); return job;
    }).immediate();
    if (!claimed) return;
    let result: MeasurementResult | undefined, error = 'provider_unavailable';
    try {
      const binding = this.live(claimed, manualRunner);
      if (binding.provider === 'product_webhook') result = this.product(binding, claimed);
      else {
        const connection = this.connection(binding.connection_id), credentials = decryptCredentials<StoredCredentials>(connection.encrypted_credentials, this.key, ...this.args(), connection.id), fresh = await refresh(credentials);
        if (fresh !== credentials) this.db.transaction(() => {
          if (!this.holder(id, lease)) throw new Error(); this.live(claimed, manualRunner);
          const envelope = encryptCredentials(fresh, this.key, ...this.args(), connection.id);
          const changed = this.db.prepare('UPDATE platform_connections SET encrypted_credentials=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND active=1 AND encrypted_credentials=?').run(envelope, new Date().toISOString(), connection.id, ...this.args(), connection.encrypted_credentials);
          if (!changed.changes) throw new Error(); claimed.revision = hash(envelope);
          this.db.prepare('UPDATE platform_jobs SET revision=? WHERE id=?').run(claimed.revision, id);
          this.db.prepare('DELETE FROM platform_connection_checks WHERE connection_id=?').run(connection.id);
        }).immediate();
        if (!this.holder(id, lease)) return; this.live(claimed, manualRunner);
        result = await read({ provider: binding.provider, resource: connection.integration_id, definition: JSON.parse(binding.definition_json), from: claimed.date_from, to: claimed.date_to, token: fresh.accessToken });
      }
    } catch { try { this.live(claimed, manualRunner); } catch { error = 'changed'; } }
    this.db.transaction(() => {
      if (!this.holder(id, lease)) return;
      let binding: Binding;
      try { binding = this.live(claimed, manualRunner); } catch { this.fail(id, 'blocked', 'changed'); return; }
      if (!result) { this.fail(id, error === 'changed' ? 'blocked' : 'failed', error); return; }
      if (!['ready','partial','no_data'].includes(result.status) || result.status === 'ready' && (typeof result.value !== 'number' || !Number.isFinite(result.value) || result.value < 0 || result.value > 1e12)) { this.fail(id, 'failed', 'invalid_result'); return; }
      let entryId: string | null = null;
      if (result.status === 'ready') {
        const old = this.db.prepare('SELECT id FROM platform_metric_entries WHERE organization_id=? AND project_id=? AND binding_id=? AND binding_version=? AND period_from=? AND period_to=?').get(...this.args(), binding.id, binding.version, claimed.date_from, claimed.date_to) as { id: string } | undefined;
        const count = this.db.prepare("SELECT COUNT(*) AS n FROM platform_metric_entries WHERE organization_id=? AND project_id=? AND source<>'manual'").get(...this.args()) as { n: number };
        if (!old && count.n >= 2000) { this.fail(id, 'blocked', 'storage_limit'); return; }
        entryId = old?.id || `metric_${randomUUID()}`;
        const provenance = JSON.stringify({ provider: binding.provider, resource: this.connection(binding.connection_id).integration_id, metric: JSON.parse(binding.definition_json), sourceVersion: binding.source_version, timezone: result.timezone, rows: result.rows, goalSignature: binding.goal_signature, attribution: 'observed_not_causal' });
        this.db.prepare(`INSERT INTO platform_metric_entries(id,organization_id,project_id,goal_id,stage_index,value,observed_at,source,note,binding_id,binding_version,period_from,period_to,provenance_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,observed_at=excluded.observed_at,provenance_json=excluded.provenance_json`).run(entryId, ...this.args(), binding.goal_id, binding.stage_index, result.value, result.checkedAt, binding.provider === 'product_webhook' ? 'product_event' : binding.provider, '', binding.id, binding.version, claimed.date_from, claimed.date_to, provenance);
      }
      this.db.prepare('UPDATE platform_measurement_syncs SET result_status=?,reason=?,timezone=?,row_count=?,checked_at=?,result_value=?,metric_entry_id=? WHERE job_id=?').run(result.status, result.reason, result.timezone, result.rows, result.checkedAt, result.status === 'ready' ? result.value : null, entryId, id);
      this.db.prepare("UPDATE platform_jobs SET status='completed',message='',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
      this.audit('measurement.sync');
    }).immediate();
  }
  private fail(id: string, status: 'failed' | 'blocked', reason: string) {
    this.db.prepare('UPDATE platform_measurement_syncs SET result_status=?,reason=?,checked_at=? WHERE job_id=?').run(status, reason, new Date().toISOString(), id);
    this.db.prepare("UPDATE platform_jobs SET status='failed',message='',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), id); this.audit('measurement.failed');
  }
  private invalidatePending(bindingId: string) {
    this.db.prepare("UPDATE platform_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE organization_id=? AND project_id=? AND job_type='measurement.sync' AND status IN ('queued','running') AND id IN (SELECT job_id FROM platform_measurement_syncs WHERE binding_id=? AND organization_id=? AND project_id=?)").run(new Date().toISOString(), ...this.args(), bindingId, ...this.args());
    this.db.prepare("UPDATE platform_measurement_syncs SET result_status='blocked',reason='changed' WHERE binding_id=? AND organization_id=? AND project_id=? AND result_status='pending' AND job_id IN (SELECT id FROM platform_jobs WHERE status='cancelled')").run(bindingId, ...this.args());
  }
  private audit(operation: string) { this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), operation, new Date().toISOString()); }
}

// Existing private cron entry point only. Never trusts public scope or credentials.
export function scheduleMeasurements(db: Database.Database, key: string) {
  const due = db.prepare('SELECT * FROM platform_measurement_bindings WHERE enabled=1 AND next_sync_at<=? ORDER BY next_sync_at,id LIMIT 2').all(new Date().toISOString()) as Binding[];
  let enqueued = 0;
  for (const binding of due) db.transaction(() => {
    const live = db.prepare('SELECT version,enabled,next_sync_at FROM platform_measurement_bindings WHERE id=?').get(binding.id) as Binding;
    if (!live.enabled || live.version !== binding.version || !live.next_sync_at || live.next_sync_at > new Date().toISOString()) return;
    const scope = { subject: binding.manager_id, organizationId: binding.organization_id, projectId: binding.project_id }, manager = new ProjectMeasurements(db, scope, key);
    try { manager.enqueue({ bindingId: binding.id, expectedVersion: binding.version, ...defaultMeasurementPeriod(), idempotencyKey: `daily_${binding.id}_${new Date().toISOString().slice(0, 10)}` }); enqueued++; }
    catch { /* The next scheduled attempt is bounded; manual sync exposes the current error. */ }
    db.prepare('UPDATE platform_measurement_bindings SET next_sync_at=? WHERE id=? AND version=?').run(new Date(Date.now() + 86400000).toISOString(), binding.id, binding.version);
  }).immediate();
  return enqueued;
}
