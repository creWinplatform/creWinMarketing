# Ryzevo runtime packaging and isolated acceptance

Current target is AWS EC2 Windows (owner confirmed 18 October). The Linux image
below is an isolated regression artifact, not that host's deployment package.
See SAAS-WINDOWS-EC2.md and SAAS-RELEASE-STATUS.md. Build-toolchain advisories in
the historical record were subsequently removed with Tailwind/PostCSS 4.3.3.

Phase 6 increment, 2026-10-18. The modular monolith remains one application and
one SQLite store on a durable host. No microservice, second queue, public test
endpoint, provider integration or production deploy is introduced.

## Package

All Docker stages use `node:22-alpine`; host Node and local dev configuration are
unchanged. See the [official release schedule](https://github.com/nodejs/Release)
and [EOL policy](https://nodejs.org/en/about/eol), checked 18 October 2026.
Next traces from the web root: `/app/server.js`, with the existing agent separately
under `/crewinjob-agent`. Only named web operator entry points are copied: backup,
verify-backup, restore-drill, monitor, worker and runtime-check plus their helpers
and explicit CLI-only `@next/env` dependency.

A mandatory verification stage runs platform tests with networking disabled.
Runner copies from that verified stage. Test-file concurrency is four; explicit
SQLite race tests use six real connections. Non-root runtime preflight checks
server/static/brand/operator/agent files and native SQLite with memory-only data.
It does not start the app or make provider requests. Existing Compose names,
image reference, port 3033, environment file, volumes and liveness are unchanged.

## Reproduce

From the repo root, build without private build arguments. Existing dockerignore
excludes real env files, databases/backups, OAuth/Telegram secrets and generated data.

```powershell
docker build --pull=false --tag ryzevo-monolith:qa-20261018 --file crewinjob-web/Dockerfile .
```

From `crewinjob-web`:

```powershell
npm run test:platform:concurrency
npm run test:platform:requests
$env:PLATFORM_TEST_IMAGE = 'ryzevo-monolith:qa-20261018'
npm run test:platform:container
Remove-Item Env:PLATFORM_TEST_IMAGE
```

The container command requires an already-built trusted local image. It never
automatically pulls, builds, publishes or deploys. Remote TCP/SSH engines are
refused. Only a unique named/labeled container starts, with no external network,
published port or host/customer volume; read-only root; non-root UID 1001; dropped
capabilities; no-new-privileges; CPU/memory/process limits and disposable tmpfs.
Generated admin/session/cron fixture values replace real env files. All email,
social, account-email, signup and PayTR gates are OFF.

The driver is injected through stdin, not installed in the web runner. It uses
container loopback. Cleanup verifies the unique test label before removing only
that container, including failure/timeout paths. No unrelated containers, images
or volumes are pruned. QA image is retained. No real localhost tenant is created.

## Scenarios

1. Incomplete package preflight fails; actual runner includes SQLite, assets and
   private operator dependencies.
2. Two fixture organizations create 16 campaign drafts. Sixty-four concurrent
   read flows make 128 plan/list requests with scope spoofing. Every response
   must retain its authenticated project and records.
3. Foreign read/update/delete, CSRF/viewer writes, revoked sessions and access to
   Crewin-only APIs are denied. Own edit/delete remains isolated.
4. One dummy credential is encrypted, never provider-verified. An empty authorized
   worker tick, backup, key/envelope verification, separate-copy restore drill and
   monitor operate only on the fixture database.
5. Four existing offline agent regression files run on Node 22 with no external
   network. This is not live Crewin provider acceptance.
6. Six SQLite clients race final quota units: 120 attempts accept exactly 12 and
   reject 108. No busy/unknown exception can be hidden as a quota rejection.
7. Parallel compensation refunds once. Another tenant's 20 refund attempts are
   denied without changing its usage.
8. Four clients run thirty seconds of mixed reads/writes, capped at 600 requests.
   Every response is checked for tenant/record integrity.
9. Invalid auth JSON/MIME and oversized account bodies are refused. Actual
   chunked and unfinished HTTP uploads exercise body size/deadline checks without
   client cooperation. Twenty invalid logins plus four rate-limit rejections
   create no session; the other tenant remains accessible.
10. Password change invalidates 16 parallel old-cookie reads and an old-cookie
    write. Renewing the old cookie cannot restore access. Fresh login works and
    the other tenant's drafts remain intact. Six-client login races enforce the
    normalized identity ceiling and global minute ceiling without busy errors.

These are local fixture diagnostics, not SLA, production throughput, capacity
ceiling, measured RTO, leak-freedom or DDoS claims. No long-duration soak or
internet-facing penetration test is claimed.

## Hardening

The existing body reader now rejects invalid lengths, exact MIME mismatches,
non-object auth JSON and malformed UTF-8. Never-settling/throwing upstream cancel
cannot hold the response deadline open or replace the intended limit error.
Client abort releases reader/listener/timer; provider Response parsing still works
without a request signal. Account invite/password uses the same 16 KiB reader.
Other routes retain their current limits: this does not cover every legacy API.

The first real unfinished-upload test exposed Next middleware body buffering:
the route timer could not start until buffering ended. Matcher now excludes only
exact already-public login/enroll/identity handlers, including trailing slash.
Their origin/proof/gate/body checks remain. The framework-compiled matcher is
tested against adjacent paths and protected routes; container tests deny foreign
origins on all three and missing Origin on identity. Login/enroll preserve their
existing no-Origin non-browser compatibility and still require credentials or
invitation proof; the missing-Origin malformed-payload tests are not CSRF proof.
Authenticated account bodies still
pass middleware, so their parser limit is not an upstream connection deadline.

Existing hashed-key login limits remain 20 per identity/15 minutes and 300 per
minute globally. Their read/check/write uses an immediate SQLite transaction.
No migration, IP-header trust, alternative auth stack or new limiting service.
These controls do not replace HTTPS/proxy connection limits or WAF policies.

## Private operator commands

Use protected deployed environment/volumes and the service account. Examples,
not production operations performed during acceptance:

```text
docker exec <app-container> node scripts/platform-runtime-check.mjs
docker exec <app-container> node scripts/platform-backup.mjs
docker exec <app-container> node scripts/platform-verify-backup.mjs <backup-directory>
docker exec <app-container> node scripts/platform-restore-drill.mjs <backup-directory>
docker exec <app-container> node scripts/platform-monitor.mjs
```

Packaging never starts the long-running worker. Its existing cron secret/trusted
origin and approved supervision remain necessary. Do not start one during recovery
before reconciling uncertain sends. Probe exit zero does not prove HTTPS, provider
acceptance, off-host backup, alerts or billing. Durable volumes, permissions,
protected keys, retention and a supervised cutover remain required.

## Remaining Gates

Actual HTTPS/proxy and durable-volume deployment, external uptime/alerts, off-host
recovery, secrets lifecycle, long-duration load/abuse acceptance, responsive and
accessibility QA and an authorized real non-Crewin pilot remain. Read-only SaaS
smoke checks do not certify every legacy bot/filesystem workflow; production
Compose hardening was deliberately not changed. Seven existing full-audit build
toolchain advisories remain separate work: no audit-fix-force or complete security
audit claim. PayTR merchant/USD acceptance remains pending. No real payment,
email or social publication occurred.

## Local Record - 18 October 2026

- Final image `ryzevo-monolith:qa-20261018` passed production build/type checking,
  395 platform tests (zero skips) with networking disabled, and non-root runtime
  preflight. Host TypeScript and request/concurrency/matcher checks also passed.
- Isolated runtime acceptance passed: two tenants, 16 created drafts, 128 parallel
  read requests, scope/role/CSRF denial, safe own edit/delete and revocation.
- Bounded mixed traffic: four clients, 30,213 ms, 461 requests of a 600 maximum,
  zero unexpected failures. Local mixed-traffic request p95 was 24 ms. This is
  fixture-only timing, not a production capacity or latency claim.
- Actual unfinished HTTP body returned a rejection in 5,006 ms. Chunked oversize,
  eight malformed/oversize cases, four explicit origin denials and three adjacent
  protected paths passed. Twenty invalid logins returned 401, then four returned
  429. Sixteen parallel old-cookie reads and an old-cookie write were denied;
  refreshed old credentials stayed denied and fresh login succeeded.
- One fixture credential was authenticated in a schema-27 Linux backup and
  separate restore drill. Monitor returned `ok`, the empty fixture worker tick
  completed, and four offline agent regression files passed. No host volume or
  external network was used.
- The first new HTTP attempt failed on middleware buffering; the exact matcher
  fix above resolved it. A later cold Docker startup timed out before the app
  test; the owned container was removed. Docker startup now has a bounded 60 s
  budget (whole scenario 240 s); HTTP and traffic budgets were not relaxed.
- A tooling-session interruption left the last two edited test/document files
  NUL-filled. Only those owned files were reconstructed; the source/doc scan
  found no other such files. Tests were rebuilt/re-run after reconstruction.
- Test containers were label-verified and removed. Local 3033 was restarted with
  provider gates OFF and its liveness returned success. No actual DB migration,
  production replacement, SMTP send, social post or provider/payment call occurred.

## Extended Local Record - 18 October 2026

- Current application/CSS/middleware QA image:
  `ryzevo-monolith:qa-release-20261018`. Local Windows and Linux image builds
  passed, each with type validation. The mandatory network-disabled Linux gate
  passed 402 tests, zero failures/skips. Windows host suite also passed 402 tests;
  production HTTP regression and explicit TypeScript check passed separately.
- Full web npm audit reports zero advisories. Legacy/shared CSS contracts are
  tested; Chrome caught a desktop menu regression and it was fixed before final
  capture. The final application build is not a real-device accessibility proof.
- The existing container test now accepts `PLATFORM_TEST_SOAK_SECONDS` from 30 to
  1800 (default 30), retaining four clients and at most 16 requests/second in
  aggregate. Set it to 300 for the check performed here. No external network or
  production host is contacted. Maximum test/runtime/cleanup budgets scale with
  that explicit bound; they are not unbounded background load.
- Five-minute result: 300,204 ms, 4,645 of at most 4,800 mixed requests,
  zero unexpected failures. Thirty-one actual application-process RSS samples:
  initial 180,216 KiB, final 197,424 KiB, peak 198,436 KiB. Growth is recorded,
  not called leak-free or production capacity. Overall scenario took 316,763 ms.
- Two isolated tenants, 128 parallel read requests, cross-scope/role/origin
  denials, 20 invalid logins plus four 429s, 16 denied revoked-cookie reads and a
  denied revoked write passed. Actual stalled upload was rejected in 5,010 ms.
- One encrypted schema-27 fixture credential passed backup verification and a
  separate offline restore drill; monitor was ok. Four offline legacy agent
  regressions passed. Existing quota/concurrency tests remain separate and pass.
- The first new image attempt stopped because the middleware test loader did
  not recognize the new actual login helper import. The loader was extended to
  load the real helper, not bypass middleware; the rebuilt 402-test gate passed.
- Temporary browser fixture and label-owned container were stopped/removed.
  Main 3033 was restarted with the new compiler and provider gates OFF. No EC2
  operation, actual customer database migration, paid activation or provider write
  occurred. Windows-only launcher scripts are separately syntax/config checked;
  they are not certified by this Linux application image.
