# Pending booking reminder threshold idempotency

17 October 2026. This source-level slice repairs the retained pending-booking
reminder cron contract in `apps/web/app/api/cron/bookingReminder/route.ts`.

The cron evaluates three independent thresholds (48 hours, 24 hours and 3
hours). Its previous `elapsedMinutes >= interval` lookup let an existing 48-hour
`ReminderMail` row suppress the 24-hour and 3-hour sends for the same booking.
The lookup now matches the current threshold exactly, and the extracted matcher
also requires the same booking ID. An older threshold therefore cannot satisfy a
newer one, while a repeat invocation still sees the exact row and remains
idempotent for that threshold.

## Checks

The focused source contract passes:

```sh
node --test tests/community-enterprise/booking-reminder-intervals.test.cjs
```

The colocated Vitest cases in
`apps/web/app/api/cron/bookingReminder/reminderIntervals.test.ts` cover the
three configured thresholds, older-threshold non-suppression and matching
booking/threshold identity. In this checkout the workspace package manager and
installed dependencies are unavailable, so the TypeScript helper was also
syntax-checked and exercised with Node's type-strip runtime smoke check.

## Scope retained

This is source evidence for the reminder selection/idempotency predicate. It
does not claim a PostgreSQL cron run, concurrent sender coordination, calendar
provider or SMTP delivery, cancellation/rescheduling journey, or external
recipient acceptance. Those runtime requirements remain open on CAL-07.REMINDERS.
