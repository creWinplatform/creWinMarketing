// Copies the Crewin JSON stores — the panel's data/*.json and the agent's files — into legacy_records/legacy_stores
// on SQL Server, then reads every store back and compares it with its file. Only the files are read; nothing is
// changed on disk.
//
//   PLATFORM_APPSETTINGS_PATH=appsettings.Test.json node scripts/legacy-copy.cjs [options]
//     --web-data <dir>    the panel's data folder (default: CREWIN_WEB_DATA_DIR or ./data)
//     --agent-dir <dir>   the agent folder (default: CREWINJOB_AGENT_DIR or ../crewinjob-agent)
//     --replace           overwrite stores that already have rows (default: refuse)
//     --verify-only       compare the tables with the files again, write nothing
//     --live              allow a server that is not local (phase 4): needs db:upgrade first, the switch off and a
//                         verified SQL Server backup of this database from the last 24 hours (--backup <folder> picks one)
//
// Without --live it refuses any server that is not local: the copy into RDS is phase 4 and needs the owner's approval.
// The panel and the agent keep using the files until PLATFORM_LEGACY_STORE=mssql is set, which is the step after this
// copy (set it with the panel and the agent stopped, so no file write lands between the copy and the switch).
const fs = require('node:fs');
const path = require('node:path');
const { connectionString, describe } = require('../lib/db/settings.cjs');
const records = require('../lib/db/legacy-records.cjs');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = name => args.includes(name);
const webData = path.resolve(option('--web-data') || process.env.CREWIN_WEB_DATA_DIR || 'data');
const agentDir = path.resolve(option('--agent-dir') || process.env.CREWINJOB_AGENT_DIR || path.join('..', 'crewinjob-agent'));

const value = connectionString(), target = describe(value);
if (!value) { console.error('No connection string: set PLATFORM_APPSETTINGS_PATH (e.g. appsettings.Test.json) or PLATFORM_MSSQL_CONNECTION.'); process.exit(2); }
const { isLocal, requireFreshBackup } = require('./lib/live-guard.cjs');
// Phase 4 on RDS: only with --live, with the switch still off, after db:upgrade and a fresh verified backup (checked below).
const live = !isLocal(target.server);
if (live && !flag('--live')) { console.error(`Refusing ${target.server}: a server that is not local needs --live (phase 4, with a fresh backup).`); process.exit(2); }
if (live && records.legacyStoreMode() === 'db' && !flag('--verify-only')) { console.error('Refusing: PLATFORM_LEGACY_STORE=mssql is already on, so the tables may hold newer data than the files. Copy with the switch off.'); process.exit(2); }

// A store's data as the panel and the agent read it from its file (missing → null, skipped).
function fromFile(owner, file, options) {
  const full = path.join(owner === 'web' ? webData : agentDir, file);
  if (owner === 'web' && file === 'activity-log-cleared-at.json') {
    const txt = path.join(webData, 'activity-log-cleared-at.txt');
    if (!fs.existsSync(txt)) return null;
    return { full: txt, data: { at: Number(fs.readFileSync(txt, 'utf8')) || 0 } };
  }
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
  if (options.format === 'jsonl') {
    const data = [];
    for (const line of raw.split('\n')) { if (!line.trim()) continue; try { data.push(JSON.parse(line)); } catch { /* a torn line is skipped, as the readers do */ } }
    return { full, data };
  }
  let data;
  try { data = raw.trim() ? JSON.parse(raw) : (options.shape === 'object' ? {} : []); } catch (error) { throw new Error(`${full}: not valid JSON (${error.message})`); }
  const fits = options.shape === 'object' ? data && typeof data === 'object' && !Array.isArray(data) : Array.isArray(data);
  if (!fits) throw new Error(`${full}: expected ${options.shape === 'object' ? 'an object' : 'an array'}`);
  return { full, data };
}

async function ensureTables(db) {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'mssql-schema.sql'), 'utf8').split(/;\s*\n/)
    .map(s => s.replace(/^--.*$/gm, '').trim()).filter(s => /^CREATE/.test(s) && /\[legacy_(records|stores)\]/.test(s));
  let created = 0;
  for (const statement of schema) {
    const table = /^CREATE TABLE \[(\w+)\]/.exec(statement)?.[1], index = /INDEX \[(\w+)\]/.exec(statement)?.[1];
    const exists = table ? await db.get('SELECT 1 AS x FROM sys.tables WHERE name = ?', table) : await db.get('SELECT 1 AS x FROM sys.indexes WHERE name = ?', index);
    if (!exists) { await db.run(statement); created++; }
  }
  // A platform database copied at schema 78 records the new tables as migration 79.
  if (created && await db.get("SELECT 1 AS x FROM sys.tables WHERE name = 'platform_migrations'") && !await db.get('SELECT 1 AS x FROM platform_migrations WHERE version = 79'))
    await db.run("SET IDENTITY_INSERT platform_migrations ON; INSERT INTO platform_migrations(version, applied_at) VALUES(79, CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 126)); SET IDENTITY_INSERT platform_migrations OFF;");
  return created;
}

(async () => {
  const db = records.mssqlRecordsDb(value), store = records.recordStore(db);
  const report = [];
  let failed = 0;
  try {
    let created = 0;
    if (live && !flag('--verify-only')) {
      if (!await db.get("SELECT 1 AS x FROM sys.tables WHERE name = 'legacy_records'")) throw new Error('The tables are missing: run npm run db:upgrade -- --apply first.');
      const backup = await requireFreshBackup({ connection: value, folder: option('--backup') });
      console.log(`Backup: ${path.basename(backup.folder)} (${backup.createdAt}) verified.`);
    } else if (!flag('--verify-only')) created = await ensureTables(db);
    const all = [...Object.entries(records.WEB_STORES).map(([file, options]) => ['web', file, options]), ...Object.entries(records.AGENT_STORES).map(([file, options]) => ['agent', file, options])];
    for (const [owner, file, options] of all) {
      const name = records.storeName(owner, file), source = fromFile(owner, file, options);
      if (!source) { report.push({ store: name, file: 'missing', rows: 0, result: 'skipped' }); continue; }
      const count = options.shape === 'object' ? Object.keys(source.data).length : source.data.length;
      if (!flag('--verify-only')) {
        if (await store.exists(name) && !flag('--replace')) { report.push({ store: name, file: path.relative(process.cwd(), source.full), rows: count, result: 'exists (use --replace)' }); failed++; continue; }
        await store.write(name, options.shape, source.data, { key: options.key });
      }
      const back = await store.read(name, options.shape);
      const same = JSON.stringify(back) === JSON.stringify(source.data);
      if (!same) failed++;
      report.push({ store: name, file: path.relative(process.cwd(), source.full), rows: count, bytes: fs.statSync(source.full).size, result: same ? 'ok' : 'DIFFERENT' });
    }
    console.log(`Target: ${target.server} / ${target.database}${created ? ` (created ${created} table/index object(s))` : ''}`);
    console.table(report);
    console.log(`Stores in use: ${records.legacyStoreMode() === 'db' ? 'tables (PLATFORM_LEGACY_STORE=mssql)' : 'files — the tables are used once PLATFORM_LEGACY_STORE=mssql is set'}.`);
  } finally {
    await db.close();
  }
  if (failed) { console.error(`${failed} store(s) not copied or not identical.`); process.exitCode = 1; }
})().catch(error => { console.error(`Copy failed: ${error.message}`); process.exitCode = 1; });
