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
| 2 | `data/*.json` and the agent files move into tables (done 12 November) | No |
| 3 | Backup, recovery drill and the encrypted-column check work against RDS (snapshots plus an export; done 12 November) | No |
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

- **Phase 4:** the data copy (trial, then real, with approval) and the switch (`PLATFORM_DATABASE_PROVIDER=mssql`).
  The Crewin stores have a switch of their own (`PLATFORM_LEGACY_STORE=mssql`, below), turned on after their copy.
- **Speed:** hot paths that run dozens of statements are batched. The panel is fastest in the same AWS region as RDS.

## Phase 2: the Crewin JSON stores in tables (12 November)

The Crewin workspace kept its data in JSON files: the panel's `data/*.json` and the agent's `job-queue.json`,
`.userbot-groups.json` and `data/*.json(l)`. They can now be rows in the platform database.

**The switch: `PLATFORM_LEGACY_STORE=mssql`. Default: off.**
- **Off (the default):** the panel and the agent use the files exactly as before. This holds even with
  `PLATFORM_DATABASE_PROVIDER=mssql`, which live ryzevo.com already runs with. Migration 79 creates the two tables
  there, and they stay empty.
- **On:** the stores are read from and written to the tables.
- **When to turn it on (phase 4):** after `db:copy-legacy` has filled the tables on RDS. Set it in `.env.local` for
  the panel and in the agent's `.env` for an agent started on its own, with both stopped, so no file write lands
  between the copy and the switch.
- **Turning it off again** goes back to the files. Writes made while it was on stay only in the tables.
- `test/legacy-store.test.cjs` and a `db:smoke` step check that with the switch off, a SQL Server platform still reads
  and writes the files and writes no table row.

### Inventory

| Owner | File | Shape | Read and written by |
|---|---|---|---|
| Panel | `content-history.json` (~22 MB, base64 images) | array | `app/api/data/content-history`, coach, job guide |
| Panel | `post-history.json`, `post-history-hidden.json` | array | `app/api/data/post-history`, coach, job guide |
| Panel | `activity-log.json` (+ `activity-log-cleared-at.txt`) | array | `lib/activity-log-server.ts`, `app/api/data/activity-log` |
| Panel | `calendar.json` | array | `app/api/data/calendar`, `app/api/scheduler/run` |
| Panel | `campaigns.json`, `campaign-audiences.json` | array | `lib/campaigns.ts`, `lib/saved-audiences.ts` |
| Panel | `scheduled-posts.json` | array | `lib/scheduled-posts*.ts`, `app/api/schedule/*` |
| Panel | `seo-work-items.json` | array | `lib/seo-work-items.ts` |
| Panel | `social-tokens.json`, `oauth-state.json` | object | `lib/social-tokens.ts` |
| Panel | `email-suppressions.json`, `whatsapp-consents.json`, `crewin-iys-email*.json` | object | `lib/legacy-*.ts`, `lib/crewin-iys-email.ts` |
| Panel | `crewin-link-tags.json` | array | `lib/platform/crewin-links.ts` |
| Agent | `job-queue.json`, `.userbot-groups.json` | array | `modules/job-bot.js`, `userbot.js`; panel routes `job-bot`, `userbot` |
| Agent | `data/posted-jobs.json`, `data/review-queue.json` (~6 MB) | array | `modules/auto-poster.js` and its callers; job guide |
| Agent | `data/group-stats.json`, `pipeline-state.json`, `agent-config.json`, `api-usage.json`, `broadcast-log.json` | object | auto-poster, `ai-client.js`, group broadcaster |
| Agent | `data/discovered-groups.json`, `processed-messages.json`, `readonly-groups.json` | array | group discovery, message scraper, broadcaster |
| Agent | `data/failed-messages.jsonl`, `data/link-tags.jsonl` | log | auto-poster, `modules/link-tags.js`; `crewin-links.ts` |

Configuration and process state stay files: `.env`, `.userbot-config.json`, `google-credentials.json`, logs,
`data/scheduler.pid`, `output/`, `data/platform-credentials.key`.

**Before:** every read-modify-write ran under `withFileLock` (`lib/json-store.ts`). That lock is in-process only, so the
agent's processes and a second panel instance did not see it, and the agent had no lock at all.

### Tables (migration 79)

```
legacy_stores  (store PK, version, updated_at)                                   one row per store
legacy_records (store, record_key, position, body, body_hash, updated_at)        one row per array item / object key
```

- **One store per file.** It is named `web:<file>` or `agent:<file>`, for example `web:content-history` and
  `agent:posted-jobs`.
  - An array keeps its order through `position`.
  - The row key is the item's `id`, or the field the store names (`ilanId` for posted jobs). Without one, the key is
    a hash of the item.
  - An object has one row per property.
  - Both owners describe their stores in one list: `WEB_STORES` and `AGENT_STORES` in `lib/db/legacy-records.cjs`.
- **Only changed rows are written.** A write compares the new data with the stored body hashes. Editing one content
  history item sends that item, not 22 MB.
  - Items added at the front or back, removed, or edited keep the other rows' positions.
  - A reorder renumbers the rows.
- **Locking across processes.** `mutate()` first bumps the store's `legacy_stores.version` in the same transaction as
  its writes. The row lock is held until the commit, so the panel, a second panel and the agent's processes write one
  after another.
  - The version also tells readers whether their cached copy is current, so a repeated read costs one small query.
  - Tested with concurrent writers on SQLite and SQL Server; no update is lost.
- **Portable SQL only.** The statements run unchanged on SQLite and, after `?` → `@pN`, on SQL Server. The agent
  therefore uses a small adapter (`mssqlRecordsDb`) and does not need the panel's translator.

### Code

- **Panel: `lib/legacy-store.ts`.** It offers `readStore`, `mutateStore`, `withStore` (the old `load()`/`save()`
  shape under the lock), `writeStore`, `appendStore` and `storeSummary` (a summary cached per store version).
  - Every module and route in the inventory uses it. Their functions became async and their callers await them.
    `tsc`, `scripts/promise-audit.cjs` and the tests check this.
  - Four read-modify-write pairs that were separate calls are now one locked change:
    - claiming due posts;
    - a scheduled post renumbered by the backend (`replacePost`);
    - consuming an OAuth state;
    - the pipeline "stopped" mark.
- **Agent: `crewinjob-agent/modules/store.js`.** It offers the same calls and `stores.*` definitions.
  - The code that used to load a list, wait on the network, then save the whole list now re-reads it under the lock
    and applies only its own change. This covers the pipeline run, review approval, expiry, application tracking,
    group joins, processed messages and the broadcast log.
  - In db mode the agent loads `legacy-records.cjs`, the `mssql` driver and `appsettings.json` from
    `../crewinjob-web` (`CREWIN_WEB_DIR` overrides the path). The agent therefore needs the panel folder next to it,
    as it already does today.
  - It reads `PLATFORM_LEGACY_STORE` from its environment. Processes the panel starts inherit it. An agent started on
    its own needs it in its `.env`.
- **Mode.** Only `PLATFORM_LEGACY_STORE=mssql` selects the tables. They live in the platform database (SQL Server in
  production). Tests point them at SQLite or the local server.
- **Locking details.**
  - A store's `legacy_stores` row is created (version 0) before any transaction locks it. Concurrent first writers
    therefore queue on one row instead of racing to insert it.
  - A transaction that SQL Server ends as a deadlock victim (error 1205) is retried up to five times.
  - Stress test on the local server: 60 concurrent writers from 6 store objects, 5 rounds, through both the panel's
    client and the agent's adapter. No update was lost.

### Copy (local test server only)

`npm run db:copy-legacy` (`scripts/legacy-copy.cjs`) copies every file of the inventory into the tables, then reads
each store back and compares it with its file.

- It only reads the files.
- It creates the two tables if they are missing.
- It refuses a store that already has rows (unless `--replace`) and any server that is not local.
- The copy into RDS is phase 4.

```
PLATFORM_APPSETTINGS_PATH=appsettings.Test.json node scripts/legacy-copy.cjs --web-data <panel>/data --agent-dir <agent>
```

**Done on 12 November:** the real files were copied into the local Docker server (`RyzevoTest`). 21 stores were
copied and are identical when read back, including the 22 MB content history, 3,404 review-queue items and 680
posted jobs. The 10 files that do not exist were skipped.

### Checks

- `test/legacy-store.test.cjs`:
  - write plans and positions;
  - file mode (byte-identical files, compact where it was, jsonl);
  - table mode on SQLite, on SQL Server (local only) and through the agent's adapter;
  - concurrent writers;
  - the panel modules in db mode, with no files written.
- `crewinjob-agent/test/store.test.js`: file mode, db mode, and that the agent's store options equal `AGENT_STORES`.
- `npm run db:smoke` has two steps for the Crewin stores:
  - **switch off:** the file is read and written, and no table row appears;
  - **switch on:** a due post is claimed once out of three concurrent claims, and an OAuth state is used once.
- The SQL translator now passes a multi-row `INSERT … VALUES (…), (…)` through when it has no conflict clause.

## Phase 3: backup and recovery on SQL Server (12 November)

RDS keeps its automated snapshots on the AWS side. These scripts keep a copy the application itself can verify, move
off-host and drill without AWS. They work the same way as the SQLite backup, verify and drill scripts and use the same
commands. With `PLATFORM_DATABASE_PROVIDER=mssql` they use SQL Server, whatever `PLATFORM_LEGACY_STORE` says:
- **Every table is exported,** including `legacy_records` / `legacy_stores`. With the switch off they are empty, and the
  Crewin JSON files stay in `data/` and the agent folder, outside this backup, as before.
- **After phase 4,** the Crewin stores are inside the database backup.

| Command | With `PLATFORM_DATABASE_PROVIDER=mssql` |
|---|---|
| `npm run backup:platform` | Exports every table of the database `ConnectionStrings.Platform` names, then verifies the copy (details below). It only reads the database. |
| `npm run verify:backup -- <folder>` | Verifies a SQL Server backup offline; no server is needed (details below). Recognises both formats. |
| `npm run restore:drill -- <folder\|--latest>` | Copies the backup, verifies the copy offline and removes the copies after `--latest` (details below). |
| `npm run offsite:platform` | Uploads the table files and the manifest; the key file stays local, as before. |

- **Export (`backup:platform`).**
  - One consistent read: SNAPSHOT isolation when the database allows it, SERIALIZABLE otherwise.
  - Each table goes into `tables/<table>.ndjson`: a header line with the column names and types, then one JSON array
    per row.
  - The manifest (format 3) records each file's sha256 and size, each table's row count and value hash, the schema
    version and the database id, plus an HMAC with the encryption key.
  - The key file is copied as in the SQLite backup. `PLATFORM_ENCRYPTION_KEY` stays outside the backup.
- **Offline verification (`verify:backup`).**
  1. It checks the files against the manifest and the HMAC.
  2. It rebuilds the rows into a temporary SQLite platform database of the same schema version.
  3. It runs the SQLite backup's checks on it: integrity, foreign keys, project scope, and every encrypted field must
     open with the key.
  4. It compares every table's value hash.
- **Drill (`restore:drill`).**
  - **`--server`** also loads the backup into a new database `RyzevoDrill_<time>`, re-validates every constraint
    `WITH CHECK`, compares every table and drops the database again (`--keep` keeps it).
  - The drill server comes only from `PLATFORM_DRILL_MSSQL_CONNECTION` or from `PLATFORM_DRILL_APPSETTINGS_PATH`.
  - The live `appsettings.json` is never used, so a drill cannot create a database on RDS by accident. A drill on
    RDS needs those settings to be set on purpose.
- **Shared code.**
  - `scripts/lib/mssql-backup.mjs` does the export, verification and drill restore.
  - `scripts/lib/mssql-rows.cjs` holds the value hash and typed parameters, now also used by `mssql-copy.cjs`.
  - The `MAX_RECOVERY_SCHEMA` constant is now 79.
- **Tested (`test/platform-mssql-recovery.test.cjs`, local server only).**
  - Fixture: two projects with encrypted connections and a Crewin store, copied with `mssql-copy` into a new database.
  - Backup: 154 tables. The encrypted fields are authenticated, and no plain secret appears in any file.
  - A changed table file, a changed row count and a wrong key file each fail with a code.
  - Drill: offline, refused without a drill server, then into `RyzevoDrill_…`. Constraints are trusted, values
    match, and the database is dropped.
- **Run by hand on 12 November.** A copy of the real `platform.sqlite` was migrated to schema 79 in a temporary
  folder and copied into the local `RyzevoLocalCopy` database (154 tables, 102 rows, verified). Backup, verification
  and both drills passed.
- **Monitoring (`monitor:platform`).** With `PLATFORM_DATABASE_PROVIDER=mssql` the database checks run on SQL Server
  (`ConnectionStrings.Platform`): schema version, database id, worker observation, the job queue and the uncertain
  deliveries.
  - The SQL is SQLite's, run through the translator; named parameters become positional.
  - The backup, drill and off-site checks stay local. The disk check covers the folder that holds the backups.
  - The report says `"provider":"mssql"`.
  - Tested by `test/platform-mssql-recovery.test.cjs` and by hand against the local copy: readable, schema 79, queue
    checked, backup verified, no alerts.

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
- **Not yet:** the Crewin JSON stores (phase 2 added their tables and `db:copy-legacy`). The panel still runs on SQLite, so writes made after the
  copy are not in `Ryzevo`. The copy has to be redone, or the difference moved, at the switch.

### Phase 4 for the Crewin stores on RDS (tools ready 12 November; run by the publisher)

The live Crewin JSON files are on the live server, so the copy runs there. The steps are in `docs/YAYIN-PROMPTU-9.md`:

- **A, safe with any deploy:**
  1. Deploy.
  2. `backup:platform` with `PLATFORM_DATABASE_PROVIDER=mssql`, then `verify:backup`.
  3. `npm run db:upgrade` shows the plan; `npm run db:upgrade -- --apply` adds the two empty tables and records
     schema 79.
  4. `monitor:platform`.
- **B, a short maintenance window:**
  1. Stop the panel, the worker and the agent.
  2. Take a fresh backup.
  3. `npm run db:copy-legacy -- --live`, then `--verify-only`.
  4. Turn on `PLATFORM_LEGACY_STORE=mssql` and start everything again.
  5. Rollback: remove the switch. Writes made while it was on stay only in the tables.

- **`npm run db:upgrade` (`scripts/mssql-upgrade.cjs`).** It brings an existing database up to
  `lib/db/mssql-schema.sql` when the new versions only add tables, indexes and foreign keys.
  - It refuses columns that are missing on existing tables.
  - Without `--apply` it changes nothing.
  - With `--apply` it works in one transaction and records the versions (`IDENTITY_INSERT`, since
    `platform_migrations.version` is an identity column).
- **`db:copy-legacy -- --live`.**
  - A server that is not local is refused without `--live`.
  - With `--live` it also refuses:
    - when `PLATFORM_LEGACY_STORE=mssql` is already on, since the tables may hold newer data than the files;
    - when the tables are missing (run `db:upgrade` first).
- **The guard (`scripts/lib/live-guard.cjs`).** Before `db:upgrade --apply` or `db:copy-legacy --live` write to a
  server that is not local, it requires a backup that:
  - is a SQL Server backup (format 3);
  - is of the same server and database;
  - carries the same `database_id`;
  - verifies offline;
  - is at most 24 hours old (`--backup <folder>` picks one).
- **Tested on the local server.**
  - `test/platform-mssql-recovery.test.cjs`: a schema-78 database is upgraded to 79 (plan, apply, then "up to date").
    The guard accepts the fresh backup and refuses a stale one and one of another database.
  - `test/legacy-store.test.cjs`: the copy refuses a remote server without `--live`, and with the switch already on.
- **Nothing was written to RDS from the development PC.**

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
