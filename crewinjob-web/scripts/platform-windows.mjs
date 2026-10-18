import { stat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WINDOWS_MODES, windowsEnvironmentChecks, windowsCommand, insideWindowsPath } from './lib/platform-windows.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mode = process.argv[2] || 'preflight';
try {
  if (process.argv.length > 3 || !WINDOWS_MODES.includes(mode)) throw new Error('invalid_arguments');
  const report = windowsEnvironmentChecks(process.env, root);
  if (report.ok) {
    const record = (code, ok) => report.checks.push({ code, ok: Boolean(ok) });
    let cleanEnvironment = true;
    for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
      try { await stat(join(root, name)); cleanEnvironment = false; }
      catch (error) { if (error.code !== 'ENOENT') cleanEnvironment = false; }
    }
    record('no_release_environment_secrets', cleanEnvironment);
    for (const [code, file] of [['production_build', join(root, process.env.NEXT_DIST_DIR, 'BUILD_ID')], ['protected_configuration_present', process.env.RYZEVO_ENV_FILE], ['legacy_agent_packaged', join(process.env.CREWINJOB_AGENT_DIR, 'modules/api.js')]]) {
      try { record(code, (await stat(file)).isFile()); } catch { record(code, false); }
    }
    // Reject junctions that redirect persistent state into the release tree.
    for (const [code, directory] of [['private_database_parent', resolve(process.env.PLATFORM_DATABASE_PATH, '..')], ['private_backup_parent', process.env.PLATFORM_BACKUP_PATH], ['private_configuration_parent', resolve(process.env.RYZEVO_ENV_FILE, '..')], ['persistent_agent_install', process.env.CREWINJOB_AGENT_DIR]]) {
      try { record(code, !insideWindowsPath(await realpath(root), await realpath(directory))); } catch { record(code, false); }
    }
    try {
      const require = createRequire(join(root, 'package.json')), Database = require('better-sqlite3'), db = new Database(':memory:');
      try { record('native_sqlite', db.prepare('SELECT 1 AS ok').get().ok === 1); } finally { db.close(); }
    } catch { record('native_sqlite', false); }
    report.ok = report.checks.every(check => check.ok);
  }
  if (!report.ok || mode === 'preflight') {
    console.log(JSON.stringify(report));
    process.exitCode = report.ok ? 0 : 2;
  } else {
    const child = spawn(process.execPath, windowsCommand(mode, root, process.env), { cwd: root, env: process.env, windowsHide: true, stdio: 'inherit', shell: false });
    const stop = () => child.kill();
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    child.once('error', () => { console.error(JSON.stringify({ code: 'windows_child_start_failed', mode })); process.exitCode = 2; });
    child.once('exit', code => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); process.exitCode = code ?? 2; });
  }
} catch {
  console.error(JSON.stringify({ ok: false, code: 'windows_startup_failed' }));
  process.exitCode = 2;
}
