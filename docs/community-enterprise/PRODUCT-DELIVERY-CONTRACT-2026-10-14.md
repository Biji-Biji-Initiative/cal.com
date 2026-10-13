# Product delivery contract: our Cal.diy-based enterprise service

Owner clarification: 2026-10-14. This is the delivery interpretation of the
existing commission, not a second product, repository, deployment or task graph.
Source of truth: Biji-Biji-Initiative/cal.com, work/cal-diy-enterprise-20261010,
docs/community-enterprise/TASK_GRAPH.json. Issue #78 is delivery; #79 is research.
The October 13 single-repository decision and all 39 task identities are retained.

## What we are building

An operator-hosted enterprise scheduling service using the retained Cal.diy
foundation. Organizations, teams, roles and integration credentials belong to our
platform's domain model and authorization policy. Staff do not select or purchase
a Cal.com cloud subscription to join a team or use the implemented capabilities.
A marketing option, billing flag or hidden button must never mint membership,
accept an invitation, bypass authorization or pretend an absent backend exists.

Cal.diy's open-source foundation is not the same question as whether the finished
hosted product is publicly distributed. Preserve the corrected product intent
in #79 and the repository's existing publication boundary. Do not publish private
drafts merely because the chosen repository is public. Generic repairs to the
already-public candidate are separate from proprietary network/product work.
Do not remove third-party notices or copy restricted historical implementations
to manufacture parity. Historical behavior is a reference for requirements;
retained source and independently implemented services must have known provenance.

## What the screenshot exposed

At inspection, cal.mereka.dev serves the retained calcom/cal.com:v6.2.0 image,
not the current Cal.diy candidate. Restoring that application's availability was
service recovery, not delivery of the new enterprise experience. A 302 to the
existing identity provider cannot prove onboarding or product acceptance.

There was a second problem in the candidate itself: a plan-selection component
still offered a priced team option leading to an absent onboarding route. A
historical onboarding-v3 flag could choose that path, while the organization
creation hook contains a no-op adapter and a false success message. That hook
has no production caller in the inspected current source; it is not implemented
organization creation and must not be wired back into the product as-is.

The mother-agent calendar-reference repair at 246c07c3 is an ancestor of the
current branch. Its primary-state ownership/provider checks and recorded tests
are preserved. That repair proves the stated authorization slice, not onboarding,
paid-plan removal or deployed enterprise parity. No task history was lost.

## Product rules

1. One supported first-run journey: profile/timezone, calendar connection,
   conferencing, availability and profile completion. Reuse the retained Cal.diy
   components before creating another wizard. Optional provider steps may be
   skipped, but a skipped connection is never reported as verified.
2. All newly onboarded staff need their own profile/availability setup, including
   organization members. Access to organizations/teams remains a separate server
   decision. Pending invitations remain pending until their real acceptance path.
3. Legacy URLs, feature flags and browser purchase drafts cannot revive a hosted
   checkout or dead route. Valid local invitation destinations remain usable;
   external schemes, checkout hints and setup loops must not become completion
   destinations. Do not globally remove payment integrations for bookable services:
   attendee payments are a different domain from Cal.com cloud entitlements.
4. A visible control must have an implemented and tested result. No no-op success,
   universal permission allow, license impersonation or fake enterprise readiness.
5. Builds, screenshots and acceptance bind to the serving source/image/config.
   Mark legacy recovery, local candidate proof and deployed acceptance separately.
   The public hostname is not evidence that it contains the enterprise branch.

## Execution phases within the existing graph

### Phase 1 — First staff journey, not another foundation-only wave

Owners/scopes: CAL-05.UI, CAL-05.CORE, CAL-04.OIDC, CAL-04.LINK,
CAL-06.JOURNEY and CAL-02.PREVIEW. First remove the unsupported commercial
onboarding path and test the actual existing setup. Then supply a real,
operator-authorized initial organization/member provisioning path; reviewed
identity linkage alone cannot bootstrap an organization that does not exist.

Exit: a new admitted staff user reaches their own profile, saves availability,
reaches real event management and belongs only to the intended workspace. An
administrator creates a team through the implemented service. An external guest
can book/reschedule/cancel without staff SSO. No hosted checkout or invisible
operator SQL is required. Exercise existing and new accounts, denied membership,
stale browser drafts, errors and retries. Local fixture proof is not live exit.

### Phase 2 — Complete core enterprise behavior

Scopes: CAL-03.ROUTES/LIST, CAL-04.SESSION/SCIM/REVOCATION, CAL-05.API,
CAL-06.REUSE, CAL-07.AUDIT/REMINDERS. Complete accepted-member/role and
provisioning lifecycle, scoped API credentials and resource access, multi-host
scheduling, actual external calendars, durable administrative/booking audit and
notification/retry behavior. Retain all earlier adversarial tests.

Exit: named staff/admin/guest journeys and their privacy, conflict, revocation,
rescheduling and failure cases pass against the assembled application. Real IdP
revocation within the graph's required bound is tested with unchanged client
credentials across replicas; local database revocation is not a substitute.

### Phase 3 — Qualified dev, staging and production

Scopes: CAL-02.BUILD/API/PREVIEW, CAL-08.BASELINE/MIGRATE/UPDATE,
CAL-09.ACCEPT/PILOT. Prepare these in parallel with product work, without promoting
an incomplete candidate. Resolve the approved GHCR publication route, security
findings and live identity/configuration. Rehearse preservation/restore, retain
booking URLs and encrypted integration ownership, and prove an upstream update.

Exit: the exact artifact and configuration pass the same product journeys in dev,
then staging, then the existing production promotion process. Migration admission
does not replace a fresh backup, quiesced writers or an approved legacy-data plan.
Do not repeatedly rebuild unchanged code as a substitute for resolving a blocked
publication or identity prerequisite.

### Phase 4 — Broader platform value, only on a working core

Scopes: existing CAL-10.ROUTING/REPORTS/ROLLOUT, CAL-05.API and approved
research reconciliation under CAL-01.REUSE/#79. Add routing/reporting and evaluate
network/programme coordination, versioned agent APIs and BYOA/MCP against real
user benefit and explicit authorization. Do not invent another scheduler, identity
directory or infrastructure stack. Research proposals are not shipped features.

## Scorecard and coordination

The primary progress unit is a completed, observable user journey. Commit counts,
unit tests and local images support it; they cannot substitute for it. Each graph
record must say what is source-proven, fixture-proven, deployed, or still blocked.
The historical 39 records remain; this phase plan groups them rather than creating
parallel task identities. No worker dispatch or new native tracker is implied.

The owner's latest pacing is phase-by-phase depth, not a rushed deadline. Preserve
quality and data; do not weaken controls to satisfy an earlier date. The current
registry-scope and security/migration blockers remain real, but they do not justify
leaving visible product paths unaudited or continuing unrelated micro-slices.
