import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { basename, dirname, join } from 'node:path';
import { latestBackupFolder, verifyBackup } from './platform-recovery.mjs';

// Off-host copy of the newest verified backup to a private S3 bucket. Only the sealed database and its manifest leave
// the host; a key file is never uploaded. Objects are written once (If-None-Match) with server-side encryption and a
// SHA-256 checksum S3 verifies, then read back with HEAD. Nothing is ever deleted: retention is the bucket's lifecycle.
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const PREFIX = /^[A-Za-z0-9._-]{1,64}(?:\/[A-Za-z0-9._-]{1,64}){0,4}$/;
export class OffsiteError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new OffsiteError(code); };

export function offsiteConfiguration(env = process.env) {
  if (env.PLATFORM_OFFSITE_ENABLED !== '1') return null;
  const bucket = env.PLATFORM_OFFSITE_S3_BUCKET || '', region = env.PLATFORM_OFFSITE_S3_REGION || '', prefix = env.PLATFORM_OFFSITE_S3_PREFIX || 'ryzevo-backups';
  const kmsKeyId = env.PLATFORM_OFFSITE_KMS_KEY_ID || '', instanceRole = env.PLATFORM_OFFSITE_USE_INSTANCE_ROLE === '1';
  const accessKeyId = env.PLATFORM_OFFSITE_AWS_ACCESS_KEY_ID || '', secretAccessKey = env.PLATFORM_OFFSITE_AWS_SECRET_ACCESS_KEY || '', sessionToken = env.PLATFORM_OFFSITE_AWS_SESSION_TOKEN || '';
  if (!BUCKET.test(bucket) || !/^[a-z]{2}-[a-z]+-\d$/.test(region) || !PREFIX.test(prefix) || prefix.split('/').some(part => part === '.' || part === '..')) fail('invalid_offsite_configuration');
  if (kmsKeyId && !/^[A-Za-z0-9:/_-]{1,256}$/.test(kmsKeyId)) fail('invalid_offsite_configuration');
  if (!instanceRole && (!/^(AKIA|ASIA)[A-Z0-9]{16}$/.test(accessKeyId) || !/^[A-Za-z0-9/+=]{40}$/.test(secretAccessKey) || sessionToken.length > 4096)) fail('invalid_offsite_configuration');
  return { bucket, region, prefix, kmsKeyId, instanceRole, credentials: instanceRole ? null : { accessKeyId, secretAccessKey, sessionToken } };
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
// S3 encodes each path segment once (RFC 3986 unreserved characters stay as they are).
export const s3Path = key => '/' + key.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
// AWS Signature Version 4 for a single S3 request without a query string.
export function signS3({ method, host, path, headers = {}, payloadHash, region, credentials, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, ''), day = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])),
    host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...(credentials.sessionToken ? { 'x-amz-security-token': credentials.sessionToken } : {}) };
  const names = Object.keys(all).sort(), signed = names.join(';');
  const canonical = [method, path, '', names.map(name => `${name}:${all[name]}\n`).join(''), signed, payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`, toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), 's3'), 'aws4_request');
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${createHmac('sha256', key).update(toSign).digest('hex')}` };
}

// Real transport: HTTPS only, no redirects, the file streamed so large databases never sit in memory.
export const httpsTransport = ({ method, host, path, headers, file }) => new Promise((resolve, reject) => {
  const req = httpsRequest({ method, host, path, headers, timeout: 300000 }, response => { response.resume(); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers })); });
  req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
  if (file) createReadStream(file).on('error', error => req.destroy(error)).pipe(req); else req.end();
});
// EC2 instance role credentials through IMDSv2 (a session token first, then the role's temporary keys).
export async function instanceCredentials(fetchImpl = fetch) {
  const base = 'http://169.254.169.254/latest', signal = () => AbortSignal.timeout(3000);
  const token = await (await fetchImpl(`${base}/api/token`, { method: 'PUT', headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '300' }, signal: signal() })).text();
  const headers = { 'x-aws-ec2-metadata-token': token };
  const role = (await (await fetchImpl(`${base}/meta-data/iam/security-credentials/`, { headers, signal: signal() })).text()).split('\n')[0].trim();
  if (!/^[\w+=,.@-]{1,128}$/.test(role)) fail('instance_role_unavailable');
  const value = await (await fetchImpl(`${base}/meta-data/iam/security-credentials/${role}`, { headers, signal: signal() })).json();
  if (!/^ASIA[A-Z0-9]{16}$/.test(value?.AccessKeyId || '') || typeof value.SecretAccessKey !== 'string' || typeof value.Token !== 'string') fail('instance_role_unavailable');
  return { accessKeyId: value.AccessKeyId, secretAccessKey: value.SecretAccessKey, sessionToken: value.Token };
}

async function readState(statePath) { try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return {}; } }
async function writeState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' }); await rename(temporary, statePath);
}

// Copies the newest backup once. The state file keeps only folder names, times and an error code.
export async function copyLatestBackup({ backupRoot, statePath, env = process.env, transport = httpsTransport, fetchImpl = fetch, now = () => new Date() }) {
  const configuration = offsiteConfiguration(env);
  if (!configuration) return { status: 'disabled' };
  const previous = await readState(statePath), attemptAt = now().toISOString();
  try {
    const latest = await latestBackupFolder(backupRoot);
    if (!latest) fail('backup_missing');
    const folder = basename(latest);
    if (previous.folder === folder) return { status: 'up_to_date', folder };
    const backup = await verifyBackup(latest);
    const credentials = configuration.credentials || await instanceCredentials(fetchImpl).catch(error => { throw error instanceof OffsiteError ? error : new OffsiteError('instance_role_unavailable'); });
    const host = `${configuration.bucket}.s3.${configuration.region}.amazonaws.com`;
    const base = `${configuration.prefix}/${backup.checks.databaseId || 'unknown-database'}/${folder}`;
    const manifestFile = join(latest, 'manifest.json'), manifestBytes = await readFile(manifestFile);
    // The manifest goes last, so a folder with a manifest in S3 is complete.
    // A SQLite backup is one database file; a SQL Server backup (format 3) one file per table.
    const data = backup.manifest.formatVersion === 3
      ? backup.manifest.tables.map(table => ({ name: table.file, file: join(latest, table.file), sha: table.sha256, bytes: table.bytes }))
      : [{ name: 'platform.sqlite', file: join(latest, 'platform.sqlite'), sha: backup.manifest.databaseSha256, bytes: backup.manifest.databaseBytes }];
    const objects = [...data, { name: 'manifest.json', file: manifestFile, sha: sha256(manifestBytes), bytes: manifestBytes.length }];
    for (const object of objects) {
      if ((await stat(object.file)).size !== object.bytes) fail('backup_changed');
      const path = s3Path(`${base}/${object.name}`), checksum = Buffer.from(object.sha, 'hex').toString('base64');
      const encryption = configuration.kmsKeyId ? { 'x-amz-server-side-encryption': 'aws:kms', 'x-amz-server-side-encryption-aws-kms-key-id': configuration.kmsKeyId } : { 'x-amz-server-side-encryption': 'AES256' };
      const headers = signS3({ method: 'PUT', host, path, payloadHash: object.sha, region: configuration.region, credentials, now: now(),
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(object.bytes), 'if-none-match': '*', 'x-amz-checksum-sha256': checksum, ...encryption } });
      const put = await transport({ method: 'PUT', host, path, headers, file: object.file });
      // 412: an earlier run already wrote this object; the read-back below decides whether it is the same one.
      if (put.status !== 200 && put.status !== 412) fail(put.status === 403 ? 'offsite_access_denied' : `offsite_put_${put.status}`);
      const head = await transport({ method: 'HEAD', host, path, headers: signS3({ method: 'HEAD', host, path, payloadHash: sha256(''), region: configuration.region, credentials, now: now(), headers: { 'x-amz-checksum-mode': 'ENABLED' } }) });
      if (head.status !== 200 || Number(head.headers['content-length']) !== object.bytes || head.headers['x-amz-checksum-sha256'] !== checksum) fail('offsite_verify_failed');
    }
    await writeState(statePath, { folder, copiedAt: now().toISOString(), lastAttemptAt: attemptAt, error: null, objects: objects.length });
    return { status: 'copied', folder, objects: objects.length, keyFileCopied: false, keyFileKeptLocal: backup.manifest.keySource === 'file' };
  } catch (error) {
    const code = error instanceof OffsiteError ? error.code : error?.code === 'ENOENT' ? 'backup_missing_or_incomplete' : 'offsite_copy_failed';
    await writeState(statePath, { ...previous, lastAttemptAt: attemptAt, error: code }).catch(() => {});
    return { status: 'failed', code };
  }
}

// For the monitor: whether the last successful copy is recent and the last attempt did not fail.
export async function offsiteChecks(statePath, { expected, maxAgeHours }, now, alert) {
  if (!expected) return { status: 'not_expected' };
  const state = await readState(statePath), copied = Date.parse(state.copiedAt);
  if (!Number.isFinite(copied)) { alert('offsite_copy_missing', 'critical'); return { status: 'missing' }; }
  if (state.error) alert('offsite_copy_failed', 'warning');
  const stale = now - copied > maxAgeHours * 3600000;
  if (stale) alert('offsite_copy_stale', 'critical');
  return { status: stale ? 'stale' : state.error ? 'failing' : 'copied', copiedAt: state.copiedAt };
}
