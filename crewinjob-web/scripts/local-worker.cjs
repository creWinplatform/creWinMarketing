// Local stand-in for the server crontab: calls the platform worker every few minutes while the dev server runs.
// The CRON_SECRET is read from the environment or .env.local and never printed.
// Usage: npm run worker:local [-- --once] [-- --every 5] [-- --url http://localhost:3033]
const fs = require('node:fs');
const path = require('node:path');

const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback; };
const once = process.argv.includes('--once');
const base = arg('url', 'http://localhost:3033').replace(/\/+$/, '');
const minutes = Math.max(1, Math.min(60, Number(arg('every', '5')) || 5));

function cronSecret() {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  try {
    const line = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).find(item => /^\s*CRON_SECRET\s*=/.test(item));
    return line ? line.replace(/^\s*CRON_SECRET\s*=\s*/, '').replace(/^(['"])(.*)\1$/, '$2').trim() : '';
  } catch { return ''; }
}
const secret = cronSecret();
if (secret.length < 16) { console.error('CRON_SECRET is missing or shorter than 16 characters (.env.local). Add it, restart the dev server, then run this again.'); process.exit(1); }

const stamp = () => new Date().toLocaleString('tr-TR');
async function tick() {
  try {
    const response = await fetch(`${base}/api/platform/worker`, { method: 'POST', headers: { 'x-cron-secret': secret }, signal: AbortSignal.timeout(65000) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) console.log(`${stamp()}  worker OK  checked=${body.checked ?? 0} failed=${body.failed ?? 0}`);
    else console.log(`${stamp()}  worker HTTP ${response.status}${response.status === 401 ? ' (CRON_SECRET does not match the running server; restart it after changing .env.local)' : ''}`);
  } catch (error) { console.log(`${stamp()}  worker not reachable at ${base} (${error.name}); is the dev server running?`); }
}

(async () => {
  console.log(once ? `Running the worker once at ${base}.` : `Calling the worker at ${base} every ${minutes} minute(s). Stop with Ctrl+C.`);
  await tick();
  if (!once) setInterval(tick, minutes * 60_000);
})();
