# Preservation-first restore reconciliation contract

Date: 2026-10-17 (Pacific/Guadalcanal). Scope: source contract for
`CAL-08.BASELINE` and `CAL-08.MIGRATE`.

## What this slice proves

`packages/features/community-enterprise/recovery/RestoreReconciliationContract.ts`
contains a write-free receipt validator and snapshot comparator for the required
restore rehearsal. An operator supplies two snapshots: the authorized backup's
source database and a database restored into a disposable isolated scope. The
contract requires:

- an explicit backup identifier and parseable capture/restore timestamps;
- `scope: isolated-disposable`, `productionTarget: false`, and quiesced writers;
- non-negative row counts for users, profiles, bookings, event types and providers,
  with each count equal to that entity's stable-ID list length;
- duplicate-free, deterministically sorted stable identifiers for each entity;
- duplicate-free absolute booking URLs without embedded credentials or URL
  fragments; and
- a 64-character SHA-256 fingerprint of the session/encryption key on both
  snapshots, without accepting or printing key material.

The comparator reports count, stable-ID, booking-URL and encryption-fingerprint
differences in a stable order. A match is true only when every inspected count,
stable identifier, booking URL and encryption fingerprint agrees. It does not
perform a database connection, restore a backup, run migrations, decrypt a
credential, quiesce a writer, or alter any data.

## Verification

The focused test file is:

```sh
node --test --test-reporter=spec tests/community-enterprise/restore-reconciliation-contract.test.cjs
```

The file is also registered in the repository's `test:community-enterprise`
source suite, so the restore receipt cannot silently drift outside the normal
enterprise contract run. Registration does not change the evidence level: the
checks still operate on supplied fixture snapshots and never connect to a
database.

It covers a matching receipt, per-entity count and ID mismatches, count/list
consistency, URL safety and exact comparison, encryption fingerprint mismatch,
production/active-writer refusal, malformed timestamps and duplicate IDs. The source module also passes
Node's strip-types syntax check and error-level Biome checks.

In this continuation the repository did **not** receive an authorized live
backup, access to a retained production database, or an approved disposable
restore target. Therefore this is source evidence only. It does not close either
`CAL-08.BASELINE` or `CAL-08.MIGRATE`, and it must not be represented as an
isolated restore, encryption/decryption proof, migration rehearsal, rollback
proof or production readiness claim.

## Required runtime follow-up

The data/migration owner must run the contract against an authorized, freshly
captured backup in an isolated disposable PostgreSQL scope, with writers stopped
for the capture and a documented encryption-key fingerprint. Before any
candidate migration, record source and restored counts, stable IDs and existing
booking URLs. Reconcile the report, retain the original backup, and test a
controlled write after cutover. Rollback must restore only a pre-cutover copy
and must not overwrite bookings accepted after cutover. The existing packaged
migration preflight remains a guard for known destructive legacy columns; it is
not a substitute for this restore and rollback evidence.
