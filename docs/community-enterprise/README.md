# Cal.diy-based enterprise service — implementation record

## Latest: reviewed member roles, ownership and planned offboarding

[Member-lifecycle evidence](MEMBER-LIFECYCLE-2026-10-14.md) records the assembled
role-change, ownership-transfer and planned-removal journey, including unchanged
sessions losing organization access while personal and other-organization data
remain. [The retained-model contract](MEMBER-LIFECYCLE-CONTRACT-2026-10-14.md)
explains scope, rollback, replay and the last-owner/provider-handoff boundaries.
The continuation also tests the actual database deletion contract so a future
upstream cascade cannot enter update acceptance without preservation review.

This is not emergency suspension or an automatic event/provider handoff engine:
a blocked review has revoked nothing. Live identity/provider behavior, custom roles,
community enrollment, exact-image security/publication and staged deployment remain
open in the same graph. No deployed candidate is claimed by these local receipts.


## Previous: existing-account invitation consent (2026-10-14)

[Invitation acceptance evidence](INVITATION-ACCEPTANCE-2026-10-14.md) records the
actual owner/recipient/cancellation and SMTP-failure journeys. [Reuse and consent](INVITATION-CONTRACT-2026-10-14.md)
explains the retained models, identity-bound inbox and explicit delivery limits.
This does not create new login accounts or complete external community enrollment,
durable notification delivery or live rollout. The canonical graph retains those
open requirements. Earlier first-organization admission remains implemented.


## Previous: actual first-organization admission (2026-10-14)

[Admission evidence](ORGANIZATION-ADMISSION-2026-10-14.md) records the established
operator's real review/create/team-member journey on the assembled local candidate.
[Reuse decision](ORGANIZATION-REUSE-DECISION-2026-10-14.md) explains the retained
models, additive profiles and human/agent extension boundary. This is not a live
enterprise deployment or completed community invitation/IdP lifecycle. The same
39-task graph preserves those acceptance requirements.


## Current product direction and acceptance

We are building our operator-hosted enterprise service on the retained Cal.diy
foundation, not asking staff to buy Cal.com cloud plans. Repository, branch and
TASK_GRAPH.json remain the single delivery home. Product source/publication intent
is governed by the existing single-repository decision and corrected issue #79;
old "open-source distribution" language below is historical, not a new commitment
to publish private product drafts.

[Product delivery contract](PRODUCT-DELIVERY-CONTRACT-2026-10-14.md) groups the
existing tasks into first user journeys, complete enterprise lifecycle, qualified
rollout, and approved broader network/agent capability. [Onboarding evidence](ONBOARDING-2026-10-14.md)
records the repaired first-run path, exact built-browser proof and unresolved work.

The prior deployment readback recorded dev as legacy v6.2.0; the member-lifecycle
continuation made no deployment change. Restored
availability and an Authentik redirect are not enterprise candidate acceptance.
This source fixes the candidate's own stale plan chooser and incomplete first-run
routing. The current local candidate also proves explicit initial organization
admission and verified-existing-account invitations; deployment, external account
enrollment and live provider acceptance remain open. The mother-agent 246c07c3 authorization repair is included and retained.

## Historical implementation receipts

The records below retain their original code/test scopes. Later evidence may
supersede a defect status; no old receipt validates a newer image or live release.

## Historical: reviewed identity onboarding (2026-10-13)

The existing account-link helper now has an operator-only plan/apply workflow,
with exact user UUIDs, current instance-administrator checks, deployment-bound
expiring plans, conflicting-identity protection and atomic batch audit. It reuses
Account and EnterpriseAuditEvent; no schema change or public API was introduced.
24 real PostgreSQL/CLI checks and 132 enterprise regressions pass. See
[identity onboarding](IDENTITY-ONBOARDING-2026-10-13.md) for commands, evidence,
reviewed scanner warnings and boundaries. Real preview mappings and execution
remain in CAL-04.LINK; no staff account or deployed environment was changed.


## Prior: multi-host runtime and atomic regular booking writes

The rebuilt local application now proves directed round-robin selection,
same-host rescheduling, explicit rerouting, removed/locked host rejection and
exact collective availability. A deterministic concurrent-request test first
reproduced two overlapping accepted appointments for one host. The repair uses
ordered participant locks and a fresh final conflict check in the existing
booking/cancellation transaction; the rebuilt test returns one success and one
409, with only the winner's notifications. No separate scheduler or lock service.

[Final artifact and tests](MULTI-HOST-2026-10-12.md) ·
[Commit contract and limitations](BOOKING-CONCURRENCY-2026-10-12.md).
The preserved task graph remains open for unreviewed write paths, real IdP and
external calendar integration, shared preview admission, API v2 and production
migration/release. Source proof is not a production rollout.

## Prior verification records

## Historical wave: shared host selection and calendar correctness

The booking and available-slot paths now use one membership-aware host service.
The retained same-host/rerouting suite is green rather than relying on the earlier
empty-service fallback. Runtime investigation also found and repaired required-host
intersection and process-timezone-dependent working-hour defects. See
[MULTI-HOST-2026-10-12.md](MULTI-HOST-2026-10-12.md) for current source and rebuilt
artifact evidence, including the limits of synthetic multi-host acceptance.

CAL-06.REUSE remains open for commit-time concurrent booking/revocation races,
remaining managed/automatic-host behavior and real provider acceptance. The shared
preview, live Authentik/SCIM/MFA lifecycle, scoped API v2, migration and production
release gates are not closed by a local test. No shared environment was changed.

## Earlier implementation record

## Historical slice: teams, audit and a local complete booking lifecycle

[Team journey evidence](TEAM-JOURNEY-2026-10-12.md) records the recovered and
completed implementation: authenticated organization/team administration, basic
membership roles, atomic administrative audit/idempotency, and public team routes
using the existing Booker. A packaged local application with synthetic PostgreSQL
and a TLS OIDC test issuer completes team creation/member saving and a single-host
guest booking, reschedule and cancellation. Six expected notifications are
captured through real loopback SMTP; no message leaves the test host.

This does **not** establish a shared preview, real Authentik/calendar integration,
API v2 or full multi-host scheduling. Stronger retained tests expose an empty
booking-side qualified-host service and missing same-host behavior; CAL-06.REUSE
remains unfinished. The unchanged stable task graph now records those precise
remaining requirements rather than reporting all scheduler tests green.

## Earlier implementation records

## Historical direction: runnable enterprise journeys (2026-10-12)

[Recalibration](REALIGNMENT-2026-10-12.md) keeps the MIT Cal.diy foundation and
existing infrastructure but replaces the coarse sequence with an executable
39-node graph: the same 10 parent IDs and 29 child tasks. The outcomes are a
runnable preview staff-to-invitee journey, a team-complete production pilot, and
full rollout including routing/reporting. No source test closes a runtime milestone.

The candidate now has a native NextAuth Authentik provider, translated login action,
explicit issuer/subject Account linkage, safe profile selection and fresh local
session checks. It does not auto-create/merge users from email and does not mint
proxy cookies. Configuration is disabled by default. See [AUTHENTIK.md](AUTHENTIK.md)
for the current boundary: SCIM, real IdP revocation, other login/API enforcement
and operator provisioning remain open, not silently supplied by this source slice.

The immutable dependency install now completes with an unchanged lockfile.
The native tRPC build, full web type check and optimized Next production build
now pass. The built server has been started against isolated synthetic PostgreSQL:
the Authentik login action, provider metadata, CSRF and unauthenticated-session
checks pass. This closes the local web-build/start task, not the deployed preview,
real identity lifecycle, API v2 build or team-booking journey. The ready queue now
starts with CAL-02.PREVIEW, followed by reviewed linkage, minimal team operations
and retained scheduling-engine proof.
Application generators and protocol/source tests use that actual installed
candidate rather than the previous checkout's dependency tree. See the current
[validation receipt](VALIDATION-2026-10-12.md) for complete compiler/build results
and unresolved release gates. The wider build also exposed a prior booking-ID
projection mismatch; both repository projections and regression tests were repaired.

The existing Beads schema cannot be migrated by the installed supported plan.
Do not reset it or create a competing tracker. Preserve the stable CAL IDs in
TASK_GRAPH.json and issue #78 until supported recovery. This is still a
**non-promotable candidate**: no production client, database, user, ingress or
image has been changed.

## Prior slice record

## Latest slice: delegated booking visibility (2026-10-11)

The booking-list safety hold described in the first-slice historical record below
is now resolved for the shared `getBookings` path, which web and API v2 reuse.
It requests `booking.readTeamBookings`, not the broad legacy `booking.read` or
`booking.readOrgBookings` names; those broad names remain denied elsewhere.
Delegation follows the actual event's team, including managed children with no
contradictory explicit owner. A coworker's user ID or email is never a visibility
grant. Filters only narrow authorized rows; no-match filters return no rows.

Permissions, rows, totals, recurrence and reschedule metadata use one read-only
repeatable-read PostgreSQL transaction. Role changes affect the next request;
in-flight reads finish on their original committed snapshot. Hidden seated
attendees are removed from both attendee rows and seat-reference payloads.
This is not a claim of IdP revocation, identity verification or API-scope parity.

40 tests execute the production query and policy against real PostgreSQL and the
complete target schema; all pass. All 65 previous isolated tests pass. The AST
guard now passes across 4,537 source files, not just the 18-file inventory. A
deliberate broad-visibility mutation makes 21 database tests fail. Reproduction,
limitations and install failure evidence are in
[VALIDATION-2026-10-11.md](VALIDATION-2026-10-11.md).

The candidate remains **not promotable**. The fresh immutable dependency install
reached linking but exceeded its bounded run; complete web/API build and full
type checks remain open. Native Authentik OIDC/SCIM, UI, remaining API permissions,
team booking acceptance and production migration/restore are still to be built
and proven. Existing main and runtime remain unchanged.

## Historical first-slice record

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
