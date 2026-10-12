# Regular booking commit protection

Date: 2026-10-12. Source predecessor:
`6267793f6a46525849bd678d5adbca9c53c7a26a`.
Scope: the existing regular-booking creation/rescheduling write transaction.
No production deployment, schema migration, database reset or external lock service.

## Reproduced failure

A deterministic test runs the packaged application against an isolated PostgreSQL
server. Two real guest HTTP requests target different event types, the same host,
and overlapping intervals (10:00–10:30 and 10:15–10:45). A test-only insert trigger
holds both requests after their availability checks. Releasing it produced two
HTTP 200 responses and two accepted overlapping booking rows. The preexisting
exact-start/end idempotency key does not protect partial overlaps.

This failure was reproduced after the sequential multi-host journey passed. A
successful slot lookup, round-robin choice or single-user lifecycle is therefore
not treated as evidence that simultaneous bookings are safe.

## Implemented contract

The existing `createBooking` transaction now receives the actual selected host
identities from RegularBookingService. It locks the original booking when
rescheduling, then locks selected user rows in ascending ID order. After acquiring
the locks, it reads current account/host eligibility and overlapping local bookings,
including existing/candidate buffers and explicitly blocking pending bookings.
The selected participant set must remain complete; a collective meeting cannot
silently lose a required host. Stale selected-host email is rejected rather than
persisted into a different identity relationship.

The conflict check and new Booking/Attendee rows are in the same transaction as
any original-booking cancellation. Read Committed is explicit: the request that
waits for another booking's host lock must see that winner's committed rows in
its subsequent conflict query. A loser raises the existing BookingConflict domain
error; it must not cancel its previous appointment or trigger calendar/email
side effects after a failed write.

Host locks are released with the transaction. Independent hosts can commit at the
same time; there is no event-wide mutex, Redis lock, additional booking database,
new algorithm or node-local state. Competing reschedules of the same original
are serialized even when they choose different new hosts. The original identity
and status are checked again after its lock is acquired.

## Rejected implementation and retained evidence

An initial Serializable transaction also allowed only one overlapping write to
commit. However, the pinned Prisma driver returned a raw DriverAdapterError with
SQLSTATE 40001 rather than the expected Prisma wrapper, and cleanup timed out.
That trial was not accepted as a deployable repair. The retained implementation
uses ordered host-row locks and a normal controlled conflict, avoiding reliance
on that failed-COMMIT error/cleanup path. No installed dependency was patched or
upgraded to hide the result.

The real PostgreSQL suite covers overlap across event types, shared collective
participants with different organizers, reverse host order, competing reschedules,
adjacent nonoverlapping appointments, buffers, blocking/nonblocking pending
bookings, cancellation, current account/membership and original-booking validation.
An independent-host control confirms this is not achieved by serializing everyone.

The retained engine/provider unit suite uses Prismock, which cannot implement
PostgreSQL row locks. Its commit guard is explicitly mocked at that unit-test
boundary; those tests do not count as concurrency evidence. The database and
packaged-HTTP suites execute the real production guard without that mock.

## Acceptance commands

```sh
yarn test:community-enterprise:host-db --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
yarn test:community-enterprise:booking-concurrency --pg-bin /usr/lib/postgresql/18/bin --scratch-root /data/tmp
```

The second command includes the existing native OIDC, team UI, multi-host
rescheduling, collective slots and notification journey, followed by the two-request
race. The test-only trigger is restricted to its synthetic event IDs and dropped
in cleanup. Database wait chains establish that both requests actually contend;
a merely sequential pair of requests cannot pass as the concurrency proof.

Final artifact and command receipts are recorded in MULTI-HOST-2026-10-12.md after
running the rebuilt application. The earlier successful sequential artifact is
not substituted for the source containing this guard.

## Remaining release boundaries

This protection covers cooperating writes through the regular create/reschedule
helper. Seat-capacity mutations, pending-booking confirmation, direct API/repository
writes, manual reassignment and explicit overbooking overrides need their own
contract and path review; they are not automatically protected because they share
a table. External calendar changes cannot be serialized by a local database lock.

Current eligibility is rechecked, but a complete atomic policy for membership,
assignment and schedule changes racing the final write is still open. Grouped-host
fairness, quotas, automatic/segment host expansion and full managed-event
acceptance remain separate requirements. No claim is made that every replica,
API bearer or deployed Authentik lifecycle has been verified.

The final guard does not offer an implicit administrator bypass for local booking
conflicts. An intentional overbooking feature needs an explicit authorized policy,
audit trail and tests rather than reusing an earlier availability-skip option.

Primary PostgreSQL behavior checked on 2026-10-12:
https://www.postgresql.org/docs/current/explicit-locking.html
https://www.postgresql.org/docs/current/transaction-iso.html

These references explain locking/read visibility; the application acceptance is
the executable evidence above, not an assumption derived from documentation.
