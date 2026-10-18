import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import type { WorkspacePermission } from './access';
import {ProjectUsage} from './project-usage';
import {assertProjectWork,projectEntitlement} from './entitlements';
import type {UsageReservation} from './plan-types';

export type WorkItem = {
  id: string;
  title: string;
  campaignId: string | null;
  dueAt: string;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  note: string;
  createdAt: string;
};
export type MetricEntry = {
  id: string;
  goalId: string;
  stageIndex: number;
  value: number;
  observedAt: string;
  source: 'manual';
  note: string;
};
export { PILOT_LIMITS } from './limits';
const text = (value: unknown, max: number, required = true) => {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new MarketingStoreError('Alan eksik veya çok uzun.');
  return value.trim();
};
const timestamp = (value: unknown) => {
  const date = new Date(text(value, 40));
  if (!Number.isFinite(date.getTime()))
    throw new MarketingStoreError('Geçerli bir tarih girin.');
  return date.toISOString();
};

export class ProjectOperations {
  private identity: PlatformRepository;
  constructor(
    private db: Database.Database,
    private scope: MarketingScope,
  ) {
    this.identity = new PlatformRepository(db);
  }
  private authorize(permission: WorkspacePermission) {
    if (
      !this.identity.can(
        this.scope.subject,
        this.scope.organizationId,
        this.scope.projectId,
        permission,
      )
    )
      throw new MarketingStoreError('Proje erişimi reddedildi.', 403);
  }
  private args() {
    return [this.scope.organizationId, this.scope.projectId];
  }
  private audit(operation: string) {
    this.db
      .prepare(
        'INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)',
      )
      .run(
        this.scope.subject,
        ...this.args(),
        operation,
        new Date().toISOString(),
      );
  }
  tasks(): WorkItem[] {
    this.authorize('read');
    return this.db
      .prepare(
        'SELECT id,title,campaign_id AS campaignId,due_at AS dueAt,status,note,created_at AS createdAt FROM platform_work_items WHERE organization_id=? AND project_id=? ORDER BY due_at,id LIMIT 500',
      )
      .all(...this.args()) as WorkItem[];
  }
  saveTask(input: Record<string, unknown>) {
    return this.db.transaction(() => {
      this.authorize('content.write');
      const rights=assertProjectWork(this.db,this.scope);
      const id =
        input.id === undefined ? `task_${randomUUID()}` : text(input.id, 100);
      const current = this.tasks().find((item) => item.id === id);
      if (input.id && !current)
        throw new MarketingStoreError('İş bulunamadı.', 404);
      if (!current && this.tasks().length >= rights.limits.tasks)
        throw new MarketingStoreError('Pilot iş planı sınırına ulaşıldı.', 429);
      const status = input.status === undefined ? 'planned' : input.status;
      if (
        !['planned', 'in_progress', 'completed', 'cancelled'].includes(
          String(status),
        )
      )
        throw new MarketingStoreError('Geçersiz durum.');
      const campaignId = input.campaignId ? text(input.campaignId, 100) : null;
      if (
        campaignId &&
        !this.db
          .prepare(
            'SELECT id FROM platform_campaigns WHERE id=? AND organization_id=? AND project_id=?',
          )
          .get(campaignId, ...this.args())
      )
        throw new MarketingStoreError('Kampanya bulunamadı.', 404);
      const title = text(input.title, 160),
        dueAt = timestamp(input.dueAt),
        note = text(input.note || '', 2000, false);
      if (current)
        this.db
          .prepare(
            'UPDATE platform_work_items SET title=?,campaign_id=?,due_at=?,status=?,note=? WHERE id=? AND organization_id=? AND project_id=?',
          )
          .run(title, campaignId, dueAt, status, note, id, ...this.args());
      else
        this.db
          .prepare('INSERT INTO platform_work_items VALUES(?,?,?,?,?,?,?,?,?)')
          .run(
            id,
            ...this.args(),
            title,
            campaignId,
            dueAt,
            status,
            note,
            new Date().toISOString(),
          );
      this.audit(current ? 'plan.update' : 'plan.create');
      return this.tasks().find((item) => item.id === id)!;
    })();
  }
  removeTask(id: string) {
    this.authorize('content.write');
    if (
      !this.db
        .prepare(
          'DELETE FROM platform_work_items WHERE id=? AND organization_id=? AND project_id=?',
        )
        .run(id, ...this.args()).changes
    )
      throw new MarketingStoreError('İş bulunamadı.', 404);
    this.audit('plan.delete');
  }
  metrics(): MetricEntry[] {
    this.authorize('read');
    return this.db
      .prepare(
        "SELECT id,goal_id AS goalId,stage_index AS stageIndex,value,observed_at AS observedAt,source,note FROM platform_metric_entries WHERE organization_id=? AND project_id=? AND source='manual' ORDER BY observed_at DESC,id LIMIT 1000",
      )
      .all(...this.args()) as MetricEntry[];
  }
  saveMetric(input: Record<string, unknown>) {
    this.authorize('content.write');
    const goalId = text(input.goalId, 100),
      goal = this.identity
        .workspace(this.scope.subject, ...(this.args() as [string, string]))!
        .project.goals.find((goal) => goal.id === goalId);
    const stageIndex = Number(input.stageIndex),
      value = Number(input.value);
    if (
      !goal ||
      typeof input.stageIndex !== 'number' ||
      typeof input.value !== 'number' ||
      !Number.isInteger(stageIndex) ||
      stageIndex < 0 ||
      stageIndex >= goal.stages.length ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1e12
    )
      throw new MarketingStoreError('Hedef, aşama veya ölçüm geçersiz.');
    const item: MetricEntry = {
      id: `metric_${randomUUID()}`,
      goalId,
      stageIndex,
      value,
      observedAt: timestamp(input.observedAt),
      source: 'manual',
      note: text(input.note || '', 2000, false),
    };
    this.db.transaction(() => {
      const count = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM platform_metric_entries WHERE organization_id=? AND project_id=? AND source='manual'",
        )
        .get(...this.args()) as { n: number };
      if (count.n >= 1000)
        throw new MarketingStoreError(
          'Pilot ölçüm kaydı sınırına ulaşıldı.',
          429,
        );
      this.db
        .prepare(
          'INSERT INTO platform_metric_entries(id,organization_id,project_id,goal_id,stage_index,value,observed_at,source,note) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          item.id,
          ...this.args(),
          goalId,
          stageIndex,
          value,
          item.observedAt,
          item.source,
          item.note,
        );
      this.audit('metric.record');
    })();
    return item;
  }
  removeMetric(id: string) {
    this.authorize('content.write');
    if (
      !this.db
        .prepare(
          "DELETE FROM platform_metric_entries WHERE id=? AND organization_id=? AND project_id=? AND source='manual'",
        )
        .run(id, ...this.args()).changes
    )
      throw new MarketingStoreError('Ölçüm bulunamadı.', 404);
    this.audit('metric.delete');
  }
  reserveAi(resource: 'ai' | 'audits' = 'ai') {
    return new ProjectUsage(this.db,this.scope).reserve(resource);
  }
  completeAi(reservation:UsageReservation){
    return new ProjectUsage(this.db,this.scope).complete(reservation);
  }
  refundAi(reservation:UsageReservation) {
    return new ProjectUsage(this.db,this.scope).release(reservation);
  }
  summary() {
    this.authorize('read');
    const rights=projectEntitlement(this.db,this.scope);
    const count = (table: string) =>
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM ${table} WHERE organization_id=? AND project_id=?`,
          )
          .get(...this.args()) as { n: number }
      ).n;
    const usage = this.db
      .prepare(
        "SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='ai'",
      )
      .get(...this.args(), rights.periodKey || new Date().toISOString().slice(0, 7)) as
      | { count: number }
      | undefined;
    const connections = this.db
      .prepare(
        'SELECT provider,active FROM platform_connections WHERE organization_id=? AND project_id=?',
      )
      .all(...this.args()) as { provider: string; active: number }[];
    const activity = this.db
      .prepare(
        'SELECT operation,created_at AS createdAt FROM platform_audit WHERE organization_id=? AND project_id=? ORDER BY id DESC LIMIT 12',
      )
      .all(...this.args());
    return {
      campaigns: count('platform_campaigns'),
      content: count('platform_content_history'),
      tasks: this.tasks(),
      metrics: this.metrics(),
      connections: connections
        .filter((item) => item.active)
        .map((item) => item.provider),
      activity,
      usage: { ai: usage?.count || 0 },
      limits: rights.limits,
      plan: rights.id,
      billingEnabled: false,
      aiConfigured: Boolean(
        process.env.PLATFORM_GEMINI_API_KEY &&
          process.env.PLATFORM_GEMINI_MODEL,
      ),
      publishingEnabled: false,
    };
  }
}
