const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { load } = require('../platform-loader.cjs');
const { ProjectUsage } = load('project-usage.ts');
const db = new Database(workerData.file, { fileMustExist: true });
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');
const usage = new ProjectUsage(db, workerData.scope);
const signal = new Int32Array(workerData.signal);
const result = { accepted: 0, denied: 0, released: 0, errors: [] };
try {
  parentPort.postMessage({ ready: true });
  if (Atomics.wait(signal, 0, 0, 30000) === 'timed-out') throw new Error('barrier_timeout');
  for (let i = 0; i < workerData.attempts; i++) {
    try {
      if (workerData.operation === 'release') {
        usage.release(workerData.reservation); result.released++;
      } else {
        usage.complete(usage.reserve('ai')); result.accepted++;
      }
    } catch (error) {
      if (error.status === (workerData.operation === 'release' ? 404 : 429)) result.denied++;
      else result.errors.push({ status: error.status || null, code: typeof error.code === 'string' ? error.code : 'unexpected_failure' });
    }
  }
  parentPort.postMessage({ result });
} finally { db.close(); }
