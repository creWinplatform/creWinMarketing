import Database from 'better-sqlite3';
import { createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { join, parse, relative, resolve, sep } from 'node:path';

// Bump alongside schema changes and add any new encrypted-column AAD contracts.
export const MAX_RECOVERY_SCHEMA = 45;
const MAX_DATABASE_BYTES = 4 * 1024 ** 3;
const identifier = value => `"${value.replaceAll('"', '""')}"`;
export class RecoveryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function fail(code) { throw new RecoveryError(code); }

export async function rejectLinks(path) {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) fail('unsafe_link');
  }
}

export async function fileDigest(path, maxBytes = MAX_DATABASE_BYTES) {
  await rejectLinks(path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) fail('invalid_file');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > maxBytes) fail('file_too_large');
    hash.update(chunk);
  }
  if (bytes !== stat.size) fail('file_changed');
  return { sha256: hash.digest('hex'), bytes };
}

export function checkedKey(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) fail('invalid_key');
  return value.toLowerCase();
}

export async function readKeyFile(path) {
  await rejectLinks(path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 128) fail('invalid_key');
  return checkedKey((await readFile(path, 'utf8')).trim());
}

function proofPayload(manifest) {
  const fields = ['ryzevo-backup-v2', manifest.createdAt, manifest.database,
    manifest.databaseSha256, manifest.databaseBytes, manifest.schemaVersion, manifest.keySource];
  // Existing pre-27 version-2 backups remain verifiable, without a source binding.
  if (Object.hasOwn(manifest, 'databaseId')) fields.push(manifest.databaseId);
  return JSON.stringify(fields);
}
export function keyProof(manifest, key) {
  return createHmac('sha256', Buffer.from(checkedKey(key), 'hex')).update(proofPayload(manifest)).digest('hex');
}

// Verify v1 AES-GCM envelopes offline without importing the application, migrating
// its database or retaining any decrypted provider credential in the report.
function verifyEnvelope(value, key, scope) {
  if (typeof value !== 'string' || value.length > 8 * 1024 ** 2) fail('invalid_envelope');
  let clear;
  try {
    const envelope = JSON.parse(value);
    if (envelope.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string') fail('invalid_envelope');
    const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) fail('invalid_envelope');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAAD(Buffer.from(JSON.stringify(scope)));
    decipher.setAuthTag(tag);
    clear = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    const parsed = JSON.parse(clear.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') fail('invalid_envelope');
  } catch { fail('credential_authentication_failed'); }
  finally { clear?.fill(0); }
}

const ENCRYPTED_COLUMNS = [
  { since: 2, table: 'platform_connections', column: 'encrypted_credentials', resource: row => row.id },
  { since: 5, table: 'platform_oauth_requests', column: 'encrypted_verifier', resource: row => row.state_hash },
  { since: 11, table: 'platform_product_sources', column: 'encrypted_checkpoint', resource: row => `${row.connection_id}:checkpoint` },
  { since: 15, table: 'platform_email_consents', column: 'encrypted_evidence', resource: row => row.contact_key },
  { since: 16, table: 'platform_email_sender', column: 'encrypted_challenge', resource: () => 'email-domain' },
  { since: 17, table: 'platform_email_pilots', column: 'encrypted_snapshot', resource: row => row.job_id },
  { since: 18, table: 'platform_email_pilot_recipients', column: 'encrypted_message', resource: row => `${row.job_id}:${row.position}` },
  { since: 18, table: 'platform_email_ses', column: 'encrypted_credentials', resource: () => 'ses-provider' },
  { since: 20, table: 'platform_social_publications', column: 'encrypted_snapshot', resource: row => `publication:${row.job_id}` },
  { since: 22, table: 'platform_identity_challenges', column: 'encrypted_delivery', resource: row => row.token_hash, scope: ['platform-identity', 'system-email'] },
  { since: 24, table: 'platform_billing_orders', column: 'encrypted_token', resource: row => row.id },
  { since: 29, table: 'platform_mobile_contacts', column: 'encrypted_destination', resource: row => `mobile-contact:${row.id}` },
  { since: 29, table: 'platform_mobile_messages', column: 'encrypted_snapshot', resource: row => `mobile-message:${row.job_id}` },
];

export function inspectSnapshot(file, key, expectedSchema) {
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    db.pragma('trusted_schema = OFF');
    db.pragma('query_only = ON');
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') fail('database_integrity_failed');
    if (db.pragma('foreign_key_check').length) fail('foreign_key_failed');
    const versions = db.prepare('SELECT version FROM platform_migrations ORDER BY version').all().map(row => row.version);
    const schemaVersion = versions.at(-1);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > MAX_RECOVERY_SCHEMA) fail('unsupported_schema');
    if (versions.some((value, index) => value !== index + 1) || (expectedSchema !== undefined && schemaVersion !== expectedSchema)) fail('schema_mismatch');
    const tables = new Map();
    for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'platform_*'").all()) {
      if (!/^platform_[a-z0-9_]+$/.test(name)) fail('unsupported_table');
      tables.set(name, new Set(db.pragma(`table_info(${identifier(name)})`).map(column => column.name)));
    }
    for (const name of ['platform_users', 'platform_organizations', 'platform_projects', 'platform_memberships']) {
      if (!tables.has(name)) fail('schema_mismatch');
    }
    const databaseId = schemaVersion >= 27 ? db.prepare("SELECT value FROM platform_operation_metadata WHERE key='database_id'").get()?.value : null;
    if (schemaVersion >= 27 && (typeof databaseId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(databaseId))) fail('schema_mismatch');
    let scopedTables = 0, scopedReferences = 0;
    const scoped = columns => columns?.has('organization_id') && columns.has('project_id');
    for (const [table, columns] of tables) {
      if (!scoped(columns)) continue;
      const name = identifier(table);
      const nullable = table === 'platform_enrollments' ? 'AND NOT (c.organization_id IS NULL AND c.project_id IS NULL)' : '';
      if (db.prepare(`SELECT 1 FROM ${name} c LEFT JOIN platform_projects p ON p.id=c.project_id AND p.organization_id=c.organization_id WHERE p.id IS NULL ${nullable} LIMIT 1`).get()) fail('project_scope_failed');
      scopedTables++;
      const groups = new Map();
      for (const fk of db.pragma(`foreign_key_list(${name})`)) {
        if (!groups.has(fk.id)) groups.set(fk.id, []);
        groups.get(fk.id).push(fk);
      }
      for (const fields of groups.values()) {
        const parent = fields[0].table;
        if (!scoped(tables.get(parent))) continue;
        if (fields.some(field => !field.to || !columns.has(field.from) || !tables.get(parent).has(field.to))) fail('schema_mismatch');
        const on = fields.map(field => `c.${identifier(field.from)}=p.${identifier(field.to)}`).join(' AND ');
        if (db.prepare(`SELECT 1 FROM ${name} c JOIN ${identifier(parent)} p ON ${on} WHERE c.organization_id<>p.organization_id OR c.project_id<>p.project_id LIMIT 1`).get()) fail('reference_scope_failed');
        scopedReferences++;
      }
    }
    // Fail closed when a future encrypted field has no tested recovery contract.
    for (const [table, columns] of tables) for (const column of columns) {
      if (column.startsWith('encrypted_') && !ENCRYPTED_COLUMNS.some(item => item.table === table && item.column === column)) fail('unsupported_encrypted_column');
    }
    let encryptedRecords = 0;
    for (const contract of ENCRYPTED_COLUMNS) {
      if (schemaVersion < contract.since) continue;
      if (!tables.get(contract.table)?.has(contract.column)) fail('schema_mismatch');
      for (const row of db.prepare(`SELECT * FROM ${identifier(contract.table)} WHERE ${identifier(contract.column)} IS NOT NULL AND ${identifier(contract.column)}<>''`).iterate()) {
        if (!key) fail('missing_key');
        if (++encryptedRecords > 1000000) fail('record_limit_exceeded');
        verifyEnvelope(row[contract.column], checkedKey(key), [...(contract.scope || [row.organization_id, row.project_id]), contract.resource(row)]);
      }
    }
    return { schemaVersion, databaseId, integrity: 'ok', foreignKeys: 'ok', scopedTables, scopedReferences, encryptedRecords,
      credentialCheck: encryptedRecords ? 'authenticated' : 'no_encrypted_records' };
  } finally { db.close(); }
}

export async function verifyBackup(directory, environmentKey = process.env.PLATFORM_ENCRYPTION_KEY) {
  const folder = resolve(directory);
  await rejectLinks(folder);
  const manifestFile = join(folder, 'manifest.json');
  await fileDigest(manifestFile, 8192);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (manifest.formatVersion !== 2) fail('unsupported_backup_format');
  if (manifest.database !== 'platform.sqlite' || !['file', 'environment', 'not_created'].includes(manifest.keySource) ||
      !Number.isSafeInteger(manifest.databaseBytes) || manifest.databaseBytes < 1 || manifest.databaseBytes > MAX_DATABASE_BYTES ||
      !/^[a-f0-9]{64}$/.test(manifest.databaseSha256) || !Number.isFinite(Date.parse(manifest.createdAt)) ||
      manifest.restoreRequiresAuthSecret !== true) fail('invalid_manifest');
  const database = join(folder, 'platform.sqlite');
  // A sealed online snapshot must be standalone, not dependent on unrecorded WAL.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { await lstat(database + suffix); fail('snapshot_sidecar_found'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const digest = await fileDigest(database);
  if (digest.sha256 !== manifest.databaseSha256 || digest.bytes !== manifest.databaseBytes) fail('database_hash_mismatch');
  const handle = await open(database, 'r');
  try {
    const header = Buffer.alloc(20);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 20 || header[18] !== 1 || header[19] !== 1) fail('snapshot_not_sealed');
  } finally { await handle.close(); }
  const key = manifest.keySource === 'environment' ? checkedKey(environmentKey) :
    manifest.keySource === 'file' ? await readKeyFile(join(folder, 'platform-credentials.key')) : null;
  if (key) {
    if (typeof manifest.keyProof !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.keyProof) ||
        !timingSafeEqual(Buffer.from(keyProof(manifest, key), 'hex'), Buffer.from(manifest.keyProof, 'hex'))) fail('key_mismatch');
  } else if (manifest.keyProof !== null) fail('invalid_manifest');
  const checks = inspectSnapshot(database, key, manifest.schemaVersion);
  if ((manifest.databaseId ?? null) !== checks.databaseId) fail('database_identity_mismatch');
  return { folder, manifest, checks };
}

export async function disjointOutputRoot(backup, outputRoot) {
  const source = await realpath(backup), root = resolve(outputRoot);
  await rejectLinks(root);
  const diff = relative(source, root);
  if (diff === '' || (!diff.startsWith('..' + sep) && diff !== '..' && !parse(diff).root)) fail('output_inside_backup');
  return root;
}

export function recoveryErrorCode(error) {
  return error instanceof RecoveryError ? error.code :
    error?.code === 'ENOENT' ? 'file_missing' :
    error?.code === 'EACCES' || error?.code === 'EPERM' ? 'access_denied' : 'recovery_check_failed';
}
