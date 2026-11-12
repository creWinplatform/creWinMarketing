// The Windows release runs on its own bundled node.exe, which is not on PATH: a route that starts a child process with a
// bare 'node' fails there (the userbot and the scheduler did). Child Node processes use process.execPath.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.next') ? [] : sources(full);
    return /\.(ts|tsx|cjs|mjs|js)$/.test(entry.name) ? [full] : [];
  });
}

test('no app or lib code starts a child process with a bare "node"', () => {
  const offenders = [];
  for (const file of [...sources(path.join(ROOT, 'app')), ...sources(path.join(ROOT, 'lib'))]) {
    const text = fs.readFileSync(file, 'utf8');
    if (/\b(spawn|execFile|execFileSync|spawnSync|fork)\(\s*['"`]node(\.exe)?['"`]/.test(text)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, [], 'use process.execPath instead of "node"');
});

test('the userbot and scheduler routes use process.execPath and handle a launch error', () => {
  const userbot = fs.readFileSync(path.join(ROOT, 'app/api/userbot/route.ts'), 'utf8');
  assert.equal((userbot.match(/spawn\(process\.execPath, \['userbot\.js'\]/g) || []).length, 2);
  assert.equal((userbot.match(/\.on\('error'/g) || []).length, 2);
  const scheduler = fs.readFileSync(path.join(ROOT, 'app/api/scheduler/route.ts'), 'utf8');
  assert.match(scheduler, /spawn\(process\.execPath, \[SCHED_FILE\]/);
  assert.match(scheduler, /proc\.on\('error'/);
});
