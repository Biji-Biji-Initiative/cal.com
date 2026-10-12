# Shared host selection and multi-host acceptance

## Final rebuilt artifact and write-race acceptance

Predecessor: `6267793f6a46525849bd678d5adbca9c53c7a26a`.
The optimized application was rebuilt after the regular booking transaction repair.
Native tRPC build, full web type-check, static-asset generation and standalone
Next build all exited zero on the existing immutable candidate dependencies.

Build ID: `z0ZntY3_530Uenaq962pX`.
Build-manifest SHA-256: `ca5cf3384e3131a632d9a92f20b85e4715cc47e28e294cda7964934db86de4b2`.
Production-file hashes were checked before executing the final test. The old
successful sequential artifact was not used to claim this commit-guard repair.

The real packaged HTTP race now returns **one 200 and one 409**, with exactly one
accepted overlapping booking in PostgreSQL. Only the winner's organizer and
invitee notifications are delivered to the non-relaying SMTP sink. The same run
also passes native OIDC via a local HTTPS fixture, browser team administration,
directed booking to host 7002, same-host rescheduling, explicit rerouting to 7001,
removed-member rejection, exact collective slots and locked-required-host rejection.
The collective 10:00–11:00 interval exposes exactly the two full 30-minute slots,
not merely some nonempty subset.

| Check | Result | Boundary |
| --- | --- | --- |
| Fresh native tRPC/web compile and standalone production build | Exit 0 | Exact modified production files; no production deployment |
| Final packaged multi-host + overlapping-request journey | Exit 0 | Real local PostgreSQL, Chromium, HTTP, TLS fixture OIDC and non-relaying SMTP |
| Current host-policy suite | 29 passed | Shared qualification behavior |
| Host and final-write PostgreSQL suite | 42 passed | 24 eligibility tests plus 18 commit/locking tests; real driver and cleanup |
| Retained scheduling suite | 79 passed; one existing TODO | Includes all 18 rescheduling tests; provider unit fixtures, not external calendar proof |
| Existing booking privacy PostgreSQL suite | 40 passed | Actual listing/permission queries |
| Enterprise source/protocol/graph suite | 128 passed; no skips | Existing shared contracts |
| Calendar/required-host suites | 65 passed; two existing skips | Existing date/aggregation tests plus required-host regressions |
| Process-timezone matrix | Four test nodes passed | Five organizer/DST cases in each of four process zones |
| Targeted UBS | Two production files, 0 critical, 0 warnings, 15 information findings | Commit guard/create helper only; not a full security/dependency scan |

The retained engine tests use an explicit test-only commit-guard mock because
Prismock cannot implement PostgreSQL row locks. Concurrency proof comes from the
separate real-database suite and rebuilt HTTP race, neither of which mocks the
guard. That distinction is recorded, not hidden behind aggregate test totals.

### Problems caught and corrected in this wave

The original packaged race demonstrably committed both overlapping appointments.
The final guard now locks the original reschedule row and selected hosts in stable
order, rechecks current eligibility/overlaps, and commits booking/cancellation
atomically. It uses Read Committed so a waiter sees the winner's new booking.
A trial Serializable implementation was not retained: its failed commit returned
an unexpected driver error and cleanup timed out. See
[BOOKING-CONCURRENCY-2026-10-12.md](BOOKING-CONCURRENCY-2026-10-12.md) for the exact
scope, discarded alternative and remaining write paths.

The first consolidated calendar command omitted the repository's established
`TZ=UTC` convention for its legacy fixtures and produced two failures. The command
now restores that convention only around the old Vitest tests. The new explicit
four-process-zone matrix is unchanged and still checks non-UTC runtime behavior;
no production host timezone was changed or assertion weakened.

No shared preview, live Authentik client, external calendar, staff mailbox,
production image or existing database was changed. The passing lock tests do not
close SCIM/MFA/revocation, direct API writes, seat/confirmation mutations,
mid-transaction membership/schedule changes, managed-event completeness,
load testing, migration/restore or production rollout. These remain explicit gates.

### Commands

```sh
yarn test:community-enterprise:calendar
yarn test:community-enterprise:host-policy
yarn test:community-enterprise:host-db --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise:retained-scheduler
yarn test:community-enterprise:booking-concurrency --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

All runtime test services are isolated and stopped by the runner. The PostgreSQL
trigger and lock barrier belong only to the synthetic test database. Source/task
evidence is on the candidate branch; main and production remain unchanged.

## Earlier sequential verification and implementation notes

Date: 2026-10-12. Source checkpoint:
`6267793f6a46525849bd678d5adbca9c53c7a26a`, following
`2e690357e068557db015cca027f14a56c3f7e8ca`.
Status: enterprise candidate. No shared preview or production promotion.

## Recovered source implementation

The booking path and available-slot path now resolve the same
CommunityQualifiedHostsService. It replaces the empty booking-side service and
the separate availability implementation, retaining the existing scheduler.
Both paths read current event assignments, unlocked users and accepted
team/organization memberships. Removed members cannot reappear through the
fallback list. Required fixed hosts and required host groups cannot silently
become optional when one loses eligibility.

Same-host rescheduling resolves the original booking for the exact event. An
explicit routed-host selection can override same-host preference, but cannot
cross event or membership boundaries. Legacy user-based event assignments and
modern Host rows are handled deliberately. Unsupported automatic/segment-driven
host expansion is not silently treated as all users. Personal and dynamic
bookings retain their own permission/eligibility rules.

The recovered source checkpoint passed 29 policy tests, 24 real PostgreSQL host
tests and 79 retained scheduling tests, including all 18 rescheduling tests.
One retained CRM TODO is not proof. The new wave repeats these tests and checks
actual packaged slot and booking endpoints rather than relying on source tests.

## Additional defects found by the packaged test

The multi-host test progressed through directed booking, same-host rescheduling,
explicit rerouting and revoked-member rejection. It then found no collective
slots even though both hosts had overlapping hours. Matched personal-event
queries isolated the problem to one host's 10:00–11:00 UTC schedule, not its
membership or the team lookup. The actual Prisma projection and schedule selector
returned the correct data, but the date-range builder returned an empty range.

A pure comparison reproduced this with the same input under different Node
process timezones. The existing timezone/start-of-day and elapsed-hour arithmetic
could erase a short UTC schedule under a non-UTC host timezone. Working-hour
boundaries now resolve from explicit organizer calendar dates and wall-clock
times, preserving the existing travel-boundary and return-object contracts.
Neither the machine timezone nor the expected booking times were changed to make
the test pass.

The new matrix runs the actual production builder in four child-process zones:
UTC, Asia/Kuala_Lumpur, Pacific/Guadalcanal and America/Los_Angeles. Each checks
five organizer/date cases, including New York and London daylight-saving
boundaries. The original source failed three matrix tests; the repaired source
passes all four. The existing date-range assertions remain unchanged.

A separate aggregation defect could omit required fixed participants when their
common availability was empty, leaving only rotating-host availability. Empty
required-host availability is now a veto. Three new negative cases failed before
repair; all five new cases pass afterward, alongside the ten existing aggregation
checks. The full date/aggregation run has 65 passing tests and the two pre-existing
skipped date tests. No new skip or relaxed assertion was added.

## Packaged acceptance

The final rebuilt-artifact result is attached below after verification. Earlier
failed runs used the previously built checkpoint and are diagnostic evidence,
not acceptance of the new date-range fix. Test-only schedule dumps and temporary
inspection scripts are removed from the committed runner.

The journey uses an isolated PostgreSQL database, the actual packaged Next server,
a TLS loopback OIDC issuer, the native Authentik/Cal adapter, Chromium, native tRPC
and booking HTTP endpoints, and a non-relaying SMTP sink. It does not connect to
live Authentik, external calendars or staff mailboxes. Synthetic direct fixture
setup is not the production account-provisioning workflow.

## Required remaining work

Host selection is not a database-commit concurrency guarantee. Conflicting
requests across event types, simultaneous collective bookings, and permission
changes racing the final booking write still need explicit transaction-level
proof and any required repair. Real calendar conflict handling, quota/fairness,
managed-event acceptance and the unsupported automatic host modes remain in
CAL-06.REUSE. Do not close that task from a sequential local journey.

The shared preview still needs a correctly built public-origin image, admitted
isolated storage/resources, actual Authentik client and reviewed identity linkage,
and secret delivery through existing infrastructure. The local acceptance origin
must not be promoted as a staff endpoint. API v2, SCIM/MFA/revocation, production
migration/restore and full release acceptance remain separate open tasks.

## Reproduction

After the normal immutable candidate install, Prisma/app registry generation and
standalone build:

```sh
yarn test:community-enterprise:host-policy
yarn test:community-enterprise:host-db --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise:retained-scheduler
yarn test:community-enterprise:calendar
yarn test:community-enterprise:journey --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

The calendar command tests process-timezone independence without changing global
host settings. The test database and SMTP/OIDC services are owned disposable
fixtures. Runtime acceptance never substitutes a previous build for changed
production source.

Related primary-source context inspected on 2026-10-12:
https://github.com/iamkun/dayjs/issues/2373 and
https://nodejs.org/api/cli.html#tz. Those reports informed the investigation;
the repairs and verdict above are based on the actual pinned source and tests,
not an assumption that an upstream issue exactly describes this deployment.
