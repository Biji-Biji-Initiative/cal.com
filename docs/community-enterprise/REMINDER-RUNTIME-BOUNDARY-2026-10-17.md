# Booking reminder runtime boundary

17 October 2026. This source inventory records what the retained pending-booking
reminder implementation proves and the runtime gates that are still open for
`CAL-07.REMINDERS`.

## Source findings

The checked-in route is `apps/web/app/api/cron/bookingReminder/route.ts`. It
checks the three exact elapsed thresholds (48 hours, 24 hours and 3 hours),
requires `PENDING` bookings whose event has not ended, and matches an existing
`ReminderMail` row by both booking ID and threshold. The route sends the email
before it inserts the marker row. The send and marker insert are not wrapped in a
Prisma transaction, and the marker write is neither an upsert nor a database
operation protected by a compound unique constraint.

`ReminderMail` has separate indexes for `referenceId` and `reminderType`, but
neither the Prisma model nor its creation migration makes
`(referenceId, reminderType, elapsedMinutes)` unique. Two concurrent invocations
can therefore both observe no marker and both submit an external email before
writing their rows. A failed or ambiguous submission can also leave the marker
state unable to distinguish “not submitted” from “submitted but unknown”.

The pending-status predicate prevents a cancelled booking from being selected on
a later run. The source scan finds no production `ReminderMail` deletion or
update path, no reschedule version/identity in the marker, and no database claim
or lock around the selection/send/mark sequence. Existing marker rows therefore
remain stale across cancellation or rescheduling, and the source does not prove
how a retry should reconcile an uncertain external effect.

The checked-in GitHub Actions workflow `.github/workflows/cron-bookingReminder.yml`
schedules a `POST` to `/api/cron/bookingReminder` every fifteen minutes when
`APP_URL` and `CRON_API_KEY` are configured. This is source wiring evidence only;
it does not demonstrate that the configured branch is deployed, that the cron
request reached a running application, or that a controlled recipient accepted
the message.

## Checks

```sh
node --test --test-reporter=spec tests/community-enterprise/booking-reminder-boundary.test.cjs
node scripts/inventory-booking-reminder-boundary.cjs
node --check scripts/inventory-booking-reminder-boundary.cjs
```

The focused boundary contract passes. The inventory intentionally keeps the
runtime acceptance gates open: PostgreSQL execution, concurrent sender behavior,
cancellation/rescheduling, controlled-recipient delivery, duplicate/retry
handling, and unknown-effect reconciliation still require a built application
and a disposable database/mail receiver.
