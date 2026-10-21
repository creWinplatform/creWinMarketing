import 'server-only';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function openPlatformDatabase(file = process.env.PLATFORM_DATABASE_PATH || join(process.cwd(), 'data', 'platform.sqlite')) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS platform_users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT, active INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS platform_organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS platform_projects (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES platform_organizations(id),
      name TEXT NOT NULL, website TEXT NOT NULL, timezone TEXT NOT NULL, product_pack TEXT NOT NULL,
      enabled_modules TEXT NOT NULL, UNIQUE(id, organization_id)
    );
    CREATE TABLE IF NOT EXISTS platform_memberships (
      user_id TEXT NOT NULL REFERENCES platform_users(id), organization_id TEXT NOT NULL,
      project_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','analyst','viewer')),
      active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS platform_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL,
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, operation TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO platform_migrations(version,applied_at) VALUES(1,datetime('now'));
  `);
  const hasMarketingMigration = Boolean(db.prepare('SELECT version FROM platform_migrations WHERE version=2').get());
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_campaigns (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        payload TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      CREATE INDEX IF NOT EXISTS platform_campaign_scope ON platform_campaigns(organization_id,project_id,updated_at);
      CREATE TABLE IF NOT EXISTS platform_content_history (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        payload TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      CREATE INDEX IF NOT EXISTS platform_content_scope ON platform_content_history(organization_id,project_id,updated_at);
      CREATE TABLE IF NOT EXISTS platform_connections (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        provider TEXT NOT NULL, integration_id TEXT NOT NULL, account_name TEXT NOT NULL,
        encrypted_credentials TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id),
        UNIQUE(organization_id,project_id,provider,integration_id)
      );
      INSERT OR IGNORE INTO platform_migrations(version,applied_at) VALUES(2,datetime('now'));
    `);
    // Upgrade only the known initial standard profile; preserve future custom module sets.
    if (!hasMarketingMigration) db.prepare("UPDATE platform_projects SET enabled_modules=? WHERE product_pack='standard' AND enabled_modules=?")
      .run(JSON.stringify(['campaigns', 'library', 'project']), JSON.stringify(['project']));
  })();
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_project_settings (
        project_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
        language TEXT NOT NULL, brand_voice TEXT NOT NULL, goals TEXT NOT NULL,
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      INSERT OR IGNORE INTO platform_migrations(version,applied_at) VALUES(3,datetime('now'));
    `);
  })();
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_connection_checks (
        connection_id TEXT PRIMARY KEY REFERENCES platform_connections(id),
        revision TEXT NOT NULL, status TEXT NOT NULL, checked_at TEXT NOT NULL, message TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS platform_jobs (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES platform_users(id), connection_id TEXT NOT NULL REFERENCES platform_connections(id),
        revision TEXT NOT NULL, idempotency_key TEXT NOT NULL, status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id),
        UNIQUE(organization_id,project_id,idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS platform_job_scope ON platform_jobs(organization_id,project_id,created_at);
      INSERT OR IGNORE INTO platform_migrations(version,applied_at) VALUES(4,datetime('now'));
    `);
  })();
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_oauth_requests (
      state_hash TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES platform_users(id), browser_hash TEXT NOT NULL,
      provider TEXT NOT NULL, resource TEXT NOT NULL, account_name TEXT NOT NULL,
      encrypted_verifier TEXT NOT NULL, expires_at TEXT NOT NULL,
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    INSERT OR IGNORE INTO platform_migrations(version,applied_at) VALUES(5,datetime('now'));
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_social_accounts (
      connection_id TEXT PRIMARY KEY REFERENCES platform_connections(id),
      platform TEXT NOT NULL CHECK(platform IN ('linkedin','twitter')), account_id TEXT NOT NULL, expires_at INTEGER
    );
    INSERT OR IGNORE INTO platform_migrations(version,applied_at) VALUES(6,datetime('now'));
  `);
  if (!(db.prepare('PRAGMA table_info(platform_social_accounts)').all() as { name: string }[]).some(column => column.name === 'expires_at')) db.exec('ALTER TABLE platform_social_accounts ADD COLUMN expires_at INTEGER');
  if (!db.prepare('SELECT version FROM platform_migrations WHERE version=7').get()) db.transaction(() => {
    db.exec(`
      CREATE TABLE platform_social_accounts_v7 (
        connection_id TEXT PRIMARY KEY REFERENCES platform_connections(id),
        platform TEXT NOT NULL CHECK(platform IN ('linkedin','twitter','facebook','instagram')),
        account_id TEXT NOT NULL, expires_at INTEGER, page_id TEXT, graph_version TEXT
      );
      INSERT INTO platform_social_accounts_v7(connection_id,platform,account_id,expires_at) SELECT connection_id,platform,account_id,expires_at FROM platform_social_accounts;
      DROP TABLE platform_social_accounts;
      ALTER TABLE platform_social_accounts_v7 RENAME TO platform_social_accounts;
      INSERT INTO platform_migrations(version,applied_at) VALUES(7,datetime('now'));
    `);
  })();
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_usage (
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, period TEXT NOT NULL, resource TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(organization_id,project_id,period,resource),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS platform_work_items (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
      title TEXT NOT NULL, campaign_id TEXT, due_at TEXT NOT NULL, status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE INDEX IF NOT EXISTS platform_work_scope ON platform_work_items(organization_id,project_id,due_at);
    CREATE TABLE IF NOT EXISTS platform_metric_entries (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
      goal_id TEXT NOT NULL, stage_index INTEGER NOT NULL, value REAL NOT NULL,
      observed_at TEXT NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL,
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS platform_enrollments (
      token_hash TEXT PRIMARY KEY, issuer_id TEXT NOT NULL, organization_id TEXT, project_id TEXT,
      username TEXT NOT NULL, role TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS platform_login_limits (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS platform_user_security (
      user_id TEXT PRIMARY KEY REFERENCES platform_users(id), version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO platform_migrations(version,applied_at) VALUES(8,datetime('now'));
  `);
  if (!db.prepare('SELECT version FROM platform_migrations WHERE version=9').get()) db.transaction(() => {
    db.prepare("UPDATE platform_projects SET enabled_modules=? WHERE product_pack='standard' AND enabled_modules=?")
      .run(JSON.stringify(['dashboard','campaigns','library','calendar','analytics','project']), JSON.stringify(['campaigns','library','project']));
    db.prepare("INSERT INTO platform_migrations(version,applied_at) VALUES(9,datetime('now'))").run();
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=10').get()) db.transaction(()=>{
    db.prepare("UPDATE platform_projects SET enabled_modules=? WHERE product_pack='standard' AND enabled_modules=?").run(JSON.stringify(['dashboard','campaigns','library','seo','calendar','analytics','project']),JSON.stringify(['dashboard','campaigns','library','calendar','analytics','project']));
    db.prepare("INSERT INTO platform_migrations(version,applied_at) VALUES(10,datetime('now'))").run();
  })();
  if (!db.prepare('SELECT version FROM platform_migrations WHERE version=11').get()) db.transaction(() => {
    db.exec(`
      CREATE UNIQUE INDEX platform_connection_scope_id ON platform_connections(id,organization_id,project_id);
      CREATE TABLE platform_product_sources (
        connection_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        version INTEGER NOT NULL, config_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
        preview_at TEXT, preview_revision TEXT, last_synced_at TEXT,
        encrypted_checkpoint TEXT NOT NULL DEFAULT '',
        UNIQUE(connection_id,organization_id,project_id),
        FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
      );
      CREATE TABLE platform_product_source_versions (
        connection_id TEXT NOT NULL, version INTEGER NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        config_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(connection_id,version), UNIQUE(connection_id,version,organization_id,project_id),
        FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_product_sources(connection_id,organization_id,project_id)
      );
      CREATE TABLE platform_product_records (
        connection_id TEXT NOT NULL, version INTEGER NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        external_id TEXT NOT NULL, entity_type TEXT NOT NULL, attributes_json TEXT NOT NULL,
        observed_at TEXT NOT NULL, received_at TEXT NOT NULL,
        PRIMARY KEY(connection_id,version,external_id),
        FOREIGN KEY(connection_id,version,organization_id,project_id) REFERENCES platform_product_source_versions(connection_id,version,organization_id,project_id)
      );
      CREATE INDEX platform_product_record_scope ON platform_product_records(organization_id,project_id,connection_id,version);
      ALTER TABLE platform_jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'connection.verify';
      INSERT INTO platform_migrations(version,applied_at) VALUES(11,datetime('now'));
    `);
  })();
  if (!(db.prepare('PRAGMA table_info(platform_product_sources)').all() as {name:string}[]).some(column=>column.name==='paused')) db.exec('ALTER TABLE platform_product_sources ADD COLUMN paused INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('SELECT version FROM platform_migrations WHERE version=12').get()) db.transaction(()=>{
    db.exec(`
      ALTER TABLE platform_product_sources ADD COLUMN webhook_actor_id TEXT REFERENCES platform_users(id);
      CREATE TABLE platform_product_events (
        connection_id TEXT NOT NULL, event_id TEXT NOT NULL, version INTEGER NOT NULL,
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL, entity_id TEXT NOT NULL,
        event_name TEXT NOT NULL, attributes_json TEXT NOT NULL, consent_json TEXT,
        occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
        PRIMARY KEY(connection_id,event_id),
        FOREIGN KEY(connection_id,version,organization_id,project_id) REFERENCES platform_product_source_versions(connection_id,version,organization_id,project_id)
      );
      CREATE INDEX platform_product_event_scope ON platform_product_events(organization_id,project_id,received_at);
      CREATE INDEX platform_product_event_age ON platform_product_events(received_at);
      CREATE INDEX platform_product_record_age ON platform_product_records(received_at);
      CREATE TABLE platform_product_event_receipts (
        connection_id TEXT NOT NULL, event_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        digest TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(connection_id,event_id),
        FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_product_sources(connection_id,organization_id,project_id)
      );
      CREATE INDEX platform_product_receipt_age ON platform_product_event_receipts(received_at);
      INSERT INTO platform_migrations(version,applied_at) VALUES(12,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=13').get())db.transaction(()=>{
    db.exec(`
      ALTER TABLE platform_product_sources ADD COLUMN event_coverage_from TEXT;
      UPDATE platform_product_sources SET event_coverage_from=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE enabled=1 AND connection_id IN (SELECT id FROM platform_connections WHERE provider='product_webhook' AND active=1);
      CREATE TABLE platform_segments (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        name TEXT NOT NULL, version INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(id,organization_id,project_id),
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      CREATE TABLE platform_segment_versions (
        segment_id TEXT NOT NULL, version INTEGER NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        source_id TEXT NOT NULL, source_version INTEGER NOT NULL, definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES platform_users(id),
        PRIMARY KEY(segment_id,version), UNIQUE(segment_id,version,organization_id,project_id),
        FOREIGN KEY(segment_id,organization_id,project_id) REFERENCES platform_segments(id,organization_id,project_id),
        FOREIGN KEY(source_id,source_version,organization_id,project_id) REFERENCES platform_product_source_versions(connection_id,version,organization_id,project_id)
      );
      CREATE TABLE platform_segment_previews (
        segment_id TEXT NOT NULL, version INTEGER NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        rule_digest TEXT NOT NULL, data_revision TEXT NOT NULL, counts_json TEXT NOT NULL, computed_at TEXT NOT NULL,
        PRIMARY KEY(segment_id,version),
        FOREIGN KEY(segment_id,version,organization_id,project_id) REFERENCES platform_segment_versions(segment_id,version,organization_id,project_id)
      );
      CREATE INDEX platform_segment_scope ON platform_segments(organization_id,project_id,updated_at);
      INSERT INTO platform_migrations(version,applied_at) VALUES(13,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=14').get())db.transaction(()=>{
    db.exec(`
      CREATE UNIQUE INDEX platform_campaign_scoped_identity ON platform_campaigns(id,organization_id,project_id);
      CREATE TABLE platform_campaign_preflights (
        campaign_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        content_digest TEXT NOT NULL, data_revision TEXT NOT NULL, counts_json TEXT NOT NULL,
        checked_at TEXT NOT NULL, checked_by TEXT NOT NULL REFERENCES platform_users(id),
        FOREIGN KEY(campaign_id,organization_id,project_id) REFERENCES platform_campaigns(id,organization_id,project_id) ON DELETE CASCADE
      );
      CREATE TABLE platform_campaign_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL, content_digest TEXT NOT NULL, data_revision TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','revoked')),
        note TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES platform_users(id), created_at TEXT NOT NULL,
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      CREATE INDEX platform_campaign_review_scope ON platform_campaign_reviews(organization_id,project_id,campaign_id,id);
      INSERT INTO platform_migrations(version,applied_at) VALUES(14,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=15').get())db.transaction(()=>{
    db.exec(`
      CREATE TABLE platform_email_state (
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(organization_id,project_id),
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      CREATE TABLE platform_email_mappings (
        source_id TEXT PRIMARY KEY, source_version INTEGER NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        field TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(source_id,source_version,organization_id,project_id) REFERENCES platform_product_source_versions(connection_id,version,organization_id,project_id)
      );
      CREATE TABLE platform_email_consents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        contact_key TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('reviewed','withdrawn','revoked')),
        encrypted_evidence TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES platform_users(id), created_at TEXT NOT NULL,
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      CREATE INDEX platform_email_consent_contact ON platform_email_consents(organization_id,project_id,contact_key,id);
      CREATE TABLE platform_email_blocks (
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL, email_key TEXT NOT NULL,
        masked_email TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(organization_id,project_id,email_key),
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      CREATE TABLE platform_email_entity_blocks (
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL, source_id TEXT NOT NULL, entity_key TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY(organization_id,project_id,source_id,entity_key),
        FOREIGN KEY(source_id,organization_id,project_id) REFERENCES platform_product_sources(connection_id,organization_id,project_id)
      );
      CREATE TABLE platform_email_unsubscribe (
        token_hash TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        source_id TEXT NOT NULL, entity_key TEXT NOT NULL, email_key TEXT NOT NULL, masked_email TEXT NOT NULL,
        expires_at TEXT NOT NULL, used_at TEXT,
        FOREIGN KEY(source_id,organization_id,project_id) REFERENCES platform_product_sources(connection_id,organization_id,project_id)
      );
      CREATE INDEX platform_email_unsubscribe_expiry ON platform_email_unsubscribe(expires_at);
      INSERT INTO platform_migrations(version,applied_at) VALUES(15,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=16').get())db.transaction(()=>{
    db.exec(`
      CREATE TABLE platform_email_sender (
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL, connection_id TEXT NOT NULL,
        connection_revision TEXT NOT NULL, domain TEXT NOT NULL, masked_sender TEXT NOT NULL,
        max_recipients INTEGER NOT NULL CHECK(max_recipients BETWEEN 1 AND 5), revision INTEGER NOT NULL,
        manager_id TEXT NOT NULL REFERENCES platform_users(id), challenge_hash TEXT NOT NULL,
        encrypted_challenge TEXT NOT NULL, challenge_expires_at TEXT NOT NULL,
        verified_at TEXT, checked_at TEXT, last_error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
        PRIMARY KEY(organization_id,project_id),
        FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
      );
      CREATE TABLE platform_email_pilot_allowlist (
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL, email_key TEXT NOT NULL,
        masked_email TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        granted_by TEXT NOT NULL REFERENCES platform_users(id), updated_at TEXT NOT NULL,
        PRIMARY KEY(organization_id,project_id,email_key),
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      INSERT INTO platform_migrations(version,applied_at) VALUES(16,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=17').get())db.transaction(()=>{
    db.exec(`
      CREATE UNIQUE INDEX platform_job_scoped_identity ON platform_jobs(id,organization_id,project_id);
      CREATE TABLE platform_email_pilots (
        job_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL, campaign_name TEXT NOT NULL, review_id INTEGER NOT NULL,
        encrypted_snapshot TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'pending',
        UNIQUE(job_id,organization_id,project_id),
        FOREIGN KEY(job_id,organization_id,project_id) REFERENCES platform_jobs(id,organization_id,project_id)
      );
      CREATE INDEX platform_email_pilot_campaign ON platform_email_pilots(organization_id,project_id,campaign_id);
      CREATE TABLE platform_email_pilot_recipients (
        job_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 5), email_key TEXT NOT NULL,
        masked_email TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','checking','validated','skipped','uncertain','cancelled')),
        reason TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY(job_id,position), UNIQUE(job_id,email_key),
        FOREIGN KEY(job_id,organization_id,project_id) REFERENCES platform_email_pilots(job_id,organization_id,project_id)
      );
      INSERT INTO platform_migrations(version,applied_at) VALUES(17,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=18').get())db.transaction(()=>{
    db.exec(`
      CREATE TABLE platform_email_ses (
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL, connection_id TEXT NOT NULL,
        binding_revision TEXT NOT NULL, revision INTEGER NOT NULL, manager_id TEXT NOT NULL REFERENCES platform_users(id),
        region TEXT NOT NULL, configuration_set TEXT NOT NULL, topic_arn TEXT NOT NULL UNIQUE,
        encrypted_credentials TEXT NOT NULL, checked_at TEXT, proof_json TEXT, last_error TEXT NOT NULL DEFAULT '',
        feedback_observed_at TEXT, last_submit_at TEXT,
        PRIMARY KEY(organization_id,project_id),
        FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
      );
      ALTER TABLE platform_email_pilots ADD COLUMN mode TEXT NOT NULL DEFAULT 'rehearsal' CHECK(mode IN ('rehearsal','send'));
      CREATE TABLE platform_email_pilot_recipients_v18 (
        job_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 5), email_key TEXT NOT NULL, masked_email TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','checking','validated','skipped','uncertain','cancelled','submitting','accepted','rejected','delivered','bounced','complained')),
        reason TEXT, updated_at TEXT NOT NULL, encrypted_message TEXT, provider_message_id TEXT,
        PRIMARY KEY(job_id,position), UNIQUE(job_id,email_key), UNIQUE(job_id,position,organization_id,project_id),
        FOREIGN KEY(job_id,organization_id,project_id) REFERENCES platform_email_pilots(job_id,organization_id,project_id)
      );
      INSERT INTO platform_email_pilot_recipients_v18(job_id,organization_id,project_id,position,email_key,masked_email,state,reason,updated_at)
        SELECT job_id,organization_id,project_id,position,email_key,masked_email,state,reason,updated_at FROM platform_email_pilot_recipients;
      DROP TABLE platform_email_pilot_recipients;
      ALTER TABLE platform_email_pilot_recipients_v18 RENAME TO platform_email_pilot_recipients;
      CREATE TABLE platform_email_send_reservations (
        job_id TEXT NOT NULL, position INTEGER NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL, content_digest TEXT NOT NULL, email_key TEXT NOT NULL, day TEXT NOT NULL,
        attempt_id TEXT NOT NULL UNIQUE, submitted_at TEXT,
        PRIMARY KEY(job_id,position), UNIQUE(organization_id,project_id,campaign_id,content_digest,email_key),
        UNIQUE(organization_id,project_id,day,email_key),
        FOREIGN KEY(job_id,position,organization_id,project_id) REFERENCES platform_email_pilot_recipients(job_id,position,organization_id,project_id)
      );
      CREATE TABLE platform_email_ses_receipts (
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL, message_id TEXT NOT NULL,
        digest TEXT NOT NULL, event_type TEXT NOT NULL, received_at TEXT NOT NULL,
        PRIMARY KEY(organization_id,project_id,message_id),
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      CREATE TABLE platform_email_ses_topics (
        topic_arn TEXT NOT NULL, connection_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        manager_id TEXT NOT NULL REFERENCES platform_users(id), created_at TEXT NOT NULL,
        PRIMARY KEY(topic_arn,connection_id),
        FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
      );
      INSERT INTO platform_migrations(version,applied_at) VALUES(18,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=19').get())db.transaction(()=>{
    db.exec(`
      CREATE TABLE platform_measurement_bindings (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        goal_id TEXT NOT NULL, stage_index INTEGER NOT NULL, goal_signature TEXT NOT NULL,
        connection_id TEXT NOT NULL, provider TEXT NOT NULL, source_version INTEGER,
        definition_json TEXT NOT NULL, version INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
        manager_id TEXT NOT NULL REFERENCES platform_users(id), next_sync_at TEXT, updated_at TEXT NOT NULL,
        UNIQUE(id,organization_id,project_id), UNIQUE(organization_id,project_id,goal_id,stage_index),
        FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
      );
      CREATE INDEX platform_measurement_due ON platform_measurement_bindings(enabled,next_sync_at);
      ALTER TABLE platform_metric_entries ADD COLUMN binding_id TEXT REFERENCES platform_measurement_bindings(id);
      ALTER TABLE platform_metric_entries ADD COLUMN binding_version INTEGER;
      ALTER TABLE platform_metric_entries ADD COLUMN period_from TEXT;
      ALTER TABLE platform_metric_entries ADD COLUMN period_to TEXT;
      ALTER TABLE platform_metric_entries ADD COLUMN provenance_json TEXT;
      CREATE UNIQUE INDEX platform_metric_automatic_identity ON platform_metric_entries(organization_id,project_id,binding_id,binding_version,period_from,period_to);
      CREATE TABLE platform_measurement_syncs (
        job_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        binding_id TEXT NOT NULL, binding_version INTEGER NOT NULL,
        date_from TEXT NOT NULL, date_to TEXT NOT NULL, snapshot_json TEXT NOT NULL,
        result_status TEXT NOT NULL DEFAULT 'pending', reason TEXT, timezone TEXT NOT NULL DEFAULT '',
        row_count INTEGER NOT NULL DEFAULT 0, checked_at TEXT, result_value REAL,
        metric_entry_id TEXT REFERENCES platform_metric_entries(id) ON DELETE SET NULL,
        FOREIGN KEY(job_id,organization_id,project_id) REFERENCES platform_jobs(id,organization_id,project_id),
        FOREIGN KEY(binding_id,organization_id,project_id) REFERENCES platform_measurement_bindings(id,organization_id,project_id)
      );
      CREATE INDEX platform_measurement_scope ON platform_measurement_syncs(organization_id,project_id,binding_id,date_from,date_to);
      INSERT INTO platform_migrations(version,applied_at) VALUES(19,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=20').get())db.transaction(()=>{
    db.exec(`
      CREATE TABLE platform_social_publish_checks (
        connection_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        revision TEXT NOT NULL, configuration_revision TEXT NOT NULL, manager_id TEXT NOT NULL REFERENCES platform_users(id),
        checked_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        check_id TEXT NOT NULL,
        FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
      );
      CREATE TABLE platform_social_publications (
        job_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('content','campaign')), source_id TEXT NOT NULL,
        source_digest TEXT NOT NULL, body_digest TEXT NOT NULL, encrypted_snapshot TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('rehearsal','publish')), state TEXT NOT NULL DEFAULT 'pending',
        scheduled_at TEXT NOT NULL, timezone TEXT NOT NULL, configuration_revision TEXT NOT NULL,
        submitted_at TEXT, provider_post_id TEXT, provider_url TEXT, reason TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(job_id,organization_id,project_id) REFERENCES platform_jobs(id,organization_id,project_id)
      );
      CREATE INDEX platform_social_publication_scope ON platform_social_publications(organization_id,project_id,scheduled_at);
      CREATE INDEX platform_social_publication_due ON platform_social_publications(state,scheduled_at);
      INSERT INTO platform_migrations(version,applied_at) VALUES(20,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=21').get())db.transaction(()=>{
    db.exec(`
      ALTER TABLE platform_social_publications ADD COLUMN preparation_started_at TEXT;
      ALTER TABLE platform_social_publications ADD COLUMN provider_container_id TEXT;
      ALTER TABLE platform_social_publications ADD COLUMN next_check_at TEXT;
      ALTER TABLE platform_social_publications ADD COLUMN image_bytes INTEGER NOT NULL DEFAULT 0;
      INSERT INTO platform_migrations(version,applied_at) VALUES(21,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=22').get())db.transaction(()=>{
    db.exec(`
      CREATE TABLE platform_account_emails (
        user_id TEXT PRIMARY KEY REFERENCES platform_users(id),
        email TEXT NOT NULL UNIQUE COLLATE NOCASE, verified_at TEXT NOT NULL
      );
      CREATE TABLE platform_identity_challenges (
        token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('verify','reset','signup')),
        user_id TEXT REFERENCES platform_users(id), email TEXT NOT NULL COLLATE NOCASE,
        security_version INTEGER NOT NULL, configuration_revision TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER,
        encrypted_delivery TEXT NOT NULL,
        delivery_state TEXT NOT NULL CHECK(delivery_state IN ('queued','submitted','sent','uncertain','blocked'))
      );
      CREATE INDEX platform_identity_due ON platform_identity_challenges(delivery_state,expires_at);
      INSERT INTO platform_migrations(version,applied_at) VALUES(22,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=23').get())db.transaction(()=>{
    db.exec(`
      CREATE TABLE platform_usage_reservations (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES platform_users(id),
        resource TEXT NOT NULL CHECK(resource IN ('ai','audits')), period TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('reserved','committed','released')),
        created_at TEXT NOT NULL, settled_at TEXT,
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      CREATE INDEX platform_usage_reservation_scope ON platform_usage_reservations(organization_id,project_id,period,created_at);
      INSERT INTO platform_migrations(version,applied_at) VALUES(23,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=24').get())db.transaction(()=>{
    db.exec(`
      CREATE TABLE platform_billing_orders (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES platform_users(id),
        idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL,
        configuration_revision TEXT NOT NULL, merchant_revision TEXT NOT NULL, plan_id TEXT NOT NULL, plan_name TEXT NOT NULL,
        cadence TEXT NOT NULL CHECK(cadence IN ('monthly','yearly')),
        amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 100 AND 1000000),
        currency TEXT NOT NULL CHECK(currency='USD'), test_mode INTEGER NOT NULL CHECK(test_mode=1),
        state TEXT NOT NULL CHECK(state IN ('preparing','pending','test_paid','test_failed','rejected','uncertain','review')),
        encrypted_token TEXT NOT NULL DEFAULT '', notification_digest TEXT,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(organization_id,project_id,idempotency_key),
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      CREATE INDEX platform_billing_order_scope ON platform_billing_orders(organization_id,project_id,created_at);
      CREATE UNIQUE INDEX platform_billing_order_active ON platform_billing_orders(organization_id,project_id)
        WHERE state IN ('preparing','pending','uncertain');
      INSERT INTO platform_migrations(version,applied_at) VALUES(24,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=25').get())db.transaction(()=>{
    db.exec(`
      CREATE TABLE platform_project_entitlements (
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('pilot','trial')),
        trial_owner_id TEXT UNIQUE REFERENCES platform_users(id),
        started_at TEXT NOT NULL, ends_at TEXT,
        CHECK((mode='pilot' AND ends_at IS NULL AND trial_owner_id IS NULL) OR (mode='trial' AND ends_at IS NOT NULL AND trial_owner_id IS NOT NULL)),
        PRIMARY KEY(organization_id,project_id),
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      INSERT INTO platform_project_entitlements(organization_id,project_id,mode,started_at)
        SELECT organization_id,id,'pilot',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM platform_projects WHERE product_pack='standard';
      CREATE TABLE platform_plan_preferences (
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        plan_id TEXT NOT NULL CHECK(plan_id IN ('launch','growth')), catalog_version TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES platform_users(id), updated_at TEXT NOT NULL,
        PRIMARY KEY(organization_id,project_id),
        FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
      );
      INSERT INTO platform_migrations(version,applied_at) VALUES(25,datetime('now'));
    `);
  })();
  if(!db.prepare('SELECT version FROM platform_migrations WHERE version=26').get())db.transaction(()=>{
    db.exec(`
      ALTER TABLE platform_billing_orders ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE platform_billing_orders ADD COLUMN settlement_source TEXT CHECK(settlement_source IN ('notification','status_inquiry'));
      UPDATE platform_billing_orders SET settlement_source='notification' WHERE notification_digest IS NOT NULL AND state IN ('test_paid','test_failed');
      CREATE UNIQUE INDEX platform_billing_order_identity ON platform_billing_orders(id,organization_id,project_id);
      CREATE TABLE platform_billing_checks (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, order_id TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES platform_users(id), idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL,
        expected_revision INTEGER NOT NULL, merchant_revision TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('checking','confirmed','not_confirmed','mismatch','unavailable','changed')),
        reason TEXT CHECK(reason IN ('matched','no_confirmed_payment','provider_unavailable','invalid_response','details_mismatch','refund_observed','configuration_changed','authority_lost','order_changed','interrupted','review_required','contradicting_result')),
        created_at TEXT NOT NULL, completed_at TEXT,
        UNIQUE(organization_id,project_id,idempotency_key),
        FOREIGN KEY(order_id,organization_id,project_id) REFERENCES platform_billing_orders(id,organization_id,project_id)
      );
      CREATE INDEX platform_billing_check_scope ON platform_billing_checks(organization_id,project_id,created_at);
      CREATE INDEX platform_billing_check_order ON platform_billing_checks(order_id,created_at);
      CREATE UNIQUE INDEX platform_billing_check_active ON platform_billing_checks(order_id) WHERE outcome='checking';
      INSERT INTO platform_migrations(version,applied_at) VALUES(26,datetime('now'));
    `);
  })();
  if (!db.prepare('SELECT version FROM platform_migrations WHERE version=27').get()) db.transaction(() => {
    db.exec(`
      CREATE TABLE platform_operation_metadata (
        key TEXT PRIMARY KEY CHECK(key='database_id'), value TEXT NOT NULL CHECK(length(value)=36)
      );
      CREATE TABLE platform_worker_observations (
        component TEXT PRIMARY KEY CHECK(component='platform-worker'),
        run_id TEXT NOT NULL, first_observed_at TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
        outcome TEXT NOT NULL CHECK(outcome IN ('running','completed','partial','failed')),
        last_success_at TEXT, checked INTEGER NOT NULL DEFAULT 0 CHECK(checked BETWEEN 0 AND 3),
        failed INTEGER NOT NULL DEFAULT 0 CHECK(failed BETWEEN 0 AND 3),
        consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_failures BETWEEN 0 AND 1000000)
      );
      INSERT INTO platform_migrations(version,applied_at) VALUES(27,datetime('now'));
    `);
    db.prepare("INSERT INTO platform_operation_metadata(key,value) VALUES('database_id',?)").run(randomUUID());
  })();
  if (!db.prepare('SELECT version FROM platform_migrations WHERE version=28').get()) db.transaction(() => {
    db.exec(`
      CREATE TABLE platform_social_engagement (
        job_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        counts_json TEXT NOT NULL DEFAULT '{}', observed_at TEXT, attempted_at TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('refreshing','ready','unavailable')),
        lease_token TEXT, lease_until TEXT,
        FOREIGN KEY(job_id,organization_id,project_id) REFERENCES platform_jobs(id,organization_id,project_id)
      );
      CREATE INDEX platform_social_engagement_scope ON platform_social_engagement(organization_id,project_id);
      INSERT INTO platform_migrations(version,applied_at) VALUES(28,datetime('now'));
    `);
  })();
  if (!db.prepare('SELECT version FROM platform_migrations WHERE version=29').get()) db.transaction(() => {
    db.exec(`
      CREATE TABLE platform_mobile_apps (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        source_id TEXT NOT NULL, source_version INTEGER NOT NULL, config_json TEXT NOT NULL,
        coverage_through TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(id,organization_id,project_id), UNIQUE(source_id),
        FOREIGN KEY(source_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
      );
      CREATE TABLE platform_mobile_integrations (
        connection_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        app_id TEXT NOT NULL, kind TEXT NOT NULL, config_json TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES platform_users(id), status TEXT NOT NULL DEFAULT 'configured',
        checked_at TEXT, checked_revision TEXT, last_event_at TEXT,
        UNIQUE(app_id,kind),
        FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id),
        FOREIGN KEY(app_id,organization_id,project_id) REFERENCES platform_mobile_apps(id,organization_id,project_id)
      );
      CREATE TABLE platform_mobile_store_snapshots (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        app_id TEXT NOT NULL, payload TEXT NOT NULL, checked_at TEXT NOT NULL,
        FOREIGN KEY(app_id,organization_id,project_id) REFERENCES platform_mobile_apps(id,organization_id,project_id)
      );
      CREATE UNIQUE INDEX platform_mobile_event_identity ON platform_product_events(connection_id,event_id,organization_id,project_id);
      CREATE TABLE platform_mobile_event_details (
        source_id TEXT NOT NULL, event_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
        app_id TEXT NOT NULL, provider TEXT NOT NULL, kind TEXT NOT NULL, digest TEXT NOT NULL, details_json TEXT NOT NULL,
        PRIMARY KEY(source_id,event_id),
        FOREIGN KEY(source_id,event_id,organization_id,project_id) REFERENCES platform_product_events(connection_id,event_id,organization_id,project_id) ON DELETE CASCADE,
        FOREIGN KEY(app_id,organization_id,project_id) REFERENCES platform_mobile_apps(id,organization_id,project_id)
      );
      CREATE TABLE platform_mobile_contacts (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, app_id TEXT NOT NULL,
        entity_key TEXT NOT NULL, provider TEXT NOT NULL, encrypted_destination TEXT NOT NULL,
        push_consent INTEGER NOT NULL DEFAULT 0, in_app_consent INTEGER NOT NULL DEFAULT 0,
        allow_pilot INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
        UNIQUE(app_id,entity_key,provider), UNIQUE(id,organization_id,project_id),
        FOREIGN KEY(app_id,organization_id,project_id) REFERENCES platform_mobile_apps(id,organization_id,project_id)
      );
      CREATE TABLE platform_mobile_messages (
        job_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, app_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('push','in_app')),
        mode TEXT NOT NULL CHECK(mode IN ('rehearsal','live')), state TEXT NOT NULL DEFAULT 'pending',
        scheduled_at TEXT NOT NULL, expires_at TEXT NOT NULL, source_digest TEXT NOT NULL,
        encrypted_snapshot TEXT NOT NULL, reason TEXT, task_id TEXT REFERENCES platform_work_items(id),
        FOREIGN KEY(job_id,organization_id,project_id) REFERENCES platform_jobs(id,organization_id,project_id),
        FOREIGN KEY(app_id,organization_id,project_id) REFERENCES platform_mobile_apps(id,organization_id,project_id)
      );
      CREATE TABLE platform_mobile_deliveries (
        job_id TEXT NOT NULL REFERENCES platform_mobile_messages(job_id),
        contact_id TEXT NOT NULL REFERENCES platform_mobile_contacts(id),
        state TEXT NOT NULL DEFAULT 'pending', submitted_at TEXT, provider_id TEXT,
        PRIMARY KEY(job_id,contact_id)
      );
      CREATE TABLE platform_mobile_links (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, app_id TEXT NOT NULL,
        connection_id TEXT NOT NULL, campaign_id TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL,
        request_digest TEXT NOT NULL, status TEXT NOT NULL, url TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id),
        FOREIGN KEY(app_id,organization_id,project_id) REFERENCES platform_mobile_apps(id,organization_id,project_id)
      );
      CREATE TABLE platform_mobile_costs (
        organization_id TEXT NOT NULL, project_id TEXT NOT NULL, app_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL, attribution_campaign TEXT NOT NULL, day TEXT NOT NULL,
        currency TEXT NOT NULL, amount REAL NOT NULL CHECK(amount>=0), actor_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(app_id,campaign_id,day,currency),
        FOREIGN KEY(app_id,organization_id,project_id) REFERENCES platform_mobile_apps(id,organization_id,project_id)
      );
      CREATE INDEX platform_mobile_app_scope ON platform_mobile_apps(organization_id,project_id);
      CREATE INDEX platform_mobile_message_due ON platform_mobile_messages(state,scheduled_at);
      INSERT INTO platform_migrations(version,applied_at) VALUES(29,datetime('now'));
    `);
    const stock=JSON.stringify(['dashboard','campaigns','library','seo','calendar','analytics','project']);
    db.prepare("UPDATE platform_projects SET enabled_modules=? WHERE product_pack='standard' AND enabled_modules=?").run(JSON.stringify(['dashboard','campaigns','library','mobile','seo','calendar','analytics','project']),stock);
  })();
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=30').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_compass_preferences (
      user_id TEXT NOT NULL REFERENCES platform_users(id), organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, preferences_json TEXT NOT NULL,
      deferred INTEGER NOT NULL DEFAULT 0 CHECK(deferred IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    INSERT INTO platform_migrations(version,applied_at) VALUES(30,datetime('now'));
  `))();
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=31').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_growth_coach (
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      answers_json TEXT NOT NULL, draft_json TEXT, draft_source TEXT CHECK(draft_source IN ('ai','template')), draft_at TEXT,
      brief_json TEXT, approved_by TEXT, approved_at TEXT, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE TABLE platform_growth_coach_actions (
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, action_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('open','done','skipped')), week TEXT NOT NULL, task_id TEXT,
      actor_id TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(organization_id,project_id,action_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    INSERT INTO platform_migrations(version,applied_at) VALUES(31,datetime('now'));
  `))();
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=32').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_coach_content_items (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, month TEXT NOT NULL,
      channel TEXT NOT NULL, theme TEXT NOT NULL, title TEXT NOT NULL, angle TEXT NOT NULL, goal_id TEXT, planned_for TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('suggested','approved','dismissed')), source TEXT NOT NULL CHECK(source IN ('ai','template','human')),
      revision INTEGER NOT NULL DEFAULT 1, task_id TEXT, approved_by TEXT, approved_at TEXT, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE INDEX platform_coach_content_scope ON platform_coach_content_items(organization_id,project_id,month);
    INSERT INTO platform_migrations(version,applied_at) VALUES(32,datetime('now'));
  `))();
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=33').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_coach_seo_topics (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, cluster TEXT NOT NULL,
      intent TEXT NOT NULL CHECK(intent IN ('informational','commercial','transactional','navigational')), keywords_json TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('ai','template')), brief_json TEXT, brief_source TEXT CHECK(brief_source IN ('ai','template','human')),
      brief_state TEXT CHECK(brief_state IN ('draft','approved')), revision INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE INDEX platform_coach_seo_topic_scope ON platform_coach_seo_topics(organization_id,project_id);
    CREATE TABLE platform_coach_seo_queries (
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, connection_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ready','no_data','unavailable')), date_from TEXT NOT NULL, date_to TEXT NOT NULL,
      rows_json TEXT NOT NULL, checked_at TEXT NOT NULL, PRIMARY KEY(organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    INSERT INTO platform_migrations(version,applied_at) VALUES(33,datetime('now'));
  `))();
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=34').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_coach_reviews (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, week TEXT NOT NULL,
      facts_json TEXT NOT NULL, adjustments_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(organization_id,project_id,week),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    INSERT INTO platform_migrations(version,applied_at) VALUES(34,datetime('now'));
  `))();
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=35').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_growth_coach_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, coach_revision INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('approve','adjust','positioning')), brief_json TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE INDEX platform_growth_coach_brief_scope ON platform_growth_coach_briefs(organization_id,project_id,id);
    INSERT INTO platform_growth_coach_briefs(organization_id,project_id,coach_revision,kind,brief_json,approved_by,approved_at)
      SELECT organization_id,project_id,revision,'approve',brief_json,COALESCE(approved_by,updated_by),COALESCE(approved_at,updated_at) FROM platform_growth_coach WHERE brief_json IS NOT NULL;
    INSERT INTO platform_migrations(version,applied_at) VALUES(35,datetime('now'));
  `))();
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=36').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_coach_digest_subscriptions (
      user_id TEXT NOT NULL REFERENCES platform_users(id), organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
      language TEXT NOT NULL CHECK(language IN ('tr','en')), created_at TEXT NOT NULL,
      PRIMARY KEY(user_id,organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE TABLE platform_coach_digest_deliveries (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, review_id TEXT NOT NULL REFERENCES platform_coach_reviews(id),
      user_id TEXT NOT NULL REFERENCES platform_users(id), state TEXT NOT NULL CHECK(state IN ('queued','submitted','sent','uncertain','skipped')),
      reason TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(review_id,user_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE INDEX platform_coach_digest_queue ON platform_coach_digest_deliveries(state,created_at);
    INSERT INTO platform_migrations(version,applied_at) VALUES(36,datetime('now'));
  `))();
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=37').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_coach_brand (
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      voice_answers_json TEXT, voice_draft TEXT, voice_source TEXT CHECK(voice_source IN ('ai','template','human')), voice_applied_at TEXT,
      competitors_json TEXT, difference TEXT, analysis_json TEXT, analysis_source TEXT CHECK(analysis_source IN ('ai','template')),
      updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    INSERT INTO platform_migrations(version,applied_at) VALUES(37,datetime('now'));
  `))();
  // Phase 4 · monthly renewal: proposed briefs from the past month's records; brief history gains the 'refresh' kind.
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=38').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_growth_coach_briefs_v38 (
      id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, coach_revision INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('approve','adjust','positioning','refresh')), brief_json TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    INSERT INTO platform_growth_coach_briefs_v38(id,organization_id,project_id,coach_revision,kind,brief_json,approved_by,approved_at)
      SELECT id,organization_id,project_id,coach_revision,kind,brief_json,approved_by,approved_at FROM platform_growth_coach_briefs;
    DROP TABLE platform_growth_coach_briefs;
    ALTER TABLE platform_growth_coach_briefs_v38 RENAME TO platform_growth_coach_briefs;
    CREATE INDEX platform_growth_coach_brief_scope ON platform_growth_coach_briefs(organization_id,project_id,id);
    CREATE TABLE platform_coach_refreshes (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, month TEXT NOT NULL, base_revision INTEGER NOT NULL,
      facts_json TEXT NOT NULL, brief_json TEXT NOT NULL, reasons_json TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('ai','template')),
      state TEXT NOT NULL CHECK(state IN ('proposed','approved','dismissed')), revision INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL, updated_by TEXT NOT NULL, decided_by TEXT, decided_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(organization_id,project_id,month),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    INSERT INTO platform_migrations(version,applied_at) VALUES(38,datetime('now'));
  `))();
  // Phase 4 · who looks after a weekly action or a content plan item, and by when. Internal only; nothing is sent.
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=39').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_coach_assignments (
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, item_kind TEXT NOT NULL CHECK(item_kind IN ('action','content')), item_id TEXT NOT NULL,
      assignee_id TEXT NOT NULL REFERENCES platform_users(id), due_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
      assigned_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(organization_id,project_id,item_kind,item_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE INDEX platform_coach_assignment_assignee ON platform_coach_assignments(organization_id,project_id,assignee_id);
    INSERT INTO platform_migrations(version,applied_at) VALUES(39,datetime('now'));
  `))();
  // Faz 5 · SEO operations: multi-page scans of the project's own site, persistent findings with history.
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=40').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_seo_scans (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, origin TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('sitemap','homepage_links')), discovered INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL CHECK(state IN ('running','completed','cancelled')), started_by TEXT NOT NULL REFERENCES platform_users(id),
      started_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
      UNIQUE(id,organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE INDEX platform_seo_scan_scope ON platform_seo_scans(organization_id,project_id,started_at);
    CREATE TABLE platform_seo_scan_pages (
      scan_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, position INTEGER NOT NULL, url TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','running','done','failed','skipped')), lease_token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      http_status INTEGER, findings INTEGER NOT NULL DEFAULT 0, error TEXT, checked_at TEXT,
      PRIMARY KEY(scan_id,url),
      FOREIGN KEY(scan_id,organization_id,project_id) REFERENCES platform_seo_scans(id,organization_id,project_id)
    );
    CREATE TABLE platform_seo_findings (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, finding_key TEXT NOT NULL, url TEXT NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, priority TEXT NOT NULL CHECK(priority IN ('high','medium','low')),
      detail TEXT NOT NULL, recommendation TEXT NOT NULL, evidence TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('open','fixed','ignored')), first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
      last_scan_id TEXT NOT NULL, fixed_at TEXT, task_id TEXT, revision INTEGER NOT NULL DEFAULT 1,
      UNIQUE(organization_id,project_id,finding_key), UNIQUE(id,organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE INDEX platform_seo_finding_state ON platform_seo_findings(organization_id,project_id,state);
    CREATE TABLE platform_seo_finding_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, finding_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('detected','fixed','reopened','ignored','restored','planned')),
      scan_id TEXT, actor_id TEXT, at TEXT NOT NULL,
      FOREIGN KEY(finding_id,organization_id,project_id) REFERENCES platform_seo_findings(id,organization_id,project_id)
    );
    CREATE INDEX platform_seo_finding_history ON platform_seo_finding_events(finding_id,id);
    INSERT INTO platform_migrations(version,applied_at) VALUES(40,datetime('now'));
  `))();
  // Faz 5 · lifecycle automation: rules, one enrollment per contact per rule, and evaluation/approval runs.
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=41').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_automations (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('draft','active','paused')), definition_json TEXT NOT NULL, source_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, updated_by TEXT NOT NULL, activated_by TEXT, activated_at TEXT,
      last_evaluated_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE TABLE platform_automation_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, automation_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
      source_id TEXT NOT NULL, entity_id TEXT NOT NULL, entered_at TEXT NOT NULL, due_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('waiting','ready','sent','exited')), reason TEXT, job_id TEXT, updated_at TEXT NOT NULL,
      UNIQUE(automation_id,entity_id),
      FOREIGN KEY(automation_id,organization_id,project_id) REFERENCES platform_automations(id,organization_id,project_id)
    );
    CREATE INDEX platform_automation_due ON platform_automation_enrollments(automation_id,state,due_at);
    CREATE INDEX platform_automation_contact ON platform_automation_enrollments(organization_id,project_id,source_id,entity_id,state);
    CREATE TABLE platform_automation_runs (
      id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('evaluate','approve')), mode TEXT CHECK(mode IN ('rehearsal','send')), actor_id TEXT NOT NULL,
      job_id TEXT, counts_json TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(automation_id,organization_id,project_id) REFERENCES platform_automations(id,organization_id,project_id)
    );
    CREATE INDEX platform_automation_run_scope ON platform_automation_runs(automation_id,created_at);
    INSERT INTO platform_migrations(version,applied_at) VALUES(41,datetime('now'));
  `))();
  // Faz 5 · B2B prospects: companies the team enters, checked against their own public page. No people, no emails.
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=42').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_prospects (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, company TEXT NOT NULL, website TEXT NOT NULL,
      sector TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', contact_role TEXT NOT NULL DEFAULT '',
      check_status TEXT NOT NULL DEFAULT 'not_checked' CHECK(check_status IN ('not_checked','ok','unreachable')),
      source_url TEXT, page_title TEXT, page_summary TEXT, evidence TEXT, checked_at TEXT, reason_source TEXT CHECK(reason_source IN ('human','ai')),
      state TEXT NOT NULL DEFAULT 'candidate' CHECK(state IN ('candidate','approved','rejected')), decided_by TEXT, decided_at TEXT, note TEXT NOT NULL DEFAULT '',
      task_id TEXT, revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(organization_id,project_id,website),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE INDEX platform_prospect_scope ON platform_prospects(organization_id,project_id,state,updated_at);
    INSERT INTO platform_migrations(version,applied_at) VALUES(42,datetime('now'));
  `))();
  // Faz 5 · Telegram channel publishing: social accounts accept the 'telegram' platform. Same columns, rows kept.
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=43').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_social_accounts_v43 (
      connection_id TEXT PRIMARY KEY REFERENCES platform_connections(id),
      platform TEXT NOT NULL CHECK(platform IN ('linkedin','twitter','facebook','instagram','telegram')),
      account_id TEXT NOT NULL, expires_at INTEGER, page_id TEXT, graph_version TEXT
    );
    INSERT INTO platform_social_accounts_v43(connection_id,platform,account_id,expires_at,page_id,graph_version) SELECT connection_id,platform,account_id,expires_at,page_id,graph_version FROM platform_social_accounts;
    DROP TABLE platform_social_accounts;
    ALTER TABLE platform_social_accounts_v43 RENAME TO platform_social_accounts;
    INSERT INTO platform_migrations(version,applied_at) VALUES(43,datetime('now'));
  `))();
  // Faz 5 · ad management: per-project budget policy and approved ad plans. Provider objects start paused.
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=44').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_ad_policies (
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, connection_id TEXT NOT NULL, currency TEXT NOT NULL,
      daily_cap_minor INTEGER NOT NULL CHECK(daily_cap_minor>0), monthly_cap_minor INTEGER NOT NULL CHECK(monthly_cap_minor>0),
      revision INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(organization_id,project_id),
      FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
    );
    CREATE TABLE platform_ad_plans (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, connection_id TEXT NOT NULL,
      name TEXT NOT NULL, objective TEXT NOT NULL CHECK(objective IN ('OUTCOME_AWARENESS','OUTCOME_TRAFFIC')),
      special_category TEXT NOT NULL DEFAULT 'NONE', daily_budget_minor INTEGER NOT NULL CHECK(daily_budget_minor>0), currency TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, countries_json TEXT NOT NULL, link_url TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('draft','approved','created','active','paused','failed')),
      digest TEXT NOT NULL, approved_by TEXT, approved_digest TEXT, approved_at TEXT,
      provider_campaign_id TEXT, provider_adset_id TEXT, last_error TEXT, spend_minor INTEGER, spend_checked_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
    );
    CREATE INDEX platform_ad_plan_scope ON platform_ad_plans(organization_id,project_id,state);
    INSERT INTO platform_migrations(version,applied_at) VALUES(44,datetime('now'));
  `))();
  // Budget and goal planner: saved scenarios, and Meta-reported impressions/clicks next to spend for calibration.
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=45').get())db.transaction(()=>db.exec(`
    ALTER TABLE platform_ad_plans ADD COLUMN impressions INTEGER;
    ALTER TABLE platform_ad_plans ADD COLUMN clicks INTEGER;
    CREATE TABLE platform_budget_scenarios (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('paid','seo')), currency TEXT NOT NULL, inputs_json TEXT NOT NULL, sources_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE INDEX platform_budget_scenario_scope ON platform_budget_scenarios(organization_id,project_id,updated_at);
    INSERT INTO platform_migrations(version,applied_at) VALUES(45,datetime('now'));
  `))();
  // Messaging sources: separate per-person duties (read sources, suggest content, publish), Telegram channels the project's
  // own bot was added to, the posts read from them (personal contact details masked) and a sector dictionary.
  if(!db.prepare('SELECT 1 FROM platform_migrations WHERE version=46').get())db.transaction(()=>db.exec(`
    CREATE TABLE platform_messaging_duties (
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, user_id TEXT NOT NULL,
      duty TEXT NOT NULL CHECK(duty IN ('source.read','suggest','publish')), granted_by TEXT NOT NULL, granted_at TEXT NOT NULL,
      PRIMARY KEY(organization_id,project_id,user_id,duty),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE TABLE platform_messaging_settings (
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, dictionary_json TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES platform_projects(id,organization_id)
    );
    CREATE TABLE platform_messaging_sources (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, connection_id TEXT NOT NULL,
      chat_id TEXT NOT NULL, title TEXT NOT NULL, username TEXT, auto_read INTEGER NOT NULL DEFAULT 0, manager_id TEXT NOT NULL,
      last_read_at TEXT, attempted_at TEXT, last_error TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(organization_id,project_id,chat_id),
      FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
    );
    CREATE TABLE platform_messaging_offsets (
      connection_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, next_offset INTEGER NOT NULL DEFAULT 0, read_at TEXT,
      FOREIGN KEY(connection_id,organization_id,project_id) REFERENCES platform_connections(id,organization_id,project_id)
    );
    CREATE TABLE platform_messaging_posts (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES platform_messaging_sources(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL, posted_at TEXT NOT NULL, text TEXT NOT NULL, topics_json TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new','suggested','dismissed')), suggestion TEXT NOT NULL DEFAULT '', content_id TEXT,
      decided_by TEXT, decided_at TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      UNIQUE(source_id,message_id)
    );
    CREATE INDEX platform_messaging_post_scope ON platform_messaging_posts(organization_id,project_id,state,posted_at);
    INSERT INTO platform_migrations(version,applied_at) VALUES(46,datetime('now'));
  `))();
  return db;
}

const globalDb = globalThis as typeof globalThis & { __marketingPlatformDb?: Database.Database };
export function platformDatabase() {
  return globalDb.__marketingPlatformDb ?? (globalDb.__marketingPlatformDb = openPlatformDatabase());
}
