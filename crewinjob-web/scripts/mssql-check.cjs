// Checks the SQL Server connection from appsettings.json without changing anything: npm run db:check
// Prints the server, database and user (never the password), the server version, whether the database exists,
// how many tables it has and what the login may do there.
const sql = require('mssql');
const { connectionString, describe, appSettingsPath } = require('../lib/db/settings.cjs');

(async () => {
  const value = connectionString();
  if (!value) { console.error(`No connection string: add ConnectionStrings.Platform to ${appSettingsPath()}.`); process.exit(1); }
  const target = describe(value);
  console.log(`Server ${target.server}, database ${target.database || '(none)'}, user ${target.user || '(integrated)'}, encrypt ${target.encrypt}${target.trustServerCertificate ? ', server certificate NOT verified' : ''}`);
  const pool = new sql.ConnectionPool(value);
  try {
    const started = Date.now();
    await pool.connect();
    const connected = Date.now() - started;
    const pings = [];
    for (let i = 0; i < 5; i++) { const at = Date.now(); await pool.request().query('SELECT 1'); pings.push(Date.now() - at); }
    const info = (await pool.request().query(`SELECT SERVERPROPERTY('ProductVersion') version, SERVERPROPERTY('Edition') edition, DB_NAME() name,
      CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS varchar(128)) collation,
      (SELECT COUNT(*) FROM sys.tables) tables,
      HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') can_create,
      IS_ROLEMEMBER('db_owner') db_owner, IS_SRVROLEMEMBER('sysadmin') sysadmin`)).recordset[0];
    console.log(`Connected in ${connected} ms; round trip ${Math.min(...pings)}–${Math.max(...pings)} ms.`);
    console.log(`SQL Server ${info.version} (${info.edition}), database ${info.name}, collation ${info.collation}, ${info.tables} table(s).`);
    console.log(`Can create tables: ${info.can_create ? 'yes' : 'no'}; db_owner: ${info.db_owner ? 'yes' : 'no'}; sysadmin: ${info.sysadmin ? 'yes (use a narrower login)' : 'no'}.`);
  } catch (error) {
    console.error(`Connection failed: ${error.code || ''} ${error.message}`.trim());
    process.exitCode = 1;
  } finally { await pool.close().catch(() => undefined); }
})();
