const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const helper = import(pathToFileURL(resolve(__dirname, '../scripts/lib/platform-windows.mjs')).href);
const root = 'C:\\Ryzevo\\releases\\r1\\crewinjob-web';
const good = () => ({ NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:'3033',NEXT_DIST_DIR:'.next-production',NEXT_PUBLIC_APP_URL:'https://ryzevo.com',PLATFORM_AUTH_ORIGIN:'https://ryzevo.com',PLATFORM_WORKER_ORIGIN:'http://127.0.0.1:3033',PLATFORM_WORKER_EXPECTED:'1',AUTH_SECRET:'a9'.repeat(32),CRON_SECRET:'b8'.repeat(32),PLATFORM_ENCRYPTION_KEY:'c7'.repeat(32),PLATFORM_DATABASE_PATH:'D:\\Ryzevo\\data\\platform.sqlite',PLATFORM_BACKUP_PATH:'D:\\Ryzevo\\backups',RYZEVO_ENV_FILE:'D:\\Ryzevo\\config\\runtime.env',CREWINJOB_AGENT_DIR:'D:\\Ryzevo\\legacy-agent' });
test('Windows deployment fails closed on incompatible runtime and placeholder secrets', async () => {
  const { windowsEnvironmentChecks:check } = await helper;
  assert.equal(check(good(),root,{platform:'win32',nodeMajor:22}).ok,true);
  assert.equal(check(good(),root,{platform:'linux',nodeMajor:22}).ok,false);
  assert.equal(check(good(),root,{platform:'win32',nodeMajor:20}).ok,false);
  for (const key of ['AUTH_SECRET','CRON_SECRET','PLATFORM_ENCRYPTION_KEY']) assert.equal(check({...good(),[key]:'REPLACE_WITH_RANDOM_SECRET_THAT_IS_LONG'},root,{platform:'win32',nodeMajor:22}).ok,false);
});
test('Windows persistent data, backups and configuration cannot be inside release or UNC paths', async () => {
  const { windowsEnvironmentChecks:check,insideWindowsPath:inside } = await helper;
  assert.equal(inside(root,'c:\\RYZEVO\\releases\\r1\\crewinjob-web\\data'),true);
  assert.equal(inside(root,root+'-other\\data'),false);
  for (const [key,value] of [['PLATFORM_DATABASE_PATH',root+'\\data\\live.sqlite'],['PLATFORM_BACKUP_PATH',root+'\\data'],['RYZEVO_ENV_FILE',root+'\\.env.local'],['CREWINJOB_AGENT_DIR',root+'\\agent-data'],['PLATFORM_DATABASE_PATH','\\\\host\\share\\live.sqlite'],['PLATFORM_BACKUP_PATH','D:\\Ryzevo']]) assert.equal(check({...good(),[key]:value},root,{platform:'win32',nodeMajor:22}).ok,false,key);
});
test('Windows launch validates origins, private port and build directory without leaking secrets', async () => {
  const { windowsEnvironmentChecks:check,windowsCommand } = await helper;
  for (const [key,value] of [['HOSTNAME','0.0.0.0'],['PORT','80'],['PORT','3033;whoami'],['PLATFORM_WORKER_ORIGIN','https://attacker.example'],['PLATFORM_AUTH_ORIGIN','https://ryzevo.com/path'],['PLATFORM_AUTH_ORIGIN','https://user:pass@ryzevo.com'],['NEXT_PUBLIC_APP_URL','https://crewinjob.com'],['NEXT_DIST_DIR','../other']]) assert.equal(check({...good(),[key]:value},root,{platform:'win32',nodeMajor:22}).ok,false,key);
  const report=check({...good(),PLATFORM_EMAIL_PILOT_SEND_ENABLED:'1'},root,{platform:'win32',nodeMajor:22});
  assert.deepEqual(report.liveGates,['PLATFORM_EMAIL_PILOT_SEND_ENABLED']);
  assert.equal(JSON.stringify(report).includes(good().AUTH_SECRET),false);
  assert.equal(report.productionAccepted,false);
  assert.deepEqual(windowsCommand('app',root,good()).slice(1),['start','--hostname','127.0.0.1','--port','3033']);
  assert.ok(windowsCommand('backup',root,good())[0].endsWith('platform-backup.mjs'));
  assert.throws(()=>windowsCommand('refund',root,good()));
});
