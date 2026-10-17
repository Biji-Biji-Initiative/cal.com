export const BOOKING_REMINDER_INTERVAL_MINUTES = [48 * 60, 24 * 60, 3 * 60] as const;

type ReminderMailReference = {
  referenceId: number;
  elapsedMinutes: number;
};

/**
 * Each reminder threshold is an independent delivery. A row for an older
 * threshold must not suppress a later threshold for the same booking.
 */
export function hasReminderForInterval(
  reminders: readonly ReminderMailReference[],
  referenceId: number,
  intervalMinutes: number
) {
  return reminders.some(
    (reminder) => reminder.referenceId === referenceId && reminder.elapsedMinutes === intervalMinutes
  );
}
