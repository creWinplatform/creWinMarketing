// Translates every SQL statement in lib/ and app/ to T-SQL and compiles it (SET NOEXEC ON: nothing runs) against the
// generated schema on a SQL Server, so each one is known to parse and to name real tables and columns.
//   PLATFORM_APPSETTINGS_PATH=appsettings.Test.json node scripts/mssql-sql-audit.cjs [--show N] [--file part]
// Migration DDL (lib/platform/database.ts) is skipped: SQL Server gets the generated schema instead.
const sql = require('mssql');
const { extractAll } = require('./lib/sql-extract.cjs');
const { translate } = require('../lib/db/translate.cjs');
const { connectionString } = require('../lib/db/settings.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const show = Number(arg('show', 25)), only = arg('file', '');

(async () => {
  const queries = extractAll().filter(q => q.file !== 'lib/platform/database.ts' && !q.file.startsWith('lib/db/') && (!only || q.file.includes(only)));
  const pool = await new sql.ConnectionPool(connectionString()).connect();
  // SQL Server defers resolving table names until run time, so NOEXEC passes a missing table: check names here.
  const tables = new Set((await pool.request().query("SELECT name FROM sys.tables")).recordset.map(r => r.name.toLowerCase()));
  const missingTable = text => [...text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+\[?([A-Za-z_]\w*)\b\]?(?!\s*\()/gi)].map(m => m[1]).find(name => /^(platform|sqlite)_/i.test(name) && !tables.has(name.toLowerCase()));
  const failures = [], skipped = [];
  let passed = 0;
  for (const q of queries) {
    if (!q.sql || q.dynamic) { skipped.push(q); continue; }
    if (/^\s*PRAGMA/i.test(q.sql)) { skipped.push({ ...q, reason: 'PRAGMA' }); continue; }
    let translated;
    try { translated = translate(q.sql); } catch (error) { failures.push({ ...q, stage: 'translate', error: error.message }); continue; }
    // Parameters are declared as NVARCHAR, except where T-SQL needs a number (TOP, OFFSET/FETCH).
    const declare = Array.from({ length: translated.count }, (_, i) => {
      const name = `@p${i + 1}`, numeric = new RegExp(`(TOP\\(|OFFSET |FETCH NEXT |DATEADD\\(\\w+,)${name}\\b`).test(translated.sql);
      return `DECLARE ${name} ${numeric ? 'BIGINT' : 'NVARCHAR(4000)'};`;
    }).join(' ');
    try {
      await pool.request().batch(`SET NOEXEC ON; ${declare} ${translated.sql}; SET NOEXEC OFF;`);
      const missing = missingTable(translated.sql);
      if (missing) { failures.push({ ...q, stage: 'tables', error: `Unknown table ${missing}`, translated: translated.sql }); continue; }
      passed++;
    } catch (error) {
      await pool.request().batch('SET NOEXEC OFF;').catch(() => undefined);
      // At run time a Buffer parameter is sent as VARBINARY; only this check declares every parameter as text.
      if (/nvarchar to varbinary/i.test(error.message)) { passed++; continue; }
      failures.push({ ...q, stage: 'compile', error: error.message, translated: translated.sql });
    }
  }
  await pool.close();
  const byError = new Map();
  for (const f of failures) { const key = f.error.replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"').slice(0, 90); byError.set(key, (byError.get(key) || 0) + 1); }
  console.log(`${queries.length} statements: ${passed} compile, ${failures.length} fail, ${skipped.length} skipped (dynamic or PRAGMA).`);
  for (const [key, count] of [...byError].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(count).padStart(4)}  ${key}`);
  for (const f of failures.slice(0, show)) {
    console.log(`\n${f.file}:${f.line} [${f.stage}] ${f.error.slice(0, 200)}`);
    console.log(`  sqlite: ${f.sql.replace(/\s+/g, ' ').slice(0, 300)}`);
    if (f.translated) console.log(`  t-sql:  ${f.translated.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  process.exitCode = failures.length ? 1 : 0;
})().catch(error => { console.error(error.message); process.exit(2); });
