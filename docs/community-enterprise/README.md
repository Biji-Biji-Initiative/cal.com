# Open-source enterprise calendar — implementation record

Owner direction: self-hosted, fully open source, Authentik, organizations, teams,
roles, API v2 and team scheduling; keep consuming Cal.diy community updates.
The destination is the existing BBI application repository plus its existing
GitOps deployment repository. No commercial edition dependency is introduced.

## First slice (2026-10-10)

Candidate upstream is pinned in `upstream-baseline.json`. This is **not a release**
and must not be promoted. The existing application main, deployed images, database,
Authentik configuration, routing and other agents' unfinished work were not changed.
The candidate starts from MIT Cal.diy, not by relabeling old commercial EE code.
The old fork's branding/build/deployment delta still needs deliberate reconciliation.

### Implemented

* A shared, default-deny permission policy and a narrowly selected Prisma adapter.
* All 18 inventoried inline permission stubs use that implementation.
* Accepted memberships and an unlocked local user are required. Removing the
  organization membership invalidates a leftover child-team grant. No allow cache.
* Built-in roles have action-specific ceilings; caller-supplied fallback roles
  can narrow but cannot elevate ordinary members into writers.
* Custom roles require an exact role identity and team scope plus an explicit
  resource/action grant. Foreign, orphaned, global and wildcard bindings fail closed.
  Custom organization roles do not implicitly inherit into every child team.
* Only a built-in administrator of the resource's actual parent organization
  inherits child-team authority. Global application ADMIN is not tenant authority.
* Team event mutation/assignment guards reject pending or locked hosts; ambiguous
  event ID pairs are rejected before querying. Creation checks the requested team,
  not the administrator's unrelated current organization.
* Booking detail access no longer grants colleagues' private appointments merely
  because the caller administers a team/organization. Locked owners are denied.

### Deliberate safety holds

`booking.read` and `booking.readOrgBookings` are NOT enabled by this policy. The
legacy booking-list SQL selects coworker appointments by attendee email/user ID;
returning team IDs there would expose private bookings. Repair that query and its
negative tests before enabling delegated listing. Personal listing stays on its
existing path. `booking.readTeamBookings` is available to correctly scoped detail
checks. Do not bypass this hold with an alias or a broad role fallback.

Organization/team administration screens, native Authentik OIDC, SCIM, the 60-second
IdP revocation requirement, provisioning ownership, API-scope enforcement, team
booking completion, durable audit/reminders, routing and reporting are still open.
Fresh local database permission reads do not prove IdP-to-application revocation.
Authorization/mutation atomicity needs transaction-aware caller integration; the
adapter accepts transaction clients, but this slice does not claim to eliminate
all concurrent role-change races. Public guest booking behavior must be tested.

## Validation

`yarn test:community-enterprise` runs the AST guard and isolated behavioral tests.
The tests execute production policy/adapter code and production event/booking
handler bodies with an authenticated middleware seam and in-memory Prisma/repository
doubles. They are not live PostgreSQL, HTTP, browser, Authentik or full-build proof.
No application bootstrap or environment file is loaded by this isolated harness.

The initial 59 tests passed. Six added cases exposed four regressions; those were
repaired. See `VALIDATION.md` for the final observed results and exact scope.
The original Vitest event-procedure fixtures now provide real membership data
rather than relying on an always-true authorization stub. That full Vitest suite
still needs execution in the assembled candidate environment.

The guard defaults to all tracked non-test TypeScript. Its explicit
`--inventory-only` mode is a narrower check for source-only inspection; do not
report that mode as whole-repository verification.

## Coordination and next work

`TASK_GRAPH.json` retains CAL-01 through CAL-10 and dependencies. It is a handover
record, not a claim that the whole graph is complete. Native Beads was read but
refused the installed schema (expected 17, found 5); no tracker migration was
performed. Agent Mail access also failed. Reconcile this record into the existing
tracker after its owner repairs it; do not initialize a competing tracker.

Next: assemble the reproducible candidate and finish permission/query integration;
then connect native Authentik identity and provisioning to this authorization
boundary. Identity is `(issuer, subject)`, not an automatic email match. Keep
calendar OAuth separate from staff login. Team/member provisioning must retain
its authoritative source and support revocation and handover without deleting
booking history.

Before deployment: dependency-locked build/type/full tests, database-backed negative
and concurrent tests, preservation/restore and migration rehearsal, real booking
lifecycle, IdP revocation across replicas, and an upstream-update rehearsal. One
booking writer at cutover; immutable images; explicit migration step; existing
GitOps promotion. Do not change runners, manually promote, or replace production
with this partial candidate.
