# Booking audit boundary review — 2026-10-17

This is a bounded source review for `CAL-07.AUDIT`. It records the retained
booking-audit producer, Tasker consumer, database repository and retention
surface. It is evidence about the current boundary; it does not promote the
task to complete and does not claim transactional booking audit coverage.

## Command and result

```text
node --test --test-reporter=spec tests/community-enterprise/booking-audit-boundary.test.cjs
```

Result: **1 test file passed, 0 failed, 0 skipped**. The test's four assertions
cover the producer payload, transaction/idempotency boundary, production wiring,
and retention scan. The source inventory is produced by
`scripts/inventory-booking-audit-boundary.cjs`.

## What the retained source proves

- `BookingAuditTaskerProducerService` has two `Tasker.create("bookingAudit", …)`
  paths: one single-record path and one bulk path.
- The producer resolves app and guest actors to an ID-only actor before putting the payload on the queue. The source test therefore preserves the zero-PII
  queue boundary for these actor forms. The actor row is materialized before task creation, so a later queue failure can leave an orphaned actor row.
- The consumer validates the task envelope, applies action-schema migration,
  resolves the actor, and writes `BookingAudit` through the Prisma repository.
- `BookingAudit.operationId` is indexed for correlation, but is not a unique
  database constraint. This is not an idempotency key.
- The `Task` model has a unique `(referenceUid, type)` facility, but the booking
  audit producer does not pass `referenceUid` when it creates a task.
- The producer dependency surface has a `Tasker`, logger and actor repository;
  it does not receive a Prisma transaction client or a domain mutation
  transaction handle.

## Access boundary found during the review

The tRPC route is authenticated, but `BookingAuditAccessService` accepts an
`organizationId` parameter and never uses it. Its current implementation
checks only whether the authenticated user is the booking owner. The source
comment describes this as the Cal.diy no-organization owner-only mode, while
the same service comment also describes audit logs as admin-only. This is an
explicit scope boundary, not enterprise organization/PBAC enforcement. The
enterprise path needs a reviewed organization/team permission contract before
booking audit visibility can be accepted as complete.

## Gaps this review deliberately leaves open

### The producer is not wired into a booking mutation path

A scan of `packages` and `apps` found no production call site outside the
booking-audit package for `BookingAuditProducerService`, its container, or its
`queue*Audit` methods. The retained producer and consumer are therefore a
feature boundary, not evidence that every booking create, accept, cancel,
reschedule, rejection, attendee, seat or host mutation reaches the audit queue.

This is the most material finding in this slice. Wiring the producer into a
mutation is a separate change: each caller must define its transaction
boundary, actor, operation ID, feature-flag behavior, failure policy, and
whether task creation is committed with the mutation.

### Queue creation is not atomic with the booking mutation

The producer calls `Tasker.create` independently. Its queue error handler logs
and returns from a `void` method. That behavior avoids taking down the caller,
but it can lose an audit task if the booking mutation has committed and task
creation fails. The source does not justify calling this a transactional
outbox.

The Tasker worker's claim/lease and unknown-outcome recovery are useful after a
task exists. They do not repair a task that was never created, and they do not
make a remote provider side effect or a booking mutation atomic with audit
persistence.

### Retry duplication is not closed

`operationId` is stored and indexed on `BookingAudit`, but there is no unique
constraint on `(bookingUid, action, operationId)` or equivalent. The producer
does not supply the Tasker's `referenceUid`. A retried or repeated producer
call can therefore create multiple tasks and, if both run, multiple audit
rows. Any deduplication change must distinguish a repeated delivery from two
legitimate records within one bulk operation.

### Retention/anonymization is not implemented in the scanned production source

The scan found no production `BookingAudit` retention, deletion or
anonymization worker. The README describes GDPR/HIPAA anonymization and a
`pseudonymizedAt` index, but the current `AuditActor` model has no
`pseudonymizedAt` field or index; the schema itself still carries a TODO for
that work. The schema's soft actor references and `onDelete:
Restrict` protect historical relationships, but they are not a retention
policy. The existing README describes anonymization as a design principle;
this review found no executable scheduled policy proving when or how actor PII
is removed while audit usefulness is retained.

## Graph disposition

`CAL-07.AUDIT` remains **in_progress**. The existing invitation, member,
identity-link, scheduling-handoff and Tasker runtime receipts remain valid at
their recorded scopes, but they do not close the booking-mutation wiring,
transactional enqueue, duplicate handling, or retention requirements above.
No production, live identity, registry, domain or deployment state was changed
by this review.
