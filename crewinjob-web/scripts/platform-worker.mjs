import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const origin = process.env.PLATFORM_WORKER_ORIGIN || 'http://127.0.0.1:3033';
const url = new URL('/api/platform/worker', origin);
if (
  !process.env.CRON_SECRET ||
  (url.protocol !== 'https:' &&
    !['127.0.0.1', 'localhost'].includes(url.hostname))
)
  throw new Error('Configure CRON_SECRET and a trusted worker origin.');
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
while (!stopped) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(55000),
      redirect: 'error',
    });
    if (!response.ok)
      console.error(`Platform worker HTTP ${response.status}`);
  } catch {
    console.error('Platform worker unavailable.');
  }
  if (!stopped) await new Promise((resolve) => setTimeout(resolve, 10000));
}
