# Enterprise calendar: recalibration and execution decision

Owner: Gurpreet. Decision date: 2026-10-12.
Predecessor candidate: `7029bb932393ec4ceadf016d335cd00d70554399`.

## Verdict

Keep the open-source architecture. Change the execution sequence. There is no
basis to claim every previous implementation choice was optimal or that the
enterprise platform is working merely because its authorization tests pass.

The first two slices repaired real problems: always-allow authorization stubs,
cross-team/private-booking visibility, inconsistent filters/counts and seat-data
privacy. Preserve those changes and regression tests. But the programme spent
two iterations on those foundations without completing a clean dependency install
or a native staff login. That is not an adequate delivery rhythm for this owner.

## What stays

* One MIT Cal.diy-based application distribution in the existing repository.
  Retain its booking engine, calendars, NextAuth, Account records and
  Team/Membership/Profile models. No new scheduler, identity database, billing
  server, proprietary EE dependency or parallel microservice platform.
* Native Authentik OIDC for identity; Authentik remains responsible for staff
  authentication and MFA. Cal enforces scoped local authorization and scheduling.
  Calendar OAuth remains a separate integration, not the staff identity source.
* Existing GitOps deployment, immutable release artifacts, backups, secrets and
  admission policies. The legacy service keeps running until migration and
  full team-release acceptance. No new hardware, runners or release controller.
* Continued Cal.diy updates through a reviewed integration map and actual update
  rehearsal. Community fixes are useful input, not a promise that private
  commercial fixes or all new enterprise features will arrive upstream.

## What changes

1. Work is organized around three demonstrable outcomes: a runnable preview
   staff-to-invitee journey; a team-complete enterprise production pilot; and
   full rollout including routing/reporting. Preview proof never authorizes an
   incomplete production release.
2. The scheduling engineer tests retained round-robin, collective and managed
   event services with synthetic fixtures before building every administration
   screen. A missing UI is not evidence that a new algorithm is needed.
3. Native login reuses the existing Account key with an issuer/subject-derived
   identifier. Initially only explicitly pre-linked users can enter. No email
   autolinking, implicit global-admin mapping or user creation from IdP claims.
   SCIM comes next on that identity boundary, not as a prerequisite to a protocol
   proof. Real IdP lifecycle/revocation remains a production prerequisite.
4. Every mutation needs durable audit from its implementation, not as a cosmetic
   final feature. Migration inventory and restore evidence start early in
   parallel with source work; actual data preservation cannot be inferred from
   a clean synthetic schema.
5. We stop manufacturing progress by expanding generic policies indefinitely.
   A source security repair should either remove a named release risk or unlock
   the next runnable journey. Native session behavior is part of that journey.
6. The graph distinguishes source_proven from runtime_proven. No epic is closed
   because child code was pushed. Commands, scopes, owners, dependencies and
   acceptance are explicit and mechanically checked.

## Findings that affect the new order

The old server-session helper returned an unbounded cached session before
checking current database account state. That is incompatible with reliable
account disablement. This slice removes that shortcut and validates the native
binding on refresh. This proves local account/link revocation only; it does not
prove IdP policy/group revocation, bearer/API revocation or a 60-second bound.

The clean dependency install was previously cut off during linking. An immutable
install with reusable hardlink/global-cache settings has now completed without
changing the lockfile. Lifecycle scripts were not silently run; Prisma and app
registry generation were executed explicitly. Actual compiler/build results are
recorded separately in the validation receipt.

The installed Beads tool explicitly refuses migration from this repository's
schema 5; its reviewed migration supports only 13..16 to 17. This is a real
coordination blocker, not a reason to reset or discard records. Keep stable CAL
identities in the executable graph and issue #78; recover the original tracker
through a supported preservation-first procedure, then reconcile once.

## Delivery order

One build/integration owner works on runnable web/API artifacts and preview.
The web preview can proceed independently of API v2 packaging; both must pass
before production, so an unrelated API build cannot stall the first browser proof.
One identity owner works on native login, linkage, provisioning and revocation.
One product/scheduling owner works on the smallest organization/team operations
and the retained booking engine. The fourth slot is independent access/release
review as needed. These are ownership roles, not a claim that agents were spawned.
Never exceed four concurrent agents or run competing integration/build lanes.

First preview acceptance: a reviewed user signs in through Authentik, belongs to
the intended team, connects a test calendar, accepts an external invitee booking,
reschedules/cancels correctly, and cannot act on another organization's events.

Production additionally requires complete admin/UI/API scope coverage, real IdP
provisioning and revocation on every replica, durable audit/reminders, concurrent
booking correctness, migration/restore, public-link preservation and the existing
promotion gate. Routing/reporting may develop in parallel but the overall
programme remains open until their acceptance and broader rollout.

## Limits of this decision

This is the best-supported direction from the inspected source and the owner's
constraints, not a proof of a universally optimal architecture. The largest
remaining uncertainties are full upstream application build health, retained
team-engine end-to-end reachability, real current identity/account mapping and
legacy database migration compatibility. Resolve them with bounded executable
proofs; do not hide them behind another large speculative redesign.
