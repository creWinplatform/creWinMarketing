// One async database interface over SQLite (better-sqlite3) and SQL Server (mssql), so the platform code runs
// unchanged on either. The code writes SQLite SQL with ? parameters; the SQL Server client translates each distinct
// statement once (translate.cjs) and binds the parameters by position.
//
// Transactions: db.transaction(async () => { … }) runs the callback in one transaction. Every call made inside it
// on the same Db — also through other objects holding that Db — joins the transaction (AsyncLocalStorage), so the
// callback does not need a separate handle. A nested transaction() becomes a savepoint.
import { AsyncLocalStorage } from 'node:async_hooks';
import type BetterSqlite3 from 'better-sqlite3';

// Values as better-sqlite3 accepted them; parameters are typed loosely like its own `any`, and checked at bind time.
export type SqlValue = string | number | bigint | boolean | null | undefined | Buffer | Uint8Array;
type Param = SqlValue | unknown;
export interface RunResult { changes: number }
export interface Statement {
  get<T = any>(...params: Param[]): Promise<T | undefined>;
  all<T = any>(...params: Param[]): Promise<T[]>;
  run(...params: Param[]): Promise<RunResult>;
}
export interface Db {
  readonly dialect: 'sqlite' | 'mssql';
  get<T = any>(sql: string, ...params: Param[]): Promise<T | undefined>;
  all<T = any>(sql: string, ...params: Param[]): Promise<T[]>;
  run(sql: string, ...params: Param[]): Promise<RunResult>;
  /** The same statement methods, for code that prepares once and runs many times. */
  prepare(sql: string): Statement;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// better-sqlite3 refuses booleans and undefined; SQLite code always passed 0/1 and null.
const sqliteValue = (value: Param) => (value === undefined ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value);

// ---------- SQLite ----------
// One connection: a transaction holds it until it ends, and statements from other requests wait their turn, so they
// never land inside someone else's transaction.
export function sqliteDb(handle: BetterSqlite3.Database): Db {
  const scope = new AsyncLocalStorage<{ depth: number }>();
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work, work);
    queue = result.catch(() => undefined);
    return result;
  };
  // A statement outside a transaction waits only while a transaction holds the connection.
  let active = 0;
  const statement = <T>(work: () => T): Promise<T> => (scope.getStore() || active === 0 ? Promise.resolve().then(work) : exclusive(async () => work()));
  const db: Db = {
    dialect: 'sqlite',
    get: (sql, ...params) => statement(() => handle.prepare(sql).get(...params.map(sqliteValue)) as any),
    all: (sql, ...params) => statement(() => handle.prepare(sql).all(...params.map(sqliteValue)) as any[]),
    run: (sql, ...params) => statement(() => ({ changes: handle.prepare(sql).run(...params.map(sqliteValue)).changes })),
    prepare: sql => ({ get: (...p) => db.get(sql, ...p), all: (...p) => db.all(sql, ...p), run: (...p) => db.run(sql, ...p) }),
    async transaction(work) {
      const outer = scope.getStore();
      if (outer) {
        const name = `sp${outer.depth + 1}`;
        handle.exec(`SAVEPOINT ${name}`);
        try { const result = await scope.run({ depth: outer.depth + 1 }, work); handle.exec(`RELEASE ${name}`); return result; }
        catch (error) { handle.exec(`ROLLBACK TO ${name}`); handle.exec(`RELEASE ${name}`); throw error; }
      }
      return exclusive(async () => {
        active++;
        handle.exec('BEGIN IMMEDIATE');
        try { const result = await scope.run({ depth: 0 }, work); handle.exec('COMMIT'); return result; }
        catch (error) { if (handle.inTransaction) handle.exec('ROLLBACK'); throw error; }
        finally { active--; }
      });
    },
    async close() { handle.close(); },
  };
  return db;
}

// ---------- SQL Server ----------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { translate } = require('./translate.cjs') as { translate(sql: string): { sql: string; count: number } };

type MssqlModule = typeof import('mssql');
interface TxState { transaction: import('mssql').Transaction; depth: number; queue: Promise<unknown> }

// Rows come back with BIGINT as text (to keep 64-bit precision); the platform stores counters and timestamps
// that fit in a double, as SQLite returned them.
function rowValue(value: unknown, type: unknown, sql: MssqlModule): unknown {
  if (value === null || value === undefined) return null;
  if (type === sql.BigInt && typeof value === 'string') return Number(value);
  return value;
}
function plainRows(result: import('mssql').IResult<any>, sql: MssqlModule): any[] {
  const recordset = result.recordset;
  if (!recordset) return [];
  const columns = (recordset as any).columns as Record<string, { type: unknown }> | undefined;
  return recordset.map((row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row)) out[key] = rowValue(row[key], columns?.[key]?.type, sql);
    return out;
  });
}

export function mssqlDb(pool: import('mssql').ConnectionPool, sql: MssqlModule = require('mssql')): Db {
  const scope = new AsyncLocalStorage<TxState>();
  // The pool connects on first use; a failed connect is retried by the next statement.
  let connecting: Promise<unknown> | null = null;
  const connected = () => (pool.connected ? Promise.resolve() : (connecting ??= pool.connect().catch(error => { connecting = null; throw error; })));
  const bind = (request: import('mssql').Request, params: Param[], count: number) => {
    if (params.length !== count) throw new Error(`The statement has ${count} parameter(s) but ${params.length} value(s) were given.`);
    params.forEach((value, i) => {
      const name = `p${i + 1}`;
      if (value === null || value === undefined) request.input(name, sql.NVarChar(4000), null);
      else if (typeof value === 'boolean') request.input(name, sql.Int, value ? 1 : 0);
      else if (typeof value === 'bigint') request.input(name, sql.BigInt, value.toString());
      else if (typeof value === 'number') request.input(name, Number.isInteger(value) ? sql.BigInt : sql.Float, value);
      else if (Buffer.isBuffer(value) || value instanceof Uint8Array) request.input(name, sql.VarBinary(sql.MAX), Buffer.from(value));
      else { const text = String(value); request.input(name, text.length > 4000 ? sql.NVarChar(sql.MAX) : sql.NVarChar(4000), text); }
    });
  };
  const execute = async (statement: string, params: Param[]) => {
    const translated = translate(statement);
    await connected();
    const tx = scope.getStore();
    const run = async () => {
      const request = tx ? new sql.Request(tx.transaction) : pool.request();
      bind(request, params, translated.count);
      return request.query(translated.sql);
    };
    // A transaction's requests share one connection and must run one at a time.
    if (!tx) return run();
    const result = tx.queue.then(run, run);
    tx.queue = result.catch(() => undefined);
    return result;
  };
  const db: Db = {
    dialect: 'mssql',
    async get(statement, ...params) { return plainRows(await execute(statement, params), sql)[0]; },
    async all(statement, ...params) { return plainRows(await execute(statement, params), sql); },
    async run(statement, ...params) {
      const result = await execute(statement, params);
      return { changes: (result.rowsAffected || []).reduce((sum, n) => sum + n, 0) };
    },
    prepare: statement => ({ get: (...p) => db.get(statement, ...p), all: (...p) => db.all(statement, ...p), run: (...p) => db.run(statement, ...p) }),
    async transaction(work) {
      const outer = scope.getStore();
      if (outer) {
        // The savepoint statements take their turn on the transaction's connection like any other request.
        const name = `sp${outer.depth + 1}`;
        const batch = (text: string) => { const result = outer.queue.then(() => new sql.Request(outer.transaction).batch(text)); outer.queue = result.catch(() => undefined); return result; };
        await batch(`SAVE TRANSACTION ${name}`);
        try { return await scope.run(Object.assign(outer, { depth: outer.depth + 1 }), work).finally(() => { outer.depth--; }); }
        catch (error) { await batch(`ROLLBACK TRANSACTION ${name}`); throw error; }
      }
      await connected();
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
      try {
        const result = await scope.run({ transaction, depth: 0, queue: Promise.resolve() }, work);
        await transaction.commit();
        return result;
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        throw error;
      }
    },
    async close() { await pool.close(); },
  };
  return db;
}
