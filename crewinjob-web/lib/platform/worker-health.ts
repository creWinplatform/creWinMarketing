import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

// One bounded deployment-level observation. Never store a job, tenant or error body.
export function startWorkerObservation(db: Database.Database, now = new Date()) {
  const runId = randomUUID();
  db.prepare(`INSERT INTO platform_worker_observations(component,run_id,first_observed_at,started_at,outcome)
    VALUES('platform-worker',?,?,?,'running') ON CONFLICT(component) DO UPDATE SET
    run_id=excluded.run_id,started_at=excluded.started_at,finished_at=NULL,
    outcome='running',checked=0,failed=0`).run(runId, now.toISOString(), now.toISOString());
  return runId;
}

export function finishWorkerObservation(db: Database.Database, runId: string,
  outcome: 'completed' | 'partial' | 'failed', checked = 0, failed = 0, now = new Date()) {
  if (!['completed', 'partial', 'failed'].includes(outcome) ||
      ![checked, failed].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 3)) throw new Error('Invalid worker observation.');
  return Boolean(db.prepare(`UPDATE platform_worker_observations SET finished_at=?,outcome=?,checked=?,failed=?,
    last_success_at=CASE WHEN ?='completed' THEN ? ELSE last_success_at END,
    consecutive_failures=CASE WHEN ?='completed' THEN 0 ELSE MIN(consecutive_failures+1,1000000) END
    WHERE component='platform-worker' AND run_id=? AND outcome='running'`)
    .run(now.toISOString(), outcome, checked, failed, outcome, now.toISOString(), outcome, runId).changes);
}

export async function observeWorkerTick<T extends { checked: number; failed: number }>(db: Database.Database, tick: () => Promise<T>): Promise<T> {
  const runId = startWorkerObservation(db);
  try {
    const result = await tick();
    finishWorkerObservation(db, runId, result.failed ? 'partial' : 'completed', result.checked, result.failed);
    return result;
  } catch (error) {
    try { finishWorkerObservation(db, runId, 'failed'); } catch { /* The operator probe also checks missing/stale observations. */ }
    throw error;
  }
}
