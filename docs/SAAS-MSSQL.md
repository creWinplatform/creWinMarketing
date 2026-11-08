# Moving all data to SQL Server (AWS RDS)

Branch `feat/mssql`, started 8 November 2026. The goal: SQL Server on AWS RDS becomes the only database.
It holds the Ryzevo platform data (today `data/platform.sqlite`), the Crewin panel files (`data/*.json`) and the
agent files (`crewinjob-agent`). SQLite stays as the fallback until the move is verified.

## Connection settings

The connection string goes in `crewinjob-web/appsettings.json`, which git ignores (`.gitignore` and
`.git/info/exclude`). It is never printed.

```json
{
  "ConnectionStrings": {
    "Platform": "Server=<instance>.rds.amazonaws.com,1433;Database=Ryzevo;User Id=<login>;Password=<password>;TrustServerCertificate=True"
  }
}
```

- ADO.NET spellings work as in ABP: `User`, `UID` and `PWD` are renamed for the Node driver.
- `PLATFORM_MSSQL_CONNECTION` overrides the file.
- `PLATFORM_APPSETTINGS_PATH` points at another file, for example `appsettings.Test.json` for the local test server.
- `npm run db:check` connects without changing anything. It prints:
  - the server, database and user;
  - the round-trip time;
  - the collation and table count.

## Phases

| # | Phase | Touches real data |
|---|---|---|
| 0 | Connection check; the SQL Server schema generated from the SQLite schema; a local test server | No |
| 1 | An async data layer with one interface for SQLite and SQL Server; modules move one by one, tests pass at each step | No |
| 2 | `data/*.json` and the agent files move into tables | No |
| 3 | Backup, recovery drill and the encrypted-column check work against RDS (snapshots plus an export) | No |
| 4 | Copy: a trial on a copy, row counts and encrypted fields checked, then the real copy and the switch, with approval | Yes |

## Phase 0 (done)

- **Schema:** `scripts/mssql-schema.cjs` (`npm run db:schema`) generates `lib/db/mssql-schema.sql` from the schema the
  SQLite migrations build, so the two never drift. Version 78 gives 152 tables, 200 foreign keys, 178 CHECK
  constraints and every index. All of them apply without error on SQL Server 2022.
- **Mapping:**
  - TEXT used in a key, index or foreign key → `NVARCHAR(170)`. Other TEXT → `NVARCHAR(MAX)`. NVARCHAR matches the
    driver's string parameters, so lookups use the index without a conversion, and it keeps Unicode whatever the
    database collation is.
  - `Latin1_General_100_BIN2` keeps SQLite's case-sensitive comparison and ordering. `COLLATE NOCASE` becomes
    `Latin1_General_100_CI_AS_SC`.
  - INTEGER → `BIGINT`, REAL → `FLOAT`, BLOB → `VARBINARY(MAX)`.
  - A single INTEGER primary key becomes `IDENTITY`. Other tables get a `rowid BIGINT IDENTITY` column, so
    `ORDER BY rowid` keeps insertion order.
  - Primary keys are nonclustered, so a composite key can use up to 1,700 bytes.
  - CHECK constraints: `GLOB` → `LIKE`, `length` → `LEN`. Reserved column names are bracketed.
- **Real data fits:** every key value in the real database is under 150 characters. On 8 November the database was
  1.8 MB with 101 rows.
- **RDS:** `npm run db:check` connects to the `Ryzevo` database (eu-west-1, SQL Server 2022 Web Edition). The
  database is still empty. The round trip from the development PC is 170–770 ms.
- **Test server:** the Docker container `ryzevo-mssql-test` (SQL Server 2022 Developer) on 127.0.0.1:14330, for tests
  only. Its connection string is in `appsettings.Test.json`, which git ignores.

## Phase 1: the async data layer

`better-sqlite3` is synchronous; the SQL Server driver (`mssql`) is asynchronous. About 1,450 statements in 97 files
and 377 transactions call the database synchronously today.

### Done (8 November)

- **SQL translation** (`lib/db/translate.cjs`): the code keeps one SQLite text per statement. The SQL Server client
  translates each distinct statement once:
  - `?` → `@p1…`; `LIMIT`/`OFFSET` → `TOP` or `OFFSET … FETCH`.
  - `datetime`, `date`, `strftime` and `julianday` → T-SQL date functions.
  - `INSERT OR IGNORE` and `ON CONFLICT DO NOTHING` → an insert that skips duplicate-key errors.
  - `ON CONFLICT … DO UPDATE` → a locked update-or-insert. `INSERT OR REPLACE` → delete and insert on the key.
  - `INSERT INTO t VALUES(…)` gets its column list from the schema.
  - `json_extract` → `JSON_VALUE`; `json_each` → `OPENJSON` (with `CROSS APPLY`); `json_group_array` → `STRING_AGG`.
  - Predicates used as values (`SUM(kind='x')`, `ORDER BY x IS NULL`, `SELECT EXISTS(…)`) → `CASE WHEN`.
  - Bare integer conditions (`WHERE active`) → `<>0`. HAVING on a select alias → the expression.
  - `LIKE` stays case-insensitive and `GLOB` case-sensitive, as in SQLite.
  - Derived tables get an alias.
- **Audit** (`npm run db:audit`): extracts every SQL statement from `lib/` and `app/` with the TypeScript parser,
  translates it and compiles it on the test server. `SET NOEXEC ON` is used, so nothing runs.
  - **All 1,417 static statements compile.**
  - The 36 statements built at run time are checked by the tests.
- **Three statements rewritten** in a form both databases accept:
  - `marketing-store.ts`: a row-value `IN` → `EXISTS`;
  - `operator.ts`: an aggregate over a subquery → `LEFT JOIN`;
  - `link-tracking.ts`: ungrouped columns → group first, then title.
- **The `Db` interface** (`lib/db/client.ts`): `get`, `all`, `run` (changed rows), `prepare` and
  `transaction(async () => …)`, all async, for SQLite and SQL Server.
  - Calls made inside a transaction join it through `AsyncLocalStorage`, so the callback needs no separate handle.
    A nested transaction is a savepoint.
  - SQLite: other requests wait while a transaction holds the single connection.
  - SQL Server: BIGINT comes back as a number, Buffers as `VARBINARY`.
  - `test/db-client.test.cjs` runs the same checks on both databases.

### Done (9 November): every caller is async

- **Codemod** (`scripts/codemod-async-db.cjs`, TypeScript compiler API): `db.prepare(s).get/all/run(…)` and
  `db.transaction(fn)()` / `.immediate()` became awaited async calls. Every function that awaits became async, and
  with the type checker so did every caller, until nothing changed: 845 functions in 176 files. `Database.Database`
  → `Db`.
  - Array callbacks that read the database run one item at a time, in order, as before
    (`mapSeries`, `filterSeries`, … in `lib/db/async-array.ts`).
  - Fixed by hand where no tool can see it:
    - the `reserve()` / `beforeSubmit()` / `stillValid()` callbacks that guard "send once" are awaited in every
      publisher;
    - callback helpers take async callbacks (`runCoachAi`, OAuth `finish`, job guide `add`, unsubscribe
      `afterBlock`);
    - the `CrewinIys` interface is async;
    - returned closures are awaited (`authenticateProductWebhook(…)(bytes)`);
    - a stored product-sync commit stays a function;
    - default parameters no longer await.
- **Checks:**
  - `scripts/promise-audit.cjs` lists promises used without `await` (in conditions, JSON bodies, spreads) that the
    compiler accepts. None are left from the move.
  - `npm run db:audit` also checks table names, which SQL Server resolves only at run time. "Does this table
    exist" queries on `sqlite_schema` are translated to `sys.tables`.
- **Schema:** a UNIQUE index over a nullable column covers only rows where it is set. SQL Server otherwise allows
  one NULL, while SQLite allows any number.
- **Tests** (`scripts/codemod-async-tests.cjs` plus fixes by hand):
  - `test/platform-loader.cjs` gives the test handle the async `transaction()` (`asDb`). Tests still seed and read
    with synchronous SQL.
  - Results:

    | Suite | Result |
    |---|---|
    | All platform tests | 914 / 914 |
    | Other test files (legacy WhatsApp, İYS, …) | Pass |
    | HTTP test against a production build | Passes |
    | `test/db-client.test.cjs` | Passes on both databases |

  - One HTTP assertion was outdated since `9ad4a67`: the Crewin workspace may manage product webhooks.
- **On SQL Server:** `npm run db:smoke` resets a local test database and runs real flows through the async Db. It
  refuses any non-local server. Covered:
  - provisioning two tenants, isolation, login limits and members;
  - tasks, campaigns and content (Turkish and emoji round trip);
  - coach, job guide, alerts, billing, usage reservation and portfolio.

  All pass.
- **QA fixture:** `scripts/preview-design.cjs` runs on the async code. Login and the workspace, coach, job guide and
  billing APIs answer 200.

### Next

- **Phase 2:** move `data/*.json` and the agent files into tables.
- **Phase 3:** backup, drill and recovery checks for SQL Server.
- **Phase 4:** the data copy (trial, then real, with approval) and the switch (`PLATFORM_DATABASE_PROVIDER=mssql`).
- **Speed:** hot paths that run dozens of statements are batched. The panel is fastest in the same AWS region as RDS.

## Phase 4: the platform data copy (8 November)

- **Tool:** `npm run db:copy` (`scripts/mssql-copy.cjs`).
  1. It takes a consistent snapshot of `data/platform.sqlite` (SQLite online backup) and checks that its schema
     version matches `lib/db/mssql-schema.sql`.
  2. It refuses a target database that already has tables.
  3. In one transaction it creates the schema, copies every row in rowid order with explicit ids kept, re-seeds
     AUTOINCREMENT tables, and re-validates every foreign key and CHECK constraint (`WITH CHECK`) before the
     commit. A failure leaves the target empty.
  4. It compares each table's row count and a hash of every value with the snapshot.
  - `--database <name> --create` copies into another database on the same server. `--verify-only` compares an
    existing copy with the source again.
- **Done:** the platform data (schema 78, 152 tables, 101 rows) was copied into `Ryzevo` and verified. The
  repository's `workspace()` returns the same result on both databases.
- **Not yet:** the Crewin `data/*.json` files (phase 2). The panel still runs on SQLite, so writes made after the
  copy are not in `Ryzevo`. The copy has to be redone, or the difference moved, at the switch.

## The test database: `Ryzevo_Trial`

- `Ryzevo_Trial` on the same RDS instance holds the same copy and is **the database for all SQL Server tests**.
  `Ryzevo` is never used for tests.
- `crewinjob-web/appsettings.Test.json` (git-ignored) points at it. Create it from `appsettings.json` with the
  database name swapped to `Ryzevo_Trial`.
- Using it:
  - `node --test test/db-client.test.cjs` runs the SQL Server half against it (it creates a `zz_client` table there);
  - `PLATFORM_APPSETTINGS_PATH=appsettings.Test.json npm run db:audit` compiles every statement against it;
  - a panel started with `PLATFORM_DATABASE_PROVIDER=mssql PLATFORM_APPSETTINGS_PATH=appsettings.Test.json`
    runs on it.
- `npm run db:smoke` drops and recreates its database, so it still refuses any non-local server, this one
  included. It needs the local Docker test server.
- To reset the trial copy, drop its tables (or the database) and run
  `node scripts/mssql-copy.cjs --database Ryzevo_Trial --create`.

## Open questions

- Will the panel keep running on this PC, or move to AWS (eu-west-1) next to RDS?
