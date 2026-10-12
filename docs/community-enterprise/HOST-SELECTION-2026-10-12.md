# Shared host selection — implementation and acceptance

Date: 2026-10-12. Predecessor candidate:
`2e690357e068557db015cca027f14a56c3f7e8ca`.
Status: candidate-only source checkpoint. Main and production remain unchanged.

## Implemented

Availability's dependency-injection module and booking's direct getter now return
one CommunityQualifiedHostsService. There is no new fairness algorithm or second
booking engine. Calendar conflict detection and LuckyUserService remain the
existing downstream implementations.

The service reads the current event's host assignments, account state and accepted
team/organization memberships. Stale page payloads cannot revive a removed host.
Modern Host rows and the legacy users relation both retain their round-robin
meaning. Personal events and dynamic group bookings do not invent a tenant model.

Required fixed/collective participants cannot disappear while the remaining
meeting is still shown as available. Booking's old empty-result fallback to all
loaded users has been removed. Availability also rejects loss of a required host
or named round-robin group after its blocked-host filter.

An explicit routed-host list and a host subset are intersected, not unioned.
A miss returns no hosts rather than broadening to the full team. Fallback hosts
remain inside that same eligible set. Nonempty rerouting takes precedence over
same-host rescheduling. Otherwise the enabled same-host setting binds to the
original booking's organizer. Every supplied persistent reschedule UID must belong
to the same event, including seat UIDs. Rebooking a cancelled appointment honors
the current explicit event setting; a nullable/unset flag does not permit it.

A configured event-name template is rendered using the newly selected organizer,
not overwritten by text substitution against an unrelated historic title.
Untemplated booking titles retain the existing host-name replacement behavior.

## Source and database proof at this checkpoint

* 29 focused host-service checks pass, including an actual dependency-injection
  identity check: availability and booking resolve the exact same shared service.
* 24 checks pass against real PostgreSQL and the target generated Prisma client.
  They cover current assignment/member removals, pending/locked accounts, team
  boundaries, collective requirements, managed-child ownership, legacy rows,
  same-host/rerouting, foreign and seat UIDs, and cancelled-rebooking policy.
* 79 retained scheduler checks pass across rescheduling, new booking, dynamic
  groups and LuckyUserService. The rescheduling file has 18/18 passing tests.
  One existing CRM calendar-verification TODO remains unproven; no check was
  converted to a skip to achieve this result.
* Reintroducing unrestricted hosts in a test-only transform causes 26 of the
  29 host-service checks to fail. The source file on disk is not mutated.
* The native tRPC build passes. Final optimized-build/runtime acceptance is a
  separate gate and is not claimed by this source checkpoint.

## Corrected test assumptions, not invented delivery

The previous same-host test explicitly expected reassignment because the feature
had been removed upstream. It now requires the actual original organizer.
The different-host scenario now supplies an explicit reroute, asserts that new
organizer and checks the resulting dynamic event title, instead of assuming a
random host must differ.

The existing notification handler combines old-host cancellation and reassignment
in one message. The retained test had expected an additional standalone message.
It now requires the combined notice's reassignment subtitle and exact new-host
contact link; the asynchronous assertions remain awaited and a missing-detail
negative rejects. No duplicate production message was added merely to satisfy a
stale test expectation.

A clean checkout also exposed Prismock's eager import of the conventional
`@prisma/client` entrypoint, while the application uses a custom generated client.
`scripts/generate-prismock-client.cjs` generates that test compatibility client
from the same complete schema using the pinned installed Prisma. It does not
borrow an older checkout's types, modify the schema models, query a database or
change the dependency lock. Generated files stay under node_modules.

## Intentional limits and unresolved release work

Contact-owner selection is an explicit restriction, not an implied soft fallback.
Automatic whole-team/segment expansion remains unsupported and returns a clear
error rather than silently using an incomplete host list. Named-group same-host
rescheduling is not claimed as complete.

These current-state checks are not an atomic booking-commit lock and do not prove
cross-replica simultaneous booking correctness. Full concurrency tests, deployed
IdP/SCIM revocation, external calendar delivery, managed-event acceptance and
remaining enterprise tasks stay open. Availability's broader organization-specific
watchlist support is also not established by this slice.

No existing staff identity, database, DNS, deployment, secret or notification
recipient was changed. The canonical Cal.diy main reference was rechecked and
still resolves to the pinned `54343aa685ae8f33159d2f485ec4a57bad5c574a`.
This is not an actual upstream-update rehearsal or production release.

## Reproduction

```sh
yarn test:community-enterprise:host-policy
yarn test:community-enterprise:host-db --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise:retained-scheduler
```

Use the normal immutable dependency installation and target Prisma/app-store
generation first. The database command uses the existing disposable Unix-socket
runner and refuses an unrelated or populated application database.
