# Scoped booking report source contract

This source contract advances the reporting boundary for **CAL-10.REPORTS**.
It is an aggregate-only adapter at
`packages/features/community-enterprise/reporting/BookingReportContract.ts`;
it does not claim a live report endpoint, production export or deployed image.

## Contracted behavior

* The caller supplies a requested organization and optional team scope.
* Every input row is re-checked against that scope. A mixed organization or
  team input fails closed instead of being silently filtered.
* The report counts bookings, cancellations, no-shows and failed or uncertain
  delivery outcomes.
* Status counts and host distribution reconcile exactly to the scoped row count.
  Duplicate booking IDs are rejected so a faulty query cannot double count.
* Host distribution uses an explicit `unassigned` bucket. Host keys are sorted
  for deterministic output.
* The returned shape contains only scope, aggregate counts and reconciliation
  totals. It does not include booking IDs, attendee payloads, event details or
  provider credentials.

## Reproduction

From the repository root after the pinned dependency install:

```sh
node --test --test-reporter=spec tests/community-enterprise/booking-report-contract.test.cjs
node --experimental-strip-types --check packages/features/community-enterprise/reporting/BookingReportContract.ts
```

The seven focused cases pass with zero failures, cancellations or skips. They
cover aggregate reconciliation, organization/team privacy, organization-only
scope, empty reports, duplicate-row rejection, invalid status/delivery and
aggregate-only output.

## Boundary that remains open

This is source evidence at the task's required source level. It does not wire
a tRPC/HTTP report route, query Prisma, prove real booking/audit retention
coverage, or validate a deployed export. CAL-07.AUDIT remains the prerequisite
for durable booking audit completeness; runtime reporting and release
acceptance remain downstream work.
