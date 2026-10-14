# First-organization admission: implementation and actual-browser proof

Date: 2026-10-14. Built source: `1ea54709db3670d454c82a0bd8aec693d10c289e`.
The existing repository, enterprise branch and TASK_GRAPH.json remain canonical.
No live identity, credential, invitation, database, infrastructure or production
change is part of this receipt. This is an assembled local candidate, not a
published image or deployed enterprise release.

## Delivered product behavior

An established platform operator can now review the exact existing accounts,
explicitly create an organization with one owner and up to 19 ordinary members,
and continue to the retained team/member administration UI. The new organization
is created by the actual domain service, not SQL fixture seeding or a fake-success
hook. The review is read-only. Confirmation is immediate operator admission, not
an assertion that an external recipient accepted an invitation.

The operation reuses Team, OrganizationSettings, Membership, Profile and the
existing EnterpriseAuditEvent. It adds no schema or runtime dependency. Current
operator ID/UUID/role and account availability are checked again on the primary
client during mutation. Instance administration does not automatically make the
operator an organization member. The reviewed owner gets OWNER; additional named
accounts get MEMBER. All are existing accounts; neither login-account creation
nor Authentik linkage is silently performed.

Root/settings/members/profiles/audit commit together. Exact request replay is
idempotent, and old requests cannot restore removed resources or memberships.
Current identity changes, root-address conflict, profile collision or audit failure
refuse or roll back the operation. Shared-address concurrency is coordinated by
transaction locks; an observed pg_locks waiter is tested, not just simultaneous
Promise.all calls. The retained NULL-parent unique-index weakness still applies
to other old or external writers; no new estate-wide schema guarantee is claimed.

Personal User.organizationId/movedToProfileId, earlier memberships/profiles and
calendar ownership are not repointed. Additional organization profiles use the
retained structure. Domain auto-join, verification, administrative API access and
public indexing are not enabled by this workflow. A user-supplied subscription
choice or corporate email cannot grant a role.

The existing ProfileRepository org-slug lookup previously used an empty filter.
It now resolves one actual root, scopes profiles to that ID, and denies missing or
ambiguous roots. Equal usernames in different organizations no longer satisfy
that scoped lookup. This is one repaired caller, not a universal audit of every
inherited organization/profile/API read path.

Another retained profile projection returned other members' OWNER rows alongside
the caller's profile, which feeds the authenticated organization-admin hint. Both
supported profile-ID forms now project the caller's accepted membership instead.
Two real-database cases reproduced that incorrect role projection; they pass with
the repaired source, and the 25 retained repository tests also pass. This is not
a claim that every downstream action was exploitable or that all role paths have
been audited.

The account-settings cloud-upgrade banner now links to implemented organization
management. The dormant no-op organization hook is not reactivated. Reuse and
limitations are documented in ORGANIZATION-REUSE-DECISION-2026-10-14.md.

## Executed acceptance

| Check | Result / scope |
| --- | --- |
| Real PostgreSQL service/profile tests | 42 pass, zero failures/skips; actual generated client, primary extensions and complete fixture schema |
| Router/validation contract | 18 pass; production router/schemas with explicit procedure/service doubles |
| Retained ProfileRepository tests | 25 pass using the existing repository test setup; not a real-database suite |
| Existing enterprise regression command | 406 pass; includes overlapping router/graph tests |
| Deliberate operator-check bypass | 7 test failures; source restored |
| Deliberate audit omission | 9 test failures; source restored |
| Deliberate profile scope omission | 1 test failure; source restored |
| Native web type check | Exit 0 after normal tRPC declaration regeneration |
| Immutable install, generation, tRPC and optimized web build | All exit 0; lock unchanged |
| New organization UI journey | Passed on the assembled local application |
| Existing first-run setup regression | Passed on the same build |
| Existing team/guest/multi-host regression | Passed on the same build |
| Build ID | `dXtxBVbA7E3nct9ITIvhJ` |
| Build manifest SHA-256 | `ff6697058b4e71075cd7c9d8ac16bbff9b99784c23c344b3e616e9f1a279cb66` |
| Build origin | `http://127.0.0.1:38917` — local test artifact, not cal.mereka.dev |

The new browser begins with existing synthetic human accounts and one established
instance operator, but zero organizations. It obtains a real native NextAuth
session through a local TLS OIDC test issuer. Anonymous and incorrect-Origin
requests to the same local server are denied. Review creates no Team rows;
editing the form invalidates the displayed review. Confirmation creates the real
root, two memberships/profiles and audit. The operator then creates a child team
and adds the initial member through the existing UI and services.

The same cookie is tested after a committed operator-role downgrade: organization
ownership remains, but additional organization provisioning is refused. The UI
hides that operator action while retaining authorized team administration. No
external invitation message is sent. This verifies the specified local authority
transition, not live Authentik/SCIM revocation or arbitrary replica lag.

The previous onboarding and team-booking fixtures remain distinct scenarios.
They use synthetic identities/provider responses and local non-relaying SMTP.
A passing team fixture does not mean Google/Microsoft calendars, community consent,
new-account enrollment or the live shared platform were tested. The first-run
fixture deliberately skips optional external providers, as its receipt explains.
The source-command test count includes overlapping router/graph tests; do not sum
all groups into an invented full-production end-to-end count.

The initial new service used an invalid Prisma boolean-filter expression; actual
database execution caught it. It was replaced with an explicit unrestricted
BooleanFilter so the retained query extension cannot hide reserved pending-payment
roots. The first native type check also caught ES5 Set iteration and stale generated
tRPC declarations. The source was fixed and the supported generator rerun rather
than weakening type checking. Failed receipts are retained alongside final passes.

## Security and operational boundaries

Privileged browser mutations require POST and exact configured Origin, then the
normal authenticated procedure and primary-state operator checks. A browser
review response is not a signed grant. Future API/MCP access needs verified client
and delegated organization/action scopes; this endpoint is not an agent-operator
shortcut and a confirmation boolean is not authorization.

Gitleaks found no new findings in the changed files; the existing locale file's
translation-key finding is identical to baseline and remains unsuppressed. UBS on
four production modules reports zero critical, five warnings and 53 information
findings. The five missing-key warnings point to static form labels, not a mapped
list; the actual account list has a stable key. Findings are retained, not masked.
These are bounded source scans, not a new whole-image release-security decision.

Current application code, tests and evidence stay on the original branch. Private
research artifacts and restricted historical implementations were not copied into
this public tranche. Agent Mail's supported public endpoint refused registration
with 403/1010; no alternate mailbox, spoofed client or lease was claimed. Issue #78
records coordination while that separate owner-controlled service remains unavailable.

## Reproduction and work still open

```sh
yarn test:community-enterprise:organizations --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
node --test tests/community-enterprise/organization-router-contract.test.cjs
yarn test:community-enterprise:organization-journey --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

The browser command requires a local-origin optimized build and the repository's
normal generated dependencies. The existing runner verifies its disposable database
identity, never falls back to an application DB, and tears down owned servers.
Screenshots contain synthetic accounts only. Final teardown and publication hashes
are recorded in issue #78 and the archived receipt, not inferred from source.

CAL-05.CORE/UI and the full release remain in progress. The established first
platform operator, real native IdP/client/account configuration, external invitation
and consent flow, ongoing member/custom-role lifecycle, domain ownership checks,
live guest routing, exact-image security/publication and migration/recovery are
not closed by this local initial-admission workflow. No new public agent endpoint,
OAuth grant system or MCP server is claimed. Those must share domain services and
explicit authority rather than duplicate scheduling logic in a future adapter.

## Final assembled run and test correction

The fresh build of 1ea54709db3670d454c82a0bd8aec693d10c289e completed normally.
Its first new browser attempt encountered the retained timezone-change modal:
the existing-operator fixture used a default stored timezone different from its
browser. Dismissing that late dialog after filling inputs left the form empty,
so HTML validation prevented submission. No provisioning response or database
mutation was falsely treated as success. The failed log and screenshot remain.

The fixture now explicitly starts with an already-configured operator whose stored
timezone matches the browser. Generic dialog dismissal was removed, and the test
asserts its filled values before submission. This is test setup, not removal of a
production security/policy control. The separate first-run test still actively
selects Kuala Lumpur and verifies the saved timezone. No application code changed
after this exact build; the later commit changes the test and evidence only.

The corrected organization journey passed again, followed by the existing full
first-run and team/guest/multi-host journeys on the same build. The latter verifies
booking, rescheduling, cancellation and the expected local SMTP deliveries; it
still uses provider fixtures rather than real external calendars. Each run stopped
its own PostgreSQL. The image publisher and live deployments were not invoked.
