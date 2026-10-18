const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { randomUUID, randomBytes } = require('node:crypto');
const path = require('node:path');

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 5 * 1024 ** 2, ...options });
  assert.equal(result.status, 0, `Docker ${args[0]} failed: ${result.error?.code || result.stderr?.slice(-1800) || 'unknown'}`);
  return result.stdout.trim();
}

const soakSeconds = Number(process.env.PLATFORM_TEST_SOAK_SECONDS || 30);
assert.ok(Number.isInteger(soakSeconds) && soakSeconds >= 30 && soakSeconds <= 1800, 'PLATFORM_TEST_SOAK_SECONDS must be an integer from 30 to 1800.');
test('Linux runner: disposable tenant isolation, bounded soak/abuse and operator recovery', { timeout: (soakSeconds + 210) * 1000 }, t => {
  const image = process.env.PLATFORM_TEST_IMAGE;
  assert.ok(image && /^[a-z0-9][a-z0-9./_-]*:[a-zA-Z0-9._-]+$/.test(image), 'Set PLATFORM_TEST_IMAGE to an already-built, trusted local QA image. No automatic pull/build.');
  assert.ok(!process.env.DOCKER_HOST || /^(unix|npipe):/.test(process.env.DOCKER_HOST), 'This QA command requires a local Docker engine.');
  const context = docker(['context', 'show']);
  const endpoint = JSON.parse(docker(['context', 'inspect', context]))[0].Endpoints.docker.Host;
  assert.match(endpoint, /^(unix|npipe):/);
  docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  const runId = randomUUID(), name = 'ryzevo-qa-' + runId;
  const env = {
    ADMIN_USERNAME: 'container-fixture-admin', ADMIN_PASSWORD: randomBytes(24).toString('hex'), AUTH_SECRET: randomBytes(32).toString('hex'),
    CRON_SECRET: randomBytes(24).toString('hex'), PLATFORM_DATABASE_PATH: '/app/data/platform.sqlite', PLATFORM_BACKUP_PATH: '/app/data/backups',
    PLATFORM_WORKER_EXPECTED: '1', PLATFORM_MONITOR_MIN_FREE_MB: '16', PLATFORM_EMAIL_PILOT_SEND_ENABLED: '0',
    PLATFORM_SOCIAL_PUBLISH_ENABLED: '0', PLATFORM_AUTH_EMAIL_ENABLED: '0', PLATFORM_PUBLIC_SIGNUP_ENABLED: '0', PLATFORM_PAYTR_SANDBOX_ENABLED: '0',
    PLATFORM_TEST_SOAK_SECONDS: String(soakSeconds),
  };
  let attempted = false;
  try {
    attempted = true;
    docker(['run', '--detach', '--pull', 'never', '--name', name, '--label', 'com.ryzevo.qa-run=' + runId,
      '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '768m', '--cpus', '2',
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m', '--tmpfs', '/app/data:rw,nosuid,nodev,noexec,size=128m,uid=1001,gid=1001,mode=0700',
      '--tmpfs', '/crewinjob-agent/data:rw,nosuid,nodev,noexec,size=32m,uid=1001,gid=1001,mode=0700',
      ...Object.entries(env).flatMap(([key, value]) => ['--env', key + '=' + value]), image], { timeout: 60000 });
    const info = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(info.HostConfig.NetworkMode, 'none'); assert.equal(info.HostConfig.ReadonlyRootfs, true);
    assert.ok(!info.HostConfig.Binds?.length); assert.equal(info.Config.Labels['com.ryzevo.qa-run'], runId);
    const driver = readFileSync(path.join(__dirname, 'helpers/platform-container-driver.mjs'), 'utf8');
    const output = docker(['exec', '-i', name, 'node', '--input-type=module'], { input: driver, timeout: (soakSeconds + 90) * 1000 });
    const report = JSON.parse(output.split(/\r?\n/).at(-1));
    assert.equal(report.ok, true); assert.equal(report.productionCapacityAssessed, false);
    assert.equal(report.boundedSoak.clients, 4); assert.equal(report.boundedSoak.unexpectedFailures, 0);
    assert.equal(report.boundedSoak.targetMs, soakSeconds * 1000);
    assert.ok(report.boundedSoak.requests <= 4 * soakSeconds * 4); assert.equal(report.abuseChecks.rateLimited, 4);
    assert.ok(report.boundedSoak.memorySamples >= 2);
    t.diagnostic(JSON.stringify({ ...report, network: 'none', hostVolumesMounted: false, fixtureOnly: true }));
  } finally {
    if (attempted) {
      // A failed/timed-out `run` may still have created the container.
      const owned = spawnSync('docker', ['inspect', '--format', '{{ index .Config.Labels "com.ryzevo.qa-run" }}', name], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
      if (owned.status === 0) {
        assert.equal(owned.stdout.trim(), runId, 'Refuse to remove a container not owned by this test.');
        docker(['rm', '--force', name]);
      } else assert.ok(owned.status === 1 && /No such (object|container)/i.test(owned.stderr), 'Could not confirm QA cleanup; inspect the uniquely named test container.');
    }
  }
});
