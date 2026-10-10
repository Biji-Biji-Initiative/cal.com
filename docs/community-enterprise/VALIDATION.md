# CAL-03 first slice — validation receipt

Date: 2026-10-10. Status: source candidate only, NOT promotable.
Upstream subject: `calcom/cal.diy@54343aa685ae8f33159d2f485ec4a57bad5c574a`.
Existing BBI main: `e01d0d5f8cfec4dd910c2aae486b4857f6b8a256`, unchanged.

## Observed results

| Check | Result | Exact scope |
| --- | --- | --- |
| Node behavioral tests | 65 passed, 0 failed, 0 skipped | Production policy/Prisma adapter and selected production event/create/booking handler bodies with in-memory dependencies and authenticated middleware seam |
| Deliberate allow-all negative control | 46 failed, 19 passed; exit 1 as required | In-memory test-loader mutation of `PermissionPolicy.checkPermission`; no source mutation persisted |
| Strict TypeScript | Exit 0 | New policy and adapter against a client generated from the target Prisma schema; NOT whole monorepo/router type checking |
| Biome formatting | Exit 0 | 23 changed/new TypeScript and JavaScript files |
| Biome check at error diagnostic level | Exit 0 | Same 23 files; warning/info diagnostics are not claimed resolved |
| AST integration guard | Exit 0; 18/18 connected | Explicit `--inventory-only` mode, NOT all tracked repository code |
| UBS | 2 files, 0 critical, 0 warning, 16 information findings; exit 0 | New policy and adapter only |

The first 59 tests passed. Six additional regressions produced four failures before
repair: conflicting event identifiers, nonpositive event identifiers reaching a
query, a locked-user booking-ownership shortcut, and an organization filter naming
a standalone team. All four failed before their fixes and passed afterwards.

UBS information findings were reviewed: its bitwise heuristic matched a TypeScript
generic annotation; type-comparison information covers deliberate strict checks;
uncaught-await information covers intentional propagation of store failures so
permission checks fail closed. This is not a dependency, full-repository or secret
scan. UBS refreshed its checksum-mismatched cached helpers automatically during
the scan; no shared project sources or runner configuration were changed.

## Reproduction and environment

Committed entrypoint after normal candidate dependency installation:

```sh
yarn test:community-enterprise
```

That entrypoint runs the AST guard across tracked non-test TypeScript and then
`node --test tests/community-enterprise/authorization.test.cjs`. The full default
AST scope still needs execution in an assembled Git checkout. For the selected
source fixture used in this session, the observed commands were:

```sh
NODE_PATH=/home/gurpreet/projects/cal.com/node_modules node scripts/verify-community-enterprise-permissions.cjs --inventory-only
NODE_PATH=/home/gurpreet/projects/cal.com/node_modules node --test --test-reporter=spec tests/community-enterprise/authorization.test.cjs
```

Tools: Node 22.23.3, TypeScript 5.9.3, Biome 2.3.10, installed Prisma generator
6.16.1, UBS meta-runner 5.4.17 (JS scanner 4.7). Dependencies were borrowed read-only
from the existing checkout, not freshly installed from the candidate lockfile.
A generator-only invocation against the exact target schema produced the client
used for the strict adapter check. It used dummy localhost port-1 database URLs;
no connection, query, migration, production environment file or real database
credential was used. Generated client files are not included in this change.

## Explicitly unproven / release blockers

* Fresh dependency-locked installation; complete web/API build and full type checks.
* Original Vitest suites, real PostgreSQL transaction/concurrency tests and full AST scan.
* All API v2 authorization routes and all legacy permission/feature stubs beyond the recorded class inventory.
* Safe delegated booking-list predicates: `booking.read`/`booking.readOrgBookings` remain denied to avoid coworker-private-booking disclosure.
* Native Authentik OIDC, subject binding, SCIM, IdP-driven revocation within 60 seconds, logout and multi-replica/session behavior.
* Atomic authorization/mutation integration and deactivated/removed host eligibility across the whole booking lifecycle.
* Reconciliation of the existing BBI branding/build delta; migration and restore rehearsal; calendar OAuth, real booking, notifications and upstream-update acceptance.
* Dedicated secret/dependency scans. Gitleaks was not available on the selected command path.

## Coordination limitations

The shared Cal checkout had unrelated unfinished edits, which were preserved.
No branch switch, stash, reset or shared source modification was performed.
Selected source fixtures were edited in task-owned scratch; publication uses new
Git objects and a candidate branch, not replacement of existing main.
The existing Beads database refused reads due to schema 5 versus required 17.
Agent Mail access failed. Neither service was migrated/reconfigured, no separate
tracker was initialized, and no worker dispatch or reservation is claimed.
`TASK_GRAPH.json` is retained for reconciliation with the native tracker.

No production image, database, Authentik application, ingress, Kubernetes resource,
secret, runner or promotion branch was changed. This receipt is not deployment
acceptance and must not be used as a production promotion signal.
