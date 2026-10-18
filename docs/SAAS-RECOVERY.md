# Ryzevo offline recovery checks

Delivered 2026-10-18 as part of production preparation. This is not a production
restore, a provider acceptance test, a security certification or a launch gate pass.
No new API, customer dashboard, database migration or background service is added.
The existing monolith, credential format and online backup command are reused.

Schema-27 update on the same date: a stable internal database identity is now
bound to new manifests/key proofs. Existing pre-27 sealed version-2 backups still
verify independently; source binding is unknown until a new snapshot is taken.
See [private operator monitoring](SAAS-MONITORING.md). No new recovery API exists.

## Operator commands

Run from `crewinjob-web`, using a trusted checkout and the service account's
private configuration. Never put encryption keys on the command line or in chat.

```powershell
npm run backup:platform
npm run verify:backup -- "data/backups/<backup-directory>"
npm run restore:drill -- "data/backups/<backup-directory>"
npm run test:platform:recovery
```

An optional second positional argument to `restore:drill` sets the private output
root. The default is `data/recovery-drills`. A fresh random subdirectory is always
created; no overwrite switch exists. Keep both locations outside the public web
root and protect them with service-account-only permissions. A custom root also
needs its own Git/backup exclusion; the two defaults are already Git-ignored and
the Docker build context excludes all runtime `data`.

These commands run locally, not over a public API. The standalone Docker runner
now packages them, with isolated Linux/native-SQLite backup and restore checks;
see [runtime acceptance](SAAS-RUNTIME-ACCEPTANCE.md). Actual durable-volume and
off-host recovery remain release checks. No real deployment or scheduler changed.

## What is verified

- SQLite online backup captures committed WAL data without stopping the app. Only
  the new copy is checkpointed and switched to DELETE journal mode. The live
  database remains untouched and its WAL mode is not changed.
- The version-2 manifest records snapshot SHA-256, byte length, timestamp, schema
  and key source. Schema is read from the copy, not from the still-changing source.
- An HMAC proof ties the matching encryption key to the manifest, including an
  otherwise empty database. Environment-sourced keys are never written to disk.
  File-sourced keys are copied privately and checked against the proof.
- Full SQLite integrity, foreign keys, contiguous migrations and supported schema
  version are checked read-only. No migration or application bootstrap runs.
- Scoped rows must belong to an existing organization/project. Scoped foreign-key
  references must not point at another customer's scoped records. This is a
  referential consistency test, not a substitute for HTTP/RBAC isolation tests.
- All nonempty current AES-GCM encrypted columns are authenticated with their
  existing organization/project/resource AAD. Connections, OAuth state, product
  checkpoints, consent evidence, DNS challenge, email snapshots/messages, SES,
  social snapshots, account-email challenges and PayTR tokens are covered.
- Unknown encrypted columns or future schema versions fail closed until their
  recovery contract is implemented. No decrypted data appears in reports.
- Input symlinks/junctions, redirected manifest paths, unrecorded WAL/SHM/journal
  sidecars, oversized files, mismatched hashes and missing/wrong keys are rejected.
- The drill re-verifies the copied files, writes `recovery-report.json` and a
  `DO_NOT_START.txt` marker. It never starts the app, runs jobs, calls a provider,
  upgrades the schema or replaces the active database.

The manifest protects against accidental corruption/mismatched material, not an
attacker controlling both the database and the matching key. A copied file-key
backup contains the means to decrypt private data. Store it encrypted at rest,
restrict access, and keep protected off-host copies. POSIX file modes are 0600 and
directory modes 0700; Windows ACLs must be configured separately by the operator.

## Results and errors

Verification and drill print a small JSON result and return exit code 0 on success,
1 on failure. The Next environment loader may print a configuration-load notice
before the JSON. Reports contain aggregate counts, not member names, email
addresses, provider responses, tokens or plaintext credentials.

Typical codes: `database_hash_mismatch`, `key_mismatch`, `missing_key`,
`credential_authentication_failed`, `foreign_key_failed`, `project_scope_failed`,
`reference_scope_failed`, `schema_mismatch`, `unsupported_schema`,
`unsupported_encrypted_column`, `snapshot_sidecar_found`, `snapshot_not_sealed`,
`unsafe_link`, `file_missing`, `access_denied`.

Older backups have no version-2 manifest and return `unsupported_backup_format`.
They are retained, not deleted or rewritten. Create a new backup for the automated
drill; any emergency recovery from a legacy snapshot needs a separate supervised
procedure. Never add a checksum to an old snapshot and call it verified.

A failed backup can leave an incomplete private directory. A failed drill after
copying can leave `FAILED.json` and its partial private copy. Neither is reported
as a successful recovery. Review and dispose of these manually under retention
policy; there is no automatic recursive deletion or retention scheduler here.

## Before any actual production restore

1. Record the incident and obtain operator approval. Stop app/worker and webhook
   ingress before a real cutover. Take a fresh snapshot of the current data first.
2. Verify a protected backup and perform this offline drill on a separate volume.
   Review its timestamp, schema compatibility and acceptable data-loss window.
3. Recover the matching encryption key securely; do not rotate it away from the
   encrypted records. Rotate `AUTH_SECRET` so old snapshots cannot revive revoked
   browser sessions. Review users/memberships and pending OAuth/enrollment/reset
   links before reopening ingress.
4. Keep email, social publishing, public signup, identity-email delivery and PayTR
   gates OFF. Leave the worker stopped. Review queued/in-flight delivery attempts
   and external provider records before any resumption; a restored queue must not
   cause duplicate messages, posts or financial actions.
5. Reconcile suppressions/consent withdrawals, revoked credentials and accepted
   provider operations that occurred after the backup. Those cannot be recovered
   from an older database alone. Clear pending OAuth requests through a reviewed
   maintenance procedure; do not blindly replay stale callbacks/jobs.
6. Restore via a supervised procedure, then run scope/RBAC and controlled smoke
   tests before enabling ingress or one selected transport. This tooling does not
   perform that replacement or declare the resulting service ready.

## Remaining production gates

This snapshot covers the Ryzevo SQLite monolith and its credential key only. It
does not archive environment secrets, uploaded/static files, Crewin's legacy JSON
stores/agent data, external ABP data or provider state. Deployment backup coverage,
encrypted off-host storage/retention, alerting, measured RPO/RTO, container execution,
restart supervision, load/abuse tests, and an authorized non-Crewin customer pilot
remain separate work. No uptime or recovery-time promise is inferred from a local
drill. PayTR merchant/USD acceptance is still pending; all real payments stay off.

## Local acceptance record - 18 October 2026

- All 360 platform tests passed, including 14 new recovery cases. The Windows
  junction test passed in the full run outside the filesystem sandbox; no tests
  were skipped in that run.
- TypeScript, isolated production build and the production HTTP scope/RBAC
  integration test passed. The existing multiple-lockfile build warning remains;
  no unrelated lockfile was deleted.
- An actual local online backup and separate-copy drill passed. That existing
  database was schema 24: 42 scoped tables and 26 scoped references passed, with
  zero encrypted records. No migration was forced on the active database.
- All 11 encrypted-column contracts were separately exercised using disposable
  schema-26 fixtures with 12 encrypted rows, including two customer scopes. This
  does not claim successful decryption of actual customer/provider credentials.
- Source backup bytes stayed unchanged during the drill. No production restore,
  application/worker start, provider request, deploy or real payment occurred.
