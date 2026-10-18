import { access, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const requiredFiles = [
  'server.js', '.next/BUILD_ID', 'public/brand/ryzevo-brand-board.png',
  'scripts/platform-backup.mjs', 'scripts/platform-verify-backup.mjs',
  'scripts/platform-restore-drill.mjs', 'scripts/platform-monitor.mjs',
  'scripts/platform-worker.mjs', 'scripts/lib/platform-recovery.mjs',
  'scripts/lib/platform-monitor.mjs',
];
export async function checkRuntimePackage(root = process.cwd(), agentRoot = process.env.CREWINJOB_AGENT_DIR || '/crewinjob-agent') {
  const checks = [], record = (code, ok) => checks.push({ code, ok });
  record('node_runtime', Number(process.versions.node.split('.')[0]) >= 22);
  for (const file of requiredFiles) {
    try { const info = await stat(join(root, file)); record(file, info.isFile() && info.size > 0); }
    catch { record(file, false); }
  }
  try { record('static_assets', (await readdir(join(root, '.next/static'))).length > 0); }
  catch { record('static_assets', false); }
  try { await access(join(agentRoot, 'modules/api.js')); record('legacy_agent_packaged', true); }
  catch { record('legacy_agent_packaged', false); }
  const require = createRequire(join(resolve(root), 'package.json'));
  try { record('environment_loader', typeof require('@next/env').loadEnvConfig === 'function'); }
  catch { record('environment_loader', false); }
  try {
    const Database = require('better-sqlite3'), db = new Database(':memory:');
    try { record('native_sqlite', db.prepare('SELECT 1 AS ok').get().ok === 1); }
    finally { db.close(); }
  } catch { record('native_sqlite', false); }
  return { ok: checks.every(check => check.ok), checks, nodeMajor: Number(process.versions.node.split('.')[0]),
    scope: 'package_only', applicationStarted: false, providerRequestsMade: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await checkRuntimePackage();
    console.log(JSON.stringify(report));
    process.exitCode = report.ok ? 0 : 2;
  } catch {
    console.error(JSON.stringify({ ok: false, code: 'runtime_package_check_failed' }));
    process.exitCode = 2;
  }
}
