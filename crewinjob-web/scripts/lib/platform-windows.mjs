import { win32 } from 'node:path';

export const WINDOWS_MODES = ['preflight', 'app', 'worker', 'backup', 'monitor'];
const absolute = value => typeof value === 'string' && /^[a-z]:\\/i.test(value) && !value.includes('\0');
export function insideWindowsPath(parent, child) {
  if (!absolute(parent) || !absolute(child)) return false;
  const relative = win32.relative(win32.resolve(parent).toLowerCase(), win32.resolve(child).toLowerCase());
  return relative === '' || (!relative.startsWith('..\\') && relative !== '..' && !win32.isAbsolute(relative));
}
const secret = value => typeof value === 'string' && value.length >= 32 && !/replace|example|change.?me|fixture|test.?only/i.test(value);

// Pure checks keep secrets out of operator reports and are testable off-host.
export function windowsEnvironmentChecks(env, releaseRoot, { platform = process.platform, nodeMajor = Number(process.versions.node.split('.')[0]) } = {}) {
  const checks = [], record = (code, ok) => checks.push({ code, ok: Boolean(ok) });
  record('windows_host', platform === 'win32');
  record('node_22', nodeMajor === 22);
  record('production_environment', env.NODE_ENV === 'production');
  record('local_release_path', absolute(releaseRoot));
  record('loopback_bind', env.HOSTNAME === '127.0.0.1');
  const port = Number(env.PORT);
  record('private_port', /^\d{4,5}$/.test(env.PORT || '') && port >= 1024 && port <= 65535);
  record('worker_loopback', env.PLATFORM_WORKER_ORIGIN === `http://127.0.0.1:${port}`);
  record('worker_supervised', env.PLATFORM_WORKER_EXPECTED === '1');
  record('stable_session_secret', secret(env.AUTH_SECRET));
  record('stable_cron_secret', secret(env.CRON_SECRET));
  record('stable_encryption_key', /^[a-f0-9]{64}$/i.test(env.PLATFORM_ENCRYPTION_KEY || '') && !/^([a-f0-9])\1+$/i.test(env.PLATFORM_ENCRYPTION_KEY));
  record('isolated_database', absolute(env.PLATFORM_DATABASE_PATH) && /\.sqlite$/i.test(env.PLATFORM_DATABASE_PATH) && !insideWindowsPath(releaseRoot, env.PLATFORM_DATABASE_PATH));
  record('isolated_backup_root', absolute(env.PLATFORM_BACKUP_PATH) && !insideWindowsPath(releaseRoot, env.PLATFORM_BACKUP_PATH) && !insideWindowsPath(env.PLATFORM_BACKUP_PATH, env.PLATFORM_DATABASE_PATH));
  record('isolated_environment_file', absolute(env.RYZEVO_ENV_FILE) && !insideWindowsPath(releaseRoot, env.RYZEVO_ENV_FILE));
  record('persistent_agent_install', absolute(env.CREWINJOB_AGENT_DIR) && !insideWindowsPath(releaseRoot, env.CREWINJOB_AGENT_DIR));
  record('isolated_build_directory', /^\.next-[a-z0-9_-]+$/i.test(env.NEXT_DIST_DIR || ''));
  let publicOrigin;
  try { const url = new URL(env.PLATFORM_AUTH_ORIGIN); if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) publicOrigin = url.origin; } catch {}
  record('public_https_origin', publicOrigin && publicOrigin === env.NEXT_PUBLIC_APP_URL);
  const liveGates = ['PLATFORM_EMAIL_PILOT_SEND_ENABLED', 'PLATFORM_SOCIAL_PUBLISH_ENABLED', 'PLATFORM_MOBILE_SEND_ENABLED','PLATFORM_MOBILE_LINKS_ENABLED','PLATFORM_AUTH_EMAIL_ENABLED', 'PLATFORM_PUBLIC_SIGNUP_ENABLED', 'PLATFORM_PAYTR_SANDBOX_ENABLED'].filter(key => env[key] === '1');
  return { ok: checks.every(check => check.ok), checks, liveGates, scope: 'windows_configuration_only', productionAccepted: false };
}

export function windowsCommand(mode, releaseRoot, env) {
  if (!WINDOWS_MODES.includes(mode) || mode === 'preflight') throw new Error('invalid_windows_mode');
  if (mode === 'app') return [win32.join(releaseRoot, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', env.PORT];
  return [win32.join(releaseRoot, 'scripts', `platform-${mode}.mjs`)];
}
