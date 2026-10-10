# CAL-03 continuation: delegated booking visibility

Date: 2026-10-11. Candidate predecessor:
`2c6a8dcb01b8fd650ad0042dbe51b31eb2f7611f` on
`work/cal-diy-enterprise-20261010`. Upstream lineage remains MIT Cal.diy
`54343aa685ae8f33159d2f485ec4a57bad5c574a`.

**Source candidate only; not production-promotable.** Existing application main,
production images, database, Authentik configuration and ingress were not changed.

## Implemented behavior

The shared booking-list function now authorizes by event/team ownership rather
than by a coworker's identity. It retains the actor's own bookings and explicit
attendee participation. Managed children inherit the parent event's team only
when they do not declare a conflicting team owner. An active organization filter
narrows delegated authority without becoming a grant.

The list reuses the existing PermissionPolicy through a KyselyPermissionStore,
inside the same read-only repeatable-read transaction as its rows, counts,
related metadata and hydration. Actor email and locked status come from the
actual database, not the caller's email field. There is no cached allow decision.

Filters are intersected with authorized visibility. Nonexistent, empty-result or
unauthorized team/event/user filters cannot silently widen a query. Date filters
apply equally to page rows and totals. Stable ID tie-breaking prevents duplicate
or omitted rows during pagination when booking times tie. Attendee name and email
are matched within one attendee predicate instead of duplicated table joins.
Search wildcard characters are treated literally for contains/starts/ends filters.

Recurring metadata and reschedule provenance are limited to visible bookings.
For hidden-attendee seated events, both attendee records and seat-reference
payloads are filtered. A real database test failed on the latter before its fix.

The list requests `booking.readTeamBookings`. Broad legacy `booking.read` and
`booking.readOrgBookings` remain denied elsewhere; this repair does not unlock
other unaudited callers. Iterable spreads in the first-slice policy and this
listing were replaced with Array.from for the actual web compiler's ES5 target.

## Observed validation

| Check | Observed result | Scope |
| --- | --- | --- |
| Real PostgreSQL listing suite | 40 passed, 0 failed, 0 skipped | Production query/policy/store, real PostgreSQL 18, complete target Prisma schema |
| Prior authorization suite | 65 passed, 0 failed, 0 skipped | Existing isolated policy/adapter/handler regressions |
| Deliberate visibility bypass | 21 tests failed, 19 passed; nonzero exit as required | In-memory mutation only, same real PostgreSQL suite |
| Source AST guard | Passed across 4,537 source files; 18 inventory callers connected | Tracked and added non-test TypeScript, not a whole security audit |
| SQL-module strict type check | Zero diagnostics | Actual target generated DB types, installed external dependency fallback |
| Booking query TypeScript dependency graph | Zero diagnostics at ES5 target | Real web/base compiler settings and target source; workspace aliases reconstructed because fresh installation did not finish |
| Biome error-level check | Passed | Six changed/new JS/TS files; warning/info diagnostics are not claimed absent |
| Python syntax and git whitespace | Passed | Disposable test runner and changed tracked files |
| UBS | 2 files, 0 critical, 0 warnings, 3 information findings | New SQL visibility and permission-store modules only |

The database tests include two organizations; direct, sibling and managed teams;
custom/pending/removed memberships; locked and missing users; foreign and personal
appointments; explicit guest/seat participation; conflicting child/parent event
ownership; empty and intersecting filters; identical-time pagination; date totals;
recurring metadata; and reschedule provenance. The production SQL and permission
logic are not mocked. Logging and presentation parsers are stubbed, and the
function is invoked directly: this is not browser, HTTP, API-scope or IdP proof.

A concurrency test pauses the actual membership query, commits a role downgrade
from a second PostgreSQL connection, and resumes the list. The in-flight request
returns one consistent previously committed snapshot; the next request loses
its delegated authority. This is NOT a claim of Authentik-driven revocation within
60 seconds or cross-replica session acceptance.

The initial database harness attempts failed during fixture construction: first
the database-clone setup timeout, then a real schema uniqueness constraint on
managed event fixtures. After correcting the fixture, 39 of 40 tests passed and
the hidden-seat-reference privacy case failed. After the application fix, all
40 passed repeatedly. These setup failures are not represented as application
regressions. The broad-visibility negative control then caused 21 failures as
expected without changing the source files on disk.

The first UBS scan misclassified two SQL inequality operator strings as loose
JavaScript equality. Those predicates now use the equivalent standard SQL `<>`
operator. The final scan has zero critical/warning findings; its three information
findings concern intentionally propagated database errors and a regex heuristic.
No suppressions or safety checks were disabled. This is not a dependency or
whole-repository security assessment.

## Reproduction

The regular isolated suite and full source guard remain:

```sh
yarn test:community-enterprise
```

A new reproducible runner creates a private Unix-socket PostgreSQL instance,
installs the target schema into a new empty database, runs the database suite,
stops its owned server, and removes its temporary data:

```sh
yarn test:community-enterprise:postgres --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

It refuses root, never reads a deployed DATABASE_URL, verifies the test server's
actual data directory/user and an empty template before copying, and uses no
TCP listener. It neither migrates an existing database nor restores production.
It validates the selected Prisma CLI version against the repository pin.

Because this session's clean dependency installation was incomplete, the actual
successful runner invocation explicitly selected the already-installed matching
Prisma 6.16.1 CLI and borrowed external dependencies read-only:

```sh
NODE_PATH=/home/gurpreet/projects/cal.com/node_modules python3 scripts/run-community-enterprise-postgres.py --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp --prisma-cli /home/gurpreet/projects/cal.com/node_modules/prisma/build/index.js
```

That full runner passed all 40 tests and stopped its disposable server. A prior
attempt using the partially installed candidate CLI failed on missing `c12` and
also stopped its server. Do not treat the explicit fallback as a clean install.

## Build and release boundaries

The immutable Yarn install resolved and fetched 3,583 packages, but its linking
step exceeded the explicit 600-second bound. The original lockfile was not
changed. Full dependency-locked install, web/API builds and complete application
type/test suites remain unverified. The successful targeted type checks use
existing installed dependencies plus newly generated target-schema types; they
do not establish whole-application build acceptance.

The clean target schema and generated clients prove fixture compatibility, not
an upgrade or restore from the legacy production database. Native Authentik OIDC,
SCIM, account linkage, 60-second revocation, remaining route/API authorization,
organization/team UI, mutation atomicity, booking engine concurrency, delivery
workers, restore rehearsal and production acceptance remain open in TASK_GRAPH.

The existing Beads database again refused reads (schema 5 versus required 17).
No tracker migration or alternative native tracker was created; issue #78 remains
the handover surface. No agent dispatch is claimed. Original shared-checkout
unfinished edits were preserved. Publication is candidate-only; no main/prod
promotion, runner reconfiguration, secrets or customer-facing sends occurred.
