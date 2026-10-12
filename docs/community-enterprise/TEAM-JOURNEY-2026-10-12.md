# Team administration and local booking journey

Date: 2026-10-12. Predecessor: `a5e999e20aaabfe256599168a68cecc60a5e9cd1`.
Status: candidate implementation, not a deployed preview or production release.

## Final verification receipt

| Check | Observed result | Scope |
| --- | --- | --- |
| Prisma generation, native tRPC build, full web type check | Exit 0 | Actual candidate dependencies and schema; no substituted compiler aliases |
| Optimized standalone Next build | Exit 0 | Final application source including domain-error handling |
| Enterprise source/protocol/graph regressions | 127 passed, none failed/skipped | Existing 122 plus five awaited-notification assertion regressions |
| Team service, public lookup and migration | 23 passed, none failed/skipped | Real PostgreSQL/Prisma adapter; additive migration applied to an isolated schema |
| Existing booking privacy/database suite | 40 passed, none failed/skipped | Real PostgreSQL and actual listing/permission code |
| Native tRPC domain-error tests | 8 passed | Framework failure-result handling and error-code negatives |
| Final packaged journey | Passed | TLS fixture OIDC, Chromium team UI, scoped APIs, guest lifecycle and six real loopback SMTP messages |
| Permission source guard | 4,550 files passed; 18 known callers connected | Not a comprehensive authorization audit |
| Task graph | 39 nodes passed | Stable IDs; incomplete enterprise requirements remain open |
| Biome error-level and git whitespace checks | Passed | Changed code; warning/information diagnostics are not claimed absent |
| Targeted UBS | 3 production files; 0 critical, 0 warnings, 18 information findings | Team service, public resolver and tRPC converter; not an image/dependency scan |

Final build ID: `iEItAWJQNB5mJ7lMMr8ua`.
Build-manifest SHA-256: `e5934bffd38d1c3f837e5f6d8ab68e922cea017c863054ff79e3a5f560adecf0`.
The final journey runs the rebuilt artifact, not the earlier successful bundle.
The foreign-organization mutation returns FORBIDDEN, not a generic 500. The
single-host booking/reschedule/cancel transition is committed and read back;
notifications reach both synthetic recipients for each transition.

The broader retained scheduler tests are intentionally **not reported green**.
After moving cold module transformation into bounded setup, the focused retained
rescheduling file has 16 passing and two failing checks. The missing host behavior
described below remains a release blocker. The managed-event file still has an
upstream TODO. No failures were converted to skips or assertions removed.

An initial team-database run passed all 23 test bodies but timed out in cleanup.
A rerun with bounded cleanup-stage diagnostics completed the same 23 checks and
released the pools/database/server successfully. This is a recorded transient
fixture cleanup failure, not a claimed repair to production database behavior.
The tests and all owned local web, SMTP, OIDC and PostgreSQL servers are stopped
when their runners complete.

UBS information findings were reviewed: strict comparisons, typed Prisma delegate
accesses, regex heuristics and intentional database-error propagation. Full
secret/dependency/image scans remain required before promotion; the dedicated
secret scanner was not available on the current command path.

## Delivered behavior

The existing web application has an authenticated enterprise team page with an
organization selector, team creation and basic membership-role controls. It uses
the retained Team/Membership model and shared permission service. The new tRPC
endpoint and browser endpoint registry are wired together; there is no parallel
administration service or replacement booking engine.

Team creation and member-role changes execute as serializable transactions with
a bounded retry. Successful mutations and their administrative audit record commit
together. A caller-supplied UUID plus canonical request hash makes retries
idempotent and rejects reuse for different work. Tests cover audit failure rollback,
concurrent duplicate submissions and concurrent owner demotions. The last active
team owner cannot be removed through role demotion. Only active accepted members
of the same organization can be assigned. Directory-managed and custom-role
bindings are not silently overwritten by basic-role controls.

The additive EnterpriseAuditEvent migration changes no existing scheduling or
identity rows. This table records administrative actions, not the complete booking
outbox, reminder engine, SCIM grant provenance or immutable external audit retention.
Those remain separate unfinished requirements.

Public paths `/org/<organization>/team/<team>/<event>` and
`/team/<standalone-team>/<event>` resolve every ownership level before reusing the
existing public event repository and Booker UI. Duplicate root slugs fail closed;
a missing path never falls back to an unrelated personal event. Reschedule/seat
lookup is checked against the resolved event. Managed templates are not directly
published as public team events by this resolver.

## Local acceptance journey

The reusable test starts the actual packaged Next application and a disposable
PostgreSQL instance. A local HTTPS OIDC fixture performs a real authorization-code
exchange through the existing Authentik provider and Cal account adapter. Its
certificate is trusted only by that test process; TLS verification is not disabled.
Synthetic identity records are explicitly prelinked. No real staff account, IdP
client, or existing application database is changed.

After native sign-in, Chromium creates a team and saves a colleague membership
through the actual UI. The test reads the resulting membership and administrative
audit records from PostgreSQL. It verifies that a foreign-organization operation
is denied. An anonymous browser renders the existing public Booker, then uses the
native booking HTTP endpoints to book, reschedule and cancel. The resulting booking
and status transitions are read back from PostgreSQL. This is UI proof for team
administration and booking-page rendering, plus HTTP proof for the booking actions;
it does not claim every guest form action was clicked in the browser.

The event has one synthetic host and no external calendar connection. It proves
that local team-event plumbing works; it is not a proof of multi-host fairness,
collective-host concurrency, calendar conflict delivery or the complete production
team-booking contract.

Real notification output is delivered to a loopback-only SMTP sink. The sink
accepts only the two synthetic organizer/invitee addresses and cannot relay mail.
The test requires a notification to both people for creation, reschedule and
cancellation: six expected messages. This is stronger than observing a queued
email, but is not a real staff mailbox or external provider delivery test.

Cancellation uses the existing application `/api/csrf` endpoint rather than the
separate NextAuth CSRF endpoint. A correctly shaped but invalid token must still
be rejected. No CSRF/authentication guard is removed to make the journey pass.

The full server fixture uses 40 PostgreSQL connections and the existing bounded
five-connection Prisma pool; service-only tests keep 12. The earlier twelve-slot
fixture exhausted its capacity across Prisma/Kysely/application pools. The corrected
journey observed 11 connections before booking, with an explicit bound check.

## Problems exposed rather than hidden

The installed tRPC middleware returns resolver failures as a failed result instead
of always throwing. Domain-error conversion now handles that representation and
retains correctly classified and unknown errors. Eight direct framework tests
cover success, recognized domain codes, existing transport errors and untrusted
code-looking objects. The final journey must also observe FORBIDDEN rather than
a generic internal error for a denied team mutation.

The retained rescheduling tests had unawaited asynchronous email assertions. They
are now awaited, with regression tests that fail for a missing notification. Email
selection distinguishes the requested lifecycle heading instead of assuming the
first message to a recipient is the relevant one. Cold module transformation is
performed in bounded test setup; per-booking execution deadlines are unchanged.

This stricter verification exposed unfinished upstream team-host logic. The direct
`packages/features/di/containers/QualifiedHosts.ts` still returns a no-op service,
while the availability container separately loads the module in
`packages/features/di/modules/QualifiedHosts.ts`. The module's legacy users path
also does not implement the complete round-robin contract. A retained same-host
rescheduling test even documents that its enterprise behavior was removed and
expects reassignment. Therefore a passing single-host journey cannot close
CAL-06.REUSE. Same-host/rerouting eligibility, legacy team representation and
shared availability/booking host selection need one deliberate repair with
behavioral negatives before release.

No assertion was deleted or skipped to claim all retained scheduling tests pass.
The recorded wider suite and focused remaining failures are retained as release
blockers; the managed-event test marked TODO is not acceptance evidence.

## Reproduction

After the normal immutable dependency install, generators and packaged web build:

```sh
yarn test:community-enterprise
yarn test:community-enterprise:teams --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise:postgres --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise:journey --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

Use a clean acceptance checkout without deployed `.env` files. The runner verifies
the test database identity, binds services to loopback, generates temporary test
credentials, and stops its owned servers. No production credentials or real mail
recipients are required. Test fixtures use the actual mapped `roundRobin` enum and
`_user_eventtype` relation rather than invented table names.

## Release boundary

The current application source remains on the enterprise candidate branch.
No existing main, image tag, Authentik client, Kubernetes resource, DNS, secret,
legacy database or staff membership is changed. An earlier read-only nonproduction
probe found the legacy Cal web/API deployments parked and existing staging CNPG
instances retained. Those observations are dated evidence, not a new capacity
admission or permission to repurpose their databases.

The deployment task stays open until a source-owned isolated preview, exact image,
resource/storage admission, real Authentik setup and required secret references
are ready. Do not expose this local acceptance artifact as a staff service or claim
SCIM, live MFA, 60-second revocation, API v2, backups/migration or full multi-host
scheduling acceptance. Native tracker schema and Cal Agent Mail registration
blockers remain; issue #78 and stable task IDs preserve the handover without
resetting the existing tracker.
