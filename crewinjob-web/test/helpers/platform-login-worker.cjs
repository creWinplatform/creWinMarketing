const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { load, asDb } = require('../platform-loader.cjs');
const { consumeLoginAttempt } = load('account.ts');
const db = asDb(new Database(workerData.file, { fileMustExist: true }));
db.pragma('busy_timeout = 10000');
Date.now = () => workerData.clock;
const result = { accepted: 0, denied: 0, errors: [] };
(async () => {
  try {
    parentPort.postMessage({ ready: true });
    if (Atomics.wait(new Int32Array(workerData.signal), 0, 0, 30000) === 'timed-out') throw new Error('barrier_timeout');
    for (let i = 0; i < workerData.attempts; i++) {
      try {
        const username = workerData.unique ? `fixture-${workerData.index}-${i}` : workerData.username;
        if (await consumeLoginAttempt(db, username)) result.accepted++; else result.denied++;
      } catch (error) { result.errors.push(error.code || 'unexpected_failure'); }
    }
    parentPort.postMessage({ result });
  } finally { db.close(); }
})();
