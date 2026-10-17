import { describe, expect, it } from "vitest";
import { BOOKING_REMINDER_INTERVAL_MINUTES, hasReminderForInterval } from "./reminderIntervals";

describe("booking reminder intervals", () => {
  it("keeps the three independent reminder thresholds", () => {
    expect(BOOKING_REMINDER_INTERVAL_MINUTES).toEqual([2880, 1440, 180]);
  });

  it("does not let an older threshold suppress a later reminder", () => {
    expect(hasReminderForInterval([{ referenceId: 42, elapsedMinutes: 2880 }], 42, 1440)).toBe(false);
  });

  it("recognizes only the matching booking and threshold", () => {
    const reminders = [
      { referenceId: 41, elapsedMinutes: 1440 },
      { referenceId: 42, elapsedMinutes: 1440 },
      { referenceId: 42, elapsedMinutes: 180 },
    ];

    expect(hasReminderForInterval(reminders, 42, 1440)).toBe(true);
    expect(hasReminderForInterval(reminders, 42, 2880)).toBe(false);
    expect(hasReminderForInterval(reminders, 99, 1440)).toBe(false);
  });
});
