# Reviewed identity-link operator acceptance

Date: 16 October 2026 (Pacific/Guadalcanal). Tested implementation:
`509a3ea2d2752c9f91e53dd9316bc9088532074a`, on the existing
`Biji-Biji-Initiative/cal.com` / `work/cal-diy-enterprise-20261010`.
This is CAL-04.LINK operator-workflow acceptance, not shared-preview, real staff
migration, SCIM provisioning, or IdP-wide revocation acceptance.

## Completed contract

The existing plan/apply CLI and service meet CAL-04.LINK's two original criteria:

| Original criterion | Executed evidence |
| --- | --- |
| Dry-run first; explicit user ID, expected UUID, issuer/subject; reject rebind and concurrent conflicts | Actual CLI creates an exclusive private plan file without writes; wrong database, changed input/target/plan, stale UUID, expiration, alternate existing identity and conflicting concurrent subjects are refused. Concurrent identical operations are idempotent. |
| Account linkage in an admitted transaction with audit, preserving account/calendar ownership | Real PostgreSQL commits the complete binding batch and its audit together. Injected audit failure rolls back all bindings. Unlocked current operator/target membership is checked. User and membership rows remain unchanged; additional synthetic existing Credential and Booking rows and stable appointment IDs remain byte/value equivalent. |

The generated schema, original CLI, actual linking service and native sign-in/token
functions execute against a newly created private PostgreSQL fixture. Replaying a
previous successful operation cannot undo a later account unlink. Creating the
operator plan does not grant organization ownership, create users, or provision an
organization. Every identity mapping still requires an actual reviewed operator
request against its admitted deployment and database.

## Defect found and repaired

The existing linker acquired user row locks before the root organization lock.
The retained member/custom-role services acquire the root before users. A new
bounded PostgreSQL test holds the root, observes the linker waiting using
`pg_stat_activity` and `pg_blocking_pids`, and then requests the operator's user
row with NOWAIT. Against the original production linker this fails with a row
lock error: a waiting linker already held the row needed by the root's writer.
This demonstrates lock-order inversion, not a claim of an observed production
incident. NOWAIT deliberately prevents turning the test into a deadlock timeout.

The repair moves the existing root FOR SHARE lock ahead of the user locks. It
retains the same duplicate-operation advisory lock, sorted user/member/account
locks, transaction, bounded retries, current-state validation and audit. After
waiting, a committed operator downgrade, membership removal, or expired review
is refused without a new account or audit. The earlier user-lock revocation test
also now observes the actual blocking relationship instead of assuming it from
a fixed 100 ms sleep.

## Verification

- Original 24 database/CLI tests: all passed before the change.
- Original production source plus four new acceptance cases: 27 passed, one
  failed on the demonstrated lock-order inversion. No skipped case.
- Corrected linker: 28 real PostgreSQL/CLI tests passed, then passed again after
  final test typing/formatting changes. All private database stop receipts checked.
- 41 existing Authentik/source/loopback-protocol and CLI-input cases passed.
  Their declared source/database boundaries are unchanged; a loopback provider is
  not the live organizational Authentik installation.
- Strict TypeScript checked the actual linker and database/CLI test import
  closure against the generated schema, using existing web configuration and
  repository ambient declarations. No substitute Prisma declarations or missing
  caller suppression. Biome passed on the two owned files.
- Gitleaks passed for the two owned production/test inputs. UBS passed for the
  production linker: zero critical/warning findings and ten information findings.
  Scanner scope is not an application-wide security clearance.
- The first type-check attempt accidentally inherited the entire web include and
  timed out without a diagnostic. The explicit intended import-closure check then
  identified pre-existing CLI-test environment typing issues; the test now types
  its deliberately minimal child environment at the Node boundary and retains a
  separately typed synthetic database URL. No actual environment was broadened.

The controlled test database is identified by its private socket, data directory
and dedicated fixture user before seeding. No live accounts, calendars, identity
configuration, secrets or deployment changed. No new dependency, schema, service,
runner, or repository was introduced.

## Reproduction

With the candidate's installed dependencies and generated Prisma client:

```sh
python3 scripts/run-community-enterprise-postgres.py --suite identity-link --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node --test --test-reporter=spec tests/community-enterprise/identity-link-cli.test.cjs tests/community-enterprise/authentik.test.cjs
```

The link task can be runtime_proven at this operator-service/CLI contract. Real
preview identities and the first actual staff booking remain CAL-02.PREVIEW and
CAL-06.JOURNEY. Actual historical-data restore, preserved encryption and staff
mapping remain CAL-08.BASELINE/CAL-08.MIGRATE. Live lifecycle/60-second proof remains
CAL-04.SCIM/CAL-04.REVOCATION. None is closed by this local acceptance. A new branch
head must not be relabeled onto an older compiled image.

Raw commands, logs, before/after hashes, failing control and publication readback
are retained on g2 in `/data/tmp/cal-execution-20261016-jxhr9_da`. The source commit
contains only the linker and its test; concurrent role/transport/package work was
preserved and is not claimed as this writer's implementation.

Agent: ChatGPT-CalExecution-20261016
